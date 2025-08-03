/**
 * Secrets manager for the 1inch Fusion+ Cosmos Relayer
 * 
 * Provides a unified interface for managing secrets across multiple providers
 * with automatic failover, validation, rotation, and audit logging.
 */

import { Logger } from 'pino';
import { EventEmitter } from 'events';
import {
  SecretsProviderInterface,
  SecretValue,
  SecretReference,
  SecretsConfig,
  SecretsProvider,
  SecretsManagerStats,
  SECRET_NAMES,
  SECRET_VALIDATION_RULES,
  SecretValidationRule,
  MultiProviderConfig,
  SecretAuditEvent
} from './types';
import { AWSSecretsProvider } from './aws-secrets-provider';
import { VaultSecretsProvider } from './vault-secrets-provider';
import { EnvSecretsProvider } from './env-secrets-provider';
import { OnePasswordSecretsProvider } from './onepassword-secrets-provider';
import { getMetrics } from '../monitoring/prometheus-metrics';

export class SecretsManager extends EventEmitter {
  private providers: Map<SecretsProvider, SecretsProviderInterface> = new Map();
  private primaryProvider?: SecretsProviderInterface;
  private fallbackProviders: SecretsProviderInterface[] = [];
  private config: SecretsConfig | MultiProviderConfig;
  private logger: Logger;
  private auditLog: SecretAuditEvent[] = [];
  private isInitialized: boolean = false;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(config: SecretsConfig | MultiProviderConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'SecretsManager' });
  }

  async initialize(): Promise<void> {
    try {
      if ('provider' in this.config) {
        // Single provider configuration
        await this.initializeSingleProvider(this.config);
      } else {
        // Multi-provider configuration
        await this.initializeMultiProvider(this.config);
      }

      this.isInitialized = true;
      this.startHealthChecks();

      this.emit('initialized');
      this.logger.info({
        primaryProvider: this.primaryProvider?.getProviderInfo().type,
        fallbackCount: this.fallbackProviders.length
      }, 'Secrets manager initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize secrets manager');
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    // Destroy all providers
    const destroyPromises = Array.from(this.providers.values()).map(provider =>
      provider.destroy().catch(error =>
        this.logger.warn({ error }, 'Error destroying provider')
      )
    );

    await Promise.all(destroyPromises);

    this.providers.clear();
    this.primaryProvider = undefined;
    this.fallbackProviders = [];
    this.isInitialized = false;

    this.emit('destroyed');
    this.logger.info('Secrets manager destroyed');
  }

  async getSecret(name: string, key?: string): Promise<SecretValue> {
    if (!this.isInitialized) {
      throw new Error('Secrets manager not initialized');
    }

    const startTime = Date.now();
    let lastError: Error | undefined;

    // Try primary provider first
    if (this.primaryProvider && this.primaryProvider.isHealthy()) {
      try {
        const result = await this.primaryProvider.getSecret(name, key);
        this.logAuditEvent({
          timestamp: new Date(),
          secretName: name,
          operation: 'read',
          provider: this.primaryProvider.getProviderInfo().type,
          success: true,
          metadata: {
            duration: Date.now() - startTime,
            extractedKey: key
          }
        });
        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn({ error, name, key }, 'Primary provider failed, trying fallbacks');
      }
    }

    // Try fallback providers
    for (const provider of this.fallbackProviders) {
      if (!provider.isHealthy()) {
        continue;
      }

      try {
        const result = await provider.getSecret(name, key);
        this.logAuditEvent({
          timestamp: new Date(),
          secretName: name,
          operation: 'read',
          provider: provider.getProviderInfo().type,
          success: true,
          metadata: {
            duration: Date.now() - startTime,
            extractedKey: key,
            usedFallback: true
          }
        });

        this.logger.info({ 
          name, 
          key, 
          provider: provider.getProviderInfo().type 
        }, 'Retrieved secret using fallback provider');

        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn({ 
          error, 
          name, 
          key, 
          provider: provider.getProviderInfo().type 
        }, 'Fallback provider failed');
      }
    }

    // Log failed attempt
    this.logAuditEvent({
      timestamp: new Date(),
      secretName: name,
      operation: 'read',
      provider: this.primaryProvider?.getProviderInfo().type || SecretsProvider.ENVIRONMENT,
      success: false,
      error: lastError?.message,
      metadata: {
        duration: Date.now() - startTime,
        extractedKey: key
      }
    });

    throw new Error(`Failed to retrieve secret '${name}' from all providers: ${lastError?.message}`);
  }

  async getSecrets(references: SecretReference[]): Promise<Record<string, SecretValue>> {
    const results: Record<string, SecretValue> = {};
    const errors: string[] = [];

    // Process secrets in parallel
    const promises = references.map(async (ref) => {
      try {
        const value = await this.getSecret(ref.name, ref.key);
        results[ref.key || ref.name] = value;
      } catch (error) {
        const errorMsg = `Failed to load secret '${ref.name}': ${error}`;
        
        if (ref.required !== false) {
          errors.push(errorMsg);
        } else if (ref.defaultValue) {
          results[ref.key || ref.name] = {
            value: ref.defaultValue,
            metadata: { source: 'default_value' }
          };
          this.logger.debug({ name: ref.name, key: ref.key }, 'Using default value for optional secret');
        } else {
          this.logger.warn({ error, name: ref.name, key: ref.key }, 'Optional secret failed to load and no default provided');
        }
      }
    });

    await Promise.all(promises);

    if (errors.length > 0) {
      throw new Error(`Required secrets failed to load:\n${errors.join('\n')}`);
    }

    return results;
  }

  async validateSecret(name: string, value: string): Promise<{ valid: boolean; errors: string[] }> {
    const rule = SECRET_VALIDATION_RULES.find(r => r.name === name);
    if (!rule) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];

    // Check required
    if (rule.required && (!value || value.trim() === '')) {
      errors.push(`Secret '${name}' is required but empty`);
      return { valid: false, errors };
    }

    // Check length constraints
    if (rule.minLength && value.length < rule.minLength) {
      errors.push(`Secret '${name}' must be at least ${rule.minLength} characters`);
    }

    if (rule.maxLength && value.length > rule.maxLength) {
      errors.push(`Secret '${name}' must be at most ${rule.maxLength} characters`);
    }

    // Check pattern
    if (rule.pattern && !rule.pattern.test(value)) {
      errors.push(`Secret '${name}' does not match required pattern`);
    }

    // Run custom validator
    if (rule.validator) {
      const validationResult = rule.validator(value);
      if (validationResult !== true) {
        errors.push(typeof validationResult === 'string' ? validationResult : `Secret '${name}' failed validation`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async validateAllSecrets(secrets: Record<string, string>): Promise<{
    valid: boolean;
    results: Record<string, { valid: boolean; errors: string[] }>;
  }> {
    const results: Record<string, { valid: boolean; errors: string[] }> = {};
    let allValid = true;

    for (const [name, value] of Object.entries(secrets)) {
      const validation = await this.validateSecret(name, value);
      results[name] = validation;
      
      if (!validation.valid) {
        allValid = false;
      }
    }

    return { valid: allValid, results };
  }

  async refreshAllSecrets(): Promise<void> {
    const providers = [this.primaryProvider, ...this.fallbackProviders].filter(Boolean);
    
    await Promise.all(providers.map(async (provider) => {
      try {
        provider.clearCache();
        this.logger.info({ 
          provider: provider.getProviderInfo().type 
        }, 'Cleared cache for provider');
      } catch (error) {
        this.logger.warn({ 
          error, 
          provider: provider.getProviderInfo().type 
        }, 'Failed to clear provider cache');
      }
    }));

    this.emit('secrets_refreshed');
  }

  getStats(): Record<string, SecretsManagerStats> {
    const stats: Record<string, SecretsManagerStats> = {};
    
    for (const [type, provider] of this.providers.entries()) {
      stats[type] = provider.getStats();
    }

    return stats;
  }

  getAuditLog(limit?: number): SecretAuditEvent[] {
    if (limit) {
      return this.auditLog.slice(-limit);
    }
    return [...this.auditLog];
  }

  isHealthy(): boolean {
    return this.isInitialized && (
      (this.primaryProvider?.isHealthy() ?? false) ||
      this.fallbackProviders.some(p => p.isHealthy())
    );
  }

  getHealthStatus(): {
    healthy: boolean;
    providers: Record<string, { healthy: boolean; info: any }>;
  } {
    const providers: Record<string, { healthy: boolean; info: any }> = {};
    
    for (const [type, provider] of this.providers.entries()) {
      providers[type] = {
        healthy: provider.isHealthy(),
        info: provider.getProviderInfo()
      };
    }

    return {
      healthy: this.isHealthy(),
      providers
    };
  }

  // Convenience methods for standard secrets
  async getEthereumPrivateKey(): Promise<string> {
    const result = await this.getSecret(SECRET_NAMES.ETHEREUM_PRIVATE_KEY);
    return result.value;
  }

  async getCosmosMnemonic(): Promise<string> {
    const result = await this.getSecret(SECRET_NAMES.COSMOS_MNEMONIC);
    return result.value;
  }

  async getPostgresPassword(): Promise<string> {
    const result = await this.getSecret(SECRET_NAMES.POSTGRES_PASSWORD);
    return result.value;
  }

  async getMetricsAuthToken(): Promise<string> {
    const result = await this.getSecret(SECRET_NAMES.METRICS_AUTH_TOKEN);
    return result.value;
  }

  private async initializeSingleProvider(config: SecretsConfig): Promise<void> {
    const provider = this.createProvider(config);
    await provider.initialize();
    
    this.providers.set(config.provider, provider);
    this.primaryProvider = provider;
  }

  private async initializeMultiProvider(config: MultiProviderConfig): Promise<void> {
    const sortedProviders = config.providers
      .sort((a, b) => a.priority - b.priority);

    for (const providerConfig of sortedProviders) {
      try {
        const provider = this.createProvider(providerConfig.config);
        await provider.initialize();
        
        this.providers.set(providerConfig.provider, provider);
        
        if (!this.primaryProvider && !providerConfig.fallback) {
          this.primaryProvider = provider;
        } else {
          this.fallbackProviders.push(provider);
        }
      } catch (error) {
        this.logger.warn({ 
          error, 
          provider: providerConfig.provider 
        }, 'Failed to initialize provider, skipping');
      }
    }

    if (!this.primaryProvider && this.fallbackProviders.length > 0) {
      this.primaryProvider = this.fallbackProviders.shift();
    }

    if (!this.primaryProvider) {
      throw new Error('No providers could be initialized');
    }
  }

  private createProvider(config: SecretsConfig): SecretsProviderInterface {
    switch (config.provider) {
      case SecretsProvider.AWS_SECRETS_MANAGER:
        return new AWSSecretsProvider(config, this.logger);
      
      case SecretsProvider.HASHICORP_VAULT:
        return new VaultSecretsProvider(config, this.logger);
      
      case SecretsProvider.ENVIRONMENT:
        return new EnvSecretsProvider(config, this.logger);
      
      case SecretsProvider.ONEPASSWORD:
        return new OnePasswordSecretsProvider(config);
      
      default:
        throw new Error(`Unsupported secrets provider: ${config.provider}`);
    }
  }

  private startHealthChecks(): void {
    const interval = ('healthCheckInterval' in this.config) 
      ? this.config.healthCheckInterval 
      : 60000; // 1 minute default

    if (interval > 0) {
      this.healthCheckTimer = setInterval(() => {
        this.performHealthCheck().catch(error => {
          this.logger.error({ error }, 'Health check failed');
        });
      }, interval);

      this.logger.debug({ interval }, 'Started health checks');
    }
  }

  private async performHealthCheck(): Promise<void> {
    const metrics = getMetrics();
    
    for (const [type, provider] of this.providers.entries()) {
      const wasHealthy = provider.isHealthy();
      
      try {
        // Health check is implicit in the provider's isHealthy() method
        const isHealthy = provider.isHealthy();
        
        if (isHealthy !== wasHealthy) {
          if (isHealthy) {
            this.emit('provider_healthy', type);
            this.logger.info({ provider: type }, 'Provider health restored');
          } else {
            this.emit('provider_unhealthy', type);
            this.logger.warn({ provider: type }, 'Provider health degraded');
          }
        }

        // Record metrics
        metrics.recordDatabaseHealth(type, isHealthy ? 1 : 0);
      } catch (error) {
        this.logger.warn({ error, provider: type }, 'Health check error');
      }
    }
  }

  private logAuditEvent(event: SecretAuditEvent): void {
    this.auditLog.push(event);
    
    // Keep only last 1000 audit events to prevent memory leaks
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }

    this.emit('audit_event', event);
    
    // Log high-level audit information (without secret values)
    this.logger.info({
      secretName: event.secretName,
      operation: event.operation,
      provider: event.provider,
      success: event.success,
      duration: event.metadata?.duration
    }, 'Secret operation audit');
  }
}
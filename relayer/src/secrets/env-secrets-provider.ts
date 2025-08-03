/**
 * Environment variables secrets provider for the 1inch Fusion+ Cosmos Relayer
 * 
 * Provides secret retrieval from environment variables with validation,
 * caching, and fallback support. Primarily used for development environments.
 */

import { Logger } from 'pino';
import { EventEmitter } from 'events';
import {
  SecretsProviderInterface,
  SecretValue,
  SecretReference,
  SecretsConfig,
  SecretsProvider,
  CachedSecret,
  SecretsManagerStats
} from './types';

export class EnvSecretsProvider extends EventEmitter implements SecretsProviderInterface {
  private config: SecretsConfig;
  private logger: Logger;
  private cache: Map<string, CachedSecret> = new Map();
  private stats: SecretsManagerStats;
  private isInitialized: boolean = false;
  private envPrefix: string;
  private transformFunction?: (key: string) => string;

  constructor(config: SecretsConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'EnvSecretsProvider' });
    
    this.envPrefix = config.env?.prefix || '';
    this.transformFunction = config.env?.transform;

    this.stats = {
      provider: SecretsProvider.ENVIRONMENT,
      cacheHits: 0,
      cacheMisses: 0,
      totalRequests: 0,
      failedRequests: 0,
      cacheHitRate: 0,
      averageResponseTime: 0,
      cachedSecretsCount: 0,
      healthy: false
    };
  }

  async initialize(): Promise<void> {
    try {
      // Environment variables are always available
      this.isInitialized = true;
      this.stats.healthy = true;
      
      this.emit('provider_healthy', SecretsProvider.ENVIRONMENT);
      this.logger.info({
        prefix: this.envPrefix,
        hasTransform: !!this.transformFunction
      }, 'Environment secrets provider initialized');
    } catch (error) {
      this.stats.healthy = false;
      this.emit('provider_unhealthy', SecretsProvider.ENVIRONMENT, error as Error);
      this.logger.error({ error }, 'Failed to initialize environment secrets provider');
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this.clearCache();
    this.isInitialized = false;
    this.stats.healthy = false;
    
    this.logger.info('Environment secrets provider destroyed');
  }

  isHealthy(): boolean {
    return this.isInitialized && this.stats.healthy;
  }

  async getSecret(name: string, key?: string): Promise<SecretValue> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      // Check cache first
      const cacheKey = key ? `${name}:${key}` : name;
      const cached = this.cache.get(cacheKey);
      
      if (cached && cached.expiresAt > new Date()) {
        this.stats.cacheHits++;
        cached.accessCount++;
        cached.lastAccessed = new Date();
        
        this.logger.debug({ name, key, cached: true }, 'Retrieved secret from cache');
        return cached.value;
      }

      // Cache miss - get from environment
      this.stats.cacheMisses++;
      this.logger.debug({ name, key, cached: false }, 'Fetching secret from environment variables');

      // Transform secret name to environment variable name
      const envVarName = this.getEnvVarName(name);
      const envValue = process.env[envVarName];
      
      if (envValue === undefined) {
        throw new Error(`Environment variable '${envVarName}' is not set`);
      }

      let secretValue: SecretValue;

      if (key) {
        // Extract specific key from JSON environment variable
        try {
          const jsonValue = JSON.parse(envValue);
          if (!(key in jsonValue)) {
            throw new Error(`Key '${key}' not found in environment variable '${envVarName}'`);
          }
          
          secretValue = {
            value: jsonValue[key],
            metadata: {
              source: 'environment',
              envVar: envVarName,
              originalSecret: name,
              extractedKey: key
            }
          };
        } catch (parseError) {
          throw new Error(`Failed to parse JSON from environment variable '${envVarName}': ${parseError}`);
        }
      } else {
        // Return entire environment variable value
        secretValue = {
          value: envValue,
          metadata: {
            source: 'environment',
            envVar: envVarName
          }
        };
      }

      // Cache the result
      this.cacheSecret(cacheKey, secretValue);
      
      const duration = Date.now() - startTime;
      this.updateStats(duration, true);
      
      this.emit('secret_loaded', name, secretValue);
      this.logger.info({ 
        name, 
        key, 
        envVar: envVarName,
        duration 
      }, 'Retrieved secret from environment variable');

      return secretValue;
    } catch (error) {
      this.stats.failedRequests++;
      const duration = Date.now() - startTime;
      this.updateStats(duration, false);
      
      this.emit('secret_failed', name, error as Error);
      this.logger.error({ 
        error, 
        name, 
        key, 
        duration 
      }, 'Failed to retrieve secret from environment variable');
      
      throw error;
    }
  }

  async getSecrets(references: SecretReference[]): Promise<Record<string, SecretValue>> {
    const results: Record<string, SecretValue> = {};
    const promises = references.map(async (ref) => {
      try {
        const value = await this.getSecret(ref.name, ref.key);
        results[ref.key || ref.name] = value;
      } catch (error) {
        if (ref.required !== false) {
          throw new Error(`Required secret '${ref.name}' failed to load: ${error}`);
        }
        
        if (ref.defaultValue) {
          results[ref.key || ref.name] = {
            value: ref.defaultValue,
            metadata: { source: 'default_value' }
          };
        }
        
        this.logger.warn({ 
          error, 
          name: ref.name, 
          key: ref.key 
        }, 'Optional secret failed to load, using default or skipping');
      }
    });

    await Promise.all(promises);
    return results;
  }

  async setSecret(name: string, value: string, metadata?: Record<string, any>): Promise<void> {
    // Environment variables cannot be set at runtime in a meaningful way
    // This is primarily for development/testing purposes
    const envVarName = this.getEnvVarName(name);
    
    this.logger.warn({ 
      name, 
      envVar: envVarName 
    }, 'Cannot set environment variable at runtime - this is a no-op');
    
    throw new Error(`Cannot set environment variable '${envVarName}' at runtime`);
  }

  async deleteSecret(name: string): Promise<void> {
    // Environment variables cannot be deleted at runtime
    const envVarName = this.getEnvVarName(name);
    
    this.logger.warn({ 
      name, 
      envVar: envVarName 
    }, 'Cannot delete environment variable at runtime - this is a no-op');
    
    throw new Error(`Cannot delete environment variable '${envVarName}' at runtime`);
  }

  async refreshSecret(name: string): Promise<SecretValue> {
    // Remove from cache to force fresh fetch from environment
    this.cache.delete(name);
    return await this.getSecret(name);
  }

  clearCache(): void {
    const cacheSize = this.cache.size;
    this.cache.clear();
    this.stats.cachedSecretsCount = 0;
    
    this.emit('cache_cleared');
    this.logger.info({ clearedSecrets: cacheSize }, 'Cleared secrets cache');
  }

  getProviderInfo() {
    return {
      type: SecretsProvider.ENVIRONMENT,
      healthy: this.stats.healthy,
      lastRefresh: this.stats.lastRefreshTime,
      cacheSize: this.cache.size
    };
  }

  getStats(): SecretsManagerStats {
    return {
      ...this.stats,
      cacheHitRate: this.stats.totalRequests > 0 
        ? this.stats.cacheHits / this.stats.totalRequests 
        : 0,
      cachedSecretsCount: this.cache.size
    };
  }

  /**
   * Get all environment variables that match the configured pattern
   */
  getAllMatchingSecrets(): Record<string, string> {
    const secrets: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && this.isMatchingEnvVar(key)) {
        const secretName = this.envVarToSecretName(key);
        secrets[secretName] = value;
      }
    }
    
    return secrets;
  }

  /**
   * Validate that all required environment variables are present
   */
  validateEnvironment(requiredSecrets: string[]): {
    valid: boolean;
    missing: string[];
    present: string[];
  } {
    const missing: string[] = [];
    const present: string[] = [];
    
    for (const secretName of requiredSecrets) {
      const envVarName = this.getEnvVarName(secretName);
      if (process.env[envVarName] !== undefined) {
        present.push(secretName);
      } else {
        missing.push(secretName);
      }
    }
    
    return {
      valid: missing.length === 0,
      missing,
      present
    };
  }

  private getEnvVarName(secretName: string): string {
    // Apply custom transformation if provided
    if (this.transformFunction) {
      return this.transformFunction(secretName);
    }
    
    // Default transformation: add prefix and convert to uppercase with underscores
    let envVar = secretName
      .replace(/-/g, '_')  // Convert dashes to underscores
      .toUpperCase();     // Convert to uppercase
    
    if (this.envPrefix) {
      envVar = `${this.envPrefix}${envVar}`;
    }
    
    return envVar;
  }

  private envVarToSecretName(envVar: string): string {
    let secretName = envVar;
    
    // Remove prefix if configured
    if (this.envPrefix && secretName.startsWith(this.envPrefix)) {
      secretName = secretName.substring(this.envPrefix.length);
    }
    
    // Convert to lowercase and replace underscores with dashes
    secretName = secretName
      .toLowerCase()
      .replace(/_/g, '-');
    
    return secretName;
  }

  private isMatchingEnvVar(envVar: string): boolean {
    if (this.envPrefix) {
      return envVar.startsWith(this.envPrefix);
    }
    
    // If no prefix is configured, consider all environment variables as potential secrets
    // This is probably not what you want in production, but useful for development
    return true;
  }

  private cacheSecret(key: string, value: SecretValue): void {
    const cacheTimeout = this.config.cacheTimeout || 60000; // 1 minute default for env vars
    const expiresAt = new Date(Date.now() + cacheTimeout);
    
    const cached: CachedSecret = {
      value,
      cachedAt: new Date(),
      expiresAt,
      accessCount: 0,
      lastAccessed: new Date()
    };
    
    this.cache.set(key, cached);
    this.stats.cachedSecretsCount = this.cache.size;
    
    this.emit('secret_cached', key, cacheTimeout);
  }

  private updateStats(duration: number, success: boolean): void {
    // Update average response time using exponential moving average
    const alpha = 0.1; // Smoothing factor
    this.stats.averageResponseTime = this.stats.averageResponseTime === 0
      ? duration
      : alpha * duration + (1 - alpha) * this.stats.averageResponseTime;
  }
}
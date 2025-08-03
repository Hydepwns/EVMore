/**
 * AWS Secrets Manager provider for the 1inch Fusion+ Cosmos Relayer
 * 
 * Provides secure secret retrieval from AWS Secrets Manager with automatic
 * credential management, caching, and error handling.
 */

import { SecretsManager } from 'aws-sdk';
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

export class AWSSecretsProvider extends EventEmitter implements SecretsProviderInterface {
  private client: SecretsManager;
  private config: SecretsConfig;
  private logger: Logger;
  private cache: Map<string, CachedSecret> = new Map();
  private stats: SecretsManagerStats;
  private isInitialized: boolean = false;
  private refreshTimer?: NodeJS.Timeout;

  constructor(config: SecretsConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'AWSSecretsProvider' });
    
    if (!config.aws) {
      throw new Error('AWS configuration is required for AWS Secrets Manager provider');
    }

    // Initialize AWS Secrets Manager client
    this.client = new SecretsManager({
      region: config.aws.region,
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
      sessionToken: config.aws.sessionToken,
      endpoint: config.aws.endpoint,
      maxRetries: config.retryAttempts || 3,
      retryDelayOptions: {
        base: config.retryDelay || 1000
      }
    });

    this.stats = {
      provider: SecretsProvider.AWS_SECRETS_MANAGER,
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
      // Test connection by listing secrets (with minimal permissions)
      await this.client.listSecrets({ MaxResults: 1 }).promise();
      
      this.isInitialized = true;
      this.stats.healthy = true;
      
      // Start automatic refresh if configured
      if (this.config.refreshInterval && this.config.refreshInterval > 0) {
        this.startAutoRefresh();
      }
      
      this.emit('provider_healthy', SecretsProvider.AWS_SECRETS_MANAGER);
      this.logger.info({
        region: this.config.aws!.region,
        endpoint: this.config.aws!.endpoint
      }, 'AWS Secrets Manager provider initialized');
    } catch (error) {
      this.stats.healthy = false;
      this.emit('provider_unhealthy', SecretsProvider.AWS_SECRETS_MANAGER, error as Error);
      this.logger.error({ error }, 'Failed to initialize AWS Secrets Manager provider');
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    
    this.clearCache();
    this.isInitialized = false;
    this.stats.healthy = false;
    
    this.logger.info('AWS Secrets Manager provider destroyed');
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

      // Cache miss - fetch from AWS
      this.stats.cacheMisses++;
      this.logger.debug({ name, key, cached: false }, 'Fetching secret from AWS Secrets Manager');

      const params: SecretsManager.GetSecretValueRequest = {
        SecretId: name,
        VersionStage: this.config.aws!.versionStage || 'AWSCURRENT'
      };

      const result = await this.client.getSecretValue(params).promise();
      
      if (!result.SecretString) {
        throw new Error(`Secret ${name} has no string value`);
      }

      let secretValue: SecretValue;

      if (key) {
        // Extract specific key from JSON secret
        try {
          const jsonSecret = JSON.parse(result.SecretString);
          if (!(key in jsonSecret)) {
            throw new Error(`Key '${key}' not found in secret '${name}'`);
          }
          
          secretValue = {
            value: jsonSecret[key],
            version: result.VersionId,
            createdDate: result.CreatedDate,
            lastUpdated: result.CreatedDate,
            metadata: {
              arn: result.ARN,
              versionStage: result.VersionStages,
              originalSecret: name,
              extractedKey: key
            }
          };
        } catch (parseError) {
          throw new Error(`Failed to parse JSON secret '${name}': ${parseError}`);
        }
      } else {
        // Return entire secret value
        secretValue = {
          value: result.SecretString,
          version: result.VersionId,
          createdDate: result.CreatedDate,
          lastUpdated: result.CreatedDate,
          metadata: {
            arn: result.ARN,
            versionStage: result.VersionStages
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
        version: secretValue.version,
        duration 
      }, 'Retrieved secret from AWS Secrets Manager');

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
      }, 'Failed to retrieve secret from AWS Secrets Manager');
      
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
    try {
      const params: SecretsManager.CreateSecretRequest | SecretsManager.UpdateSecretRequest = {
        Name: name,
        SecretString: value,
        Description: metadata?.description || `Secret managed by Fusion+ Relayer`,
      };

      try {
        // Try to update existing secret first
        await this.client.updateSecret(params as SecretsManager.UpdateSecretRequest).promise();
        this.logger.info({ name }, 'Updated existing secret in AWS Secrets Manager');
      } catch (error: any) {
        if (error.code === 'ResourceNotFoundException') {
          // Secret doesn't exist, create it
          await this.client.createSecret(params as SecretsManager.CreateSecretRequest).promise();
          this.logger.info({ name }, 'Created new secret in AWS Secrets Manager');
        } else {
          throw error;
        }
      }

      // Invalidate cache
      this.cache.delete(name);
      
    } catch (error) {
      this.logger.error({ error, name }, 'Failed to set secret in AWS Secrets Manager');
      throw error;
    }
  }

  async deleteSecret(name: string): Promise<void> {
    try {
      await this.client.deleteSecret({
        SecretId: name,
        ForceDeleteWithoutRecovery: false // Allow 7-day recovery window
      }).promise();
      
      // Remove from cache
      this.cache.delete(name);
      
      this.logger.info({ name }, 'Deleted secret from AWS Secrets Manager');
    } catch (error) {
      this.logger.error({ error, name }, 'Failed to delete secret from AWS Secrets Manager');
      throw error;
    }
  }

  async refreshSecret(name: string): Promise<SecretValue> {
    // Remove from cache to force fresh fetch
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
      type: SecretsProvider.AWS_SECRETS_MANAGER,
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

  private cacheSecret(key: string, value: SecretValue): void {
    const cacheTimeout = this.config.cacheTimeout || 300000; // 5 minutes default
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

  private startAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    
    this.refreshTimer = setInterval(() => {
      this.performAutoRefresh().catch(error => {
        this.logger.error({ error }, 'Auto-refresh failed');
      });
    }, this.config.refreshInterval!);
    
    this.logger.info({ 
      interval: this.config.refreshInterval 
    }, 'Started automatic secret refresh');
  }

  private async performAutoRefresh(): Promise<void> {
    const expiredSecrets: string[] = [];
    const now = new Date();
    
    // Find expired secrets
    for (const [key, cached] of this.cache.entries()) {
      if (cached.expiresAt <= now) {
        expiredSecrets.push(key);
      }
    }
    
    if (expiredSecrets.length === 0) {
      return;
    }
    
    this.logger.debug({ 
      expiredCount: expiredSecrets.length 
    }, 'Refreshing expired secrets');
    
    // Refresh expired secrets
    for (const key of expiredSecrets) {
      try {
        const [name, subKey] = key.split(':', 2);
        await this.getSecret(name, subKey);
        
        this.emit('secret_expired', key);
      } catch (error) {
        this.logger.warn({ 
          error, 
          key 
        }, 'Failed to refresh expired secret');
      }
    }
    
    this.stats.lastRefreshTime = new Date();
    this.emit('refresh_completed', expiredSecrets.length);
  }
}
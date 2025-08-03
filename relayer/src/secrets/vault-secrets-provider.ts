/**
 * HashiCorp Vault provider for the 1inch Fusion+ Cosmos Relayer
 * 
 * Provides secure secret retrieval from HashiCorp Vault with support for
 * multiple authentication methods, KV v1/v2, and automatic token renewal.
 */

import vault from 'node-vault';
import { Logger } from 'pino';
import { EventEmitter } from 'events';
import * as https from 'https';
import {
  SecretsProviderInterface,
  SecretValue,
  SecretReference,
  SecretsConfig,
  SecretsProvider,
  CachedSecret,
  SecretsManagerStats
} from './types';

export class VaultSecretsProvider extends EventEmitter implements SecretsProviderInterface {
  private client: any; // node-vault client
  private config: SecretsConfig;
  private logger: Logger;
  private cache: Map<string, CachedSecret> = new Map();
  private stats: SecretsManagerStats;
  private isInitialized: boolean = false;
  private refreshTimer?: NodeJS.Timeout;
  private tokenRenewalTimer?: NodeJS.Timeout;
  private currentToken?: string;
  private tokenExpiry?: Date;

  constructor(config: SecretsConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'VaultSecretsProvider' });
    
    if (!config.vault) {
      throw new Error('Vault configuration is required for HashiCorp Vault provider');
    }

    this.stats = {
      provider: SecretsProvider.HASHICORP_VAULT,
      cacheHits: 0,
      cacheMisses: 0,
      totalRequests: 0,
      failedRequests: 0,
      cacheHitRate: 0,
      averageResponseTime: 0,
      cachedSecretsCount: 0,
      healthy: false
    };

    this.initializeClient();
  }

  private initializeClient(): void {
    const vaultConfig = this.config.vault!;
    
    // Configure TLS options
    let httpsAgent: https.Agent | undefined;
    if (vaultConfig.tlsOptions) {
      httpsAgent = new https.Agent({
        ca: vaultConfig.tlsOptions.ca,
        cert: vaultConfig.tlsOptions.cert,
        key: vaultConfig.tlsOptions.key,
        rejectUnauthorized: !vaultConfig.tlsOptions.skipVerify
      });
    }

    // Initialize Vault client
    this.client = vault({
      apiVersion: 'v1',
      endpoint: vaultConfig.endpoint,
      token: vaultConfig.token,
      namespace: vaultConfig.namespace,
      requestOptions: httpsAgent ? { agent: httpsAgent } : undefined
    });
  }

  async initialize(): Promise<void> {
    try {
      // Authenticate if needed
      await this.authenticate();
      
      // Test connection
      await this.client.health();
      
      this.isInitialized = true;
      this.stats.healthy = true;
      
      // Start automatic refresh if configured
      if (this.config.refreshInterval && this.config.refreshInterval > 0) {
        this.startAutoRefresh();
      }
      
      // Start token renewal if using token authentication
      if (this.currentToken) {
        this.startTokenRenewal();
      }
      
      this.emit('provider_healthy', SecretsProvider.HASHICORP_VAULT);
      this.logger.info({
        endpoint: this.config.vault!.endpoint,
        namespace: this.config.vault!.namespace,
        mountPath: this.config.vault!.mountPath || 'secret',
        version: this.config.vault!.version || 'v2'
      }, 'HashiCorp Vault provider initialized');
    } catch (error) {
      this.stats.healthy = false;
      this.emit('provider_unhealthy', SecretsProvider.HASHICORP_VAULT, error as Error);
      this.logger.error({ error }, 'Failed to initialize HashiCorp Vault provider');
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    
    if (this.tokenRenewalTimer) {
      clearInterval(this.tokenRenewalTimer);
      this.tokenRenewalTimer = undefined;
    }
    
    this.clearCache();
    this.isInitialized = false;
    this.stats.healthy = false;
    
    this.logger.info('HashiCorp Vault provider destroyed');
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

      // Cache miss - fetch from Vault
      this.stats.cacheMisses++;
      this.logger.debug({ name, key, cached: false }, 'Fetching secret from HashiCorp Vault');

      const mountPath = this.config.vault!.mountPath || 'secret';
      const version = this.config.vault!.version || 'v2';
      
      let secretPath: string;
      let response: any;

      if (version === 'v2') {
        // KV v2 format
        secretPath = `${mountPath}/data/${name}`;
        response = await this.client.read(secretPath);
        
        if (!response?.data?.data) {
          throw new Error(`Secret '${name}' not found or has no data`);
        }
        
        response.data = response.data.data; // Extract nested data for v2
      } else {
        // KV v1 format
        secretPath = `${mountPath}/${name}`;
        response = await this.client.read(secretPath);
        
        if (!response?.data) {
          throw new Error(`Secret '${name}' not found or has no data`);
        }
      }

      let secretValue: SecretValue;

      if (key) {
        // Extract specific key from secret data
        if (!(key in response.data)) {
          throw new Error(`Key '${key}' not found in secret '${name}'`);
        }
        
        secretValue = {
          value: response.data[key],
          version: response.metadata?.version?.toString(),
          createdDate: response.metadata?.created_time ? new Date(response.metadata.created_time) : undefined,
          lastUpdated: response.metadata?.updated_time ? new Date(response.metadata.updated_time) : undefined,
          metadata: {
            path: secretPath,
            originalSecret: name,
            extractedKey: key,
            vaultMetadata: response.metadata
          }
        };
      } else {
        // Return entire secret data as JSON string
        secretValue = {
          value: JSON.stringify(response.data),
          version: response.metadata?.version?.toString(),
          createdDate: response.metadata?.created_time ? new Date(response.metadata.created_time) : undefined,
          lastUpdated: response.metadata?.updated_time ? new Date(response.metadata.updated_time) : undefined,
          metadata: {
            path: secretPath,
            vaultMetadata: response.metadata
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
        path: secretPath,
        version: secretValue.version,
        duration 
      }, 'Retrieved secret from HashiCorp Vault');

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
      }, 'Failed to retrieve secret from HashiCorp Vault');
      
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
      const mountPath = this.config.vault!.mountPath || 'secret';
      const version = this.config.vault!.version || 'v2';
      
      let secretPath: string;
      let data: any;

      if (version === 'v2') {
        // KV v2 format
        secretPath = `${mountPath}/data/${name}`;
        
        // For v2, we need to check if this is a JSON value or simple string
        try {
          const jsonValue = JSON.parse(value);
          data = { data: jsonValue };
        } catch {
          // Not JSON, store as simple key-value
          data = { data: { value } };
        }
        
        if (metadata) {
          data.metadata = metadata;
        }
      } else {
        // KV v1 format
        secretPath = `${mountPath}/${name}`;
        
        try {
          data = JSON.parse(value);
        } catch {
          data = { value };
        }
      }

      await this.client.write(secretPath, data);
      
      // Invalidate cache
      this.cache.delete(name);
      
      this.logger.info({ name, path: secretPath }, 'Set secret in HashiCorp Vault');
    } catch (error) {
      this.logger.error({ error, name }, 'Failed to set secret in HashiCorp Vault');
      throw error;
    }
  }

  async deleteSecret(name: string): Promise<void> {
    try {
      const mountPath = this.config.vault!.mountPath || 'secret';
      const version = this.config.vault!.version || 'v2';
      
      let secretPath: string;

      if (version === 'v2') {
        // KV v2 supports soft delete and permanent delete
        secretPath = `${mountPath}/data/${name}`;
        await this.client.delete(secretPath);
        
        // Also permanently delete if configured to do so
        const metadataPath = `${mountPath}/metadata/${name}`;
        await this.client.delete(metadataPath);
      } else {
        // KV v1 format
        secretPath = `${mountPath}/${name}`;
        await this.client.delete(secretPath);
      }
      
      // Remove from cache
      this.cache.delete(name);
      
      this.logger.info({ name, path: secretPath }, 'Deleted secret from HashiCorp Vault');
    } catch (error) {
      this.logger.error({ error, name }, 'Failed to delete secret from HashiCorp Vault');
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
      type: SecretsProvider.HASHICORP_VAULT,
      healthy: this.stats.healthy,
      lastRefresh: this.stats.lastRefreshTime,
      cacheSize: this.cache.size
    };
  }

  getStats(): {
    secretsLoaded: number;
    cacheHits: number;
    cacheMisses: number;
    errors: number;
    lastError?: string;
  } {
    return {
      secretsLoaded: this.stats.cachedSecretsCount,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      errors: this.stats.failedRequests,
      lastError: undefined
    };
  }

  private async authenticate(): Promise<void> {
    const vaultConfig = this.config.vault!;
    
    if (vaultConfig.token) {
      // Token authentication
      this.currentToken = vaultConfig.token;
      this.client.token = this.currentToken;
      
      // Get token info to check expiry
      try {
        const tokenInfo = await this.client.tokenLookupSelf();
        if (tokenInfo.data.expire_time) {
          this.tokenExpiry = new Date(tokenInfo.data.expire_time);
        }
      } catch (error) {
        this.logger.warn({ error }, 'Could not lookup token info');
      }
      
      this.logger.debug('Authenticated with Vault using token');
    } else if (vaultConfig.roleId && vaultConfig.secretId) {
      // AppRole authentication
      const authResponse = await this.client.approleLogin({
        role_id: vaultConfig.roleId,
        secret_id: vaultConfig.secretId
      });
      
      this.currentToken = authResponse.auth.client_token;
      this.client.token = this.currentToken;
      
      if (authResponse.auth.lease_duration) {
        const expiryMs = Date.now() + (authResponse.auth.lease_duration * 1000);
        this.tokenExpiry = new Date(expiryMs);
      }
      
      this.logger.debug('Authenticated with Vault using AppRole');
    } else {
      throw new Error('No valid authentication method configured for Vault');
    }
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

  private startTokenRenewal(): void {
    if (!this.tokenExpiry || !this.currentToken) {
      return;
    }
    
    // Renew token when it's 75% of the way to expiry
    const renewalTime = this.tokenExpiry.getTime() - Date.now();
    const renewalDelay = Math.max(renewalTime * 0.25, 60000); // At least 1 minute
    
    this.tokenRenewalTimer = setTimeout(() => {
      this.renewToken().catch(error => {
        this.logger.error({ error }, 'Token renewal failed');
        this.stats.healthy = false;
        this.emit('provider_unhealthy', SecretsProvider.HASHICORP_VAULT, error);
      });
    }, renewalDelay);
    
    this.logger.debug({ 
      renewalDelay: Math.round(renewalDelay / 1000),
      tokenExpiry: this.tokenExpiry
    }, 'Scheduled token renewal');
  }

  private async renewToken(): Promise<void> {
    try {
      const renewResponse = await this.client.tokenRenewSelf();
      
      if (renewResponse.auth?.lease_duration) {
        const expiryMs = Date.now() + (renewResponse.auth.lease_duration * 1000);
        this.tokenExpiry = new Date(expiryMs);
        
        // Schedule next renewal
        this.startTokenRenewal();
        
        this.logger.info({ 
          newExpiry: this.tokenExpiry 
        }, 'Successfully renewed Vault token');
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to renew Vault token');
      throw error;
    }
  }
}
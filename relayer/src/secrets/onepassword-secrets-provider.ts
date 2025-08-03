/**
 * 1Password Secrets Provider for the 1inch Fusion+ Cosmos Relayer
 * 
 * Supports both 1Password Connect API and CLI-based secret retrieval.
 * Prioritizes security, performance, and reliability for production deployments.
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { 
  SecretsProviderInterface, 
  SecretValue, 
  SecretReference, 
  SecretsProvider, 
  SecretsConfig,
  CachedSecret 
} from './types';

interface OnePasswordItem {
  id: string;
  title: string;
  vault: {
    id: string;
    name: string;
  };
  fields?: Array<{
    id: string;
    label: string;
    type: string;
    value?: string;
    reference?: string;
  }>;
  urls?: Array<{
    label: string;
    url: string;
  }>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface OnePasswordConnectError {
  status: number;
  message: string;
  details?: string;
}

export class OnePasswordSecretsProvider extends EventEmitter implements SecretsProviderInterface {
  private config: SecretsConfig;
  private connectClient?: AxiosInstance;
  private cache = new Map<string, CachedSecret>();
  private healthStatus = true;
  private lastHealthCheck = new Date();
  private initPromise?: Promise<void>;

  constructor(config: SecretsConfig) {
    super();
    this.config = config;
    
    if (!config.onePassword) {
      throw new Error('1Password configuration is required');
    }

    // Initialize Connect API client if configured
    if (config.onePassword.useConnect && config.onePassword.endpoint && config.onePassword.token) {
      this.connectClient = axios.create({
        baseURL: config.onePassword.endpoint,
        timeout: config.onePassword.timeout || 30000,
        headers: {
          'Authorization': `Bearer ${config.onePassword.token}`,
          'Content-Type': 'application/json'
        }
      });

      // Add response interceptor for error handling
      this.connectClient.interceptors.response.use(
        response => response,
        (error: AxiosError) => {
          this.handleConnectError(error);
          return Promise.reject(error);
        }
      );
    }
  }

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    const config = this.config.onePassword!;

    try {
      if (config.useConnect && this.connectClient) {
        // Test Connect API connectivity
        await this.connectClient.get('/v1/heartbeat');
        console.log('1Password Connect API initialized successfully');
      } else {
        // Test CLI availability
        await this.testCliAvailability();
        console.log('1Password CLI initialized successfully');
      }

      this.healthStatus = true;
      this.lastHealthCheck = new Date();
      this.emit('provider_healthy', SecretsProvider.ONEPASSWORD);
    } catch (error) {
      this.healthStatus = false;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.emit('provider_unhealthy', SecretsProvider.ONEPASSWORD, new Error(`1Password initialization failed: ${errorMsg}`));
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this.clearCache();
    if (this.connectClient) {
      // Clean up any pending requests
      this.connectClient.defaults.timeout = 1000;
    }
  }

  isHealthy(): boolean {
    return this.healthStatus;
  }

  async getSecret(name: string, key?: string): Promise<SecretValue> {
    await this.initialize();

    // Check cache first
    const cacheKey = `${name}${key ? `#${key}` : ''}`;
    const cached = this.getCachedSecret(cacheKey);
    if (cached) {
      this.emit('secret_cached', name, Math.floor((cached.expiresAt.getTime() - Date.now()) / 1000));
      return cached.value;
    }

    try {
      let secretValue: SecretValue;

      if (this.config.onePassword!.useConnect && this.connectClient) {
        secretValue = await this.getSecretViaConnect(name, key);
      } else {
        secretValue = await this.getSecretViaCli(name, key);
      }

      // Cache the result
      this.cacheSecret(cacheKey, secretValue);
      this.emit('secret_loaded', name, secretValue);

      return secretValue;
    } catch (error) {
      this.emit('secret_failed', name, error as Error);
      throw error;
    }
  }

  async getSecrets(references: SecretReference[]): Promise<Record<string, SecretValue>> {
    const results: Record<string, SecretValue> = {};
    const errors: Array<{ name: string; error: Error }> = [];

    // Process secrets in parallel with controlled concurrency
    const concurrency = 3;
    const chunks = this.chunkArray(references, concurrency);

    for (const chunk of chunks) {
      const promises = chunk.map(async (ref) => {
        try {
          const value = await this.getSecret(ref.name, ref.key);
          results[ref.name] = value;
        } catch (error) {
          if (ref.required) {
            errors.push({ name: ref.name, error: error as Error });
          } else if (ref.defaultValue) {
            results[ref.name] = {
              value: ref.defaultValue,
              metadata: { source: 'default', description: ref.description }
            };
          }
        }
      });

      await Promise.all(promises);
    }

    if (errors.length > 0) {
      throw new Error(`Failed to retrieve required secrets: ${errors.map(e => e.name).join(', ')}`);
    }

    return results;
  }

  async refreshSecret(name: string): Promise<SecretValue> {
    // Remove from cache to force fresh retrieval
    this.cache.delete(name);
    return this.getSecret(name);
  }

  clearCache(): void {
    this.cache.clear();
    this.emit('cache_cleared');
  }

  getProviderInfo() {
    return {
      type: SecretsProvider.ONEPASSWORD,
      healthy: this.healthStatus,
      lastRefresh: this.lastHealthCheck,
      cacheSize: this.cache.size
    };
  }

  // Connect API implementation
  private async getSecretViaConnect(name: string, key?: string): Promise<SecretValue> {
    if (!this.connectClient) {
      throw new Error('Connect API client not initialized');
    }

    const config = this.config.onePassword!;
    const vault = config.vault || 'Private';

    try {
      // Parse name for vault/item/field format
      const { vaultId, itemId, fieldId } = this.parseSecretName(name, vault);

      // Get the item from 1Password
      const response = await this.connectClient.get(`/v1/vaults/${vaultId}/items/${itemId}`);
      const item: OnePasswordItem = response.data;

      let secretValue = '';
      let fieldLabel = key || fieldId || 'password';

      if (key || fieldId) {
        // Extract specific field
        const field = item.fields?.find(f => 
          f.label.toLowerCase() === fieldLabel.toLowerCase() || 
          f.id === fieldLabel
        );
        
        if (!field || !field.value) {
          throw new Error(`Field '${fieldLabel}' not found in item '${itemId}'`);
        }
        
        secretValue = field.value;
      } else {
        // Try to get the password field by default
        const passwordField = item.fields?.find(f => 
          f.type === 'CONCEALED' || 
          f.label.toLowerCase().includes('password')
        );
        
        if (passwordField?.value) {
          secretValue = passwordField.value;
        } else {
          throw new Error(`No password field found in item '${itemId}'`);
        }
      }

      return {
        value: secretValue,
        version: item.version.toString(),
        createdDate: new Date(item.createdAt),
        lastUpdated: new Date(item.updatedAt),
        metadata: {
          provider: 'onepassword-connect',
          vault: item.vault.name,
          item: item.title,
          field: fieldLabel
        }
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`1Password Connect API error: ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  // CLI implementation  
  private async getSecretViaCli(name: string, key?: string): Promise<SecretValue> {
    const config = this.config.onePassword!;
    const cliPath = config.cliPath || 'op';

    try {
      // Parse name for vault/item/field format
      const { vaultId, itemId, fieldId } = this.parseSecretName(name, config.vault);
      const fieldRef = key || fieldId || 'password';

      // Build CLI command
      const args = ['item', 'get', itemId];
      if (vaultId && vaultId !== 'Private') {
        args.push('--vault', vaultId);
      }
      if (config.account) {
        args.push('--account', config.account);
      }
      args.push('--field', fieldRef, '--format', 'json');

      const result = await this.executeCli(cliPath, args);
      const item = JSON.parse(result);

      // Extract the field value
      let secretValue = '';
      if (typeof item === 'string') {
        // Direct field value returned
        secretValue = item;
      } else if (item.fields) {
        // Full item returned, extract field
        const field = item.fields.find((f: any) => 
          f.label.toLowerCase() === fieldRef.toLowerCase() || 
          f.id === fieldRef
        );
        if (!field) {
          throw new Error(`Field '${fieldRef}' not found in item '${itemId}'`);
        }
        secretValue = field.value || '';
      } else {
        throw new Error(`Unexpected response format from 1Password CLI`);
      }

      return {
        value: secretValue,
        version: item.version?.toString(),
        createdDate: item.createdAt ? new Date(item.createdAt) : undefined,
        lastUpdated: item.updatedAt ? new Date(item.updatedAt) : undefined,
        metadata: {
          provider: 'onepassword-cli',
          vault: vaultId,
          item: itemId,
          field: fieldRef
        }
      };
    } catch (error) {
      throw new Error(`1Password CLI error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Helper methods
  private parseSecretName(name: string, defaultVault?: string): { vaultId: string; itemId: string; fieldId?: string } {
    const parts = name.split('/');
    
    if (parts.length === 1) {
      // Simple name: use default vault
      return {
        vaultId: defaultVault || 'Private',
        itemId: parts[0]
      };
    } else if (parts.length === 2) {
      // vault/item format
      return {
        vaultId: parts[0],
        itemId: parts[1]
      };
    } else if (parts.length === 3) {
      // vault/item/field format
      return {
        vaultId: parts[0],
        itemId: parts[1],
        fieldId: parts[2]
      };
    } else {
      throw new Error(`Invalid secret name format: ${name}. Use 'item', 'vault/item', or 'vault/item/field'`);
    }
  }

  private async testCliAvailability(): Promise<void> {
    const config = this.config.onePassword!;
    const cliPath = config.cliPath || 'op';

    try {
      await this.executeCli(cliPath, ['--version']);
    } catch (error) {
      throw new Error(`1Password CLI not available at '${cliPath}'. Please install the 1Password CLI or configure the correct path.`);
    }
  }

  private async executeCli(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = this.config.onePassword!.timeout || 30000;
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`CLI command timed out after ${timeout}ms`));
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`CLI command failed with code ${code}: ${stderr || stdout}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  private getCachedSecret(key: string): CachedSecret | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > new Date()) {
      cached.accessCount++;
      cached.lastAccessed = new Date();
      return cached;
    }
    
    if (cached) {
      this.cache.delete(key);
      this.emit('secret_expired', key);
    }
    
    return null;
  }

  private cacheSecret(key: string, value: SecretValue): void {
    const cacheTimeout = this.config.cacheTimeout || 300000; // 5 minutes default
    const expiresAt = new Date(Date.now() + cacheTimeout);
    
    this.cache.set(key, {
      value,
      cachedAt: new Date(),
      expiresAt,
      accessCount: 1,
      lastAccessed: new Date()
    });
  }

  private handleConnectError(error: AxiosError): void {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as OnePasswordConnectError;
      
      if (status === 401) {
        this.healthStatus = false;
        this.emit('provider_unhealthy', SecretsProvider.ONEPASSWORD, 
          new Error('1Password Connect API authentication failed'));
      } else if (status >= 500) {
        this.healthStatus = false;
        this.emit('provider_unhealthy', SecretsProvider.ONEPASSWORD,
          new Error(`1Password Connect API server error: ${data.message}`));
      }
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      this.healthStatus = false;
      this.emit('provider_unhealthy', SecretsProvider.ONEPASSWORD,
        new Error('1Password Connect API connection failed'));
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
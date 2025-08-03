/**
 * Secrets management types for the 1inch Fusion+ Cosmos Relayer
 * 
 * This module defines interfaces for secure secret retrieval from various
 * providers including AWS Secrets Manager, HashiCorp Vault, and environment variables.
 */

export interface SecretValue {
  value: string;
  version?: string;
  createdDate?: Date;
  lastUpdated?: Date;
  metadata?: Record<string, any>;
}

export interface SecretReference {
  name: string;
  key?: string; // For nested secrets (JSON objects)
  required?: boolean;
  defaultValue?: string;
  description?: string;
}

export interface SecretsConfig {
  provider: SecretsProvider;
  refreshInterval?: number; // How often to refresh secrets (ms)
  cacheTimeout?: number; // How long to cache secrets (ms)
  retryAttempts?: number; // Retry attempts on failure
  retryDelay?: number; // Delay between retries (ms)
  
  // AWS Secrets Manager configuration
  aws?: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    endpoint?: string; // For LocalStack or custom endpoints
    versionStage?: string; // AWSCURRENT, AWSPENDING, or custom
  };
  
  // HashiCorp Vault configuration
  vault?: {
    endpoint: string;
    token?: string;
    roleId?: string; // For AppRole authentication
    secretId?: string; // For AppRole authentication
    namespace?: string; // For Vault Enterprise
    mountPath?: string; // KV mount path (default: secret)
    version?: 'v1' | 'v2'; // KV version (default: v2)
    tlsOptions?: {
      ca?: string; // CA certificate
      cert?: string; // Client certificate
      key?: string; // Client private key
      skipVerify?: boolean; // Skip TLS verification
    };
  };
  
  // Environment variables configuration
  env?: {
    prefix?: string; // Prefix for environment variables
    transform?: (key: string) => string; // Transform secret names to env var names
  };
  
  // 1Password configuration
  onePassword?: {
    endpoint?: string; // 1Password Connect server URL
    token?: string; // Service account token for Connect API
    vault?: string; // Default vault ID or name
    cliPath?: string; // Path to op CLI executable
    account?: string; // Account shorthand for CLI
    timeout?: number; // Request timeout in milliseconds
    useConnect?: boolean; // Use Connect API instead of CLI (default: false)
    retryAttempts?: number; // Number of retry attempts
    retryDelay?: number; // Delay between retries in milliseconds
  };
}

export enum SecretsProvider {
  AWS_SECRETS_MANAGER = 'aws',
  HASHICORP_VAULT = 'vault',
  ENVIRONMENT = 'env',
  ONEPASSWORD = '1password',
  MULTI = 'multi' // Use multiple providers with fallback
}

export interface SecretsProviderInterface {
  // Core operations
  getSecret(name: string, key?: string): Promise<SecretValue>;
  getSecrets(references: SecretReference[]): Promise<Record<string, SecretValue>>;
  setSecret?(name: string, value: string, metadata?: Record<string, any>): Promise<void>;
  deleteSecret?(name: string): Promise<void>;
  
  // Lifecycle management
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  isHealthy(): boolean;
  
  // Cache management
  refreshSecret(name: string): Promise<SecretValue>;
  clearCache(): void;
  
  // Provider info
  getProviderInfo(): {
    type: SecretsProvider;
    healthy: boolean;
    lastRefresh?: Date;
    cacheSize?: number;
  };

  // Statistics
  getStats?(): {
    secretsLoaded: number;
    cacheHits: number;
    cacheMisses: number;
    errors: number;
    lastError?: string;
  };
}

export interface SecretsManagerEvents {
  'secret_loaded': (name: string, value: SecretValue) => void;
  'secret_cached': (name: string, ttl: number) => void;
  'secret_expired': (name: string) => void;
  'secret_failed': (name: string, error: Error) => void;
  'provider_healthy': (provider: SecretsProvider) => void;
  'provider_unhealthy': (provider: SecretsProvider, error: Error) => void;
  'cache_cleared': () => void;
  'refresh_completed': (secretsCount: number) => void;
}

export interface CachedSecret {
  value: SecretValue;
  cachedAt: Date;
  expiresAt: Date;
  accessCount: number;
  lastAccessed: Date;
}

export interface SecretsManagerStats {
  provider: SecretsProvider;
  cacheHits: number;
  cacheMisses: number;
  totalRequests: number;
  failedRequests: number;
  cacheHitRate: number;
  averageResponseTime: number;
  cachedSecretsCount: number;
  lastRefreshTime?: Date;
  healthy: boolean;
}

/**
 * Standard secret names used throughout the application
 */
export const SECRET_NAMES = {
  // Blockchain private keys and mnemonics
  ETHEREUM_PRIVATE_KEY: 'ethereum-private-key',
  COSMOS_MNEMONIC: 'cosmos-mnemonic',
  OSMOSIS_MNEMONIC: 'osmosis-mnemonic',
  
  // Database credentials
  POSTGRES_PASSWORD: 'postgres-password',
  REDIS_PASSWORD: 'redis-password',
  
  // API keys and tokens
  ETHEREUM_RPC_API_KEY: 'ethereum-rpc-api-key',
  METRICS_AUTH_TOKEN: 'metrics-auth-token',
  ADMIN_API_TOKEN: 'admin-api-token',
  
  // Encryption keys
  ENCRYPTION_KEY: 'encryption-key',
  JWT_SECRET: 'jwt-secret',
  
  // Third-party integrations
  WEBHOOK_SECRET: 'webhook-secret',
  SLACK_WEBHOOK_URL: 'slack-webhook-url',
  DISCORD_WEBHOOK_URL: 'discord-webhook-url',
  
  // Monitoring and alerting
  PROMETHEUS_AUTH_TOKEN: 'prometheus-auth-token',
  GRAFANA_API_KEY: 'grafana-api-key'
} as const;

export type SecretName = typeof SECRET_NAMES[keyof typeof SECRET_NAMES];

/**
 * Secret validation rules
 */
export interface SecretValidationRule {
  name: string;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  validator?: (value: string) => boolean | string; // Return true or error message
}

export const SECRET_VALIDATION_RULES: SecretValidationRule[] = [
  {
    name: SECRET_NAMES.ETHEREUM_PRIVATE_KEY,
    required: true,
    minLength: 64,
    maxLength: 66, // With or without 0x prefix
    pattern: /^(0x)?[a-fA-F0-9]{64}$/,
    validator: (value: string) => {
      // Additional validation for Ethereum private keys
      const cleanKey = value.replace(/^0x/, '');
      if (cleanKey.length !== 64) return 'Private key must be 64 hex characters';
      if (!/^[a-fA-F0-9]+$/.test(cleanKey)) return 'Private key must contain only hex characters';
      return true;
    }
  },
  {
    name: SECRET_NAMES.COSMOS_MNEMONIC,
    required: true,
    minLength: 100, // Approximate minimum for 12-word mnemonic
    validator: (value: string) => {
      const words = value.trim().split(/\s+/);
      if (words.length < 12 || words.length > 24) {
        return 'Mnemonic must be 12-24 words';
      }
      if (words.length % 3 !== 0) {
        return 'Mnemonic word count must be divisible by 3';
      }
      return true;
    }
  },
  {
    name: SECRET_NAMES.POSTGRES_PASSWORD,
    required: true,
    minLength: 12,
    validator: (value: string) => {
      if (!/[A-Z]/.test(value)) return 'Password must contain uppercase letter';
      if (!/[a-z]/.test(value)) return 'Password must contain lowercase letter';
      if (!/[0-9]/.test(value)) return 'Password must contain number';
      if (!/[^A-Za-z0-9]/.test(value)) return 'Password must contain special character';
      return true;
    }
  },
  {
    name: SECRET_NAMES.ENCRYPTION_KEY,
    required: true,
    minLength: 32,
    pattern: /^[a-fA-F0-9]{64}$/, // 32 bytes as hex
    validator: (value: string) => {
      if (value.length !== 64) return 'Encryption key must be 32 bytes (64 hex characters)';
      return true;
    }
  }
];

/**
 * Multi-provider configuration for fallback scenarios
 */
export interface MultiProviderConfig {
  providers: {
    provider: SecretsProvider;
    config: SecretsConfig;
    priority: number; // Lower numbers = higher priority
    fallback: boolean; // Use as fallback if primary fails
  }[];
  
  // Strategy for handling multiple providers
  strategy: 'priority' | 'round_robin' | 'fastest_first';
  
  // Health check configuration
  healthCheckInterval?: number;
  failoverThreshold?: number; // Number of failures before failover
}

/**
 * Secret rotation configuration
 */
export interface SecretRotationConfig {
  enabled: boolean;
  secrets: {
    name: string;
    rotationInterval: number; // Days
    notificationThreshold: number; // Days before rotation
    autoRotate?: boolean;
    rotationFunction?: (oldSecret: string) => Promise<string>;
  }[];
  
  notifications?: {
    webhook?: string;
    email?: string[];
    slack?: string;
  };
}

/**
 * Audit logging for secrets access
 */
export interface SecretAuditEvent {
  timestamp: Date;
  secretName: string;
  operation: 'read' | 'write' | 'delete' | 'rotate';
  provider: SecretsProvider;
  success: boolean;
  error?: string;
  metadata?: {
    requestId?: string;
    userId?: string;
    source?: string;
    duration?: number;
  };
}
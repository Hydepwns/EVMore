/**
 * Secrets management utility functions for the 1inch Fusion+ Cosmos Relayer
 */

import { Logger } from 'pino';
import {
  SecretsConfig,
  SecretsProvider,
  MultiProviderConfig,
  SecretReference,
  SECRET_NAMES,
  SECRET_VALIDATION_RULES
} from './types';
import { SecretsManager } from './secrets-manager';

/**
 * Create a secrets manager with environment-based configuration
 */
export function createSecretsManager(logger: Logger): SecretsManager {
  const config = getSecretsConfigFromEnv();
  return new SecretsManager(config, logger);
}

/**
 * Get secrets configuration from environment variables
 */
export function getSecretsConfigFromEnv(): SecretsConfig | MultiProviderConfig {
  const provider = (process.env.SECRETS_PROVIDER || 'env') as SecretsProvider;
  
  // Check if multi-provider configuration is requested
  if (process.env.SECRETS_MULTI_PROVIDER === 'true') {
    return getMultiProviderConfigFromEnv();
  }

  const baseConfig = {
    provider,
    refreshInterval: parseInt(process.env.SECRETS_REFRESH_INTERVAL || '0'),
    cacheTimeout: parseInt(process.env.SECRETS_CACHE_TIMEOUT || '300000'), // 5 minutes
    retryAttempts: parseInt(process.env.SECRETS_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.SECRETS_RETRY_DELAY || '1000')
  };

  switch (provider) {
    case SecretsProvider.AWS_SECRETS_MANAGER:
      return {
        ...baseConfig,
        aws: {
          region: process.env.AWS_REGION || 'us-west-2',
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN,
          endpoint: process.env.AWS_SECRETS_MANAGER_ENDPOINT,
          versionStage: process.env.AWS_SECRETS_VERSION_STAGE || 'AWSCURRENT'
        }
      };

    case SecretsProvider.HASHICORP_VAULT:
      return {
        ...baseConfig,
        vault: {
          endpoint: process.env.VAULT_ENDPOINT || 'http://localhost:8200',
          token: process.env.VAULT_TOKEN,
          roleId: process.env.VAULT_ROLE_ID,
          secretId: process.env.VAULT_SECRET_ID,
          namespace: process.env.VAULT_NAMESPACE,
          mountPath: process.env.VAULT_MOUNT_PATH || 'secret',
          version: (process.env.VAULT_KV_VERSION as 'v1' | 'v2') || 'v2',
          tlsOptions: {
            ca: process.env.VAULT_CA_CERT,
            cert: process.env.VAULT_CLIENT_CERT,
            key: process.env.VAULT_CLIENT_KEY,
            skipVerify: process.env.VAULT_SKIP_VERIFY === 'true'
          }
        }
      };

    case SecretsProvider.ONEPASSWORD:
      return {
        ...baseConfig,
        onePassword: {
          endpoint: process.env.ONEPASSWORD_CONNECT_HOST,
          token: process.env.ONEPASSWORD_CONNECT_TOKEN,
          vault: process.env.ONEPASSWORD_VAULT || 'Private',
          cliPath: process.env.ONEPASSWORD_CLI_PATH || 'op',
          account: process.env.ONEPASSWORD_ACCOUNT,
          timeout: parseInt(process.env.ONEPASSWORD_TIMEOUT || '30000'),
          useConnect: process.env.ONEPASSWORD_USE_CONNECT === 'true',
          retryAttempts: parseInt(process.env.ONEPASSWORD_RETRY_ATTEMPTS || '3'),
          retryDelay: parseInt(process.env.ONEPASSWORD_RETRY_DELAY || '1000')
        }
      };

    case SecretsProvider.ENVIRONMENT:
    default:
      return {
        ...baseConfig,
        provider: SecretsProvider.ENVIRONMENT,
        env: {
          prefix: process.env.SECRETS_ENV_PREFIX || 'FUSION_',
          transform: getEnvTransformFunction()
        }
      };
  }
}

/**
 * Get multi-provider configuration from environment
 */
function getMultiProviderConfigFromEnv(): MultiProviderConfig {
  const providers: MultiProviderConfig['providers'] = [];

  // AWS as primary (priority 1)
  if (process.env.AWS_REGION) {
    providers.push({
      provider: SecretsProvider.AWS_SECRETS_MANAGER,
      priority: 1,
      fallback: false,
      config: {
        provider: SecretsProvider.AWS_SECRETS_MANAGER,
        aws: {
          region: process.env.AWS_REGION,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN,
          endpoint: process.env.AWS_SECRETS_MANAGER_ENDPOINT,
          versionStage: process.env.AWS_SECRETS_VERSION_STAGE || 'AWSCURRENT'
        }
      }
    });
  }

  // Vault as secondary (priority 2)
  if (process.env.VAULT_ENDPOINT) {
    providers.push({
      provider: SecretsProvider.HASHICORP_VAULT,
      priority: 2,
      fallback: true,
      config: {
        provider: SecretsProvider.HASHICORP_VAULT,
        vault: {
          endpoint: process.env.VAULT_ENDPOINT,
          token: process.env.VAULT_TOKEN,
          roleId: process.env.VAULT_ROLE_ID,
          secretId: process.env.VAULT_SECRET_ID,
          namespace: process.env.VAULT_NAMESPACE,
          mountPath: process.env.VAULT_MOUNT_PATH || 'secret',
          version: (process.env.VAULT_KV_VERSION as 'v1' | 'v2') || 'v2',
          tlsOptions: {
            ca: process.env.VAULT_CA_CERT,
            cert: process.env.VAULT_CLIENT_CERT,
            key: process.env.VAULT_CLIENT_KEY,
            skipVerify: process.env.VAULT_SKIP_VERIFY === 'true'
          }
        }
      }
    });
  }

  // Environment as fallback (priority 3)
  providers.push({
    provider: SecretsProvider.ENVIRONMENT,
    priority: 3,
    fallback: true,
    config: {
      provider: SecretsProvider.ENVIRONMENT,
      env: {
        prefix: process.env.SECRETS_ENV_PREFIX || 'FUSION_',
        transform: getEnvTransformFunction()
      }
    }
  });

  return {
    providers,
    strategy: 'priority',
    healthCheckInterval: parseInt(process.env.SECRETS_HEALTH_CHECK_INTERVAL || '60000'),
    failoverThreshold: parseInt(process.env.SECRETS_FAILOVER_THRESHOLD || '3')
  };
}

/**
 * Get environment variable transformation function
 */
function getEnvTransformFunction(): ((key: string) => string) | undefined {
  const transformType = process.env.SECRETS_ENV_TRANSFORM;
  
  switch (transformType) {
    case 'uppercase':
      return (key: string) => key.toUpperCase().replace(/-/g, '_');
    
    case 'prefix_only':
      return (key: string) => `${process.env.SECRETS_ENV_PREFIX || 'FUSION_'}${key}`;
    
    case 'custom':
      // Custom transformation - would need to be implemented based on requirements
      return undefined;
    
    default:
      return undefined; // Use default transformation
  }
}

/**
 * Get default secrets configuration for development
 */
export function getDefaultSecretsConfig(): SecretsConfig {
  return {
    provider: SecretsProvider.ENVIRONMENT,
    refreshInterval: 0, // No auto-refresh for development
    cacheTimeout: 60000, // 1 minute cache
    retryAttempts: 1,
    retryDelay: 1000,
    env: {
      prefix: 'FUSION_DEV_',
      transform: (key: string) => `FUSION_DEV_${key.toUpperCase().replace(/-/g, '_')}`
    }
  };
}

/**
 * Validate secrets configuration
 */
export function validateSecretsConfig(config: SecretsConfig | MultiProviderConfig): string[] {
  const errors: string[] = [];

  if ('provider' in config) {
    // Single provider validation
    return validateSingleProviderConfig(config);
  } else {
    // Multi-provider validation
    if (!config.providers || config.providers.length === 0) {
      errors.push('Multi-provider configuration must have at least one provider');
    }

    for (const providerConfig of config.providers) {
      const providerErrors = validateSingleProviderConfig(providerConfig.config);
      errors.push(...providerErrors.map(err => `Provider ${providerConfig.provider}: ${err}`));
    }

    if (!['priority', 'round_robin', 'fastest_first'].includes(config.strategy)) {
      errors.push('Invalid multi-provider strategy');
    }
  }

  return errors;
}

/**
 * Validate single provider configuration
 */
function validateSingleProviderConfig(config: SecretsConfig): string[] {
  const errors: string[] = [];

  if (!Object.values(SecretsProvider).includes(config.provider)) {
    errors.push(`Invalid secrets provider: ${config.provider}`);
  }

  switch (config.provider) {
    case SecretsProvider.AWS_SECRETS_MANAGER:
      if (!config.aws) {
        errors.push('AWS configuration is required for AWS Secrets Manager');
      } else {
        if (!config.aws.region) errors.push('AWS region is required');
      }
      break;

    case SecretsProvider.HASHICORP_VAULT:
      if (!config.vault) {
        errors.push('Vault configuration is required for HashiCorp Vault');
      } else {
        if (!config.vault.endpoint) errors.push('Vault endpoint is required');
        if (!config.vault.token && (!config.vault.roleId || !config.vault.secretId)) {
          errors.push('Vault requires either token or roleId/secretId for authentication');
        }
      }
      break;

    case SecretsProvider.ONEPASSWORD:
      if (!config.onePassword) {
        errors.push('1Password configuration is required for 1Password provider');
      } else {
        if (config.onePassword.useConnect) {
          if (!config.onePassword.endpoint) errors.push('1Password Connect endpoint is required when using Connect API');
          if (!config.onePassword.token) errors.push('1Password Connect token is required when using Connect API');
        }
        if (!config.onePassword.vault) errors.push('1Password vault is required');
      }
      break;

    case SecretsProvider.ENVIRONMENT:
      // Environment provider has no required configuration
      break;
  }

  if (config.refreshInterval !== undefined && config.refreshInterval < 0) {
    errors.push('Refresh interval must be non-negative');
  }

  if (config.cacheTimeout !== undefined && config.cacheTimeout < 0) {
    errors.push('Cache timeout must be non-negative');
  }

  if (config.retryAttempts !== undefined && config.retryAttempts < 0) {
    errors.push('Retry attempts must be non-negative');
  }

  if (config.retryDelay !== undefined && config.retryDelay < 0) {
    errors.push('Retry delay must be non-negative');
  }

  return errors;
}

/**
 * Create standard secret references for the relayer
 */
export function createRelayerSecretReferences(): SecretReference[] {
  return [
    {
      name: SECRET_NAMES.ETHEREUM_PRIVATE_KEY,
      required: true,
      description: 'Ethereum private key for signing transactions'
    },
    {
      name: SECRET_NAMES.COSMOS_MNEMONIC,
      required: true,
      description: 'Cosmos mnemonic for wallet generation'
    },
    {
      name: SECRET_NAMES.OSMOSIS_MNEMONIC,
      required: true,
      description: 'Osmosis mnemonic for wallet generation'
    },
    {
      name: SECRET_NAMES.POSTGRES_PASSWORD,
      required: true,
      description: 'PostgreSQL database password'
    },
    {
      name: SECRET_NAMES.REDIS_PASSWORD,
      required: false,
      description: 'Redis password (optional)'
    },
    {
      name: SECRET_NAMES.ETHEREUM_RPC_API_KEY,
      required: false,
      description: 'Ethereum RPC API key (e.g., Infura, Alchemy)'
    },
    {
      name: SECRET_NAMES.METRICS_AUTH_TOKEN,
      required: false,
      description: 'Authentication token for metrics endpoints'
    },
    {
      name: SECRET_NAMES.ADMIN_API_TOKEN,
      required: false,
      description: 'Authentication token for admin API endpoints'
    },
    {
      name: SECRET_NAMES.ENCRYPTION_KEY,
      required: true,
      description: 'Key for encrypting sensitive data'
    },
    {
      name: SECRET_NAMES.JWT_SECRET,
      required: false,
      description: 'Secret for JWT token signing'
    },
    {
      name: SECRET_NAMES.WEBHOOK_SECRET,
      required: false,
      description: 'Secret for webhook signature verification'
    }
  ];
}

// Re-export crypto functions from @evmore/utils to avoid duplication
export {
  generateSecret as generateSecureSecret,
  generateEthereumPrivateKey,
  maskSecret
} from '@evmore/utils';

/**
 * Validate secret strength
 */
export function validateSecretStrength(secret: string): {
  score: number; // 0-100
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // Length check
  if (secret.length >= 32) {
    score += 25;
  } else if (secret.length >= 16) {
    score += 15;
  } else if (secret.length >= 8) {
    score += 10;
  } else {
    issues.push('Secret is too short');
    recommendations.push('Use at least 16 characters, preferably 32 or more');
  }

  // Character diversity
  const hasLower = /[a-z]/.test(secret);
  const hasUpper = /[A-Z]/.test(secret);
  const hasDigits = /[0-9]/.test(secret);
  const hasSpecial = /[^A-Za-z0-9]/.test(secret);
  
  const diversity = [hasLower, hasUpper, hasDigits, hasSpecial].filter(Boolean).length;
  score += diversity * 15;

  if (diversity < 3) {
    issues.push('Limited character diversity');
    recommendations.push('Include uppercase, lowercase, numbers, and special characters');
  }

  // Entropy check (simplified)
  const uniqueChars = new Set(secret).size;
  const entropyRatio = uniqueChars / secret.length;
  
  if (entropyRatio > 0.8) {
    score += 20;
  } else if (entropyRatio > 0.6) {
    score += 15;
  } else if (entropyRatio > 0.4) {
    score += 10;
  } else {
    issues.push('Low entropy (too many repeated characters)');
    recommendations.push('Avoid repeating characters or patterns');
  }

  // Pattern detection (simplified)
  const commonPatterns = [
    /123/, /abc/, /qwerty/, /password/, /admin/, /test/,
    /(.)\1{2,}/, // Repeated characters
    /(01|10|12|21|23|32){3,}/ // Sequential patterns
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(secret.toLowerCase())) {
      issues.push('Contains common patterns or sequences');
      recommendations.push('Avoid dictionary words, keyboard patterns, and sequences');
      score -= 10;
      break;
    }
  }

  // Ensure score is within bounds
  score = Math.max(0, Math.min(100, score));

  return { score, issues, recommendations };
}

/**
 * Environment variable name mapping for common secrets
 */
export const ENV_VAR_MAPPING: Record<string, string> = {
  [SECRET_NAMES.ETHEREUM_PRIVATE_KEY]: 'ETHEREUM_PRIVATE_KEY',
  [SECRET_NAMES.COSMOS_MNEMONIC]: 'COSMOS_MNEMONIC',
  [SECRET_NAMES.OSMOSIS_MNEMONIC]: 'OSMOSIS_MNEMONIC',
  [SECRET_NAMES.POSTGRES_PASSWORD]: 'POSTGRES_PASSWORD',
  [SECRET_NAMES.REDIS_PASSWORD]: 'REDIS_PASSWORD',
  [SECRET_NAMES.ETHEREUM_RPC_API_KEY]: 'ETHEREUM_RPC_API_KEY',
  [SECRET_NAMES.METRICS_AUTH_TOKEN]: 'METRICS_AUTH_TOKEN',
  [SECRET_NAMES.ADMIN_API_TOKEN]: 'ADMIN_API_TOKEN',
  [SECRET_NAMES.ENCRYPTION_KEY]: 'ENCRYPTION_KEY',
  [SECRET_NAMES.JWT_SECRET]: 'JWT_SECRET',
  [SECRET_NAMES.WEBHOOK_SECRET]: 'WEBHOOK_SECRET'
};

/**
 * Check if all required secrets are available in environment
 */
export function checkRequiredEnvironmentSecrets(): {
  allPresent: boolean;
  missing: string[];
  present: string[];
} {
  const required = SECRET_VALIDATION_RULES
    .filter(rule => rule.required)
    .map(rule => rule.name);

  const missing: string[] = [];
  const present: string[] = [];

  for (const secretName of required) {
    const envVar = ENV_VAR_MAPPING[secretName] || secretName.toUpperCase().replace(/-/g, '_');
    
    if (process.env[envVar]) {
      present.push(secretName);
    } else {
      missing.push(secretName);
    }
  }

  return {
    allPresent: missing.length === 0,
    missing,
    present
  };
}

/**
 * Create a secrets health check function
 */
export function createSecretsHealthCheck(secretsManager: SecretsManager) {
  return async (): Promise<{
    healthy: boolean;
    providers: Record<string, { healthy: boolean; stats: any }>;
    lastCheck: Date;
  }> => {
    const healthStatus = secretsManager.getHealthStatus();
    const stats = secretsManager.getStats();
    
    const providers: Record<string, { healthy: boolean; stats: any }> = {};
    
    for (const [providerName, providerHealth] of Object.entries(healthStatus.providers)) {
      providers[providerName] = {
        healthy: providerHealth.healthy,
        stats: stats[providerName] || {}
      };
    }

    return {
      healthy: healthStatus.healthy,
      providers,
      lastCheck: new Date()
    };
  };
}
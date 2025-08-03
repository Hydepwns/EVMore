# @evmore/config

Configuration management with environment-specific settings and validation.

## Overview

The `@evmore/config` package provides a robust configuration management system for the EVMore protocol, supporting environment-specific settings, schema validation, secret management, and hot reloading capabilities.

## Core Features

- Environment-specific configuration
- Schema validation with Zod
- Secret management with Vault/AWS Secrets Manager
- Hot reloading for development
- Type-safe configuration access
- Default value management

## Configuration Structure

```typescript
interface EVMoreConfig {
  // Environment settings
  environment: 'development' | 'staging' | 'production';
  
  // Database configuration
  database: DatabaseConfig;
  
  // Blockchain connections
  chains: ChainConfig[];
  
  // HTLC settings
  htlc: HTLCConfig;
  
  // IBC settings
  ibc: IBCConfig;
  
  // DEX settings
  dex: DEXConfig;
  
  // Monitoring
  monitoring: MonitoringConfig;
  
  // Security
  security: SecurityConfig;
}

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  pool: {
    min: number;
    max: number;
    idleTimeout: number;
  };
}

interface ChainConfig {
  id: string;
  name: string;
  rpcUrl: string;
  chainId: number;
  nativeToken: string;
  blockTime: number;
  confirmations: number;
  gasPrice: string;
  gasLimit: number;
  htlcContract: string;
}

interface HTLCConfig {
  defaultTimelock: number;
  maxTimelock: number;
  minAmount: string;
  maxAmount: string;
  gasLimit: number;
  confirmations: number;
}

interface IBCConfig {
  defaultTimeout: number;
  maxRetries: number;
  retryDelay: number;
  channels: ChannelConfig[];
}

interface DEXConfig {
  defaultSlippage: number;
  maxSlippage: number;
  gasLimit: number;
  pools: PoolConfig[];
}

interface MonitoringConfig {
  metrics: {
    enabled: boolean;
    port: number;
    path: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
    destination: 'console' | 'file' | 'syslog';
  };
  tracing: {
    enabled: boolean;
    endpoint: string;
    sampleRate: number;
  };
}

interface SecurityConfig {
  secrets: {
    provider: 'vault' | 'aws' | 'env';
    vaultUrl?: string;
    awsRegion?: string;
  };
  rateLimiting: {
    enabled: boolean;
    maxRequests: number;
    windowMs: number;
  };
  cors: {
    origin: string[];
    credentials: boolean;
  };
}
```

## Configuration Schema

```typescript
import { z } from 'zod';

const DatabaseConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  ssl: z.boolean(),
  pool: z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
    idleTimeout: z.number().int().positive()
  })
});

const ChainConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rpcUrl: z.string().url(),
  chainId: z.number().int().positive(),
  nativeToken: z.string().min(1),
  blockTime: z.number().int().positive(),
  confirmations: z.number().int().min(1),
  gasPrice: z.string().min(1),
  gasLimit: z.number().int().positive(),
  htlcContract: z.string().min(1)
});

const EVMoreConfigSchema = z.object({
  environment: z.enum(['development', 'staging', 'production']),
  database: DatabaseConfigSchema,
  chains: z.array(ChainConfigSchema).min(1),
  htlc: z.object({
    defaultTimelock: z.number().int().positive(),
    maxTimelock: z.number().int().positive(),
    minAmount: z.string().min(1),
    maxAmount: z.string().min(1),
    gasLimit: z.number().int().positive(),
    confirmations: z.number().int().min(1)
  }),
  ibc: z.object({
    defaultTimeout: z.number().int().positive(),
    maxRetries: z.number().int().min(0),
    retryDelay: z.number().int().positive(),
    channels: z.array(z.object({
      id: z.string().min(1),
      sourceChain: z.string().min(1),
      destinationChain: z.string().min(1),
      sourcePort: z.string().min(1),
      sourceChannel: z.string().min(1),
      destinationPort: z.string().min(1),
      destinationChannel: z.string().min(1)
    }))
  }),
  dex: z.object({
    defaultSlippage: z.number().min(0).max(100),
    maxSlippage: z.number().min(0).max(100),
    gasLimit: z.number().int().positive(),
    pools: z.array(z.object({
      id: z.string().min(1),
      chainId: z.string().min(1),
      token0: z.string().min(1),
      token1: z.string().min(1),
      fee: z.string().min(1)
    }))
  }),
  monitoring: z.object({
    metrics: z.object({
      enabled: z.boolean(),
      port: z.number().int().positive(),
      path: z.string().min(1)
    }),
    logging: z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']),
      format: z.enum(['json', 'text']),
      destination: z.enum(['console', 'file', 'syslog'])
    }),
    tracing: z.object({
      enabled: z.boolean(),
      endpoint: z.string().url().optional(),
      sampleRate: z.number().min(0).max(1)
    })
  }),
  security: z.object({
    secrets: z.object({
      provider: z.enum(['vault', 'aws', 'env']),
      vaultUrl: z.string().url().optional(),
      awsRegion: z.string().min(1).optional()
    }),
    rateLimiting: z.object({
      enabled: z.boolean(),
      maxRequests: z.number().int().positive(),
      windowMs: z.number().int().positive()
    }),
    cors: z.object({
      origin: z.array(z.string()),
      credentials: z.boolean()
    })
  })
});
```

## Configuration Manager

```typescript
class ConfigurationManager {
  private config: EVMoreConfig;
  private schema: z.ZodSchema<EVMoreConfig>;
  private watchers: Map<string, (config: EVMoreConfig) => void> = new Map();

  constructor(schema: z.ZodSchema<EVMoreConfig>) {
    this.schema = schema;
  }

  async load(): Promise<EVMoreConfig> {
    // Load from environment variables
    const envConfig = this.loadFromEnvironment();
    
    // Load from config files
    const fileConfig = await this.loadFromFiles();
    
    // Merge configurations
    const mergedConfig = this.mergeConfigurations(envConfig, fileConfig);
    
    // Validate configuration
    const validatedConfig = this.validate(mergedConfig);
    
    // Load secrets
    const configWithSecrets = await this.loadSecrets(validatedConfig);
    
    this.config = configWithSecrets;
    return this.config;
  }

  private loadFromEnvironment(): Partial<EVMoreConfig> {
    return {
      environment: process.env.NODE_ENV as any || 'development',
      database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'evmore',
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL === 'true',
        pool: {
          min: parseInt(process.env.DB_POOL_MIN || '2'),
          max: parseInt(process.env.DB_POOL_MAX || '10'),
          idleTimeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000')
        }
      }
    };
  }

  private async loadFromFiles(): Promise<Partial<EVMoreConfig>> {
    const configPath = process.env.CONFIG_PATH || './config';
    const environment = process.env.NODE_ENV || 'development';
    
    try {
      // Load base config
      const baseConfig = await this.loadConfigFile(`${configPath}/base.json`);
      
      // Load environment-specific config
      const envConfig = await this.loadConfigFile(`${configPath}/${environment}.json`);
      
      // Load local overrides
      const localConfig = await this.loadConfigFile(`${configPath}/local.json`).catch(() => ({}));
      
      return { ...baseConfig, ...envConfig, ...localConfig };
    } catch (error) {
      console.warn('Failed to load config files:', error);
      return {};
    }
  }

  private async loadConfigFile(path: string): Promise<any> {
    const fs = await import('fs/promises');
    const content = await fs.readFile(path, 'utf-8');
    return JSON.parse(content);
  }

  private mergeConfigurations(env: Partial<EVMoreConfig>, file: Partial<EVMoreConfig>): Partial<EVMoreConfig> {
    // Deep merge configurations with environment taking precedence
    return { ...file, ...env };
  }

  private validate(config: Partial<EVMoreConfig>): EVMoreConfig {
    try {
      return this.schema.parse(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('Configuration validation failed:');
        error.errors.forEach(err => {
          console.error(`  ${err.path.join('.')}: ${err.message}`);
        });
      }
      throw new Error('Invalid configuration');
    }
  }

  private async loadSecrets(config: EVMoreConfig): Promise<EVMoreConfig> {
    if (config.security.secrets.provider === 'vault') {
      return this.loadSecretsFromVault(config);
    } else if (config.security.secrets.provider === 'aws') {
      return this.loadSecretsFromAWS(config);
    }
    
    return config;
  }

  private async loadSecretsFromVault(config: EVMoreConfig): Promise<EVMoreConfig> {
    // Implementation for Vault secret loading
    const { Client } = await import('node-vault');
    const vault = new Client({
      apiVersion: 'v1',
      endpoint: config.security.secrets.vaultUrl
    });

    try {
      // Load database password
      const dbSecret = await vault.read('secret/evmore/database');
      config.database.password = dbSecret.data.password;
      
      // Load other secrets as needed
      return config;
    } catch (error) {
      console.error('Failed to load secrets from Vault:', error);
      throw error;
    }
  }

  private async loadSecretsFromAWS(config: EVMoreConfig): Promise<EVMoreConfig> {
    // Implementation for AWS Secrets Manager
    const { SecretsManager } = await import('@aws-sdk/client-secrets-manager');
    const client = new SecretsManager({ region: config.security.secrets.awsRegion });

    try {
      const secret = await client.getSecretValue({ SecretId: 'evmore/database' });
      const secretData = JSON.parse(secret.SecretString || '{}');
      
      config.database.password = secretData.password;
      return config;
    } catch (error) {
      console.error('Failed to load secrets from AWS:', error);
      throw error;
    }
  }

  get<K extends keyof EVMoreConfig>(key: K): EVMoreConfig[K] {
    return this.config[key];
  }

  getChain(chainId: string): ChainConfig | undefined {
    return this.config.chains.find(chain => chain.id === chainId);
  }

  getChannel(sourceChain: string, destinationChain: string): ChannelConfig | undefined {
    return this.config.ibc.channels.find(
      channel => channel.sourceChain === sourceChain && channel.destinationChain === destinationChain
    );
  }

  watch<K extends keyof EVMoreConfig>(
    key: K,
    callback: (value: EVMoreConfig[K]) => void
  ): () => void {
    const watcherKey = key as string;
    this.watchers.set(watcherKey, callback as any);
    
    return () => {
      this.watchers.delete(watcherKey);
    };
  }

  async reload(): Promise<void> {
    const newConfig = await this.load();
    
    // Notify watchers of changes
    for (const [key, callback] of this.watchers) {
      const configKey = key as keyof EVMoreConfig;
      if (JSON.stringify(this.config[configKey]) !== JSON.stringify(newConfig[configKey])) {
        callback(newConfig);
      }
    }
    
    this.config = newConfig;
  }
}
```

## Usage Examples

```typescript
import { ConfigurationManager, EVMoreConfigSchema } from '@evmore/config';

// Initialize configuration manager
const configManager = new ConfigurationManager(EVMoreConfigSchema);

// Load configuration
const config = await configManager.load();

// Access configuration values
const dbConfig = configManager.get('database');
const ethereumChain = configManager.getChain('ethereum');
const osmosisChannel = configManager.getChannel('cosmoshub', 'osmosis');

// Watch for configuration changes
const unsubscribe = configManager.watch('monitoring', (monitoringConfig) => {
  console.log('Monitoring configuration changed:', monitoringConfig);
});

// Reload configuration (useful for development)
await configManager.reload();
```

## Configuration Files

### base.json
```json
{
  "htlc": {
    "defaultTimelock": 3600,
    "maxTimelock": 7200,
    "minAmount": "0.001",
    "maxAmount": "1000000",
    "gasLimit": 300000,
    "confirmations": 2
  },
  "ibc": {
    "defaultTimeout": 300,
    "maxRetries": 3,
    "retryDelay": 5000
  },
  "dex": {
    "defaultSlippage": 0.5,
    "maxSlippage": 5.0,
    "gasLimit": 500000
  },
  "monitoring": {
    "metrics": {
      "enabled": true,
      "port": 9090,
      "path": "/metrics"
    },
    "logging": {
      "level": "info",
      "format": "json",
      "destination": "console"
    },
    "tracing": {
      "enabled": false,
      "sampleRate": 0.1
    }
  },
  "security": {
    "secrets": {
      "provider": "env"
    },
    "rateLimiting": {
      "enabled": true,
      "maxRequests": 100,
      "windowMs": 60000
    },
    "cors": {
      "origin": ["http://localhost:3000"],
      "credentials": true
    }
  }
}
```

### development.json
```json
{
  "environment": "development",
  "database": {
    "host": "localhost",
    "port": 5432,
    "database": "evmore_dev",
    "username": "postgres",
    "password": "password",
    "ssl": false
  },
  "chains": [
    {
      "id": "ethereum",
      "name": "Ethereum Local",
      "rpcUrl": "http://localhost:8545",
      "chainId": 1337,
      "nativeToken": "ETH",
      "blockTime": 12,
      "confirmations": 1,
      "gasPrice": "20000000000",
      "gasLimit": 300000,
      "htlcContract": "0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a"
    }
  ],
  "monitoring": {
    "logging": {
      "level": "debug"
    },
    "tracing": {
      "enabled": true
    }
  }
}
```

## Installation

```bash
npm install @evmore/config
```

## Development

```bash
# Build config
npm run build

# Run tests
npm test

# Generate documentation
npm run docs
```

## Contributing

When adding new configuration options:

1. Update the configuration interface
2. Add validation schema
3. Update default values
4. Add environment variable support
5. Update documentation
6. Add tests 
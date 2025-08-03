/**
 * Configuration Migration Utilities
 * Helps migrate existing configurations to use centralized interfaces
 */

import {
  EthereumNetworkConfig,
  CosmosNetworkConfig
} from './common-interfaces';
import {
  parseAppConfigFromEnv,
  UnifiedAppConfig
} from './config-adapters';

/**
 * Migration utility for projects using different config interfaces
 */
export class ConfigMigration {
  
  /**
   * Migrate SDK Ethereum client configuration
   */
  static migrateSDKEthereumConfig(oldConfig: {
    rpcUrl: string;
    htlcContract: string;
    resolverContract?: string;
    privateKey?: string;
    chainId: number;
  }): EthereumNetworkConfig {
    return {
      chainId: oldConfig.chainId,
      rpcUrl: oldConfig.rpcUrl,
      htlcContract: oldConfig.htlcContract,
      resolverContract: oldConfig.resolverContract,
      privateKey: oldConfig.privateKey
    };
  }

  /**
   * Migrate SDK Cosmos client configuration
   */
  static migrateSDKCosmosConfig(oldConfig: {
    rpcUrl: string;
    restUrl: string;
    chainId: string;
    htlcContract: string;
    mnemonic?: string;
    addressPrefix: string;
    denom: string;
  }): CosmosNetworkConfig {
    return {
      chainId: oldConfig.chainId,
      rpcUrl: oldConfig.rpcUrl,
      restUrl: oldConfig.restUrl,
      htlcContract: oldConfig.htlcContract,
      mnemonic: oldConfig.mnemonic,
      addressPrefix: oldConfig.addressPrefix,
      denom: oldConfig.denom,
      gasConfig: {
        gasPrice: '0.025' + oldConfig.denom,
        gasLimit: 200000
      }
    };
  }

  /**
   * Migrate relayer configuration
   */
  static migrateRelayerConfig(oldConfig: {
    ethereum: {
      rpcUrl: string;
      htlcContractAddress: string;
      resolverContractAddress: string;
      privateKey: string;
      chainId: number;
      confirmations: number;
      gasLimit: number;
      gasPrice?: string;
    };
    cosmos: {
      rpcUrl: string;
      restUrl: string;
      chainId: string;
      htlcContractAddress: string;
      mnemonic: string;
      gasPrice: string;
      gasLimit: number;
      denom: string;
      addressPrefix: string;
    };
  }): { ethereum: EthereumNetworkConfig; cosmos: CosmosNetworkConfig } {
    return {
      ethereum: {
        chainId: oldConfig.ethereum.chainId,
        rpcUrl: oldConfig.ethereum.rpcUrl,
        htlcContract: oldConfig.ethereum.htlcContractAddress,
        resolverContract: oldConfig.ethereum.resolverContractAddress,
        privateKey: oldConfig.ethereum.privateKey,
        confirmations: oldConfig.ethereum.confirmations,
        gasConfig: {
          gasPrice: oldConfig.ethereum.gasPrice,
          gasLimit: oldConfig.ethereum.gasLimit
        }
      },
      cosmos: {
        chainId: oldConfig.cosmos.chainId,
        rpcUrl: oldConfig.cosmos.rpcUrl,
        restUrl: oldConfig.cosmos.restUrl,
        htlcContract: oldConfig.cosmos.htlcContractAddress,
        mnemonic: oldConfig.cosmos.mnemonic,
        addressPrefix: oldConfig.cosmos.addressPrefix,
        denom: oldConfig.cosmos.denom,
        gasConfig: {
          gasPrice: oldConfig.cosmos.gasPrice,
          gasLimit: oldConfig.cosmos.gasLimit
        }
      }
    };
  }

  /**
   * Migrate connection pool configuration
   */
  static migratePoolConfig(oldConfig: {
    ethereum?: {
      [networkName: string]: {
        name: string;
        endpoints: Array<{ url: string; weight?: number }>;
        maxConnections: number;
        minConnections: number;
        connectionTimeout: number;
        idleTimeout: number;
        chainId?: number;
      };
    };
    cosmos?: {
      [chainId: string]: {
        name: string;
        endpoints: Array<{ url: string; weight?: number }>;
        maxConnections: number;
        minConnections: number;
        connectionTimeout: number;
        idleTimeout: number;
        chainId: string;
        addressPrefix: string;
      };
    };
  }) {
    const result: {
      ethereum?: any;
      cosmos?: any;
    } = {};

    if (oldConfig.ethereum) {
      result.ethereum = {};
      for (const [networkName, config] of Object.entries(oldConfig.ethereum)) {
        result.ethereum[networkName] = {
          ...config,
          maxRetries: 3,
          healthCheckInterval: 30000,
          retryDelay: 1000,
          circuitBreakerThreshold: 5,
          circuitBreakerTimeout: 60000,
          endpoints: config.endpoints.map(endpoint => ({
            url: endpoint.url,
            weight: endpoint.weight || 1,
            maxConnections: Math.floor(config.maxConnections / config.endpoints.length),
            timeout: config.connectionTimeout,
            retryAttempts: 3,
            healthCheckInterval: 30000
          }))
        };
      }
    }

    if (oldConfig.cosmos) {
      result.cosmos = {};
      for (const [chainId, config] of Object.entries(oldConfig.cosmos)) {
        result.cosmos[chainId] = {
          ...config,
          maxRetries: 3,
          healthCheckInterval: 30000,
          retryDelay: 1000,
          circuitBreakerThreshold: 5,
          circuitBreakerTimeout: 60000,
          endpoints: config.endpoints.map(endpoint => ({
            url: endpoint.url,
            weight: endpoint.weight || 1,
            maxConnections: Math.floor(config.maxConnections / config.endpoints.length),
            timeout: config.connectionTimeout,
            retryAttempts: 3,
            healthCheckInterval: 30000
          }))
        };
      }
    }

    return result;
  }

  /**
   * Create backward-compatible configuration accessor
   */
  static createCompatibilityWrapper(unifiedConfig: UnifiedAppConfig) {
    return {
      // Legacy SDK Ethereum config
      getSDKEthereumConfig: () => ({
        rpcUrl: unifiedConfig.ethereum.rpcUrl,
        htlcContract: unifiedConfig.ethereum.htlcContract,
        resolverContract: unifiedConfig.ethereum.resolverContract,
        privateKey: unifiedConfig.ethereum.privateKey,
        chainId: unifiedConfig.ethereum.chainId
      }),

      // Legacy SDK Cosmos config
      getSDKCosmosConfig: () => ({
        rpcUrl: unifiedConfig.cosmos.rpcUrl,
        restUrl: unifiedConfig.cosmos.restUrl,
        chainId: unifiedConfig.cosmos.chainId,
        htlcContract: unifiedConfig.cosmos.htlcContract,
        mnemonic: unifiedConfig.cosmos.mnemonic,
        addressPrefix: unifiedConfig.cosmos.addressPrefix,
        denom: unifiedConfig.cosmos.denom
      }),

      // Legacy relayer config
      getRelayerConfig: () => ({
        general: unifiedConfig.general,
        ethereum: {
          rpcUrl: unifiedConfig.ethereum.rpcUrl,
          htlcContractAddress: unifiedConfig.ethereum.htlcContract,
          resolverContractAddress: unifiedConfig.ethereum.resolverContract || '',
          privateKey: unifiedConfig.ethereum.privateKey || '',
          chainId: unifiedConfig.ethereum.chainId,
          confirmations: unifiedConfig.ethereum.confirmations || 1,
          gasLimit: unifiedConfig.ethereum.gasConfig?.gasLimit || 500000,
          gasPrice: unifiedConfig.ethereum.gasConfig?.gasPrice
        },
        cosmos: {
          rpcUrl: unifiedConfig.cosmos.rpcUrl,
          restUrl: unifiedConfig.cosmos.restUrl,
          chainId: unifiedConfig.cosmos.chainId,
          htlcContractAddress: unifiedConfig.cosmos.htlcContract,
          mnemonic: unifiedConfig.cosmos.mnemonic || '',
          gasPrice: unifiedConfig.cosmos.gasConfig?.gasPrice || '0.025' + unifiedConfig.cosmos.denom,
          gasLimit: unifiedConfig.cosmos.gasConfig?.gasLimit || 200000,
          denom: unifiedConfig.cosmos.denom,
          addressPrefix: unifiedConfig.cosmos.addressPrefix
        },
        relay: unifiedConfig.relayer,
        recovery: unifiedConfig.recovery,
        chainRegistry: unifiedConfig.chainRegistry
      }),

      // Unified config access
      getUnifiedConfig: () => unifiedConfig
    };
  }

  /**
   * Auto-migrate from environment variables
   */
  static autoMigrateFromEnv() {
    const unifiedConfig = parseAppConfigFromEnv();
    return this.createCompatibilityWrapper(unifiedConfig);
  }

  /**
   * Generate migration guide for existing projects
   */
  static generateMigrationGuide(): string {
    return `
# Configuration Migration Guide

## Before (Duplicated Configs)

### SDK Ethereum Client
\`\`\`typescript
interface EthereumConfig {
  rpcUrl: string;
  htlcContract: string;
  resolverContract?: string;
  privateKey?: string;
  chainId: number;
}
\`\`\`

### SDK Cosmos Client
\`\`\`typescript
interface CosmosConfig {
  rpcUrl: string;
  restUrl: string;
  chainId: string;
  htlcContract: string;
  mnemonic?: string;
  addressPrefix: string;
  denom: string;
}
\`\`\`

### Relayer Config
\`\`\`typescript
interface EthereumConfig { ... } // Different from SDK!
interface CosmosConfig { ... }   // Different from SDK!
\`\`\`

## After (Centralized Configs)

### Import Centralized Interfaces
\`\`\`typescript
import { 
  EthereumNetworkConfig,
  CosmosNetworkConfig,
  parseAppConfigFromEnv,
  ConfigMigration
} from '@evmore/utils';
\`\`\`

### Migration Example
\`\`\`typescript
// Auto-migrate existing environment-based config
const compatWrapper = ConfigMigration.autoMigrateFromEnv();

// Use backward-compatible accessors
const ethConfig = compatWrapper.getSDKEthereumConfig();
const cosmosConfig = compatWrapper.getSDKCosmosConfig();
const relayerConfig = compatWrapper.getRelayerConfig();

// Or access unified config directly
const unifiedConfig = compatWrapper.getUnifiedConfig();
\`\`\`

### Manual Migration
\`\`\`typescript
// Migrate old SDK config
const oldEthConfig = { rpcUrl: '...', htlcContract: '...', chainId: 1 };
const newEthConfig = ConfigMigration.migrateSDKEthereumConfig(oldEthConfig);

// Migrate old Cosmos config  
const oldCosmosConfig = { rpcUrl: '...', restUrl: '...', chainId: 'osmosis-1' };
const newCosmosConfig = ConfigMigration.migrateSDKCosmosConfig(oldCosmosConfig);
\`\`\`

## Benefits

1. **Single Source of Truth**: One set of interfaces for all configurations
2. **Type Safety**: Consistent typing across all components
3. **Backward Compatibility**: Legacy code continues to work unchanged
4. **Environment Parsing**: Automatic parsing from environment variables
5. **Validation**: Built-in validation for all config types
6. **Future-Proof**: Easy to extend with new fields
`;
  }
}

/**
 * Helper function for quick migration
 */
export function quickMigrate() {
  return ConfigMigration.autoMigrateFromEnv();
}

/**
 * Type-safe configuration factory
 */
export class ConfigFactory {
  static createEthereumConfig(partial: Partial<EthereumNetworkConfig>): EthereumNetworkConfig {
    return {
      chainId: 1,
      rpcUrl: 'https://mainnet.infura.io/v3/YOUR_KEY',
      htlcContract: '',
      confirmations: 1,
      timeout: 30000,
      ...partial
    };
  }

  static createCosmosConfig(partial: Partial<CosmosNetworkConfig>): CosmosNetworkConfig {
    return {
      chainId: 'osmosis-1',
      rpcUrl: 'https://rpc.osmosis.zone',
      restUrl: 'https://lcd.osmosis.zone',
      htlcContract: '',
      addressPrefix: 'osmo',
      denom: 'uosmo',
      confirmations: 1,
      timeout: 30000,
      gasConfig: {
        gasPrice: '0.025uosmo',
        gasLimit: 200000
      },
      ...partial
    };
  }
}
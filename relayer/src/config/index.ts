// Import centralized configuration interfaces
import { LogLevel } from '@evmore/interfaces';
import {
  EthereumNetworkConfig,
  CosmosNetworkConfig,
  ChainRegistryConfig,
  RelayerConfig,
  RecoveryConfig,
  GeneralConfig,
  toLegacyEthereumConfig,
  toLegacyCosmosConfig,
  adaptLegacyEthereumConfig,
  adaptLegacyCosmosConfig
} from '@evmore/utils';

// Legacy interfaces for backward compatibility
export interface EthereumConfig {
  rpcUrl: string;
  htlcContractAddress: string;
  resolverContractAddress: string;
  privateKey: string;
  chainId: number;
  confirmations: number;
  gasLimit: number;
  gasPrice?: string;
}

export interface CosmosConfig {
  rpcUrl: string;
  restUrl: string;
  chainId: string;
  htlcContractAddress: string;
  mnemonic: string;
  gasPrice: string;
  gasLimit: number;
  denom: string;
  addressPrefix: string;
}

// Re-export unified types
export type UnifiedEthereumConfig = EthereumNetworkConfig;
export type UnifiedCosmosConfig = CosmosNetworkConfig;
export type RelayConfig = RelayerConfig;

// Re-export imported types for external use
export { ChainRegistryConfig, RecoveryConfig, GeneralConfig };

export interface AppConfig {
  general: GeneralConfig;
  ethereum: EthereumConfig;
  cosmos: CosmosConfig & { chains?: CosmosConfig[] };
  chainRegistry: ChainRegistryConfig;
  relay: RelayerConfig;
  recovery: RecoveryConfig;
}

import { ConfigValidator } from './validator';
import { appConfigToFusionConfig, fusionConfigToAppConfig } from './config-adapter';

export class Config {
  static async load(): Promise<AppConfig> {
    const config: AppConfig = {
      general: {
        logLevel: process.env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG :
                  process.env.LOG_LEVEL === 'warn' ? LogLevel.WARN :
                  process.env.LOG_LEVEL === 'error' ? LogLevel.ERROR :
                  process.env.LOG_LEVEL === 'fatal' ? LogLevel.FATAL :
                  LogLevel.INFO,
        port: parseInt(process.env.PORT || '3000'),
        enableMetrics: process.env.ENABLE_METRICS === 'true',
        shutdownTimeout: parseInt(process.env.SHUTDOWN_TIMEOUT || '30000'),
      },
      ethereum: {
        rpcUrl: process.env.ETHEREUM_RPC_URL || 'http://localhost:8545',
        htlcContractAddress: process.env.ETHEREUM_HTLC_CONTRACT || '',
        resolverContractAddress: process.env.ETHEREUM_RESOLVER_CONTRACT || '',
        privateKey: process.env.ETHEREUM_PRIVATE_KEY || '',
        chainId: parseInt(process.env.ETHEREUM_CHAIN_ID || '1337'),
        confirmations: parseInt(process.env.ETHEREUM_CONFIRMATIONS || '1'),
        gasLimit: parseInt(process.env.ETHEREUM_GAS_LIMIT || '500000'),
        gasPrice: process.env.ETHEREUM_GAS_PRICE,
      },
      cosmos: {
        rpcUrl: process.env.COSMOS_RPC_URL || 'http://localhost:26657',
        restUrl: process.env.COSMOS_REST_URL || 'http://localhost:1317',
        chainId: process.env.COSMOS_CHAIN_ID || 'testing',
        htlcContractAddress: process.env.COSMOS_HTLC_CONTRACT || '',
        mnemonic: process.env.COSMOS_MNEMONIC || '',
        gasPrice: process.env.COSMOS_GAS_PRICE || '0.025uosmo',
        gasLimit: parseInt(process.env.COSMOS_GAS_LIMIT || '200000'),
        denom: process.env.COSMOS_DENOM || 'uosmo',
        addressPrefix: process.env.COSMOS_ADDRESS_PREFIX || 'osmo',
      },
      chainRegistry: {
        baseUrl: process.env.CHAIN_REGISTRY_URL || 'https://registry.ping.pub',
        cacheTimeout: parseInt(process.env.CHAIN_REGISTRY_CACHE_TIMEOUT || '3600'),
        refreshInterval: parseInt(process.env.CHAIN_REGISTRY_REFRESH_INTERVAL || '300'),
      },
      relay: {
        maxRetries: parseInt(process.env.RELAY_MAX_RETRIES || '3'),
        retryDelay: parseInt(process.env.RELAY_RETRY_DELAY || '5000'),
        batchSize: parseInt(process.env.RELAY_BATCH_SIZE || '10'),
        processingInterval: parseInt(process.env.RELAY_PROCESSING_INTERVAL || '5000'),
        timeoutBuffer: parseInt(process.env.RELAY_TIMEOUT_BUFFER || '300'),
      },
      recovery: {
        enabled: process.env.RECOVERY_ENABLED !== 'false',
        checkInterval: parseInt(process.env.RECOVERY_CHECK_INTERVAL || '60000'),
        refundBuffer: parseInt(process.env.RECOVERY_REFUND_BUFFER || '7200'),
      },
    };

    // Validate required fields using the basic validation
    Config.validate(config);

    // Perform comprehensive validation
    const validator = new ConfigValidator();
    const validationResult = await validator.validate(config);

    if (!validationResult.valid) {
      const formattedResults = ConfigValidator.formatResults(validationResult);
      throw new Error(`Configuration validation failed:\n${formattedResults}`);
    }

    // Log warnings if any
    if (validationResult.warnings.length > 0) {
      console.warn(ConfigValidator.formatResults(validationResult));
    }

    return config;
  }

  private static validate(config: AppConfig): void {
    const errors: string[] = [];

    // Ethereum validation
    if (!config.ethereum.rpcUrl) {
      errors.push('ETHEREUM_RPC_URL is required');
    }
    if (!config.ethereum.htlcContractAddress) {
      errors.push('ETHEREUM_HTLC_CONTRACT is required');
    }
    if (!config.ethereum.privateKey) {
      errors.push('ETHEREUM_PRIVATE_KEY is required');
    }

    // Cosmos validation
    if (!config.cosmos.rpcUrl) {
      errors.push('COSMOS_RPC_URL is required');
    }
    if (!config.cosmos.restUrl) {
      errors.push('COSMOS_REST_URL is required');
    }
    if (!config.cosmos.htlcContractAddress) {
      errors.push('COSMOS_HTLC_CONTRACT is required');
    }
    if (!config.cosmos.mnemonic) {
      errors.push('COSMOS_MNEMONIC is required');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }
}

// Export validator for external use
export { ConfigValidator, ValidationError } from './validator';

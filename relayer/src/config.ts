// TODO: Fix these imports - shared directory doesn't exist
// import { loadConstants, ContractConstants } from '../../shared/config/constants';
// import { getTimelockConfig } from '../../shared/config/fusion-config';
import { LogLevel } from '@evmore/interfaces';

// Default constants to replace missing ContractConstants
const DEFAULT_CONSTANTS = {
  ETHEREUM_CONFIRMATIONS: 3,
  ETHEREUM_GAS_LIMIT: 300000,
  COSMOS_GAS_LIMIT: 200000,
  MIN_AMOUNT: '100', // 100 wei/uatom minimum
  MAX_AMOUNT: '1000000000000000000000', // 1000 ETH/ATOM maximum
  DEFAULT_GAS_PRICE: '20000000000', // 20 gwei
  IBC_TIMEOUT: 600, // 10 minutes
  TIMELOCK_BUFFER: 3600, // 1 hour
  CASCADE_TIMELOCK_ETHEREUM: 172800, // 48 hours
  CASCADE_TIMELOCK_COSMOS: 86400, // 24 hours
  MAX_RETRIES: 3,
  RETRY_DELAY: 5000, // 5 seconds
  DEFAULT_BATCH_SIZE: 10,
  PROCESSING_INTERVAL: 30000 // 30 seconds
};

// Simple getTimelockConfig replacement
function getTimelockConfig() {
  return {
    ethereum: DEFAULT_CONSTANTS.CASCADE_TIMELOCK_ETHEREUM,
    cosmos: DEFAULT_CONSTANTS.CASCADE_TIMELOCK_COSMOS,
    buffer: DEFAULT_CONSTANTS.TIMELOCK_BUFFER,
    cacheTimeout: 300, // 5 minutes
    timeoutBuffer: DEFAULT_CONSTANTS.TIMELOCK_BUFFER,
    recoveryBuffer: 7200 // 2 hours
  };
}

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

export interface ChainRegistryConfig {
  baseUrl: string;
  cacheTimeout: number; // seconds
  refreshInterval: number; // seconds
}

export interface RelayConfig {
  maxRetries: number;
  retryDelay: number; // milliseconds
  batchSize: number;
  processingInterval: number; // milliseconds
  timeoutBuffer: number; // seconds before timelock expires
}

export interface RecoveryConfig {
  enabled: boolean;
  checkInterval: number; // milliseconds
  refundBuffer: number; // seconds before timelock expires to attempt refund
}

export interface GeneralConfig {
  logLevel: LogLevel | string; // Allow string for env var, but prefer LogLevel
  port: number;
  enableMetrics: boolean;
  shutdownTimeout: number; // milliseconds
}

export interface AppConfig {
  general: GeneralConfig;
  ethereum: EthereumConfig;
  cosmos: CosmosConfig;
  chainRegistry: ChainRegistryConfig;
  relay: RelayConfig;
  recovery: RecoveryConfig;
}

export class Config {
  // TODO: Fix loadConstants
  // private static configConstants = loadConstants();
  
  static load(): AppConfig {
    const config: AppConfig = {
      general: {
        logLevel: process.env.LOG_LEVEL || 'info',
        port: parseInt(process.env.PORT || '3000'),
        enableMetrics: process.env.ENABLE_METRICS === 'true',
        shutdownTimeout: parseInt(process.env.SHUTDOWN_TIMEOUT || '30000')
      },
      ethereum: {
        rpcUrl: process.env.ETHEREUM_RPC_URL || 'http://localhost:8545',
        htlcContractAddress: process.env.ETHEREUM_HTLC_CONTRACT || '',
        resolverContractAddress: process.env.ETHEREUM_RESOLVER_CONTRACT || '',
        privateKey: process.env.ETHEREUM_PRIVATE_KEY || '',
        chainId: parseInt(process.env.ETHEREUM_CHAIN_ID || '1337'),
        confirmations: parseInt(process.env.ETHEREUM_CONFIRMATIONS || String(DEFAULT_CONSTANTS.ETHEREUM_CONFIRMATIONS)),
        gasLimit: parseInt(process.env.ETHEREUM_GAS_LIMIT || String(DEFAULT_CONSTANTS.ETHEREUM_GAS_LIMIT)),
        gasPrice: process.env.ETHEREUM_GAS_PRICE
      },
      cosmos: {
        rpcUrl: process.env.COSMOS_RPC_URL || 'http://localhost:26657',
        restUrl: process.env.COSMOS_REST_URL || 'http://localhost:1317',
        chainId: process.env.COSMOS_CHAIN_ID || 'testing',
        htlcContractAddress: process.env.COSMOS_HTLC_CONTRACT || '',
        mnemonic: process.env.COSMOS_MNEMONIC || '',
        gasPrice: process.env.COSMOS_GAS_PRICE || '0.025uosmo',
        gasLimit: parseInt(process.env.COSMOS_GAS_LIMIT || String(DEFAULT_CONSTANTS.COSMOS_GAS_LIMIT)),
        denom: process.env.COSMOS_DENOM || 'uosmo',
        addressPrefix: process.env.COSMOS_ADDRESS_PREFIX || 'osmo'
      },
      chainRegistry: {
        baseUrl: process.env.CHAIN_REGISTRY_URL || 'https://registry.ping.pub',
        cacheTimeout: parseInt(process.env.CHAIN_REGISTRY_CACHE_TIMEOUT || String(getTimelockConfig().cacheTimeout)),
        refreshInterval: parseInt(process.env.CHAIN_REGISTRY_REFRESH_INTERVAL || '300')
      },
      relay: {
        maxRetries: parseInt(process.env.RELAY_MAX_RETRIES || String(DEFAULT_CONSTANTS.MAX_RETRIES)),
        retryDelay: parseInt(process.env.RELAY_RETRY_DELAY || String(DEFAULT_CONSTANTS.RETRY_DELAY)),
        batchSize: parseInt(process.env.RELAY_BATCH_SIZE || String(DEFAULT_CONSTANTS.DEFAULT_BATCH_SIZE)),
        processingInterval: parseInt(process.env.RELAY_PROCESSING_INTERVAL || String(DEFAULT_CONSTANTS.PROCESSING_INTERVAL)),
        timeoutBuffer: parseInt(process.env.RELAY_TIMEOUT_BUFFER || String(getTimelockConfig().timeoutBuffer))
      },
      recovery: {
        enabled: process.env.RECOVERY_ENABLED !== 'false',
        checkInterval: parseInt(process.env.RECOVERY_CHECK_INTERVAL || '60000'),
        refundBuffer: parseInt(process.env.RECOVERY_REFUND_BUFFER || String(getTimelockConfig().recoveryBuffer))
      }
    };

    // Validate required fields
    Config.validate(config);

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

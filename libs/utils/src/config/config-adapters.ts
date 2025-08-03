/**
 * Configuration Adapters
 * Utilities to convert between different configuration formats
 */

import {
  EthereumNetworkConfig,
  CosmosNetworkConfig,
  LegacyEthereumConfig,
  LegacyCosmosConfig,
  RelayerConfig,
  RecoveryConfig,
  ChainRegistryConfig,
  GeneralConfig
} from './common-interfaces';
import { FusionConfig } from '@evmore/config';

/**
 * Convert legacy Ethereum config to unified format
 */
export function adaptLegacyEthereumConfig(legacy: LegacyEthereumConfig): EthereumNetworkConfig {
  return {
    chainId: legacy.chainId,
    rpcUrl: legacy.rpcUrl,
    htlcContract: legacy.htlcContract,
    resolverContract: legacy.resolverContract,
    privateKey: legacy.privateKey,
    gasConfig: {
      gasPrice: legacy.gasPrice,
      gasLimit: legacy.gasLimit
    }
  };
}

/**
 * Convert legacy Cosmos config to unified format
 */
export function adaptLegacyCosmosConfig(legacy: LegacyCosmosConfig): CosmosNetworkConfig {
  return {
    chainId: legacy.chainId,
    rpcUrl: legacy.rpcUrl,
    restUrl: legacy.restUrl,
    htlcContract: legacy.htlcContract,
    mnemonic: legacy.mnemonic,
    addressPrefix: legacy.addressPrefix,
    denom: legacy.denom,
    gasConfig: {
      gasPrice: legacy.gasPrice || '0.025' + legacy.denom,
      gasLimit: legacy.gasLimit || 200000
    }
  };
}

/**
 * Convert unified Ethereum config to legacy format for backward compatibility
 */
export function toLegacyEthereumConfig(unified: EthereumNetworkConfig): LegacyEthereumConfig {
  return {
    rpcUrl: unified.rpcUrl,
    htlcContract: unified.htlcContract,
    resolverContract: unified.resolverContract,
    privateKey: unified.privateKey,
    chainId: unified.chainId,
    gasPrice: unified.gasConfig?.gasPrice,
    gasLimit: unified.gasConfig?.gasLimit
  };
}

/**
 * Convert unified Cosmos config to legacy format for backward compatibility
 */
export function toLegacyCosmosConfig(unified: CosmosNetworkConfig): LegacyCosmosConfig {
  return {
    rpcUrl: unified.rpcUrl,
    restUrl: unified.restUrl,
    chainId: unified.chainId,
    htlcContract: unified.htlcContract,
    mnemonic: unified.mnemonic,
    addressPrefix: unified.addressPrefix,
    denom: unified.denom,
    gasPrice: unified.gasConfig?.gasPrice,
    gasLimit: unified.gasConfig?.gasLimit
  };
}

/**
 * Convert relayer config from environment variables
 */
export function parseRelayerConfigFromEnv(): RelayerConfig {
  return {
    maxRetries: parseInt(process.env.RELAY_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.RELAY_RETRY_DELAY || '5000'),
    batchSize: parseInt(process.env.RELAY_BATCH_SIZE || '10'),
    processingInterval: parseInt(process.env.RELAY_PROCESSING_INTERVAL || '5000'),
    timeoutBuffer: parseInt(process.env.RELAY_TIMEOUT_BUFFER || '300'),
    concurrency: {
      maxParallelSwaps: parseInt(process.env.RELAY_MAX_PARALLEL_SWAPS || '5'),
      maxPendingSwaps: parseInt(process.env.RELAY_MAX_PENDING_SWAPS || '100')
    }
  };
}

/**
 * Convert recovery config from environment variables
 */
export function parseRecoveryConfigFromEnv(): RecoveryConfig {
  return {
    enabled: process.env.RECOVERY_ENABLED !== 'false',
    checkInterval: parseInt(process.env.RECOVERY_CHECK_INTERVAL || '60000'),
    refundBuffer: parseInt(process.env.RECOVERY_REFUND_BUFFER || '7200'),
    maxRecoveryAttempts: parseInt(process.env.RECOVERY_MAX_ATTEMPTS || '3'),
    emergencyContact: process.env.RECOVERY_EMERGENCY_CONTACT
  };
}

/**
 * Convert chain registry config from environment variables
 */
export function parseChainRegistryConfigFromEnv(): ChainRegistryConfig {
  return {
    baseUrl: process.env.CHAIN_REGISTRY_URL || 'https://registry.ping.pub',
    cacheTimeout: parseInt(process.env.CHAIN_REGISTRY_CACHE_TIMEOUT || '3600'),
    refreshInterval: parseInt(process.env.CHAIN_REGISTRY_REFRESH_INTERVAL || '300'),
    maxRetries: parseInt(process.env.CHAIN_REGISTRY_MAX_RETRIES || '3'),
    endpoints: {
      chainRegistry: process.env.CHAIN_REGISTRY_ENDPOINT || 'https://registry.ping.pub/api',
      ibcData: process.env.IBC_DATA_ENDPOINT || 'https://registry.ping.pub/api/ibc'
    }
  };
}

/**
 * Convert general config from environment variables
 */
export function parseGeneralConfigFromEnv(): GeneralConfig {
  return {
    environment: (process.env.NODE_ENV as any) || 'development',
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    port: parseInt(process.env.PORT || '3000'),
    enableMetrics: process.env.ENABLE_METRICS === 'true',
    shutdownTimeout: parseInt(process.env.SHUTDOWN_TIMEOUT || '30000'),
    debug: process.env.DEBUG === 'true'
  };
}

/**
 * Convert Ethereum config from environment variables
 */
export function parseEthereumConfigFromEnv(): EthereumNetworkConfig {
  const gasPrice = process.env.ETHEREUM_GAS_PRICE;
  const gasLimit = process.env.ETHEREUM_GAS_LIMIT;
  const maxPriorityFeePerGas = process.env.ETHEREUM_MAX_PRIORITY_FEE_PER_GAS;
  const maxFeePerGas = process.env.ETHEREUM_MAX_FEE_PER_GAS;

  return {
    chainId: parseInt(process.env.ETHEREUM_CHAIN_ID || '1337'),
    name: process.env.ETHEREUM_NETWORK_NAME || 'local',
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'http://localhost:8545',
    wsUrl: process.env.ETHEREUM_WS_URL,
    explorerUrl: process.env.ETHEREUM_EXPLORER_URL,
    htlcContract: process.env.ETHEREUM_HTLC_CONTRACT || '',
    resolverContract: process.env.ETHEREUM_RESOLVER_CONTRACT,
    routerContract: process.env.ETHEREUM_ROUTER_CONTRACT,
    privateKey: process.env.ETHEREUM_PRIVATE_KEY,
    confirmations: parseInt(process.env.ETHEREUM_CONFIRMATIONS || '1'),
    timeout: parseInt(process.env.ETHEREUM_TIMEOUT || '30000'),
    gasConfig: (gasPrice || gasLimit || maxPriorityFeePerGas || maxFeePerGas) ? {
      gasPrice,
      gasLimit: gasLimit ? parseInt(gasLimit) : undefined,
      maxPriorityFeePerGas,
      maxFeePerGas,
      maxGasLimit: process.env.ETHEREUM_MAX_GAS_LIMIT ? parseInt(process.env.ETHEREUM_MAX_GAS_LIMIT) : undefined
    } : undefined
  };
}

/**
 * Convert Cosmos config from environment variables
 */
export function parseCosmosConfigFromEnv(): CosmosNetworkConfig {
  const gasPrice = process.env.COSMOS_GAS_PRICE || '0.025uosmo';
  const gasLimit = parseInt(process.env.COSMOS_GAS_LIMIT || '200000');

  return {
    chainId: process.env.COSMOS_CHAIN_ID || 'testing',
    name: process.env.COSMOS_NETWORK_NAME || 'local',
    rpcUrl: process.env.COSMOS_RPC_URL || 'http://localhost:26657',
    restUrl: process.env.COSMOS_REST_URL || 'http://localhost:1317',
    wsUrl: process.env.COSMOS_WS_URL,
    explorerUrl: process.env.COSMOS_EXPLORER_URL,
    htlcContract: process.env.COSMOS_HTLC_CONTRACT || '',
    routerContract: process.env.COSMOS_ROUTER_CONTRACT,
    registryContract: process.env.COSMOS_REGISTRY_CONTRACT,
    mnemonic: process.env.COSMOS_MNEMONIC,
    addressPrefix: process.env.COSMOS_ADDRESS_PREFIX || 'osmo',
    denom: process.env.COSMOS_DENOM || 'uosmo',
    coinType: process.env.COSMOS_COIN_TYPE ? parseInt(process.env.COSMOS_COIN_TYPE) : 118,
    decimals: process.env.COSMOS_DECIMALS ? parseInt(process.env.COSMOS_DECIMALS) : 6,
    confirmations: parseInt(process.env.COSMOS_CONFIRMATIONS || '1'),
    timeout: parseInt(process.env.COSMOS_TIMEOUT || '30000'),
    gasConfig: {
      gasPrice,
      gasLimit
    }
  };
}

/**
 * Create unified app config from individual components
 */
export interface UnifiedAppConfig {
  general: GeneralConfig;
  ethereum: EthereumNetworkConfig;
  cosmos: CosmosNetworkConfig;
  relayer: RelayerConfig;
  recovery: RecoveryConfig;
  chainRegistry: ChainRegistryConfig;
}

/**
 * Parse complete app config from environment variables
 */
export function parseAppConfigFromEnv(): UnifiedAppConfig {
  return {
    general: parseGeneralConfigFromEnv(),
    ethereum: parseEthereumConfigFromEnv(),
    cosmos: parseCosmosConfigFromEnv(),
    relayer: parseRelayerConfigFromEnv(),
    recovery: parseRecoveryConfigFromEnv(),
    chainRegistry: parseChainRegistryConfigFromEnv()
  };
}

/**
 * Convert unified config to FusionConfig format
 */
export function toFusionConfig(unified: UnifiedAppConfig): Partial<FusionConfig> {
  return {
    environment: {
      name: unified.general.environment as any,
      debug: unified.general.debug || false,
      logLevel: unified.general.logLevel
    },
    networks: {
      ethereum: {
        chainId: unified.ethereum.chainId,
        name: unified.ethereum.name || 'ethereum',
        rpcUrl: unified.ethereum.rpcUrl,
        wsUrl: unified.ethereum.wsUrl,
        explorerUrl: unified.ethereum.explorerUrl,
        contracts: {
          htlc: unified.ethereum.htlcContract,
          resolver: unified.ethereum.resolverContract,
          router: unified.ethereum.routerContract
        },
        confirmations: unified.ethereum.confirmations || 1,
        gasConfig: {
          maxGasLimit: unified.ethereum.gasConfig?.maxGasLimit || 500000,
          maxPriorityFeePerGas: unified.ethereum.gasConfig?.maxPriorityFeePerGas,
          maxFeePerGas: unified.ethereum.gasConfig?.maxFeePerGas
        }
      },
      cosmos: [{
        chainId: unified.cosmos.chainId,
        name: unified.cosmos.name || 'cosmos',
        rpcUrl: unified.cosmos.rpcUrl,
        restUrl: unified.cosmos.restUrl,
        wsUrl: unified.cosmos.wsUrl,
        addressPrefix: unified.cosmos.addressPrefix,
        coinType: unified.cosmos.coinType || 118,
        gasPrice: unified.cosmos.gasConfig?.gasPrice || '0.025' + unified.cosmos.denom,
        gasLimit: unified.cosmos.gasConfig?.gasLimit || 200000,
        denominations: {
          primary: unified.cosmos.denom,
          display: unified.cosmos.denom.replace('u', ''),
          decimals: unified.cosmos.decimals || 6
        },
        contracts: {
          htlc: unified.cosmos.htlcContract,
          router: unified.cosmos.routerContract,
          registry: unified.cosmos.registryContract
        },
        ibc: {
          channels: {},
          timeout: 300
        }
      }]
    },
    services: {
      relayer: {
        maxRetries: unified.relayer.maxRetries,
        retryDelayMs: unified.relayer.retryDelay,
        batchSize: unified.relayer.batchSize,
        processingIntervalMs: unified.relayer.processingInterval,
        timeoutBufferSeconds: unified.relayer.timeoutBuffer,
        concurrency: {
          maxParallelSwaps: unified.relayer.concurrency?.maxParallelSwaps || 5,
          maxPendingSwaps: unified.relayer.concurrency?.maxPendingSwaps || 100
        }
      },
      registry: {
        cacheTimeout: unified.chainRegistry.cacheTimeout,
        refreshInterval: unified.chainRegistry.refreshInterval,
        maxRetries: unified.chainRegistry.maxRetries || 3,
        endpoints: {
          chainRegistry: unified.chainRegistry.endpoints?.chainRegistry || unified.chainRegistry.baseUrl,
          ibcData: unified.chainRegistry.endpoints?.ibcData || unified.chainRegistry.baseUrl + '/ibc'
        }
      },
      recovery: {
        enabled: unified.recovery.enabled,
        checkInterval: unified.recovery.checkInterval,
        refundBufferSeconds: unified.recovery.refundBuffer,
        maxRecoveryAttempts: unified.recovery.maxRecoveryAttempts || 3,
        emergencyContact: unified.recovery.emergencyContact
      }
    }
  };
}

/**
 * Validation helpers
 */
export function validateEthereumConfig(config: EthereumNetworkConfig): string[] {
  const errors: string[] = [];
  
  if (!config.rpcUrl) errors.push('rpcUrl is required');
  if (!config.htlcContract) errors.push('htlcContract is required');
  if (typeof config.chainId !== 'number') errors.push('chainId must be a number');
  
  return errors;
}

export function validateCosmosConfig(config: CosmosNetworkConfig): string[] {
  const errors: string[] = [];
  
  if (!config.rpcUrl) errors.push('rpcUrl is required');
  if (!config.restUrl) errors.push('restUrl is required');
  if (!config.chainId) errors.push('chainId is required');
  if (!config.htlcContract) errors.push('htlcContract is required');
  if (!config.addressPrefix) errors.push('addressPrefix is required');
  if (!config.denom) errors.push('denom is required');
  
  return errors;
}
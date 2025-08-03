/**
 * Configuration Migration Adapter for Relayer
 * Provides backward compatibility during transition to @evmore/config
 */

import { 
  FusionConfig,
  EnvironmentConfig,
  NetworksConfig,
  EthereumNetworkConfig,
  CosmosNetworkConfig,
  ServicesConfig,
  RelayerServiceConfig,
  RegistryServiceConfig,
  RecoveryServiceConfig,
  SecurityConfig,
  MonitoringConfig
} from '@evmore/config';

import { LogLevel } from '@evmore/interfaces';

// Legacy types from current relayer config
import {
  AppConfig as LegacyAppConfig,
  EthereumConfig as LegacyEthereumConfig,
  CosmosConfig as LegacyCosmosConfig,
  ChainRegistryConfig as LegacyChainRegistryConfig,
  RelayConfig as LegacyRelayConfig,
  RecoveryConfig as LegacyRecoveryConfig,
  GeneralConfig as LegacyGeneralConfig
} from '../config';

/**
 * Adapter to convert legacy AppConfig to new FusionConfig
 */
export function adaptLegacyConfig(legacy: LegacyAppConfig): FusionConfig {
  return {
    environment: adaptEnvironmentConfig(legacy.general),
    networks: adaptNetworksConfig(legacy.ethereum, legacy.cosmos),
    services: adaptServicesConfig(legacy.relay, legacy.chainRegistry, legacy.recovery),
    security: createDefaultSecurityConfig(),
    monitoring: adaptMonitoringConfig(legacy.general),
    features: {}
  };
}

/**
 * Convert legacy GeneralConfig to EnvironmentConfig
 */
function adaptEnvironmentConfig(general: LegacyGeneralConfig): EnvironmentConfig {
  return {
    name: (process.env.NODE_ENV as any) || 'development',
    debug: general.logLevel === 'debug',
    logLevel: mapLogLevel(general.logLevel)
  };
}

/**
 * Convert legacy Ethereum and Cosmos configs to NetworksConfig
 */
function adaptNetworksConfig(
  ethereum: LegacyEthereumConfig, 
  cosmos: LegacyCosmosConfig
): NetworksConfig {
  const ethereumConfig: EthereumNetworkConfig = {
    chainId: ethereum.chainId,
    name: getEthereumChainName(ethereum.chainId),
    rpcUrl: ethereum.rpcUrl,
    contracts: {
      htlc: ethereum.htlcContractAddress,
      resolver: ethereum.resolverContractAddress
    },
    confirmations: ethereum.confirmations,
    gasConfig: {
      maxGasLimit: ethereum.gasLimit,
      maxFeePerGas: ethereum.gasPrice
    }
  };

  const cosmosConfig: CosmosNetworkConfig = {
    chainId: cosmos.chainId,
    name: getCosmosChainName(cosmos.chainId),
    rpcUrl: cosmos.rpcUrl,
    restUrl: cosmos.restUrl,
    addressPrefix: cosmos.addressPrefix,
    coinType: getCoinType(cosmos.addressPrefix),
    gasPrice: cosmos.gasPrice,
    gasLimit: cosmos.gasLimit,
    denominations: {
      primary: cosmos.denom,
      display: cosmos.denom.replace('u', ''),
      decimals: 6 // Standard for most Cosmos tokens
    },
    contracts: {
      htlc: cosmos.htlcContractAddress
    },
    ibc: {
      channels: {}, // Will be populated from chain registry
      timeout: 600 // Default 10 minutes
    }
  };

  return {
    ethereum: ethereumConfig,
    cosmos: [cosmosConfig]
  };
}

/**
 * Convert legacy service configs to ServicesConfig
 */
function adaptServicesConfig(
  relay: LegacyRelayConfig,
  registry: LegacyChainRegistryConfig,
  recovery: LegacyRecoveryConfig
): ServicesConfig {
  const relayerConfig: RelayerServiceConfig = {
    maxRetries: relay.maxRetries,
    retryDelayMs: relay.retryDelay,
    batchSize: relay.batchSize,
    processingIntervalMs: relay.processingInterval,
    timeoutBufferSeconds: relay.timeoutBuffer,
    concurrency: {
      maxParallelSwaps: 10, // Default
      maxPendingSwaps: 100  // Default
    }
  };

  const registryConfig: RegistryServiceConfig = {
    cacheTimeout: registry.cacheTimeout,
    refreshInterval: registry.refreshInterval,
    maxRetries: 3, // Default
    endpoints: {
      chainRegistry: registry.baseUrl,
      ibcData: registry.baseUrl
    }
  };

  const recoveryConfig: RecoveryServiceConfig = {
    enabled: recovery.enabled,
    checkInterval: recovery.checkInterval,
    refundBufferSeconds: recovery.refundBuffer,
    maxRecoveryAttempts: 3, // Default
    emergencyContact: undefined
  };

  return {
    relayer: relayerConfig,
    registry: registryConfig,
    recovery: recoveryConfig
  };
}

/**
 * Create default security config (to be customized later)
 */
function createDefaultSecurityConfig(): SecurityConfig {
  return {
    secrets: {
      provider: 'env',
      encryption: false
    },
    encryption: {
      algorithm: 'aes-256-gcm',
      keyDerivation: 'pbkdf2',
      iterations: 10000
    },
    rateLimit: {
      enabled: true,
      maxRequests: 100,
      windowMs: 60000, // 1 minute
      skipSuccessfulRequests: false
    },
    firewall: {
      enabled: false,
      allowedOrigins: [],
      allowedIPs: [],
      blockedIPs: [],
      maxConnectionsPerIP: 10
    }
  };
}

/**
 * Convert legacy monitoring settings to MonitoringConfig
 */
function adaptMonitoringConfig(general: LegacyGeneralConfig): MonitoringConfig {
  return {
    metrics: {
      enabled: general.enableMetrics,
      port: general.port + 1, // Metrics on port + 1
      path: '/metrics',
      prefix: 'evmore_relayer_'
    },
    tracing: {
      enabled: false, // Default off
      serviceName: 'evmore-relayer',
      sampleRate: 0.1
    },
    healthCheck: {
      enabled: true,
      interval: 30000,
      timeout: 5000,
      endpoints: ['/health']
    },
    alerts: {
      enabled: false, // Default off
      channels: [],
      thresholds: {
        errorRate: 0.05,
        responseTime: 5000,
        diskUsage: 0.9,
        memoryUsage: 0.8
      }
    }
  };
}

/**
 * Helper functions
 */
function mapLogLevel(level: string | LogLevel): LogLevel {
  // If it's already a LogLevel enum, return it
  if (typeof level === 'number') {
    return level as LogLevel;
  }
  
  // If it's a string, map it
  const mapping: Record<string, LogLevel> = {
    'debug': LogLevel.DEBUG,
    'info': LogLevel.INFO,
    'warn': LogLevel.WARN,
    'error': LogLevel.ERROR,
    'fatal': LogLevel.FATAL
  };
  
  return mapping[level.toLowerCase()] || LogLevel.INFO;
}

function getEthereumChainName(chainId: number): string {
  const names: Record<number, string> = {
    1: 'Ethereum Mainnet',
    5: 'Goerli Testnet',
    11155111: 'Sepolia Testnet',
    1337: 'Hardhat Network',
    31337: 'Hardhat Network'
  };
  
  return names[chainId] || `Ethereum Chain ${chainId}`;
}

function getCosmosChainName(chainId: string): string {
  const names: Record<string, string> = {
    'cosmoshub-4': 'Cosmos Hub',
    'osmosis-1': 'Osmosis',
    'juno-1': 'Juno',
    'testing': 'Test Chain'
  };
  
  return names[chainId] || chainId;
}

function getCoinType(addressPrefix: string): number {
  const coinTypes: Record<string, number> = {
    'cosmos': 118,
    'osmo': 118,
    'juno': 118,
    'stars': 118
  };
  
  return coinTypes[addressPrefix] || 118;
}

/**
 * Reverse adapter to convert new FusionConfig back to legacy AppConfig
 * Useful for gradual migration
 */
export function adaptToLegacyConfig(fusion: FusionConfig): LegacyAppConfig {
  const ethereum = fusion.networks.ethereum;
  const cosmos = fusion.networks.cosmos[0]; // Take first cosmos chain
  
  return {
    general: {
      logLevel: fusion.environment.logLevel.toString().toLowerCase(),
      port: fusion.monitoring.metrics.port - 1, // Reverse the port calculation
      enableMetrics: fusion.monitoring.metrics.enabled,
      shutdownTimeout: 30000 // Default
    },
    ethereum: {
      rpcUrl: ethereum.rpcUrl,
      htlcContractAddress: ethereum.contracts.htlc,
      resolverContractAddress: ethereum.contracts.resolver || '',
      privateKey: process.env.ETHEREUM_PRIVATE_KEY || '',
      chainId: ethereum.chainId,
      confirmations: ethereum.confirmations,
      gasLimit: ethereum.gasConfig.maxGasLimit,
      gasPrice: ethereum.gasConfig.maxFeePerGas
    },
    cosmos: {
      rpcUrl: cosmos.rpcUrl,
      restUrl: cosmos.restUrl,
      chainId: cosmos.chainId,
      htlcContractAddress: cosmos.contracts.htlc,
      mnemonic: process.env.COSMOS_MNEMONIC || '',
      gasPrice: cosmos.gasPrice,
      gasLimit: cosmos.gasLimit,
      denom: cosmos.denominations.primary,
      addressPrefix: cosmos.addressPrefix
    },
    chainRegistry: {
      baseUrl: fusion.services.registry.endpoints.chainRegistry || '',
      cacheTimeout: fusion.services.registry.cacheTimeout,
      refreshInterval: fusion.services.registry.refreshInterval
    },
    relay: {
      maxRetries: fusion.services.relayer.maxRetries,
      retryDelay: fusion.services.relayer.retryDelayMs,
      batchSize: fusion.services.relayer.batchSize,
      processingInterval: fusion.services.relayer.processingIntervalMs,
      timeoutBuffer: fusion.services.relayer.timeoutBufferSeconds
    },
    recovery: {
      enabled: fusion.services.recovery.enabled,
      checkInterval: fusion.services.recovery.checkInterval,
      refundBuffer: fusion.services.recovery.refundBufferSeconds
    }
  };
}

/**
 * Configuration compatibility layer
 * Loads config using new system but provides legacy interface
 */
export class ConfigCompatibilityLayer {
  private fusionConfig: FusionConfig;
  private legacyConfig: LegacyAppConfig;
  
  constructor(fusionConfig: FusionConfig) {
    this.fusionConfig = fusionConfig;
    this.legacyConfig = adaptToLegacyConfig(fusionConfig);
  }
  
  /**
   * Get legacy config for backward compatibility
   */
  getLegacyConfig(): LegacyAppConfig {
    return this.legacyConfig;
  }
  
  /**
   * Get new fusion config
   */
  getFusionConfig(): FusionConfig {
    return this.fusionConfig;
  }
  
  /**
   * Get specific sections
   */
  getEthereumConfig(): LegacyEthereumConfig {
    return this.legacyConfig.ethereum;
  }
  
  getCosmosConfig(): LegacyCosmosConfig {
    return this.legacyConfig.cosmos;
  }
  
  getRelayConfig(): LegacyRelayConfig {
    return this.legacyConfig.relay;
  }
  
  getRecoveryConfig(): LegacyRecoveryConfig {
    return this.legacyConfig.recovery;
  }
}

// Re-export types for convenience
export type {
  LegacyAppConfig,
  LegacyEthereumConfig,
  LegacyCosmosConfig,
  LegacyChainRegistryConfig,
  LegacyRelayConfig,
  LegacyRecoveryConfig,
  LegacyGeneralConfig
};
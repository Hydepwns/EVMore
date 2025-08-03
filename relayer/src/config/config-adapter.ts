/**
 * Configuration adapter to migrate from AppConfig to @evmore/config FusionConfig
 * Provides backward compatibility during the migration period
 */

import { FusionConfig } from '@evmore/config';
import { LogLevel } from '@evmore/interfaces';
import { AppConfig } from './index';

/**
 * Convert legacy AppConfig to new FusionConfig format
 * @deprecated This function is not currently used and may be removed
 */
export function appConfigToFusionConfig(appConfig: AppConfig): FusionConfig {
  return {
    environment: {
      name: (process.env.NODE_ENV || 'development') as 'test' | 'development' | 'staging' | 'production',
      debug: typeof appConfig.general.logLevel === 'string' 
        ? appConfig.general.logLevel === 'debug' 
        : appConfig.general.logLevel === LogLevel.DEBUG,
      logLevel: typeof appConfig.general.logLevel === 'string' 
        ? mapLogLevel(appConfig.general.logLevel)
        : appConfig.general.logLevel
    },
    
    networks: {
      ethereum: {
        chainId: appConfig.ethereum.chainId,
        name: getEthereumNetworkName(appConfig.ethereum.chainId),
        rpcUrl: appConfig.ethereum.rpcUrl,
        contracts: {
          htlc: appConfig.ethereum.htlcContractAddress,
          resolver: appConfig.ethereum.resolverContractAddress
        },
        confirmations: appConfig.ethereum.confirmations,
        gasConfig: {
          maxGasLimit: appConfig.ethereum.gasLimit,
          maxPriorityFeePerGas: appConfig.ethereum.gasPrice,
          maxFeePerGas: appConfig.ethereum.gasPrice
        }
      },
      
      cosmos: [
        {
          chainId: appConfig.cosmos.chainId,
          name: 'Cosmos Hub',
          rpcUrl: appConfig.cosmos.rpcUrl,
          restUrl: appConfig.cosmos.restUrl,
          addressPrefix: appConfig.cosmos.addressPrefix,
          coinType: 118, // Default Cosmos coin type
          gasPrice: appConfig.cosmos.gasPrice,
          gasLimit: appConfig.cosmos.gasLimit,
          denominations: {
            primary: appConfig.cosmos.denom,
            display: appConfig.cosmos.denom.replace('u', ''), // e.g., uatom -> atom
            decimals: 6
          },
          contracts: {
            htlc: appConfig.cosmos.htlcContractAddress
          },
          ibc: {
            channels: {}, // Will be populated from chain registry
            timeout: 600 // Default 10 minute timeout
          }
        },
        // Add any additional chains from cosmos.chains
        ...(appConfig.cosmos.chains || []).map(chain => ({
          chainId: chain.chainId,
          name: chain.chainId,
          rpcUrl: chain.rpcUrl,
          restUrl: chain.restUrl,
          addressPrefix: chain.addressPrefix,
          coinType: 118,
          gasPrice: chain.gasPrice,
          gasLimit: chain.gasLimit,
          denominations: {
            primary: chain.denom,
            display: chain.denom.replace('u', ''),
            decimals: 6
          },
          contracts: {
            htlc: chain.htlcContractAddress
          },
          ibc: {
            channels: {},
            timeout: 600
          }
        }))
      ]
    },
    
    services: {
      relayer: {
        maxRetries: appConfig.relay.maxRetries,
        retryDelayMs: appConfig.relay.retryDelay,
        batchSize: appConfig.relay.batchSize,
        processingIntervalMs: appConfig.relay.processingInterval,
        timeoutBufferSeconds: appConfig.relay.timeoutBuffer,
        concurrency: {
          maxParallelSwaps: 10, // Default values
          maxPendingSwaps: 100
        }
      },
      
      registry: {
        cacheTimeout: appConfig.chainRegistry.cacheTimeout,
        refreshInterval: appConfig.chainRegistry.refreshInterval,
        maxRetries: 3, // Default
        endpoints: {
          chainRegistry: appConfig.chainRegistry.baseUrl,
          ibcData: `${appConfig.chainRegistry.baseUrl}/ibc`
        }
      },
      
      recovery: {
        enabled: appConfig.recovery.enabled,
        checkInterval: appConfig.recovery.checkInterval,
        refundBufferSeconds: appConfig.recovery.refundBuffer,
        maxRecoveryAttempts: 3 // Default
      }
    },
    
    security: {
      secrets: {
        provider: 'env', // Default to environment variables
        encryption: false
      },
      
      encryption: {
        algorithm: 'aes-256-gcm',
        keyDerivation: 'pbkdf2'
      },
      
      rateLimit: {
        enabled: true,
        windowMs: 60000,
        maxRequests: 100
      },
      
      firewall: {
        enabled: false,
        allowedOrigins: ['*'],
        maxConnectionsPerIP: 100
      }
    },
    
    monitoring: {
      metrics: {
        enabled: appConfig.general.enableMetrics,
        port: 9090,
        path: '/metrics',
        prefix: 'fusion_'
      },
      
      tracing: {
        enabled: false,
        serviceName: 'fusion-relayer',
        sampleRate: 1.0
      },
      
      healthCheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        endpoints: []
      },
      
      alerts: {
        enabled: false,
        channels: [],
        thresholds: {
          errorRate: 0.05,
          responseTime: 5000,
          diskUsage: 0.9,
          memoryUsage: 0.9
        }
      }
    },
    
    features: {
      multiHopRouting: true,
      automaticRecovery: appConfig.recovery.enabled,
      dynamicGasPrice: false,
      experimentalFeatures: false
    }
  };
}

/**
 * Convert FusionConfig back to AppConfig for backward compatibility
 * @deprecated This function is not currently used and may be removed
 */
export function fusionConfigToAppConfig(fusionConfig: FusionConfig): AppConfig {
  const cosmosChain = fusionConfig.networks.cosmos[0]; // Primary cosmos chain
  
  return {
    general: {
      logLevel: reverseMapLogLevel(fusionConfig.environment.logLevel),
      port: 3000, // Not in FusionConfig, use default
      enableMetrics: fusionConfig.monitoring.metrics.enabled,
      shutdownTimeout: 30000 // Not in FusionConfig, use default
    },
    
    ethereum: {
      rpcUrl: fusionConfig.networks.ethereum.rpcUrl,
      htlcContractAddress: fusionConfig.networks.ethereum.contracts.htlc,
      resolverContractAddress: fusionConfig.networks.ethereum.contracts.resolver || '',
      privateKey: process.env.ETHEREUM_PRIVATE_KEY || '', // Secrets handled separately
      chainId: fusionConfig.networks.ethereum.chainId,
      confirmations: fusionConfig.networks.ethereum.confirmations,
      gasLimit: fusionConfig.networks.ethereum.gasConfig.maxGasLimit,
      gasPrice: fusionConfig.networks.ethereum.gasConfig.maxPriorityFeePerGas
    },
    
    cosmos: {
      rpcUrl: cosmosChain.rpcUrl,
      restUrl: cosmosChain.restUrl || '',
      chainId: cosmosChain.chainId,
      htlcContractAddress: cosmosChain.contracts.htlc,
      mnemonic: process.env.COSMOS_MNEMONIC || '', // Secrets handled separately
      gasPrice: cosmosChain.gasPrice,
      gasLimit: cosmosChain.gasLimit,
      denom: cosmosChain.denominations.primary,
      addressPrefix: cosmosChain.addressPrefix,
      chains: fusionConfig.networks.cosmos.slice(1).map(chain => ({
        rpcUrl: chain.rpcUrl,
        restUrl: chain.restUrl || '',
        chainId: chain.chainId,
        htlcContractAddress: chain.contracts.htlc,
        mnemonic: '',
        gasPrice: chain.gasPrice,
        gasLimit: chain.gasLimit,
        denom: chain.denominations.primary,
        addressPrefix: chain.addressPrefix
      }))
    },
    
    chainRegistry: {
      baseUrl: fusionConfig.services.registry.endpoints.chainRegistry,
      cacheTimeout: fusionConfig.services.registry.cacheTimeout,
      refreshInterval: fusionConfig.services.registry.refreshInterval
    },
    
    relay: {
      maxRetries: fusionConfig.services.relayer.maxRetries,
      retryDelay: fusionConfig.services.relayer.retryDelayMs,
      batchSize: fusionConfig.services.relayer.batchSize,
      processingInterval: fusionConfig.services.relayer.processingIntervalMs,
      timeoutBuffer: fusionConfig.services.relayer.timeoutBufferSeconds
    },
    
    recovery: {
      enabled: fusionConfig.services.recovery.enabled,
      checkInterval: fusionConfig.services.recovery.checkInterval,
      refundBuffer: fusionConfig.services.recovery.refundBufferSeconds
    }
  };
}

/**
 * Map string log level to LogLevel enum
 */
function mapLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'debug': return LogLevel.DEBUG;
    case 'info': return LogLevel.INFO;
    case 'warn': return LogLevel.WARN;
    case 'error': return LogLevel.ERROR;
    case 'fatal': return LogLevel.FATAL;
    default: return LogLevel.INFO;
  }
}

/**
 * Map LogLevel enum back to string
 */
function reverseMapLogLevel(level: LogLevel): LogLevel {
  // Just return the same LogLevel enum value
  return level || LogLevel.INFO;
}

/**
 * Get Ethereum network name from chain ID
 */
function getEthereumNetworkName(chainId: number): string {
  switch (chainId) {
    case 1: return 'Ethereum Mainnet';
    case 5: return 'Goerli Testnet';
    case 11155111: return 'Sepolia Testnet';
    case 1337: return 'Hardhat Network';
    case 31337: return 'Hardhat Network';
    default: return `Chain ${chainId}`;
  }
}
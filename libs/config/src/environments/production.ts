import { FusionConfig } from '../schema/interfaces';
import { LogLevel } from '@evmore/interfaces';

export const productionConfig: Partial<FusionConfig> = {
  environment: {
    name: 'production',
    debug: false,
    logLevel: LogLevel.WARN
  },
  
  networks: {
    ethereum: {
      chainId: 1,
      name: 'Ethereum Mainnet',
      rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
      wsUrl: process.env.ETHEREUM_WS_URL,
      explorerUrl: 'https://etherscan.io',
      contracts: {
        htlc: process.env.ETHEREUM_HTLC_CONTRACT || '0x0000000000000000000000000000000000000000',
        resolver: process.env.ETHEREUM_RESOLVER_CONTRACT,
        router: process.env.ETHEREUM_ROUTER_CONTRACT
      },
      confirmations: 3,
      gasConfig: {
        maxGasLimit: 500000,
        maxPriorityFeePerGas: process.env.ETHEREUM_MAX_PRIORITY_FEE,
        maxFeePerGas: process.env.ETHEREUM_MAX_FEE
      }
    },
    
    cosmos: [
      {
        chainId: 'osmosis-1',
        name: 'Osmosis',
        rpcUrl: process.env.OSMOSIS_RPC_URL || 'https://rpc.osmosis.zone',
        restUrl: process.env.OSMOSIS_REST_URL || 'https://lcd.osmosis.zone',
        wsUrl: process.env.OSMOSIS_WS_URL,
        addressPrefix: 'osmo',
        coinType: 118,
        gasPrice: process.env.OSMOSIS_GAS_PRICE || '0.025uosmo',
        gasLimit: parseInt(process.env.OSMOSIS_GAS_LIMIT || '200000'),
        denominations: {
          primary: 'uosmo',
          display: 'osmo',
          decimals: 6
        },
        contracts: {
          htlc: process.env.OSMOSIS_HTLC_CONTRACT || 'osmo1htlc_contract_address',
          router: process.env.OSMOSIS_ROUTER_CONTRACT,
          registry: process.env.OSMOSIS_REGISTRY_CONTRACT
        },
        ibc: {
          channels: {
            'cosmoshub-4': {
              channelId: process.env.IBC_OSMOSIS_COSMOS_CHANNEL || 'channel-0',
              portId: 'transfer',
              counterpartyChainId: 'cosmoshub-4',
              counterpartyChannelId: process.env.IBC_COSMOS_OSMOSIS_CHANNEL || 'channel-141',
              version: 'ics20-1'
            }
          },
          timeout: parseInt(process.env.IBC_TIMEOUT || '600')
        }
      }
    ]
  },
  
  services: {
    relayer: {
      maxRetries: parseInt(process.env.RELAYER_MAX_RETRIES || '5'),
      retryDelayMs: parseInt(process.env.RELAYER_RETRY_DELAY || '10000'),
      batchSize: parseInt(process.env.RELAYER_BATCH_SIZE || '20'),
      processingIntervalMs: parseInt(process.env.RELAYER_PROCESSING_INTERVAL || '30000'),
      timeoutBufferSeconds: parseInt(process.env.RELAYER_TIMEOUT_BUFFER || '600'),
      concurrency: {
        maxParallelSwaps: parseInt(process.env.RELAYER_MAX_PARALLEL_SWAPS || '100'),
        maxPendingSwaps: parseInt(process.env.RELAYER_MAX_PENDING_SWAPS || '5000')
      }
    },
    
    registry: {
      cacheTimeout: parseInt(process.env.REGISTRY_CACHE_TIMEOUT || '7200'),
      refreshInterval: parseInt(process.env.REGISTRY_REFRESH_INTERVAL || '3600'),
      maxRetries: parseInt(process.env.REGISTRY_MAX_RETRIES || '5'),
      endpoints: {
        chainRegistry: process.env.CHAIN_REGISTRY_URL || 'https://registry.cosmos.directory',
        ibcData: process.env.IBC_DATA_URL || 'https://api.github.com/repos/cosmos/chain-registry'
      }
    },
    
    recovery: {
      enabled: process.env.RECOVERY_ENABLED !== 'false',
      checkInterval: parseInt(process.env.RECOVERY_CHECK_INTERVAL || '60000'),
      refundBufferSeconds: parseInt(process.env.RECOVERY_REFUND_BUFFER || '1800'),
      maxRecoveryAttempts: parseInt(process.env.RECOVERY_MAX_ATTEMPTS || '10'),
      emergencyContact: process.env.RECOVERY_EMERGENCY_CONTACT
    }
  },
  
  security: {
    secrets: {
      provider: (process.env.SECRETS_PROVIDER as any) || 'aws',
      encryption: process.env.SECRETS_ENCRYPTION === 'true',
      rotationInterval: parseInt(process.env.SECRETS_ROTATION_INTERVAL || '86400'),
      awsConfig: {
        region: process.env.AWS_REGION || 'us-west-2',
        secretPrefix: process.env.AWS_SECRET_PREFIX || 'evmore/'
      }
    },
    
    encryption: {
      algorithm: 'aes-256-gcm' as const,
      keyDerivation: 'scrypt' as const,
      iterations: parseInt(process.env.ENCRYPTION_ITERATIONS || '32768')
    },
    
    rateLimit: {
      enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100')
    },
    
    firewall: {
      enabled: process.env.FIREWALL_ENABLED === 'true',
      allowedOrigins: process.env.FIREWALL_ALLOWED_ORIGINS?.split(',') || [],
      allowedIPs: process.env.FIREWALL_ALLOWED_IPS?.split(','),
      blockedIPs: process.env.FIREWALL_BLOCKED_IPS?.split(','),
      maxConnectionsPerIP: parseInt(process.env.FIREWALL_MAX_CONNECTIONS || '10')
    }
  },
  
  monitoring: {
    metrics: {
      enabled: process.env.METRICS_ENABLED !== 'false',
      port: parseInt(process.env.METRICS_PORT || '9090'),
      path: process.env.METRICS_PATH || '/metrics',
      prefix: process.env.METRICS_PREFIX || 'evmore_'
    },
    
    tracing: {
      enabled: process.env.TRACING_ENABLED === 'true',
      serviceName: process.env.TRACING_SERVICE_NAME || 'evmore-relayer',
      endpoint: process.env.TRACING_ENDPOINT,
      sampleRate: parseFloat(process.env.TRACING_SAMPLE_RATE || '0.01')
    },
    
    healthCheck: {
      enabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
      interval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
      timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000'),
      endpoints: process.env.HEALTH_CHECK_ENDPOINTS?.split(',') || []
    },
    
    alerts: {
      enabled: process.env.ALERTS_ENABLED === 'true',
      channels: [], // Configured separately
      thresholds: {
        errorRate: parseFloat(process.env.ALERT_ERROR_RATE_THRESHOLD || '0.01'),
        responseTime: parseInt(process.env.ALERT_RESPONSE_TIME_THRESHOLD || '1000'),
        diskUsage: parseFloat(process.env.ALERT_DISK_USAGE_THRESHOLD || '0.8'),
        memoryUsage: parseFloat(process.env.ALERT_MEMORY_USAGE_THRESHOLD || '0.8')
      }
    }
  },
  
  features: {
    multiHopRouting: process.env.FEATURE_MULTI_HOP_ROUTING !== 'false',
    automaticRecovery: process.env.FEATURE_AUTOMATIC_RECOVERY !== 'false',
    dynamicGasPrice: process.env.FEATURE_DYNAMIC_GAS_PRICE === 'true',
    experimentalFeatures: process.env.FEATURE_EXPERIMENTAL === 'true'
  }
};
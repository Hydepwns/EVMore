import { FusionConfig } from '../schema/interfaces';
import { LogLevel } from '@evmore/interfaces';

export const developmentConfig: Partial<FusionConfig> = {
  environment: {
    name: 'development',
    debug: true,
    logLevel: LogLevel.DEBUG
  },
  
  networks: {
    ethereum: {
      chainId: 11155111, // Sepolia testnet
      name: 'Ethereum Sepolia',
      rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/demo',
      contracts: {
        htlc: '0x5FbDB2315678afecb367f032d93F642f64180aa3' // Deployed contract address
      },
      confirmations: 2,
      gasConfig: {
        maxGasLimit: 8000000
      }
    },
    
    cosmos: [
      {
        chainId: 'theta-testnet-001',
        name: 'Cosmos Hub Testnet',
        rpcUrl: 'https://rpc.testnet.cosmos.network',
        restUrl: 'https://rest.testnet.cosmos.network',
        addressPrefix: 'cosmos',
        coinType: 118,
        gasPrice: '0.025uatom',
        gasLimit: 500000,
        denominations: {
          primary: 'uatom',
          display: 'atom',
          decimals: 6
        },
        contracts: {
          htlc: 'cosmos1test_htlc_contract'
        },
        ibc: {
          channels: {},
          timeout: 600
        }
      },
      {
        chainId: 'osmo-test-5',
        name: 'Osmosis Testnet',
        rpcUrl: 'https://rpc.testnet.osmosis.zone',
        restUrl: 'https://rest.testnet.osmosis.zone',
        addressPrefix: 'osmo',
        coinType: 118,
        gasPrice: '0.025uosmo',
        gasLimit: 500000,
        denominations: {
          primary: 'uosmo',
          display: 'osmo',
          decimals: 6
        },
        contracts: {
          htlc: 'osmo1test_htlc_contract'
        },
        ibc: {
          channels: {},
          timeout: 600
        }
      }
    ]
  },
  
  services: {
    relayer: {
      maxRetries: 3,
      retryDelayMs: 2000,
      batchSize: 10,
      processingIntervalMs: 5000,
      timeoutBufferSeconds: 120,
      concurrency: {
        maxParallelSwaps: 5,
        maxPendingSwaps: 20
      }
    },
    
    registry: {
      cacheTimeout: 300, // 5 minutes
      refreshInterval: 60, // 1 minute
      maxRetries: 3,
      endpoints: {
        chainRegistry: 'https://registry.cosmos.network/chains',
        ibcData: 'https://api.cosmos.network/ibc'
      }
    },
    
    recovery: {
      enabled: true,
      checkInterval: 30000, // 30 seconds
      refundBufferSeconds: 600, // 10 minutes
      maxRecoveryAttempts: 5
    }
  },
  
  security: {
    secrets: {
      provider: 'env' as const,
      encryption: false
    },
    encryption: {
      algorithm: 'aes-256-gcm',
      keyDerivation: 'pbkdf2',
      iterations: 100000
    },
    rateLimit: {
      enabled: true,
      windowMs: 60000,
      maxRequests: 60,
      skipSuccessfulRequests: false,
      skipFailedRequests: false
    },
    firewall: {
      enabled: true,
      allowedOrigins: ['*'],
      maxConnectionsPerIP: 100
    },
    ddosProtection: {
      enabled: true,
      baseRateLimit: 60,
      maxRateLimit: 1000,
      rateMultiplier: 1.5,
      adaptationSpeed: 0.1,
      volumeThreshold: 100,
      burstThreshold: 50,
      patternThreshold: 10,
      warningLevel: 0.7,
      blockLevel: 0.9,
      emergencyLevel: 0.95,
      analysisWindow: 300,
      blacklistDuration: 3600,
      adaptationWindow: 60
    }
  },
  
  monitoring: {
    metrics: {
      enabled: true,
      port: 9090,
      path: '/metrics'
    },
    tracing: {
      enabled: true,
      serviceName: 'evmore-relayer-dev',
      sampleRate: 0.1
    },
    healthCheck: {
      enabled: true,
      interval: 30000,
      timeout: 5000,
      endpoints: ['/health', '/ready']
    },
    alerts: {
      enabled: true,
      channels: [
        {
          type: 'webhook',
          config: {
            url: process.env.ALERT_WEBHOOK_URL
          }
        }
      ],
      thresholds: {
        errorRate: 0.05,
        responseTime: 5000,
        diskUsage: 0.9,
        memoryUsage: 0.8
      }
    }
  }
};
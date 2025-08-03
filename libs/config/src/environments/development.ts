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
      chainId: 31337, // Hardhat local
      name: 'Hardhat Local',
      rpcUrl: 'http://localhost:8545',
      contracts: {
        htlc: '0x5FbDB2315678afecb367f032d93F642f64180aa3' // First Hardhat contract
      },
      confirmations: 1,
      gasConfig: {
        maxGasLimit: 8000000
      }
    },
    
    cosmos: [
      {
        chainId: 'testing',
        name: 'Local Test Chain',
        rpcUrl: 'http://localhost:26657',
        restUrl: 'http://localhost:1317',
        addressPrefix: 'cosmos',
        coinType: 118,
        gasPrice: '0.025utest',
        gasLimit: 500000,
        denominations: {
          primary: 'utest',
          display: 'test',
          decimals: 6
        },
        contracts: {
          htlc: 'cosmos1test_htlc_contract'
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
      maxRetries: 2,
      retryDelayMs: 1000,
      batchSize: 5,
      processingIntervalMs: 5000,
      timeoutBufferSeconds: 60,
      concurrency: {
        maxParallelSwaps: 10,
        maxPendingSwaps: 50
      }
    },
    
    registry: {
      cacheTimeout: 60,
      refreshInterval: 30,
      maxRetries: 2,
      endpoints: {
        chainRegistry: 'http://localhost:3001/chains',
        ibcData: 'http://localhost:3001/ibc'
      }
    },
    
    recovery: {
      enabled: true,
      checkInterval: 10000,
      refundBufferSeconds: 300,
      maxRecoveryAttempts: 3
    }
  },
  
  security: {
    secrets: {
      provider: 'env' as const,
      encryption: false
    },
    
    encryption: {
      algorithm: 'aes-256-gcm' as const,
      keyDerivation: 'pbkdf2' as const,
      iterations: 10000
    },
    
    rateLimit: {
      enabled: false,
      windowMs: 60000,
      maxRequests: 1000
    },
    
    firewall: {
      enabled: false,
      allowedOrigins: ['*'],
      maxConnectionsPerIP: 100
    }
  },
  
  monitoring: {
    metrics: {
      enabled: true,
      port: 9091
    },
    
    tracing: {
      enabled: true,
      serviceName: 'evmore-relayer-dev',
      sampleRate: 1.0
    },
    
    alerts: {
      enabled: false,
      channels: [],
      thresholds: {
        errorRate: 0.1,
        responseTime: 5000,
        diskUsage: 0.9,
        memoryUsage: 0.9
      }
    },
    
    healthCheck: {
      enabled: true,
      interval: 30000,
      timeout: 5000,
      endpoints: ['/health', '/ready']
    }
  },
  
  features: {
    multiHopRouting: true,
    automaticRecovery: true,
    dynamicGasPrice: false,
    experimentalFeatures: true
  }
};
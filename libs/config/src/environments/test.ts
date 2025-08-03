import { FusionConfig } from '../schema/interfaces';
import { LogLevel } from '@evmore/interfaces';

export const testConfig: Partial<FusionConfig> = {
  environment: {
    name: 'test',
    debug: true,
    logLevel: LogLevel.ERROR // Reduce noise in tests
  },
  
  networks: {
    ethereum: {
      chainId: 31337,
      name: 'Hardhat Test',
      rpcUrl: 'http://localhost:8545',
      contracts: {
        htlc: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
      },
      confirmations: 0, // No confirmations needed in tests
      gasConfig: {
        maxGasLimit: 8000000
      }
    },
    
    cosmos: [
      {
        chainId: 'testing',
        name: 'Test Chain',
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
          htlc: 'cosmos1test_contract'
        },
        ibc: {
          channels: {
            'test-2': {
              channelId: 'channel-0',
              portId: 'transfer',
              counterpartyChainId: 'test-2',
              counterpartyChannelId: 'channel-1',
              version: 'ics20-1'
            }
          },
          timeout: 60 // Short timeout for tests
        }
      }
    ]
  },
  
  services: {
    relayer: {
      maxRetries: 1,
      retryDelayMs: 100,
      batchSize: 2,
      processingIntervalMs: 1000,
      timeoutBufferSeconds: 10,
      concurrency: {
        maxParallelSwaps: 5,
        maxPendingSwaps: 10
      }
    },
    
    registry: {
      cacheTimeout: 5,
      refreshInterval: 2,
      maxRetries: 1,
      endpoints: {
        chainRegistry: 'http://localhost:3001/test/chains',
        ibcData: 'http://localhost:3001/test/ibc'
      }
    },
    
    recovery: {
      enabled: false, // Disable recovery in tests unless explicitly enabled
      checkInterval: 1000,
      refundBufferSeconds: 30,
      maxRecoveryAttempts: 1
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
      iterations: 1000
    },
    
    rateLimit: {
      enabled: false,
      windowMs: 1000,
      maxRequests: 1000
    },
    
    firewall: {
      enabled: false,
      allowedOrigins: ['*'],
      maxConnectionsPerIP: 1000
    }
  },
  
  monitoring: {
    metrics: {
      enabled: false
    },
    
    tracing: {
      enabled: false,
      serviceName: 'evmore-test',
      sampleRate: 1.0
    },
    
    healthCheck: {
      enabled: false,
      interval: 1000,
      timeout: 500,
      endpoints: []
    },
    
    alerts: {
      enabled: false,
      channels: [],
      thresholds: {
        errorRate: 1.0,
        responseTime: 10000,
        diskUsage: 1.0,
        memoryUsage: 1.0
      }
    }
  },
  
  features: {
    multiHopRouting: true,
    automaticRecovery: false,
    dynamicGasPrice: false,
    experimentalFeatures: true
  }
};
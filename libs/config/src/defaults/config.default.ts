import { FusionConfig } from '../schema/interfaces';
import { LogLevel } from '@evmore/interfaces';

export const defaultConfig: FusionConfig = {
  environment: {
    name: 'development',
    debug: true,
    logLevel: LogLevel.INFO
  },
  
  networks: {
    ethereum: {
      chainId: 1,
      name: 'Ethereum Mainnet',
      rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
      explorerUrl: 'https://etherscan.io',
      contracts: {
        htlc: '0x0000000000000000000000000000000000000000'
      },
      confirmations: 3,
      gasConfig: {
        maxGasLimit: 500000
      }
    },
    
    cosmos: [
      {
        chainId: 'osmosis-1',
        name: 'Osmosis',
        rpcUrl: 'https://rpc.osmosis.zone',
        restUrl: 'https://lcd.osmosis.zone',
        addressPrefix: 'osmo',
        coinType: 118,
        gasPrice: '0.025uosmo',
        gasLimit: 200000,
        denominations: {
          primary: 'uosmo',
          display: 'osmo',
          decimals: 6
        },
        contracts: {
          htlc: 'osmo1htlc_contract_address'
        },
        ibc: {
          channels: {
            'cosmoshub-4': {
              channelId: 'channel-0',
              portId: 'transfer',
              counterpartyChainId: 'cosmoshub-4',
              counterpartyChannelId: 'channel-141',
              version: 'ics20-1'
            }
          },
          timeout: 600
        }
      },
      {
        chainId: 'cosmoshub-4',
        name: 'Cosmos Hub',
        rpcUrl: 'https://rpc.cosmos.network',
        restUrl: 'https://lcd.cosmos.network',
        addressPrefix: 'cosmos',
        coinType: 118,
        gasPrice: '0.025uatom',
        gasLimit: 200000,
        denominations: {
          primary: 'uatom',
          display: 'atom',
          decimals: 6
        },
        contracts: {
          htlc: 'cosmos1htlc_contract_address'
        },
        ibc: {
          channels: {
            'osmosis-1': {
              channelId: 'channel-141',
              portId: 'transfer',
              counterpartyChainId: 'osmosis-1',
              counterpartyChannelId: 'channel-0',
              version: 'ics20-1'
            }
          },
          timeout: 600
        }
      }
    ]
  },
  
  services: {
    relayer: {
      maxRetries: 3,
      retryDelayMs: 5000,
      batchSize: 10,
      processingIntervalMs: 10000,
      timeoutBufferSeconds: 300,
      concurrency: {
        maxParallelSwaps: 50,
        maxPendingSwaps: 1000
      }
    },
    
    registry: {
      cacheTimeout: 3600,
      refreshInterval: 1800,
      maxRetries: 3,
      endpoints: {
        chainRegistry: 'https://registry.cosmos.directory',
        ibcData: 'https://api.github.com/repos/cosmos/chain-registry'
      }
    },
    
    recovery: {
      enabled: true,
      checkInterval: 30000,
      refundBufferSeconds: 600,
      maxRecoveryAttempts: 5
    }
  },
  
  security: {
    secrets: {
      provider: 'env',
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
      maxRequests: 100
    },
    
    firewall: {
      enabled: false,
      allowedOrigins: ['*'],
      maxConnectionsPerIP: 10
    }
  },
  
  monitoring: {
    metrics: {
      enabled: true,
      port: 9090,
      path: '/metrics',
      prefix: 'evmore_'
    },
    
    tracing: {
      enabled: false,
      serviceName: 'evmore-relayer',
      sampleRate: 0.1
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
        responseTime: 1000,
        diskUsage: 0.8,
        memoryUsage: 0.8
      }
    }
  },
  
  features: {
    multiHopRouting: true,
    automaticRecovery: true,
    dynamicGasPrice: false,
    experimentalFeatures: false
  }
};
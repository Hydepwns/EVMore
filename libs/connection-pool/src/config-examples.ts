/**
 * Connection Pool Configuration Examples
 * Production-ready configurations for different deployment scenarios
 */

import { PoolManagerConfig, EthereumPoolConfig, CosmosPoolConfig } from './types';

// Development configuration - single endpoints
export const developmentPoolConfig: PoolManagerConfig = {
  ethereum: {
    localhost: {
      name: 'ethereum-localhost',
      endpoints: [
        {
          url: 'http://localhost:8545',
          weight: 1,
          maxConnections: 5,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        }
      ],
      maxConnections: 10,
      minConnections: 2,
      connectionTimeout: 30000,
      idleTimeout: 300000, // 5 minutes
      maxRetries: 3,
      healthCheckInterval: 30000,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      chainId: 31337,
      throttleLimit: 10,
      throttleSlotInterval: 100
    }
  },
  cosmos: {
    'osmosis-local': {
      name: 'cosmos-osmosis-local',
      endpoints: [
        {
          url: 'http://localhost:26657',
          weight: 1,
          maxConnections: 5,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        }
      ],
      maxConnections: 10,
      minConnections: 2,
      connectionTimeout: 30000,
      idleTimeout: 300000,
      maxRetries: 3,
      healthCheckInterval: 30000,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      chainId: 'osmosis-local',
      addressPrefix: 'osmo',
      gasPrice: '0.025uosmo'
    }
  },
  monitoring: {
    metricsInterval: 30000,
    healthCheckInterval: 30000,
    logStats: true
  }
};

// Testnet configuration - redundant endpoints
export const testnetPoolConfig: PoolManagerConfig = {
  ethereum: {
    sepolia: {
      name: 'ethereum-sepolia',
      endpoints: [
        {
          url: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
          weight: 3,
          maxConnections: 10,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        },
        {
          url: 'https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY',
          weight: 3,
          maxConnections: 10,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        },
        {
          url: 'https://sepolia.gateway.tenderly.co/YOUR_TENDERLY_KEY',
          weight: 2,
          maxConnections: 8,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        }
      ],
      maxConnections: 30,
      minConnections: 5,
      connectionTimeout: 30000,
      idleTimeout: 600000, // 10 minutes
      maxRetries: 5,
      healthCheckInterval: 30000,
      retryDelay: 2000,
      circuitBreakerThreshold: 10,
      circuitBreakerTimeout: 120000,
      chainId: 11155111,
      throttleLimit: 20,
      throttleSlotInterval: 100
    }
  },
  cosmos: {
    'osmosis-1': {
      name: 'cosmos-osmosis-testnet',
      endpoints: [
        {
          url: 'https://rpc.testnet.osmosis.zone',
          weight: 4,
          maxConnections: 15,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        },
        {
          url: 'https://osmosis-testnet-rpc.polkachu.com',
          weight: 3,
          maxConnections: 12,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        },
        {
          url: 'https://rpc-test.osmosis.zone',
          weight: 2,
          maxConnections: 10,
          timeout: 35000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        }
      ],
      maxConnections: 40,
      minConnections: 8,
      connectionTimeout: 30000,
      idleTimeout: 600000,
      maxRetries: 5,
      healthCheckInterval: 30000,
      retryDelay: 2000,
      circuitBreakerThreshold: 10,
      circuitBreakerTimeout: 120000,
      chainId: 'osmo-test-5',
      addressPrefix: 'osmo',
      gasPrice: '0.025uosmo'
    },
    'cosmoshub-4': {
      name: 'cosmos-hub-testnet',
      endpoints: [
        {
          url: 'https://rpc.testnet.cosmos.network',
          weight: 4,
          maxConnections: 12,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        },
        {
          url: 'https://cosmos-testnet-rpc.polkachu.com',
          weight: 3,
          maxConnections: 10,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 30000
        }
      ],
      maxConnections: 25,
      minConnections: 5,
      connectionTimeout: 30000,
      idleTimeout: 600000,
      maxRetries: 5,
      healthCheckInterval: 30000,
      retryDelay: 2000,
      circuitBreakerThreshold: 8,
      circuitBreakerTimeout: 120000,
      chainId: 'theta-testnet-001',
      addressPrefix: 'cosmos',
      gasPrice: '0.025uatom'
    }
  },
  monitoring: {
    metricsInterval: 60000,
    healthCheckInterval: 30000,
    logStats: false
  }
};

// Production configuration - high availability with multiple providers
export const productionPoolConfig: PoolManagerConfig = {
  ethereum: {
    mainnet: {
      name: 'ethereum-mainnet',
      endpoints: [
        // Tier 1 providers (highest weight)
        {
          url: 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
          weight: 5,
          maxConnections: 25,
          timeout: 20000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        {
          url: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY',
          weight: 5,
          maxConnections: 25,
          timeout: 20000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        // Tier 2 providers
        {
          url: 'https://mainnet.gateway.tenderly.co/YOUR_TENDERLY_KEY',
          weight: 4,
          maxConnections: 20,
          timeout: 25000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        {
          url: 'https://rpc.ankr.com/eth/YOUR_ANKR_KEY',
          weight: 4,
          maxConnections: 20,
          timeout: 25000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        // Backup providers (lower weight)
        {
          url: 'https://eth.llamarpc.com',
          weight: 2,
          maxConnections: 15,
          timeout: 30000,
          retryAttempts: 2,
          healthCheckInterval: 20000
        },
        {
          url: 'https://ethereum.publicnode.com',
          weight: 2,
          maxConnections: 15,
          timeout: 30000,
          retryAttempts: 2,
          healthCheckInterval: 20000
        }
      ],
      maxConnections: 120,
      minConnections: 20,
      connectionTimeout: 20000,
      idleTimeout: 300000, // 5 minutes in production
      maxRetries: 5,
      healthCheckInterval: 15000,
      retryDelay: 1000,
      circuitBreakerThreshold: 15,
      circuitBreakerTimeout: 180000,
      chainId: 1,
      throttleLimit: 50,
      throttleSlotInterval: 50
    }
  },
  cosmos: {
    'osmosis-1': {
      name: 'cosmos-osmosis-mainnet',
      endpoints: [
        // Primary RPC endpoints
        {
          url: 'https://rpc.osmosis.zone',
          weight: 5,
          maxConnections: 30,
          timeout: 20000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        {
          url: 'https://osmosis-rpc.polkachu.com',
          weight: 5,
          maxConnections: 30,
          timeout: 20000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        {
          url: 'https://osmosis-rpc.lavenderfive.com',
          weight: 4,
          maxConnections: 25,
          timeout: 25000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        // Secondary endpoints
        {
          url: 'https://rpc-osmosis.blockapsis.com',
          weight: 3,
          maxConnections: 20,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 20000
        },
        {
          url: 'https://osmosis-rpc.stakely.io',
          weight: 3,
          maxConnections: 20,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 20000
        }
      ],
      maxConnections: 125,
      minConnections: 25,
      connectionTimeout: 20000,
      idleTimeout: 300000,
      maxRetries: 5,
      healthCheckInterval: 15000,
      retryDelay: 1000,
      circuitBreakerThreshold: 15,
      circuitBreakerTimeout: 180000,
      chainId: 'osmosis-1',
      addressPrefix: 'osmo',
      gasPrice: '0.0025uosmo'
    },
    'cosmoshub-4': {
      name: 'cosmos-hub-mainnet',
      endpoints: [
        {
          url: 'https://rpc.cosmos.network',
          weight: 5,
          maxConnections: 20,
          timeout: 20000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        {
          url: 'https://cosmos-rpc.polkachu.com',
          weight: 5,
          maxConnections: 20,
          timeout: 20000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        {
          url: 'https://cosmos-rpc.lavenderfive.com',
          weight: 4,
          maxConnections: 18,
          timeout: 25000,
          retryAttempts: 3,
          healthCheckInterval: 15000
        },
        {
          url: 'https://rpc-cosmoshub.blockapsis.com',
          weight: 3,
          maxConnections: 15,
          timeout: 30000,
          retryAttempts: 3,
          healthCheckInterval: 20000
        }
      ],
      maxConnections: 75,
      minConnections: 15,
      connectionTimeout: 20000,
      idleTimeout: 300000,
      maxRetries: 5,
      healthCheckInterval: 15000,
      retryDelay: 1000,
      circuitBreakerThreshold: 12,
      circuitBreakerTimeout: 180000,
      chainId: 'cosmoshub-4',
      addressPrefix: 'cosmos',
      gasPrice: '0.025uatom'
    }
  },
  monitoring: {
    metricsInterval: 30000,
    healthCheckInterval: 15000,
    logStats: false // Let external monitoring handle this
  }
};

// High-frequency trading configuration - optimized for speed
export const hftPoolConfig: PoolManagerConfig = {
  ethereum: {
    mainnet: {
      name: 'ethereum-mainnet-hft',
      endpoints: [
        // Ultra-low latency endpoints only
        {
          url: 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
          weight: 10,
          maxConnections: 50,
          timeout: 5000,
          retryAttempts: 1, // Fast fail for HFT
          healthCheckInterval: 5000
        },
        {
          url: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY',
          weight: 10,
          maxConnections: 50,
          timeout: 5000,
          retryAttempts: 1,
          healthCheckInterval: 5000
        }
      ],
      maxConnections: 100,
      minConnections: 50, // Keep many connections warm
      connectionTimeout: 5000,
      idleTimeout: 60000, // Short idle timeout
      maxRetries: 1,
      healthCheckInterval: 5000,
      retryDelay: 100, // Very fast retry
      circuitBreakerThreshold: 3, // Fail fast
      circuitBreakerTimeout: 30000,
      chainId: 1,
      throttleLimit: 100,
      throttleSlotInterval: 10
    }
  },
  cosmos: {
    'osmosis-1': {
      name: 'cosmos-osmosis-hft',
      endpoints: [
        {
          url: 'https://rpc.osmosis.zone',
          weight: 10,
          maxConnections: 40,
          timeout: 5000,
          retryAttempts: 1,
          healthCheckInterval: 5000
        }
      ],
      maxConnections: 40,
      minConnections: 20,
      connectionTimeout: 5000,
      idleTimeout: 60000,
      maxRetries: 1,
      healthCheckInterval: 5000,
      retryDelay: 100,
      circuitBreakerThreshold: 3,
      circuitBreakerTimeout: 30000,
      chainId: 'osmosis-1',
      addressPrefix: 'osmo',
      gasPrice: '0.0025uosmo'
    }
  },
  monitoring: {
    metricsInterval: 10000, // More frequent monitoring
    healthCheckInterval: 5000,
    logStats: false
  }
};

// Configuration factory function
export function createPoolConfig(
  environment: 'development' | 'testnet' | 'production' | 'hft'
): PoolManagerConfig {
  switch (environment) {
    case 'development':
      return developmentPoolConfig;
    case 'testnet':
      return testnetPoolConfig;
    case 'production':
      return productionPoolConfig;
    case 'hft':
      return hftPoolConfig;
    default:
      throw new Error(`Unknown environment: ${environment}`);
  }
}

// Environment-specific configuration with environment variables
export function createPoolConfigFromEnv(): PoolManagerConfig {
  const environment = (process.env.NODE_ENV as any) || 'development';
  const baseConfig = createPoolConfig(environment);

  // Override with environment variables if present
  if (process.env.ETHEREUM_RPC_URLS) {
    const urls = process.env.ETHEREUM_RPC_URLS.split(',');
    const network = process.env.ETHEREUM_NETWORK || 'mainnet';
    
    if (baseConfig.ethereum && baseConfig.ethereum[network]) {
      (baseConfig.ethereum[network] as EthereumPoolConfig).endpoints = urls.map((url, _index) => ({
        url: url.trim(),
        weight: 1,
        maxConnections: 10,
        timeout: 30000,
        retryAttempts: 3,
        healthCheckInterval: 30000
      }));
    }
  }

  if (process.env.COSMOS_RPC_URLS) {
    const urls = process.env.COSMOS_RPC_URLS.split(',');
    const chainId = process.env.COSMOS_CHAIN_ID || 'osmosis-1';
    
    if (baseConfig.cosmos && baseConfig.cosmos[chainId]) {
      (baseConfig.cosmos[chainId] as CosmosPoolConfig).endpoints = urls.map((url) => ({
        url: url.trim(),
        weight: 1,
        maxConnections: 10,
        timeout: 30000,
        retryAttempts: 3,
        healthCheckInterval: 30000
      }));
    }
  }

  return baseConfig;
}
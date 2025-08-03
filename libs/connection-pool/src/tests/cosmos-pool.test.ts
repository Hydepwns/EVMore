/**
 * Cosmos Connection Pool Test Suite
 * Tests for CosmJS connection pooling
 */

import { StargateClient, SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { CosmosQueryConnectionPool, CosmosSigningConnectionPool } from '../cosmos-pool';
import { CosmosPoolConfig } from '../types';
import { Logger } from 'pino';

// Mock CosmJS modules
jest.mock('@cosmjs/stargate', () => ({
  StargateClient: {
    connect: jest.fn()
  },
  SigningStargateClient: {
    connectWithSigner: jest.fn()
  },
  GasPrice: {
    fromString: jest.fn().mockReturnValue({ gasPrice: 'mocked' })
  }
}));

jest.mock('@cosmjs/proto-signing', () => ({
  DirectSecp256k1HdWallet: {
    fromMnemonic: jest.fn()
  }
}));

describe('CosmosQueryConnectionPool', () => {
  let pool: CosmosQueryConnectionPool;
  let logger: Logger;
  let config: CosmosPoolConfig;
  let mockClient: any;

  beforeEach(() => {
    // Setup mock logger
    logger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    // Setup mock client
    mockClient = {
      getChainId: jest.fn().mockResolvedValue('osmosis-1'),
      getHeight: jest.fn().mockResolvedValue(1000000),
      getAccount: jest.fn().mockResolvedValue({
        address: 'osmo1test...',
        accountNumber: 123,
        sequence: 1
      }),
      disconnect: jest.fn(),
      queryContractSmart: jest.fn(),
      getTx: jest.fn()
    };

    // Mock StargateClient.connect
    (StargateClient.connect as jest.Mock).mockResolvedValue(mockClient);

    // Setup config
    config = {
      name: 'cosmos-test-pool',
      endpoints: [
        {
          url: 'https://rpc.osmosis.zone',
          weight: 2,
          maxConnections: 5,
          timeout: 30000
        },
        {
          url: 'https://osmosis-rpc.polkachu.com',
          weight: 1,
          maxConnections: 3,
          timeout: 30000
        }
      ],
      maxConnections: 8,
      minConnections: 2,
      connectionTimeout: 30000,
      idleTimeout: 300000,
      maxRetries: 3,
      healthCheckInterval: 30000,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      chainId: 'osmosis-1',
      addressPrefix: 'osmo',
      gasPrice: '0.025uosmo'
    };

    pool = new CosmosQueryConnectionPool(config, logger);
  });

  afterEach(async () => {
    if (pool) {
      await pool.stop();
    }
    jest.clearAllMocks();
  });

  describe('Connection Creation', () => {
    test('should create StargateClient with correct endpoint', async () => {
      await pool.start();

      expect(StargateClient.connect).toHaveBeenCalledWith(
        expect.stringMatching(/https:\/\/(rpc\.osmosis\.zone|osmosis-rpc\.polkachu\.com)/)
      );
    });

    test('should verify chain ID on connection', async () => {
      await pool.start();
      
      const { client, release } = await pool.getClient();
      
      expect(mockClient.getChainId).toHaveBeenCalled();
      release();
    });

    test('should reject wrong chain ID', async () => {
      mockClient.getChainId.mockResolvedValueOnce('cosmoshub-4');
      
      // Should fail during pool start
      await expect(pool.start()).rejects.toThrow('Chain ID mismatch');
    });

    test('should test connection with getHeight', async () => {
      await pool.start();
      
      expect(mockClient.getHeight).toHaveBeenCalled();
    });
  });

  describe('Client Management', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should get client from pool', async () => {
      const { client, release } = await pool.getClient();
      
      expect(client).toBe(mockClient);
      expect(typeof release).toBe('function');
      
      release();
    });

    test('should execute function with client', async () => {
      const height = await pool.withClient(async (client) => {
        return client.getHeight();
      });
      
      expect(height).toBe(1000000);
      expect(mockClient.getHeight).toHaveBeenCalled();
    });

    test('should release client after withClient', async () => {
      const stats1 = pool.getStats();
      
      await pool.withClient(async (client) => {
        const duringStats = pool.getStats();
        expect(duringStats.activeConnections).toBeGreaterThan(stats1.activeConnections);
        return client.getHeight();
      });
      
      const stats2 = pool.getStats();
      expect(stats2.activeConnections).toBe(stats1.activeConnections);
    });

    test('should handle errors in withClient', async () => {
      mockClient.getHeight.mockRejectedValueOnce(new Error('Query failed'));
      
      await expect(
        pool.withClient(async (client) => {
          return client.getHeight();
        })
      ).rejects.toThrow('Query failed');
      
      // Connection should still be released
      const stats = pool.getStats();
      expect(stats.activeConnections).toBe(0);
    });
  });

  describe('CosmWasm Queries', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should support queries', async () => {
      const height = 12345;
      
      mockClient.getHeight.mockResolvedValue(height);
      
      const result = await pool.withClient(async (client) => {
        return client.getHeight();
      });
      
      expect(result).toEqual(height);
      expect(mockClient.getHeight).toHaveBeenCalled();
    });
  });

  describe('Health Checking', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should check client health periodically', async () => {
      const initialHeightCalls = mockClient.getHeight.mock.calls.length;
      const initialChainIdCalls = mockClient.getChainId.mock.calls.length;
      
      // Wait for health check
      await new Promise(resolve => setTimeout(resolve, config.healthCheckInterval + 100));
      
      expect(mockClient.getHeight.mock.calls.length).toBeGreaterThan(initialHeightCalls);
      expect(mockClient.getChainId.mock.calls.length).toBeGreaterThan(initialChainIdCalls);
    });

    test('should mark unhealthy on query failure', async () => {
      mockClient.getHeight.mockRejectedValue(new Error('Network error'));
      
      // Force health check
      await new Promise(resolve => setTimeout(resolve, config.healthCheckInterval + 100));
      
      const stats = pool.getStats();
      expect(stats.endpoints.some(e => !e.isHealthy)).toBe(true);
    });
  });

  describe('Connection Cleanup', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should disconnect clients on close', async () => {
      const { client, release } = await pool.getClient();
      release();
      
      await pool.stop();
      
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });
});

describe('CosmosSigningConnectionPool', () => {
  let pool: CosmosSigningConnectionPool;
  let logger: Logger;
  let config: CosmosPoolConfig;
  let mockSigningClient: any;
  let mockWallet: any;

  beforeEach(() => {
    // Setup mock logger
    logger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    // Setup mock wallet
    mockWallet = {
      getAccounts: jest.fn().mockResolvedValue([
        { address: 'osmo1test...', algo: 'secp256k1', pubkey: new Uint8Array() }
      ])
    };

    // Setup mock signing client
    mockSigningClient = {
      getChainId: jest.fn().mockResolvedValue('osmosis-1'),
      getHeight: jest.fn().mockResolvedValue(1000000),
      getAccount: jest.fn().mockResolvedValue({
        address: 'osmo1test...',
        accountNumber: 123,
        sequence: 1
      }),
      sendTokens: jest.fn().mockResolvedValue({
        transactionHash: '0xABC123...',
        height: 1000001
      }),
      disconnect: jest.fn()
    };

    // Mock SigningStargateClient.connectWithSigner
    (SigningStargateClient.connectWithSigner as jest.Mock).mockResolvedValue(mockSigningClient);

    // Mock wallet creation
    (DirectSecp256k1HdWallet.fromMnemonic as jest.Mock).mockResolvedValue(mockWallet);

    // Setup config
    config = {
      name: 'cosmos-signing-test-pool',
      endpoints: [
        {
          url: 'https://rpc.osmosis.zone',
          weight: 2,
          maxConnections: 5,
          timeout: 30000
        }
      ],
      maxConnections: 5,
      minConnections: 0, // Signing pools create on-demand
      connectionTimeout: 30000,
      idleTimeout: 300000,
      maxRetries: 3,
      healthCheckInterval: 30000,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      chainId: 'osmosis-1',
      addressPrefix: 'osmo',
      gasPrice: '0.025uosmo'
    };

    pool = new CosmosSigningConnectionPool(config, logger);
  });

  afterEach(async () => {
    if (pool) {
      await pool.stop();
    }
    jest.clearAllMocks();
  });

  describe('Signing Client Creation', () => {
    test('should create signing client with wallet', async () => {
      await pool.start();
      
      const { client, release } = await pool.getSigningClient(mockWallet);
      
      expect(SigningStargateClient.connectWithSigner).toHaveBeenCalledWith(
        expect.any(String),
        mockWallet,
        expect.objectContaining({ gasPrice: expect.anything() })
      );
      
      expect(client).toBe(mockSigningClient);
      release();
    });

    test('should verify wallet has accounts', async () => {
      mockWallet.getAccounts.mockResolvedValueOnce([]);
      
      await pool.start();
      
      await expect(pool.getSigningClient(mockWallet)).rejects.toThrow('Wallet has no accounts');
    });

    test('should test account access', async () => {
      await pool.start();
      
      const { client, release } = await pool.getSigningClient(mockWallet);
      
      expect(mockSigningClient.getAccount).toHaveBeenCalledWith('osmo1test...');
      release();
    });
  });

  describe('Transaction Execution', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should execute transaction with signing client', async () => {
      const sender = 'osmo1sender...';
      const recipient = 'osmo1recipient...';
      const amount = [{ denom: 'uosmo', amount: '1000000' }];
      const fee = { amount: [{ denom: 'uosmo', amount: '2500' }], gas: '100000' };
      
      const result = await pool.withSigningClient(mockWallet, async (client) => {
        return client.sendTokens(sender, recipient, amount, fee);
      });
      
      expect(result.transactionHash).toBe('0xABC123...');
      expect(mockSigningClient.sendTokens).toHaveBeenCalledWith(sender, recipient, amount, fee);
    });

    test('should handle transaction errors', async () => {
      mockSigningClient.sendTokens.mockRejectedValue(new Error('Insufficient funds'));
      
      await expect(
        pool.withSigningClient(mockWallet, async (client) => {
          return client.sendTokens('osmo1...', 'osmo2...', [], 'auto');
        })
      ).rejects.toThrow('Insufficient funds');
    });
  });

  describe('Wallet Management', () => {
    test('should support multiple wallets', async () => {
      await pool.start();
      
      const wallet1 = { ...mockWallet };
      const wallet2 = { 
        ...mockWallet,
        getAccounts: jest.fn().mockResolvedValue([
          { address: 'osmo1other...', algo: 'secp256k1', pubkey: new Uint8Array() }
        ])
      };
      
      // Get clients for different wallets
      const { client: client1, release: release1 } = await pool.getSigningClient(wallet1);
      const { client: client2, release: release2 } = await pool.getSigningClient(wallet2);
      
      // Should create separate connections
      expect(SigningStargateClient.connectWithSigner).toHaveBeenCalledTimes(2);
      
      release1();
      release2();
    });
  });

  describe('Health Checking', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should check signing client health', async () => {
      const { client, release } = await pool.getSigningClient(mockWallet);
      
      // Health check should verify chain ID, height, and wallet
      expect(mockSigningClient.getChainId).toHaveBeenCalled();
      expect(mockSigningClient.getHeight).toHaveBeenCalled();
      expect(mockWallet.getAccounts).toHaveBeenCalled();
      
      release();
    });
  });

  describe('Gas Price Configuration', () => {
    test('should use configured gas price', async () => {
      await pool.start();
      
      const { client, release } = await pool.getSigningClient(mockWallet);
      
      expect(SigningStargateClient.connectWithSigner).toHaveBeenCalledWith(
        expect.any(String),
        mockWallet,
        expect.objectContaining({ gasPrice: { gasPrice: 'mocked' } })
      );
      
      release();
    });
  });
});

describe('Cosmos Pool Integration', () => {
  test('should handle concurrent queries and transactions', async () => {
    const queryPool = new CosmosQueryConnectionPool({
      name: 'query-pool',
      endpoints: [{ url: 'https://rpc.test.com', weight: 1 }],
      maxConnections: 5,
      minConnections: 2,
      connectionTimeout: 30000,
      idleTimeout: 300000,
      maxRetries: 3,
      healthCheckInterval: 30000,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      chainId: 'test-1',
      addressPrefix: 'test'
    }, {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any);

    const mockClient = {
      getChainId: jest.fn().mockResolvedValue('test-1'),
      getHeight: jest.fn().mockResolvedValue(1000),
      disconnect: jest.fn()
    };
    
    (StargateClient.connect as jest.Mock).mockResolvedValue(mockClient);

    await queryPool.start();

    // Execute multiple concurrent queries
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        queryPool.withClient(async (client) => {
          return client.getHeight();
        })
      );
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(10);
    expect(results.every(r => r === 1000)).toBe(true);

    await queryPool.stop();
  });
});
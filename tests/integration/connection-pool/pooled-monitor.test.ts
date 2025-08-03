/**
 * Integration tests for pooled monitors
 * Tests real-world scenarios with connection pooling
 */

import { ethers } from 'ethers';
import { Logger } from 'pino';
import { 
  ConnectionPoolManager, 
  EthereumConnectionPool,
  CosmosQueryConnectionPool,
  PoolManagerConfig 
} from '../../../shared/connection-pool';
import { PooledEthereumMonitor } from '../../../relayer/src/monitor/ethereum-monitor-pooled';
import { PooledCosmosMonitor } from '../../../relayer/src/monitor/cosmos-monitor-pooled';

// Mock dependencies
jest.mock('ethers');
jest.mock('@cosmjs/stargate');

describe('Pooled Monitor Integration Tests', () => {
  let poolManager: ConnectionPoolManager;
  let ethereumMonitor: PooledEthereumMonitor;
  let cosmosMonitor: PooledCosmosMonitor;
  let logger: Logger;
  let mockProvider: any;
  let mockCosmosClient: any;

  beforeEach(async () => {
    // Setup logger
    logger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    // Setup mock Ethereum provider
    mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 1, name: 'mainnet' }),
      getBlockNumber: jest.fn().mockResolvedValue(18000000),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      queryFilter: jest.fn().mockResolvedValue([])
    };

    // Setup mock contract
    const mockContract = {
      filters: {
        HTLCCreated: jest.fn().mockReturnValue({}),
        HTLCWithdrawn: jest.fn().mockReturnValue({}),
        HTLCRefunded: jest.fn().mockReturnValue({})
      },
      queryFilter: jest.fn().mockResolvedValue([])
    };

    // Mock ethers constructors
    (ethers.providers.JsonRpcProvider as jest.Mock).mockImplementation(() => mockProvider);
    (ethers.Contract as jest.Mock).mockImplementation(() => mockContract);

    // Setup mock Cosmos client
    mockCosmosClient = {
      getChainId: jest.fn().mockResolvedValue('osmosis-1'),
      getHeight: jest.fn().mockResolvedValue(1000000),
      searchTx: jest.fn().mockResolvedValue([]),
      disconnect: jest.fn()
    };

    const StargateClient = require('@cosmjs/stargate').StargateClient;
    StargateClient.connect = jest.fn().mockResolvedValue(mockCosmosClient);

    // Setup pool configuration
    const poolConfig: PoolManagerConfig = {
      ethereum: {
        mainnet: {
          name: 'ethereum-mainnet',
          endpoints: [
            { url: 'http://localhost:8545', weight: 1, maxConnections: 5 }
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
          chainId: 1
        }
      },
      cosmos: {
        'osmosis-1': {
          name: 'cosmos-osmosis',
          endpoints: [
            { url: 'http://localhost:26657', weight: 1, maxConnections: 5 }
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
          chainId: 'osmosis-1',
          addressPrefix: 'osmo',
          gasPrice: '0.025uosmo'
        }
      }
    };

    // Initialize pool manager
    poolManager = new ConnectionPoolManager(poolConfig, logger);
    await poolManager.start();

    // Initialize monitors
    const ethereumPool = poolManager.getEthereumPool('mainnet')!;
    const cosmosPool = poolManager.getCosmosQueryPool('osmosis-1')!;

    ethereumMonitor = new PooledEthereumMonitor(
      ethereumPool,
      '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
      logger
    );

    cosmosMonitor = new PooledCosmosMonitor(
      cosmosPool,
      'osmo1htlc...',
      'osmosis-1',
      logger
    );
  });

  afterEach(async () => {
    if (ethereumMonitor) await ethereumMonitor.stop();
    if (cosmosMonitor) await cosmosMonitor.stop();
    if (poolManager) await poolManager.stop();
    jest.clearAllMocks();
  });

  describe('Ethereum Monitor with Connection Pool', () => {
    test('should start monitoring with pooled connections', async () => {
      await ethereumMonitor.start();
      
      const health = ethereumMonitor.getHealth();
      expect(health.running).toBe(true);
      expect(health.poolStats).toBeDefined();
      expect(health.poolStats.totalConnections).toBeGreaterThan(0);
    });

    test('should handle HTLC events using pooled connections', async () => {
      const mockEvent = {
        args: {
          htlcId: '0x' + '1'.repeat(64),
          sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: ethers.BigNumber.from('1000000'),
          hashlock: '0x' + '2'.repeat(64),
          timelock: Math.floor(Date.now() / 1000) + 3600,
          targetChain: 'osmosis-1',
          targetAddress: 'osmo1...'
        },
        blockNumber: 18000001,
        transactionHash: '0x' + '3'.repeat(64),
        logIndex: 0
      };

      const mockContract = ethers.Contract as jest.MockedClass<typeof ethers.Contract>;
      mockContract.prototype.queryFilter = jest.fn().mockResolvedValue([mockEvent]);

      const eventHandler = jest.fn();
      ethereumMonitor.onHTLCCreated(eventHandler);

      await ethereumMonitor.start();
      
      // Trigger event processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          htlcId: mockEvent.args.htlcId,
          sender: mockEvent.args.sender,
          targetChain: mockEvent.args.targetChain
        })
      );
    });

    test('should handle connection pool failures gracefully', async () => {
      // Simulate pool exhaustion
      const ethereumPool = poolManager.getEthereumPool('mainnet')!;
      
      // Get all available connections
      const connections = [];
      for (let i = 0; i < 10; i++) {
        try {
          const { provider, release } = await ethereumPool.getProvider();
          connections.push({ provider, release });
        } catch {
          break;
        }
      }

      // Monitor should handle connection unavailability
      await expect(ethereumMonitor.start()).resolves.not.toThrow();

      // Release connections
      connections.forEach(({ release }) => release());
    });

    test('should track pool statistics during operation', async () => {
      await ethereumMonitor.start();
      
      // Simulate some activity
      mockProvider.getBlockNumber
        .mockResolvedValueOnce(18000001)
        .mockResolvedValueOnce(18000002)
        .mockResolvedValueOnce(18000003);

      await new Promise(resolve => setTimeout(resolve, 200));

      const health = ethereumMonitor.getHealth();
      const poolStats = health.poolStats;
      
      expect(poolStats.requestsServed).toBeGreaterThan(0);
      expect(poolStats.endpoints).toHaveLength(1);
      expect(poolStats.endpoints[0].isHealthy).toBe(true);
    });
  });

  describe('Cosmos Monitor with Connection Pool', () => {
    test('should start monitoring with pooled connections', async () => {
      await cosmosMonitor.start();
      
      const health = cosmosMonitor.getHealth();
      expect(health.running).toBe(true);
      expect(health.poolStats).toBeDefined();
      expect(health.poolStats.totalConnections).toBeGreaterThan(0);
    });

    test('should process Cosmos HTLC events', async () => {
      const mockTx = {
        hash: 'ABC123...',
        code: 0,
        events: [{
          type: 'wasm',
          attributes: [
            { key: Buffer.from('_contract_address').toString('base64'), value: Buffer.from('osmo1htlc...').toString('base64') },
            { key: Buffer.from('action').toString('base64'), value: Buffer.from('create_htlc').toString('base64') },
            { key: Buffer.from('htlc_id').toString('base64'), value: Buffer.from('0x' + '4'.repeat(64)).toString('base64') },
            { key: Buffer.from('sender').toString('base64'), value: Buffer.from('osmo1sender...').toString('base64') },
            { key: Buffer.from('amount').toString('base64'), value: Buffer.from('[{"denom":"uosmo","amount":"1000000"}]').toString('base64') }
          ]
        }]
      };

      mockCosmosClient.searchTx.mockResolvedValue([mockTx]);

      const eventHandler = jest.fn();
      cosmosMonitor.onHTLCCreated(eventHandler);

      await cosmosMonitor.start();
      
      // Trigger event processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          htlcId: '0x' + '4'.repeat(64),
          sender: 'osmo1sender...',
          type: 'created'
        })
      );
    });

    test('should handle connection pool health checks', async () => {
      await cosmosMonitor.start();
      
      // Wait for health check interval
      await new Promise(resolve => setTimeout(resolve, 100));

      const health = cosmosMonitor.getHealth();
      expect(health.running).toBe(true);
      expect(health.errorCount).toBe(0);
      
      // Pool should have performed health checks
      const poolStats = health.poolStats;
      expect(poolStats.endpoints[0].lastCheck).toBeGreaterThan(0);
    });
  });

  describe('Multi-Chain Monitoring', () => {
    test('should coordinate multiple monitors with shared pool manager', async () => {
      // Start both monitors
      await Promise.all([
        ethereumMonitor.start(),
        cosmosMonitor.start()
      ]);

      // Both should be running with healthy pools
      expect(ethereumMonitor.getHealth().running).toBe(true);
      expect(cosmosMonitor.getHealth().running).toBe(true);

      // Check pool manager stats
      const managerStats = poolManager.getStats();
      expect(managerStats.pools).toHaveLength(2);
      expect(managerStats.totalConnections).toBeGreaterThanOrEqual(4); // Min 2 per pool
      expect(managerStats.unhealthyPools).toHaveLength(0);
    });

    test('should handle cross-chain event correlation', async () => {
      const htlcId = '0x' + '5'.repeat(64);
      
      // Setup Ethereum HTLC created event
      const ethEvent = {
        args: {
          htlcId,
          sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
          targetChain: 'osmosis-1',
          targetAddress: 'osmo1receiver...'
        },
        blockNumber: 18000001,
        transactionHash: '0x' + 'e'.repeat(64),
        logIndex: 0
      };

      // Setup Cosmos HTLC withdrawn event
      const cosmosTx = {
        hash: 'CDE456...',
        code: 0,
        events: [{
          type: 'wasm',
          attributes: [
            { key: Buffer.from('_contract_address').toString('base64'), value: Buffer.from('osmo1htlc...').toString('base64') },
            { key: Buffer.from('action').toString('base64'), value: Buffer.from('withdraw').toString('base64') },
            { key: Buffer.from('htlc_id').toString('base64'), value: Buffer.from(htlcId).toString('base64') }
          ]
        }]
      };

      const ethContract = ethers.Contract as jest.MockedClass<typeof ethers.Contract>;
      ethContract.prototype.queryFilter = jest.fn()
        .mockResolvedValueOnce([ethEvent])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockCosmosClient.searchTx.mockResolvedValue([cosmosTx]);

      const ethCreatedHandler = jest.fn();
      const cosmosWithdrawnHandler = jest.fn();

      ethereumMonitor.onHTLCCreated(ethCreatedHandler);
      cosmosMonitor.onHTLCWithdrawn(cosmosWithdrawnHandler);

      await Promise.all([
        ethereumMonitor.start(),
        cosmosMonitor.start()
      ]);

      // Wait for events to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Both handlers should have been called with the same HTLC ID
      expect(ethCreatedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ htlcId })
      );
      expect(cosmosWithdrawnHandler).toHaveBeenCalledWith(
        expect.objectContaining({ htlcId })
      );
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should recover from temporary connection failures', async () => {
      let failureCount = 0;
      const originalGetBlockNumber = mockProvider.getBlockNumber;
      
      mockProvider.getBlockNumber.mockImplementation(() => {
        failureCount++;
        if (failureCount <= 2) {
          return Promise.reject(new Error('Temporary network error'));
        }
        return originalGetBlockNumber();
      });

      await ethereumMonitor.start();
      
      // Wait for retry attempts
      await new Promise(resolve => setTimeout(resolve, 300));

      // Monitor should recover and continue
      const health = ethereumMonitor.getHealth();
      expect(health.running).toBe(true);
      expect(health.errorCount).toBeGreaterThan(0);
    });

    test('should handle circuit breaker activation', async () => {
      // Force multiple failures to trigger circuit breaker
      mockProvider.getBlockNumber.mockRejectedValue(new Error('Network error'));

      await ethereumMonitor.start();
      
      // Wait for circuit breaker to activate
      await new Promise(resolve => setTimeout(resolve, 500));

      const health = ethereumMonitor.getHealth();
      const poolStats = health.poolStats;
      
      // Circuit breaker should be open
      expect(poolStats.circuitBreakerOpen).toBe(true);
      expect(poolStats.endpoints[0].isHealthy).toBe(false);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle high event volume efficiently', async () => {
      // Generate many events
      const events = [];
      for (let i = 0; i < 100; i++) {
        events.push({
          args: {
            htlcId: '0x' + i.toString().padStart(64, '0'),
            sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
            token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            amount: ethers.BigNumber.from('1000000'),
            hashlock: '0x' + '2'.repeat(64),
            timelock: Math.floor(Date.now() / 1000) + 3600,
            targetChain: 'osmosis-1',
            targetAddress: 'osmo1...'
          },
          blockNumber: 18000001 + i,
          transactionHash: '0x' + i.toString().padStart(64, '0'),
          logIndex: 0
        });
      }

      const ethContract = ethers.Contract as jest.MockedClass<typeof ethers.Contract>;
      ethContract.prototype.queryFilter = jest.fn().mockResolvedValue(events);

      let processedCount = 0;
      ethereumMonitor.onHTLCCreated(async () => {
        processedCount++;
      });

      await ethereumMonitor.start();
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(processedCount).toBe(100);
      
      // Check pool performance
      const poolStats = ethereumMonitor.getHealth().poolStats;
      expect(poolStats.averageLatency).toBeLessThan(100); // Should be fast
    });

    test('should maintain pool efficiency under load', async () => {
      const startTime = Date.now();
      
      // Start monitors
      await Promise.all([
        ethereumMonitor.start(),
        cosmosMonitor.start()
      ]);

      // Simulate continuous operations
      const operations = [];
      for (let i = 0; i < 50; i++) {
        operations.push(
          ethereumMonitor.getHealth(),
          cosmosMonitor.getHealth()
        );
      }

      await Promise.all(operations);
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete quickly

      // Check pool utilization
      const stats = poolManager.getStats();
      expect(stats.totalRequestsServed).toBeGreaterThanOrEqual(100);
      expect(stats.averageLatency).toBeLessThan(50);
    });
  });
});
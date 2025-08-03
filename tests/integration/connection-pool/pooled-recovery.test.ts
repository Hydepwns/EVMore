/**
 * Integration tests for pooled recovery service
 * Tests automated HTLC recovery with connection pooling
 */

import { ethers } from 'ethers';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { Logger } from 'pino';
import { 
  ConnectionPoolManager,
  PoolManagerConfig 
} from '../../../shared/connection-pool';
import { PooledRecoveryService } from '../../../relayer/src/recovery/recovery-service-pooled';
import { AppConfig } from '../../../relayer/src/config';

// Mock dependencies
jest.mock('ethers');
jest.mock('@cosmjs/stargate');
jest.mock('@cosmjs/proto-signing');
jest.mock('../../../relayer/src/monitoring/prometheus-metrics', () => ({
  getMetrics: () => ({
    recordRecoveryCheck: jest.fn(),
    recordRecoveryAttempt: jest.fn()
  })
}));

describe('Pooled Recovery Service Integration Tests', () => {
  let poolManager: ConnectionPoolManager;
  let recoveryService: PooledRecoveryService;
  let logger: Logger;
  let mockProvider: any;
  let mockCosmosClient: any;
  let mockWallet: any;
  let mockEthereumWallet: any;
  let mockHTLCContract: any;
  let config: AppConfig;

  beforeEach(async () => {
    // Setup logger
    logger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    // Setup mock Ethereum provider and contract
    mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 1, name: 'mainnet' }),
      getBlockNumber: jest.fn().mockResolvedValue(18000000),
      on: jest.fn(),
      removeAllListeners: jest.fn()
    };

    mockHTLCContract = {
      filters: {
        HTLCCreated: jest.fn().mockReturnValue({})
      },
      queryFilter: jest.fn().mockResolvedValue([]),
      htlcs: jest.fn().mockResolvedValue({
        sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: ethers.BigNumber.from('1000000'),
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) - 3600, // Expired
        withdrawn: false,
        refunded: false,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1...'
      }),
      refund: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0x' + 'r'.repeat(64),
          gasUsed: ethers.BigNumber.from('100000')
        })
      }),
      estimateGas: {
        refund: jest.fn().mockResolvedValue(ethers.BigNumber.from('100000'))
      },
      connect: jest.fn().mockReturnThis()
    };

    mockEthereumWallet = {
      getAddress: jest.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b8D91c8c99096ba34e'),
      connect: jest.fn().mockReturnThis()
    };

    (ethers.providers.JsonRpcProvider as jest.Mock).mockImplementation(() => mockProvider);
    (ethers.Wallet as jest.Mock).mockImplementation(() => mockEthereumWallet);
    (ethers.Contract as jest.Mock).mockImplementation(() => mockHTLCContract);

    // Setup mock Cosmos client
    mockCosmosClient = {
      getChainId: jest.fn().mockResolvedValue('osmosis-1'),
      getHeight: jest.fn().mockResolvedValue(1000000),
      getAccount: jest.fn().mockResolvedValue({
        address: 'osmo1test...',
        accountNumber: 123,
        sequence: 1
      }),
      queryContractSmart: jest.fn().mockResolvedValue({
        htlcs: []
      }),
      execute: jest.fn().mockResolvedValue({
        code: 0,
        transactionHash: 'COSMOS_REFUND_TX',
        height: 1000001,
        gasUsed: 150000
      }),
      disconnect: jest.fn()
    };

    const SigningStargateClient = require('@cosmjs/stargate').SigningStargateClient;
    SigningStargateClient.connectWithSigner = jest.fn().mockResolvedValue(mockCosmosClient);

    // Setup mock wallet
    mockWallet = {
      getAccounts: jest.fn().mockResolvedValue([
        { address: 'osmo1test...', algo: 'secp256k1', pubkey: new Uint8Array() }
      ])
    };

    (DirectSecp256k1HdWallet.fromMnemonic as jest.Mock).mockResolvedValue(mockWallet);

    // Setup configuration
    config = {
      general: {
        name: 'test-relayer',
        port: 3000,
        logLevel: 'info'
      },
      ethereum: {
        chainId: 1,
        rpcUrl: 'http://localhost:8545',
        htlcContractAddress: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
        resolverContractAddress: '0x...',
        privateKey: '0x' + '1'.repeat(64),
        confirmations: 1,
        gasPrice: '20'
      },
      cosmos: {
        chainId: 'osmosis-1',
        rpcUrl: 'http://localhost:26657',
        restUrl: 'http://localhost:1317',
        addressPrefix: 'osmo',
        denom: 'uosmo',
        gasPrice: '0.025uosmo',
        htlcContractAddress: 'osmo1htlc...',
        routerContractAddress: 'osmo1router...',
        mnemonic: 'test test test test test test test test test test test junk',
        chains: [{
          chainId: 'osmosis-1',
          rpcUrl: 'http://localhost:26657',
          restUrl: 'http://localhost:1317',
          addressPrefix: 'osmo',
          denom: 'uosmo',
          gasPrice: '0.025uosmo',
          htlcContractAddress: 'osmo1htlc...',
          routerContractAddress: 'osmo1router...',
          mnemonic: 'test test test test test test test test test test test junk'
        }]
      },
      chainRegistry: {
        registryContract: 'osmo1registry...',
        cacheTimeout: 300,
        refreshInterval: 600
      }
    } as AppConfig;

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

    // Initialize recovery service
    recoveryService = new PooledRecoveryService(poolManager, config, logger);
  });

  afterEach(async () => {
    if (recoveryService) await recoveryService.stop();
    if (poolManager) await poolManager.stop();
    jest.clearAllMocks();
  });

  describe('Service Lifecycle', () => {
    test('should start recovery service with pooled connections', async () => {
      await recoveryService.start();
      
      const health = recoveryService.getHealth();
      expect(health.running).toBe(true);
      expect(health.poolStats).toBeDefined();
      expect(health.poolStats.totalConnections).toBeGreaterThan(0);
    });

    test('should stop recovery service cleanly', async () => {
      await recoveryService.start();
      await recoveryService.stop();
      
      const health = recoveryService.getHealth();
      expect(health.running).toBe(false);
    });
  });

  describe('Ethereum HTLC Recovery', () => {
    test('should detect and refund expired Ethereum HTLCs', async () => {
      // Setup expired HTLC event
      const expiredEvent = {
        args: {
          htlcId: '0x' + '1'.repeat(64),
          sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e', // Our address
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: ethers.BigNumber.from('1000000'),
          hashlock: '0x' + '2'.repeat(64),
          timelock: Math.floor(Date.now() / 1000) - 3600, // Expired
          targetChain: 'osmosis-1',
          targetAddress: 'osmo1...'
        },
        blockNumber: 17999999,
        transactionHash: '0x' + 'e'.repeat(64)
      };

      mockHTLCContract.queryFilter.mockResolvedValue([expiredEvent]);
      mockProvider.getBlockNumber.mockResolvedValue(18000000);

      await recoveryService.start();

      // Wait for recovery check
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockHTLCContract.refund).toHaveBeenCalledWith(
        '0x' + '1'.repeat(64),
        expect.any(Object)
      );

      const stats = recoveryService.getStats();
      expect(stats.htlcsChecked).toBeGreaterThan(0);
      expect(stats.htlcsRefunded).toBe(1);
    });

    test('should skip HTLCs we are not the sender of', async () => {
      // Setup expired HTLC with different sender
      const expiredEvent = {
        args: {
          htlcId: '0x' + '2'.repeat(64),
          sender: '0x0000000000000000000000000000000000000001', // Not our address
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: ethers.BigNumber.from('1000000'),
          hashlock: '0x' + '2'.repeat(64),
          timelock: Math.floor(Date.now() / 1000) - 3600, // Expired
          targetChain: 'osmosis-1',
          targetAddress: 'osmo1...'
        },
        blockNumber: 17999999,
        transactionHash: '0x' + 'f'.repeat(64)
      };

      mockHTLCContract.queryFilter.mockResolvedValue([expiredEvent]);
      mockHTLCContract.htlcs.mockResolvedValue({
        ...mockHTLCContract.htlcs.mock.results[0].value,
        sender: '0x0000000000000000000000000000000000000001'
      });

      await recoveryService.start();

      // Wait for recovery check
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockHTLCContract.refund).not.toHaveBeenCalled();

      const stats = recoveryService.getStats();
      expect(stats.htlcsChecked).toBeGreaterThan(0);
      expect(stats.htlcsRefunded).toBe(0);
    });

    test('should handle already refunded HTLCs', async () => {
      const event = {
        args: {
          htlcId: '0x' + '3'.repeat(64),
          sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e'
        },
        blockNumber: 17999999
      };

      mockHTLCContract.queryFilter.mockResolvedValue([event]);
      mockHTLCContract.htlcs.mockResolvedValue({
        ...mockHTLCContract.htlcs.mock.results[0].value,
        refunded: true
      });

      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockHTLCContract.refund).not.toHaveBeenCalled();
    });

    test('should retry failed refunds', async () => {
      const event = {
        args: {
          htlcId: '0x' + '4'.repeat(64),
          sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e'
        },
        blockNumber: 17999999
      };

      mockHTLCContract.queryFilter.mockResolvedValue([event]);
      
      // First two attempts fail, third succeeds
      let attempts = 0;
      mockHTLCContract.refund.mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Transaction failed'));
        }
        return {
          wait: jest.fn().mockResolvedValue({
            status: 1,
            transactionHash: '0x' + 'r'.repeat(64),
            gasUsed: ethers.BigNumber.from('100000')
          })
        };
      });

      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(mockHTLCContract.refund).toHaveBeenCalledTimes(3);
      expect(recoveryService.getStats().htlcsRefunded).toBe(1);
    });
  });

  describe('Cosmos HTLC Recovery', () => {
    test('should detect and refund expired Cosmos HTLCs', async () => {
      // Setup expired HTLC in query response
      const expiredHTLC = {
        id: '0x' + '5'.repeat(64),
        sender: 'osmo1test...', // Our address
        receiver: 'osmo1receiver...',
        amount: [{ denom: 'uosmo', amount: '1000000' }],
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) - 3600, // Expired
        withdrawn: false,
        refunded: false
      };

      mockCosmosClient.queryContractSmart.mockResolvedValue({
        htlcs: [expiredHTLC]
      });

      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockCosmosClient.execute).toHaveBeenCalledWith(
        'osmo1test...',
        'osmo1htlc...',
        { refund: { htlc_id: expiredHTLC.id } },
        'auto',
        'HTLC refund'
      );

      const stats = recoveryService.getStats();
      expect(stats.htlcsRefunded).toBe(1);
    });

    test('should handle multiple Cosmos chains', async () => {
      // Add another chain to config
      config.cosmos.chains = [
        config.cosmos.chains![0],
        {
          ...config.cosmos.chains![0],
          chainId: 'cosmoshub-4',
          addressPrefix: 'cosmos',
          htlcContractAddress: 'cosmos1htlc...'
        }
      ];

      // Reinitialize with multiple chains
      recoveryService = new PooledRecoveryService(poolManager, config, logger);

      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should query both chains
      expect(mockCosmosClient.queryContractSmart).toHaveBeenCalledTimes(2);
    });

    test('should handle Cosmos query failures gracefully', async () => {
      mockCosmosClient.queryContractSmart.mockRejectedValue(new Error('Query failed'));

      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Service should continue running despite error
      expect(recoveryService.getHealth().running).toBe(true);
      expect(recoveryService.getStats().errors).toBeGreaterThan(0);
    });
  });

  describe('Pool Integration', () => {
    test('should use connection pools efficiently', async () => {
      // Setup multiple expired HTLCs
      const events = [];
      for (let i = 0; i < 5; i++) {
        events.push({
          args: {
            htlcId: '0x' + i.toString().padStart(64, '0'),
            sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e'
          },
          blockNumber: 17999990 + i
        });
      }

      mockHTLCContract.queryFilter.mockResolvedValue(events);

      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check pool usage
      const poolStats = poolManager.getStats();
      expect(poolStats.totalRequestsServed).toBeGreaterThan(5);
      expect(poolStats.unhealthyPools).toHaveLength(0);
    });

    test('should handle pool exhaustion during recovery', async () => {
      // Exhaust Ethereum pool
      const ethereumPool = poolManager.getEthereumPool('mainnet')!;
      const connections = [];
      
      for (let i = 0; i < 10; i++) {
        try {
          const { provider, release } = await ethereumPool.getProvider();
          connections.push({ provider, release });
        } catch {
          break;
        }
      }

      // Recovery should handle pool unavailability
      await recoveryService.start();
      
      // Release connections
      connections.forEach(({ release }) => release());
      
      await new Promise(resolve => setTimeout(resolve, 200));

      // Service should continue running
      expect(recoveryService.getHealth().running).toBe(true);
    });

    test('should recover from connection failures', async () => {
      // Simulate temporary network failure
      let failCount = 0;
      const originalQueryFilter = mockHTLCContract.queryFilter;
      mockHTLCContract.queryFilter.mockImplementation(() => {
        failCount++;
        if (failCount <= 2) {
          return Promise.reject(new Error('Network error'));
        }
        return originalQueryFilter();
      });

      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 300));

      // Should eventually succeed
      expect(failCount).toBeGreaterThan(2);
      expect(recoveryService.getHealth().running).toBe(true);
    });
  });

  describe('Monitoring and Metrics', () => {
    test('should track recovery statistics', async () => {
      const events = [
        {
          args: {
            htlcId: '0x' + '6'.repeat(64),
            sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e'
          },
          blockNumber: 17999999
        }
      ];

      mockHTLCContract.queryFilter.mockResolvedValue(events);

      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = recoveryService.getStats();
      expect(stats.lastCheckTime).toBeGreaterThan(0);
      expect(stats.htlcsChecked).toBeGreaterThan(0);
      expect(stats.htlcsRefunded).toBe(1);
      expect(stats.errors).toBe(0);
    });

    test('should expose health information', async () => {
      await recoveryService.start();
      
      const health = recoveryService.getHealth();
      expect(health).toMatchObject({
        running: true,
        lastCheckTime: expect.any(Number),
        htlcsChecked: expect.any(Number),
        htlcsRefunded: expect.any(Number),
        errors: expect.any(Number),
        poolStats: expect.objectContaining({
          totalConnections: expect.any(Number)
        })
      });
    });

    test('should integrate with Prometheus metrics', async () => {
      const { getMetrics } = require('../../../relayer/src/monitoring/prometheus-metrics');
      const mockMetrics = getMetrics();

      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockMetrics.recordRecoveryCheck).toHaveBeenCalledWith('started');
      expect(mockMetrics.recordRecoveryCheck).toHaveBeenCalledWith('completed', expect.any(Number));
    });
  });

  describe('Long-Running Operations', () => {
    test('should perform periodic checks', async () => {
      let checkCount = 0;
      mockHTLCContract.queryFilter.mockImplementation(() => {
        checkCount++;
        return Promise.resolve([]);
      });

      // Start with very short check interval for testing
      recoveryService['checkInterval'] = 50; // 50ms
      
      await recoveryService.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(checkCount).toBeGreaterThan(2);
    });

    test('should maintain pool health during continuous operation', async () => {
      await recoveryService.start();
      
      // Simulate running for a while
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const health = recoveryService.getHealth();
        expect(health.running).toBe(true);
      }

      const finalStats = poolManager.getStats();
      expect(finalStats.unhealthyPools).toHaveLength(0);
      expect(finalStats.circuitBreakersPopen).toHaveLength(0);
    });
  });
});
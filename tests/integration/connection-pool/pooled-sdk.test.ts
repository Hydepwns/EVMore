/**
 * Integration tests for pooled SDK clients
 * Tests cross-chain HTLC operations with connection pooling
 */

import { ethers } from 'ethers';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { Logger } from 'pino';
import { 
  ConnectionPoolManager,
  EthereumConnectionPool,
  CosmosQueryConnectionPool,
  CosmosSigningConnectionPool,
  PoolManagerConfig 
} from '../../../shared/connection-pool';
import { PooledEthereumHTLCClient } from '../../../sdk/src/client/ethereum-htlc-client-pooled';
import { PooledCosmosHTLCClient } from '../../../sdk/src/client/cosmos-htlc-client-pooled';

// Mock dependencies
jest.mock('ethers');
jest.mock('@cosmjs/stargate');
jest.mock('@cosmjs/proto-signing');

describe('Pooled SDK Client Integration Tests', () => {
  let poolManager: ConnectionPoolManager;
  let ethereumClient: PooledEthereumHTLCClient;
  let cosmosClient: PooledCosmosHTLCClient;
  let logger: Logger;
  let mockProvider: any;
  let mockCosmosClient: any;
  let mockWallet: any;
  let mockSigner: any;

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
      getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from('20000000000')),
      on: jest.fn(),
      removeAllListeners: jest.fn()
    };

    // Setup mock signer
    mockSigner = {
      getAddress: jest.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b8D91c8c99096ba34e'),
      connect: jest.fn().mockReturnThis(),
      sendTransaction: jest.fn()
    };

    // Setup mock contracts
    const mockHTLCContract = {
      createHTLC: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          status: 1,
          logs: [{
            topics: ['0x...'],
            data: '0x...'
          }],
          transactionHash: '0x' + 'a'.repeat(64)
        })
      }),
      withdraw: jest.fn(),
      refund: jest.fn(),
      getHTLC: jest.fn().mockResolvedValue({
        sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: ethers.BigNumber.from('1000000'),
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
        withdrawn: false,
        refunded: false,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1...'
      }),
      estimateGas: {
        createHTLC: jest.fn().mockResolvedValue(ethers.BigNumber.from('200000')),
        withdraw: jest.fn().mockResolvedValue(ethers.BigNumber.from('150000')),
        refund: jest.fn().mockResolvedValue(ethers.BigNumber.from('100000'))
      },
      interface: {
        parseLog: jest.fn().mockReturnValue({
          name: 'HTLCCreated',
          args: { htlcId: '0x' + '1'.repeat(64) }
        })
      },
      connect: jest.fn().mockReturnThis()
    };

    const mockTokenContract = {
      allowance: jest.fn().mockResolvedValue(ethers.BigNumber.from('0')),
      approve: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ status: 1 })
      }),
      balanceOf: jest.fn().mockResolvedValue(ethers.BigNumber.from('10000000')),
      decimals: jest.fn().mockResolvedValue(6),
      symbol: jest.fn().mockResolvedValue('USDC'),
      name: jest.fn().mockResolvedValue('USD Coin')
    };

    // Mock ethers constructors
    (ethers.providers.JsonRpcProvider as jest.Mock).mockImplementation(() => mockProvider);
    (ethers.Wallet as jest.Mock).mockImplementation(() => mockSigner);
    (ethers.Contract as jest.Mock).mockImplementation((address, abi) => {
      if (abi.length > 10) { // HTLC contract has more functions
        return mockHTLCContract;
      }
      return mockTokenContract;
    });

    // Setup mock Cosmos client
    mockCosmosClient = {
      getChainId: jest.fn().mockResolvedValue('osmosis-1'),
      getHeight: jest.fn().mockResolvedValue(1000000),
      getAccount: jest.fn().mockResolvedValue({
        address: 'osmo1test...',
        accountNumber: 123,
        sequence: 1
      }),
      getBalance: jest.fn().mockResolvedValue({
        denom: 'uosmo',
        amount: '10000000'
      }),
      execute: jest.fn().mockResolvedValue({
        code: 0,
        transactionHash: 'ABC123...',
        height: 1000001,
        gasUsed: 150000
      }),
      queryContractSmart: jest.fn().mockResolvedValue({
        sender: 'osmo1sender...',
        receiver: 'osmo1receiver...',
        amount: [{ denom: 'uosmo', amount: '1000000' }],
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
        withdrawn: false,
        refunded: false,
        target_chain: 'ethereum-1',
        target_address: '0x...'
      }),
      simulate: jest.fn().mockResolvedValue(200000),
      disconnect: jest.fn()
    };

    const SigningStargateClient = require('@cosmjs/stargate').SigningStargateClient;
    SigningStargateClient.connectWithSigner = jest.fn().mockResolvedValue(mockCosmosClient);

    const StargateClient = require('@cosmjs/stargate').StargateClient;
    StargateClient.connect = jest.fn().mockResolvedValue(mockCosmosClient);

    // Setup mock wallet
    mockWallet = {
      getAccounts: jest.fn().mockResolvedValue([
        { address: 'osmo1test...', algo: 'secp256k1', pubkey: new Uint8Array() }
      ])
    };

    (DirectSecp256k1HdWallet.fromMnemonic as jest.Mock).mockResolvedValue(mockWallet);

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

    // Initialize SDK clients
    const ethereumPool = poolManager.getEthereumPool('mainnet')!;
    const cosmosQueryPool = poolManager.getCosmosQueryPool('osmosis-1')!;
    const cosmosSigningPool = poolManager.getCosmosSigningPool('osmosis-1')!;

    ethereumClient = new PooledEthereumHTLCClient(
      ethereumPool,
      {
        htlcContract: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
        chainId: 1,
        privateKey: '0x' + '1'.repeat(64)
      }
    );

    cosmosClient = new PooledCosmosHTLCClient(
      cosmosQueryPool,
      cosmosSigningPool,
      {
        chainId: 'osmosis-1',
        htlcContract: 'osmo1htlc...',
        addressPrefix: 'osmo',
        denom: 'uosmo'
      }
    );
  });

  afterEach(async () => {
    if (poolManager) await poolManager.stop();
    jest.clearAllMocks();
  });

  describe('Ethereum HTLC Client with Pooling', () => {
    test('should create HTLC using pooled connection', async () => {
      const params = {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: '1000000',
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver...'
      };

      const htlcId = await ethereumClient.createHTLC(params);
      
      expect(htlcId).toBe('0x' + '1'.repeat(64));
      expect(mockTokenContract.approve).toHaveBeenCalled();
      expect(mockHTLCContract.createHTLC).toHaveBeenCalled();
    });

    test('should handle token approval with connection pool', async () => {
      // Set allowance to require approval
      mockTokenContract.allowance.mockResolvedValue(ethers.BigNumber.from('0'));
      mockTokenContract.balanceOf.mockResolvedValue(ethers.BigNumber.from('10000000'));

      const params = {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: '1000000',
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver...'
      };

      await ethereumClient.createHTLC(params);

      expect(mockTokenContract.approve).toHaveBeenCalledWith(
        ethereumClient['config'].htlcContract,
        ethers.BigNumber.from('1000000')
      );
    });

    test('should get HTLC details using pooled connection', async () => {
      const htlcId = '0x' + '1'.repeat(64);
      const details = await ethereumClient.getHTLCDetails(htlcId);

      expect(details).toMatchObject({
        htlcId,
        sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
        withdrawn: false,
        refunded: false
      });
    });

    test('should estimate gas with connection pool', async () => {
      const params = {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: '1000000',
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver...'
      };

      const gasEstimate = await ethereumClient.estimateCreateHTLCGas(params);

      expect(gasEstimate.gasEstimate).toBe('200000');
      expect(gasEstimate.gasPrice).toBeDefined();
      expect(gasEstimate.estimatedCost).toBeDefined();
    });

    test('should track pool statistics during operations', async () => {
      // Perform multiple operations
      const operations = [];
      for (let i = 0; i < 5; i++) {
        operations.push(
          ethereumClient.getHTLCDetails('0x' + i.toString().padStart(64, '0'))
        );
      }

      await Promise.all(operations);

      const poolStats = ethereumClient.getPoolStats();
      expect(poolStats.requestsServed).toBeGreaterThanOrEqual(5);
      expect(poolStats.totalConnections).toBeGreaterThan(0);
    });
  });

  describe('Cosmos HTLC Client with Pooling', () => {
    test('should initialize with mnemonic', async () => {
      const mnemonic = 'test test test test test test test test test test test junk';
      await cosmosClient.init(mnemonic);

      expect(cosmosClient.getSenderAddress()).toBe('osmo1test...');
    });

    test('should create HTLC using pooled connection', async () => {
      await cosmosClient.connect(mockWallet);

      const params = {
        receiver: 'osmo1receiver...',
        amount: '1000000',
        denom: 'uosmo',
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'ethereum-1',
        targetAddress: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e'
      };

      // Mock successful transaction result with HTLC ID
      mockCosmosClient.execute.mockResolvedValue({
        code: 0,
        transactionHash: 'ABC123...',
        height: 1000001,
        gasUsed: 150000,
        events: [{
          type: 'wasm',
          attributes: [
            { key: Buffer.from('htlc_id').toString('base64'), value: Buffer.from('0x' + '3'.repeat(64)).toString('base64') }
          ]
        }]
      });

      const htlcId = await cosmosClient.createHTLC(params);
      
      expect(htlcId).toBe('0x' + '3'.repeat(64));
      expect(mockCosmosClient.execute).toHaveBeenCalledWith(
        'osmo1test...',
        'osmo1htlc...',
        expect.objectContaining({ create_htlc: expect.any(Object) }),
        expect.any(Object),
        expect.any(String),
        expect.any(Array)
      );
    });

    test('should get HTLC details using query pool', async () => {
      const htlcId = '0x' + '3'.repeat(64);
      const details = await cosmosClient.getHTLCDetails(htlcId);

      expect(details).toMatchObject({
        htlcId,
        sender: 'osmo1sender...',
        withdrawn: false,
        refunded: false
      });

      expect(mockCosmosClient.queryContractSmart).toHaveBeenCalledWith(
        'osmo1htlc...',
        { get_htlc: { htlc_id: htlcId } }
      );
    });

    test('should get balance using query pool', async () => {
      const balance = await cosmosClient.getBalance('osmo1test...', 'uosmo');
      
      expect(balance).toEqual({
        amount: '10000000',
        denom: 'uosmo'
      });
    });

    test('should track separate pool statistics', async () => {
      await cosmosClient.connect(mockWallet);

      // Perform operations that use both pools
      await cosmosClient.getHTLCDetails('0x' + '1'.repeat(64)); // Uses query pool
      await cosmosClient.getBalance(); // Uses query pool

      const poolStats = cosmosClient.getPoolStats();
      
      expect(poolStats.query.requestsServed).toBeGreaterThanOrEqual(2);
      expect(poolStats.signing.requestsServed).toBe(0); // No signing operations yet
    });
  });

  describe('Cross-Chain HTLC Flow', () => {
    test('should handle complete cross-chain swap flow', async () => {
      // 1. Create HTLC on Ethereum
      const ethParams = {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: '1000000',
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver...'
      };

      const ethHtlcId = await ethereumClient.createHTLC(ethParams);
      expect(ethHtlcId).toBeDefined();

      // 2. Check HTLC exists
      const exists = await ethereumClient.htlcExists(ethHtlcId);
      expect(exists).toBe(true);

      // 3. Create corresponding HTLC on Cosmos
      await cosmosClient.connect(mockWallet);
      
      const cosmosParams = {
        receiver: 'osmo1receiver...',
        amount: '1000000',
        denom: 'uosmo',
        hashlock: ethParams.hashlock,
        timelock: ethParams.timelock - 1800, // 30 minutes earlier
        targetChain: 'ethereum-1',
        targetAddress: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e'
      };

      mockCosmosClient.execute.mockResolvedValue({
        code: 0,
        transactionHash: 'ABC123...',
        height: 1000001,
        gasUsed: 150000,
        events: [{
          type: 'wasm',
          attributes: [
            { key: Buffer.from('htlc_id').toString('base64'), value: Buffer.from('0x' + '4'.repeat(64)).toString('base64') }
          ]
        }]
      });

      const cosmosHtlcId = await cosmosClient.createHTLC(cosmosParams);
      expect(cosmosHtlcId).toBeDefined();

      // 4. Simulate withdraw on Cosmos
      mockHTLCContract.getHTLC.mockResolvedValueOnce({
        ...mockHTLCContract.getHTLC.mock.results[0].value,
        withdrawn: false
      });

      const secret = '0x' + '5'.repeat(64);
      const withdrawResult = await cosmosClient.withdraw(cosmosHtlcId, secret);
      
      expect(withdrawResult.success).toBe(true);
      expect(withdrawResult.transactionHash).toBe('ABC123...');

      // 5. Use secret to withdraw on Ethereum
      mockHTLCContract.withdraw.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0x' + 'b'.repeat(64),
          gasUsed: ethers.BigNumber.from('150000')
        })
      });

      const ethWithdrawResult = await ethereumClient.withdraw(ethHtlcId, secret);
      
      expect(ethWithdrawResult.success).toBe(true);
      expect(ethWithdrawResult.transactionHash).toBe('0x' + 'b'.repeat(64));
    });

    test('should handle refund scenario with pooled connections', async () => {
      const htlcId = '0x' + '6'.repeat(64);
      
      // Setup expired HTLC
      mockHTLCContract.getHTLC.mockResolvedValue({
        sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: ethers.BigNumber.from('1000000'),
        hashlock: '0x' + '2'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) - 3600, // Expired
        withdrawn: false,
        refunded: false,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1...'
      });

      mockHTLCContract.refund.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0x' + 'c'.repeat(64),
          gasUsed: ethers.BigNumber.from('100000')
        })
      });

      const refundResult = await ethereumClient.refund(htlcId);
      
      expect(refundResult.success).toBe(true);
      expect(mockHTLCContract.refund).toHaveBeenCalledWith(htlcId, expect.any(Object));
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle pool exhaustion gracefully', async () => {
      // Exhaust the pool
      const connections = [];
      const ethereumPool = poolManager.getEthereumPool('mainnet')!;
      
      for (let i = 0; i < 10; i++) {
        try {
          const { provider, release } = await ethereumPool.getProvider();
          connections.push({ provider, release });
        } catch {
          break;
        }
      }

      // SDK operations should queue or fail gracefully
      const getDetailsPromise = ethereumClient.getHTLCDetails('0x' + '1'.repeat(64));
      
      // Release a connection
      if (connections.length > 0) {
        connections[0].release();
      }

      // Operation should complete
      await expect(getDetailsPromise).resolves.toBeDefined();

      // Cleanup
      connections.forEach(({ release }) => release());
    });

    test('should retry on transient failures', async () => {
      let attempts = 0;
      mockHTLCContract.getHTLC.mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          sender: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e',
          withdrawn: false,
          refunded: false
        });
      });

      // Should eventually succeed
      const details = await ethereumClient.getHTLCDetails('0x' + '1'.repeat(64));
      expect(details).toBeDefined();
      expect(attempts).toBe(3);
    });

    test('should handle circuit breaker activation', async () => {
      // Force many failures to trigger circuit breaker
      mockProvider.getNetwork.mockRejectedValue(new Error('Network down'));
      mockProvider.getBlockNumber.mockRejectedValue(new Error('Network down'));

      // Wait for circuit breaker
      await new Promise(resolve => setTimeout(resolve, 200));

      // New operations should fail fast
      await expect(
        ethereumClient.getHTLCDetails('0x' + '1'.repeat(64))
      ).rejects.toThrow();

      // Check pool health
      const poolStats = ethereumClient.getPoolStats();
      expect(poolStats.circuitBreakerOpen).toBe(true);
    });
  });

  describe('Performance and Concurrency', () => {
    test('should handle concurrent operations efficiently', async () => {
      const operations = [];
      
      // Mix of Ethereum operations
      for (let i = 0; i < 10; i++) {
        operations.push(
          ethereumClient.getHTLCDetails('0x' + i.toString().padStart(64, '0')),
          ethereumClient.htlcExists('0x' + i.toString().padStart(64, '0'))
        );
      }

      // Mix of Cosmos operations
      for (let i = 0; i < 10; i++) {
        operations.push(
          cosmosClient.getHTLCDetails('0x' + i.toString().padStart(64, '0')),
          cosmosClient.getBalance('osmo1test...', 'uosmo')
        );
      }

      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(40);
      expect(duration).toBeLessThan(1000); // Should be fast with pooling

      // Check pool utilization
      const managerStats = poolManager.getStats();
      expect(managerStats.totalRequestsServed).toBeGreaterThanOrEqual(40);
    });

    test('should maintain pool efficiency under sustained load', async () => {
      const iterations = 20;
      const opsPerIteration = 5;
      
      for (let i = 0; i < iterations; i++) {
        const operations = [];
        
        for (let j = 0; j < opsPerIteration; j++) {
          operations.push(
            ethereumClient.getTokenInfo('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
            cosmosClient.getBalance()
          );
        }

        await Promise.all(operations);
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const stats = poolManager.getStats();
      expect(stats.totalRequestsServed).toBeGreaterThanOrEqual(iterations * opsPerIteration * 2);
      expect(stats.averageLatency).toBeLessThan(100); // Should maintain low latency
      expect(stats.unhealthyPools).toHaveLength(0); // All pools should remain healthy
    });
  });
});
/**
 * End-to-End Cross-Chain Swap Integration Tests
 * Tests complete swap flows from Ethereum to Osmosis with state persistence
 */

import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { Logger } from 'pino';
import pino from 'pino';
import { EthereumMonitor } from '../../src/monitor/ethereum-monitor';
import { CosmosMonitor } from '../../src/monitor/cosmos-monitor';
import { RelayService } from '../../src/relay/relay-service';
import { RouteDiscovery } from '../../src/routes/route-discovery';
import { RecoveryService } from '../../src/recovery/recovery-service';
import { MultiHopManager } from '../../src/ibc/multi-hop-manager';
import { PersistenceManager } from '../../src/persistence/persistence-manager';
import { CircuitBreaker } from '../../src/utils/circuit-breaker';
import { RateLimiter } from '../../src/security/rate-limiter';
import {
  MockEthereumClient,
  MockCosmosClient,
  MockChainRegistry,
  createTestLogger,
  createTestConfig,
  waitForEvent,
  sleep,
} from './setup';

// Mock external dependencies
jest.mock('../../src/persistence/persistence-manager');
jest.mock('../../src/utils/circuit-breaker');
jest.mock('../../src/security/rate-limiter');

// Test constants
const TEST_SECRET = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const TEST_HASHLOCK = ethers.utils.sha256(TEST_SECRET);
const TEST_TIMEOUT = 30000; // 30 seconds for integration tests

describe('Cross-Chain Swap E2E Integration Tests', () => {
  let ethereumClient: MockEthereumClient;
  let cosmosClient: MockCosmosClient;
  let chainRegistry: MockChainRegistry;
  let ethereumMonitor: EthereumMonitor;
  let cosmosMonitor: CosmosMonitor;
  let relayService: RelayService;
  let routeDiscovery: RouteDiscovery;
  let recoveryService: RecoveryService;
  let multiHopManager: MultiHopManager;
  let persistenceManager: jest.Mocked<PersistenceManager>;
  let circuitBreaker: jest.Mocked<CircuitBreaker>;
  let rateLimiter: jest.Mocked<RateLimiter>;
  
  const logger = createTestLogger();
  const config = createTestConfig();

  // Helper to create mock persistence
  const mockPersistence = {
    saveSwap: jest.fn(),
    updateSwapStatus: jest.fn(),
    getSwap: jest.fn(),
    getAllPendingSwaps: jest.fn().mockResolvedValue([]),
    deleteSwap: jest.fn(),
    saveEvent: jest.fn(),
    getLastProcessedBlock: jest.fn().mockResolvedValue(0),
    updateLastProcessedBlock: jest.fn(),
  };

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock clients
    ethereumClient = new MockEthereumClient();
    cosmosClient = new MockCosmosClient();
    chainRegistry = new MockChainRegistry();

    // Setup persistence manager
    persistenceManager = new (jest.requireMock('../../src/persistence/persistence-manager').PersistenceManager)();
    Object.assign(persistenceManager, mockPersistence);

    // Setup circuit breaker
    circuitBreaker = new (jest.requireMock('../../src/utils/circuit-breaker').CircuitBreaker)();
    circuitBreaker.isOpen = jest.fn().mockReturnValue(false);
    circuitBreaker.execute = jest.fn().mockImplementation((fn) => fn());

    // Setup rate limiter
    rateLimiter = new (jest.requireMock('../../src/security/rate-limiter').RateLimiter)();
    rateLimiter.checkLimit = jest.fn().mockResolvedValue(true);

    // Create real services with mocked dependencies
    ethereumMonitor = new EthereumMonitor(config.ethereum, logger);
    cosmosMonitor = new CosmosMonitor(config.cosmos, logger);
    routeDiscovery = new RouteDiscovery(chainRegistry as any, logger);
    multiHopManager = new MultiHopManager(chainRegistry as any, logger);
    
    // Create relay service with all dependencies
    relayService = new RelayService(
      ethereumMonitor,
      cosmosMonitor,
      routeDiscovery,
      multiHopManager,
      persistenceManager as any,
      circuitBreaker as any,
      logger
    );

    // Create recovery service
    recoveryService = new RecoveryService(
      ethereumMonitor,
      cosmosMonitor,
      persistenceManager as any,
      logger
    );
  });

  afterEach(async () => {
    // Stop all services
    await ethereumMonitor.stop();
    await cosmosMonitor.stop();
    await relayService.stop();
    await recoveryService.stop();
  });

  describe('Full Ethereum → Osmosis Swap Flow', () => {
    it('should complete a full swap from Ethereum to Osmosis with state persistence', async () => {
      // Test data
      const swapParams = {
        sender: '0x1234567890123456789012345678901234567890',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        amount: ethers.utils.parseUnits('1000', 6), // 1000 USDC
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1234567890abcdefghijklmnopqrstuvwxyz',
        hashlock: TEST_HASHLOCK,
        timelock: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      };

      // Step 1: Create HTLC on Ethereum
      const htlcId = ethereumClient.createHTLC(swapParams);
      
      // Verify persistence
      await sleep(150); // Wait for event emission
      expect(mockPersistence.saveSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          htlcId,
          sourceChain: 'ethereum',
          targetChain: 'osmosis-1',
          status: 'created',
          amount: swapParams.amount.toString(),
        })
      );

      // Step 2: Start monitoring and relay services
      await ethereumMonitor.start();
      await cosmosMonitor.start();
      await relayService.start();

      // Step 3: Wait for relay service to process the event
      await sleep(500);

      // Verify route discovery was used
      expect(persistenceManager.updateSwapStatus).toHaveBeenCalledWith(
        htlcId,
        'route_discovered'
      );

      // Step 4: Verify IBC transfer was initiated
      expect(persistenceManager.updateSwapStatus).toHaveBeenCalledWith(
        htlcId,
        'ibc_initiated'
      );

      // Step 5: Simulate IBC completion
      const ibcCompleteEvent = await waitForEvent(cosmosClient as any, 'IBCTransferComplete', 5000);
      expect(ibcCompleteEvent).toBeDefined();
      expect(ibcCompleteEvent.memo).toContain(htlcId);

      // Step 6: Verify HTLC creation on Osmosis
      const cosmosHTLCId = `cosmos_${htlcId}`;
      expect(persistenceManager.updateSwapStatus).toHaveBeenCalledWith(
        htlcId,
        'target_htlc_created'
      );

      // Step 7: Reveal secret on target chain
      cosmosClient.withdraw(cosmosHTLCId, TEST_SECRET);
      await sleep(200);

      // Step 8: Verify secret propagation back to source
      expect(persistenceManager.updateSwapStatus).toHaveBeenCalledWith(
        htlcId,
        'completed'
      );

      // Verify final state
      const finalSwap = await persistenceManager.getSwap(htlcId);
      expect(finalSwap).toMatchObject({
        status: 'completed',
        secret: TEST_SECRET,
      });
    }, TEST_TIMEOUT);

    it('should handle multi-hop routing through Cosmos Hub', async () => {
      // Setup multi-hop route: Ethereum → Cosmos Hub → Osmosis
      const swapParams = {
        sender: '0x1234567890123456789012345678901234567890',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: ethers.utils.parseUnits('500', 6),
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1234567890abcdefghijklmnopqrstuvwxyz',
        hashlock: TEST_HASHLOCK,
        timelock: Math.floor(Date.now() / 1000) + 7200, // 2 hours
      };

      // Mock route discovery to return multi-hop path
      jest.spyOn(routeDiscovery, 'findBestRoute').mockResolvedValue({
        path: ['ethereum', 'cosmoshub-4', 'osmosis-1'],
        channels: ['channel-0', 'channel-141'],
        estimatedFee: '10000',
        estimatedTime: 600,
      });

      const htlcId = ethereumClient.createHTLC(swapParams);
      
      await ethereumMonitor.start();
      await relayService.start();
      
      // Wait for processing
      await sleep(1000);

      // Verify multi-hop was detected
      expect(persistenceManager.saveEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'multi_hop_initiated',
          htlcId,
          hops: 2,
        })
      );

      // Verify timelock cascade
      const timelockCalls = mockPersistence.saveEvent.mock.calls
        .filter(call => call[0].type === 'hop_timelock_set');
      
      expect(timelockCalls).toHaveLength(2);
      expect(timelockCalls[0][0].timelock).toBeGreaterThan(timelockCalls[1][0].timelock);
    });

    it('should recover from relay failures with persistence', async () => {
      const swapParams = {
        sender: '0x1234567890123456789012345678901234567890',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: ethers.utils.parseUnits('100', 6),
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1234567890abcdefghijklmnopqrstuvwxyz',
        hashlock: TEST_HASHLOCK,
        timelock: Math.floor(Date.now() / 1000) + 1800,
      };

      // Simulate a failure during IBC transfer
      let callCount = 0;
      jest.spyOn(multiHopManager, 'initiateTransfer').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network timeout');
        }
        return { success: true, txHash: 'mock_tx_hash' };
      });

      const htlcId = ethereumClient.createHTLC(swapParams);
      
      await ethereumMonitor.start();
      await relayService.start();
      await recoveryService.start();

      // Wait for initial failure
      await sleep(500);
      
      // Verify failure was persisted
      expect(persistenceManager.updateSwapStatus).toHaveBeenCalledWith(
        htlcId,
        'failed'
      );
      expect(persistenceManager.saveEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'relay_error',
          error: 'Network timeout',
        })
      );

      // Wait for recovery service to retry
      await sleep(2000);

      // Verify retry succeeded
      expect(persistenceManager.updateSwapStatus).toHaveBeenCalledWith(
        htlcId,
        'ibc_initiated'
      );
    });

    it('should handle concurrent swaps with rate limiting', async () => {
      const swapPromises = [];
      const swapIds = [];

      // Create 5 concurrent swaps
      for (let i = 0; i < 5; i++) {
        const swapParams = {
          sender: '0x1234567890123456789012345678901234567890',
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: ethers.utils.parseUnits(String(100 + i * 10), 6),
          targetChain: 'osmosis-1',
          targetAddress: `osmo${i}234567890abcdefghijklmnopqrstuvwxyz`,
          hashlock: ethers.utils.sha256(`0x${i}${TEST_SECRET.slice(3)}`),
          timelock: Math.floor(Date.now() / 1000) + 3600,
        };

        const htlcId = ethereumClient.createHTLC(swapParams);
        swapIds.push(htlcId);
      }

      await ethereumMonitor.start();
      await relayService.start();

      // Wait for processing
      await sleep(2000);

      // Verify all swaps were saved
      expect(mockPersistence.saveSwap).toHaveBeenCalledTimes(5);

      // Verify rate limiting was checked
      expect(rateLimiter.checkLimit).toHaveBeenCalledTimes(5);

      // Verify concurrent processing
      const processingEvents = mockPersistence.saveEvent.mock.calls
        .filter(call => call[0].type === 'processing_started')
        .map(call => call[0].timestamp);
      
      // Check that multiple swaps were processed in parallel
      const timeDiffs = processingEvents.slice(1).map((t, i) => t - processingEvents[i]);
      const parallelProcessing = timeDiffs.some(diff => diff < 100); // Less than 100ms apart
      expect(parallelProcessing).toBe(true);
    });

    it('should handle database rollback on failed swaps', async () => {
      const swapParams = {
        sender: '0x1234567890123456789012345678901234567890',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: ethers.utils.parseUnits('1000', 6),
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1234567890abcdefghijklmnopqrstuvwxyz',
        hashlock: TEST_HASHLOCK,
        timelock: Math.floor(Date.now() / 1000) + 300, // Only 5 minutes - will timeout
      };

      // Mock a critical failure after partial completion
      jest.spyOn(multiHopManager, 'initiateTransfer').mockImplementation(async () => {
        // Simulate partial state updates
        await persistenceManager.saveEvent({
          type: 'partial_update_1',
          htlcId: 'test',
          data: 'some_data',
        });
        await persistenceManager.saveEvent({
          type: 'partial_update_2',
          htlcId: 'test',
          data: 'more_data',
        });
        
        // Then fail
        throw new Error('Critical failure - invalid state');
      });

      // Mock transaction/rollback support
      persistenceManager.beginTransaction = jest.fn();
      persistenceManager.commitTransaction = jest.fn();
      persistenceManager.rollbackTransaction = jest.fn();

      const htlcId = ethereumClient.createHTLC(swapParams);
      
      await ethereumMonitor.start();
      await relayService.start();

      // Wait for failure
      await sleep(1000);

      // Verify transaction was started and rolled back
      expect(persistenceManager.beginTransaction).toHaveBeenCalled();
      expect(persistenceManager.rollbackTransaction).toHaveBeenCalled();
      expect(persistenceManager.commitTransaction).not.toHaveBeenCalled();

      // Verify swap status reflects failure
      expect(persistenceManager.updateSwapStatus).toHaveBeenCalledWith(
        htlcId,
        'failed_rollback'
      );
    });

    it('should maintain state consistency across service restarts', async () => {
      // Create initial swap
      const swapParams = {
        sender: '0x1234567890123456789012345678901234567890',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: ethers.utils.parseUnits('750', 6),
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1234567890abcdefghijklmnopqrstuvwxyz',
        hashlock: TEST_HASHLOCK,
        timelock: Math.floor(Date.now() / 1000) + 3600,
      };

      const htlcId = ethereumClient.createHTLC(swapParams);
      
      // Start services
      await ethereumMonitor.start();
      await relayService.start();

      // Wait for partial processing
      await sleep(300);

      // Simulate service crash by stopping everything
      await ethereumMonitor.stop();
      await relayService.stop();

      // Mock persistence to return the partially processed swap
      mockPersistence.getAllPendingSwaps.mockResolvedValue([{
        htlcId,
        status: 'ibc_initiated',
        sourceChain: 'ethereum',
        targetChain: 'osmosis-1',
        amount: swapParams.amount.toString(),
        hashlock: swapParams.hashlock,
        timelock: swapParams.timelock,
        createdAt: new Date(),
      }]);

      // Restart services
      await ethereumMonitor.start();
      await relayService.start();
      await recoveryService.start();

      // Wait for recovery
      await sleep(1000);

      // Verify swap was resumed from correct state
      expect(persistenceManager.saveEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'swap_resumed',
          htlcId,
          previousStatus: 'ibc_initiated',
        })
      );
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should halt processing when circuit breaker opens', async () => {
      // Configure circuit breaker to open after 2 failures
      let failureCount = 0;
      circuitBreaker.execute.mockImplementation(async (fn) => {
        failureCount++;
        if (failureCount >= 2) {
          circuitBreaker.isOpen.mockReturnValue(true);
          throw new Error('Circuit breaker is open');
        }
        return fn();
      });

      // Create multiple swaps that will fail
      for (let i = 0; i < 3; i++) {
        ethereumClient.createHTLC({
          sender: '0x1234567890123456789012345678901234567890',
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: ethers.utils.parseUnits('100', 6),
          targetChain: 'invalid-chain', // Will cause failures
          targetAddress: 'invalid',
          hashlock: TEST_HASHLOCK,
          timelock: Math.floor(Date.now() / 1000) + 3600,
        });
      }

      await ethereumMonitor.start();
      await relayService.start();

      await sleep(1000);

      // Verify circuit breaker opened
      expect(circuitBreaker.isOpen()).toBe(true);

      // Verify persistence recorded circuit breaker state
      expect(persistenceManager.saveEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'circuit_breaker_opened',
          reason: 'Too many failures',
        })
      );
    });
  });

  describe('High Throughput Stress Testing', () => {
    it('should handle 100+ concurrent swaps efficiently', async () => {
      const startTime = Date.now();
      const swapCount = 100;
      const swapIds: string[] = [];

      // Configure services for high throughput
      relayService.setConcurrencyLimit(20); // Process 20 swaps in parallel

      // Create 100 swaps rapidly
      for (let i = 0; i < swapCount; i++) {
        const htlcId = ethereumClient.createHTLC({
          sender: `0x${i.toString().padStart(40, '0')}`,
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: ethers.utils.parseUnits(String(10 + i), 6),
          targetChain: 'osmosis-1',
          targetAddress: `osmo${i}234567890abcdefghijklmnopqrstuvwxyz`,
          hashlock: ethers.utils.sha256(`0x${i}${TEST_SECRET.slice(3)}`),
          timelock: Math.floor(Date.now() / 1000) + 7200,
        });
        swapIds.push(htlcId);
      }

      await ethereumMonitor.start();
      await relayService.start();

      // Monitor progress
      let processedCount = 0;
      const checkProgress = setInterval(() => {
        processedCount = mockPersistence.updateSwapStatus.mock.calls
          .filter(call => call[1] === 'ibc_initiated').length;
        logger.info(`Processed ${processedCount}/${swapCount} swaps`);
      }, 1000);

      // Wait for all swaps to be processed
      const maxWaitTime = 30000; // 30 seconds max
      const waitStart = Date.now();
      
      while (processedCount < swapCount && (Date.now() - waitStart) < maxWaitTime) {
        await sleep(500);
        processedCount = mockPersistence.updateSwapStatus.mock.calls
          .filter(call => call[1] === 'ibc_initiated').length;
      }

      clearInterval(checkProgress);

      const totalTime = Date.now() - startTime;
      const throughput = (swapCount / totalTime) * 1000; // Swaps per second

      // Verify all swaps were processed
      expect(processedCount).toBe(swapCount);

      // Verify throughput is acceptable (at least 5 swaps/second)
      expect(throughput).toBeGreaterThan(5);

      // Verify no swaps were lost
      const savedSwaps = mockPersistence.saveSwap.mock.calls.map(call => call[0].htlcId);
      expect(savedSwaps).toHaveLength(swapCount);
      expect(new Set(savedSwaps).size).toBe(swapCount); // All unique

      // Verify persistence handled the load
      expect(persistenceManager.saveEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'high_throughput_test',
          swapCount,
          duration: expect.any(Number),
          throughput: expect.any(Number),
        })
      );

      logger.info(`Stress test completed: ${swapCount} swaps in ${totalTime}ms (${throughput.toFixed(2)} swaps/sec)`);
    }, 60000); // 60 second timeout for stress test
  });
});
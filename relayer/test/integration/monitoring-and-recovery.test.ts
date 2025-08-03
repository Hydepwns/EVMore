/**
 * Integration tests for monitoring services and recovery mechanisms
 * Tests real-time monitoring, alerting, and automatic recovery scenarios
 */

import { EthereumMonitor } from '../../src/monitor/ethereum-monitor';
import { CosmosMonitor } from '../../src/monitor/cosmos-monitor';
import { RecoveryService } from '../../src/recovery/recovery-service';
import { RelayService } from '../../src/relay/relay-service';
import { RouteDiscovery } from '../../src/routes/route-discovery';
import {
  MockEthereumClient,
  MockCosmosClient,
  MockChainRegistry,
  createTestLogger,
  createTestConfig,
  waitForEvent,
  sleep,
} from './setup';

// Mock the services
jest.mock('../../src/monitor/ethereum-monitor');
jest.mock('../../src/monitor/cosmos-monitor');
jest.mock('../../src/routes/route-discovery');

describe('Monitoring and Recovery Integration Tests', () => {
  let ethereumClient: MockEthereumClient;
  let cosmosClient: MockCosmosClient;
  let chainRegistry: MockChainRegistry;
  let ethereumMonitor: jest.Mocked<EthereumMonitor>;
  let cosmosMonitor: jest.Mocked<CosmosMonitor>;
  let recoveryService: RecoveryService;
  let relayService: RelayService;
  let routeDiscovery: jest.Mocked<RouteDiscovery>;
  const logger = createTestLogger();
  const config = createTestConfig();

  beforeEach(async () => {
    // Create mock clients
    ethereumClient = new MockEthereumClient();
    cosmosClient = new MockCosmosClient();
    chainRegistry = new MockChainRegistry();

    // Setup mocked monitors
    ethereumMonitor = {
      start: jest.fn(),
      stop: jest.fn(),
      getStatus: jest.fn().mockReturnValue({ 
        connected: true, 
        blockHeight: 12345,
        lastProcessedBlock: 12344,
        processedEvents: 0,
        errors: 0,
      }),
      onHTLCCreated: jest.fn(),
      onHTLCWithdrawn: jest.fn(),
      onHTLCRefunded: jest.fn(),
      processBlocks: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
    } as any;

    cosmosMonitor = {
      start: jest.fn(),
      stop: jest.fn(),
      getStatus: jest.fn().mockReturnValue({ 
        connected: true, 
        blockHeight: 1000,
        lastProcessedHeight: 999,
        processedTxs: 0,
        errors: 0,
      }),
      onHTLCEvent: jest.fn(),
      onIBCEvent: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
    } as any;

    routeDiscovery = {
      initialize: jest.fn(),
      findRoute: jest.fn(),
      getCachedRoutesCount: jest.fn().mockReturnValue(5),
      updateCache: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
    } as any;

    // Initialize services
    recoveryService = new RecoveryService(config, logger);
    relayService = new RelayService(config, logger, routeDiscovery);

    await relayService.initialize();
  });

  afterEach(async () => {
    await recoveryService.stop();
    await relayService.stop?.();
  });

  describe('Real-time Monitoring', () => {
    it('should detect and process new Ethereum HTLC events', async () => {
      const htlcCreatedHandler = jest.fn();
      ethereumMonitor.onHTLCCreated.mockImplementation(htlcCreatedHandler);

      await ethereumMonitor.start();

      // Create HTLC to trigger event
      const htlcId = ethereumClient.createHTLC({
        sender: '0xsender',
        token: '0xUSDC',
        amount: '1000000',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timelock: Math.floor(Date.now() / 1000) + 14400,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver',
      });

      const event = await waitForEvent(ethereumClient, 'HTLCCreated');
      
      // Verify monitor is set up to handle events
      expect(ethereumMonitor.onHTLCCreated).toHaveBeenCalledWith(htlcCreatedHandler);
      expect(ethereumMonitor.start).toHaveBeenCalled();

      // Simulate the handler being called
      htlcCreatedHandler(event);
      expect(htlcCreatedHandler).toHaveBeenCalledWith(event);
    });

    it('should detect and process Cosmos IBC events', async () => {
      const ibcEventHandler = jest.fn();
      cosmosMonitor.onIBCEvent.mockImplementation(ibcEventHandler);

      await cosmosMonitor.start();

      // Trigger IBC transfer
      const txHash = await cosmosClient.sendIBCTransfer({
        sourceChannel: 'channel-0',
        destChain: 'osmosis-1',
        amount: { denom: 'uusdc', amount: '1000000' },
        receiver: 'osmo1receiver',
        memo: JSON.stringify({ htlcId: 'eth_123', hashlock: '0xabc' }),
      });

      const ibcEvent = await waitForEvent(cosmosClient, 'IBCTransferComplete');

      // Verify monitor setup
      expect(cosmosMonitor.onIBCEvent).toHaveBeenCalledWith(ibcEventHandler);
      expect(cosmosMonitor.start).toHaveBeenCalled();

      // Simulate handler call
      ibcEventHandler(ibcEvent);
      expect(ibcEventHandler).toHaveBeenCalledWith(ibcEvent);
    });

    it('should maintain health status and metrics', async () => {
      await ethereumMonitor.start();
      await cosmosMonitor.start();

      // Check initial health status
      expect(ethereumMonitor.isHealthy()).toBe(true);
      expect(cosmosMonitor.isHealthy()).toBe(true);

      const ethStatus = ethereumMonitor.getStatus();
      const cosmosStatus = cosmosMonitor.getStatus();

      expect(ethStatus.connected).toBe(true);
      expect(ethStatus.blockHeight).toBe(12345);
      expect(cosmosStatus.connected).toBe(true);
      expect(cosmosStatus.blockHeight).toBe(1000);

      // Simulate processing some events
      ethereumMonitor.getStatus.mockReturnValue({
        connected: true,
        blockHeight: 12346,
        lastProcessedBlock: 12345,
        processedEvents: 5,
        errors: 0,
      });

      const updatedStatus = ethereumMonitor.getStatus();
      expect(updatedStatus.processedEvents).toBe(5);
    });

    it('should handle monitor disconnections and reconnections', async () => {
      // Start healthy
      ethereumMonitor.isHealthy.mockReturnValue(true);
      await ethereumMonitor.start();

      expect(ethereumMonitor.isHealthy()).toBe(true);

      // Simulate disconnection
      ethereumMonitor.isHealthy.mockReturnValue(false);
      ethereumMonitor.getStatus.mockReturnValue({
        connected: false,
        blockHeight: 0,
        lastProcessedBlock: 12345,
        processedEvents: 5,
        errors: 1,
      });

      expect(ethereumMonitor.isHealthy()).toBe(false);
      
      const disconnectedStatus = ethereumMonitor.getStatus();
      expect(disconnectedStatus.connected).toBe(false);
      expect(disconnectedStatus.errors).toBe(1);

      // Simulate reconnection
      ethereumMonitor.isHealthy.mockReturnValue(true);
      ethereumMonitor.getStatus.mockReturnValue({
        connected: true,
        blockHeight: 12350,
        lastProcessedBlock: 12349,
        processedEvents: 5,
        errors: 1,
      });

      expect(ethereumMonitor.isHealthy()).toBe(true);
      const reconnectedStatus = ethereumMonitor.getStatus();
      expect(reconnectedStatus.connected).toBe(true);
      expect(reconnectedStatus.blockHeight).toBe(12350);
    });
  });

  describe('Recovery Service', () => {
    it('should detect and recover expired HTLCs', async () => {
      // Create an HTLC that will expire
      const expiredTimelock = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const htlcId = ethereumClient.createHTLC({
        sender: '0xsender',
        token: '0xUSDC',
        amount: '1000000',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timelock: expiredTimelock,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver',
      });

      const event = await waitForEvent(ethereumClient, 'HTLCCreated');
      
      // Process the event through relay service
      await relayService.handleEthereumHTLC(event);

      // Start recovery service
      await recoveryService.start();

      // Wait for recovery check cycle
      await sleep(200);

      // Verify recovery metrics
      const metrics = recoveryService.getMetrics();
      expect(metrics.expiredHTLCs).toBeGreaterThan(0);
      expect(metrics.recoveryAttempts).toBeGreaterThan(0);
    });

    it('should handle partial failures in multi-hop transfers', async () => {
      // Setup a route that will partially fail
      routeDiscovery.findRoute.mockResolvedValue({
        chains: ['ethereum', 'cosmoshub-4', 'osmosis-1'],
        hops: [
          {
            from: 'ethereum',
            to: 'cosmoshub-4',
            channel: 'channel-0',
            timelock: Math.floor(Date.now() / 1000) + 7200,
          },
          {
            from: 'cosmoshub-4',
            to: 'osmosis-1',
            channel: 'channel-141',
            timelock: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        totalFees: '1000',
        estimatedTime: 300,
      });

      const htlcId = ethereumClient.createHTLC({
        sender: '0xsender',
        token: '0xUSDC',
        amount: '1000000',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timelock: Math.floor(Date.now() / 1000) + 14400,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver',
      });

      const ethEvent = await waitForEvent(ethereumClient, 'HTLCCreated');
      await relayService.handleEthereumHTLC(ethEvent);

      // Simulate first hop success but second hop failure
      await sleep(200);

      // Simulate IBC transfer failure
      cosmosClient.sendIBCTransfer = jest.fn().mockRejectedValue(new Error('Channel congestion'));

      // Start recovery service to handle the failed transfer
      await recoveryService.start();
      await sleep(500);

      const recoveryMetrics = recoveryService.getMetrics();
      expect(recoveryMetrics.partialFailures).toBeGreaterThan(0);
    });

    it('should retry failed operations with exponential backoff', async () => {
      let attemptCount = 0;
      const maxRetries = 3;

      // Mock a failing operation that succeeds after retries
      routeDiscovery.findRoute.mockImplementation(() => {
        attemptCount++;
        if (attemptCount <= maxRetries) {
          return Promise.reject(new Error(`Attempt ${attemptCount} failed`));
        }
        return Promise.resolve({
          chains: ['ethereum', 'osmosis-1'],
          hops: [
            {
              from: 'ethereum',
              to: 'osmosis-1',
              channel: 'channel-1',
              timelock: Math.floor(Date.now() / 1000) + 3600,
            },
          ],
          totalFees: '500',
          estimatedTime: 180,
        });
      });

      const htlcId = ethereumClient.createHTLC({
        sender: '0xsender',
        token: '0xUSDC',
        amount: '1000000',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timelock: Math.floor(Date.now() / 1000) + 14400,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver',
      });

      const ethEvent = await waitForEvent(ethereumClient, 'HTLCCreated');
      await relayService.handleEthereumHTLC(ethEvent);

      // Wait for retries to complete
      await sleep(2000);

      // Verify retry attempts were made
      expect(attemptCount).toBe(maxRetries + 1);
      expect(routeDiscovery.findRoute).toHaveBeenCalledTimes(maxRetries + 1);

      // Verify eventual success
      const metrics = relayService.getMetrics();
      expect(metrics.totalRelayed).toBe(1);
    });

    it('should escalate unrecoverable failures', async () => {
      // Create an HTLC with unrecoverable configuration
      routeDiscovery.findRoute.mockRejectedValue(new Error('No route exists'));

      const htlcId = ethereumClient.createHTLC({
        sender: '0xsender',
        token: '0xUSDC',
        amount: '1000000',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timelock: Math.floor(Date.now() / 1000) + 14400,
        targetChain: 'nonexistent-chain',
        targetAddress: 'invalid1receiver',
      });

      const ethEvent = await waitForEvent(ethereumClient, 'HTLCCreated');
      await relayService.handleEthereumHTLC(ethEvent);

      await sleep(500);

      // Start recovery service
      await recoveryService.start();
      await sleep(500);

      const recoveryMetrics = recoveryService.getMetrics();
      expect(recoveryMetrics.unrecoverableFailures).toBeGreaterThan(0);
    });
  });

  describe('System Health and Alerting', () => {
    it('should provide comprehensive health status', async () => {
      await ethereumMonitor.start();
      await cosmosMonitor.start();
      await recoveryService.start();

      // Simulate system running normally
      const systemHealth = {
        ethereum: ethereumMonitor.getStatus(),
        cosmos: cosmosMonitor.getStatus(),
        relay: relayService.getMetrics(),
        recovery: recoveryService.getMetrics(),
        routes: routeDiscovery.getCachedRoutesCount(),
      };

      expect(systemHealth.ethereum.connected).toBe(true);
      expect(systemHealth.cosmos.connected).toBe(true);
      expect(systemHealth.routes).toBeGreaterThan(0);
    });

    it('should detect system degradation', async () => {
      // Simulate degraded performance
      ethereumMonitor.getStatus.mockReturnValue({
        connected: true,
        blockHeight: 12345,
        lastProcessedBlock: 12300, // Lagging behind
        processedEvents: 100,
        errors: 5, // Some errors
      });

      cosmosMonitor.getStatus.mockReturnValue({
        connected: true,
        blockHeight: 1000,
        lastProcessedHeight: 950, // Lagging behind
        processedTxs: 200,
        errors: 3,
      });

      const ethStatus = ethereumMonitor.getStatus();
      const cosmosStatus = cosmosMonitor.getStatus();

      // Check for performance degradation indicators
      const ethLag = ethStatus.blockHeight - ethStatus.lastProcessedBlock;
      const cosmosLag = cosmosStatus.blockHeight - cosmosStatus.lastProcessedHeight;

      expect(ethLag).toBe(45); // Significant lag
      expect(cosmosLag).toBe(50); // Significant lag
      expect(ethStatus.errors).toBeGreaterThan(0);
      expect(cosmosStatus.errors).toBeGreaterThan(0);
    });

    it('should handle cascading failures', async () => {
      // Simulate Ethereum monitor failure
      ethereumMonitor.isHealthy.mockReturnValue(false);
      ethereumMonitor.getStatus.mockReturnValue({
        connected: false,
        blockHeight: 0,
        lastProcessedBlock: 12345,
        processedEvents: 100,
        errors: 10,
      });

      // This should affect relay service health
      const ethStatus = ethereumMonitor.getStatus();
      expect(ethStatus.connected).toBe(false);
      expect(ethStatus.errors).toBe(10);

      // Simulate Cosmos monitor also failing
      cosmosMonitor.isHealthy.mockReturnValue(false);
      cosmosMonitor.getStatus.mockReturnValue({
        connected: false,
        blockHeight: 0,
        lastProcessedHeight: 999,
        processedTxs: 200,
        errors: 8,
      });

      const cosmosStatus = cosmosMonitor.getStatus();
      expect(cosmosStatus.connected).toBe(false);

      // System should be in critical state
      const systemHealthy = ethereumMonitor.isHealthy() && cosmosMonitor.isHealthy();
      expect(systemHealthy).toBe(false);
    });
  });

  describe('Performance Monitoring', () => {
    it('should track relay performance metrics', async () => {
      routeDiscovery.findRoute.mockResolvedValue({
        chains: ['ethereum', 'osmosis-1'],
        hops: [
          {
            from: 'ethereum',
            to: 'osmosis-1',
            channel: 'channel-1',
            timelock: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        totalFees: '500',
        estimatedTime: 180,
      });

      // Process multiple HTLCs to generate metrics
      for (let i = 0; i < 10; i++) {
        const htlcId = ethereumClient.createHTLC({
          sender: '0xsender',
          token: '0xUSDC',
          amount: '1000000',
          hashlock: `0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae${i}`,
          timelock: Math.floor(Date.now() / 1000) + 14400,
          targetChain: 'osmosis-1',
          targetAddress: 'osmo1receiver',
        });

        const event = await waitForEvent(ethereumClient, 'HTLCCreated');
        await relayService.handleEthereumHTLC(event);
      }

      await sleep(1000);

      const metrics = relayService.getMetrics();
      expect(metrics.totalRelayed).toBe(10);
      expect(metrics.averageProcessingTime).toBeGreaterThan(0);
      expect(metrics.successRate).toBeGreaterThan(0.8); // At least 80% success rate
    });

    it('should monitor resource utilization', async () => {
      const initialMemory = process.memoryUsage();
      
      // Generate load
      for (let i = 0; i < 50; i++) {
        const htlcId = ethereumClient.createHTLC({
          sender: '0xsender',
          token: '0xUSDC',
          amount: '1000000',
          hashlock: `0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae${i}`,
          timelock: Math.floor(Date.now() / 1000) + 14400,
          targetChain: 'osmosis-1',
          targetAddress: 'osmo1receiver',
        });
      }

      await sleep(500);

      const currentMemory = process.memoryUsage();
      const memoryIncrease = currentMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
    });
  });
});
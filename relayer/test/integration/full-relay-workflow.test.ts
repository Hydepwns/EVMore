/**
 * Integration tests for full cross-chain relay workflows
 * Tests the complete end-to-end flow from Ethereum to Cosmos and vice versa
 */

import { EthereumMonitor } from '../../src/monitor/ethereum-monitor';
import { CosmosMonitor } from '../../src/monitor/cosmos-monitor';
import { RelayService } from '../../src/relay/relay-service';
import { RouteDiscovery } from '../../src/routes/route-discovery';
import { RecoveryService } from '../../src/recovery/recovery-service';
import { MultiHopManager } from '../../src/ibc/multi-hop-manager';
import {
  MockEthereumClient,
  MockCosmosClient,
  MockChainRegistry,
  createTestLogger,
  createTestConfig,
  waitForEvent,
  sleep,
} from './setup';

// Mock the external dependencies
jest.mock('../../src/monitor/ethereum-monitor');
jest.mock('../../src/monitor/cosmos-monitor');
jest.mock('../../src/routes/route-discovery');

describe('Full Relay Workflow Integration Tests', () => {
  let ethereumClient: MockEthereumClient;
  let cosmosClient: MockCosmosClient;
  let chainRegistry: MockChainRegistry;
  let relayService: RelayService;
  let ethereumMonitor: jest.Mocked<EthereumMonitor>;
  let cosmosMonitor: jest.Mocked<CosmosMonitor>;
  let routeDiscovery: jest.Mocked<RouteDiscovery>;
  let recoveryService: RecoveryService;
  let multiHopManager: MultiHopManager;
  const logger = createTestLogger();
  const config = createTestConfig();

  beforeEach(async () => {
    // Create mock clients
    ethereumClient = new MockEthereumClient();
    cosmosClient = new MockCosmosClient();
    chainRegistry = new MockChainRegistry();

    // Setup mocked services
    ethereumMonitor = {
      start: jest.fn(),
      stop: jest.fn(),
      getStatus: jest.fn().mockReturnValue({ connected: true, blockHeight: 12345 }),
      onHTLCCreated: jest.fn(),
      onHTLCWithdrawn: jest.fn(),
    } as any;

    cosmosMonitor = {
      start: jest.fn(),
      stop: jest.fn(),
      getStatus: jest.fn().mockReturnValue({ connected: true, blockHeight: 1000 }),
      onHTLCEvent: jest.fn(),
      onIBCEvent: jest.fn(),
    } as any;

    routeDiscovery = {
      initialize: jest.fn(),
      findRoute: jest.fn(),
      getCachedRoutesCount: jest.fn().mockReturnValue(5),
      updateCache: jest.fn(),
    } as any;

    // Initialize services
    relayService = new RelayService(config, logger, routeDiscovery);
    recoveryService = new RecoveryService(config, logger);
    multiHopManager = new MultiHopManager(config.cosmos, logger);

    await relayService.initialize();
  });

  afterEach(async () => {
    await relayService.stop?.();
    await recoveryService.stop();
  });

  describe('Ethereum to Cosmos Relay', () => {
    it('should successfully relay HTLC from Ethereum to Cosmos', async () => {
      // Setup route discovery mock
      routeDiscovery.findRoute.mockResolvedValue({
        chains: ['ethereum', 'cosmoshub-4', 'osmosis-1'],
        hops: [
          {
            from: 'ethereum',
            to: 'cosmoshub-4',
            channel: 'channel-0',
            port: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 7200, // 2 hours
          },
          {
            from: 'cosmoshub-4',
            to: 'osmosis-1',
            channel: 'channel-141',
            port: 'transfer',
            timelock: Math.floor(Date.now() / 1000) + 3600, // 1 hour
          },
        ],
        totalFees: '1000',
        estimatedTime: 300, // 5 minutes
      });

      // Create HTLC on Ethereum
      const secret = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const hashlock = '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3';
      
      const htlcId = ethereumClient.createHTLC({
        sender: '0xsender',
        token: '0xUSDC',
        amount: '1000000',
        hashlock,
        timelock: Math.floor(Date.now() / 1000) + 14400, // 4 hours
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver',
      });

      // Wait for Ethereum HTLC creation event
      const ethEvent = await waitForEvent(ethereumClient, 'HTLCCreated');
      expect(ethEvent.htlcId).toBe(htlcId);

      // Simulate relayer handling the event
      await relayService.handleEthereumHTLC(ethEvent);

      // Verify relay service processed the event
      const metrics = relayService.getMetrics();
      expect(metrics.totalRelayed).toBeGreaterThan(0);

      // Wait a bit for processing
      await sleep(500);

      // Verify the relay service would have triggered IBC transfer
      expect(routeDiscovery.findRoute).toHaveBeenCalledWith(
        'ethereum',
        'osmosis-1',
        expect.objectContaining({
          amount: '1000000',
          token: '0xUSDC',
        })
      );
    });

    it('should handle multi-hop transfers correctly', async () => {
      // Setup multi-hop route
      routeDiscovery.findRoute.mockResolvedValue({
        chains: ['ethereum', 'cosmoshub-4', 'osmosis-1', 'juno-1'],
        hops: [
          {
            from: 'ethereum',
            to: 'cosmoshub-4',
            channel: 'channel-0',
            timelock: Math.floor(Date.now() / 1000) + 10800, // 3 hours
          },
          {
            from: 'cosmoshub-4',
            to: 'osmosis-1',
            channel: 'channel-141',
            timelock: Math.floor(Date.now() / 1000) + 7200, // 2 hours
          },
          {
            from: 'osmosis-1',
            to: 'juno-1',
            channel: 'channel-42',
            timelock: Math.floor(Date.now() / 1000) + 3600, // 1 hour
          },
        ],
        totalFees: '2500',
        estimatedTime: 600, // 10 minutes
      });

      const htlcId = ethereumClient.createHTLC({
        sender: '0xsender',
        token: '0xUSDC',
        amount: '1000000',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timelock: Math.floor(Date.now() / 1000) + 14400,
        targetChain: 'juno-1',
        targetAddress: 'juno1receiver',
      });

      const ethEvent = await waitForEvent(ethereumClient, 'HTLCCreated');
      await relayService.handleEthereumHTLC(ethEvent);

      // Wait for processing
      await sleep(500);

      // Verify multi-hop processing
      expect(routeDiscovery.findRoute).toHaveBeenCalledWith(
        'ethereum',
        'juno-1',
        expect.any(Object)
      );

      const metrics = relayService.getMetrics();
      expect(metrics.multiHopTransfers).toBeGreaterThan(0);
    });

    it('should handle routing failures gracefully', async () => {
      // Setup route discovery to fail
      routeDiscovery.findRoute.mockRejectedValue(new Error('No route found'));

      const htlcId = ethereumClient.createHTLC({
        sender: '0xsender',
        token: '0xUSDC',
        amount: '1000000',
        hashlock: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timelock: Math.floor(Date.now() / 1000) + 14400,
        targetChain: 'unknown-chain',
        targetAddress: 'unknown1receiver',
      });

      const ethEvent = await waitForEvent(ethereumClient, 'HTLCCreated');
      await relayService.handleEthereumHTLC(ethEvent);

      // Wait for processing
      await sleep(500);

      // Verify error handling
      const metrics = relayService.getMetrics();
      expect(metrics.failed).toBeGreaterThan(0);
    });
  });

  describe('Cosmos to Ethereum Relay', () => {
    it('should successfully relay HTLC from Cosmos to Ethereum', async () => {
      routeDiscovery.findRoute.mockResolvedValue({
        chains: ['osmosis-1', 'cosmoshub-4', 'ethereum'],
        hops: [
          {
            from: 'osmosis-1',
            to: 'cosmoshub-4',
            channel: 'channel-0',
            timelock: Math.floor(Date.now() / 1000) + 7200,
          },
          {
            from: 'cosmoshub-4',
            to: 'ethereum',
            channel: 'channel-1',
            timelock: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
        totalFees: '1500',
        estimatedTime: 400,
      });

      const htlcId = cosmosClient.createHTLC({
        sender: 'osmo1sender',
        receiver: '0xreceiver',
        amount: [{ denom: 'uosmo', amount: '1000000000' }],
        denom: 'uosmo',
        hashlock: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        timelock: Math.floor(Date.now() / 1000) + 14400,
      });

      const cosmosEvent = await waitForEvent(cosmosClient, 'HTLCCreated');
      await relayService.handleCosmosHTLC(cosmosEvent);

      await sleep(500);

      expect(routeDiscovery.findRoute).toHaveBeenCalledWith(
        'osmosis-1',
        'ethereum',
        expect.any(Object)
      );

      const metrics = relayService.getMetrics();
      expect(metrics.totalRelayed).toBeGreaterThan(0);
    });
  });

  describe('Recovery Service Integration', () => {
    it('should initiate recovery for expired HTLCs', async () => {
      // Create an expired HTLC
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

      const ethEvent = await waitForEvent(ethereumClient, 'HTLCCreated');
      await relayService.handleEthereumHTLC(ethEvent);

      // Start recovery service
      await recoveryService.start();

      // Wait for recovery check
      await sleep(1000);

      // Verify recovery was initiated
      const recoveryMetrics = recoveryService.getMetrics();
      expect(recoveryMetrics.expiredHTLCs).toBeGreaterThan(0);

      await recoveryService.stop();
    });

    it('should handle partial failures in multi-hop transfers', async () => {
      // Setup a multi-hop route where the second hop fails
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

      // Simulate partial failure by making the second IBC transfer fail
      cosmosClient.sendIBCTransfer = jest.fn().mockRejectedValue(new Error('IBC timeout'));

      await sleep(1000);

      // Start recovery service to handle the failed transfer
      await recoveryService.start();
      await sleep(500);

      const recoveryMetrics = recoveryService.getMetrics();
      expect(recoveryMetrics.partialFailures).toBeGreaterThan(0);

      await recoveryService.stop();
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle high throughput of concurrent HTLCs', async () => {
      const numHTLCs = 10;
      const htlcPromises: Promise<any>[] = [];

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

      // Create multiple HTLCs concurrently
      for (let i = 0; i < numHTLCs; i++) {
        const htlcId = ethereumClient.createHTLC({
          sender: '0xsender',
          token: '0xUSDC',
          amount: '1000000',
          hashlock: `0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae${i}`,
          timelock: Math.floor(Date.now() / 1000) + 14400,
          targetChain: 'osmosis-1',
          targetAddress: 'osmo1receiver',
        });

        htlcPromises.push(waitForEvent(ethereumClient, 'HTLCCreated'));
      }

      // Wait for all HTLCs to be created
      const events = await Promise.all(htlcPromises);

      // Process all events
      for (const event of events) {
        await relayService.handleEthereumHTLC(event);
      }

      await sleep(1000);

      // Verify all HTLCs were processed
      const metrics = relayService.getMetrics();
      expect(metrics.totalRelayed).toBe(numHTLCs);
      expect(metrics.failed).toBe(0);
    });

    it('should recover from temporary network failures', async () => {
      let failureCount = 0;
      const maxFailures = 2;

      // Make route discovery fail the first few times
      routeDiscovery.findRoute.mockImplementation(() => {
        if (failureCount < maxFailures) {
          failureCount++;
          return Promise.reject(new Error('Network timeout'));
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

      // Verify eventual success after retries
      const metrics = relayService.getMetrics();
      expect(metrics.totalRelayed).toBe(1);
      expect(failureCount).toBe(maxFailures);

      // Verify retry attempts were made
      expect(routeDiscovery.findRoute).toHaveBeenCalledTimes(maxFailures + 1);
    });
  });

  describe('Cross-Chain State Synchronization', () => {
    it('should maintain consistent state across chains during swap', async () => {
      const secret = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const hashlock = '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3';

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

      // Create HTLC on Ethereum
      const ethHTLCId = ethereumClient.createHTLC({
        sender: '0xsender',
        token: '0xUSDC',
        amount: '1000000',
        hashlock,
        timelock: Math.floor(Date.now() / 1000) + 14400,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver',
      });

      const ethEvent = await waitForEvent(ethereumClient, 'HTLCCreated');
      await relayService.handleEthereumHTLC(ethEvent);

      await sleep(500);

      // Simulate IBC transfer completion
      const ibcEvent = {
        txHash: 'ibc_transfer_123',
        sourceChannel: 'channel-1',
        destChain: 'osmosis-1',
        amount: '1000000',
        receiver: 'osmo1receiver',
        memo: JSON.stringify({ htlcId: ethHTLCId, hashlock }),
        height: 1001,
      };

      cosmosClient.sendIBCTransfer({
        sourceChannel: 'channel-1',
        destChain: 'osmosis-1',
        amount: { denom: 'uusdc', amount: '1000000' },
        receiver: 'osmo1receiver',
        memo: JSON.stringify({ htlcId: ethHTLCId, hashlock }),
      });

      const ibcCompleteEvent = await waitForEvent(cosmosClient, 'IBCTransferComplete');

      // Verify state consistency
      const ethHTLC = await ethereumClient.getHTLC(ethHTLCId);
      expect(ethHTLC).toBeTruthy();
      expect(ethHTLC.withdrawn).toBe(false);
      expect(ethHTLC.hashlock).toBe(hashlock);

      // Simulate secret reveal and withdrawal
      ethereumClient.withdraw(ethHTLCId, secret);
      const withdrawEvent = await waitForEvent(ethereumClient, 'HTLCWithdrawn');

      expect(withdrawEvent.htlcId).toBe(ethHTLCId);
      expect(withdrawEvent.secret).toBe(secret);

      const finalETHHTLC = await ethereumClient.getHTLC(ethHTLCId);
      expect(finalETHHTLC.withdrawn).toBe(true);
    });
  });
});
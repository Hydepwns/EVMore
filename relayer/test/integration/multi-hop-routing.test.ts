/**
 * Multi-Hop Routing Integration Tests
 * Tests complex routing scenarios through multiple Cosmos chains
 */

import { ethers } from 'ethers';
import { Logger } from 'pino';
import { MultiHopManager } from '../../src/ibc/multi-hop-manager';
import { RouteDiscovery } from '../../src/routes/route-discovery';
import { PersistenceManager } from '../../src/persistence/persistence-manager';
import { CircuitBreaker } from '../../src/utils/circuit-breaker';
import {
  MockEthereumClient,
  MockCosmosClient,
  MockChainRegistry,
  createTestLogger,
  createTestConfig,
  sleep,
} from './setup';

// Mock dependencies
jest.mock('../../src/persistence/persistence-manager');
jest.mock('../../src/utils/circuit-breaker');

// Extended mock chain registry with more chains
class ExtendedMockChainRegistry extends MockChainRegistry {
  constructor() {
    super();
    
    // Add more chains for multi-hop testing
    this.addChain('juno-1', {
      chainId: 'juno-1',
      chainName: 'juno',
      rpcUrl: 'https://rpc.juno.zone',
      restUrl: 'https://lcd.juno.zone',
      channels: [
        { chainId: 'osmosis-1', channelId: 'channel-42', portId: 'transfer' },
        { chainId: 'cosmoshub-4', channelId: 'channel-1', portId: 'transfer' },
      ],
    });

    this.addChain('stargaze-1', {
      chainId: 'stargaze-1',
      chainName: 'stargaze',
      rpcUrl: 'https://rpc.stargaze.zone',
      restUrl: 'https://lcd.stargaze.zone',
      channels: [
        { chainId: 'osmosis-1', channelId: 'channel-75', portId: 'transfer' },
        { chainId: 'juno-1', channelId: 'channel-5', portId: 'transfer' },
      ],
    });

    this.addChain('akash-1', {
      chainId: 'akash-1', 
      chainName: 'akash',
      rpcUrl: 'https://rpc.akash.network',
      restUrl: 'https://lcd.akash.network',
      channels: [
        { chainId: 'cosmoshub-4', channelId: 'channel-17', portId: 'transfer' },
        { chainId: 'osmosis-1', channelId: 'channel-1', portId: 'transfer' },
      ],
    });
  }

  private addChain(chainId: string, config: any) {
    (this as any).chains.set(chainId, config);
  }

  async getIBCPath(from: string, to: string): Promise<any[]> {
    // Define complex multi-hop paths
    const paths: Record<string, any[]> = {
      'ethereum:stargaze-1': [
        { chainId: 'cosmoshub-4', channelId: 'channel-0' },
        { chainId: 'juno-1', channelId: 'channel-1' },
        { chainId: 'stargaze-1', channelId: 'channel-5' },
      ],
      'ethereum:akash-1': [
        { chainId: 'cosmoshub-4', channelId: 'channel-0' },
        { chainId: 'akash-1', channelId: 'channel-17' },
      ],
      'juno-1:akash-1': [
        { chainId: 'cosmoshub-4', channelId: 'channel-1' },
        { chainId: 'osmosis-1', channelId: 'channel-0' },
        { chainId: 'akash-1', channelId: 'channel-1' },
      ],
    };

    const key = `${from}:${to}`;
    return paths[key] || super.getIBCPath(from, to);
  }

  async getRouteMetrics(from: string, to: string): Promise<any> {
    // Simulate route metrics for optimization
    return {
      avgLatency: Math.floor(Math.random() * 1000) + 500, // 500-1500ms
      successRate: 0.95 + Math.random() * 0.04, // 95-99%
      congestionLevel: Math.random() * 0.5, // 0-0.5
      baseFee: '1000',
      feePerHop: '500',
    };
  }
}

describe('Multi-Hop Routing Integration Tests', () => {
  let chainRegistry: ExtendedMockChainRegistry;
  let multiHopManager: MultiHopManager;
  let routeDiscovery: RouteDiscovery;
  let persistenceManager: jest.Mocked<PersistenceManager>;
  let circuitBreaker: jest.Mocked<CircuitBreaker>;
  let cosmosClients: Map<string, MockCosmosClient>;
  
  const logger = createTestLogger();
  const config = createTestConfig();

  beforeEach(() => {
    // Setup extended chain registry
    chainRegistry = new ExtendedMockChainRegistry();
    
    // Create cosmos clients for each chain
    cosmosClients = new Map([
      ['cosmoshub-4', new MockCosmosClient()],
      ['osmosis-1', new MockCosmosClient()],
      ['juno-1', new MockCosmosClient()],
      ['stargaze-1', new MockCosmosClient()],
      ['akash-1', new MockCosmosClient()],
    ]);

    // Setup persistence
    persistenceManager = new (jest.requireMock('../../src/persistence/persistence-manager').PersistenceManager)();
    persistenceManager.saveHopStatus = jest.fn();
    persistenceManager.getHopStatuses = jest.fn().mockResolvedValue([]);
    persistenceManager.saveRouteMetrics = jest.fn();

    // Setup circuit breaker
    circuitBreaker = new (jest.requireMock('../../src/utils/circuit-breaker').CircuitBreaker)();
    circuitBreaker.isOpen = jest.fn().mockReturnValue(false);
    circuitBreaker.execute = jest.fn().mockImplementation((fn) => fn());

    // Create services
    multiHopManager = new MultiHopManager(chainRegistry as any, logger);
    routeDiscovery = new RouteDiscovery(chainRegistry as any, logger);

    // Inject cosmos clients into multi-hop manager
    (multiHopManager as any).cosmosClients = cosmosClients;
  });

  describe('3+ Chain Multi-Hop Routing', () => {
    it('should successfully route through 3 chains: Ethereum → Cosmos Hub → Juno → Stargaze', async () => {
      const swapParams = {
        htlcId: 'eth_multihop_3',
        amount: '1000000', // 1 USDC
        denom: 'uusdc',
        sender: '0x1234567890123456789012345678901234567890',
        receiver: 'stars1234567890abcdefghijklmnopqrstuvwxyz',
        hashlock: ethers.utils.sha256('0xsecret'),
        timelock: Math.floor(Date.now() / 1000) + 7200, // 2 hours
      };

      // Get route
      const route = await chainRegistry.getIBCPath('ethereum', 'stargaze-1');
      expect(route).toHaveLength(3);

      // Execute multi-hop transfer
      const result = await multiHopManager.executeMultiHopTransfer(
        swapParams,
        'ethereum',
        'stargaze-1',
        route
      );

      // Verify hop status was tracked
      expect(persistenceManager.saveHopStatus).toHaveBeenCalledTimes(3);
      
      // Verify timelock cascade (each hop has shorter timelock)
      const hopCalls = (persistenceManager.saveHopStatus as jest.Mock).mock.calls;
      const timelocks = hopCalls.map(call => call[0].timelock);
      
      expect(timelocks[0]).toBeGreaterThan(timelocks[1]);
      expect(timelocks[1]).toBeGreaterThan(timelocks[2]);

      // Verify each hop was initiated
      expect(hopCalls[0][0]).toMatchObject({
        htlcId: swapParams.htlcId,
        hopNumber: 1,
        fromChain: 'ethereum',
        toChain: 'cosmoshub-4',
        status: 'initiated',
      });

      expect(hopCalls[2][0]).toMatchObject({
        hopNumber: 3,
        fromChain: 'juno-1',
        toChain: 'stargaze-1',
        status: 'initiated',
      });
    });

    it('should handle 4-chain routing with recovery: Juno → Cosmos → Osmosis → Akash', async () => {
      const swapParams = {
        htlcId: 'juno_multihop_4',
        amount: '5000000',
        denom: 'ujuno',
        sender: 'juno1234567890abcdefghijklmnopqrstuvwxyz',
        receiver: 'akash1234567890abcdefghijklmnopqrstuvwxyz',
        hashlock: ethers.utils.sha256('0xsecret2'),
        timelock: Math.floor(Date.now() / 1000) + 14400, // 4 hours
      };

      // Simulate failure on 2nd hop
      let hopCount = 0;
      jest.spyOn(cosmosClients.get('cosmoshub-4')!, 'sendIBCTransfer')
        .mockImplementation(async () => {
          hopCount++;
          if (hopCount === 1) {
            throw new Error('Channel congested');
          }
          return 'tx_hash_success';
        });

      const route = await chainRegistry.getIBCPath('juno-1', 'akash-1');
      
      // First attempt will fail
      await expect(
        multiHopManager.executeMultiHopTransfer(swapParams, 'juno-1', 'akash-1', route)
      ).rejects.toThrow('Channel congested');

      // Verify failure was recorded
      expect(persistenceManager.saveHopStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error: 'Channel congested',
        })
      );

      // Retry should succeed
      const retryResult = await multiHopManager.executeMultiHopTransfer(
        swapParams,
        'juno-1', 
        'akash-1',
        route
      );

      expect(retryResult.success).toBe(true);
      expect(persistenceManager.saveHopStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'retry_success',
        })
      );
    });

    it('should optimize route selection based on metrics', async () => {
      // Setup route metrics
      jest.spyOn(chainRegistry, 'getRouteMetrics')
        .mockImplementation(async (from, to) => {
          // Make direct route more expensive
          if (from === 'osmosis-1' && to === 'akash-1') {
            return {
              avgLatency: 2000,
              successRate: 0.80,
              congestionLevel: 0.8,
              baseFee: '5000',
              feePerHop: '1000',
            };
          }
          // Multi-hop through cosmos hub is better
          return {
            avgLatency: 800,
            successRate: 0.98,
            congestionLevel: 0.2,
            baseFee: '1000',
            feePerHop: '500',
          };
        });

      // Find optimal route
      const routes = await routeDiscovery.findAllRoutes('osmosis-1', 'akash-1');
      const bestRoute = await routeDiscovery.selectOptimalRoute(routes);

      // Should choose multi-hop over direct route
      expect(bestRoute.path.length).toBeGreaterThan(2);
      expect(bestRoute.metrics.successRate).toBeGreaterThan(0.95);

      // Verify metrics were persisted
      expect(persistenceManager.saveRouteMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          route: bestRoute.path.join(' → '),
          metrics: expect.objectContaining({
            successRate: expect.any(Number),
            avgLatency: expect.any(Number),
          }),
        })
      );
    });

    it('should handle partial hop failures and rollback', async () => {
      const swapParams = {
        htlcId: 'eth_multihop_fail',
        amount: '2000000',
        denom: 'uusdc',
        sender: '0xabc',
        receiver: 'stars1xyz',
        hashlock: ethers.utils.sha256('0xsecret3'),
        timelock: Math.floor(Date.now() / 1000) + 3600,
      };

      // Fail on the last hop
      jest.spyOn(cosmosClients.get('stargaze-1')!, 'createHTLC')
        .mockRejectedValue(new Error('Insufficient funds'));

      const route = await chainRegistry.getIBCPath('ethereum', 'stargaze-1');

      await expect(
        multiHopManager.executeMultiHopTransfer(swapParams, 'ethereum', 'stargaze-1', route)
      ).rejects.toThrow('Insufficient funds');

      // Verify rollback was initiated for completed hops
      const hopStatuses = (persistenceManager.saveHopStatus as jest.Mock).mock.calls;
      const rollbackStatuses = hopStatuses.filter(call => call[0].status === 'rollback_initiated');
      
      expect(rollbackStatuses.length).toBeGreaterThan(0);
      expect(rollbackStatuses[0][0]).toMatchObject({
        htlcId: swapParams.htlcId,
        reason: 'Downstream hop failed',
      });
    });

    it('should respect timelock constraints across all hops', async () => {
      const initialTimelock = Math.floor(Date.now() / 1000) + 14400; // 4 hours
      
      const swapParams = {
        htlcId: 'eth_timelock_test',
        amount: '1000000',
        denom: 'uusdc',
        sender: '0x123',
        receiver: 'stars1abc',
        hashlock: ethers.utils.sha256('0xsecret4'),
        timelock: initialTimelock,
      };

      const route = await chainRegistry.getIBCPath('ethereum', 'stargaze-1');
      
      // Track all HTLC creations
      const htlcCreations: any[] = [];
      cosmosClients.forEach((client, chainId) => {
        jest.spyOn(client, 'createHTLC').mockImplementation((params) => {
          htlcCreations.push({ chainId, timelock: params.timelock });
          return `htlc_${chainId}_${Date.now()}`;
        });
      });

      await multiHopManager.executeMultiHopTransfer(
        swapParams,
        'ethereum',
        'stargaze-1',
        route
      );

      // Verify timelock cascade
      expect(htlcCreations).toHaveLength(3);
      
      // Each hop should have progressively shorter timelock
      const timelockReductions = [
        initialTimelock * 0.5,  // 50% for first hop
        initialTimelock * 0.25, // 25% for second hop
        initialTimelock * 0.125 // 12.5% for third hop
      ];

      htlcCreations.forEach((creation, index) => {
        const expectedTimelock = initialTimelock - timelockReductions[index];
        expect(creation.timelock).toBeLessThanOrEqual(expectedTimelock);
        expect(creation.timelock).toBeGreaterThan(Math.floor(Date.now() / 1000));
      });
    });

    it('should handle concurrent multi-hop transfers efficiently', async () => {
      const transfers = [];
      
      // Create 10 concurrent multi-hop transfers
      for (let i = 0; i < 10; i++) {
        const transfer = multiHopManager.executeMultiHopTransfer(
          {
            htlcId: `concurrent_${i}`,
            amount: String(1000000 * (i + 1)),
            denom: 'uusdc',
            sender: `0x${i}`,
            receiver: `stars${i}`,
            hashlock: ethers.utils.sha256(`0x${i}`),
            timelock: Math.floor(Date.now() / 1000) + 7200,
          },
          'ethereum',
          'stargaze-1',
          await chainRegistry.getIBCPath('ethereum', 'stargaze-1')
        );
        
        transfers.push(transfer);
      }

      // Wait for all transfers
      const results = await Promise.allSettled(transfers);
      
      // Most should succeed
      const successes = results.filter(r => r.status === 'fulfilled').length;
      expect(successes).toBeGreaterThan(8); // At least 80% success rate

      // Verify no hop conflicts
      const hopStatuses = (persistenceManager.saveHopStatus as jest.Mock).mock.calls;
      const htlcIds = new Set(hopStatuses.map(call => call[0].htlcId));
      
      expect(htlcIds.size).toBe(10); // All transfers tracked separately
    });
  });

  describe('Route Recovery and Optimization', () => {
    it('should detect and recover from stuck hops', async () => {
      // Simulate a hop that gets stuck
      const stuckTransfer = {
        htlcId: 'stuck_hop_test',
        amount: '1000000',
        denom: 'uusdc',
        sender: 'cosmos1abc',
        receiver: 'juno1xyz',
        hashlock: ethers.utils.sha256('0xstuck'),
        timelock: Math.floor(Date.now() / 1000) + 600, // 10 minutes
      };

      // Mock a hop that never completes
      persistenceManager.getHopStatuses.mockResolvedValue([
        {
          htlcId: stuckTransfer.htlcId,
          hopNumber: 2,
          status: 'initiated',
          timestamp: new Date(Date.now() - 300000), // 5 minutes ago
          fromChain: 'cosmoshub-4',
          toChain: 'juno-1',
        },
      ]);

      // Run recovery check
      const stuckHops = await multiHopManager.checkForStuckHops();
      expect(stuckHops).toHaveLength(1);
      expect(stuckHops[0].htlcId).toBe(stuckTransfer.htlcId);

      // Attempt recovery
      await multiHopManager.recoverStuckHop(stuckHops[0]);

      // Verify recovery was attempted
      expect(persistenceManager.saveHopStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          htlcId: stuckTransfer.htlcId,
          status: 'recovery_attempted',
        })
      );
    });

    it('should dynamically adjust routes based on performance', async () => {
      // Track route performance
      const routePerformance = new Map<string, number[]>();

      // Mock route metrics that change over time
      let callCount = 0;
      jest.spyOn(chainRegistry, 'getRouteMetrics')
        .mockImplementation(async (from, to) => {
          callCount++;
          
          // Simulate degrading performance on direct route
          if (from === 'osmosis-1' && to === 'juno-1') {
            const latency = 500 + (callCount * 200); // Gets worse over time
            return {
              avgLatency: latency,
              successRate: Math.max(0.7, 1 - (callCount * 0.1)),
              congestionLevel: Math.min(0.9, callCount * 0.2),
              baseFee: '1000',
              feePerHop: '500',
            };
          }
          
          // Alternative route stays stable
          return {
            avgLatency: 800,
            successRate: 0.95,
            congestionLevel: 0.3,
            baseFee: '1500',
            feePerHop: '600',
          };
        });

      // Execute multiple transfers and observe route changes
      const routes: string[][] = [];
      
      for (let i = 0; i < 5; i++) {
        const bestRoute = await routeDiscovery.findBestRoute('osmosis-1', 'juno-1');
        routes.push(bestRoute.path);
        
        // Simulate some transfers
        await sleep(100);
      }

      // Should switch to alternative route as direct route degrades
      const directRouteCount = routes.filter(r => r.length === 2).length;
      const altRouteCount = routes.filter(r => r.length > 2).length;
      
      expect(altRouteCount).toBeGreaterThan(directRouteCount);
    });
  });
});
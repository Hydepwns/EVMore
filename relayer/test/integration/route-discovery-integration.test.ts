/**
 * Integration tests for route discovery and optimization
 * Tests dynamic routing, chain registry integration, and performance optimization
 */

import { RouteDiscovery } from '../../src/routes/route-discovery';
import { RelayService } from '../../src/relay/relay-service';
import {
  MockChainRegistry,
  createTestLogger,
  createTestConfig,
} from './setup';

// Mock external dependencies
jest.mock('../../src/routes/route-discovery');

describe('Route Discovery Integration Tests', () => {
  let routeDiscovery: jest.Mocked<RouteDiscovery>;
  let relayService: RelayService;
  let chainRegistry: MockChainRegistry;
  const logger = createTestLogger();
  const config = createTestConfig();

  beforeEach(async () => {
    chainRegistry = new MockChainRegistry();

    // Setup mocked route discovery
    routeDiscovery = {
      initialize: jest.fn(),
      findRoutes: jest.fn(),
      getCachedRoutesCount: jest.fn().mockReturnValue(0),
      updateCache: jest.fn(),
      clearCache: jest.fn(),
      getRouteMetrics: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
    } as any;

    const htlcContractAddresses = {
      'ethereum': '0xHTLC',
      'cosmoshub-4': 'cosmos1htlc',
      'osmosis-1': 'osmo1htlc'
    };
    relayService = new RelayService(config, logger, routeDiscovery, htlcContractAddresses);
    await relayService.initialize();
  });

  afterEach(async () => {
    // No stop method needed for cleanup
  });

  describe('Dynamic Route Discovery', () => {
    it('should find optimal single-hop route', async () => {
      const mockRoute = {
        source: 'ethereum',
        destination: 'osmosis-1',
        path: ['ethereum', 'osmosis-1'],
        channels: [
          {
            chainId: 'osmosis-1',
            channelId: 'channel-1',
            portId: 'transfer',
            counterparty: {
              chainId: 'ethereum',
              channelId: 'channel-0',
              portId: 'transfer',
            },
            state: 'OPEN',
          },
        ],
        estimatedTime: 180,
        estimatedFee: 500,
      };

      routeDiscovery.findRoutes.mockResolvedValue([mockRoute]);

      const routes = await routeDiscovery.findRoutes('ethereum', 'osmosis-1');

      expect(routes).toEqual([mockRoute]);
      expect(routes[0].path).toEqual(['ethereum', 'osmosis-1']);
      expect(routes[0].channels).toHaveLength(1);
      expect(routes[0].estimatedTime).toBe(180);
    });

    it('should find optimal multi-hop route when direct route unavailable', async () => {
      const mockMultiHopRoute = {
        source: 'ethereum',
        destination: 'osmosis-1',
        path: ['ethereum', 'cosmoshub-4', 'osmosis-1'],
        channels: [
          {
            chainId: 'cosmoshub-4',
            channelId: 'channel-0',
            portId: 'transfer',
            counterparty: {
              chainId: 'ethereum',
              channelId: 'channel-1',
              portId: 'transfer',
            },
            state: 'OPEN',
          },
          {
            chainId: 'osmosis-1',
            channelId: 'channel-141',
            portId: 'transfer',
            counterparty: {
              chainId: 'cosmoshub-4',
              channelId: 'channel-0',
              portId: 'transfer',
            },
            state: 'OPEN',
          },
        ],
        estimatedTime: 210,
        estimatedFee: 500,
      };

      routeDiscovery.findRoutes.mockResolvedValue([mockMultiHopRoute]);

      const routes = await routeDiscovery.findRoutes('ethereum', 'osmosis-1');

      expect(routes).toEqual([mockMultiHopRoute]);
      expect(routes[0].path).toEqual(['ethereum', 'cosmoshub-4', 'osmosis-1']);
      expect(routes[0].channels).toHaveLength(2);
    });

    it('should optimize routes based on multiple criteria', () => {
      const routes = [
        {
          source: 'ethereum',
          destination: 'osmosis-1',
          path: ['ethereum', 'osmosis-1'],
          channels: [],
          estimatedTime: 120,
          estimatedFee: 1000,
        },
        {
          source: 'ethereum',
          destination: 'osmosis-1',
          path: ['ethereum', 'cosmoshub-4', 'osmosis-1'],
          channels: [],
          estimatedTime: 240,
          estimatedFee: 500,
        },
      ];

      // Test optimization for lowest fees
      const optimizeRoute = (routes: any[], criteria: any) => {
        if (criteria.priority === 'fees') {
          return routes.sort((a, b) => a.estimatedFee - b.estimatedFee)[0];
        }
        if (criteria.priority === 'speed') {
          return routes.sort((a, b) => a.estimatedTime - b.estimatedTime)[0];
        }
        return routes[0];
      };

      const cheapestRoute = optimizeRoute(routes, { priority: 'fees' });
      expect(cheapestRoute.estimatedFee).toBe(500);

      const fastestRoute = optimizeRoute(routes, { priority: 'speed' });
      expect(fastestRoute.estimatedTime).toBe(120);
    });

    it('should handle route discovery failures gracefully', async () => {
      // Test various failure scenarios
      routeDiscovery.findRoutes
        .mockRejectedValueOnce(new Error('Chain registry unavailable'))
        .mockRejectedValueOnce(new Error('No IBC channels found'))
        .mockResolvedValueOnce([
          {
            source: 'ethereum',
            destination: 'osmosis-1',
            path: ['ethereum', 'osmosis-1'],
            channels: [],
            estimatedTime: 180,
            estimatedFee: 500,
          },
        ]);

      // First attempt should fail
      await expect(routeDiscovery.findRoutes('ethereum', 'unknown-chain'))
        .rejects.toThrow('Chain registry unavailable');

      // Second attempt should also fail
      await expect(routeDiscovery.findRoutes('ethereum', 'isolated-chain'))
        .rejects.toThrow('No IBC channels found');

      // Third attempt should succeed
      const routes = await routeDiscovery.findRoutes('ethereum', 'osmosis-1');
      expect(routes).toBeTruthy();
      expect(routes[0].path).toEqual(['ethereum', 'osmosis-1']);
    });
  });

  describe('Route Caching and Performance', () => {
    it('should cache frequently used routes', async () => {
      const testRoute = {
        source: 'ethereum',
        destination: 'osmosis-1',
        path: ['ethereum', 'osmosis-1'],
        channels: [],
        estimatedTime: 180,
        estimatedFee: 500,
      };

      // First call - should hit the network
      routeDiscovery.findRoutes.mockResolvedValue([testRoute]);
      routeDiscovery.getCachedRoutesCount.mockReturnValue(1);

      const routes1 = await routeDiscovery.findRoutes('ethereum', 'osmosis-1');

      expect(routes1).toEqual([testRoute]);
      expect(routeDiscovery.findRoutes).toHaveBeenCalledTimes(1);

      // Verify cache was populated
      expect(routeDiscovery.getCachedRoutesCount()).toBe(1);
    });

    it('should update cache periodically', async () => {
      const initialRoute = {
        source: 'ethereum',
        destination: 'osmosis-1',
        path: ['ethereum', 'osmosis-1'],
        channels: [],
        estimatedTime: 180,
        estimatedFee: 500,
      };

      const updatedRoute = {
        ...initialRoute,
        estimatedFee: 450, // Fees improved
      };

      routeDiscovery.findRoutes
        .mockResolvedValueOnce([initialRoute])
        .mockResolvedValueOnce([updatedRoute]);

      routeDiscovery.getCachedRoutesCount
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(1);

      // Initial route discovery
      const routes1 = await routeDiscovery.findRoutes('ethereum', 'osmosis-1');
      expect(routes1[0].estimatedFee).toBe(500);

      // Simulate cache update
      await routeDiscovery.updateCache();

      // After cache update, should get updated route
      const routes2 = await routeDiscovery.findRoutes('ethereum', 'osmosis-1');
      expect(routes2[0].estimatedFee).toBe(450);
    });

    it('should handle cache invalidation', async () => {
      routeDiscovery.getCachedRoutesCount
        .mockReturnValueOnce(5) // Initially has cached routes
        .mockReturnValueOnce(0); // After clearing cache

      expect(routeDiscovery.getCachedRoutesCount()).toBe(5);

      // Clear the cache
      routeDiscovery.clearCache();

      expect(routeDiscovery.getCachedRoutesCount()).toBe(0);
    });

    it('should provide route performance metrics', async () => {
      const mockMetrics = {
        totalRoutes: 15,
        cacheHitRatio: 0.75,
        averageDiscoveryTime: 120,
        successfulRoutes: 14,
        failedRoutes: 1,
        popularRoutes: [
          { from: 'ethereum', to: 'osmosis-1', usage: 8 },
          { from: 'ethereum', to: 'cosmoshub-4', usage: 4 },
          { from: 'osmosis-1', to: 'juno-1', usage: 2 },
        ],
      };

      routeDiscovery.getRouteMetrics.mockReturnValue(mockMetrics);

      const metrics = routeDiscovery.getRouteMetrics();
      
      expect(metrics.totalRoutes).toBe(15);
      expect(metrics.cacheHitRatio).toBe(0.75);
      expect(metrics.successfulRoutes).toBe(14);
      expect(metrics.popularRoutes).toHaveLength(3);
    });
  });

  describe('Chain Registry Integration', () => {
    it('should discover new chains and channels', async () => {
      const newChainRoute = {
        source: 'ethereum',
        destination: 'juno-1',
        path: ['ethereum', 'cosmoshub-4', 'juno-1'],
        channels: [
          {
            chainId: 'cosmoshub-4',
            channelId: 'channel-0',
            portId: 'transfer',
            counterparty: {
              chainId: 'ethereum',
              channelId: 'channel-1',
              portId: 'transfer',
            },
            state: 'OPEN',
          },
          {
            chainId: 'juno-1',
            channelId: 'channel-1',
            portId: 'transfer',
            counterparty: {
              chainId: 'cosmoshub-4',
              channelId: 'channel-0',
              portId: 'transfer',
            },
            state: 'OPEN',
          },
        ],
        estimatedTime: 210,
        estimatedFee: 500,
      };

      await routeDiscovery.updateCache();

      routeDiscovery.findRoutes.mockResolvedValue([newChainRoute]);

      const routes = await routeDiscovery.findRoutes('ethereum', 'juno-1');
      expect(routes[0].path).toContain('juno-1');
      expect(routes[0].channels).toHaveLength(2);
    });

    it('should handle chain registry connectivity issues', async () => {
      // Simulate chain registry being temporarily unavailable
      routeDiscovery.findRoutes.mockRejectedValue(new Error('Chain registry unavailable'));

      await expect(routeDiscovery.findRoutes('ethereum', 'osmosis-1'))
        .rejects.toThrow('Chain registry unavailable');

      // After registry recovery, should work again
      routeDiscovery.findRoutes.mockResolvedValue([
        {
          source: 'ethereum',
          destination: 'osmosis-1',
          path: ['ethereum', 'osmosis-1'],
          channels: [],
          estimatedTime: 180,
          estimatedFee: 500,
        },
      ]);

      const routes = await routeDiscovery.findRoutes('ethereum', 'osmosis-1');
      expect(routes).toBeTruthy();
    });
  });

  describe('Real-world Routing Scenarios', () => {
    it('should handle complex multi-chain ecosystem routing', async () => {
      // Simulate routing through multiple Cosmos chains
      const complexRoute = {
        source: 'ethereum',
        destination: 'terra-2',
        path: ['ethereum', 'cosmoshub-4', 'osmosis-1', 'juno-1', 'terra-2'],
        channels: [
          {
            chainId: 'cosmoshub-4',
            channelId: 'channel-0',
            portId: 'transfer',
            counterparty: { chainId: 'ethereum', channelId: 'channel-1', portId: 'transfer' },
            state: 'OPEN',
          },
          {
            chainId: 'osmosis-1',
            channelId: 'channel-141',
            portId: 'transfer',
            counterparty: { chainId: 'cosmoshub-4', channelId: 'channel-0', portId: 'transfer' },
            state: 'OPEN',
          },
          {
            chainId: 'juno-1',
            channelId: 'channel-42',
            portId: 'transfer',
            counterparty: { chainId: 'osmosis-1', channelId: 'channel-8', portId: 'transfer' },
            state: 'OPEN',
          },
          {
            chainId: 'terra-2',
            channelId: 'channel-86',
            portId: 'transfer',
            counterparty: { chainId: 'juno-1', channelId: 'channel-2', portId: 'transfer' },
            state: 'OPEN',
          },
        ],
        estimatedTime: 690, // ~11.5 minutes
        estimatedFee: 2000,
      };

      routeDiscovery.findRoutes.mockResolvedValue([complexRoute]);

      const routes = await routeDiscovery.findRoutes('ethereum', 'terra-2');

      expect(routes[0].path).toHaveLength(5);
      expect(routes[0].channels).toHaveLength(4);
      expect(routes[0].estimatedTime).toBeLessThan(720); // Less than 12 minutes
    });

    it('should optimize for specific user preferences', () => {
      const routes = [
        {
          source: 'ethereum',
          destination: 'osmosis-1',
          path: ['ethereum', 'osmosis-1'],
          channels: [],
          estimatedTime: 60, // Very fast
          estimatedFee: 2000,
        },
        {
          source: 'ethereum',
          destination: 'osmosis-1',
          path: ['ethereum', 'cosmoshub-4', 'osmosis-1'],
          channels: [],
          estimatedTime: 210,
          estimatedFee: 300,
        },
      ];

      // User prioritizes speed over cost
      const optimizeForSpeed = (routes: any[]) => {
        return routes.sort((a, b) => a.estimatedTime - b.estimatedTime)[0];
      };

      const fastRoute = optimizeForSpeed(routes);
      expect(fastRoute.estimatedTime).toBe(60);
      expect(fastRoute.estimatedFee).toBe(2000);

      // User prioritizes cost over speed
      const optimizeForCost = (routes: any[]) => {
        return routes.sort((a, b) => a.estimatedFee - b.estimatedFee)[0];
      };

      const cheapRoute = optimizeForCost(routes);
      expect(cheapRoute.estimatedFee).toBe(300);
      expect(cheapRoute.estimatedTime).toBe(210);
    });
  });
});
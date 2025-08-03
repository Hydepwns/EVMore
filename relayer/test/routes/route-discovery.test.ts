import axios from 'axios';
import pino from 'pino';
import { RouteDiscovery, Route, IBCChannel } from '../../src/routes/route-discovery';
import { ChainRegistryConfig } from '../../src/config';

// Mock axios
jest.mock('axios');

describe('RouteDiscovery', () => {
  let routeDiscovery: RouteDiscovery;
  let mockLogger: pino.Logger;
  let config: ChainRegistryConfig;

  beforeEach(() => {
    // Setup config
    config = {
      baseUrl: 'https://registry.ping.pub',
      cacheTimeout: 3600,
      refreshInterval: 300,
    };

    // Setup logger
    mockLogger = pino({ level: 'silent' });

    // Mock axios
    (axios.get as jest.Mock) = jest.fn();

    routeDiscovery = new RouteDiscovery(config, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findRoutes', () => {
    const mockChannelData = {
      data: {
        channels: [
          {
            chain_1: {
              chain_name: 'osmosis',
              channel_id: 'channel-0',
              port_id: 'transfer',
            },
            chain_2: {
              chain_name: 'cosmos',
              channel_id: 'channel-141',
              port_id: 'transfer',
            },
            state: 'open',
          },
          {
            chain_1: {
              chain_name: 'cosmos',
              channel_id: 'channel-1',
              port_id: 'transfer',
            },
            chain_2: {
              chain_name: 'juno',
              channel_id: 'channel-207',
              port_id: 'transfer',
            },
            state: 'open',
          },
        ],
      },
    };

    it('should find direct route between two chains', async () => {
      (axios.get as jest.Mock).mockResolvedValue(mockChannelData);

      const routes = await routeDiscovery.findRoutes('osmosis', 'cosmos');

      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({
        source: 'osmosis',
        destination: 'cosmos',
        path: ['osmosis', 'cosmos'],
        estimatedTime: expect.any(Number),
        estimatedFee: expect.any(Number),
      });
      expect(routes[0].channels).toHaveLength(1);
      expect(routes[0].channels[0].channelId).toBe('channel-0');
    });

    it('should find multi-hop route when no direct path exists', async () => {
      (axios.get as jest.Mock).mockResolvedValue(mockChannelData);

      const routes = await routeDiscovery.findRoutes('osmosis', 'juno');

      expect(routes.length).toBeGreaterThan(0);
      const route = routes[0];
      expect(route.path).toContain('cosmos'); // Should go through cosmos
      expect(route.path[0]).toBe('osmosis');
      expect(route.path[route.path.length - 1]).toBe('juno');
    });

    it('should return empty array if no route exists', async () => {
      (axios.get as jest.Mock).mockResolvedValue(mockChannelData);

      const routes = await routeDiscovery.findRoutes('osmosis', 'non-existent-chain');

      expect(routes).toEqual([]);
    });

    it('should use cache for repeated requests', async () => {
      (axios.get as jest.Mock).mockResolvedValue(mockChannelData);

      // First call
      await routeDiscovery.findRoutes('osmosis', 'cosmos');
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await routeDiscovery.findRoutes('osmosis', 'cosmos');
      expect(axios.get).toHaveBeenCalledTimes(1); // Still only called once
    });

    it('should refresh cache when expired', async () => {
      (axios.get as jest.Mock).mockResolvedValue(mockChannelData);

      // First call
      await routeDiscovery.findRoutes('osmosis', 'cosmos');
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Fast forward time past cache timeout
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => originalDateNow() + config.cacheTimeout * 1000 + 1000);

      // Second call should refresh cache
      await routeDiscovery.findRoutes('osmosis', 'cosmos');
      expect(axios.get).toHaveBeenCalledTimes(2);

      Date.now = originalDateNow;
    });

    it('should handle network errors gracefully', async () => {
      (axios.get as jest.Mock).mockRejectedValue(new Error('Network error'));

      const routes = await routeDiscovery.findRoutes('osmosis', 'cosmos');

      expect(routes).toEqual([]);
    });
  });

  describe('getIBCChannels', () => {
    const mockChannelData = {
      data: {
        channels: [
          {
            chain_1: {
              chain_name: 'osmosis',
              channel_id: 'channel-0',
              port_id: 'transfer',
            },
            chain_2: {
              chain_name: 'cosmos',
              channel_id: 'channel-141',
              port_id: 'transfer',
            },
            state: 'open',
          },
        ],
      },
    };

    it('should return IBC channels for a chain', async () => {
      (axios.get as jest.Mock).mockResolvedValue(mockChannelData);

      const channels = await routeDiscovery.getIBCChannels('osmosis');

      expect(channels).toHaveLength(1);
      expect(channels[0]).toMatchObject({
        chainId: 'osmosis',
        channelId: 'channel-0',
        portId: 'transfer',
        counterparty: {
          chainId: 'cosmos',
          channelId: 'channel-141',
          portId: 'transfer',
        },
        state: 'open',
      });
    });

    it('should return channels where chain is chain_2', async () => {
      (axios.get as jest.Mock).mockResolvedValue(mockChannelData);

      const channels = await routeDiscovery.getIBCChannels('cosmos');

      expect(channels).toHaveLength(1);
      expect(channels[0]).toMatchObject({
        chainId: 'cosmos',
        channelId: 'channel-141',
        portId: 'transfer',
        counterparty: {
          chainId: 'osmosis',
          channelId: 'channel-0',
          portId: 'transfer',
        },
        state: 'open',
      });
    });

    it('should filter out closed channels', async () => {
      const dataWithClosedChannel = {
        data: {
          channels: [
            ...mockChannelData.data.channels,
            {
              chain_1: { chain_name: 'osmosis', channel_id: 'channel-999', port_id: 'transfer' },
              chain_2: { chain_name: 'juno', channel_id: 'channel-888', port_id: 'transfer' },
              state: 'closed',
            },
          ],
        },
      };

      (axios.get as jest.Mock).mockResolvedValue(dataWithClosedChannel);

      const channels = await routeDiscovery.getIBCChannels('osmosis');

      expect(channels).toHaveLength(1); // Only open channel
      expect(channels.every(ch => ch.state === 'open')).toBe(true);
    });
  });

  describe('estimateRouteFees', () => {
    it('should estimate fees based on number of hops', async () => {
      const singleHopRoute: Route = {
        source: 'osmosis',
        destination: 'cosmos',
        path: ['osmosis', 'cosmos'],
        channels: [],
        estimatedTime: 60,
        estimatedFee: 0,
      };

      const multiHopRoute: Route = {
        source: 'osmosis',
        destination: 'juno',
        path: ['osmosis', 'cosmos', 'juno'],
        channels: [],
        estimatedTime: 120,
        estimatedFee: 0,
      };

      const singleHopFee = await routeDiscovery.estimateRouteFees(singleHopRoute);
      const multiHopFee = await routeDiscovery.estimateRouteFees(multiHopRoute);

      expect(multiHopFee).toBeGreaterThan(singleHopFee);
      expect(singleHopFee).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('should clear all cached data', async () => {
      const mockChannelData = {
        data: {
          channels: [
            {
              chain_1: { chain_name: 'osmosis', channel_id: 'channel-0', port_id: 'transfer' },
              chain_2: { chain_name: 'cosmos', channel_id: 'channel-141', port_id: 'transfer' },
              state: 'open',
            },
          ],
        },
      };

      (axios.get as jest.Mock).mockResolvedValue(mockChannelData);

      // Populate cache
      await routeDiscovery.findRoutes('osmosis', 'cosmos');
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Clear cache
      routeDiscovery.clearCache();

      // Next call should fetch again
      await routeDiscovery.findRoutes('osmosis', 'cosmos');
      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });
});
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { RouteDiscovery } from '../../relayer/src/routes/route-discovery';
import { PacketForwardMiddleware } from '../../relayer/src/ibc/packet-forward-middleware';
import { MultiHopManager } from '../../relayer/src/ibc/multi-hop-manager';
import { 
  createHTLCMemo, 
  createMultiHopHTLCMemo,
  HTLCMemo,
  IBCChannel
} from '../../relayer/src/ibc/types';
import pino from 'pino';

// Mock configuration
const mockConfig = {
  general: {
    logLevel: 'debug',
    port: 3000,
    enableMetrics: false,
    shutdownTimeout: 30000
  },
  ethereum: {
    rpcUrl: 'http://localhost:8545',
    htlcContractAddress: '0x123',
    resolverContractAddress: '0x456',
    privateKey: '0xabc',
    chainId: 1337,
    confirmations: 1,
    gasLimit: 500000
  },
  cosmos: {
    rpcUrl: 'http://localhost:26657',
    restUrl: 'http://localhost:1317',
    chainId: 'testing',
    htlcContractAddress: 'cosmos123',
    mnemonic: 'test test test test test test test test test test test junk',
    gasPrice: '0.025uatom',
    gasLimit: 200000,
    denom: 'uatom',
    addressPrefix: 'cosmos'
  },
  chainRegistry: {
    baseUrl: 'https://registry.test',
    cacheTimeout: 3600,
    refreshInterval: 300
  },
  relay: {
    maxRetries: 3,
    retryDelay: 5000,
    batchSize: 10,
    processingInterval: 10000,
    timeoutBuffer: 3600
  },
  recovery: {
    enabled: true,
    checkInterval: 60000,
    refundBuffer: 7200
  }
};

describe('IBC Multi-Hop Transfer Tests', () => {
  let routeDiscovery: RouteDiscovery;
  let packetForward: PacketForwardMiddleware;
  let multiHopManager: MultiHopManager;
  const logger = pino({ level: 'silent' });

  beforeAll(() => {
    routeDiscovery = new RouteDiscovery(mockConfig.chainRegistry, logger);
    packetForward = new PacketForwardMiddleware(
      routeDiscovery,
      { maxHops: 4, hopTimeout: 300, maxRetries: 2 },
      logger
    );
    multiHopManager = new MultiHopManager(mockConfig as any, routeDiscovery, logger);
  });

  describe('HTLC Memo Creation', () => {
    it('should create a valid HTLC memo', () => {
      const htlcParams = {
        htlcId: 'htlc_123',
        receiver: 'cosmos1abc...',
        hashlock: '0xdef456...',
        timelock: 1234567890,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1xyz...',
        sourceChain: 'ethereum',
        sourceHTLCId: 'eth_htlc_123'
      };

      const memo = createHTLCMemo(htlcParams);
      const parsed = JSON.parse(memo);

      expect(parsed.type).toBe('htlc_create');
      expect(parsed.htlcId).toBe(htlcParams.htlcId);
      expect(parsed.receiver).toBe(htlcParams.receiver);
      expect(parsed.hashlock).toBe(htlcParams.hashlock);
    });

    it('should create a multi-hop HTLC memo', () => {
      const htlcParams = {
        htlcId: 'htlc_456',
        receiver: 'osmo1final...',
        hashlock: '0xabc123...',
        timelock: 1234567890,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1final...',
        sourceChain: 'ethereum',
        sourceHTLCId: 'eth_htlc_456'
      };

      const hops = [
        {
          receiver: 'cosmos1intermediate...',
          channel: 'channel-0',
          port: 'transfer'
        },
        {
          receiver: 'osmo1final...',
          channel: 'channel-141',
          port: 'transfer'
        }
      ];

      const memo = createMultiHopHTLCMemo(htlcParams, hops);
      const parsed = JSON.parse(memo);

      expect(parsed.forward).toBeDefined();
      expect(parsed.forward.receiver).toBe(hops[0].receiver);
      expect(parsed.forward.channel).toBe(hops[0].channel);
      expect(parsed.htlc).toBeDefined();
      expect(parsed.htlc.type).toBe('htlc_create');
    });
  });

  describe('Route Discovery', () => {
    it('should handle empty route cache gracefully', async () => {
      const routes = await routeDiscovery.findRoutes('cosmoshub-4', 'osmosis-1');
      expect(Array.isArray(routes)).toBe(true);
    });

    it('should calculate route metrics', async () => {
      // Mock some channels for testing
      const mockChannels: IBCChannel[] = [
        {
          chainId: 'cosmoshub-4',
          channelId: 'channel-0',
          portId: 'transfer',
          counterparty: {
            chainId: 'osmosis-1',
            channelId: 'channel-0',
            portId: 'transfer'
          },
          state: 'OPEN'
        }
      ];

      // In a real test, we'd mock the axios call to return these channels
      const fees = await packetForward.calculateFees({
        source: 'cosmoshub-4',
        destination: 'osmosis-1',
        path: ['cosmoshub-4', 'osmosis-1'],
        channels: mockChannels,
        estimatedTime: 30,
        estimatedFee: 0.001
      });

      expect(fees.totalFee).toBeDefined();
      expect(fees.feeBreakdown).toBeDefined();
      expect(Array.isArray(fees.feeBreakdown)).toBe(true);
    });
  });

  describe('Packet Forward Middleware', () => {
    it('should validate timelocks for route', () => {
      const route = {
        source: 'cosmoshub-4',
        destination: 'juno-1',
        path: ['cosmoshub-4', 'osmosis-1', 'juno-1'],
        channels: [] as IBCChannel[],
        estimatedTime: 60,
        estimatedFee: 0.002
      };

      const currentTime = Math.floor(Date.now() / 1000);
      const initialTimelock = currentTime + 7200; // 2 hours from now

      const validation = packetForward.validateTimelocksForRoute(
        route,
        initialTimelock
      );

      expect(validation.valid).toBe(true);
      expect(validation.adjustedTimelocks).toBeDefined();
      expect(validation.adjustedTimelocks.length).toBe(2); // 2 hops
      
      // Each timelock should be decreasing
      expect(validation.adjustedTimelocks[0]).toBeLessThan(initialTimelock);
      expect(validation.adjustedTimelocks[1]).toBeLessThan(validation.adjustedTimelocks[0]);
    });

    it('should reject routes with insufficient time', () => {
      const route = {
        source: 'cosmoshub-4',
        destination: 'secret-4',
        path: ['cosmoshub-4', 'osmosis-1', 'juno-1', 'secret-4'],
        channels: [] as IBCChannel[],
        estimatedTime: 90,
        estimatedFee: 0.003
      };

      const currentTime = Math.floor(Date.now() / 1000);
      const initialTimelock = currentTime + 1800; // Only 30 minutes

      const validation = packetForward.validateTimelocksForRoute(
        route,
        initialTimelock
      );

      expect(validation.valid).toBe(false);
    });
  });

  describe('Multi-Hop Transfer Flow', () => {
    it('should create forward paths for multi-hop transfer', async () => {
      // Mock route discovery to return a known route
      jest.spyOn(routeDiscovery, 'findRoutes').mockResolvedValueOnce([
        {
          source: 'cosmoshub-4',
          destination: 'osmosis-1',
          path: ['cosmoshub-4', 'osmosis-1'],
          channels: [
            {
              chainId: 'cosmoshub-4',
              channelId: 'channel-141',
              portId: 'transfer',
              counterparty: {
                chainId: 'osmosis-1',
                channelId: 'channel-0',
                portId: 'transfer'
              },
              state: 'OPEN'
            }
          ],
          estimatedTime: 30,
          estimatedFee: 0.001
        }
      ]);

      const htlcParams: Omit<HTLCMemo, 'type'> = {
        htlcId: 'test_htlc_789',
        receiver: 'osmo1receiver...',
        hashlock: '0xhash789...',
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'osmosis-1',
        targetAddress: 'osmo1receiver...',
        sourceChain: 'cosmoshub-4',
        sourceHTLCId: 'cosmos_htlc_789'
      };

      const forwardPaths = await packetForward.planMultiHopTransfer(
        'cosmoshub-4',
        'osmosis-1',
        'osmo1receiver...',
        htlcParams
      );

      expect(forwardPaths).toBeDefined();
      expect(forwardPaths.length).toBeGreaterThan(0);
      expect(forwardPaths[0].channel).toBe('channel-0');
      expect(forwardPaths[0].receiver).toBe('osmo1receiver...');
    });

    it('should handle route planning errors gracefully', async () => {
      // Mock route discovery to return no routes
      jest.spyOn(routeDiscovery, 'findRoutes').mockResolvedValueOnce([]);

      const htlcParams: Omit<HTLCMemo, 'type'> = {
        htlcId: 'test_htlc_404',
        receiver: 'unknown1receiver...',
        hashlock: '0xhash404...',
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'unknown-chain',
        targetAddress: 'unknown1receiver...',
        sourceChain: 'cosmoshub-4',
        sourceHTLCId: 'cosmos_htlc_404'
      };

      await expect(
        packetForward.planMultiHopTransfer(
          'cosmoshub-4',
          'unknown-chain',
          'unknown1receiver...',
          htlcParams
        )
      ).rejects.toThrow('No route found');
    });
  });

  afterAll(() => {
    // Cleanup
    jest.restoreAllMocks();
  });
});
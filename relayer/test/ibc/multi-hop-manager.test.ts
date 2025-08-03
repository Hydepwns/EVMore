import pino from 'pino';
import { MultiHopManager } from '../../src/ibc/multi-hop-manager';
import { IBCPacketHandler } from '../../src/ibc/packet-handler';
import { PacketForwardMiddleware } from '../../src/ibc/packet-forward-middleware';
import { RouteDiscovery } from '../../src/routes/route-discovery';
import { AppConfig } from '../../src/config';
import { HTLCMemo } from '../../src/ibc/types';

// Mock dependencies
jest.mock('../../src/ibc/packet-handler');
jest.mock('../../src/ibc/packet-forward-middleware');

describe('MultiHopManager', () => {
  let multiHopManager: MultiHopManager;
  let mockIBCHandler: jest.Mocked<IBCPacketHandler>;
  let mockPacketForward: jest.Mocked<PacketForwardMiddleware>;
  let mockRouteDiscovery: jest.Mocked<RouteDiscovery>;
  let mockLogger: pino.Logger;
  let config: AppConfig;

  beforeEach(() => {
    // Setup mocks
    mockIBCHandler = {
      initialize: jest.fn(),
      sendHTLCIBCTransfer: jest.fn(),
    } as any;

    mockPacketForward = {
      planMultiHopTransfer: jest.fn(),
      validateTimelocksForRoute: jest.fn(),
      calculateFees: jest.fn(),
    } as any;

    mockRouteDiscovery = {
      findRoutes: jest.fn(),
    } as any;

    // Mock constructors
    (IBCPacketHandler as jest.MockedClass<typeof IBCPacketHandler>).mockImplementation(
      () => mockIBCHandler
    );
    (PacketForwardMiddleware as jest.MockedClass<typeof PacketForwardMiddleware>).mockImplementation(
      () => mockPacketForward
    );

    // Setup logger
    mockLogger = pino({ level: 'silent' });

    // Setup config
    config = {
      general: {
        logLevel: 'info',
        port: 3000,
        enableMetrics: false,
        shutdownTimeout: 30000,
      },
      ethereum: {
        rpcUrl: 'http://localhost:8545',
        privateKey: '0x1234',
        htlcContractAddress: '0xabcd',
        resolverContractAddress: '0xdef0',
        chainId: 1337,
        confirmations: 1,
        gasLimit: 500000,
      },
      cosmos: {
        chainId: 'osmosis-1',
        rpcUrl: 'http://localhost:26657',
        restUrl: 'http://localhost:1317',
        mnemonic: 'test mnemonic',
        htlcContractAddress: 'osmo1htlc',
        addressPrefix: 'osmo',
        gasPrice: '0.025uosmo',
        gasLimit: 200000,
        denom: 'uosmo',
      },
      chainRegistry: {
        baseUrl: 'https://registry.ping.pub',
        cacheTimeout: 3600,
        refreshInterval: 300,
      },
      relay: {
        maxRetries: 3,
        retryDelay: 5000,
        batchSize: 10,
        processingInterval: 10000,
        timeoutBuffer: 300,
      },
      recovery: {
        enabled: true,
        checkInterval: 60000,
        refundBuffer: 7200,
      },
    };

    multiHopManager = new MultiHopManager(config, mockRouteDiscovery, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize IBC handlers', async () => {
      await multiHopManager.initialize();

      expect(IBCPacketHandler).toHaveBeenCalledWith(config.cosmos, expect.any(Object));
      expect(mockIBCHandler.initialize).toHaveBeenCalled();
    });
  });

  describe('executeMultiHopTransfer', () => {
    const htlcParams: Omit<HTLCMemo, 'type'> = {
      htlcId: 'htlc123',
      receiver: 'osmo1receiver',
      hashlock: '0xhash',
      timelock: Math.floor(Date.now() / 1000) + 7200, // 2 hours
      targetChain: 'juno',
      targetAddress: 'juno1receiver',
      sourceChain: 'ethereum',
      sourceHTLCId: 'eth123',
    };

    beforeEach(async () => {
      await multiHopManager.initialize();
    });

    it('should execute a successful multi-hop transfer', async () => {
      const mockRoute = {
        source: 'osmosis-1',
        destination: 'juno-1',
        path: ['osmosis-1', 'cosmos-hub', 'juno-1'],
        channels: [],
        estimatedTime: 180,
        estimatedFee: 1000,
      };

      const mockForwardPaths = [
        {
          receiver: 'cosmos1intermediate',
          channel: 'channel-1',
          port: 'transfer',
          timeout: '100000',
        },
        {
          receiver: 'juno1receiver',
          channel: 'channel-2',
          port: 'transfer',
          timeout: '200000',
        },
      ];

      mockRouteDiscovery.findRoutes.mockResolvedValue([mockRoute]);
      mockPacketForward.planMultiHopTransfer.mockResolvedValue(mockForwardPaths as any);
      mockPacketForward.validateTimelocksForRoute.mockReturnValue({ valid: true, adjustedTimelocks: [] });
      mockPacketForward.calculateFees.mockResolvedValue({
        totalFee: '1000',
        feeBreakdown: [{ chain: 'cosmos-hub', fee: '500' }],
      });
      mockIBCHandler.sendHTLCIBCTransfer.mockResolvedValue('0xtxhash');

      const transferId = await multiHopManager.executeMultiHopTransfer(
        'osmosis-1',
        'juno-1',
        'channel-0',
        '1000000',
        htlcParams
      );

      expect(transferId).toBeDefined();
      expect(mockRouteDiscovery.findRoutes).toHaveBeenCalledWith('osmosis-1', 'juno-1');
      expect(mockPacketForward.planMultiHopTransfer).toHaveBeenCalledWith(
        'osmosis-1',
        'juno-1',
        'osmo1receiver',
        htlcParams
      );
      expect(mockPacketForward.validateTimelocksForRoute).toHaveBeenCalledWith(
        mockRoute,
        htlcParams.timelock
      );
      expect(mockIBCHandler.sendHTLCIBCTransfer).toHaveBeenCalledWith(
        'channel-0',
        '1000000',
        htlcParams,
        expect.any(Array)
      );

      // Check transfer status
      const transfer = await multiHopManager.getTransfer(transferId);
      expect(transfer).toBeDefined();
      expect(transfer).toMatchObject({
        id: transferId,
        status: 'completed',
        route: mockRoute.path,
        totalHops: 2,
        currentHop: 1,
        txHashes: ['0xtxhash'],
      });
    });

    it('should fail if no route is found', async () => {
      mockRouteDiscovery.findRoutes.mockResolvedValue([]);

      await expect(
        multiHopManager.executeMultiHopTransfer(
          'osmosis-1',
          'unknown-chain',
          'channel-0',
          '1000000',
          htlcParams
        )
      ).rejects.toThrow('No route found');

      // Check transfer status
      const transfers = await multiHopManager.getPendingTransfers();
      expect(transfers).toHaveLength(0);
    });

    it('should fail if timelock validation fails', async () => {
      const mockRoute = {
        source: 'osmosis-1',
        destination: 'juno-1',
        path: ['osmosis-1', 'cosmos-hub', 'juno-1'],
        channels: [],
        estimatedTime: 180,
        estimatedFee: 1000,
      };

      mockRouteDiscovery.findRoutes.mockResolvedValue([mockRoute]);
      mockPacketForward.planMultiHopTransfer.mockResolvedValue([]);
      mockPacketForward.validateTimelocksForRoute.mockReturnValue({
        valid: false,
        adjustedTimelocks: [],
      });

      await expect(
        multiHopManager.executeMultiHopTransfer(
          'osmosis-1',
          'juno-1',
          'channel-0',
          '1000000',
          htlcParams
        )
      ).rejects.toThrow('Insufficient time for multi-hop transfer');
    });

    it('should fail if no IBC handler exists for source chain', async () => {
      const mockRoute = {
        source: 'unknown-chain',
        destination: 'cosmos-hub',
        path: ['unknown-chain', 'cosmos-hub'],
        channels: [],
        estimatedTime: 180,
        estimatedFee: 1000,
      };

      mockRouteDiscovery.findRoutes.mockResolvedValue([mockRoute]);
      mockPacketForward.planMultiHopTransfer.mockResolvedValue([]);
      mockPacketForward.validateTimelocksForRoute.mockReturnValue({ valid: true, adjustedTimelocks: [] });

      await expect(
        multiHopManager.executeMultiHopTransfer(
          'unknown-chain',
          'cosmos-hub',
          'channel-0',
          '1000000',
          htlcParams
        )
      ).rejects.toThrow('No IBC handler for chain unknown-chain');
    });

    it('should handle IBC transfer errors', async () => {
      const mockRoute = {
        source: 'osmosis-1',
        destination: 'cosmos-hub',
        path: ['osmosis-1', 'cosmos-hub'],
        channels: [],
        estimatedTime: 180,
        estimatedFee: 1000,
      };

      mockRouteDiscovery.findRoutes.mockResolvedValue([mockRoute]);
      mockPacketForward.planMultiHopTransfer.mockResolvedValue([]);
      mockPacketForward.validateTimelocksForRoute.mockReturnValue({ valid: true, adjustedTimelocks: [] });
      mockPacketForward.calculateFees.mockResolvedValue({ totalFee: '1000', feeBreakdown: [] });
      mockIBCHandler.sendHTLCIBCTransfer.mockRejectedValue(new Error('IBC error'));

      await expect(
        multiHopManager.executeMultiHopTransfer(
          'osmosis-1',
          'cosmos-hub',
          'channel-0',
          '1000000',
          htlcParams
        )
      ).rejects.toThrow('IBC error');
    });
  });

  describe('transfer management', () => {
    it('should track multiple transfers', async () => {
      await multiHopManager.initialize();

      const htlcParams1: Omit<HTLCMemo, 'type'> = {
        htlcId: 'htlc1',
        receiver: 'osmo1receiver',
        hashlock: '0xhash1',
        timelock: Math.floor(Date.now() / 1000) + 7200,
        targetChain: 'juno',
        targetAddress: 'juno1receiver',
        sourceChain: 'ethereum',
        sourceHTLCId: 'eth1',
      };

      const htlcParams2: Omit<HTLCMemo, 'type'> = {
        htlcId: 'htlc2',
        receiver: 'osmo2receiver',
        hashlock: '0xhash2',
        timelock: Math.floor(Date.now() / 1000) + 7200,
        targetChain: 'cosmos',
        targetAddress: 'cosmos1receiver',
        sourceChain: 'ethereum',
        sourceHTLCId: 'eth2',
      };

      const mockRoute = {
        source: 'osmosis-1',
        destination: 'cosmos-hub',
        path: ['osmosis-1', 'cosmos-hub'],
        channels: [],
        estimatedTime: 180,
        estimatedFee: 1000,
      };

      mockRouteDiscovery.findRoutes.mockResolvedValue([mockRoute]);
      mockPacketForward.planMultiHopTransfer.mockResolvedValue([]);
      mockPacketForward.validateTimelocksForRoute.mockReturnValue({ valid: true, adjustedTimelocks: [] });
      mockPacketForward.calculateFees.mockResolvedValue({ totalFee: '1000', feeBreakdown: [] });
      mockIBCHandler.sendHTLCIBCTransfer.mockResolvedValue('0xtxhash');

      // Create two transfers
      const transferId1 = await multiHopManager.executeMultiHopTransfer(
        'osmosis-1',
        'juno-1',
        'channel-0',
        '1000000',
        htlcParams1
      );

      const transferId2 = await multiHopManager.executeMultiHopTransfer(
        'osmosis-1',
        'cosmos-hub',
        'channel-0',
        '2000000',
        htlcParams2
      );

      const transfer1 = await multiHopManager.getTransfer(transferId1);
      const transfer2 = await multiHopManager.getTransfer(transferId2);
      
      expect(transfer1?.htlcParams.htlcId).toBe('htlc1');
      expect(transfer2?.htlcParams.htlcId).toBe('htlc2');
    });

    it('should return null for non-existent transfer', async () => {
      const transfer = await multiHopManager.getTransfer('non-existent');
      expect(transfer).toBeNull();
    });
  });
});
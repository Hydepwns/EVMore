import { ethers } from 'ethers';
import pino from 'pino';
import { RelayService } from '../../src/relay/relay-service';
import { HTLCCreatedEvent } from '../../src/monitor/ethereum-monitor';
import { CosmosHTLCEvent } from '../../src/monitor/cosmos-monitor';
import { MultiHopManager } from '../../src/ibc/multi-hop-manager';
import { RouteDiscovery } from '../../src/routes/route-discovery';
import { DexIntegrationService, SwapExecutionPlan } from '../../src/dex/dex-integration';
import { AppConfig } from '../../src/config';

// Mock dependencies
jest.mock('../../src/ibc/multi-hop-manager');
jest.mock('../../src/dex/dex-integration');

describe('RelayService', () => {
  let relayService: RelayService;
  let mockMultiHopManager: jest.Mocked<MultiHopManager>;
  let mockDexIntegration: jest.Mocked<DexIntegrationService>;
  let mockLogger: pino.Logger;
  let mockRouteDiscovery: jest.Mocked<RouteDiscovery>;
  let config: AppConfig;

  const htlcContractAddresses = {
    osmosis: 'osmo1htlc',
    cosmos: 'cosmos1htlc',
  };

  beforeEach(() => {
    // Setup mocks
    mockMultiHopManager = {
      initialize: jest.fn(),
      executeMultiHopTransfer: jest.fn(),
    } as any;

    mockDexIntegration = {
      initialize: jest.fn(),
      planCrossChainSwap: jest.fn(),
      executeSwapForHTLC: jest.fn(),
    } as any;

    mockRouteDiscovery = {} as any;

    // Mock constructors
    (MultiHopManager as jest.MockedClass<typeof MultiHopManager>).mockImplementation(
      () => mockMultiHopManager
    );
    (DexIntegrationService as jest.MockedClass<typeof DexIntegrationService>).mockImplementation(
      () => mockDexIntegration
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

    relayService = new RelayService(config, mockLogger, mockRouteDiscovery, htlcContractAddresses);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize sub-services', async () => {
      await relayService.initialize();

      expect(mockMultiHopManager.initialize).toHaveBeenCalled();
      expect(mockDexIntegration.initialize).toHaveBeenCalled();
    });
  });

  describe('handleEthereumHTLC', () => {
    const mockEvent: HTLCCreatedEvent = {
      htlcId: '0x123',
      sender: '0xsender',
      token: '0xtoken',
      amount: ethers.BigNumber.from('1000000'),
      hashlock: '0xhash',
      timelock: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      targetChain: 'osmosis',
      targetAddress: 'osmo1receiver',
      blockNumber: 12345,
      transactionHash: '0xtx',
    };

    it('should create and process a pending relay', async () => {
      mockMultiHopManager.executeMultiHopTransfer.mockResolvedValue('transfer123');

      await relayService.handleEthereumHTLC(mockEvent);

      // Check that relay was created
      const pendingRelays = relayService.getPendingRelays();
      expect(pendingRelays).toHaveLength(1);
      expect(pendingRelays[0]).toMatchObject({
        id: 'eth_0x123',
        sourceChain: 'ethereum',
        targetChain: 'osmosis',
        htlcId: '0x123',
        amount: '1000000',
        status: 'completed',
      });

      // Check that transfer was executed
      expect(mockMultiHopManager.executeMultiHopTransfer).toHaveBeenCalledWith(
        'ethereum',
        'osmosis',
        'channel-0',
        '1000000',
        expect.objectContaining({
          htlcId: '0x123',
          receiver: 'osmo1receiver',
          hashlock: '0xhash',
        })
      );
    });

    it('should handle relay with swap parameters', async () => {
      const swapPlan: SwapExecutionPlan = {
        htlcId: '0x123',
        swapRoutes: [{ poolId: '1', tokenOutDenom: 'uosmo' }],
        estimatedOutput: '950000',
        priceImpact: '0.005',
        totalFees: '1000',
      };

      mockDexIntegration.planCrossChainSwap.mockResolvedValue(swapPlan);
      mockMultiHopManager.executeMultiHopTransfer.mockResolvedValue('transfer123');
      mockDexIntegration.executeSwapForHTLC.mockResolvedValue('0xswaptx');

      // Override checkForSwapParams to return swap params
      (relayService as any).checkForSwapParams = jest.fn().mockResolvedValue({
        targetToken: 'uosmo',
        minOutputAmount: '900000',
      });

      await relayService.handleEthereumHTLC(mockEvent);

      // Check that swap was planned
      expect(mockDexIntegration.planCrossChainSwap).toHaveBeenCalledWith({
        sourceChain: 'ethereum',
        sourceToken: '0xtoken',
        sourceAmount: '1000000',
        targetChain: 'osmosis',
        targetToken: 'uosmo',
        minOutputAmount: '900000',
        receiver: 'osmo1receiver',
        deadline: mockEvent.timelock,
      });

      // Check that swap was executed
      expect(mockDexIntegration.executeSwapForHTLC).toHaveBeenCalledWith(
        '0x123',
        'osmosis',
        'osmo1receiver'
      );

      // Check metrics
      expect(relayService.getMetrics().swapsExecuted).toBe(1);
    });

    it('should handle multi-hop transfers', async () => {
      const multiHopEvent = { ...mockEvent, targetChain: 'juno' };
      mockMultiHopManager.executeMultiHopTransfer.mockResolvedValue('transfer123');

      await relayService.handleEthereumHTLC(multiHopEvent);

      // Should use multi-hop transfer
      expect(mockMultiHopManager.executeMultiHopTransfer).toHaveBeenCalledWith(
        'ethereum',
        'juno',
        'channel-0',
        '1000000',
        expect.objectContaining({
          targetChain: 'juno',
        })
      );
    });

    it('should retry failed relays', async () => {
      mockMultiHopManager.executeMultiHopTransfer
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('transfer123');

      jest.useFakeTimers();

      await relayService.handleEthereumHTLC(mockEvent);

      // First attempt should fail
      expect(mockMultiHopManager.executeMultiHopTransfer).toHaveBeenCalledTimes(1);
      
      const pendingRelays = relayService.getPendingRelays();
      expect(pendingRelays[0].status).toBe('pending');
      expect(pendingRelays[0].attempts).toBe(1);

      // Fast forward to retry
      jest.advanceTimersByTime(config.relay.retryDelay);
      await Promise.resolve(); // Let promises resolve

      // Second attempt should succeed
      expect(mockMultiHopManager.executeMultiHopTransfer).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('should mark relay as failed after max retries', async () => {
      mockMultiHopManager.executeMultiHopTransfer.mockRejectedValue(new Error('Network error'));

      jest.useFakeTimers();

      await relayService.handleEthereumHTLC(mockEvent);

      // Retry up to max attempts
      for (let i = 0; i < config.relay.maxRetries; i++) {
        jest.advanceTimersByTime(config.relay.retryDelay);
        await Promise.resolve();
      }

      const pendingRelays = relayService.getPendingRelays();
      expect(pendingRelays[0].status).toBe('failed');
      expect(pendingRelays[0].attempts).toBe(config.relay.maxRetries);

      // Check metrics
      expect(relayService.getMetrics()).toMatchObject({
        totalRelayed: 1,
        successfulRelays: 0,
        failedRelays: 1,
      });

      jest.useRealTimers();
    });
  });

  describe('handleCosmosHTLC', () => {
    const mockEvent: CosmosHTLCEvent = {
      htlcId: 'cosmos123',
      sender: 'cosmos1sender',
      receiver: 'cosmos1receiver',
      amount: [{ denom: 'uosmo', amount: '1000000' }],
      hashlock: '0xhash',
      timelock: Math.floor(Date.now() / 1000) + 3600,
      targetChain: 'ethereum',
      targetAddress: '0xeth',
      height: 100,
      txHash: '0xtx',
      type: 'created',
    };

    it('should handle Cosmos HTLC events', async () => {
      await expect(relayService.handleCosmosHTLC(mockEvent)).resolves.not.toThrow();
    });
  });

  describe('metrics and status', () => {
    it('should track metrics correctly', async () => {
      const mockEvent: HTLCCreatedEvent = {
        htlcId: '0x123',
        sender: '0xsender',
        token: '0xtoken',
        amount: ethers.BigNumber.from('1000000'),
        hashlock: '0xhash',
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'osmosis',
        targetAddress: 'osmo1receiver',
        blockNumber: 12345,
        transactionHash: '0xtx',
      };

      mockMultiHopManager.executeMultiHopTransfer.mockResolvedValue('transfer123');

      await relayService.handleEthereumHTLC(mockEvent);

      expect(relayService.getMetrics()).toEqual({
        totalRelayed: 1,
        successfulRelays: 1,
        failedRelays: 0,
        swapsExecuted: 0,
      });
    });

    it('should count pending relays correctly', async () => {
      expect(relayService.getPendingCount()).toBe(0);

      const mockEvent: HTLCCreatedEvent = {
        htlcId: '0x123',
        sender: '0xsender',
        token: '0xtoken',
        amount: ethers.BigNumber.from('1000000'),
        hashlock: '0xhash',
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'osmosis',
        targetAddress: 'osmo1receiver',
        blockNumber: 12345,
        transactionHash: '0xtx',
      };

      // Mock a slow transfer
      mockMultiHopManager.executeMultiHopTransfer.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('transfer123'), 1000))
      );

      const promise = relayService.handleEthereumHTLC(mockEvent);

      // Should have 1 pending relay while processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(relayService.getPendingCount()).toBe(1);

      await promise;
      expect(relayService.getPendingCount()).toBe(0);
    });
  });

  describe('channel selection', () => {
    it('should select correct channel for ethereum source', async () => {
      const mockEvent: HTLCCreatedEvent = {
        htlcId: '0x123',
        sender: '0xsender',
        token: '0xtoken',
        amount: ethers.BigNumber.from('1000000'),
        hashlock: '0xhash',
        timelock: Math.floor(Date.now() / 1000) + 3600,
        targetChain: 'osmosis',
        targetAddress: 'osmo1receiver',
        blockNumber: 12345,
        transactionHash: '0xtx',
      };

      mockMultiHopManager.executeMultiHopTransfer.mockResolvedValue('transfer123');

      await relayService.handleEthereumHTLC(mockEvent);

      expect(mockMultiHopManager.executeMultiHopTransfer).toHaveBeenCalledWith(
        'ethereum',
        'osmosis',
        'channel-0', // Ethereum channel
        expect.any(String),
        expect.any(Object)
      );
    });
  });
});
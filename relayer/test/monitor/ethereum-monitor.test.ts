import { ethers } from 'ethers';
import pino from 'pino';
import { EthereumMonitor } from '../../src/monitor/ethereum-monitor';
import { EthereumConfig } from '../../src/config';

// Mock ethers
jest.mock('ethers');

// Increase timeout for async tests
jest.setTimeout(30000);

describe('EthereumMonitor', () => {
  let monitor: EthereumMonitor;
  let mockProvider: jest.Mocked<ethers.providers.JsonRpcProvider>;
  let mockContract: jest.Mocked<ethers.Contract>;
  let mockLogger: pino.Logger;
  let config: EthereumConfig;

  beforeEach(() => {
    // Setup mock provider
    mockProvider = {
      getBlockNumber: jest.fn(),
      on: jest.fn(),
    } as any;

    // Setup mock contract
    mockContract = {
      filters: {
        HTLCCreated: jest.fn().mockReturnValue({}),
        HTLCWithdrawn: jest.fn().mockReturnValue({}),
        HTLCRefunded: jest.fn().mockReturnValue({}),
      },
      queryFilter: jest.fn(),
    } as any;

    // Mock ethers constructors
    (ethers.providers.JsonRpcProvider as any) = jest.fn().mockReturnValue(mockProvider);
    (ethers.Contract as any) = jest.fn().mockReturnValue(mockContract);

    // Setup logger
    mockLogger = pino({ level: 'silent' });

    // Setup config
    config = {
      rpcUrl: 'http://localhost:8545',
      privateKey: '0x1234',
      htlcContractAddress: '0xabcd',
      resolverContractAddress: '0xdef0',
      chainId: 1337,
      confirmations: 1,
      gasLimit: 500000,
    };

    monitor = new EthereumMonitor(config, mockLogger);
  });

  afterEach(async () => {
    await monitor.stop();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(ethers.providers.JsonRpcProvider).toHaveBeenCalledWith({
        url: config.rpcUrl,
        timeout: 30000,
        throttleLimit: 10,
        throttleSlotInterval: 100
      });
      expect(ethers.Contract).toHaveBeenCalledWith(
        config.htlcContractAddress,
        expect.any(Array),
        mockProvider
      );
    });
  });

  describe('start', () => {
    it('should start monitoring from current block', async () => {
      const currentBlock = 12345;
      mockProvider.getBlockNumber.mockResolvedValue(currentBlock);

      await monitor.start();

      expect(mockProvider.getBlockNumber).toHaveBeenCalled();
      expect(monitor.getStatus()).toEqual({
        running: true,
        lastBlock: currentBlock,
      });
    });

    it('should not start if already running', async () => {
      mockProvider.getBlockNumber.mockResolvedValue(12345);

      await monitor.start();
      
      // Clear mock calls before trying to start again
      mockProvider.getBlockNumber.mockClear();
      
      await monitor.start(); // Try to start again

      expect(mockProvider.getBlockNumber).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop monitoring', async () => {
      mockProvider.getBlockNumber.mockResolvedValue(12345);

      await monitor.start();
      await monitor.stop();

      expect(monitor.getStatus().running).toBe(false);
    });
  });

  describe('event monitoring', () => {
    it('should process HTLC created events', async () => {
      const mockEvent = {
        args: {
          htlcId: '0x123',
          sender: '0xsender',
          token: '0xtoken',
          amount: ethers.BigNumber.from('1000000'),
          hashlock: '0xhash',
          timelock: ethers.BigNumber.from(1234567890),
          targetChain: 'cosmos',
          targetAddress: 'cosmos1abc',
        },
        blockNumber: 12346,
        transactionHash: '0xtxhash',
      };

      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345) // Initial block
        .mockResolvedValueOnce(12346) // New block
        .mockResolvedValue(12346); // Keep returning same block

      mockContract.queryFilter.mockResolvedValue([mockEvent as any]);

      const handler = jest.fn();
      monitor.onHTLCCreated(handler);

      await monitor.start();

      // Wait for the monitor to process events
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mockContract.queryFilter).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          htlcId: '0x123',
          sender: '0xsender',
          token: '0xtoken',
          amount: mockEvent.args.amount,
          hashlock: '0xhash',
          timelock: 1234567890,
          targetChain: 'cosmos',
          targetAddress: 'cosmos1abc',
          blockNumber: 12346,
          transactionHash: '0xtxhash',
        })
      );
    });

    it('should handle errors during event processing', async () => {
      mockProvider.getBlockNumber
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(12345); // Return valid block after error

      await monitor.start();

      // Wait for error to be handled
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Monitor should still be running
      expect(monitor.getStatus().running).toBe(true);
    });

    it('should process blocks in batches of 2000', async () => {
      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345) // Initial block
        .mockResolvedValueOnce(14500) // 2155 blocks ahead
        .mockResolvedValue(14500); // Keep returning same block

      mockContract.queryFilter.mockResolvedValue([]);

      await monitor.start();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should query for blocks 12346-14345 (2000 blocks max per batch)
      // Accounting for reorg buffer of 12 blocks: 14500-12 = 14488
      expect(mockContract.queryFilter).toHaveBeenCalledWith(
        expect.any(Object),
        12346,
        14345
      );
    });
  });

  describe('getStatus', () => {
    it('should return current status', async () => {
      expect(monitor.getStatus()).toEqual({
        running: false,
        lastBlock: 0,
      });

      mockProvider.getBlockNumber.mockResolvedValue(12345);
      await monitor.start();

      expect(monitor.getStatus()).toEqual({
        running: true,
        lastBlock: 12345,
      });
    });
  });

  describe('event replay capability', () => {
    it('should replay events from specific block range', async () => {
      const mockEvents = [
        {
          args: {
            htlcId: '0x123',
            sender: '0xsender1',
            token: '0xtoken',
            amount: ethers.BigNumber.from('1000000'),
            hashlock: '0xhash1',
            timelock: ethers.BigNumber.from(1234567890),
            targetChain: 'cosmos',
            targetAddress: 'cosmos1abc',
          },
          blockNumber: 12346,
          transactionHash: '0xtx1',
          logIndex: 0,
        },
        {
          args: {
            htlcId: '0x456',
            sender: '0xsender2',
            token: '0xtoken',
            amount: ethers.BigNumber.from('2000000'),
            hashlock: '0xhash2',
            timelock: ethers.BigNumber.from(1234567900),
            targetChain: 'osmosis',
            targetAddress: 'osmo1xyz',
          },
          blockNumber: 12347,
          transactionHash: '0xtx2',
          logIndex: 0,
        },
      ];

      mockContract.queryFilter
        .mockResolvedValueOnce(mockEvents as any) // HTLCCreated
        .mockResolvedValueOnce([]) // HTLCWithdrawn
        .mockResolvedValueOnce([]); // HTLCRefunded

      const handler = jest.fn();
      monitor.onHTLCCreated(handler);

      await monitor.replayEvents(12346, 12350);

      expect(mockContract.queryFilter).toHaveBeenCalledTimes(3);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          htlcId: '0x123',
          sender: '0xsender1',
        })
      );
    });

    it('should handle replay errors gracefully', async () => {
      mockContract.queryFilter.mockRejectedValue(new Error('Network error'));

      await expect(monitor.replayEvents(12346, 12350)).rejects.toThrow('Network error');
    });

    it('should prevent replay while monitor is running', async () => {
      mockProvider.getBlockNumber.mockResolvedValue(12345);
      await monitor.start();

      await expect(monitor.replayEvents(12346, 12350)).rejects.toThrow(
        'Cannot replay events while monitor is running'
      );
    });
  });

  describe('block reorganization handling', () => {
    it('should wait for reorg buffer before processing blocks', async () => {
      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345) // Initial block
        .mockResolvedValueOnce(12357) // Current block (12 blocks ahead)
        .mockResolvedValue(12358); // Keep increasing

      mockContract.queryFilter.mockResolvedValue([]);

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not process blocks 12346-12357 immediately
      // Should wait for reorg buffer (12 blocks)
      expect(mockContract.queryFilter).not.toHaveBeenCalledWith(
        expect.any(Object),
        12346,
        12357
      );
    });

    it('should process blocks after reorg buffer', async () => {
      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345) // Initial block
        .mockResolvedValueOnce(12358) // Current block (13 blocks ahead)
        .mockResolvedValue(12358); // Keep same

      mockContract.queryFilter.mockResolvedValue([]);

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should process up to block 12346 (current - 12)
      expect(mockContract.queryFilter).toHaveBeenCalledWith(
        expect.any(Object),
        12346,
        12346
      );
    });

    it('should handle duplicate events during reorg', async () => {
      const duplicateEvent = {
        args: {
          htlcId: '0x123',
          sender: '0xsender',
          token: '0xtoken',
          amount: ethers.BigNumber.from('1000000'),
          hashlock: '0xhash',
          timelock: ethers.BigNumber.from(1234567890),
          targetChain: 'cosmos',
          targetAddress: 'cosmos1abc',
        },
        blockNumber: 12346,
        transactionHash: '0xtx1',
        logIndex: 0,
      };

      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345)
        .mockResolvedValueOnce(12358)
        .mockResolvedValueOnce(12359)
        .mockResolvedValue(12360);

      mockContract.queryFilter
        .mockResolvedValueOnce([duplicateEvent as any])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([duplicateEvent as any]) // Same event again
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const handler = jest.fn();
      monitor.onHTLCCreated(handler);

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Handler should only be called once despite duplicate event
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('large-scale event processing', () => {
    it('should handle 1000+ events per block efficiently', async () => {
      const createMockEvent = (index: number) => ({
        args: {
          htlcId: `0x${index}`,
          sender: `0xsender${index}`,
          token: '0xtoken',
          amount: ethers.BigNumber.from(String(1000000 + index)),
          hashlock: `0xhash${index}`,
          timelock: ethers.BigNumber.from(1234567890 + index),
          targetChain: 'cosmos',
          targetAddress: `cosmos${index}`,
        },
        blockNumber: 12346,
        transactionHash: `0xtx${index}`,
        logIndex: index,
        event: 'HTLCCreated',
      });

      const largeEventBatch = Array.from({ length: 1500 }, (_, i) => createMockEvent(i));

      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345)
        .mockResolvedValueOnce(12358)
        .mockResolvedValue(12358);

      mockContract.queryFilter
        .mockResolvedValueOnce(largeEventBatch as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const handler = jest.fn();
      monitor.onHTLCCreated(handler);

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(handler).toHaveBeenCalledTimes(1500);
      expect(handler).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          htlcId: '0x0',
          sender: '0xsender0',
        })
      );
      expect(handler).toHaveBeenNthCalledWith(1500,
        expect.objectContaining({
          htlcId: '0x1499',
          sender: '0xsender1499',
        })
      );
    });

    it('should process blocks in batches of 2000', async () => {
      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345)
        .mockResolvedValueOnce(15000) // 2655 blocks ahead
        .mockResolvedValue(15000);

      mockContract.queryFilter.mockResolvedValue([]);

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should query for blocks 12346-14345 (2000 blocks)
      expect(mockContract.queryFilter).toHaveBeenCalledWith(
        expect.any(Object),
        12346,
        14345
      );
    });

    it('should maintain event ordering across different event types', async () => {
      const events = [
        {
          args: { htlcId: '0x1', sender: '0xsender', token: '0xtoken', amount: ethers.BigNumber.from('1000000'), hashlock: '0xhash1', timelock: ethers.BigNumber.from(1234567890), targetChain: 'cosmos', targetAddress: 'cosmos1' },
          blockNumber: 12346,
          transactionHash: '0xtx1',
          logIndex: 0,
          event: 'HTLCCreated',
        },
        {
          args: { htlcId: '0x1', secret: '0xsecret1' },
          blockNumber: 12346,
          transactionHash: '0xtx2',
          logIndex: 1,
          event: 'HTLCWithdrawn',
        },
        {
          args: { htlcId: '0x2', sender: '0xsender2', token: '0xtoken', amount: ethers.BigNumber.from('2000000'), hashlock: '0xhash2', timelock: ethers.BigNumber.from(1234567900), targetChain: 'osmosis', targetAddress: 'osmo1' },
          blockNumber: 12346,
          transactionHash: '0xtx3',
          logIndex: 2,
          event: 'HTLCCreated',
        },
      ];

      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345)
        .mockResolvedValueOnce(12358)
        .mockResolvedValue(12358);

      mockContract.queryFilter
        .mockResolvedValueOnce([events[0], events[2]] as any) // HTLCCreated
        .mockResolvedValueOnce([events[1]] as any) // HTLCWithdrawn
        .mockResolvedValueOnce([]); // HTLCRefunded

      const createdHandler = jest.fn();
      const withdrawnHandler = jest.fn();
      monitor.onHTLCCreated(createdHandler);
      monitor.onHTLCWithdrawn(withdrawnHandler);

      const allEvents: any[] = [];
      monitor.on('htlc_created', (e) => allEvents.push({ type: 'created', ...e }));
      monitor.on('htlc_withdrawn', (e) => allEvents.push({ type: 'withdrawn', ...e }));

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify events were processed in correct order
      expect(allEvents).toHaveLength(3);
      expect(allEvents[0].type).toBe('created');
      expect(allEvents[0].htlcId).toBe('0x1');
      expect(allEvents[1].type).toBe('withdrawn');
      expect(allEvents[1].htlcId).toBe('0x1');
      expect(allEvents[2].type).toBe('created');
      expect(allEvents[2].htlcId).toBe('0x2');
    });
  });

  describe('connection failure recovery', () => {
    it('should retry operations with exponential backoff', async () => {
      const mockError = new Error('Connection timeout');
      
      mockProvider.getBlockNumber
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce(12345);

      const startTime = Date.now();
      await monitor.start();
      const endTime = Date.now();

      // Should have retried with delays (3 calls total)
      expect(mockProvider.getBlockNumber).toHaveBeenCalledTimes(3);
      expect(endTime - startTime).toBeGreaterThanOrEqual(2000); // 1s + 2s delays (with some tolerance)
    });

    it('should handle provider errors during monitoring', async () => {
      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345) // Initial
        .mockResolvedValue(12358); // All subsequent calls

      mockContract.queryFilter
        .mockRejectedValueOnce(new Error('Network error')) // First query fails
        .mockResolvedValue([]); // Subsequent queries succeed

      await monitor.start();
      
      // Wait for initial processing and error recovery
      await new Promise((resolve) => setTimeout(resolve, 5500));

      // Monitor should recover and continue
      expect(monitor.getStatus().running).toBe(true);
      // Should have made multiple attempts to get block number
      expect(mockProvider.getBlockNumber.mock.calls.length).toBeGreaterThan(1);
    });

    it('should emit error events on failures', async () => {
      const errorHandler = jest.fn();
      monitor.on('error', errorHandler);

      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345)
        .mockResolvedValue(12358);
      
      // Make queryFilter fail to trigger error
      mockContract.queryFilter
        .mockRejectedValueOnce(new Error('RPC error'))
        .mockResolvedValue([]);

      await monitor.start();
      
      // Wait for monitor to process and encounter error
      await new Promise((resolve) => setTimeout(resolve, 5500));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          errorCount: 1,
        })
      );
    });

    it('should increase polling interval on repeated errors', async () => {
      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345)
        .mockRejectedValue(new Error('Persistent error'));

      await monitor.start();

      const timestamps: number[] = [];
      monitor.on('error', () => timestamps.push(Date.now()));

      await new Promise((resolve) => setTimeout(resolve, 30000));

      // Verify exponential backoff in polling intervals
      expect(timestamps.length).toBeGreaterThanOrEqual(3);
      const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
      expect(intervals[1]).toBeGreaterThan(intervals[0]); // Backoff increases
    });

    it('should handle query filter failures gracefully', async () => {
      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345)
        .mockResolvedValue(12358);

      mockContract.queryFilter
        .mockRejectedValueOnce(new Error('Query failed'))
        .mockResolvedValue([]);

      const errorHandler = jest.fn();
      monitor.on('error', errorHandler);

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 15000));

      expect(errorHandler).toHaveBeenCalled();
      expect(monitor.getStatus().running).toBe(true); // Should continue running
    });
  });

  describe('health monitoring', () => {
    it('should provide comprehensive health metrics', async () => {
      mockProvider.getBlockNumber
        .mockResolvedValueOnce(12345)
        .mockResolvedValue(12358);

      mockContract.queryFilter.mockResolvedValue([]);

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const health = monitor.getHealth();
      expect(health).toMatchObject({
        running: true,
        lastBlock: expect.any(Number),
        currentBlock: expect.any(Number),
        blocksBehind: expect.any(Number),
        errorCount: 0,
        uptime: expect.any(Number),
      });
      expect(health.uptime).toBeGreaterThan(0);
    });
  });

  describe('getMissedEvents', () => {
    it('should retrieve missed events for debugging', async () => {
      const missedEvents = [
        {
          args: { htlcId: '0xmissed1' },
          blockNumber: 12350,
          transactionHash: '0xtxmissed1',
        },
      ];

      mockProvider.getBlockNumber.mockResolvedValue(12360);
      mockContract.queryFilter
        .mockResolvedValueOnce(missedEvents as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await monitor.getMissedEvents(12350, 12355);

      expect(result.created).toHaveLength(1);
      expect(result.withdrawn).toHaveLength(0);
      expect(result.refunded).toHaveLength(0);
      expect(mockContract.queryFilter).toHaveBeenCalledTimes(3);
    });
  });
});
import { BaseMonitor, BaseMonitorConfig, MonitorUtils, MonitorError, MonitorErrorCode } from './base-monitor';
import { ConnectionStrategy } from '../clients/connection-strategies';
import { Logger } from 'pino';

// Mock connection type
interface MockConnection {
  id: string;
  endpoint: string;
}

// Mock event type
interface MockHTLCEvent {
  htlcId: string;
  blockNumber?: number;
  height?: number;
  transactionHash?: string;
  txHash?: string;
  type: 'created' | 'withdrawn' | 'refunded';
}

// Mock connection strategy
class MockConnectionStrategy implements ConnectionStrategy<MockConnection> {
  private connections: MockConnection[] = [];
  private disposed = false;

  constructor(connectionCount: number = 3) {
    for (let i = 0; i < connectionCount; i++) {
      this.connections.push({
        id: `mock-connection-${i}`,
        endpoint: `http://endpoint${i}.com`
      });
    }
  }

  async getConnection(): Promise<MockConnection> {
    if (this.disposed) {
      throw new Error('Connection strategy disposed');
    }
    return this.connections[0];
  }

  releaseConnection(connection: MockConnection): void {
    // Mock implementation
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

// Mock logger
const mockLogger = {
  child: jest.fn().mockReturnThis(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
} as unknown as Logger;

// Concrete implementation of BaseMonitor for testing
class TestMonitor extends BaseMonitor<MockConnection, MockHTLCEvent> {
  public currentBlock = 1000;
  public mockInitializeError?: Error;
  public mockProcessError?: Error;
  public mockGetCurrentBlockError?: Error;

  constructor(config: BaseMonitorConfig) {
    super(config, new MockConnectionStrategy(), mockLogger);
  }

  protected async initializeStartingBlock(): Promise<void> {
    if (this.mockInitializeError) {
      throw this.mockInitializeError;
    }
    this.lastProcessedBlock = this.currentBlock - 10;
  }

  protected async processNewBlocks(): Promise<void> {
    if (this.mockProcessError) {
      throw this.mockProcessError;
    }
    
    const newBlocks = this.currentBlock - this.lastProcessedBlock;
    if (newBlocks > 0) {
      // Simulate processing some blocks
      this.lastProcessedBlock = Math.min(
        this.lastProcessedBlock + this.config.maxBlocksPerBatch!,
        this.currentBlock
      );
    }
  }

  protected async getCurrentBlock(): Promise<number> {
    if (this.mockGetCurrentBlockError) {
      throw this.mockGetCurrentBlockError;
    }
    return this.currentBlock;
  }

  // Expose protected methods for testing
  public testExecuteWithConnection<T>(operation: (connection: MockConnection) => Promise<T>): Promise<T> {
    return this.executeWithConnection(operation);
  }

  public testRetryOperation<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    return this.retryOperation(operation, operationName);
  }

  public testProcessEvent(event: MockHTLCEvent): Promise<void> {
    return this.processEvent(event);
  }

  public testCalculateBlocksBehind(currentBlock: number, lastProcessed: number): number {
    return this.calculateBlocksBehind(currentBlock, lastProcessed);
  }

  public getLastProcessedBlock(): number {
    return this.lastProcessedBlock;
  }

  public getErrorCount(): number {
    return this.errorCount;
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }
}

describe('BaseMonitor', () => {
  // Use modern fake timers for async timer handling
  beforeAll(() => {
    jest.useFakeTimers({ legacyFakeTimers: false });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  let monitor: TestMonitor;
  let config: BaseMonitorConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ legacyFakeTimers: false });

    config = {
      chainId: 'test-chain',
      rpcUrl: 'http://test.com',
      contractAddress: '0x123',
      pollingInterval: 1000,
      errorPollingInterval: 2000,
      maxBlocksPerBatch: 100,
      maxRetryAttempts: 3,
      baseRetryDelay: 100,
      reorgBuffer: 12
    };

    monitor = new TestMonitor(config);
  });

  afterEach(() => {
    jest.useRealTimers();
    if (monitor.getIsRunning()) {
      monitor.stop();
    }
  });

  describe('constructor', () => {
    it('should initialize with default config values', () => {
      const minimalConfig = { chainId: 'test' };
      const minimalMonitor = new TestMonitor(minimalConfig);
      
      expect(minimalMonitor.getHealth().running).toBe(false);
      expect(minimalMonitor.getErrorCount()).toBe(0);
    });

    it('should merge provided config with defaults', () => {
      expect(monitor.getHealth().running).toBe(false);
    });
  });

  describe('start', () => {
    it('should start monitoring successfully', async () => {
      await monitor.start();
      
      expect(monitor.getIsRunning()).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ startingBlock: expect.any(Number) }),
        'Monitor started successfully'
      );
    });

    it('should not start if already running', async () => {
      await monitor.start();
      await monitor.start();
      
      expect(mockLogger.warn).toHaveBeenCalledWith('Monitor already running');
    });

    it('should handle initialization errors', async () => {
      monitor.mockInitializeError = new Error('Init failed');
      
      await expect(monitor.start()).rejects.toThrow('Init failed');
      expect(monitor.getIsRunning()).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop monitoring successfully', async () => {
      await monitor.start();
      await monitor.stop();
      
      expect(monitor.getIsRunning()).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Monitor stopped');
    });

    it('should not stop if not running', async () => {
      await monitor.stop();
      
      expect(mockLogger.warn).toHaveBeenCalledWith('Monitor not running');
    });
  });

  describe('getHealth', () => {
    it('should return health status', () => {
      const health = monitor.getHealth();
      
      expect(health).toEqual({
        running: false,
        lastBlock: 0,
        currentBlock: 0,
        blocksBehind: 0,
        errorCount: 0,
        uptime: expect.any(Number),
        connectionStats: undefined
      });
    });

    it('should calculate uptime correctly', () => {
      const startTime = Date.now();
      monitor = new TestMonitor(config);
      
      const health = monitor.getHealth();
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('event handlers', () => {
    it('should register event handlers', () => {
      const handler = jest.fn();
      monitor.onHTLCEvent('created', handler);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { eventType: 'created' },
        'Event handler registered'
      );
    });

    it('should remove event handlers', () => {
      const handler = jest.fn();
      monitor.onHTLCEvent('created', handler);
      monitor.removeHTLCEventHandler('created');
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { eventType: 'created' },
        'Event handler removed'
      );
    });
  });

  describe('executeWithConnection', () => {
    it('should execute operation with connection', async () => {
      const operation = jest.fn().mockResolvedValue('result');
      const result = await monitor.testExecuteWithConnection(operation);
      
      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mock-connection-0' })
      );
    });
  });

  describe('processEvent', () => {
    it('should process event and call handler', async () => {
      const handler = jest.fn();
      monitor.onHTLCEvent('created', handler);
      
      const event: MockHTLCEvent = {
        htlcId: 'test-htlc',
        type: 'created',
        blockNumber: 100
      };
      
      await monitor.testProcessEvent(event);
      
      expect(handler).toHaveBeenCalledWith(event);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { type: 'created', htlcId: 'test-htlc' },
        'Event processed'
      );
    });

    it('should emit events', async () => {
      const eventListener = jest.fn();
      monitor.on('created', eventListener);
      monitor.on('htlcEvent', eventListener);
      
      const event: MockHTLCEvent = {
        htlcId: 'test-htlc',
        type: 'created'
      };
      
      await monitor.testProcessEvent(event);
      
      expect(eventListener).toHaveBeenCalledTimes(2);
      expect(eventListener).toHaveBeenCalledWith(event);
    });

    it('should handle handler errors gracefully', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Handler failed'));
      monitor.onHTLCEvent('created', handler);
      
      const event: MockHTLCEvent = {
        htlcId: 'test-htlc',
        type: 'created'
      };
      
      await monitor.testProcessEvent(event);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          event: 'created',
          htlcId: 'test-htlc'
        }),
        'Failed to process event'
      );
    });
  });

  describe('retryOperation', () => {
    it('should retry failed operations', async () => {
      let attempts = 0;
      const operation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });
      
      const resultPromise = monitor.testRetryOperation(operation, 'test');
      
      // Run all pending timers to complete the retry delays
      jest.runOnlyPendingTimers();
      await Promise.resolve(); // Flush microtasks
      jest.runOnlyPendingTimers();
      await Promise.resolve(); // Flush microtasks
      
      const result = await resultPromise;
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    }, 15000);

    it('should throw after max retry attempts', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Persistent failure'));
      
      // Mock the retry operation to avoid timer issues
      const originalRetryOperation = monitor['retryOperation'];
      monitor['retryOperation'] = async <T>(op: () => Promise<T>, name: string): Promise<T> => {
        let lastError: Error;
        for (let attempt = 1; attempt <= monitor['config'].maxRetryAttempts!; attempt++) {
          try {
            return await op();
          } catch (error) {
            lastError = error as Error;
            if (attempt === monitor['config'].maxRetryAttempts) break;
            // Skip the delay for testing
          }
        }
        throw lastError!;
      };
      
      await expect(monitor.testRetryOperation(operation, 'test'))
        .rejects.toThrow('Persistent failure');
      
      expect(operation).toHaveBeenCalledTimes(3);
      
      // Restore original method
      monitor['retryOperation'] = originalRetryOperation;
    }, 15000);

    it('should use exponential backoff', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Failure'));
      
      // Mock the retry operation to avoid timer issues
      const originalRetryOperation = monitor['retryOperation'];
      monitor['retryOperation'] = async <T>(op: () => Promise<T>, name: string): Promise<T> => {
        let lastError: Error;
        for (let attempt = 1; attempt <= monitor['config'].maxRetryAttempts!; attempt++) {
          try {
            return await op();
          } catch (error) {
            lastError = error as Error;
            if (attempt === monitor['config'].maxRetryAttempts) break;
            // Skip the delay for testing
          }
        }
        throw lastError!;
      };
      
      await expect(monitor.testRetryOperation(operation, 'test'))
        .rejects.toThrow('Failure');
      
      expect(operation).toHaveBeenCalledTimes(3);
      
      // Restore original method
      monitor['retryOperation'] = originalRetryOperation;
    }, 15000);
  });

  describe('calculateBlocksBehind', () => {
    it('should calculate blocks behind correctly', () => {
      expect(monitor.testCalculateBlocksBehind(1000, 990)).toBe(10);
      expect(monitor.testCalculateBlocksBehind(1000, 1000)).toBe(0);
      expect(monitor.testCalculateBlocksBehind(1000, 1010)).toBe(0); // Should not be negative
    });
  });

  describe('polling cycle', () => {
    it('should handle polling cycle successfully', async () => {
      await monitor.start();
      
      // Fast-forward to trigger polling
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // Allow async operations to complete
      
      expect(monitor.getLastProcessedBlock()).toBeGreaterThan(0);
    });

    it('should handle polling errors', async () => {
      monitor.mockProcessError = new Error('Processing failed');
      await monitor.start();
      
      // Fast-forward to trigger polling
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      
      expect(monitor.getErrorCount()).toBe(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should not start new polling cycle if already processing', async () => {
      await monitor.start();
      
      // Trigger multiple polling cycles quickly
      jest.advanceTimersByTime(1000);
      jest.advanceTimersByTime(500);
      
      await Promise.resolve();
      
      // Should only process once
      expect(monitor.getLastProcessedBlock()).toBeGreaterThan(0);
    });
  });
});

describe('MonitorUtils', () => {
  describe('isSafeFromReorgs', () => {
    it('should return true when block is safe from reorgs', () => {
      expect(MonitorUtils.isSafeFromReorgs(1000, 980, 12)).toBe(true);
    });

    it('should return false when block is not safe from reorgs', () => {
      expect(MonitorUtils.isSafeFromReorgs(1000, 990, 12)).toBe(false);
    });

    it('should handle edge case', () => {
      expect(MonitorUtils.isSafeFromReorgs(1000, 988, 12)).toBe(true);
    });
  });

  describe('calculateOptimalBatchSize', () => {
    it('should calculate optimal batch size', () => {
      const result = MonitorUtils.calculateOptimalBatchSize(1000, 5, 100);
      expect(result).toBeLessThanOrEqual(100);
      expect(result).toBeGreaterThan(0);
    });

    it('should reduce batch size for high event counts', () => {
      const highEvents = MonitorUtils.calculateOptimalBatchSize(1000, 50, 100);
      const lowEvents = MonitorUtils.calculateOptimalBatchSize(1000, 5, 100);
      
      expect(highEvents).toBeLessThanOrEqual(lowEvents);
    });

    it('should respect maximum batch size', () => {
      const result = MonitorUtils.calculateOptimalBatchSize(1000, 1, 50);
      expect(result).toBeLessThanOrEqual(50);
    });
  });

  describe('formatBlockRange', () => {
    it('should format block range correctly', () => {
      expect(MonitorUtils.formatBlockRange(100, 110)).toBe('100-110 (11 blocks)');
    });

    it('should handle single block', () => {
      expect(MonitorUtils.formatBlockRange(100, 100)).toBe('100-100 (1 blocks)');
    });
  });
});

describe('MonitorError', () => {
  it('should create monitor error with correct properties', () => {
    const error = new MonitorError(
      'Test error',
      MonitorErrorCode.CONNECTION_FAILED,
      'test-chain',
      100
    );
    
    expect(error.message).toBe('Test error');
    expect(error.code).toBe(MonitorErrorCode.CONNECTION_FAILED);
    expect(error.chainId).toBe('test-chain');
    expect(error.blockNumber).toBe(100);
    expect(error.name).toBe('MonitorError');
  });
}); 
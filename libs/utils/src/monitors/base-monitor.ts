/**
 * Base Monitor with shared functionality
 * Eliminates duplication between direct and pooled monitors
 */

import { EventEmitter } from 'events';
import { Logger } from 'pino';
import { ConnectionStrategy } from '../clients/connection-strategies';

/**
 * Common monitor configuration
 */
export interface BaseMonitorConfig {
  chainId: string;
  rpcUrl?: string;
  contractAddress?: string;
  pollingInterval?: number;
  errorPollingInterval?: number;
  maxBlocksPerBatch?: number;
  maxRetryAttempts?: number;
  baseRetryDelay?: number;
  reorgBuffer?: number;
}

/**
 * Monitor health status
 */
export interface MonitorHealth {
  running: boolean;
  lastBlock: number;
  currentBlock: number;
  blocksBehind: number;
  errorCount: number;
  lastError?: string;
  uptime: number;
  connectionStats?: any;
}

/**
 * Common event interfaces
 */
export interface BaseHTLCEvent {
  htlcId: string;
  blockNumber?: number;
  height?: number;
  transactionHash?: string;
  txHash?: string;
  type: 'created' | 'withdrawn' | 'refunded';
}

/**
 * Event handler type
 */
export type EventHandler<T extends BaseHTLCEvent> = (event: T) => Promise<void>;

/**
 * Base monitor class with shared functionality
 */
export abstract class BaseMonitor<TConnection, TEvent extends BaseHTLCEvent> extends EventEmitter {
  protected connectionStrategy: ConnectionStrategy<TConnection>;
  protected config: BaseMonitorConfig;
  protected logger: Logger;
  
  protected isRunning: boolean = false;
  protected lastProcessedBlock: number = 0;
  protected errorCount: number = 0;
  protected startTime: number = Date.now();
  protected eventHandlers: Map<string, EventHandler<TEvent>> = new Map();
  protected processingBatch: boolean = false;
  protected pollingTimer?: NodeJS.Timeout;

  constructor(
    config: BaseMonitorConfig,
    connectionStrategy: ConnectionStrategy<TConnection>,
    logger: Logger
  ) {
    super();
    this.config = {
      pollingInterval: 5000,
      errorPollingInterval: 10000,
      maxBlocksPerBatch: 1000,
      maxRetryAttempts: 5,
      baseRetryDelay: 1000,
      reorgBuffer: 12,
      ...config
    };
    this.connectionStrategy = connectionStrategy;
    this.logger = logger.child({ 
      component: this.constructor.name, 
      chain: config.chainId 
    });
  }

  /**
   * Start monitoring
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Monitor already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();
    this.logger.info('Starting monitor...');

    try {
      // Initialize starting block
      await this.initializeStartingBlock();
      
      // Start polling loop
      this.scheduleNextPoll();
      
      this.logger.info({ 
        startingBlock: this.lastProcessedBlock 
      }, 'Monitor started successfully');
      
    } catch (error) {
      this.logger.error({ error }, 'Failed to start monitor');
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Monitor not running');
      return;
    }

    this.logger.info('Stopping monitor...');
    this.isRunning = false;

    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }

    if (this.connectionStrategy.dispose) {
      await this.connectionStrategy.dispose();
    }

    this.logger.info('Monitor stopped');
  }

  /**
   * Get monitor health status
   */
  public getHealth(): MonitorHealth {
    return {
      running: this.isRunning,
      lastBlock: this.lastProcessedBlock,
      currentBlock: 0, // Will be set by implementations
      blocksBehind: 0, // Will be calculated by implementations
      errorCount: this.errorCount,
      uptime: Date.now() - this.startTime,
      connectionStats: this.getConnectionStats()
    };
  }

  /**
   * Register event handler
   */
  public onHTLCEvent(eventType: string, handler: EventHandler<TEvent>): void {
    this.eventHandlers.set(eventType, handler);
    this.logger.debug({ eventType }, 'Event handler registered');
  }

  /**
   * Remove event handler
   */
  public removeHTLCEventHandler(eventType: string): void {
    this.eventHandlers.delete(eventType);
    this.logger.debug({ eventType }, 'Event handler removed');
  }

  /**
   * Execute operation with connection management
   */
  protected async executeWithConnection<T>(
    operation: (connection: TConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.connectionStrategy.getConnection();
    try {
      return await operation(connection);
    } finally {
      this.connectionStrategy.releaseConnection(connection);
    }
  }

  /**
   * Handle polling cycle
   */
  protected async handlePollingCycle(): Promise<void> {
    if (!this.isRunning || this.processingBatch) {
      return;
    }

    this.processingBatch = true;
    
    try {
      await this.processNewBlocks();
      this.scheduleNextPoll(this.config.pollingInterval);
    } catch (error) {
      this.errorCount++;
      this.logger.error({ error, errorCount: this.errorCount }, 'Polling cycle failed');
      this.scheduleNextPoll(this.config.errorPollingInterval);
    } finally {
      this.processingBatch = false;
    }
  }

  /**
   * Schedule next polling cycle
   */
  protected scheduleNextPoll(delay?: number): void {
    if (!this.isRunning) return;
    
    const interval = delay || this.config.pollingInterval!;
    this.pollingTimer = setTimeout(() => {
      this.handlePollingCycle();
    }, interval);
  }

  /**
   * Process events and emit them
   */
  protected async processEvent(event: TEvent): Promise<void> {
    try {
      // Call registered handler
      const handler = this.eventHandlers.get(event.type);
      if (handler) {
        await handler(event);
      }

      // Emit event
      this.emit(event.type, event);
      this.emit('htlcEvent', event);

      this.logger.debug({ 
        type: event.type, 
        htlcId: event.htlcId 
      }, 'Event processed');

    } catch (error) {
      this.logger.error({ 
        error, 
        event: event.type, 
        htlcId: event.htlcId 
      }, 'Failed to process event');
    }
  }

  /**
   * Retry operation with exponential backoff
   */
  protected async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.config.maxRetryAttempts!; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === this.config.maxRetryAttempts) {
          break;
        }

        const delay = this.config.baseRetryDelay! * Math.pow(2, attempt - 1);
        this.logger.warn({ 
          error, 
          attempt, 
          maxAttempts: this.config.maxRetryAttempts,
          nextRetryIn: delay,
          operation: operationName
        }, 'Operation failed, retrying...');

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  /**
   * Calculate blocks behind current tip
   */
  protected calculateBlocksBehind(currentBlock: number, lastProcessed: number): number {
    return Math.max(0, currentBlock - lastProcessed);
  }

  /**
   * Abstract methods to be implemented by subclasses
   */
  protected abstract initializeStartingBlock(): Promise<void>;
  protected abstract processNewBlocks(): Promise<void>;
  protected abstract getCurrentBlock(): Promise<number>;
  
  /**
   * Optional method to get connection statistics
   */
  protected getConnectionStats(): any {
    return undefined;
  }
}

/**
 * Monitor error types
 */
export class MonitorError extends Error {
  constructor(
    message: string,
    public code: MonitorErrorCode,
    public chainId?: string,
    public blockNumber?: number
  ) {
    super(message);
    this.name = 'MonitorError';
  }
}

export enum MonitorErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  BLOCK_FETCH_FAILED = 'BLOCK_FETCH_FAILED',
  EVENT_PARSING_FAILED = 'EVENT_PARSING_FAILED',
  HANDLER_FAILED = 'HANDLER_FAILED',
  REORG_DETECTED = 'REORG_DETECTED',
  TIMEOUT = 'TIMEOUT'
}

/**
 * Monitor utilities
 */
export class MonitorUtils {
  /**
   * Check if block range is safe from reorgs
   */
  static isSafeFromReorgs(currentBlock: number, targetBlock: number, buffer: number): boolean {
    return currentBlock - targetBlock >= buffer;
  }

  /**
   * Calculate optimal batch size based on network conditions
   */
  static calculateOptimalBatchSize(
    blockTime: number, 
    avgEventsPerBlock: number, 
    maxBatchSize: number
  ): number {
    // Simple heuristic: reduce batch size if there are many events
    const eventFactor = Math.max(1, avgEventsPerBlock / 10);
    const timeFactor = Math.max(1, blockTime / 1000); // seconds to factor
    
    return Math.min(maxBatchSize, Math.floor(maxBatchSize / (eventFactor * timeFactor)));
  }

  /**
   * Format block range for logging
   */
  static formatBlockRange(from: number, to: number): string {
    return `${from}-${to} (${to - from + 1} blocks)`;
  }
}
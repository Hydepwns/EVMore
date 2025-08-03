/**
 * Backward-compatible Ethereum HTLC Monitor
 * Re-exports the unified monitor for existing code compatibility
 */

import { ethers } from 'ethers';
import { Logger } from 'pino';
import { EthereumConfig } from '../config/index';
import { ConnectionStrategyFactory } from '@evmore/utils';
import { 
  EthereumHTLCMonitor as UnifiedEthereumMonitor,
  EthereumMonitorConfig as UnifiedEthereumConfig,
  EthereumHTLCEvent as UnifiedHTLCEvent,
  EthereumHTLCCreatedEvent as UnifiedCreatedEvent,
  EthereumHTLCWithdrawnEvent as UnifiedWithdrawnEvent,
  EthereumHTLCRefundedEvent as UnifiedRefundedEvent
} from '@evmore/utils';

// Legacy interfaces for backward compatibility
export interface HTLCCreatedEvent {
  htlcId: string;
  sender: string;
  token: string;
  amount: ethers.BigNumber;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
  blockNumber: number;
  transactionHash: string;
}

export interface HTLCWithdrawnEvent {
  htlcId: string;
  secret: string;
  blockNumber: number;
  transactionHash: string;
}

export interface HTLCRefundedEvent {
  htlcId: string;
  blockNumber: number;
  transactionHash: string;
}

export interface MonitorHealth {
  running: boolean;
  lastBlock: number;
  currentBlock: number;
  blocksBehind: number;
  errorCount: number;
  lastError?: string;
  uptime: number;
}

/**
 * Legacy Ethereum HTLC Monitor (Direct Connection)
 * Wrapper around unified monitor for backward compatibility
 */
export class EthereumMonitor {
  private unifiedMonitor: UnifiedEthereumMonitor;
  private legacyConfig: EthereumConfig;

  constructor(config: EthereumConfig, logger: Logger) {
    this.legacyConfig = config;
    
    // Convert legacy config to unified config
    const unifiedConfig: UnifiedEthereumConfig = {
      chainId: config.chainId.toString(),
      rpcUrl: config.rpcUrl,
      htlcContract: config.htlcContractAddress,
      pollingInterval: 5000,
      errorPollingInterval: 10000,
      maxBlocksPerBatch: 2000,
      maxRetryAttempts: 5,
      baseRetryDelay: 1000,
      reorgBuffer: 12
    };

    // Create direct connection strategy
    const strategy = ConnectionStrategyFactory.createEthereumStrategy('direct', {
      rpcUrl: config.rpcUrl
    });

    this.unifiedMonitor = new UnifiedEthereumMonitor(unifiedConfig, strategy, logger);
  }

  /**
   * Start monitoring
   */
  async start(): Promise<void> {
    return await this.unifiedMonitor.start();
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    return await this.unifiedMonitor.stop();
  }

  /**
   * Get monitor health status
   */
  getHealth(): MonitorHealth {
    const health = this.unifiedMonitor.getHealth();
    return {
      running: health.running,
      lastBlock: health.lastBlock,
      currentBlock: health.currentBlock,
      blocksBehind: health.blocksBehind,
      errorCount: health.errorCount,
      lastError: health.lastError,
      uptime: health.uptime
    };
  }

  // Status method for health checks
  getStatus(): any {
    const health = this.unifiedMonitor.getHealth();
    return {
      running: health.running,
      lastBlock: health.lastBlock,
      currentBlock: health.currentBlock,
      blocksBehind: health.blocksBehind,
      errorCount: health.errorCount,
      uptime: health.uptime
    };
  }

  /**
   * Register event handler
   */
  onHTLCCreated(handler: (event: HTLCCreatedEvent) => Promise<void>): void {
    this.unifiedMonitor.onHTLCEvent('created', async (event: UnifiedCreatedEvent) => {
      await handler({
        htlcId: event.htlcId,
        sender: event.sender,
        token: event.token,
        amount: event.amount,
        hashlock: event.hashlock,
        timelock: event.timelock,
        targetChain: event.targetChain,
        targetAddress: event.targetAddress,
        blockNumber: event.blockNumber || 0,
        transactionHash: event.transactionHash || ''
      });
    });
  }

  /**
   * Register withdrawn event handler
   */
  onHTLCWithdrawn(handler: (event: HTLCWithdrawnEvent) => Promise<void>): void {
    this.unifiedMonitor.onHTLCEvent('withdrawn', async (event: UnifiedWithdrawnEvent) => {
      await handler({
        htlcId: event.htlcId,
        secret: event.secret,
        blockNumber: event.blockNumber || 0,
        transactionHash: event.transactionHash || ''
      });
    });
  }

  /**
   * Register refunded event handler
   */
  onHTLCRefunded(handler: (event: HTLCRefundedEvent) => Promise<void>): void {
    this.unifiedMonitor.onHTLCEvent('refunded', async (event: UnifiedRefundedEvent) => {
      await handler({
        htlcId: event.htlcId,
        blockNumber: event.blockNumber || 0,
        transactionHash: event.transactionHash || ''
      });
    });
  }

  /**
   * Event-based monitoring (for fusion mode)
   */
  on(event: string, handler: (data: any) => void): void {
    switch (event) {
      case 'htlc:created':
        this.unifiedMonitor.onHTLCEvent('created', async (unifiedEvent) => {
          const legacyEvent = this.convertCreatedEventToLegacy(unifiedEvent as UnifiedCreatedEvent);
          await handler(legacyEvent);
        });
        break;
      case 'htlc:withdrawn':
        this.unifiedMonitor.onHTLCEvent('withdrawn', async (unifiedEvent) => {
          const legacyEvent = this.convertWithdrawnEventToLegacy(unifiedEvent as UnifiedWithdrawnEvent);
          await handler(legacyEvent);
        });
        break;
      case 'htlc:refunded':
        this.unifiedMonitor.onHTLCEvent('refunded', async (unifiedEvent) => {
          const legacyEvent = this.convertRefundedEventToLegacy(unifiedEvent as UnifiedRefundedEvent);
          await handler(legacyEvent);
        });
        break;
      case 'error':
        this.unifiedMonitor.on('error', handler);
        break;
      default:
        throw new Error(`Unknown event type: ${event}`);
    }
  }

  /**
   * Convert unified created event to legacy format
   */
  private convertCreatedEventToLegacy(event: UnifiedCreatedEvent): HTLCCreatedEvent {
    return {
      htlcId: event.htlcId,
      sender: event.sender,
      token: event.token,
      amount: event.amount,
      hashlock: event.hashlock,
      timelock: event.timelock,
      targetChain: event.targetChain,
      targetAddress: event.targetAddress,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    };
  }

  /**
   * Convert unified withdrawn event to legacy format
   */
  private convertWithdrawnEventToLegacy(event: UnifiedWithdrawnEvent): HTLCWithdrawnEvent {
    return {
      htlcId: event.htlcId,
      secret: event.secret,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    };
  }

  /**
   * Convert unified refunded event to legacy format
   */
  private convertRefundedEventToLegacy(event: UnifiedRefundedEvent): HTLCRefundedEvent {
    return {
      htlcId: event.htlcId,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    };
  }

  /**
   * Check if HTLC exists
   */
  async htlcExists(htlcId: string): Promise<boolean> {
    return await this.unifiedMonitor.htlcExists(htlcId);
  }

  /**
   * Get HTLC details
   */
  async getHTLC(htlcId: string): Promise<any> {
    return await this.unifiedMonitor.getHTLC(htlcId);
  }

  /**
   * Force process specific block (for testing/recovery)
   */
  async forceProcessBlock(blockNumber: number): Promise<void> {
    return await this.unifiedMonitor.forceProcessBlock(blockNumber);
  }

  /**
   * Reset monitor to specific block
   */
  resetToBlock(blockNumber: number): void {
    this.unifiedMonitor.resetToBlock(blockNumber);
  }

  /**
   * Access to underlying unified monitor for advanced usage
   */
  getUnifiedMonitor(): UnifiedEthereumMonitor {
    return this.unifiedMonitor;
  }
}
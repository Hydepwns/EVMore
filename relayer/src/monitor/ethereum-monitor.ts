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
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      htlcContract: config.htlcContract,
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
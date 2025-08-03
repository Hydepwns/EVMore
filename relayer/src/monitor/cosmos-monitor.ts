/**
 * Backward-compatible Cosmos HTLC Monitor
 * Re-exports the unified monitor for existing code compatibility
 */

import { Logger } from 'pino';
import { CosmosConfig } from '../config/index';
import { ConnectionStrategyFactory } from '@evmore/utils';
import { 
  CosmosHTLCMonitor as UnifiedCosmosMonitor,
  CosmosMonitorConfig as UnifiedCosmosConfig,
  CosmosHTLCEvent as UnifiedHTLCEvent,
  CosmosHTLCCreatedEvent as UnifiedCreatedEvent,
  CosmosHTLCWithdrawnEvent as UnifiedWithdrawnEvent,
  CosmosHTLCRefundedEvent as UnifiedRefundedEvent
} from '@evmore/utils';

// Legacy interfaces for backward compatibility
export interface CosmosHTLCEvent {
  htlcId: string;
  sender: string;
  receiver: string;
  amount: Array<{ denom: string; amount: string }>;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
  height: number;
  txHash: string;
  type: 'created' | 'withdrawn' | 'refunded';
}

/**
 * Legacy Cosmos HTLC Monitor (Direct Connection)
 * Wrapper around unified monitor for backward compatibility
 */
export class CosmosMonitor {
  private unifiedMonitor: UnifiedCosmosMonitor;
  private legacyConfig: CosmosConfig;

  constructor(config: CosmosConfig, logger: Logger) {
    this.legacyConfig = config;
    
    // Convert legacy config to unified config
    const unifiedConfig: UnifiedCosmosConfig = {
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      contractAddress: config.htlcContractAddress || '',
      pollingInterval: 10000,
      errorPollingInterval: 5000,
      maxBlocksPerBatch: 100,
      maxRetryAttempts: 3,
      baseRetryDelay: 1000
    };

    // Create direct connection strategy
    const strategy = ConnectionStrategyFactory.createCosmosQueryStrategy('direct', {
      rpcUrl: config.rpcUrl
    });

    this.unifiedMonitor = new UnifiedCosmosMonitor(unifiedConfig, strategy, logger);
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
  getHealth() {
    const health = this.unifiedMonitor.getHealth();
    return {
      running: health.running,
      lastHeight: health.lastBlock,
      currentHeight: health.currentBlock,
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
  onHTLCEvent(
    eventType: string, 
    handler: (event: CosmosHTLCEvent) => Promise<void>
  ): void {
    // Convert unified event to legacy format
    this.unifiedMonitor.onHTLCEvent(eventType, async (unifiedEvent) => {
      const legacyEvent = this.convertEventToLegacy(unifiedEvent);
      await handler(legacyEvent);
    });
  }

  /**
   * Remove event handler
   */
  removeHTLCEventHandler(eventType: string): void {
    this.unifiedMonitor.removeHTLCEventHandler(eventType);
  }

  /**
   * Query HTLC state from contract
   */
  async queryHTLC(htlcId: string): Promise<any> {
    return await this.unifiedMonitor.queryHTLC(htlcId);
  }

  /**
   * Force process specific height (for testing/recovery)
   */
  async forceProcessHeight(height: number): Promise<void> {
    return await this.unifiedMonitor.forceProcessHeight(height);
  }

  /**
   * Reset monitor to specific height
   */
  resetToHeight(height: number): void {
    this.unifiedMonitor.resetToHeight(height);
  }

  /**
   * Event-based monitoring (for fusion mode)
   */
  on(event: string, handler: (data: any) => void): void {
    switch (event) {
      case 'htlc:created':
        this.unifiedMonitor.onHTLCEvent('created', async (unifiedEvent) => {
          const legacyEvent = this.convertEventToLegacy(unifiedEvent);
          await handler(legacyEvent);
        });
        break;
      case 'htlc:withdrawn':
        this.unifiedMonitor.onHTLCEvent('withdrawn', async (unifiedEvent) => {
          const legacyEvent = this.convertEventToLegacy(unifiedEvent);
          await handler(legacyEvent);
        });
        break;
      case 'htlc:refunded':
        this.unifiedMonitor.onHTLCEvent('refunded', async (unifiedEvent) => {
          const legacyEvent = this.convertEventToLegacy(unifiedEvent);
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
   * Convert unified event to legacy format
   */
  private convertEventToLegacy(event: UnifiedHTLCEvent): CosmosHTLCEvent {
    if (event.type === 'created') {
      const createdEvent = event as UnifiedCreatedEvent;
      return {
        htlcId: createdEvent.htlcId,
        sender: createdEvent.sender,
        receiver: createdEvent.receiver,
        amount: createdEvent.amount,
        hashlock: createdEvent.hashlock,
        timelock: createdEvent.timelock,
        targetChain: createdEvent.targetChain,
        targetAddress: createdEvent.targetAddress,
        height: createdEvent.height || 0,
        txHash: createdEvent.txHash || '',
        type: 'created'
      };
    } else if (event.type === 'withdrawn') {
      const withdrawnEvent = event as UnifiedWithdrawnEvent;
      return {
        htlcId: withdrawnEvent.htlcId,
        sender: '',
        receiver: withdrawnEvent.receiver,
        amount: [],
        hashlock: '',
        timelock: 0,
        targetChain: '',
        targetAddress: '',
        height: withdrawnEvent.height || 0,
        txHash: withdrawnEvent.txHash || '',
        type: 'withdrawn'
      };
    } else {
      const refundedEvent = event as UnifiedRefundedEvent;
      return {
        htlcId: refundedEvent.htlcId,
        sender: refundedEvent.sender,
        receiver: '',
        amount: [],
        hashlock: '',
        timelock: 0,
        targetChain: '',
        targetAddress: '',
        height: refundedEvent.height || 0,
        txHash: refundedEvent.txHash || '',
        type: 'refunded'
      };
    }
  }

  /**
   * Access to underlying unified monitor for advanced usage
   */
  getUnifiedMonitor(): UnifiedCosmosMonitor {
    return this.unifiedMonitor;
  }
}
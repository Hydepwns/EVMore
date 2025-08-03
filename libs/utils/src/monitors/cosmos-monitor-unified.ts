/**
 * Unified Cosmos HTLC Monitor
 * Replaces both cosmos-monitor.ts and cosmos-monitor-pooled.ts
 * Uses connection strategy pattern to eliminate duplication
 */

import { Logger } from 'pino';
import { BaseMonitor, BaseMonitorConfig, BaseHTLCEvent, MonitorError, MonitorErrorCode } from './base-monitor';
import { CosmosConnectionStrategy } from '../clients/connection-strategies';

// Import CosmJS types without instantiation to avoid bundling issues
type StargateClient = any; // Will be @cosmjs/stargate StargateClient
type Block = any; // Will be block type from tendermint

/**
 * Cosmos HTLC event interfaces
 */
export interface CosmosHTLCCreatedEvent extends BaseHTLCEvent {
  type: 'created';
  sender: string;
  receiver: string;
  amount: Array<{ denom: string; amount: string }>;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

export interface CosmosHTLCWithdrawnEvent extends BaseHTLCEvent {
  type: 'withdrawn';
  secret: string;
  receiver: string;
}

export interface CosmosHTLCRefundedEvent extends BaseHTLCEvent {
  type: 'refunded';
  sender: string;
}

export type CosmosHTLCEvent = 
  | CosmosHTLCCreatedEvent 
  | CosmosHTLCWithdrawnEvent 
  | CosmosHTLCRefundedEvent;

/**
 * Cosmos monitor configuration
 */
export interface CosmosMonitorConfig extends BaseMonitorConfig {
  contractAddress: string;
  startHeight?: number;
}

/**
 * Unified Cosmos HTLC Monitor
 * Works with both direct and pooled connections
 */
export class CosmosHTLCMonitor extends BaseMonitor<StargateClient, CosmosHTLCEvent> {
  private contractAddress: string;
  private currentHeight: number = 0;

  constructor(
    config: CosmosMonitorConfig,
    connectionStrategy: CosmosConnectionStrategy<StargateClient>,
    logger: Logger
  ) {
    super(config, connectionStrategy, logger);
    this.contractAddress = config.contractAddress;
    
    if (config.startHeight) {
      this.lastProcessedBlock = config.startHeight;
    }
  }

  /**
   * Initialize starting height
   */
  protected async initializeStartingBlock(): Promise<void> {
    if (this.lastProcessedBlock === 0) {
      this.currentHeight = await this.getCurrentBlock();
      this.lastProcessedBlock = Math.max(1, this.currentHeight - 100); // Start 100 blocks back
      this.logger.info({ 
        currentHeight: this.currentHeight,
        startingHeight: this.lastProcessedBlock 
      }, 'Initialized starting height');
    }
  }

  /**
   * Get current block height
   */
  protected async getCurrentBlock(): Promise<number> {
    return await this.executeWithConnection(async (client) => {
      return await client.getHeight();
    });
  }

  /**
   * Process new blocks for HTLC events
   */
  protected async processNewBlocks(): Promise<void> {
    this.currentHeight = await this.retryOperation(
      () => this.getCurrentBlock(),
      'getCurrentHeight'
    );

    // No reorg buffer needed for Cosmos (finality)
    const targetHeight = this.currentHeight;
    
    if (this.lastProcessedBlock >= targetHeight) {
      // No new blocks to process
      return;
    }

    const fromHeight = this.lastProcessedBlock + 1;
    const toHeight = Math.min(
      targetHeight,
      fromHeight + (this.config.maxBlocksPerBatch || 100) - 1
    );

    this.logger.debug({
      fromHeight,
      toHeight,
      currentHeight: this.currentHeight
    }, 'Processing height range');

    try {
      await this.processHeightRange(fromHeight, toHeight);
      this.lastProcessedBlock = toHeight;
      
      this.logger.debug({
        processedBlocks: toHeight - fromHeight + 1,
        newLastHeight: this.lastProcessedBlock
      }, 'Height range processed successfully');
      
    } catch (error) {
      this.logger.error({
        error,
        fromHeight,
        toHeight
      }, 'Failed to process height range');
      throw error;
    }
  }

  /**
   * Process a range of heights for HTLC events
   */
  private async processHeightRange(fromHeight: number, toHeight: number): Promise<void> {
    const events: CosmosHTLCEvent[] = [];

    // Process each height individually for now
    // In production, this could be optimized with batch queries
    for (let height = fromHeight; height <= toHeight; height++) {
      try {
        const heightEvents = await this.fetchHTLCEventsAtHeight(height);
        events.push(...heightEvents);
      } catch (error) {
        this.logger.warn({
          error,
          height
        }, 'Failed to fetch events at height, continuing...');
        // Continue processing other heights
      }
    }

    this.logger.debug({
      fromHeight,
      toHeight,
      eventCount: events.length
    }, 'Fetched HTLC events for height range');

    // Process events in order
    for (const event of events.sort((a, b) => (a.height || 0) - (b.height || 0))) {
      await this.processEvent(event);
    }
  }

  /**
   * Fetch HTLC events at specific height
   */
  private async fetchHTLCEventsAtHeight(height: number): Promise<CosmosHTLCEvent[]> {
    return await this.executeWithConnection(async (client) => {
      const events: CosmosHTLCEvent[] = [];

      try {
        // Query transactions at this height that interact with our contract
        const searchQuery = `wasm._contract_address='${this.contractAddress}' AND tx.height=${height}`;
        const searchResult = await client.searchTx(searchQuery);

        for (const tx of searchResult) {
          if (tx.code === 0) { // Only successful transactions
            const parsedEvents = this.parseTransactionEvents(tx, height);
            events.push(...parsedEvents);
          }
        }

        return events;

      } catch (error) {
        // If search fails, try getting block and parsing
        try {
          const block = await client.getBlock(height);
          const blockEvents = this.parseBlockEvents(block, height);
          events.push(...blockEvents);
          return events;
        } catch (blockError) {
          throw new MonitorError(
            `Failed to fetch events at height ${height}: ${(error as Error).message}`,
            MonitorErrorCode.BLOCK_FETCH_FAILED,
            this.config.chainId,
            height
          );
        }
      }
    });
  }

  /**
   * Parse transaction events for HTLC operations
   */
  private parseTransactionEvents(tx: any, height: number): CosmosHTLCEvent[] {
    const events: CosmosHTLCEvent[] = [];

    try {
      for (const event of tx.events || []) {
        if (event.type === 'wasm' && this.isHTLCEvent(event)) {
          const parsedEvent = this.parseHTLCEvent(event, tx.hash, height);
          if (parsedEvent) {
            events.push(parsedEvent);
          }
        }
      }
    } catch (error) {
      this.logger.warn({
        error,
        txHash: tx.hash,
        height
      }, 'Failed to parse transaction events');
    }

    return events;
  }

  /**
   * Parse block events for HTLC operations
   */
  private parseBlockEvents(block: Block, height: number): CosmosHTLCEvent[] {
    const events: CosmosHTLCEvent[] = [];

    try {
      // Parse begin_block and end_block events
      const allEvents = [
        ...(block.beginBlockEvents || []),
        ...(block.endBlockEvents || [])
      ];

      for (const event of allEvents) {
        if (event.type === 'wasm' && this.isHTLCEvent(event)) {
          const parsedEvent = this.parseHTLCEvent(event, '', height);
          if (parsedEvent) {
            events.push(parsedEvent);
          }
        }
      }
    } catch (error) {
      this.logger.warn({
        error,
        height
      }, 'Failed to parse block events');
    }

    return events;
  }

  /**
   * Check if event is an HTLC event
   */
  private isHTLCEvent(event: any): boolean {
    const attributes = event.attributes || [];
    return attributes.some((attr: any) => 
      attr.key === '_contract_address' && attr.value === this.contractAddress
    );
  }

  /**
   * Parse HTLC event from Cosmos event
   */
  private parseHTLCEvent(event: any, txHash: string, height: number): CosmosHTLCEvent | null {
    try {
      const attributes = this.parseEventAttributes(event.attributes || []);
      
      const action = attributes.action || attributes.method;
      const htlcId = attributes.htlc_id;

      if (!htlcId) {
        return null;
      }

      const baseEvent = {
        htlcId,
        height,
        txHash
      };

      switch (action) {
        case 'create_htlc':
          return {
            ...baseEvent,
            type: 'created',
            sender: attributes.sender || '',
            receiver: attributes.receiver || '',
            amount: this.parseAmount(attributes.amount),
            hashlock: attributes.hashlock || '',
            timelock: parseInt(attributes.timelock || '0'),
            targetChain: attributes.target_chain || '',
            targetAddress: attributes.target_address || ''
          };

        case 'withdraw_htlc':
          return {
            ...baseEvent,
            type: 'withdrawn',
            secret: attributes.secret || '',
            receiver: attributes.receiver || ''
          };

        case 'refund_htlc':
          return {
            ...baseEvent,
            type: 'refunded',
            sender: attributes.sender || ''
          };

        default:
          return null;
      }
    } catch (error) {
      this.logger.warn({
        error,
        event: event.type
      }, 'Failed to parse HTLC event');
      return null;
    }
  }

  /**
   * Parse event attributes from Cosmos format
   */
  private parseEventAttributes(attributes: any[]): Record<string, string> {
    const parsed: Record<string, string> = {};
    
    for (const attr of attributes) {
      if (attr.key && attr.value) {
        // Handle base64 encoded attributes
        const key = this.decodeAttribute(attr.key);
        const value = this.decodeAttribute(attr.value);
        parsed[key] = value;
      }
    }
    
    return parsed;
  }

  /**
   * Decode attribute (handle base64 encoding)
   */
  private decodeAttribute(value: string): string {
    try {
      // Try base64 decode first
      return Buffer.from(value, 'base64').toString('utf8');
    } catch {
      // If not base64, return as-is
      return value;
    }
  }

  /**
   * Parse amount from string format
   */
  private parseAmount(amountStr: string): Array<{ denom: string; amount: string }> {
    if (!amountStr) {
      return [];
    }

    try {
      // Handle JSON format
      if (amountStr.startsWith('[') || amountStr.startsWith('{')) {
        return JSON.parse(amountStr);
      }

      // Handle simple "amount+denom" format
      const match = amountStr.match(/^(\d+)(.+)$/);
      if (match) {
        return [{ amount: match[1], denom: match[2] }];
      }

      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get enhanced health status
   */
  public getHealth() {
    const baseHealth = super.getHealth();
    return {
      ...baseHealth,
      currentBlock: this.currentHeight,
      blocksBehind: this.calculateBlocksBehind(this.currentHeight, this.lastProcessedBlock),
      contractAddress: this.contractAddress
    };
  }

  /**
   * Query HTLC state from contract
   */
  public async queryHTLC(htlcId: string): Promise<any> {
    return await this.executeWithConnection(async (client) => {
      try {
        const queryMsg = { get_htlc: { htlc_id: htlcId } };
        return await client.queryContractSmart(this.contractAddress, queryMsg);
      } catch (error) {
        throw new MonitorError(
          `Failed to query HTLC: ${(error as Error).message}`,
          MonitorErrorCode.BLOCK_FETCH_FAILED,
          this.config.chainId
        );
      }
    });
  }

  /**
   * Force process specific height (for testing/recovery)
   */
  public async forceProcessHeight(height: number): Promise<void> {
    this.logger.info({ height }, 'Force processing height');
    
    try {
      await this.processHeightRange(height, height);
      this.logger.info({ height }, 'Height processed successfully');
    } catch (error) {
      this.logger.error({ error, height }, 'Failed to force process height');
      throw error;
    }
  }

  /**
   * Reset monitor to specific height
   */
  public resetToHeight(height: number): void {
    this.lastProcessedBlock = height;
    this.logger.info({ height }, 'Monitor reset to height');
  }
}

// Factory functions for backward compatibility
export function createCosmosMonitor(
  config: CosmosMonitorConfig,
  logger: Logger
): CosmosHTLCMonitor {
  const { ConnectionStrategyFactory } = require('../clients/connection-strategies');
  const strategy = ConnectionStrategyFactory.createCosmosQueryStrategy('direct', {
    rpcUrl: config.rpcUrl || 'https://rpc.cosmos.directory/cosmoshub'
  });
  return new CosmosHTLCMonitor(config, strategy, logger);
}

export function createPooledCosmosMonitor(
  config: CosmosMonitorConfig,
  connectionPool: any,
  logger: Logger
): CosmosHTLCMonitor {
  const { ConnectionStrategyFactory } = require('../clients/connection-strategies');
  const strategy = ConnectionStrategyFactory.createCosmosQueryStrategy('pooled', {
    connectionPool
  });
  return new CosmosHTLCMonitor(config, strategy, logger);
}
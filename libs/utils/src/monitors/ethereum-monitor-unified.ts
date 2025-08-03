/**
 * Unified Ethereum HTLC Monitor
 * Replaces both ethereum-monitor.ts and ethereum-monitor-pooled.ts
 * Uses connection strategy pattern to eliminate duplication
 */

import { Logger } from 'pino';
import { BaseMonitor, BaseMonitorConfig, BaseHTLCEvent, MonitorError, MonitorErrorCode } from './base-monitor';
import { ConnectionStrategy } from '../clients/connection-strategies';
import { HTLC_ABI } from '../contracts/abis';
import { getZeroAddress, bigNumberToNumber, createContract } from '../ethers/ethers-utils';

// Import ethers types without instantiation to avoid bundling issues
type JsonRpcProvider = any; // Will be ethers.JsonRpcProvider in consumer
type BigNumberish = any; // Will be ethers.BigNumber (v5) or bigint (v6) in consumer

/**
 * Ethereum HTLC event interfaces
 */
export interface EthereumHTLCCreatedEvent extends BaseHTLCEvent {
  type: 'created';
  sender: string;
  token: string;
  amount: BigNumberish;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

export interface EthereumHTLCWithdrawnEvent extends BaseHTLCEvent {
  type: 'withdrawn';
  secret: string;
}

export interface EthereumHTLCRefundedEvent extends BaseHTLCEvent {
  type: 'refunded';
}

export type EthereumHTLCEvent = 
  | EthereumHTLCCreatedEvent 
  | EthereumHTLCWithdrawnEvent 
  | EthereumHTLCRefundedEvent;

/**
 * Ethereum monitor configuration
 */
export interface EthereumMonitorConfig extends BaseMonitorConfig {
  htlcContract: string;
  startBlock?: number;
}

/**
 * Unified Ethereum HTLC Monitor
 * Works with both direct and pooled connections
 */
export class EthereumHTLCMonitor extends BaseMonitor<JsonRpcProvider, EthereumHTLCEvent> {
  private htlcContract: string;
  private currentBlockNumber: number = 0;

  constructor(
    config: EthereumMonitorConfig,
    connectionStrategy: ConnectionStrategy<JsonRpcProvider>,
    logger: Logger
  ) {
    super(config, connectionStrategy, logger);
    this.htlcContract = config.htlcContract;
    
    if (config.startBlock) {
      this.lastProcessedBlock = config.startBlock;
    }
  }

  /**
   * Initialize starting block
   */
  protected async initializeStartingBlock(): Promise<void> {
    if (this.lastProcessedBlock === 0) {
      this.currentBlockNumber = await this.getCurrentBlock();
      this.lastProcessedBlock = Math.max(0, this.currentBlockNumber - 100); // Start 100 blocks back
      this.logger.info({ 
        currentBlock: this.currentBlockNumber,
        startingBlock: this.lastProcessedBlock 
      }, 'Initialized starting block');
    }
  }

  /**
   * Get current block number
   */
  protected async getCurrentBlock(): Promise<number> {
    return await this.executeWithConnection(async (provider) => {
      return await provider.getBlockNumber();
    });
  }

  /**
   * Process new blocks for HTLC events
   */
  protected async processNewBlocks(): Promise<void> {
    this.currentBlockNumber = await this.retryOperation(
      () => this.getCurrentBlock(),
      'getCurrentBlock'
    );

    const safeBlock = this.currentBlockNumber - (this.config.reorgBuffer || 12);
    
    if (this.lastProcessedBlock >= safeBlock) {
      // No new safe blocks to process
      return;
    }

    const fromBlock = this.lastProcessedBlock + 1;
    const toBlock = Math.min(
      safeBlock,
      fromBlock + (this.config.maxBlocksPerBatch || 1000) - 1
    );

    this.logger.debug({
      fromBlock,
      toBlock,
      currentBlock: this.currentBlockNumber,
      safeBlock
    }, 'Processing block range');

    try {
      await this.processBlockRange(fromBlock, toBlock);
      this.lastProcessedBlock = toBlock;
      
      this.logger.debug({
        processedBlocks: toBlock - fromBlock + 1,
        newLastBlock: this.lastProcessedBlock
      }, 'Block range processed successfully');
      
    } catch (error) {
      this.logger.error({
        error,
        fromBlock,
        toBlock
      }, 'Failed to process block range');
      throw error;
    }
  }

  /**
   * Process a range of blocks for HTLC events
   */
  private async processBlockRange(fromBlock: number, toBlock: number): Promise<void> {
    const events = await this.retryOperation(
      () => this.fetchHTLCEvents(fromBlock, toBlock),
      `fetchHTLCEvents(${fromBlock}-${toBlock})`
    );

    this.logger.debug({
      fromBlock,
      toBlock,
      eventCount: events.length
    }, 'Fetched HTLC events');

    // Process events in order
    for (const event of events.sort((a, b) => a.blockNumber! - b.blockNumber!)) {
      await this.processEvent(event);
    }
  }

  /**
   * Fetch HTLC events from blockchain
   */
  private async fetchHTLCEvents(fromBlock: number, toBlock: number): Promise<EthereumHTLCEvent[]> {
    return await this.executeWithConnection(async (provider) => {
      const contract = await createContract(this.htlcContract, HTLC_ABI, provider);

      const events: EthereumHTLCEvent[] = [];

      try {
        // Fetch HTLCCreated events
        const createdFilter = contract.filters.HTLCCreated();
        const createdEvents = await contract.queryFilter(createdFilter, fromBlock, toBlock);
        
        for (const event of createdEvents) {
          if ('args' in event) {
            events.push({
              type: 'created',
              htlcId: event.args.htlcId,
              sender: event.args.sender,
              token: event.args.token,
              amount: event.args.amount,
              hashlock: event.args.hashlock,
              timelock: bigNumberToNumber(event.args.timelock),
              targetChain: event.args.targetChain,
              targetAddress: event.args.targetAddress,
              blockNumber: event.blockNumber,
              transactionHash: event.transactionHash
            });
          }
        }

        // Fetch HTLCWithdrawn events
        const withdrawnFilter = contract.filters.HTLCWithdrawn();
        const withdrawnEvents = await contract.queryFilter(withdrawnFilter, fromBlock, toBlock);
        
        for (const event of withdrawnEvents) {
          if ('args' in event) {
            events.push({
              type: 'withdrawn',
              htlcId: event.args.htlcId,
              secret: event.args.secret,
              blockNumber: event.blockNumber,
              transactionHash: event.transactionHash
            });
          }
        }

        // Fetch HTLCRefunded events
        const refundedFilter = contract.filters.HTLCRefunded();
        const refundedEvents = await contract.queryFilter(refundedFilter, fromBlock, toBlock);
        
        for (const event of refundedEvents) {
          if ('args' in event) {
            events.push({
              type: 'refunded',
              htlcId: event.args.htlcId,
              blockNumber: event.blockNumber,
              transactionHash: event.transactionHash
            });
          }
        }

        return events;

      } catch (error) {
        throw new MonitorError(
          `Failed to fetch HTLC events: ${(error as Error).message}`,
          MonitorErrorCode.EVENT_PARSING_FAILED,
          this.config.chainId,
          fromBlock
        );
      }
    });
  }

  /**
   * Get enhanced health status
   */
  public getHealth() {
    const baseHealth = super.getHealth();
    return {
      ...baseHealth,
      currentBlock: this.currentBlockNumber,
      blocksBehind: this.calculateBlocksBehind(this.currentBlockNumber, this.lastProcessedBlock),
      contractAddress: this.htlcContract
    };
  }

  /**
   * Get connection statistics if available
   */
  protected getConnectionStats(): any {
    // This would be implemented by connection strategies that support stats
    return undefined;
  }

  /**
   * Check if HTLC exists
   */
  public async htlcExists(htlcId: string): Promise<boolean> {
    return await this.executeWithConnection(async (provider) => {
      const contract = await createContract(this.htlcContract, HTLC_ABI, provider);
      
      try {
        const htlc = await contract.getHTLC(htlcId);
        const zeroAddress = await getZeroAddress();
        return htlc.sender !== zeroAddress;
      } catch {
        return false;
      }
    });
  }

  /**
   * Get HTLC details
   */
  public async getHTLC(htlcId: string): Promise<any> {
    return await this.executeWithConnection(async (provider) => {
      const contract = await createContract(this.htlcContract, HTLC_ABI, provider);
      
      try {
        return await contract.getHTLC(htlcId);
      } catch (error) {
        throw new MonitorError(
          `Failed to get HTLC details: ${(error as Error).message}`,
          MonitorErrorCode.BLOCK_FETCH_FAILED,
          this.config.chainId
        );
      }
    });
  }

  /**
   * Force process specific block (for testing/recovery)
   */
  public async forceProcessBlock(blockNumber: number): Promise<void> {
    this.logger.info({ blockNumber }, 'Force processing block');
    
    try {
      await this.processBlockRange(blockNumber, blockNumber);
      this.logger.info({ blockNumber }, 'Block processed successfully');
    } catch (error) {
      this.logger.error({ error, blockNumber }, 'Failed to force process block');
      throw error;
    }
  }

  /**
   * Reset monitor to specific block
   */
  public resetToBlock(blockNumber: number): void {
    this.lastProcessedBlock = blockNumber;
    this.logger.info({ blockNumber }, 'Monitor reset to block');
  }
}

// Factory functions for backward compatibility
export function createEthereumMonitor(
  config: EthereumMonitorConfig,
  logger: Logger
): EthereumHTLCMonitor {
  const { ConnectionStrategyFactory } = require('../clients/connection-strategies');
  const strategy = ConnectionStrategyFactory.createEthereumStrategy('direct', {
    rpcUrl: config.rpcUrl || `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`
  });
  return new EthereumHTLCMonitor(config, strategy, logger);
}

export function createPooledEthereumMonitor(
  config: EthereumMonitorConfig,
  connectionPool: any,
  logger: Logger
): EthereumHTLCMonitor {
  const { ConnectionStrategyFactory } = require('../clients/connection-strategies');
  const strategy = ConnectionStrategyFactory.createEthereumStrategy('pooled', {
    connectionPool
  });
  return new EthereumHTLCMonitor(config, strategy, logger);
}
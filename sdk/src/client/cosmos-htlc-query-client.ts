/**
 * Cosmos HTLC Query Client
 * 
 * This client handles only query operations for Cosmos HTLCs.
 * It is focused on reading HTLC state and does not handle transactions.
 */

import { StargateClient } from '@cosmjs/stargate';
import { CosmWasmQueryClient } from '../types/cosmwasm-client';
import {
  CosmosConfig,
  HTLCDetails,
  WasmHTLC,
  WasmHTLCGetResult,
  ListHTLCsQuery,
  GetHTLCQuery,
  CosmosHTLCError,
  hasLogs
} from '../types/cosmos-htlc';

export class CosmosHTLCQueryClient {
  private queryClient?: StargateClient;
  private config: CosmosConfig;

  constructor(config: CosmosConfig) {
    this.config = config;
  }

  /**
   * Initialize the query client
   */
  async init(): Promise<void> {
    if (!this.queryClient) {
      this.queryClient = await StargateClient.connect(this.config.rpcUrl);
    }
  }

  /**
   * Get a specific HTLC by ID
   * @param htlcId - The HTLC ID to query
   * @returns Promise resolving to HTLC details or null if not found
   */
  async getHTLC(htlcId: string): Promise<HTLCDetails | null> {
    await this.init();

    const queryMsg: GetHTLCQuery = {
      get_htlc: {
        id: htlcId,
      },
    };

    try {
      const client = this.queryClient as unknown;
      if (!client || typeof (client as CosmWasmQueryClient).queryContractSmart !== 'function') {
        throw new CosmosHTLCError('queryClient does not support CosmWasm queries');
      }

      const result = await (client as CosmWasmQueryClient).queryContractSmart(
        this.config.htlcContract,
        queryMsg
      ) as WasmHTLCGetResult;

      if (!result || !result.htlc) {
        return null;
      }

      return this.mapWasmHTLCToDetails(result.htlc);
    } catch (error) {
      if (error instanceof CosmosHTLCError) {
        throw error;
      }
      // Return null on error to indicate HTLC not found
      return null;
    }
  }

  /**
   * List HTLCs with optional pagination
   * @param startAfter - Optional HTLC ID to start after
   * @param limit - Maximum number of HTLCs to return
   * @returns Promise resolving to array of HTLC details
   */
  async listHTLCs(startAfter?: string, limit: number = 10): Promise<HTLCDetails[]> {
    await this.init();

    const queryMsg: ListHTLCsQuery = {
      list_htlcs: {
        start_after: startAfter,
        limit,
      },
    };

    try {
      const client = this.queryClient as unknown;
      if (!client || typeof (client as CosmWasmQueryClient).queryContractSmart !== 'function') {
        throw new CosmosHTLCError('queryClient does not support CosmWasm queries');
      }

      const rawResult = await (client as CosmWasmQueryClient).queryContractSmart(
        this.config.htlcContract,
        queryMsg
      );

      if (!rawResult || !Array.isArray(rawResult.htlcs)) {
        return [];
      }

      return (rawResult.htlcs as WasmHTLC[]).map(htlc => this.mapWasmHTLCToDetails(htlc));
    } catch (error) {
      if (error instanceof CosmosHTLCError) {
        throw error;
      }
      // Return empty array on error
      return [];
    }
  }

  /**
   * Get account balance
   * @param address - Address to check balance for
   * @param denom - Denomination to check
   * @returns Promise resolving to balance string
   */
  async getBalance(address: string, denom?: string): Promise<string> {
    await this.init();

    if (!this.queryClient) {
      throw new Error('Query client not initialized');
    }
    const balance = await this.queryClient.getBalance(
      address,
      denom || this.config.denom
    );

    return balance.amount;
  }

  /**
   * Get current block height
   * @returns Promise resolving to block height
   */
  async getHeight(): Promise<number> {
    await this.init();
    if (!this.queryClient) {
      throw new Error('Query client not initialized');
    }
    return this.queryClient.getHeight();
  }

  /**
   * Get transaction by hash
   * @param txHash - Transaction hash
   * @returns Promise resolving to transaction or null
   */
  async getTransaction(txHash: string): Promise<import('../types/cosmos-htlc').CosmosTransactionResult | null> {
    await this.init();

    if (!this.queryClient) {
      throw new Error('Query client not initialized');
    }
    try {
      return await this.queryClient.getTx(txHash);
    } catch (error) {
      // Return null on error to indicate transaction not found
      return null;
    }
  }

  /**
   * Extract HTLC ID from transaction result
   * @param result - Transaction result
   * @returns HTLC ID if found, null otherwise
   */
  extractHTLCIdFromResult(result: import('../types/cosmos-htlc').CosmosTransactionResult): string | null {
    if (!hasLogs(result)) {
      return null;
    }

    // Safe access to logs with proper type checking
    const logs = (result as any).logs;
    if (!Array.isArray(logs)) {
      return null;
    }
    
    for (const log of logs) {
      if (!log.events || !Array.isArray(log.events)) {
        continue;
      }
      
      for (const event of log.events) {
        if (event.type === 'wasm' && event.attributes && Array.isArray(event.attributes)) {
          for (const attr of event.attributes) {
            if (attr.key === 'htlc_id' && attr.value) {
              return attr.value as string;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Disconnect the query client
   */
  async disconnect(): Promise<void> {
    if (this.queryClient) {
      this.queryClient.disconnect();
      this.queryClient = undefined;
    }
    return Promise.resolve();
  }

  /**
   * Map WasmHTLC to HTLCDetails
   * @param htlc - Raw HTLC data from contract
   * @returns Formatted HTLC details
   */
  private mapWasmHTLCToDetails(htlc: WasmHTLC): HTLCDetails {
    return {
      htlcId: htlc.id,
      sender: htlc.sender,
      receiver: htlc.receiver,
      token: this.config.denom,
      amount: htlc.amount[0]?.amount || '0',
      hashlock: htlc.hashlock,
      timelock: htlc.timelock,
      withdrawn: htlc.withdrawn,
      refunded: htlc.refunded,
      targetChain: htlc.target_chain,
      targetAddress: htlc.target_address,
    };
  }
} 
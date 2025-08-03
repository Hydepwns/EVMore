/**
 * Cosmos HTLC Manager
 * 
 * This is a high-level client that coordinates between query and signing clients.
 * It provides a simplified interface for HTLC lifecycle management.
 */

import { CosmosHTLCQueryClient } from './cosmos-htlc-query-client';
import { CosmosHTLCSigningClient } from './cosmos-htlc-signing-client';
import {
  CosmosConfig,
  CreateCosmosHTLCParams,
  WithdrawHTLCParams,
  RefundHTLCParams,
  HTLCDetails,
  CosmosHTLCError
} from '../types/cosmos-htlc';

export class CosmosHTLCManager {
  private queryClient: CosmosHTLCQueryClient;
  private signingClient: CosmosHTLCSigningClient;
  private config: CosmosConfig;

  constructor(config: CosmosConfig) {
    this.config = config;
    this.queryClient = new CosmosHTLCQueryClient(config);
    this.signingClient = new CosmosHTLCSigningClient(config);
  }

  /**
   * Initialize the manager and underlying clients
   */
  async init(mnemonic?: string): Promise<void> {
    await this.queryClient.init();
    await this.signingClient.init(mnemonic);
  }

  /**
   * Create a new HTLC with validation
   * @param params - HTLC creation parameters
   * @returns Promise resolving to transaction hash and HTLC ID
   */
  async createHTLC(params: CreateCosmosHTLCParams): Promise<{ txHash: string; htlcId?: string }> {
    try {
      // Validate parameters
      this.validateCreateParams(params);

      // Create HTLC
      const txHash = await this.signingClient.createHTLC(params);

      // Try to extract HTLC ID from transaction
      const htlcId = await this.extractHTLCIdFromTransaction(txHash);

      return { txHash, htlcId };
    } catch (error) {
      if (error instanceof CosmosHTLCError) {
        throw error;
      }
      throw new CosmosHTLCError(`Failed to create HTLC: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Withdraw an HTLC with validation
   * @param params - Withdrawal parameters
   * @returns Promise resolving to transaction hash
   */
  async withdrawHTLC(params: WithdrawHTLCParams): Promise<string> {
    try {
      // Validate parameters
      this.validateWithdrawParams(params);

      // Check HTLC status before withdrawal
      const htlc = await this.queryClient.getHTLC(params.htlcId);
      if (!htlc) {
        throw new CosmosHTLCError(`HTLC ${params.htlcId} not found`);
      }

      // Withdraw HTLC
      return await this.signingClient.withdrawHTLC(params);
    } catch (error) {
      if (error instanceof CosmosHTLCError) {
        throw error;
      }
      throw new CosmosHTLCError(`Failed to withdraw HTLC: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Refund an expired HTLC with validation
   * @param params - Refund parameters
   * @returns Promise resolving to transaction hash
   */
  async refundHTLC(params: RefundHTLCParams): Promise<string> {
    try {
      // Validate parameters
      this.validateRefundParams(params);

      // Check HTLC status before refund
      const htlc = await this.queryClient.getHTLC(params.htlcId);
      if (!htlc) {
        throw new CosmosHTLCError(`HTLC ${params.htlcId} not found`);
      }

      // Refund HTLC
      return await this.signingClient.refundHTLC(params);
    } catch (error) {
      if (error instanceof CosmosHTLCError) {
        throw error;
      }
      throw new CosmosHTLCError(`Failed to refund HTLC: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get HTLC details
   * @param htlcId - HTLC ID to query
   * @returns Promise resolving to HTLC details or null
   */
  async getHTLC(htlcId: string): Promise<HTLCDetails | null> {
    return this.queryClient.getHTLC(htlcId);
  }

  /**
   * List HTLCs with pagination
   * @param startAfter - Optional HTLC ID to start after
   * @param limit - Maximum number of HTLCs to return
   * @returns Promise resolving to array of HTLC details
   */
  async listHTLCs(startAfter?: string, limit: number = 10): Promise<HTLCDetails[]> {
    return this.queryClient.listHTLCs(startAfter, limit);
  }

  /**
   * Get account balance
   * @param address - Address to check balance for
   * @param denom - Denomination to check
   * @returns Promise resolving to balance string
   */
  async getBalance(address: string, denom?: string): Promise<string> {
    return this.queryClient.getBalance(address, denom);
  }

  /**
   * Get current address from wallet
   * @returns Promise resolving to address
   */
  async getAddress(): Promise<string> {
    return this.signingClient.getAddress();
  }

  /**
   * Get current block height
   * @returns Promise resolving to block height
   */
  async getHeight(): Promise<number> {
    return this.queryClient.getHeight();
  }

  /**
   * Get transaction by hash
   * @param txHash - Transaction hash
   * @returns Promise resolving to transaction or null
   */
  async getTransaction(txHash: string): Promise<import('../types/cosmos-htlc').CosmosTransactionResult | null> {
    return this.queryClient.getTransaction(txHash);
  }

  /**
   * Check if HTLC is ready for withdrawal
   * @param htlcId - HTLC ID to check
   * @returns Promise resolving to boolean
   */
  async isReadyForWithdrawal(htlcId: string): Promise<boolean> {
    const htlc = await this.queryClient.getHTLC(htlcId);
    if (!htlc) {
      return false;
    }

    return !htlc.withdrawn && !htlc.refunded;
  }

  /**
   * Check if HTLC is ready for refund
   * @param htlcId - HTLC ID to check
   * @returns Promise resolving to boolean
   */
  async isReadyForRefund(htlcId: string): Promise<boolean> {
    const htlc = await this.queryClient.getHTLC(htlcId);
    if (!htlc) {
      return false;
    }

    const currentHeight = await this.queryClient.getHeight();
    return !htlc.withdrawn && !htlc.refunded && currentHeight > htlc.timelock;
  }

  /**
   * Disconnect all clients
   */
  async disconnect(): Promise<void> {
    await Promise.all([
      this.queryClient.disconnect(),
      this.signingClient.disconnect()
    ]);
  }

  /**
   * Validate HTLC creation parameters
   */
  private validateCreateParams(params: CreateCosmosHTLCParams): void {
    if (!params.receiver || !params.amount || !params.hashlock) {
      throw new CosmosHTLCError('Missing required parameters: receiver, amount, hashlock');
    }

    if (parseFloat(params.amount) <= 0) {
      throw new CosmosHTLCError('Amount must be greater than 0');
    }

    if (params.timelock <= 0) {
      throw new CosmosHTLCError('Timelock must be greater than 0');
    }

    if (!params.targetChain || !params.targetAddress) {
      throw new CosmosHTLCError('Missing target chain or address');
    }
  }

  /**
   * Validate HTLC withdrawal parameters
   */
  private validateWithdrawParams(params: WithdrawHTLCParams): void {
    if (!params.htlcId || !params.secret) {
      throw new CosmosHTLCError('Missing required parameters: htlcId, secret');
    }
  }

  /**
   * Validate HTLC refund parameters
   */
  private validateRefundParams(params: RefundHTLCParams): void {
    if (!params.htlcId) {
      throw new CosmosHTLCError('Missing required parameter: htlcId');
    }
  }

  /**
   * Extract HTLC ID from transaction
   */
  private async extractHTLCIdFromTransaction(txHash: string): Promise<string | undefined> {
    try {
      const tx = await this.queryClient.getTransaction(txHash);
      if (tx) {
        const htlcId = this.queryClient.extractHTLCIdFromResult(tx);
        return htlcId || undefined;
      }
    } catch (error) {
      // Ignore errors when extracting HTLC ID
    }
    return undefined;
  }
} 
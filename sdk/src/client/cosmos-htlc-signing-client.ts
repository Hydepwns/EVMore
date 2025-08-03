/**
 * Cosmos HTLC Signing Client
 * 
 * This client handles only transaction signing operations for Cosmos HTLCs.
 * It is focused on creating, withdrawing, and refunding HTLCs.
 */

import { SigningStargateClient, StargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { EncodeObject } from '@cosmjs/proto-signing';
import { CosmWasmSigningClient } from '../types/cosmwasm-client';
import {
  CosmosConfig,
  CreateCosmosHTLCParams,
  WithdrawHTLCParams,
  RefundHTLCParams,
  CreateHTLCMessage,
  WithdrawHTLCMessage,
  RefundHTLCMessage,
  CosmosHTLCError,
  CosmosHTLCNotFoundError,
  CosmosHTLCAlreadyWithdrawnError,
  CosmosHTLCAlreadyRefundedError,
  CosmosHTLCExpiredError
} from '../types/cosmos-htlc';

export class CosmosHTLCSigningClient {
  private client?: SigningStargateClient;
  private queryClient?: StargateClient;
  private wallet?: DirectSecp256k1HdWallet;
  private config: CosmosConfig;

  constructor(config: CosmosConfig) {
    this.config = config;
  }

  /**
   * Initialize the signing client with wallet
   */
  async init(mnemonic?: string): Promise<void> {
    if (!this.wallet) {
      const walletMnemonic = mnemonic || this.config.mnemonic;
      if (!walletMnemonic) {
        throw new CosmosHTLCError('Mnemonic is required for signing operations');
      }

      this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(
        walletMnemonic,
        { prefix: this.config.addressPrefix }
      );
    }

    if (!this.client) {
      this.client = await SigningStargateClient.connectWithSigner(
        this.config.rpcUrl,
        this.wallet
      );
    }

    if (!this.queryClient) {
      this.queryClient = await StargateClient.connect(this.config.rpcUrl);
    }
  }

  /**
   * Connect with an existing wallet
   */
  async connect(wallet: DirectSecp256k1HdWallet): Promise<void> {
    this.wallet = wallet;
    this.client = await SigningStargateClient.connectWithSigner(
      this.config.rpcUrl,
      wallet
    );
  }

  /**
   * Create a new HTLC
   * @param params - HTLC creation parameters
   * @returns Promise resolving to transaction hash
   */
  async createHTLC(params: CreateCosmosHTLCParams): Promise<string> {
    if (!this.client || !this.wallet) {
      throw new CosmosHTLCError('Client not initialized');
    }

    const [account] = await this.wallet.getAccounts();
    const sender = account.address;

    // Validate parameters
    if (!params.receiver || !params.amount || !params.hashlock) {
      throw new CosmosHTLCError('Missing required parameters for HTLC creation');
    }

    // Check balance
    if (!this.queryClient) {
      throw new CosmosHTLCError('Query client not initialized');
    }
    const balance = await this.queryClient.getBalance(sender, params.denom);
    const requiredAmount = parseFloat(params.amount);
    const availableAmount = parseFloat(balance.amount);

    if (availableAmount < requiredAmount) {
      throw new CosmosHTLCError(
        `Insufficient balance. Required: ${params.amount} ${params.denom}, Available: ${balance.amount} ${params.denom}`
      );
    }

    // Prepare message
    const msg: CreateHTLCMessage = {
      create_htlc: {
        receiver: params.receiver,
        amount: params.amount,
        denom: params.denom,
        hashlock: params.hashlock,
        timelock: params.timelock,
        target_chain: params.targetChain,
        target_address: params.targetAddress,
      },
    };

    // Estimate gas
    const gasEstimate = await this.estimateGas(msg);
    const fee = {
      amount: [{ denom: this.config.denom, amount: '1000' }],
      gas: gasEstimate.toString(),
    };

    // Execute transaction
    const client = this.client as unknown;
    if (!client || typeof (client as CosmWasmSigningClient).execute !== 'function') {
      throw new CosmosHTLCError('Client does not support CosmWasm execution');
    }

    const result = await (client as CosmWasmSigningClient).execute(
      sender,
      this.config.htlcContract,
      msg,
      fee.gas,
      `Create HTLC: ${params.receiver}`
    );

    if (result.code !== 0) {
      throw new CosmosHTLCError(
        `Transaction failed: ${result.rawLog}`,
        String(result.code),
        result.rawLog
      );
    }

    return result.transactionHash;
  }

  /**
   * Withdraw an HTLC using a secret
   * @param params - Withdrawal parameters
   * @returns Promise resolving to transaction hash
   */
  async withdrawHTLC(params: WithdrawHTLCParams): Promise<string> {
    if (!this.client || !this.wallet) {
      throw new CosmosHTLCError('Client not initialized');
    }

    const [account] = await this.wallet.getAccounts();
    const sender = account.address;

    // Validate parameters
    if (!params.htlcId || !params.secret) {
      throw new CosmosHTLCError('Missing required parameters for HTLC withdrawal');
    }

    // Check HTLC status
    const htlc = await this.getHTLC(params.htlcId);
    if (!htlc) {
      throw new CosmosHTLCNotFoundError(params.htlcId);
    }

    if (htlc.withdrawn) {
      throw new CosmosHTLCAlreadyWithdrawnError(params.htlcId);
    }

    if (htlc.refunded) {
      throw new CosmosHTLCAlreadyRefundedError(params.htlcId);
    }

    // Check if expired
    if (!this.queryClient) {
      throw new CosmosHTLCError('Query client not initialized');
    }
    const currentHeight = await this.queryClient.getHeight();
    if (currentHeight > htlc.timelock) {
      throw new CosmosHTLCExpiredError(params.htlcId);
    }

    // Prepare message
    const msg: WithdrawHTLCMessage = {
      withdraw: {
        id: params.htlcId,
        secret: params.secret,
      },
    };

    // Estimate gas
    const gasEstimate = await this.estimateGas(msg);
    const fee = {
      amount: [{ denom: this.config.denom, amount: '1000' }],
      gas: gasEstimate.toString(),
    };

    // Execute transaction
    const client = this.client as unknown;
    if (!client || typeof (client as CosmWasmSigningClient).execute !== 'function') {
      throw new CosmosHTLCError('Client does not support CosmWasm execution');
    }

    const result = await (client as CosmWasmSigningClient).execute(
      sender,
      this.config.htlcContract,
      msg,
      fee.gas,
      `Withdraw HTLC: ${params.htlcId}`
    );

    if (result.code !== 0) {
      throw new CosmosHTLCError(
        `Transaction failed: ${result.rawLog}`,
        String(result.code),
        result.rawLog
      );
    }

    return result.transactionHash;
  }

  /**
   * Refund an expired HTLC
   * @param params - Refund parameters
   * @returns Promise resolving to transaction hash
   */
  async refundHTLC(params: RefundHTLCParams): Promise<string> {
    if (!this.client || !this.wallet) {
      throw new CosmosHTLCError('Client not initialized');
    }

    const [account] = await this.wallet.getAccounts();
    const sender = account.address;

    // Validate parameters
    if (!params.htlcId) {
      throw new CosmosHTLCError('Missing HTLC ID for refund');
    }

    // Check HTLC status
    const htlc = await this.getHTLC(params.htlcId);
    if (!htlc) {
      throw new CosmosHTLCNotFoundError(params.htlcId);
    }

    if (htlc.withdrawn) {
      throw new CosmosHTLCAlreadyWithdrawnError(params.htlcId);
    }

    if (htlc.refunded) {
      throw new CosmosHTLCAlreadyRefundedError(params.htlcId);
    }

    // Check if expired
    if (!this.queryClient) {
      throw new CosmosHTLCError('Query client not initialized');
    }
    const currentHeight = await this.queryClient.getHeight();
    if (currentHeight <= htlc.timelock) {
      throw new CosmosHTLCError(`HTLC ${params.htlcId} has not expired yet`);
    }

    // Prepare message
    const msg: RefundHTLCMessage = {
      refund: {
        id: params.htlcId,
      },
    };

    // Estimate gas
    const gasEstimate = await this.estimateGas(msg);
    const fee = {
      amount: [{ denom: this.config.denom, amount: '1000' }],
      gas: gasEstimate.toString(),
    };

    // Execute transaction
    const client = this.client as unknown;
    if (!client || typeof (client as CosmWasmSigningClient).execute !== 'function') {
      throw new CosmosHTLCError('Client does not support CosmWasm execution');
    }

    const result = await (client as CosmWasmSigningClient).execute(
      sender,
      this.config.htlcContract,
      msg,
      fee.gas,
      `Refund HTLC: ${params.htlcId}`
    );

    if (result.code !== 0) {
      throw new CosmosHTLCError(
        `Transaction failed: ${result.rawLog}`,
        String(result.code),
        result.rawLog
      );
    }

    return result.transactionHash;
  }

  /**
   * Simulate transaction to estimate gas
   * @param msg - Message to simulate
   * @returns Promise resolving to gas estimate
   */
  async simulate(msg: EncodeObject): Promise<number> {
    if (!this.client || !this.wallet) {
      throw new CosmosHTLCError('Client not initialized');
    }

    const [account] = await this.wallet.getAccounts();
    const sender = account.address;

    const result = await this.client.simulate(
      sender,
      [msg],
      `Simulate HTLC operation`
    );

    return Math.ceil(result.gasUsed * 1.2); // Add 20% buffer
  }

  /**
   * Estimate gas for contract execution
   * @param msg - Contract message
   * @returns Promise resolving to gas estimate
   */
  private async estimateGas(msg: Record<string, unknown>): Promise<number> {
    if (!this.client || !this.wallet) {
      throw new CosmosHTLCError('Client not initialized');
    }

    const [account] = await this.wallet.getAccounts();
    const sender = account.address;

    // Type assertion for CosmWasm client
    const client = this.client as unknown;
    if (!client || typeof (client as CosmWasmSigningClient).simulate !== 'function') {
      throw new CosmosHTLCError('Client does not support CosmWasm simulation');
    }

    const result = await (client as CosmWasmSigningClient).simulate(
      sender,
      [msg],
      `Estimate gas for HTLC operation`
    );

    return Math.ceil(result.gasUsed * 1.2); // Add 20% buffer
  }

  /**
   * Get HTLC details (delegates to query client)
   * @param _htlcId - HTLC ID to query
   * @returns Promise resolving to HTLC details or null
   */
  private getHTLC(_htlcId: string): Promise<import('../types/cosmos-htlc').HTLCDetails | null> {
    // This would typically delegate to the query client
    // For now, we'll implement a basic version
    if (!this.queryClient) {
      return Promise.resolve(null);
    }

    // Basic implementation - in practice this would use the query client
    return Promise.resolve(null);
  }

  /**
   * Get current address from wallet
   * @returns Promise resolving to address
   */
  async getAddress(): Promise<string> {
    if (!this.wallet) {
      throw new CosmosHTLCError('Wallet not available');
    }

    const [account] = await this.wallet.getAccounts();
    return account.address;
  }

  /**
   * Disconnect the signing client
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = undefined;
    }
    if (this.queryClient) {
      this.queryClient.disconnect();
      this.queryClient = undefined;
    }
    return Promise.resolve();
  }
} 
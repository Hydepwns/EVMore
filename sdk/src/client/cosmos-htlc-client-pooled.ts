/**
 * Enhanced Cosmos HTLC Client with Connection Pooling
 * Production-grade client for cross-chain HTLC operations on Cosmos
 */

import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { Coin } from '@cosmjs/amino';
import { EncodeObject } from '@cosmjs/proto-signing';
import { CosmosQueryConnectionPool, CosmosSigningConnectionPool } from '@evmore/connection-pool';
import { HTLCDetails, PooledTransactionResult, CosmWasmSigningClient } from '../types';
import { validateAmount, isValidHash, isValidCosmosAddress } from '../utils';

// Define proper types for transaction results
interface CosmosTransactionResult {
  events?: Array<{
    type: string;
    attributes?: Array<{
      key: string;
      value: string;
    }>;
  }>;
}

export interface CosmosConfig {
  chainId: string;
  htlcContract: string;
  addressPrefix: string;
  denom: string;
  gasPrice?: string;
  gasLimit?: number;
}

export interface CreateCosmosHTLCParams {
  receiver: string;
  amount: string;
  denom: string;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

export interface PooledCosmosHTLCClientOptions {
  retries?: number;
  retryDelay?: number;
  gasMultiplier?: number;
  confirmations?: number;
}

export class PooledCosmosHTLCClient {
  private queryPool: CosmosQueryConnectionPool;
  private signingPool: CosmosSigningConnectionPool;
  private wallet?: DirectSecp256k1HdWallet;
  private config: CosmosConfig;
  private options: PooledCosmosHTLCClientOptions;
  private senderAddress?: string;

  constructor(
    queryPool: CosmosQueryConnectionPool,
    signingPool: CosmosSigningConnectionPool,
    config: CosmosConfig,
    options: PooledCosmosHTLCClientOptions = {}
  ) {
    this.queryPool = queryPool;
    this.signingPool = signingPool;
    this.config = config;
    this.options = {
      retries: 3,
      retryDelay: 1000,
      gasMultiplier: 1.3,
      confirmations: 1,
      ...options
    };
  }

  /**
   * Initialize the client with mnemonic
   */
  async init(mnemonic: string): Promise<void> {
    // Create wallet from mnemonic
    this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(
      mnemonic,
      { prefix: this.config.addressPrefix }
    );

    const [account] = await this.wallet.getAccounts();
    this.senderAddress = account.address;
  }

  /**
   * Connect with an external wallet
   */
  async connect(wallet: DirectSecp256k1HdWallet): Promise<void> {
    this.wallet = wallet;
    const [account] = await wallet.getAccounts();
    this.senderAddress = account.address;
  }

  /**
   * Get the sender address
   */
  getSenderAddress(): string {
    if (!this.senderAddress) {
      throw new Error('Client not initialized. Call init() or connect() first.');
    }
    return this.senderAddress;
  }

  /**
   * Create a new HTLC on Cosmos
   */
  async createHTLC(params: CreateCosmosHTLCParams): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not available. Call init() or connect() first.');
    }

    // Validate parameters
    if (!validateAmount(params.amount)) {
      throw new Error('Invalid amount');
    }
    if (!isValidCosmosAddress(params.receiver, this.config.addressPrefix)) {
      throw new Error('Invalid receiver address');
    }
    if (!isValidHash(params.hashlock)) {
      throw new Error('Invalid hashlock format');
    }
    if (params.timelock <= Math.floor(Date.now() / 1000)) {
      throw new Error('Timelock must be in the future');
    }

    return this.signingPool.withSigningClient(this.wallet, async (client) => {
      const senderAddress = this.getSenderAddress();

      // Check balance
      const balance = await client.getBalance(senderAddress, params.denom);
      const requiredAmount = BigInt(params.amount);
      const availableAmount = BigInt(balance?.amount || '0');

      if (availableAmount < requiredAmount) {
        throw new Error(
          `Insufficient balance. Required: ${params.amount}, Available: ${availableAmount.toString()}`
        );
      }

      // Prepare the message
      const msg = {
        create_htlc: {
          receiver: params.receiver,
          amount: [{
            denom: params.denom,
            amount: params.amount
          }],
          hashlock: params.hashlock,
          timelock: params.timelock,
          target_chain: params.targetChain,
          target_address: params.targetAddress
        }
      };

      // Calculate gas
      const gasEstimate = await this.estimateGas(client, senderAddress, msg);
      const gas = Math.floor(gasEstimate * this.options.gasMultiplier!);

      // Execute the transaction
      const cosmwasmClient = client as CosmWasmSigningClient;
      const result = await cosmwasmClient.execute(
        senderAddress,
        this.config.htlcContract,
        msg,
        'auto', // fee
        '', // memo
        []  // funds
      );

      // ExecuteResult doesn't have code/rawLog, it throws on failure
      // Success is implied if we reach this point

      // Extract HTLC ID from events
      const htlcId = this.extractHTLCIdFromResult(result);
      if (!htlcId) {
        throw new Error('Failed to extract HTLC ID from transaction result');
      }

      return htlcId;
    });
  }

  /**
   * Withdraw from an HTLC using the secret
   */
  async withdraw(htlcId: string, secret: string): Promise<PooledTransactionResult> {
    if (!this.wallet) {
      throw new Error('Wallet not available');
    }

    if (!isValidHash(htlcId) || !isValidHash(secret)) {
      throw new Error('Invalid HTLC ID or secret format');
    }

    return this.signingPool.withSigningClient(this.wallet, async (client) => {
      const senderAddress = this.getSenderAddress();

      // Check HTLC status first
      const htlcDetails = await this.getHTLCDetails(htlcId);
      if (htlcDetails.withdrawn) {
        throw new Error('HTLC already withdrawn');
      }
      if (htlcDetails.refunded) {
        throw new Error('HTLC already refunded');
      }
      if (htlcDetails.timelock <= Math.floor(Date.now() / 1000)) {
        throw new Error('HTLC has expired');
      }

      // Prepare the message
      const msg = {
        withdraw: {
          htlc_id: htlcId,
          secret: secret
        }
      };

      // Calculate gas
      const gasEstimate = await this.estimateGas(client, senderAddress, msg);
      const gas = Math.floor(gasEstimate * this.options.gasMultiplier!);

      // Execute the transaction
      const cosmwasmClient = client as CosmWasmSigningClient;
      const result = await cosmwasmClient.execute(
        senderAddress,
        this.config.htlcContract,
        msg,
        'auto', // fee
        '', // memo
        []  // funds
      );

      // ExecuteResult doesn't have code/rawLog, it throws on failure
      // Success is implied if we reach this point

      return {
        transactionHash: result.transactionHash,
        blockNumber: result.height,
        gasUsed: result.gasUsed.toString(),
        success: true
      };
    });
  }

  /**
   * Refund an expired HTLC
   */
  async refund(htlcId: string): Promise<PooledTransactionResult> {
    if (!this.wallet) {
      throw new Error('Wallet not available');
    }

    if (!isValidHash(htlcId)) {
      throw new Error('Invalid HTLC ID format');
    }

    return this.signingPool.withSigningClient(this.wallet, async (client) => {
      const senderAddress = this.getSenderAddress();

      // Check HTLC status
      const htlcDetails = await this.getHTLCDetails(htlcId);
      if (htlcDetails.withdrawn) {
        throw new Error('HTLC already withdrawn');
      }
      if (htlcDetails.refunded) {
        throw new Error('HTLC already refunded');
      }
      if (htlcDetails.timelock > Math.floor(Date.now() / 1000)) {
        throw new Error('HTLC has not expired yet');
      }
      if (htlcDetails.sender !== senderAddress) {
        throw new Error('Only HTLC sender can refund');
      }

      // Prepare the message
      const msg = {
        refund: {
          htlc_id: htlcId
        }
      };

      // Calculate gas
      const gasEstimate = await this.estimateGas(client, senderAddress, msg);
      const gas = Math.floor(gasEstimate * this.options.gasMultiplier!);

      // Execute the transaction
      const cosmwasmClient = client as CosmWasmSigningClient;
      const result = await cosmwasmClient.execute(
        senderAddress,
        this.config.htlcContract,
        msg,
        'auto', // fee
        '', // memo
        []  // funds
      );

      // ExecuteResult doesn't have code/rawLog, it throws on failure
      // Success is implied if we reach this point

      return {
        transactionHash: result.transactionHash,
        blockNumber: result.height,
        gasUsed: result.gasUsed.toString(),
        success: true
      };
    });
  }

  /**
   * Get HTLC details
   */
  async getHTLCDetails(htlcId: string): Promise<HTLCDetails> {
    if (!isValidHash(htlcId)) {
      throw new Error('Invalid HTLC ID format');
    }

    return this.queryPool.withClient(async (client) => {
      // Query the contract
      const queryMsg = {
        get_htlc: {
          htlc_id: htlcId
        }
      };

      // This requires the client to support smart contract queries
      // For now, we'll use a type assertion, but in production you'd want proper typing
      const result = await (client as any).queryContractSmart(
        this.config.htlcContract,
        queryMsg
      );

      return {
        htlcId,
        sender: result.sender,
        receiver: result.receiver,
        token: result.amount?.[0]?.denom || '',
        amount: result.amount?.[0]?.amount || '0',
        hashlock: result.hashlock,
        timelock: result.timelock,
        withdrawn: result.withdrawn || false,
        refunded: result.refunded || false,
        targetChain: result.target_chain || '',
        targetAddress: result.target_address || ''
      };
    });
  }

  /**
   * Check if an HTLC exists
   */
  async htlcExists(htlcId: string): Promise<boolean> {
    try {
      const details = await this.getHTLCDetails(htlcId);
      return !!details.sender && details.sender !== '';
    } catch {
      return false;
    }
  }

  /**
   * Get all HTLCs for an address
   */
  async getHTLCsByAddress(address: string, role: 'sender' | 'receiver' = 'sender'): Promise<HTLCDetails[]> {
    if (!isValidCosmosAddress(address, this.config.addressPrefix)) {
      throw new Error('Invalid address');
    }

    return this.queryPool.withClient(async (client) => {
      const queryMsg = role === 'sender' 
        ? { get_htlcs_by_sender: { sender: address } }
        : { get_htlcs_by_receiver: { receiver: address } };

      try {
        const result = await (client as any).queryContractSmart(
          this.config.htlcContract,
          queryMsg
        );

        return (result.htlcs || []).map((htlc: any) => ({
          htlcId: htlc.id,
          sender: htlc.sender,
          receiver: htlc.receiver,
          token: htlc.amount?.[0]?.denom || '',
          amount: htlc.amount?.[0]?.amount || '0',
          hashlock: htlc.hashlock,
          timelock: htlc.timelock,
          withdrawn: htlc.withdrawn || false,
          refunded: htlc.refunded || false,
          targetChain: htlc.target_chain || '',
          targetAddress: htlc.target_address || ''
        }));
      } catch (error) {
        // Contract might not support this query
        return [];
      }
    });
  }

  /**
   * Get account balance
   */
  async getBalance(address?: string, denom?: string): Promise<{ amount: string; denom: string }> {
    const targetAddress = address || this.senderAddress;
    if (!targetAddress) {
      throw new Error('No address specified');
    }

    const targetDenom = denom || this.config.denom;

    return this.queryPool.withClient(async (client) => {
      const balance = await client.getBalance(targetAddress, targetDenom);
      return {
        amount: balance?.amount || '0',
        denom: balance?.denom || targetDenom
      };
    });
  }

  /**
   * Estimate gas for transaction
   */
  private async estimateGas(client: CosmWasmSigningClient, sender: string, msg: EncodeObject): Promise<number> {
    try {
      const gasEstimate = await client.simulate(sender, [msg], '');
      return Math.floor(gasEstimate * this.options.gasMultiplier);
    } catch (error) {
      // Fallback to default gas limit
      return this.config.gasLimit || 200000;
    }
  }

  /**
   * Extract HTLC ID from transaction result
   */
  private extractHTLCIdFromResult(result: CosmosTransactionResult): string | null {
    try {
      // Look for the HTLC ID in transaction events
      for (const event of result.events || []) {
        if (event.type === 'wasm') {
          for (const attr of event.attributes || []) {
            if (attr.key === 'htlc_id') {
              return attr.value;
            }
          }
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats() {
    return {
      query: this.queryPool.getStats(),
      signing: this.signingPool.getStats()
    };
  }
}
import { SigningStargateClient, StargateClient, DeliverTxResponse, IndexedTx } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { EncodeObject } from '@cosmjs/proto-signing';
import { HTLCDetails } from '../types';
import { validateAmount, isValidHash, isValidCosmosAddress } from '../utils';

// Import centralized configuration interfaces
import { CosmosNetworkConfig as UnifiedCosmosConfig } from '@evmore/utils';

// Use proper Cosmos types
type CosmosTransactionResult = DeliverTxResponse | IndexedTx;

export interface CosmosConfig {
  rpcUrl: string;
  restUrl: string;
  chainId: string;
  htlcContract: string;
  mnemonic?: string;
  addressPrefix: string;
  denom: string;
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

export class CosmosHTLCClient {
  private client?: SigningStargateClient;
  private queryClient?: StargateClient;
  private wallet?: DirectSecp256k1HdWallet;
  private config: CosmosConfig;

  constructor(config: CosmosConfig) {
    this.config = config;
  }

  /**
   * Initialize the client with mnemonic
   */
  async init(): Promise<void> {
    if (!this.config.mnemonic) {
      throw new Error('Mnemonic not provided. Cannot initialize signing client.');
    }

    // Create wallet from mnemonic
    this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(
      this.config.mnemonic,
      { prefix: this.config.addressPrefix }
    );

    // Create signing client with CosmWasm support
    this.client = await SigningStargateClient.connectWithSigner(
      this.config.rpcUrl,
      this.wallet
    );

    // Create query-only client with CosmWasm support
    this.queryClient = await StargateClient.connect(this.config.rpcUrl);
  }

  /**
   * Connect with an external wallet
   * @param wallet - External wallet (e.g., Keplr)
   */
  async connect(wallet: DirectSecp256k1HdWallet): Promise<void> {
    this.wallet = wallet;
    
    this.client = await SigningStargateClient.connectWithSigner(
      this.config.rpcUrl,
      wallet
    );
    
    this.queryClient = await StargateClient.connect(this.config.rpcUrl);
  }

  /**
   * Create a new HTLC on Cosmos
   * @param params - HTLC creation parameters
   * @returns Promise resolving to HTLC ID
   */
  async createHTLC(params: CreateCosmosHTLCParams): Promise<string> {
    if (!this.client || !this.wallet) {
      throw new Error('Client not initialized. Call init() first.');
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

    const [account] = await this.wallet.getAccounts();
    const senderAddress = account.address;

    // Create the execute message
    const executeMsg = {
      create_htlc: {
        receiver: params.receiver,
        hashlock: params.hashlock,
        timelock: params.timelock,
        target_chain: params.targetChain,
        target_address: params.targetAddress
      }
    };

    const msg = {
      typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
      value: {
        sender: senderAddress,
        contract: this.config.htlcContract,
        msg: Buffer.from(JSON.stringify(executeMsg)),
        funds: [{ denom: params.denom, amount: params.amount }]
      }
    };

    const fee = {
      amount: [{ denom: this.config.denom, amount: '5000' }],
      gas: '200000'
    };

    const result = await this.client.signAndBroadcast(
      senderAddress,
      [msg],
      fee,
      `Create HTLC: ${params.amount} ${params.denom}`
    );

    if (result.code !== 0) {
      throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    // Extract HTLC ID from transaction events
    const htlcId = this.extractHTLCIdFromResult(result);
    if (!htlcId) {
      throw new Error('Could not extract HTLC ID from transaction result');
    }

    return htlcId;
  }

  /**
   * Withdraw from an HTLC using the secret
   * @param htlcId - HTLC ID
   * @param secret - Secret to reveal
   * @returns Promise resolving to transaction hash
   */
  async withdraw(htlcId: string, secret: string): Promise<string> {
    if (!this.client || !this.wallet) {
      throw new Error('Client not initialized');
    }

    if (!isValidHash(secret)) {
      throw new Error('Invalid secret format');
    }

    const [account] = await this.wallet.getAccounts();
    const senderAddress = account.address;

    const executeMsg = {
      withdraw: {
        htlc_id: htlcId,
        secret: secret
      }
    };

    const msg = {
      typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
      value: {
        sender: senderAddress,
        contract: this.config.htlcContract,
        msg: Buffer.from(JSON.stringify(executeMsg)),
        funds: []
      }
    };

    const fee = {
      amount: [{ denom: this.config.denom, amount: '5000' }],
      gas: '200000'
    };

    const result = await this.client.signAndBroadcast(
      senderAddress,
      [msg],
      fee,
      `Withdraw HTLC: ${htlcId}`
    );

    if (result.code !== 0) {
      throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    return result.transactionHash;
  }

  /**
   * Refund an expired HTLC
   * @param htlcId - HTLC ID
   * @returns Promise resolving to transaction hash
   */
  async refund(htlcId: string): Promise<string> {
    if (!this.client || !this.wallet) {
      throw new Error('Client not initialized');
    }

    const [account] = await this.wallet.getAccounts();
    const senderAddress = account.address;

    const executeMsg = {
      refund: {
        htlc_id: htlcId
      }
    };

    const msg = {
      typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
      value: {
        sender: senderAddress,
        contract: this.config.htlcContract,
        msg: Buffer.from(JSON.stringify(executeMsg)),
        funds: []
      }
    };

    const fee = {
      amount: [{ denom: this.config.denom, amount: '5000' }],
      gas: '200000'
    };

    const result = await this.client.signAndBroadcast(
      senderAddress,
      [msg],
      fee,
      `Refund HTLC: ${htlcId}`
    );

    if (result.code !== 0) {
      throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    return result.transactionHash;
  }

  /**
   * Get HTLC details
   * @param htlcId - HTLC ID
   * @returns Promise resolving to HTLC details or null if not found
   */
  async getHTLC(htlcId: string): Promise<HTLCDetails | null> {
    if (!this.queryClient) {
      // Create query-only client if not available
      this.queryClient = await StargateClient.connect(this.config.rpcUrl);
    }

    try {
      const queryMsg = {
        get_htlc: {
          htlc_id: htlcId
        }
      };

      // Type assertion needed as queryContractSmart is a CosmWasm extension method
      const result = await (this.queryClient as any).queryContractSmart(
        this.config.htlcContract,
        queryMsg
      );

      if (!result) {
        return null;
      }

      return {
        htlcId: result.id,
        sender: result.sender,
        receiver: result.receiver,
        token: this.config.denom, // For Cosmos, we use the native denom
        amount: result.amount[0]?.amount || '0',
        hashlock: result.hashlock,
        timelock: result.timelock,
        withdrawn: result.withdrawn,
        refunded: result.refunded,
        targetChain: result.target_chain,
        targetAddress: result.target_address
      };
    } catch (error) {
      // Return null on error to indicate HTLC not found
      return null;
    }
  }

  /**
   * List HTLCs with pagination
   * @param startAfter - Start after this HTLC ID
   * @param limit - Maximum number of HTLCs to return
   * @returns Promise resolving to list of HTLCs
   */
  async listHTLCs(startAfter?: string, limit: number = 10): Promise<HTLCDetails[]> {
    if (!this.queryClient) {
      this.queryClient = await StargateClient.connect(this.config.rpcUrl);
    }

    try {
      const queryMsg = {
        list_htlcs: {
          start_after: startAfter,
          limit: limit
        }
      };

      // Type assertion needed as queryContractSmart is a CosmWasm extension method
      const result = await (this.queryClient as any).queryContractSmart(
        this.config.htlcContract,
        queryMsg
      );

      return result.htlcs.map((htlc: any) => ({
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
        targetAddress: htlc.target_address
      }));
    } catch (error) {
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
    if (!this.queryClient) {
      this.queryClient = await StargateClient.connect(this.config.rpcUrl);
    }

    const balance = await this.queryClient.getBalance(
      address,
      denom || this.config.denom
    );

    return balance.amount;
  }

  /**
   * Get current address from wallet
   * @returns Promise resolving to address
   */
  async getAddress(): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not available');
    }

    const [account] = await this.wallet.getAccounts();
    return account.address;
  }

  /**
   * Get current block height
   * @returns Promise resolving to block height
   */
  async getHeight(): Promise<number> {
    if (!this.queryClient) {
      this.queryClient = await StargateClient.connect(this.config.rpcUrl);
    }

    return this.queryClient.getHeight();
  }

  /**
   * Get transaction by hash
   * @param txHash - Transaction hash
   * @returns Promise resolving to transaction or null
   */
  async getTransaction(txHash: string): Promise<CosmosTransactionResult | null> {
    if (!this.queryClient) {
      this.queryClient = await StargateClient.connect(this.config.rpcUrl);
    }

    try {
      return await this.queryClient.getTx(txHash);
    } catch (error) {
      // Return null on error to indicate transaction not found
      return null;
    }
  }

  /**
   * Simulate transaction to estimate gas
   * @param messages - Messages to simulate
   * @returns Promise resolving to gas estimate
   */
  async simulate(messages: EncodeObject[]): Promise<number> {
    if (!this.client || !this.wallet) {
      throw new Error('Client not initialized');
    }

    const [account] = await this.wallet.getAccounts();
    return this.client.simulate(account.address, messages, '');
  }

  /**
   * Extract HTLC ID from transaction result
   * @param result - Transaction result
   * @returns HTLC ID or null
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

      // For IndexedTx, look in logs
      if ('logs' in result && result.logs && result.logs.length > 0) {
        for (const log of result.logs) {
          for (const event of log.events || []) {
            if (event.type === 'wasm') {
              for (const attr of event.attributes || []) {
                if (attr.key === 'htlc_id') {
                  return attr.value;
                }
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      // Return null on error
      return null;
    }
  }

  /**
   * Disconnect clients
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
    }
    if (this.queryClient) {
      this.queryClient.disconnect();
    }
  }
}

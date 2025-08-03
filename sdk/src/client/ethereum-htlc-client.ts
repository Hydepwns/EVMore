/**
 * Backward-compatible Ethereum HTLC Client
 * Re-exports the unified client for existing code compatibility
 */

import { ethers } from 'ethers';
import { HTLCDetails, TransactionReceipt } from '../types';
import { ConnectionStrategyFactory } from '@evmore/utils';
import { TransactionStatus } from '@evmore/types';
import { 
  EthereumHTLCClient as UnifiedEthereumHTLCClient,
  EthereumConfig as UnifiedEthereumConfig,
  CreateEthereumHTLCParams as UnifiedCreateHTLCParams
} from './ethereum-htlc-client-unified';

// Import centralized configuration interfaces

// Legacy interface for backward compatibility
export interface EthereumConfig {
  rpcUrl: string;
  htlcContract: string;
  resolverContract?: string;
  privateKey?: string;
  chainId: number;
}

// Legacy interface for backward compatibility
export interface CreateHTLCParams {
  token: string;
  amount: string;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

/**
 * Legacy Ethereum HTLC Client (Direct Connection)
 * Wrapper around unified client for backward compatibility
 */
export class EthereumHTLCClient {
  private unifiedClient: UnifiedEthereumHTLCClient;
  private legacyConfig: EthereumConfig;

  constructor(config: EthereumConfig) {
    this.legacyConfig = config;
    
    // Convert legacy config to unified config
    const unifiedConfig: UnifiedEthereumConfig = {
      htlcContract: config.htlcContract,
      resolverContract: config.resolverContract,
      privateKey: config.privateKey,
      chainId: config.chainId
    };

    // Create direct connection strategy
    const strategy = ConnectionStrategyFactory.createEthereumStrategy('direct', {
      rpcUrl: config.rpcUrl
    });

    this.unifiedClient = new UnifiedEthereumHTLCClient(unifiedConfig, strategy);
  }

  /**
   * Connect with an external signer (e.g., MetaMask)
   */
  connect(_signer: ethers.Signer): void {
    // No-op for compatibility - unified client handles connection
  }

  /**
   * Create a new HTLC on Ethereum
   */
  async createHTLC(params: CreateHTLCParams): Promise<string> {
    const unifiedParams: UnifiedCreateHTLCParams = {
      ...params,
      receiver: params.targetAddress // Map targetAddress to receiver
    };

    const result = await this.unifiedClient.createHTLC(unifiedParams);
    return result.htlcId || '';
  }

  /**
   * Withdraw from an HTLC using the secret
   */
  async withdraw(htlcId: string, secret: string): Promise<string> {
    const result = await this.unifiedClient.withdraw(htlcId, secret);
    return result.transactionHash;
  }

  /**
   * Refund an expired HTLC
   */
  async refund(htlcId: string): Promise<string> {
    const result = await this.unifiedClient.refund(htlcId);
    return result.transactionHash;
  }

  /**
   * Get HTLC details
   */
  async getHTLC(htlcId: string): Promise<HTLCDetails | null> {
    try {
      const details = await this.unifiedClient.getHTLC(htlcId);
      
      // Convert unified format to legacy format
      return {
        htlcId: details.htlcId,
        sender: details.sender,
        receiver: details.receiver,
        token: details.token,
        amount: details.amount,
        hashlock: details.hashlock.replace('0x', ''), // Remove 0x prefix for legacy compatibility
        timelock: details.timelock,
        withdrawn: details.withdrawn,
        refunded: details.refunded,
        targetChain: details.targetChain,
        targetAddress: details.targetAddress
      };
    } catch {
      return null;
    }
  }

  /**
   * Get token information
   */
  async getTokenInfo(tokenAddress: string): Promise<{
    name: string;
    symbol: string;
    decimals: number;
  }> {
    // For now, we'll access the provider directly
    // This could be enhanced by exposing this method in the unified client
    const { ethers: ethersLib } = await import('ethers');
    const { ERC20_ABI } = await import('@evmore/utils');
    
    const provider = new ethersLib.providers.JsonRpcProvider(this.legacyConfig.rpcUrl);
    const tokenContract = new ethersLib.Contract(tokenAddress, ERC20_ABI, provider);

    const [name, symbol, decimals] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(),
      tokenContract.decimals()
    ]);

    return { name, symbol, decimals };
  }

  /**
   * Get token balance for an address
   */
  async getTokenBalance(tokenAddress: string, address: string): Promise<string> {
    const balance = await this.unifiedClient.getTokenBalance(tokenAddress, address);
    
    // Convert to Wei format for legacy compatibility
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      const { ethers: ethersLib } = await import('ethers');
      return ethersLib.utils.parseEther(balance).toString();
    } else {
      // For ERC20 tokens, we need to get decimals and convert
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      const { ethers: ethersLib } = await import('ethers');
      return ethersLib.utils.parseUnits(balance, tokenInfo.decimals).toString();
    }
  }

  /**
   * Get current address from signer
   */
  getAddress(): Promise<string> {
    throw new Error('getAddress() not supported in wrapper. Use unified client directly.');
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    const { ethers: ethersLib } = await import('ethers');
    const provider = new ethersLib.providers.JsonRpcProvider(this.legacyConfig.rpcUrl);
    return provider.getBlockNumber();
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    const { ethers: ethersLib } = await import('ethers');
    const provider = new ethersLib.providers.JsonRpcProvider(this.legacyConfig.rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return null;
    }

    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      from: receipt.from,
      to: receipt.to || undefined,
      value: '0', // ETH value, HTLCs typically don't transfer ETH directly
      gasUsed: receipt.gasUsed.toString(),
      gasPrice: receipt.effectiveGasPrice?.toString() || '0',
      status: receipt.status === 1 ? TransactionStatus.CONFIRMED : TransactionStatus.FAILED,
      timestamp: Math.floor(Date.now() / 1000), // Would need block timestamp for accuracy
      logs: receipt.logs
    };
  }

  /**
   * Estimate gas for HTLC creation
   */
  async estimateCreateHTLCGas(params: CreateHTLCParams): Promise<string> {
    const unifiedParams: UnifiedCreateHTLCParams = {
      ...params,
      receiver: params.targetAddress
    };

    return await this.unifiedClient.estimateCreateHTLCGas(unifiedParams);
  }

  /**
   * Listen for HTLC events
   */
  onHTLCEvent(
    _eventName: 'HTLCCreated' | 'HTLCWithdrawn' | 'HTLCRefunded',
    _callback: (event: { htlcId: string; sender: string; receiver: string; amount: string; hashlock: string; timelock: number }) => void
  ): void {
    throw new Error('Event listening not supported in wrapper. Use unified client directly.');
  }

  /**
   * Remove event listeners
   */
  removeAllListeners(_eventName?: string): void {
    // No-op for compatibility
  }

  /**
   * Get past HTLC events
   */
  getPastEvents(
    _eventName: 'HTLCCreated' | 'HTLCWithdrawn' | 'HTLCRefunded',
    _fromBlock: number = 0,
    _toBlock: number | string = 'latest'
  ): Promise<Array<{ htlcId: string; sender: string; receiver: string; amount: string; hashlock: string; timelock: number }>> {
    throw new Error('getPastEvents() not supported in wrapper. Use unified client directly.');
  }
}

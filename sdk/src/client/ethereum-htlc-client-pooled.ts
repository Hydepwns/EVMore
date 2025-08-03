/**
 * Backward-compatible Pooled Ethereum HTLC Client
 * Re-exports the unified client with pooled connection strategy
 */

import { ethers } from 'ethers';
import { EthereumConnectionPool } from '@evmore/connection-pool';
import { HTLCDetails, PooledTransactionResult } from '../types';
import { ConnectionStrategyFactory } from '@evmore/utils';
import { 
  EthereumHTLCClient as UnifiedEthereumHTLCClient,
  EthereumConfig as UnifiedEthereumConfig,
  CreateEthereumHTLCParams as UnifiedCreateHTLCParams
} from './ethereum-htlc-client-unified';

// Legacy interface for backward compatibility
export interface EthereumConfig {
  htlcContract: string;
  resolverContract?: string;
  privateKey?: string;
  chainId: number;
  gasPrice?: string;
  gasLimit?: number;
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

export interface PooledEthereumHTLCClientOptions {
  retries?: number;
  retryDelay?: number;
  gasMultiplier?: number;
  confirmations?: number;
}

/**
 * Legacy Pooled Ethereum HTLC Client
 * Wrapper around unified client with pooled connection strategy
 */
export class PooledEthereumHTLCClient {
  private unifiedClient: UnifiedEthereumHTLCClient;
  private connectionPool: EthereumConnectionPool;
  private options: PooledEthereumHTLCClientOptions;

  constructor(
    connectionPool: EthereumConnectionPool,
    config: EthereumConfig,
    options: PooledEthereumHTLCClientOptions = {}
  ) {
    this.connectionPool = connectionPool;
    this.options = {
      retries: 3,
      retryDelay: 1000,
      gasMultiplier: 1.1,
      confirmations: 1,
      ...options
    };

    // Convert legacy config to unified config
    const unifiedConfig: UnifiedEthereumConfig = {
      htlcContract: config.htlcContract,
      resolverContract: config.resolverContract,
      privateKey: config.privateKey,
      chainId: config.chainId,
      gasPrice: config.gasPrice,
      gasLimit: config.gasLimit
    };

    // Create pooled connection strategy
    const strategy = ConnectionStrategyFactory.createEthereumStrategy('pooled', {
      connectionPool
    });

    this.unifiedClient = new UnifiedEthereumHTLCClient(unifiedConfig, strategy);
  }

  /**
   * Connect with an external signer (e.g., MetaMask)
   */
  connect(_signer: ethers.Signer): void {
    throw new Error('connect() method not supported in unified client. Use the unified client directly for external signers.');
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
  async withdraw(htlcId: string, secret: string): Promise<PooledTransactionResult> {
    const result = await this.unifiedClient.withdraw(htlcId, secret);
    
    return {
      transactionHash: result.transactionHash,
      blockNumber: result.blockNumber || 0,
      gasUsed: result.gasUsed || '0',
      success: result.success
    };
  }

  /**
   * Refund an expired HTLC
   */
  async refund(htlcId: string): Promise<PooledTransactionResult> {
    const result = await this.unifiedClient.refund(htlcId);
    
    return {
      transactionHash: result.transactionHash,
      blockNumber: result.blockNumber || 0,
      gasUsed: result.gasUsed || '0',
      success: result.success
    };
  }

  /**
   * Get HTLC details
   */
  async getHTLCDetails(htlcId: string): Promise<HTLCDetails> {
    const details = await this.unifiedClient.getHTLC(htlcId);
    
    // Return details in legacy format
    return {
      htlcId: details.htlcId,
      sender: details.sender,
      receiver: details.targetAddress, // Using targetAddress as receiver for cross-chain compatibility
      token: details.token,
      amount: details.amount,
      hashlock: details.hashlock,
      timelock: details.timelock,
      withdrawn: details.withdrawn,
      refunded: details.refunded,
      targetChain: details.targetChain,
      targetAddress: details.targetAddress
    };
  }

  /**
   * Check if an HTLC exists
   */
  async htlcExists(htlcId: string): Promise<boolean> {
    return await this.unifiedClient.htlcExists(htlcId);
  }

  /**
   * Get token information
   */
  async getTokenInfo(tokenAddress: string): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    balance?: string;
  }> {
    // For backward compatibility, we'll implement this using the connection pool
    return this.connectionPool.withProvider(async (provider) => {
      const { ERC20_ABI } = await import('@evmore/utils');
      const { ethers: ethersLib } = await import('ethers');
      
      const tokenContract = new ethersLib.Contract(tokenAddress, ERC20_ABI, provider);
      
      const [name, symbol, decimals] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.decimals()
      ]);

      return {
        name,
        symbol,
        decimals
      };
    });
  }

  /**
   * Estimate gas for HTLC creation
   */
  async estimateCreateHTLCGas(params: CreateHTLCParams): Promise<{
    gasEstimate: string;
    gasPrice: string;
    estimatedCost: string;
  }> {
    const unifiedParams: UnifiedCreateHTLCParams = {
      ...params,
      receiver: params.targetAddress
    };

    // Get gas estimate from unified client
    const gasEstimate = await this.unifiedClient.estimateCreateHTLCGas(unifiedParams);

    // Get gas price from connection pool
    const gasPrice = await this.connectionPool.withProvider(async (provider) => {
      const currentGasPrice = await provider.getGasPrice();
      return currentGasPrice;
    });

    const { ethers: ethersLib } = await import('ethers');
    const gasPriceFormatted = ethersLib.formatUnits(gasPrice, 'gwei');
    const estimatedCost = ethersLib.formatEther(
      BigInt(gasEstimate) * BigInt(gasPrice.toString())
    );

    return {
      gasEstimate,
      gasPrice: gasPriceFormatted,
      estimatedCost
    };
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats() {
    return this.connectionPool.getStats();
  }
}
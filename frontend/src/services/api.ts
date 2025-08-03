// import { FusionCosmosClient } from '@1inch/fusion-cosmos-sdk';
import type { SwapParams, SwapTransaction, PartialFillOrder } from '../types';
import { TRANSACTION_STORAGE_KEY, MAX_STORED_TRANSACTIONS } from '../utils/constants';

// Initialize the SDK client
// TODO: Use actual SDK client when implementing real swap functionality
// const client = new FusionCosmosClient({
//   relayerUrl: import.meta.env.VITE_RELAYER_URL || 'http://localhost:3000',
// });

// Convert frontend swap params to SDK format
function convertToSDKParams(params: SwapParams): any {
  return {
    fromChain: params.fromChain.chainId.toString(),
    toChain: params.toChain.chainId.toString(),
    fromToken: params.fromToken.address,
    toToken: params.toToken.address,
    amount: params.amount,
    fromAddress: '', // Will be filled from wallet
    toAddress: params.recipientAddress || '', // Will be filled from wallet
  };
}

// Store transaction in local storage
function storeTransaction(transaction: SwapTransaction) {
  const stored = localStorage.getItem(TRANSACTION_STORAGE_KEY);
  let transactions: SwapTransaction[] = [];
  
  if (stored) {
    try {
      transactions = JSON.parse(stored);
    } catch (error) {
      console.error('Failed to parse stored transactions:', error);
    }
  }
  
  // Add new transaction at the beginning
  transactions.unshift(transaction);
  
  // Keep only the most recent transactions
  if (transactions.length > MAX_STORED_TRANSACTIONS) {
    transactions = transactions.slice(0, MAX_STORED_TRANSACTIONS);
  }
  
  localStorage.setItem(TRANSACTION_STORAGE_KEY, JSON.stringify(transactions));
}

// Update transaction status in local storage
function updateTransactionStatus(id: string, status: string, txHash?: string) {
  const stored = localStorage.getItem(TRANSACTION_STORAGE_KEY);
  if (!stored) return;
  
  try {
    const transactions: SwapTransaction[] = JSON.parse(stored);
    const index = transactions.findIndex(tx => tx.id === id);
    
    if (index !== -1) {
      transactions[index].status = status;
      transactions[index].updatedAt = new Date();
      if (txHash) {
        transactions[index].txHash = txHash;
      }
      localStorage.setItem(TRANSACTION_STORAGE_KEY, JSON.stringify(transactions));
    }
  } catch (error) {
    console.error('Failed to update transaction status:', error);
  }
}

export const swapAPI = {
  async initiateSwap(params: SwapParams): Promise<string> {
    // Create transaction record
    const transaction: SwapTransaction = {
      id: `swap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromToken: params.fromToken,
      toToken: params.toToken,
      amount: params.amount,
      status: 'initiating',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Store initial transaction
    storeTransaction(transaction);
    
    try {
      // Convert params and initiate swap
      const sdkParams = convertToSDKParams(params);
      
      // For demo purposes, simulate swap initiation
      // In production, this would call the actual SDK method
      console.log('Initiating swap with params:', sdkParams);
      
      // Simulate async operation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update status to pending
      updateTransactionStatus(transaction.id, 'pending');
      
      // Simulate getting a transaction hash (64 hex chars)
      const randomHex = Array.from({ length: 64 }, () => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      const mockTxHash = `0x${randomHex}`;
      updateTransactionStatus(transaction.id, 'pending', mockTxHash);
      
      return transaction.id;
    } catch (error) {
      updateTransactionStatus(transaction.id, 'failed');
      throw error;
    }
  },
  
  async createPartialFill(orderId: string, amount: string, percentage: number): Promise<PartialFillOrder> {
    // For demo purposes, create a mock partial fill
    const partialFill: PartialFillOrder = {
      id: `fill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      originalOrderId: orderId,
      amount,
      fillPercentage: percentage,
      status: 'pending',
      createdAt: new Date(),
    };
    
    console.log('Creating partial fill:', partialFill);
    
    // In production, this would call the SDK method
    // await client.createPartialFill(orderId, { value: amount, decimals: 6, symbol: 'USDC' });
    
    return partialFill;
  },
  
  async getTransactionStatus(txId: string): Promise<string> {
    // In production, this would query the actual transaction status
    // For now, return from local storage
    const stored = localStorage.getItem(TRANSACTION_STORAGE_KEY);
    if (!stored) return 'unknown';
    
    try {
      const transactions: SwapTransaction[] = JSON.parse(stored);
      const transaction = transactions.find(tx => tx.id === txId);
      return transaction?.status || 'unknown';
    } catch (error) {
      console.error('Failed to get transaction status:', error);
      return 'unknown';
    }
  },
  
  async getTransactionHistory(): Promise<SwapTransaction[]> {
    const stored = localStorage.getItem(TRANSACTION_STORAGE_KEY);
    if (!stored) return [];
    
    try {
      return JSON.parse(stored);
    } catch (error) {
      console.error('Failed to parse transaction history:', error);
      return [];
    }
  },
  
  async simulateCompletion(txId: string): Promise<void> {
    // For demo purposes, simulate transaction completion
    updateTransactionStatus(txId, 'completed');
    console.log('Transaction completed:', txId);
  },
};
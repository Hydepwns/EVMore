/**
 * SDK Types - Now using @evmore/types with backward compatibility
 * 
 * This file provides both the new types from @evmore/types and legacy compatibility
 * interfaces for existing code during the migration period.
 */

// Import new standardized types
export {
  SwapOrder,
  SwapStatus,
  SwapEndpoint,
  SwapAmount,
  TimelockConfig,
  SecretPair,
  SwapRoute,
  SwapQuote,
  CrossChainSwapParams,
  Chain,
  ChainType,
  Currency,
  ChainEndpoints,
  TokenInfo,
  ChainConfig,
  TransactionInfo,
  TransactionStatus
} from '@evmore/types';

// Legacy interfaces removed - use @evmore/types instead
// HTLCOrder → SwapOrder
// LegacySwapStatus → SwapStatus  
// HTLCDetails → SwapOrder with HTLCDetails
// TransactionReceipt → TransactionInfo

// Re-export migration aliases for backward compatibility  
export { TransactionReceipt, LegacyHTLCDetails as HTLCDetails } from '@evmore/types/src/migration/type-aliases';

// HTLCOrder migration - define locally for SDK compatibility
export interface HTLCOrder {
  id: string;
  htlcId: string;
  timelock: number;
  status: string;
  createdAt: number | Date;
  [key: string]: unknown;
}

// Legacy swap status for migration
export type LegacySwapStatus = 'pending' | 'filled' | 'expired' | 'cancelled' | 'completed' | 'failed';

// Alternative interface for pooled client returns
export interface PooledTransactionResult {
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  success: boolean;
}

// CosmWasm client type extensions
export * from './cosmwasm-client';

// Export new dedicated type files
export * from './cosmos-htlc';
export * from './ethereum-htlc';
export * from './dex';

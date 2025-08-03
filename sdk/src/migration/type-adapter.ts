/**
 * Type migration adapter for SDK
 * Provides backwards compatibility during transition to @evmore/types
 */

import {
  SwapOrder as NewSwapOrder,
  SwapStatus as NewSwapStatus,
  SwapRoute as NewSwapRoute,
  SwapQuote as NewSwapQuote,
  CrossChainSwapParams as NewCrossChainSwapParams,
  ChainConfig as NewChainConfig,
  TokenInfo as NewTokenInfo,
  ChainType as NewChainType
} from '@evmore/types';

// Legacy types from SDK
import {
  HTLCOrder as LegacyHTLCOrder,
  CrossChainSwapParams as LegacyCrossChainSwapParams,
  SwapQuote as LegacySwapQuote,
  SwapRoute as LegacySwapRoute,
  SwapStatus as LegacySwapStatus,
  HTLCDetails as LegacyHTLCDetails,
  ChainConfig as LegacyChainConfig,
  TokenInfo as LegacyTokenInfo,
  TransactionReceipt as LegacyTransactionReceipt,
  TransactionStatus as LegacyTransactionStatus
} from '../types/index';

/**
 * Adapter functions to convert between legacy and new types
 */

export function adaptHTLCOrderToSwapOrder(legacy: LegacyHTLCOrder): NewSwapOrder {
  return {
    id: String(legacy.id),
    orderId: String(legacy.htlcId),
    status: adaptLegacyStatus(String(legacy.status)),
    source: {
      chainId: String(legacy.fromChain || legacy.sourceChain || ''),
      address: String(legacy.sender || legacy.maker || ''),
      tokenAddress: legacy.fromToken || legacy.token ? String(legacy.fromToken || legacy.token) : undefined
    },
    destination: {
      chainId: String(legacy.toChain || legacy.targetChain || ''),
      address: String(legacy.receiver || ''),
      tokenAddress: legacy.toToken || legacy.targetToken ? String(legacy.toToken || legacy.targetToken) : undefined
    },
    amount: {
      value: String(legacy.fromAmount || legacy.amount || '0'),
      decimals: 18, // Default, should be determined from token info
      displayValue: String(legacy.fromAmount || legacy.amount || '0'),
      symbol: 'UNKNOWN' // Default, should be determined from token info
    },
    timelock: {
      startTime: Math.floor(Date.now() / 1000),
      duration: Number(legacy.timelock),
      expiryTime: Math.floor(Date.now() / 1000) + Number(legacy.timelock),
      buffer: Math.floor(Number(legacy.timelock) * 0.1)
    },
    secret: {
      hash: String(legacy.secretHash || legacy.hashlock || ''),
      preimage: legacy.secret ? String(legacy.secret) : undefined,
      algorithm: 'sha256' as const
    },
    metadata: {
      // Note: estimatedOutput doesn't exist in SwapMetadata, removed for type safety
      // estimatedOutput: legacy.estimatedOutput,
      // priceImpact: legacy.priceImpact,
      sourceTransaction: legacy.txHash ? String(legacy.txHash) : undefined,
      notes: legacy.priceImpact ? `Price impact: ${String(legacy.priceImpact)}` : undefined
    },
    createdAt: typeof legacy.createdAt === 'number' ? new Date(legacy.createdAt) : legacy.createdAt,
    updatedAt: new Date(),
    expiresAt: new Date((Math.floor(Date.now() / 1000) + Number(legacy.timelock)) * 1000)
  };
}

export function adaptSwapOrderToHTLCOrder(newOrder: NewSwapOrder): LegacyHTLCOrder {
  return {
    id: newOrder.id,
    htlcId: newOrder.orderId,
    sender: newOrder.source.address,
    receiver: newOrder.destination.address,
    fromToken: newOrder.source.tokenAddress,
    toToken: newOrder.destination.tokenAddress,
    fromAmount: newOrder.amount.value,
    fromChain: newOrder.source.chainId,
    toChain: newOrder.destination.chainId,
    secretHash: newOrder.secret.hash,
    secret: newOrder.secret.preimage,
    timelock: newOrder.timelock.duration,
    status: adaptNewStatus(newOrder.status),
    createdAt: newOrder.createdAt,
    txHash: newOrder.metadata?.sourceTransaction,
    estimatedOutput: undefined,
    priceImpact: undefined,
    swapRoutes: newOrder.metadata?.route
  };
}

export function adaptCrossChainSwapParams(legacy: LegacyCrossChainSwapParams): NewCrossChainSwapParams {
  return {
    fromChain: legacy.fromChain,
    toChain: legacy.toChain,
    fromToken: legacy.fromToken,
    toToken: legacy.toToken,
    fromAmount: legacy.fromAmount,
    toAddress: legacy.toAddress,
    slippageTolerance: legacy.slippageTolerance || 0.5,
    deadline: legacy.deadline || Math.floor(Date.now() / 1000) + 3600,
    metadata: {}
  };
}

export function adaptSwapQuote(legacy: LegacySwapQuote): NewSwapQuote {
  return {
    fromAmount: legacy.fromAmount,
    toAmount: legacy.toAmount,
    minimumReceived: legacy.minimumReceived,
    priceImpact: legacy.priceImpact,
    estimatedGas: legacy.estimatedGas,
    route: legacy.route,
    fees: legacy.fees,
    estimatedExecutionTime: 300, // Default 5 minutes
    slippageTolerance: 0.5, // Default 0.5%
    deadline: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
  };
}

export function adaptSwapRoute(legacy: LegacySwapRoute): NewSwapRoute {
  return {
    hopIndex: 0, // Would need to be determined from context
    fromChain: '', // Would need to be determined from context
    toChain: '', // Would need to be determined from context
    fromToken: '',
    toToken: '', // Default empty string since tokenOutDenom doesn't exist in new type
    expectedAmount: '0',
    minimumAmount: '0',
    poolId: legacy.poolId
  };
}

export function adaptChainConfig(legacy: LegacyChainConfig): NewChainConfig {
  return {
    chainId: legacy.chainId,
    name: legacy.name,
    type: NewChainType.COSMOS, // Default to COSMOS, should be determined from context
    rpcUrl: legacy.rpcUrl,
    restUrl: legacy.restUrl,
    htlcContract: legacy.htlcContract,
    nativeDenom: legacy.nativeDenom,
    addressPrefix: legacy.addressPrefix,
    blockTime: legacy.blockTime,
    confirmations: 1, // Default value
    gasConfig: {
      maxGasLimit: 2000000 // Default value
    }
  };
}

export function adaptTokenInfo(legacy: LegacyTokenInfo): NewTokenInfo {
  return {
    address: legacy.address,
    symbol: legacy.symbol,
    name: legacy.name,
    decimals: legacy.decimals,
    chainId: legacy.chainId,
    logoUrl: legacy.logoUrl,
  };
}

// Status conversion helpers
function adaptLegacyStatus(status: LegacyHTLCOrder['status']): NewSwapStatus {
  const statusMap: Record<string, NewSwapStatus> = {
    'pending': NewSwapStatus.PENDING,
    'filled': NewSwapStatus.COMPLETED, 
    'expired': NewSwapStatus.REFUNDED,
    'cancelled': NewSwapStatus.FAILED,
    'completed': NewSwapStatus.COMPLETED
  };
  
  return statusMap[status] || NewSwapStatus.PENDING;
}

function adaptNewStatus(status: NewSwapStatus): LegacyHTLCOrder['status'] {
  const statusMap: Record<NewSwapStatus, LegacyHTLCOrder['status']> = {
    [NewSwapStatus.PENDING]: 'pending',
    [NewSwapStatus.LOCKED]: 'pending',
    [NewSwapStatus.COMMITTED]: 'pending', 
    [NewSwapStatus.REVEALED]: 'filled',
    [NewSwapStatus.COMPLETED]: 'completed',
    [NewSwapStatus.REFUNDED]: 'expired',
    [NewSwapStatus.FAILED]: 'cancelled',
    [NewSwapStatus.EXPIRED]: 'expired'
  };
  
  return statusMap[status] || 'pending';
}

// Re-export types for compatibility
export type {
  LegacyHTLCOrder,
  LegacyCrossChainSwapParams,
  LegacySwapQuote,
  LegacySwapRoute,
  LegacySwapStatus,
  LegacyHTLCDetails,
  LegacyChainConfig,
  LegacyTokenInfo,
  LegacyTransactionReceipt,
  LegacyTransactionStatus
};
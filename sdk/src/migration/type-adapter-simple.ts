/**
 * Simplified type adapter for SDK migration
 * Provides minimal adapters to get the SDK building
 */

import { 
  SwapOrder, 
  CrossChainSwapParams,
  SwapQuote,
  SwapStatus 
} from '@evmore/types';

// Legacy HTLCOrder interface for migration purposes only
interface HTLCOrder {
  id: string;
  htlcId: string;
  timelock: number;
  status: string;
  createdAt: number | Date;
  [key: string]: unknown;
}

/**
 * Simple status adapter - maps legacy status to new SwapStatus enum
 */
export function adaptLegacyStatus(legacyStatus: string): SwapStatus {
  switch (legacyStatus) {
    case 'pending':
      return SwapStatus.PENDING;
    case 'filled':
    case 'completed':
      return SwapStatus.COMPLETED;
    case 'expired':
      return SwapStatus.EXPIRED;
    case 'cancelled':
    case 'failed':
      return SwapStatus.FAILED;
    default:
      return SwapStatus.PENDING;
  }
}

/**
 * Minimal HTLCOrder to SwapOrder adapter
 * Only converts what's necessary for compilation
 */
export function htlcOrderToSwapOrder(htlc: HTLCOrder): Partial<SwapOrder> {
  return {
    id: htlc.id,
    orderId: htlc.htlcId,
    status: adaptLegacyStatus(htlc.status),
    createdAt: typeof htlc.createdAt === 'number' ? new Date(htlc.createdAt) : htlc.createdAt,
    updatedAt: new Date(),
    expiresAt: new Date((Math.floor(Date.now() / 1000) + htlc.timelock) * 1000)
  };
}

/**
 * Simple identity function for CrossChainSwapParams
 * The types are already compatible
 */
export function adaptSwapParams(params: CrossChainSwapParams): CrossChainSwapParams {
  return params;
}

/**
 * Simple identity function for SwapQuote
 * The types are already compatible
 */
export function adaptSwapQuote(quote: SwapQuote): SwapQuote {
  return quote;
}
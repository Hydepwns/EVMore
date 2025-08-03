/**
 * Temporary type aliases for backwards compatibility during migration
 * These will be removed after all components are updated to use the new types
 */

// Re-export old type names pointing to new types
export { SwapOrder as HTLCOrder } from '../swap/swap.types';
export { SwapEndpoint as ChainEndpoint } from '../swap/swap.types';
export { IBCRoute as RouteInfo } from '../ibc/ibc.types';
export { Chain as ChainInfo } from '../chain/chain.types';
export { TransactionInfo as TransactionReceipt } from '../chain/chain.types';

// Legacy enum mappings
export const LegacySwapStatus = {
  PENDING: 'pending',
  FILLED: 'completed',
  EXPIRED: 'expired',
  CANCELLED: 'failed',
  COMPLETED: 'completed'
} as const;

export type LegacySwapStatusType = typeof LegacySwapStatus[keyof typeof LegacySwapStatus];

// Legacy interfaces that map to new types
export interface LegacyChainConfig {
  chainId: string;
  rpcUrl?: string;
  restUrl?: string;
  htlcContract?: string;
  nativeDenom?: string;
  addressPrefix?: string;
  blockTime?: number;
}

export interface LegacyHTLCDetails {
  htlcId: string;
  sender: string;
  receiver: string;
  token: string;
  amount: string;
  hashlock: string;
  timelock: number;
  withdrawn: boolean;
  refunded: boolean;
  targetChain: string;
  targetAddress: string;
}

export interface LegacySwapRoute {
  poolId: string;
  tokenOutDenom: string;
}

export interface LegacySwapQuote {
  fromAmount: string;
  toAmount: string;
  minimumReceived: string;
  priceImpact: number;
  estimatedGas: string;
  route: string[];
  fees: {
    networkFee: string;
    protocolFee: string;
    total: string;
  };
}

// Type mapping utilities
export type ModernSwapStatus = 'pending' | 'locked' | 'committed' | 'revealed' | 'completed' | 'refunded' | 'failed' | 'expired';
export type LegacyStatusMapping = {
  [K in LegacySwapStatusType]: ModernSwapStatus;
};

export const legacyToModernStatus: LegacyStatusMapping = {
  pending: 'pending',
  completed: 'completed',
  expired: 'expired',
  failed: 'failed'
};

export const modernToLegacyStatus: Record<ModernSwapStatus, LegacySwapStatusType> = {
  pending: 'pending',
  locked: 'pending',
  committed: 'pending',
  revealed: 'pending',
  completed: 'completed',
  refunded: 'failed',
  failed: 'failed',
  expired: 'expired'
};

// Deprecation warnings for gradual migration
export function warnDeprecated(oldName: string, newName: string, version?: string): void {
  const versionInfo = version ? ` (deprecated in v${version})` : '';
  console.warn(`[DEPRECATION WARNING] ${oldName} is deprecated${versionInfo}. Use ${newName} instead.`);
}
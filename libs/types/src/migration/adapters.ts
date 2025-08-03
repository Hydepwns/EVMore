/**
 * Adapters to convert between legacy and modern type formats
 * These help during the migration period to maintain compatibility
 */

import { 
  SwapOrder, 
  SwapStatus,
  ChainType,
  ChainConfig,
  SwapRoute,
  SwapQuote
} from '../index';
import { 
  LegacyChainConfig,
  LegacySwapRoute,
  LegacySwapQuote,
  legacyToModernStatus,
  modernToLegacyStatus,
  warnDeprecated
} from './type-aliases';

// Legacy to modern adapters
export function adaptLegacyChainConfig(legacy: LegacyChainConfig): Partial<ChainConfig> {
  warnDeprecated('LegacyChainConfig', 'ChainConfig', '0.2.0');
  
  // Determine chain type from chain ID
  let chainType: ChainType;
  if (/^\d+$/.test(legacy.chainId) || /^0x[0-9a-fA-F]+$/.test(legacy.chainId)) {
    chainType = ChainType.ETHEREUM;
  } else if (legacy.chainId.includes('osmosis')) {
    chainType = ChainType.OSMOSIS;
  } else {
    chainType = ChainType.COSMOS;
  }
  
  return {
    chainId: legacy.chainId,
    name: legacy.chainId, // Default name, should be overridden
    type: chainType,
    rpcUrl: legacy.rpcUrl || '',
    restUrl: legacy.restUrl,
    htlcContract: legacy.htlcContract || '',
    nativeDenom: legacy.nativeDenom || 'unknown',
    addressPrefix: legacy.addressPrefix,
    blockTime: legacy.blockTime || 6, // Default block time
    confirmations: chainType === ChainType.ETHEREUM ? 3 : 1,
    gasConfig: {
      maxGasLimit: chainType === ChainType.ETHEREUM ? 500000 : 200000
    }
  };
}

export function adaptLegacyHTLCToSwapOrder(legacy: any): Partial<SwapOrder> {
  warnDeprecated('HTLCOrder', 'SwapOrder', '0.2.0');
  
  const now = new Date();
  
  return {
    id: legacy.id || legacy.htlcId,
    orderId: legacy.htlcId || legacy.id,
    status: legacy.status ? 
      (legacyToModernStatus[legacy.status as keyof typeof legacyToModernStatus] as SwapStatus) || SwapStatus.PENDING : 
      SwapStatus.PENDING,
    source: {
      chainId: legacy.fromChain || legacy.sourceChain || '',
      address: legacy.sender || legacy.maker || '',
      tokenAddress: legacy.fromToken || legacy.token,
      tokenDenom: legacy.fromToken
    },
    destination: {
      chainId: legacy.toChain || legacy.targetChain || '',
      address: legacy.receiver || '',
      tokenAddress: legacy.toToken || legacy.targetToken,
      tokenDenom: legacy.toToken
    },
    amount: {
      value: legacy.fromAmount || legacy.amount || '0',
      decimals: 18, // Default, should be determined from token
      displayValue: legacy.fromAmount || legacy.amount || '0',
      symbol: 'UNKNOWN' // Should be determined from token
    },
    timelock: {
      startTime: Math.floor(Date.now() / 1000),
      duration: legacy.timelock || 3600,
      expiryTime: (Math.floor(Date.now() / 1000)) + (legacy.timelock || 3600),
      buffer: 300
    },
    secret: {
      hash: legacy.secretHash || legacy.hashlock || '',
      preimage: legacy.secret,
      algorithm: 'sha256'
    },
    metadata: {
      sourceTransaction: legacy.txHash,
      estimatedGas: legacy.estimatedOutput,
      notes: 'Migrated from legacy HTLCOrder'
    },
    createdAt: legacy.createdAt instanceof Date ? legacy.createdAt : 
              typeof legacy.createdAt === 'number' ? new Date(legacy.createdAt) : now,
    updatedAt: now,
    expiresAt: new Date((Math.floor(Date.now() / 1000) + (legacy.timelock || 3600)) * 1000)
  };
}

export function adaptLegacySwapRoute(legacy: LegacySwapRoute, hopIndex: number = 0): SwapRoute {
  warnDeprecated('LegacySwapRoute', 'SwapRoute', '0.2.0');
  
  return {
    hopIndex,
    fromChain: '', // Should be provided by context
    toChain: '', // Should be provided by context
    fromToken: '', // Should be provided by context
    toToken: legacy.tokenOutDenom,
    expectedAmount: '0', // Should be calculated
    minimumAmount: '0', // Should be calculated
    poolId: legacy.poolId,
    dexRoute: {
      poolId: legacy.poolId,
      tokenIn: '', // Should be provided by context
      tokenOut: legacy.tokenOutDenom,
      amountIn: '0', // Should be calculated
      amountOut: '0', // Should be calculated
      priceImpact: 0 // Should be calculated
    }
  };
}

export function adaptLegacySwapQuote(legacy: LegacySwapQuote): SwapQuote {
  warnDeprecated('LegacySwapQuote', 'SwapQuote', '0.2.0');
  
  return {
    fromAmount: legacy.fromAmount,
    toAmount: legacy.toAmount,
    minimumReceived: legacy.minimumReceived,
    priceImpact: legacy.priceImpact,
    estimatedGas: legacy.estimatedGas,
    route: legacy.route.map((_routeStep, index) => ({
      hopIndex: index,
      fromChain: '', // Should be provided by context
      toChain: '', // Should be provided by context
      fromToken: '', // Should be provided by context
      toToken: '', // Should be provided by context
      expectedAmount: '0', // Should be calculated
      minimumAmount: '0' // Should be calculated
    })),
    fees: {
      networkFee: legacy.fees.networkFee,
      protocolFee: legacy.fees.protocolFee,
      relayerFee: '0', // Not in legacy format
      total: legacy.fees.total
    },
    estimatedExecutionTime: 600, // Default 10 minutes
    slippageTolerance: 0.01, // Default 1%
    deadline: Math.floor(Date.now() / 1000) + 1800 // Default 30 minutes
  };
}

// Modern to legacy adapters (for backwards compatibility)
export function adaptSwapOrderToLegacyHTLC(modern: SwapOrder): any {
  return {
    id: modern.id,
    htlcId: modern.orderId,
    maker: modern.source.address,
    sender: modern.source.address,
    receiver: modern.destination.address,
    fromToken: modern.source.tokenAddress || modern.source.tokenDenom,
    toToken: modern.destination.tokenAddress || modern.destination.tokenDenom,
    token: modern.source.tokenAddress || modern.source.tokenDenom,
    targetToken: modern.destination.tokenAddress || modern.destination.tokenDenom,
    fromAmount: modern.amount.value,
    toAmount: modern.amount.value, // Simplified
    amount: modern.amount.value,
    fromChain: modern.source.chainId,
    toChain: modern.destination.chainId,
    sourceChain: modern.source.chainId,
    targetChain: modern.destination.chainId,
    secretHash: modern.secret.hash,
    hashlock: modern.secret.hash,
    secret: modern.secret.preimage,
    timelock: modern.timelock.duration,
    status: modernToLegacyStatus[modern.status],
    createdAt: modern.createdAt,
    txHash: modern.metadata.sourceTransaction,
    swapRoutes: [], // Would need additional context to populate
    estimatedOutput: modern.metadata.estimatedGas,
    priceImpact: '0' // Would need additional context
  };
}

export function adaptChainConfigToLegacy(modern: ChainConfig): LegacyChainConfig {
  return {
    chainId: modern.chainId,
    rpcUrl: modern.rpcUrl,
    restUrl: modern.restUrl,
    htlcContract: modern.htlcContract,
    nativeDenom: modern.nativeDenom,
    addressPrefix: modern.addressPrefix,
    blockTime: modern.blockTime
  };
}

// Utility functions for migration
export function migrateSwapOrderArray(legacyOrders: any[]): SwapOrder[] {
  return legacyOrders
    .map(order => adaptLegacyHTLCToSwapOrder(order))
    .filter(order => order.id && order.orderId) // Filter out invalid orders
    .map(partialOrder => ({
      ...partialOrder,
      // Fill in required fields with defaults if missing
      id: partialOrder.id!,
      orderId: partialOrder.orderId!,
      status: partialOrder.status || SwapStatus.PENDING,
      source: partialOrder.source || { chainId: '', address: '' },
      destination: partialOrder.destination || { chainId: '', address: '' },
      amount: partialOrder.amount || { value: '0', decimals: 18, displayValue: '0', symbol: 'UNKNOWN' },
      timelock: partialOrder.timelock || { startTime: 0, duration: 0, expiryTime: 0, buffer: 0 },
      secret: partialOrder.secret || { hash: '', algorithm: 'sha256' },
      metadata: partialOrder.metadata || {},
      createdAt: partialOrder.createdAt || new Date(),
      updatedAt: partialOrder.updatedAt || new Date(),
      expiresAt: partialOrder.expiresAt || new Date()
    })) as SwapOrder[];
}

export function migrateChainConfigArray(legacyConfigs: LegacyChainConfig[]): ChainConfig[] {
  return legacyConfigs
    .map(config => adaptLegacyChainConfig(config))
    .filter(config => config.chainId && config.rpcUrl) // Filter out invalid configs
    .map(partialConfig => ({
      ...partialConfig,
      // Fill in required fields with defaults
      chainId: partialConfig.chainId!,
      name: partialConfig.name || partialConfig.chainId!,
      type: partialConfig.type || ChainType.COSMOS,
      rpcUrl: partialConfig.rpcUrl!,
      htlcContract: partialConfig.htlcContract || '',
      nativeDenom: partialConfig.nativeDenom || 'unknown',
      blockTime: partialConfig.blockTime || 6,
      confirmations: partialConfig.confirmations || 1,
      gasConfig: partialConfig.gasConfig || { maxGasLimit: 200000 }
    })) as ChainConfig[];
}

// Migration status tracking
export interface MigrationStatus {
  component: string;
  legacy: number;
  migrated: number;
  errors: number;
  warnings: string[];
}

export class MigrationTracker {
  private status: Map<string, MigrationStatus> = new Map();
  
  trackComponent(component: string): void {
    this.status.set(component, {
      component,
      legacy: 0,
      migrated: 0,
      errors: 0,
      warnings: []
    });
  }
  
  recordLegacyUsage(component: string): void {
    const status = this.status.get(component);
    if (status) {
      status.legacy++;
    }
  }
  
  recordMigration(component: string): void {
    const status = this.status.get(component);
    if (status) {
      status.migrated++;
    }
  }
  
  recordError(component: string): void {
    const status = this.status.get(component);
    if (status) {
      status.errors++;
    }
  }
  
  addWarning(component: string, warning: string): void {
    const status = this.status.get(component);
    if (status) {
      status.warnings.push(warning);
    }
  }
  
  getStatus(): MigrationStatus[] {
    return Array.from(this.status.values());
  }
  
  printReport(): void {
    console.log('\n=== Migration Status Report ===');
    for (const status of this.status.values()) {
      const total = status.legacy + status.migrated;
      const percentage = total > 0 ? Math.round((status.migrated / total) * 100) : 0;
      
      console.log(`\n${status.component}:`);
      console.log(`  Legacy: ${status.legacy}`);
      console.log(`  Migrated: ${status.migrated}`);
      console.log(`  Progress: ${percentage}%`);
      console.log(`  Errors: ${status.errors}`);
      
      if (status.warnings.length > 0) {
        console.log(`  Warnings:`);
        status.warnings.forEach(warning => console.log(`    - ${warning}`));
      }
    }
    console.log('\n==============================\n');
  }
}

// Global migration tracker instance
export const migrationTracker = new MigrationTracker();
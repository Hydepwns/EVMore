/**
 * DEX (Decentralized Exchange) Types
 * 
 * This file contains all type definitions related to DEX operations,
 * including spot price queries, swap estimates, and route discovery.
 */

// Spot price response types
export interface SpotPriceResponse {
  spot_price: string;
  base_asset: string;
  quote_asset: string;
}

export interface SwapEstimateResponse {
  amount_out: string;
  amount_in: string;
  price_impact: string;
  fee_amount: string;
  fee_asset: string;
  route: SwapRoute[];
}

export interface RouteResponse {
  routes: SwapRoute[];
  best_route: SwapRoute;
  estimated_amount_out: string;
  price_impact: string;
}

// Swap route types
export interface SwapRoute {
  pool_id: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
  fee: string;
  price_impact: string;
}

export interface MultiHopRoute {
  hops: SwapRoute[];
  total_amount_in: string;
  total_amount_out: string;
  total_fee: string;
  total_price_impact: string;
}

// HTLC parameters for cross-chain swaps
export interface HTLCParams {
  sender: string;
  receiver: string;
  amount: string;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

// Arbitrage opportunity types
export interface ArbitrageOpportunity {
  sourceChain: string;
  targetChain: string;
  sourceToken: string;
  targetToken: string;
  sourcePrice: string;
  targetPrice: string;
  priceDifference: string;
  profitEstimate: string;
  route: MultiHopRoute;
  timestamp: number;
}

// DEX configuration
export interface DEXConfig {
  rpcUrl: string;
  restUrl: string;
  chainId: string;
  dexContract: string;
  pools: PoolConfig[];
}

export interface PoolConfig {
  poolId: string;
  tokenA: string;
  tokenB: string;
  fee: string;
  liquidity: string;
}

// Query parameters
export interface SpotPriceQuery {
  spot_price: {
    base_asset: string;
    quote_asset: string;
  };
}

export interface SwapEstimateQuery {
  estimate_swap: {
    token_in: string;
    token_out: string;
    amount_in: string;
    slippage_tolerance?: string;
  };
}

export interface RouteQuery {
  find_route: {
    token_in: string;
    token_out: string;
    amount_in: string;
    max_hops?: number;
  };
}

// Execute message types
export interface SwapMessage {
  swap: {
    token_in: string;
    token_out: string;
    amount_in: string;
    min_amount_out: string;
    route: SwapRoute[];
  };
}

export interface AddLiquidityMessage {
  add_liquidity: {
    pool_id: string;
    token_a: string;
    token_b: string;
    amount_a: string;
    amount_b: string;
    min_liquidity: string;
  };
}

export interface RemoveLiquidityMessage {
  remove_liquidity: {
    pool_id: string;
    liquidity: string;
    min_amount_a: string;
    min_amount_b: string;
  };
}

// Pool information
export interface PoolInfo {
  poolId: string;
  tokenA: string;
  tokenB: string;
  reserveA: string;
  reserveB: string;
  fee: string;
  totalLiquidity: string;
  volume24h: string;
  apr: string;
}

// Market data
export interface MarketData {
  symbol: string;
  price: string;
  volume24h: string;
  priceChange24h: string;
  marketCap: string;
  circulatingSupply: string;
}

// Error types
export class DEXError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'DEXError';
  }
}

export class InsufficientLiquidityError extends DEXError {
  constructor(tokenIn: string, tokenOut: string) {
    super(`Insufficient liquidity for ${tokenIn}/${tokenOut} pair`);
    this.name = 'InsufficientLiquidityError';
  }
}

export class SlippageExceededError extends DEXError {
  constructor(expected: string, actual: string, slippage: string) {
    super(`Slippage exceeded. Expected: ${expected}, Actual: ${actual}, Max Slippage: ${slippage}`);
    this.name = 'SlippageExceededError';
  }
}

export class RouteNotFoundError extends DEXError {
  constructor(tokenIn: string, tokenOut: string) {
    super(`No route found from ${tokenIn} to ${tokenOut}`);
    this.name = 'RouteNotFoundError';
  }
}

export class PoolNotFoundError extends DEXError {
  constructor(poolId: string) {
    super(`Pool with ID ${poolId} not found`);
    this.name = 'PoolNotFoundError';
  }
}

// Type guards and validation
export function isValidTokenAddress(address: string): boolean {
  return /^[a-zA-Z0-9]{3,128}$/.test(address);
}

export function isValidPoolId(poolId: string): boolean {
  return /^\d+$/.test(poolId);
}

export function isValidAmount(amount: string): boolean {
  const num = parseFloat(amount);
  return !isNaN(num) && num > 0;
}

export function isValidSlippage(slippage: string): boolean {
  const num = parseFloat(slippage);
  return !isNaN(num) && num >= 0 && num <= 100;
}

// Utility types
export type TokenPair = [string, string];

export interface PriceImpact {
  percentage: number;
  absolute: string;
}

export interface SwapResult {
  txHash: string;
  amountIn: string;
  amountOut: string;
  fee: string;
  priceImpact: PriceImpact;
  route: SwapRoute[];
} 
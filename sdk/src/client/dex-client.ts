import { SigningStargateClient } from '@cosmjs/stargate';
import { Coin } from '@cosmjs/amino';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';

// Define proper types for contract responses
interface SpotPriceResponse {
  spot_price: string;
  token_in_denom: string;
  token_out_denom: string;
}

interface SwapEstimateResponse {
  token_out_amount: string;
  price_impact: string;
  swap_fee: string;
}

interface RouteResponse {
  routes: SwapRoute[][];
  estimated_output: string;
  total_fees: string;
  price_impact: string;
}

interface HTLCParams {
  receiver: string;
  amount: string;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

interface ArbitrageOpportunity {
  tokenA: string;
  tokenB: string;
  priceDifference: number;
  profitEstimate: string;
}

export interface SwapRoute {
  poolId: string;
  tokenOutDenom: string;
}

export interface SwapEstimate {
  tokenOutAmount: string;
  priceImpact: string;
  swapFee: string;
  routes: SwapRoute[];
}

export interface CrossChainSwapParams {
  sourceChain: string;
  sourceToken: string;
  sourceAmount: string;
  targetChain: string;
  targetToken: string;
  minOutputAmount: string;
  slippageTolerance?: number;
  receiver: string;
  deadline: number;
}

export interface HTLCSwapParams {
  htlcId: string;
  routes: SwapRoute[];
  minOutputAmount: string;
  slippageTolerance: number;
}

/**
 * Client for interacting with DEX functionality in the 1inch Fusion+ Cosmos Extension
 */
export class DexClient {
  private cosmosClient: SigningStargateClient | null = null;
  private htlcContractAddress: string;
  private routerContractAddress: string;

  constructor(
    htlcContractAddress: string,
    routerContractAddress: string
  ) {
    this.htlcContractAddress = htlcContractAddress;
    this.routerContractAddress = routerContractAddress;
  }

  /**
   * Connect to the Cosmos chain
   */
  async connect(client: SigningStargateClient): Promise<void> {
    this.cosmosClient = client;
  }

  /**
   * Create an HTLC with integrated DEX swap
   */
  async createHTLCWithSwap(
    sender: string,
    receiver: string,
    amount: Coin,
    hashlock: string,
    timelock: number,
    targetChain: string,
    targetAddress: string,
    swapParams: {
      routes: SwapRoute[];
      minOutputAmount: string;
      slippageTolerance: number;
    }
  ): Promise<string> {
    if (!this.cosmosClient) {
      throw new Error('Client not connected');
    }

    const msg = {
      create_htlc_with_swap: {
        receiver,
        hashlock,
        timelock,
        target_chain: targetChain,
        target_address: targetAddress,
        swap_params: {
          routes: swapParams.routes,
          min_output_amount: swapParams.minOutputAmount,
          slippage_tolerance: swapParams.slippageTolerance.toString(),
        },
      },
    };

    const result = await (this.cosmosClient as SigningStargateClient & {
      execute: (sender: string, contractAddress: string, msg: Record<string, unknown>, fee: string, memo?: string, funds?: Coin[]) => Promise<ExecuteResult>;
    }).execute(
      sender,
      this.htlcContractAddress,
      msg,
      'auto',
      undefined,
      [amount]
    );

    return result.transactionHash;
  }

  /**
   * Query spot price from Osmosis pools
   */
  async querySpotPrice(
    poolId: string,
    baseAssetDenom: string,
    quoteAssetDenom: string
  ): Promise<{
    spotPrice: string;
    tokenInDenom: string;
    tokenOutDenom: string;
  }> {
    if (!this.cosmosClient) {
      throw new Error('Client not connected');
    }

    const query = {
      query_spot_price: {
        pool_id: parseInt(poolId),
        base_denom: baseAssetDenom,
        quote_denom: quoteAssetDenom,
      },
    };

    const response = await (this.cosmosClient as SigningStargateClient & {
      queryContractSmart: (address: string, queryMsg: Record<string, unknown>) => Promise<SpotPriceResponse>;
    }).queryContractSmart(
      this.htlcContractAddress,
      query
    ) as SpotPriceResponse;

    return {
      spotPrice: response.spot_price,
      tokenInDenom: response.token_in_denom,
      tokenOutDenom: response.token_out_denom,
    };
  }

  /**
   * Estimate swap output for given routes
   */
  async estimateSwap(
    tokenIn: Coin,
    routes: SwapRoute[]
  ): Promise<SwapEstimate> {
    if (!this.cosmosClient) {
      throw new Error('Client not connected');
    }

    const query = {
      estimate_swap: {
        token_in: tokenIn,
        routes: routes,
      },
    };

    const response = await (this.cosmosClient as SigningStargateClient & {
      queryContractSmart: (address: string, queryMsg: Record<string, unknown>) => Promise<SwapEstimateResponse>;
    }).queryContractSmart(
      this.htlcContractAddress,
      query
    ) as SwapEstimateResponse;

    return {
      tokenOutAmount: response.token_out_amount,
      priceImpact: response.price_impact,
      swapFee: response.swap_fee,
      routes: routes,
    };
  }

  /**
   * Find the best route between two tokens using the router contract
   */
  async findBestRoute(
    startDenom: string,
    endDenom: string,
    amountIn: string,
    maxHops?: number
  ): Promise<{
    routes: SwapRoute[][];
    estimatedOutput: string;
    totalFees: string;
    priceImpact: string;
  }> {
    if (!this.cosmosClient) {
      throw new Error('Client not connected');
    }

    const query = {
      find_best_route: {
        start_denom: startDenom,
        end_denom: endDenom,
        amount_in: amountIn,
        max_hops: maxHops,
      },
    };

    const response = await (this.cosmosClient as SigningStargateClient & {
      queryContractSmart: (address: string, queryMsg: Record<string, unknown>) => Promise<RouteResponse>;
    }).queryContractSmart(
      this.routerContractAddress,
      query
    ) as RouteResponse;

    return {
      routes: response.routes,
      estimatedOutput: response.estimated_output,
      totalFees: response.total_fees,
      priceImpact: response.price_impact,
    };
  }

  /**
   * Execute a swap for an existing HTLC
   */
  async executeSwapForHTLC(
    sender: string,
    htlcId: string,
    swapParams: HTLCSwapParams
  ): Promise<string> {
    if (!this.cosmosClient) {
      throw new Error('Client not connected');
    }

    const msg = {
      execute_swap_and_lock: {
        htlc_id: htlcId,
        swap_params: {
          routes: swapParams.routes,
          min_output_amount: swapParams.minOutputAmount,
          slippage_tolerance: swapParams.slippageTolerance.toString(),
        },
      },
    };

    const result = await (this.cosmosClient as SigningStargateClient & {
      execute: (sender: string, contractAddress: string, msg: Record<string, unknown>, fee: string) => Promise<{ transactionHash: string }>;
    }).execute(
      sender,
      this.htlcContractAddress,
      msg,
      'auto'
    );

    return result.transactionHash;
  }

  /**
   * Plan a cross-chain swap with optimal routing
   */
  async planCrossChainSwap(
    params: CrossChainSwapParams
  ): Promise<{
    htlcParams: HTLCParams;
    swapRoutes: SwapRoute[];
    estimatedOutput: string;
    totalFees: string;
    priceImpact: string;
  }> {
    // Get IBC denom for the source token
    const ibcDenom = this.getIBCDenom(params.sourceToken, params.sourceChain);

    // Find best route
    const routeInfo = await this.findBestRoute(
      ibcDenom,
      params.targetToken,
      params.sourceAmount,
      4 // max 4 hops
    );

    // Select best route (first one)
    const selectedRoute = routeInfo.routes[0] || [];

    // Verify output meets minimum requirement
    if (parseFloat(routeInfo.estimatedOutput) < parseFloat(params.minOutputAmount)) {
      throw new Error(
        `Insufficient output: ${routeInfo.estimatedOutput} < ${params.minOutputAmount}`
      );
    }

    // Calculate minimum output with slippage
    const slippage = params.slippageTolerance || 0.01; // 1% default
    const minOutputWithSlippage = Math.floor(parseFloat(routeInfo.estimatedOutput) * (1 - slippage)).toString();

    return {
      htlcParams: {
        receiver: params.receiver,
        amount: params.sourceAmount,
        hashlock: '', // This should be generated by the HTLC creation
        timelock: params.deadline,
        targetChain: params.targetChain,
        targetAddress: params.receiver,
      },
      swapRoutes: selectedRoute,
      estimatedOutput: routeInfo.estimatedOutput,
      totalFees: routeInfo.totalFees,
      priceImpact: routeInfo.priceImpact,
    };
  }

  /**
   * Monitor pool prices for arbitrage opportunities
   */
  async monitorArbitrage(
    tokenPairs: Array<{ tokenA: string; tokenB: string }>,
    callback: (opportunity: ArbitrageOpportunity) => void
  ): Promise<() => void> {
    const checkPrices = async () => {
      for (const pair of tokenPairs) {
        try {
          // Find all routes between the tokens
          const routeInfo = await this.findBestRoute(
            pair.tokenA,
            pair.tokenB,
            '1000000', // Test amount
            2 // Max 2 hops for arbitrage
          );

          // Check if there are multiple routes with price differences
          if (routeInfo.routes.length > 1) {
            const prices = await Promise.all(
              routeInfo.routes.map(async (route) => {
                const estimate = await this.estimateSwap(
                  { denom: pair.tokenA, amount: '1000000' },
                  route
                );
                return {
                  route,
                  price: (1000000 / parseFloat(estimate.tokenOutAmount)).toFixed(6),
                  output: estimate.tokenOutAmount,
                };
              })
            );

            // Find price differences
            const sortedPrices = prices.sort((a, b) => 
              parseFloat(a.price) - parseFloat(b.price)
            );

            const priceDiff = (parseFloat(sortedPrices[sortedPrices.length - 1].price) - parseFloat(sortedPrices[0].price)) / parseFloat(sortedPrices[0].price);

            if (priceDiff > 0.005) { // 0.5% arbitrage opportunity
              callback({
                tokenA: pair.tokenA,
                tokenB: pair.tokenB,
                priceDifference: priceDiff,
                profitEstimate: (priceDiff * 100).toFixed(2),
              });
            }
          }
        } catch (error) {
          // Silently continue on error - arbitrage monitoring should not crash
          // In production, this would be logged to a monitoring service
        }
      }
    };

    // Check immediately
    checkPrices();

    // Then check periodically
    const interval = setInterval(checkPrices, 30000); // Every 30 seconds

    // Return cleanup function
    return () => clearInterval(interval);
  }

  /**
   * Helper: Get IBC denom for a token from another chain
   */
  private getIBCDenom(token: string, sourceChain: string): string {
    // This would calculate the IBC denom based on the channel and original denom
    const ibcDenoms: Record<string, string> = {
      'ethereum:USDC': 'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858',
      'ethereum:ETH': 'ibc/EA1D43981D5C9A1C4AAEA9C23BB1D4FA126BA9BC7020A25E0AE4AA841EA25DC5',
      'ethereum:WBTC': 'ibc/D1542AA8762DB13087D8364F3EA6509FD6F009A34F00426AF9E4F9FA85CBBF1F',
      'cosmoshub:ATOM': 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
      'juno:JUNO': 'ibc/46B44899322F3CD854D2D46DEEF881958467CDD4B3B10086DA49296BBED94BED',
    };

    const key = `${sourceChain}:${token}`;
    return ibcDenoms[key] || token;
  }
}
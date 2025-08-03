import { SigningStargateClient } from '@cosmjs/stargate';
import { Coin } from '@cosmjs/amino';
import { ExecuteResult } from '@cosmjs/cosmwasm-stargate';

// Add proper type guard for client with queryContractSmart
interface CosmosClientWithQuery {
  queryContractSmart: (address: string, queryMsg: Record<string, unknown>) => Promise<unknown>;
}

function hasQueryContractSmart(client: unknown): client is CosmosClientWithQuery {
  return client !== null && 
         typeof client === 'object' && 
         'queryContractSmart' in client && 
         typeof (client as CosmosClientWithQuery).queryContractSmart === 'function';
}

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
    // Validate connection by checking if client is properly initialized
    if (!this.cosmosClient) {
      throw new Error('Failed to connect client');
    }
    // Add await to satisfy async requirement
    await Promise.resolve();
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
   * Query spot price for a pool
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

    if (!hasQueryContractSmart(this.cosmosClient)) {
      throw new Error('Client does not support queryContractSmart');
    }

    const query = {
      query_spot_price: {
        pool_id: parseInt(poolId),
        base_denom: baseAssetDenom,
        quote_denom: quoteAssetDenom,
      },
    };

    const response = await this.cosmosClient.queryContractSmart(
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

    if (!hasQueryContractSmart(this.cosmosClient)) {
      throw new Error('Client does not support queryContractSmart');
    }

    const query = {
      estimate_swap: {
        token_in: tokenIn,
        routes: routes,
      },
    };

    const response = await this.cosmosClient.queryContractSmart(
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

    if (!hasQueryContractSmart(this.cosmosClient)) {
      throw new Error('Client does not support queryContractSmart');
    }

    const query = {
      find_best_route: {
        start_denom: startDenom,
        end_denom: endDenom,
        amount_in: amountIn,
        max_hops: maxHops,
      },
    };

    const response = await this.cosmosClient.queryContractSmart(
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
    if (!this.cosmosClient) {
      throw new Error('Client not connected');
    }

    // Get best route for the swap
    const routeResult = await this.findBestRoute(
      params.sourceToken,
      params.targetToken,
      params.sourceAmount
    );

    // Create HTLC parameters
    const htlcParams: HTLCParams = {
      receiver: params.receiver,
      amount: params.sourceAmount,
      hashlock: '', // Will be generated by caller
      timelock: params.deadline,
      targetChain: params.targetChain,
      targetAddress: params.receiver
    };

    return {
      htlcParams,
      swapRoutes: routeResult.routes.flat(),
      estimatedOutput: routeResult.estimatedOutput,
      totalFees: routeResult.totalFees,
      priceImpact: routeResult.priceImpact
    };
  }

  /**
   * Monitor pool prices for arbitrage opportunities
   */
  async monitorArbitrage(
    tokenPairs: Array<{ tokenA: string; tokenB: string }>,
    callback: (opportunity: ArbitrageOpportunity) => void
  ): Promise<() => void> {
    const checkPrices = async (): Promise<void> => {
      for (const pair of tokenPairs) {
        try {
          // Get prices for both directions
          const priceAB = await this.querySpotPrice('1', pair.tokenA, pair.tokenB);
          const priceBA = await this.querySpotPrice('1', pair.tokenB, pair.tokenA);

          const priceABValue = parseFloat(priceAB.spotPrice);
          const priceBAValue = parseFloat(priceBA.spotPrice);

          // Calculate price difference
          const priceDifference = Math.abs(priceABValue - priceBAValue);
          const profitEstimate = (priceDifference * 1000).toString(); // Mock calculation

          if (priceDifference > 0.01) { // 1% threshold
            callback({
              tokenA: pair.tokenA,
              tokenB: pair.tokenB,
              priceDifference,
              profitEstimate
            });
          }
        } catch (error) {
          console.error(`Error checking prices for ${pair.tokenA}-${pair.tokenB}:`, error);
        }
      }
    };

    // Start monitoring
    const interval = setInterval(() => {
      void checkPrices();
    }, 30000); // Check every 30 seconds

    // Add await to satisfy async requirement
    await Promise.resolve();

    // Return cleanup function
    return () => {
      clearInterval(interval);
    };
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
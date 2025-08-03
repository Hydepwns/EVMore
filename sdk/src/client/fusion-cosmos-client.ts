import { ethers } from 'ethers';
import { SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { EthereumHTLCClient } from './ethereum-htlc-client';
import { CosmosHTLCClient } from './cosmos-htlc-client';
import { DexClient } from './dex-client';
// Local timelock configuration (imported from shared config in full implementation)
const DEFAULT_TIMELOCK_CONFIG = {
  maxTimelockDuration: 48 * 60 * 60, // 48 hours in seconds
  minTimelockDuration: 6 * 60 * 60,  // 6 hours in seconds
};
import {
  HTLCOrder,
  CrossChainSwapParams,
  SwapQuote,
  SwapStatus,
  LegacySwapStatus,
  ChainConfig,
  ChainType,
  TokenInfo,
  SwapRoute
} from '../types';
import {
  generateSecretPair,
  calculateTimelock,
  validateSwapParams,
  formatAmount,
  storage
} from '../utils';
import { validateCrossChainSwapParams, validateSecret, validateSwapStatus } from '../validation/enhanced-validation';
import { RequestThrottle, ThrottleConfig } from '../utils/request-throttle';

export interface FusionCosmosConfig {
  ethereum: {
    rpcUrl: string;
    htlcContract: string;
    resolverContract: string;
    privateKey?: string;
    chainId: number;
  };
  cosmos: {
    rpcUrl: string;
    restUrl: string;
    chainId: string;
    htlcContract: string;
    routerContract?: string;
    mnemonic?: string;
    addressPrefix: string;
    denom: string;
  };
  relayerUrl?: string;
}

export class FusionCosmosClient {
  private ethereumClient: EthereumHTLCClient;
  private requestThrottle: RequestThrottle;
  private cosmosClient: CosmosHTLCClient;
  private dexClient?: DexClient;
  private config: FusionCosmosConfig;

  constructor(config: FusionCosmosConfig, throttleConfig?: Partial<ThrottleConfig>) {
    this.config = config;
    this.ethereumClient = new EthereumHTLCClient(config.ethereum);
    this.cosmosClient = new CosmosHTLCClient(config.cosmos);
    
    // Initialize request throttle to prevent API abuse
    this.requestThrottle = new RequestThrottle({
      maxConcurrent: 5,
      queueLimit: 50,
      defaultDelay: 200,
      maxDelay: 10000,
      backoffMultiplier: 2,
      enableAdaptiveThrottling: true,
      ...throttleConfig
    });
    
    // Initialize DEX client if router contract is provided
    if (config.cosmos.routerContract) {
      this.dexClient = new DexClient(
        config.cosmos.htlcContract,
        config.cosmos.routerContract
      );
    }
  }

  /**
   * Create a cross-chain swap from Ethereum to Cosmos
   * @param params - Swap parameters
   * @returns Promise resolving to the created order
   */
  async createEthereumToCosmosSwap(params: CrossChainSwapParams): Promise<HTLCOrder> {
    // Enhanced validation with sanitization
    const validation = validateCrossChainSwapParams(params);
    if (!validation.valid) {
      throw new Error(`Invalid swap parameters: ${validation.errors.join(', ')}`);
    }
    
    // Use sanitized parameters
    const sanitizedParams = validation.sanitized!;

    // Generate secret pair
    const { secret, hash } = generateSecretPair();

    // Calculate timelock (using configured max timelock for Ethereum side)
    const timelock = calculateTimelock(DEFAULT_TIMELOCK_CONFIG.maxTimelockDuration);

    // Create HTLC on Ethereum with throttling
    const htlcId = await this.requestThrottle.execute(
      () => this.ethereumClient.createHTLC({
        token: params.fromToken,
        amount: params.fromAmount,
        hashlock: hash,
        timelock,
        targetChain: params.toChain,
        targetAddress: params.toAddress
      }),
      { priority: 'high', timeout: 30000 }
    );

    const order: HTLCOrder = {
      id: htlcId,
      htlcId: htlcId,
      maker: await this.ethereumClient.getAddress(),
      fromToken: params.fromToken,
      fromAmount: params.fromAmount,
      toToken: params.toToken,
      toAmount: '0', // Will be filled by relayer
      fromChain: params.fromChain,
      toChain: params.toChain,
      secretHash: hash,
      timelock,
      status: 'pending',
      createdAt: Math.floor(Date.now() / 1000)
    };

    // Store secret securely (in production, use secure storage)
    this.storeSecret(htlcId, secret);

    return order;
  }

  /**
   * Create a cross-chain swap from Cosmos to Ethereum
   * @param params - Swap parameters
   * @returns Promise resolving to the created order
   */
  async createCosmosToEthereumSwap(params: CrossChainSwapParams): Promise<HTLCOrder> {
    // Validate parameters
    const validation = validateSwapParams(params);
    if (!validation.valid) {
      throw new Error(`Invalid swap parameters: ${validation.errors.join(', ')}`);
    }

    // Generate secret pair
    const { secret, hash } = generateSecretPair();

    // Calculate timelock (24 hours for Cosmos side to allow Ethereum settlement)
    const timelock = calculateTimelock(24 * 60 * 60);

    // Create HTLC on Cosmos
    const htlcId = await this.cosmosClient.createHTLC({
      receiver: params.toAddress,
      amount: params.fromAmount,
      denom: this.config.cosmos.denom,
      hashlock: hash,
      timelock,
      targetChain: params.toChain,
      targetAddress: params.toAddress
    });

    const order: HTLCOrder = {
      id: htlcId,
      htlcId: htlcId,
      maker: await this.cosmosClient.getAddress(),
      fromToken: params.fromToken,
      fromAmount: params.fromAmount,
      toToken: params.toToken,
      toAmount: '0', // Will be filled by relayer
      fromChain: params.fromChain,
      toChain: params.toChain,
      secretHash: hash,
      timelock,
      status: 'pending',
      createdAt: Math.floor(Date.now() / 1000)
    };

    // Store secret securely
    this.storeSecret(htlcId, secret);

    return order;
  }

  /**
   * Get a quote for a cross-chain swap
   * @param params - Swap parameters
   * @returns Promise resolving to the swap quote
   */
  async getQuote(params: CrossChainSwapParams): Promise<SwapQuote> {
    // In a full implementation, this would:
    // 1. Query DEX prices on target chain
    // 2. Calculate optimal routing
    // 3. Estimate fees and gas costs
    // 4. Account for slippage

    // Simplified mock implementation
    const fromAmount = parseFloat(params.fromAmount);
    const estimatedToAmount = fromAmount * 0.99; // 1% fee
    const minimumReceived = estimatedToAmount * (1 - (params.slippageTolerance || 0.5) / 100);

    return {
      fromAmount: params.fromAmount,
      toAmount: estimatedToAmount.toString(),
      minimumReceived: minimumReceived.toString(),
      priceImpact: 0.1, // 0.1%
      estimatedGas: '200000',
      route: [{
        hopIndex: 0,
        fromChain: params.fromChain,
        toChain: params.toChain,
        fromToken: params.fromToken,
        toToken: params.toToken,
        expectedAmount: estimatedToAmount.toString(),
        minimumAmount: minimumReceived.toString()
      }],
      fees: {
        networkFee: '0.01',
        protocolFee: '0.001',
        relayerFee: '0.005',
        total: '0.016'
      },
      estimatedExecutionTime: 300, // 5 minutes in seconds
      slippageTolerance: params.slippageTolerance || 0.5,
      deadline: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    };
  }

  /**
   * Get the status of a swap
   * @param htlcId - HTLC ID to check
   * @param sourceChain - The source chain ('ethereum' or 'cosmos')
   * @returns Promise resolving to the swap status
   */
  async getSwapStatus(htlcId: string, sourceChain: 'ethereum' | 'cosmos'): Promise<{ id: string; status: LegacySwapStatus; error?: string; updatedAt: number }> {
    try {
      let htlcDetails;

      if (sourceChain === 'ethereum') {
        htlcDetails = await this.requestThrottle.execute(
          () => this.ethereumClient.getHTLC(htlcId),
          { priority: 'medium', timeout: 15000 }
        );
      } else {
        htlcDetails = await this.requestThrottle.execute(
          () => this.cosmosClient.getHTLC(htlcId),
          { priority: 'medium', timeout: 15000 }
        );
      }

      if (!htlcDetails) {
        return {
          id: htlcId,
          status: 'failed',
          error: 'HTLC not found',
          updatedAt: Math.floor(Date.now() / 1000)
        };
      }

      let status: LegacySwapStatus = 'pending';

      if (htlcDetails.withdrawn) {
        status = 'completed';
      } else if (htlcDetails.refunded) {
        status = 'failed';
      } else if (htlcDetails.timelock < Math.floor(Date.now() / 1000)) {
        status = 'expired';
      }

      return {
        id: htlcId,
        status,
        updatedAt: Math.floor(Date.now() / 1000)
      };

    } catch (error) {
      return {
        id: htlcId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: Math.floor(Date.now() / 1000)
      };
    }
  }

  /**
   * Withdraw from an HTLC using the secret
   * @param htlcId - HTLC ID
   * @param secret - The secret to reveal
   * @param targetChain - The target chain where HTLC is deployed
   * @returns Promise resolving to transaction hash
   */
  async withdraw(htlcId: string, secret: string, targetChain: 'ethereum' | 'cosmos'): Promise<string> {
    if (targetChain === 'ethereum') {
      return this.ethereumClient.withdraw(htlcId, secret);
    } else {
      return this.cosmosClient.withdraw(htlcId, secret);
    }
  }

  /**
   * Refund an expired HTLC
   * @param htlcId - HTLC ID
   * @param sourceChain - The source chain where HTLC was created
   * @returns Promise resolving to transaction hash
   */
  async refund(htlcId: string, sourceChain: 'ethereum' | 'cosmos'): Promise<string> {
    if (sourceChain === 'ethereum') {
      return this.ethereumClient.refund(htlcId);
    } else {
      return this.cosmosClient.refund(htlcId);
    }
  }

  /**
   * Get supported tokens for a chain
   * @param chainId - Chain identifier
   * @returns Promise resolving to list of supported tokens
   */
  async getSupportedTokens(chainId: string): Promise<TokenInfo[]> {
    // Mock implementation - in production this would query token registries
    const tokensByChain: Record<string, TokenInfo[]> = {
      '1': [
        {
          address: '0xA0b86a33E6417c3c56B5a6C7D7c7d3d5c2A8C2A8',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          chainId: '1'
        },
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          symbol: 'USDT',
          name: 'Tether USD',
          decimals: 6,
          chainId: '1'
        }
      ],
      'cosmoshub-4': [
        {
          address: 'uatom',
          symbol: 'ATOM',
          name: 'Cosmos Hub Atom',
          decimals: 6,
          chainId: 'cosmoshub-4'
        }
      ],
      'osmosis-1': [
        {
          address: 'uosmo',
          symbol: 'OSMO',
          name: 'Osmosis',
          decimals: 6,
          chainId: 'osmosis-1'
        }
      ]
    };

    return tokensByChain[chainId] || [];
  }

  /**
   * Get supported chains
   * @returns List of supported chain configurations
   */
  getSupportedChains(): ChainConfig[] {
    return [
      {
        chainId: '1',
        name: 'Ethereum Mainnet',
        type: ChainType.ETHEREUM,
        rpcUrl: this.config.ethereum.rpcUrl,
        htlcContract: this.config.ethereum.htlcContract,
        nativeDenom: 'ETH',
        blockTime: 12,
        confirmations: 12,
        gasConfig: {
          maxGasLimit: 8000000,
          gasPrice: '20000000000' // 20 gwei
        }
      },
      {
        chainId: this.config.cosmos.chainId,
        name: 'Cosmos Hub',
        type: ChainType.COSMOS,
        rpcUrl: this.config.cosmos.rpcUrl,
        restUrl: this.config.cosmos.restUrl,
        htlcContract: this.config.cosmos.htlcContract,
        nativeDenom: this.config.cosmos.denom,
        addressPrefix: this.config.cosmos.addressPrefix,
        blockTime: 6,
        confirmations: 1,
        gasConfig: {
          maxGasLimit: 500000,
          gasPrice: '0.025' + this.config.cosmos.denom
        }
      }
    ];
  }

  /**
   * Store secret securely (mock implementation)
   * @param htlcId - HTLC ID
   * @param secret - Secret to store
   */
  private storeSecret(htlcId: string, secret: string): void {
    // In production, this should use secure storage (encrypted, hardware wallet, etc.)
    storage.setItem(`htlc_secret_${htlcId}`, secret);
  }

  /**
   * Retrieve stored secret (mock implementation)
   * @param htlcId - HTLC ID
   * @returns The stored secret or null
   */
  private getSecret(htlcId: string): string | null {
    return storage.getItem(`htlc_secret_${htlcId}`);
  }

  /**
   * Get the Ethereum client instance
   * @returns EthereumHTLCClient instance
   */
  getEthereumClient(): EthereumHTLCClient {
    return this.ethereumClient;
  }

  /**
   * Get the Cosmos client instance
   * @returns CosmosHTLCClient instance
   */
  getCosmosClient(): CosmosHTLCClient {
    return this.cosmosClient;
  }

  /**
   * Get the DEX client instance
   * @returns DexClient instance or undefined if not configured
   */
  getDexClient(): DexClient | undefined {
    return this.dexClient;
  }

  /**
   * Initialize DEX client connection
   */
  async connectDexClient(cosmosClient: SigningStargateClient): Promise<void> {
    if (!this.dexClient) {
      throw new Error('DEX client not configured. Please provide routerContract in config.');
    }
    await this.dexClient.connect(cosmosClient);
  }

  /**
   * Create a cross-chain swap with DEX integration
   * @param params - Swap parameters including DEX routes
   */
  async createCrossChainSwapWithDEX(params: {
    sourceChain: 'ethereum' | 'cosmos';
    sourceToken: string;
    sourceAmount: string;
    targetChain: string;
    targetToken: string;
    minOutputAmount: string;
    slippageTolerance?: number;
    receiver: string;
    deadline?: number;
  }): Promise<HTLCOrder> {
    if (!this.dexClient) {
      throw new Error('DEX client not configured');
    }

    // Generate secret pair
    const { secret, hash } = generateSecretPair();

    // Calculate timelocks
    const currentTime = Math.floor(Date.now() / 1000);
    const deadline = params.deadline || currentTime + 3600; // 1 hour default
    const sourceTimelock = deadline;
    const targetTimelock = deadline - 1800; // 30 minutes less

    // Plan the cross-chain swap with DEX routing
    const swapPlan = await this.dexClient.planCrossChainSwap({
      sourceChain: params.sourceChain,
      sourceToken: params.sourceToken,
      sourceAmount: params.sourceAmount,
      targetChain: params.targetChain,
      targetToken: params.targetToken,
      minOutputAmount: params.minOutputAmount,
      slippageTolerance: params.slippageTolerance,
      receiver: params.receiver,
      deadline: sourceTimelock,
    });

    // Create HTLC based on source chain
    let htlcId: string;
    let txHash: string;

    if (params.sourceChain === 'ethereum') {
      // Create Ethereum HTLC
      const result = await this.ethereumClient.createHTLC({
        token: params.sourceToken,
        amount: params.sourceAmount,
        hashlock: hash,
        timelock: sourceTimelock,
        targetChain: params.targetChain,
        targetAddress: params.receiver,
      });
      htlcId = result;
      txHash = 'pending';
    } else {
      // Create Cosmos HTLC with swap parameters
      const senderAddress = await this.cosmosClient.getAddress();
      txHash = await this.dexClient.createHTLCWithSwap(
        senderAddress,
        params.receiver,
        {
          denom: params.sourceToken,
          amount: params.sourceAmount,
        },
        hash,
        sourceTimelock,
        params.targetChain,
        params.receiver,
        {
          routes: swapPlan.swapRoutes,
          minOutputAmount: params.minOutputAmount,
          slippageTolerance: params.slippageTolerance || 0.01,
        }
      );
      // Extract HTLC ID from transaction
      htlcId = `cosmos_${txHash.slice(0, 16)}`;
    }

    // Store secret securely
    this.storeSecret(htlcId, secret);

    return {
      id: htlcId,
      htlcId,
      sourceChain: params.sourceChain,
      targetChain: params.targetChain,
      sender: params.sourceChain === 'ethereum' 
        ? await this.ethereumClient.getAddress()
        : await this.cosmosClient.getAddress(),
      receiver: params.receiver,
      amount: params.sourceAmount,
      token: params.sourceToken,
      targetToken: params.targetToken,
      hashlock: hash,
      timelock: sourceTimelock,
      secret,
      status: 'pending',
      createdAt: new Date(),
      txHash,
      swapRoutes: swapPlan.swapRoutes,
      estimatedOutput: swapPlan.estimatedOutput,
      priceImpact: swapPlan.priceImpact,
    };
  }

  /**
   * Get spot price from DEX
   */
  async getSpotPrice(
    poolId: string,
    baseAssetDenom: string,
    quoteAssetDenom: string
  ): Promise<{
    spotPrice: string;
    tokenInDenom: string;
    tokenOutDenom: string;
  }> {
    if (!this.dexClient) {
      throw new Error('DEX client not configured');
    }
    return this.dexClient.querySpotPrice(poolId, baseAssetDenom, quoteAssetDenom);
  }

  /**
   * Estimate swap output with DEX routing
   */
  async estimateSwapOutput(
    tokenIn: { denom: string; amount: string },
    targetToken: string,
    maxHops?: number
  ): Promise<{
    routes: SwapRoute[];
    estimatedOutput: string;
    priceImpact: string;
    totalFees: string;
  }> {
    if (!this.dexClient) {
      throw new Error('DEX client not configured');
    }

    const routeInfo = await this.dexClient.findBestRoute(
      tokenIn.denom,
      targetToken,
      tokenIn.amount,
      maxHops
    );

    return {
      routes: routeInfo.routes[0] || [],
      estimatedOutput: routeInfo.estimatedOutput,
      priceImpact: routeInfo.priceImpact,
      totalFees: routeInfo.totalFees,
    };
  }

  /**
   * Monitor arbitrage opportunities
   */
  async monitorArbitrage(
    tokenPairs: Array<{ tokenA: string; tokenB: string }>,
    callback: (opportunity: { tokenA: string; tokenB: string; priceDifference: number; profitEstimate: string }) => void
  ): Promise<() => void> {
    if (!this.dexClient) {
      throw new Error('DEX client not configured');
    }
    return this.dexClient.monitorArbitrage(tokenPairs, callback);
  }

  /**
   * Get request throttle statistics
   * @returns Current throttle stats
   */
  getThrottleStats() {
    return this.requestThrottle.getStats();
  }

  /**
   * Update throttle configuration
   * @param config - New throttle configuration
   */
  updateThrottleConfig(config: Partial<ThrottleConfig>): void {
    this.requestThrottle.updateConfig(config);
  }

  /**
   * Reset throttle state (emergency)
   */
  resetThrottle(): void {
    this.requestThrottle.reset();
  }

  /**
   * Clear request queue (emergency)
   */
  clearRequestQueue(): void {
    this.requestThrottle.clearQueue();
  }
}

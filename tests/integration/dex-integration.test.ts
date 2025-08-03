import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { OsmosisClient, SwapRoute } from '../../relayer/src/dex/osmosis-client';
import { DexIntegrationService } from '../../relayer/src/dex/dex-integration';
import { SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';

describe('DEX Integration Tests', () => {
  let osmosisClient: OsmosisClient;
  let dexService: DexIntegrationService;
  let wallet: DirectSecp256k1HdWallet;
  let signer: string;

  // Test configuration
  const testConfig = {
    rpcEndpoint: process.env.OSMOSIS_RPC || 'https://rpc.osmosis.zone',
    chainId: 'osmosis-1',
    mnemonic: process.env.TEST_MNEMONIC || 'test test test test test test test test test test test junk',
    htlcContracts: {
      'osmosis-1': 'osmo1htlc...',
      'cosmoshub-4': 'cosmos1htlc...',
    }
  };

  beforeAll(async () => {
    // Initialize wallet
    wallet = await DirectSecp256k1HdWallet.fromMnemonic(testConfig.mnemonic, {
      prefix: 'osmo'
    });
    const accounts = await wallet.getAccounts();
    signer = accounts[0].address;

    // Initialize clients
    osmosisClient = new OsmosisClient(testConfig.rpcEndpoint, testConfig.chainId);
    await osmosisClient.connect(wallet);

    dexService = new DexIntegrationService(
      testConfig.rpcEndpoint,
      testConfig.htlcContracts
    );
    await dexService.initialize();
  });

  describe('OsmosisClient', () => {
    it('should query spot price between ATOM and OSMO', async () => {
      const spotPrice = await osmosisClient.querySpotPrice(
        '1', // ATOM/OSMO pool
        'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2', // ATOM
        'uosmo'
      );

      expect(spotPrice).toBeDefined();
      expect(spotPrice.spotPrice).toBeDefined();
      expect(parseFloat(spotPrice.spotPrice)).toBeGreaterThan(0);
    });

    it('should estimate swap output', async () => {
      const tokenIn = {
        denom: 'uosmo',
        amount: '1000000', // 1 OSMO
      };

      const routes: SwapRoute[] = [{
        poolId: '1',
        tokenOutDenom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2', // ATOM
      }];

      const estimate = await osmosisClient.estimateSwap(tokenIn, routes);

      expect(estimate).toBeDefined();
      expect(estimate.tokenOutAmount).toBeDefined();
      expect(parseFloat(estimate.tokenOutAmount)).toBeGreaterThan(0);
      expect(parseFloat(estimate.priceImpact)).toBeLessThan(0.01); // Less than 1% for small amount
    });

    it('should find best route between tokens', async () => {
      const routes = await osmosisClient.findBestRoute(
        'uosmo',
        'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2', // ATOM
        '1000000'
      );

      expect(routes).toBeDefined();
      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0].poolId).toBeDefined();
    });

    it('should get pool information', async () => {
      const poolInfo = await osmosisClient.getPoolInfo('1');

      expect(poolInfo).toBeDefined();
      expect(poolInfo.poolId).toBe('1');
      expect(poolInfo.tokenDenoms).toContain('uosmo');
      expect(poolInfo.tokenDenoms).toContain('ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2');
      expect(poolInfo.swapFee).toBeDefined();
    });
  });

  describe('DexIntegrationService', () => {
    it('should plan a cross-chain swap', async () => {
      const swapParams = {
        sourceChain: 'ethereum',
        sourceToken: 'USDC',
        sourceAmount: '1000000000', // 1000 USDC
        targetChain: 'osmosis-1',
        targetToken: 'uosmo',
        minOutputAmount: '900000000', // 900 OSMO minimum
        receiver: signer,
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      };

      const plan = await dexService.planCrossChainSwap(swapParams);

      expect(plan).toBeDefined();
      expect(plan.htlcId).toBeDefined();
      expect(plan.swapRoutes).toBeDefined();
      expect(plan.swapRoutes.length).toBeGreaterThan(0);
      expect(parseFloat(plan.estimatedOutput)).toBeGreaterThan(parseFloat(swapParams.minOutputAmount));
      expect(parseFloat(plan.priceImpact)).toBeLessThan(0.05); // Less than 5%
    });

    it('should aggregate liquidity across multiple pools', async () => {
      const aggregation = await dexService.aggregateLiquidity(
        'uosmo',
        'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2', // ATOM
        '10000000' // 10 OSMO
      );

      expect(aggregation).toBeDefined();
      expect(aggregation.pools).toBeDefined();
      expect(aggregation.pools.length).toBeGreaterThan(0);
      expect(aggregation.totalLiquidity).toBeDefined();
      expect(parseFloat(aggregation.totalLiquidity)).toBeGreaterThan(0);
      expect(aggregation.weightedAveragePrice).toBeDefined();
    });

    it('should monitor prices for execution', async () => {
      const routes: SwapRoute[] = [{
        poolId: '1',
        tokenOutDenom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
      }];

      let priceUpdateReceived = false;
      
      const cleanup = await dexService.monitorPricesForExecution(
        routes,
        '0.1', // Target price
        (priceUpdate) => {
          expect(priceUpdate).toBeDefined();
          expect(priceUpdate.currentPrice).toBeDefined();
          expect(priceUpdate.targetPrice).toBe('0.1');
          expect(priceUpdate.shouldExecute).toBeDefined();
          priceUpdateReceived = true;
        }
      );

      // Wait for at least one price update
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(priceUpdateReceived).toBe(true);
      
      // Cleanup
      if (cleanup) cleanup();
    });
  });

  describe('HTLC with DEX Integration', () => {
    it('should create HTLC with swap parameters', async () => {
      // This test would interact with the actual HTLC contract
      // For now, we'll test the planning phase
      
      const swapParams = {
        sourceChain: 'ethereum',
        sourceToken: 'ETH',
        sourceAmount: '1000000000000000000', // 1 ETH
        targetChain: 'osmosis-1',
        targetToken: 'uatom',
        minOutputAmount: '100000000', // 100 ATOM minimum
        receiver: signer,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      const plan = await dexService.planCrossChainSwap(swapParams);
      
      // Verify the plan includes multi-hop routes if needed
      expect(plan.swapRoutes).toBeDefined();
      
      // Check if routes go through intermediate tokens
      const hasMultiHop = plan.swapRoutes.length > 1;
      if (hasMultiHop) {
        // Verify intermediate token is liquid (like OSMO)
        const intermediateTokens = plan.swapRoutes.slice(0, -1).map(r => r.tokenOutDenom);
        expect(intermediateTokens.some(t => t === 'uosmo')).toBe(true);
      }
    });
  });

  afterAll(async () => {
    // Cleanup connections
  });
});

describe('Multi-Hop Routing Tests', () => {
  let dexService: DexIntegrationService;

  beforeAll(async () => {
    dexService = new DexIntegrationService(
      'https://rpc.osmosis.zone',
      {
        'osmosis-1': 'osmo1htlc...',
        'juno-1': 'juno1htlc...',
        'cosmoshub-4': 'cosmos1htlc...',
      }
    );
    await dexService.initialize();
  });

  it('should find optimal route through multiple DEXs', async () => {
    // Test finding route from a less liquid token to another
    // This should go through multiple hops
    
    const swapParams = {
      sourceChain: 'juno-1',
      sourceToken: 'ujuno',
      sourceAmount: '1000000', // 1 JUNO
      targetChain: 'osmosis-1',
      targetToken: 'ibc/1542F8DC70E7999691E991E1EDEB1B47E65E3A217B1649D347098EE48ACB580F', // Some IBC token
      minOutputAmount: '900000',
      receiver: 'osmo1...',
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    const plan = await dexService.planCrossChainSwap(swapParams);
    
    // Should find a route, likely through OSMO or ATOM
    expect(plan.swapRoutes.length).toBeGreaterThanOrEqual(2);
    
    // Verify price impact is reasonable for multi-hop
    expect(parseFloat(plan.priceImpact)).toBeLessThan(0.1); // Less than 10%
  });

  it('should handle slippage protection across multiple hops', async () => {
    const swapParams = {
      sourceChain: 'ethereum',
      sourceToken: 'WBTC',
      sourceAmount: '10000000', // 0.1 WBTC
      targetChain: 'osmosis-1',
      targetToken: 'uatom',
      minOutputAmount: '1000000000', // High minimum to test slippage
      receiver: 'osmo1...',
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    try {
      await dexService.planCrossChainSwap(swapParams);
    } catch (error: any) {
      // Should fail if output is insufficient
      expect(error.message).toContain('Insufficient output');
    }
  });
});
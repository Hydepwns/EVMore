import { FusionCosmosClient } from '../src/client/fusion-cosmos-client';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient } from '@cosmjs/stargate';

/**
 * Example: Cross-chain swap from Ethereum USDC to Osmosis ATOM using DEX integration
 */
async function crossChainSwapWithDEX() {
  // Initialize the client with DEX support
  const client = new FusionCosmosClient({
    ethereum: {
      rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
      htlcContract: '0x...', // Your Ethereum HTLC contract
      resolverContract: '0x...', // Your resolver contract
      privateKey: process.env.ETH_PRIVATE_KEY!,
      chainId: 1,
    },
    cosmos: {
      rpcUrl: 'https://rpc.osmosis.zone',
      restUrl: 'https://rest.osmosis.zone',
      chainId: 'osmosis-1',
      htlcContract: 'osmo1...', // Your Osmosis HTLC contract
      routerContract: 'osmo1...', // Your router contract for DEX
      mnemonic: process.env.COSMOS_MNEMONIC!,
      addressPrefix: 'osmo',
      denom: 'uosmo',
    },
  });

  // Initialize Cosmos wallet and connect DEX client
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
    process.env.COSMOS_MNEMONIC!,
    { prefix: 'osmo' }
  );
  const cosmosClient = await SigningStargateClient.connectWithSigner(
    'https://rpc.osmosis.zone',
    wallet
  );
  await client.connectDexClient(cosmosClient);

  try {
    // Example 1: Get spot price from Osmosis pools
    const spotPrice = await client.getSpotPrice(
      '1', // ATOM/OSMO pool
      'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2', // ATOM
      'uosmo'
    );
    console.log('Current ATOM/OSMO price:', spotPrice.spotPrice);

    // Example 2: Estimate swap output with routing
    const estimate = await client.estimateSwapOutput(
      {
        denom: 'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858', // USDC
        amount: '1000000000', // 1000 USDC
      },
      'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2', // ATOM
      3 // Max 3 hops
    );
    console.log('Estimated output:', estimate.estimatedOutput, 'ATOM');
    console.log('Price impact:', estimate.priceImpact);
    console.log('Routes:', estimate.routes);

    // Example 3: Create cross-chain swap with DEX integration
    const swapOrder = await client.createCrossChainSwapWithDEX({
      sourceChain: 'ethereum',
      sourceToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
      sourceAmount: '1000000000', // 1000 USDC
      targetChain: 'osmosis-1',
      targetToken: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2', // ATOM
      minOutputAmount: '90000000', // Minimum 90 ATOM
      slippageTolerance: 0.02, // 2% slippage
      receiver: 'osmo1...', // Receiver address on Osmosis
      deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour deadline
    });

    console.log('Swap order created:', {
      htlcId: swapOrder.htlcId,
      estimatedOutput: swapOrder.estimatedOutput,
      swapRoutes: swapOrder.swapRoutes,
      priceImpact: swapOrder.priceImpact,
    });

    // Example 4: Monitor arbitrage opportunities
    const stopMonitoring = await client.monitorArbitrage(
      [
        { tokenA: 'uosmo', tokenB: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2' }, // OSMO/ATOM
        { tokenA: 'uosmo', tokenB: 'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858' }, // OSMO/USDC
      ],
      (opportunity) => {
        console.log('Arbitrage opportunity found:', {
          pair: `${opportunity.tokenPair.tokenA}/${opportunity.tokenPair.tokenB}`,
          profit: `${opportunity.profitPercentage}%`,
          buyRoute: opportunity.buyRoute,
          sellRoute: opportunity.sellRoute,
        });
      }
    );

    // Stop monitoring after 5 minutes
    setTimeout(() => {
      stopMonitoring();
      console.log('Stopped arbitrage monitoring');
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example: Multi-hop routing through Osmosis pools
 */
async function multiHopRouting() {
  const client = new FusionCosmosClient({
    // ... config
  });

  const dexClient = client.getDexClient();
  if (!dexClient) {
    throw new Error('DEX client not configured');
  }

  // Find best route for exotic token pair
  const routeInfo = await dexClient.findBestRoute(
    'ibc/1542F8DC70E7999691E991E1EDEB1B47E65E3A217B1649D347098EE48ACB580F', // Some IBC token
    'ibc/D805F1DA50D31B96E4282C1D4181EDDFB1A44A598BFF5666F4B43E4B8BEA95A5', // Another IBC token
    '1000000',
    4 // Max 4 hops
  );

  console.log('Found routes:', routeInfo.routes);
  console.log('Best route estimated output:', routeInfo.estimatedOutput);
  
  // Execute the swap using the best route
  const htlcSwap = await dexClient.createHTLCWithSwap(
    'osmo1sender...',
    'osmo1receiver...',
    {
      denom: 'ibc/1542F8DC70E7999691E991E1EDEB1B47E65E3A217B1649D347098EE48ACB580F',
      amount: '1000000',
    },
    'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', // hashlock
    Math.floor(Date.now() / 1000) + 3600,
    'osmosis-1',
    'osmo1receiver...',
    {
      routes: routeInfo.routes[0], // Use best route
      minOutputAmount: routeInfo.estimatedOutput,
      slippageTolerance: 0.03, // 3% for multi-hop
    }
  );

  console.log('Multi-hop HTLC swap transaction:', htlcSwap);
}

/**
 * Example: Price discovery and liquidity aggregation
 */
async function priceDiscoveryExample() {
  const client = new FusionCosmosClient({
    // ... config
  });

  // Get prices from multiple pools for the same pair
  const pools = ['1', '704', '812']; // Different ATOM/OSMO pools
  
  const prices = await Promise.all(
    pools.map(async (poolId) => {
      try {
        const price = await client.getSpotPrice(
          poolId,
          'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
          'uosmo'
        );
        return { poolId, price: price.spotPrice };
      } catch (error) {
        return { poolId, price: 'N/A', error };
      }
    })
  );

  console.log('Price discovery across pools:', prices);

  // Find best execution price for large order
  const largeOrderEstimates = await Promise.all(
    pools.map(async (poolId) => {
      const estimate = await client.estimateSwapOutput(
        {
          denom: 'uosmo',
          amount: '10000000000', // 10k OSMO
        },
        'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
        1 // Direct swap only
      );
      return { poolId, ...estimate };
    })
  );

  // Sort by best output
  largeOrderEstimates.sort((a, b) => 
    parseInt(b.estimatedOutput) - parseInt(a.estimatedOutput)
  );

  console.log('Best pool for large order:', largeOrderEstimates[0]);
}

// Run examples
if (require.main === module) {
  crossChainSwapWithDEX()
    .then(() => multiHopRouting())
    .then(() => priceDiscoveryExample())
    .catch(console.error);
}
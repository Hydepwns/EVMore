import { ethers } from 'ethers';
import { SigningStargateClient } from '@cosmjs/stargate';
import { FusionCosmosClient, FusionCosmosConfig } from '../../src/client/fusion-cosmos-client';
import { EthereumHTLCClient } from '../../src/client/ethereum-htlc-client';
import { CosmosHTLCClient } from '../../src/client/cosmos-htlc-client';
import { DexClient } from '../../src/client/dex-client';
import { CrossChainSwapParams, HTLCOrder, SwapStatus } from '../../src/types';
import * as utils from '../../src/utils';
import * as enhancedValidation from '../../src/validation/enhanced-validation';

// Mock dependencies
jest.mock('../../src/client/ethereum-htlc-client');
jest.mock('../../src/client/cosmos-htlc-client');
jest.mock('../../src/client/dex-client');
jest.mock('../../src/utils');
jest.mock('../../src/validation/enhanced-validation');

describe('FusionCosmosClient', () => {
  let client: FusionCosmosClient;
  let mockEthereumClient: jest.Mocked<EthereumHTLCClient>;
  let mockCosmosClient: jest.Mocked<CosmosHTLCClient>;
  let mockDexClient: jest.Mocked<DexClient>;
  let config: FusionCosmosConfig;

  beforeEach(() => {
    // Setup config
    config = {
      ethereum: {
        rpcUrl: 'http://localhost:8545',
        htlcContract: '0xethhtlc',
        resolverContract: '0xresolver',
        privateKey: '0xprivatekey',
        chainId: 1,
      },
      cosmos: {
        rpcUrl: 'http://localhost:26657',
        restUrl: 'http://localhost:1317',
        chainId: 'cosmoshub-4',
        htlcContract: 'cosmos1htlc',
        routerContract: 'cosmos1router',
        mnemonic: 'test mnemonic',
        addressPrefix: 'cosmos',
        denom: 'uatom',
      },
      relayerUrl: 'http://localhost:3000',
    };

    // Mock client instances
    mockEthereumClient = {
      createHTLC: jest.fn(),
      getHTLC: jest.fn(),
      withdraw: jest.fn(),
      refund: jest.fn(),
      getAddress: jest.fn(),
    } as any;

    mockCosmosClient = {
      createHTLC: jest.fn(),
      getHTLC: jest.fn(),
      withdraw: jest.fn(),
      refund: jest.fn(),
      getAddress: jest.fn(),
    } as any;

    mockDexClient = {
      connect: jest.fn(),
      planCrossChainSwap: jest.fn(),
      createHTLCWithSwap: jest.fn(),
      querySpotPrice: jest.fn(),
      findBestRoute: jest.fn(),
      monitorArbitrage: jest.fn(),
    } as any;

    // Mock constructors
    (EthereumHTLCClient as jest.MockedClass<typeof EthereumHTLCClient>).mockImplementation(
      () => mockEthereumClient
    );
    (CosmosHTLCClient as jest.MockedClass<typeof CosmosHTLCClient>).mockImplementation(
      () => mockCosmosClient
    );
    (DexClient as jest.MockedClass<typeof DexClient>).mockImplementation(
      () => mockDexClient
    );

    // Mock utils
    (utils.validateSwapParams as jest.Mock).mockReturnValue({ valid: true, errors: [] });
    (utils.generateSecretPair as jest.Mock).mockReturnValue({
      secret: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    });
    (utils.calculateTimelock as jest.Mock).mockImplementation((seconds) => 
      Math.floor(Date.now() / 1000) + seconds
    );

    // Mock enhanced validation - will be set up per test
    (enhancedValidation.validateCrossChainSwapParams as jest.Mock).mockReturnValue({ 
      valid: true, 
      errors: [],
      sanitized: null // Will be set in individual tests
    });

    client = new FusionCosmosClient(config);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize clients with correct config', () => {
      expect(EthereumHTLCClient).toHaveBeenCalledWith(config.ethereum);
      expect(CosmosHTLCClient).toHaveBeenCalledWith(config.cosmos);
      expect(DexClient).toHaveBeenCalledWith(
        config.cosmos.htlcContract,
        config.cosmos.routerContract
      );
    });

    it('should not create DEX client if router contract not provided', () => {
      jest.clearAllMocks();
      
      const configWithoutRouter = {
        ...config,
        cosmos: { ...config.cosmos, routerContract: undefined },
      };

      new FusionCosmosClient(configWithoutRouter);

      expect(DexClient).not.toHaveBeenCalled();
    });
  });

  describe('createEthereumToCosmosSwap', () => {
    const swapParams: CrossChainSwapParams = {
      fromChain: 'ethereum',
      toChain: 'cosmoshub-4',
      fromToken: '0xusdc',
      toToken: 'uatom',
      fromAmount: '1000000',
      toAddress: 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a',
      slippageTolerance: 0.5,
    };

    it('should create a swap from Ethereum to Cosmos', async () => {
      // Mock enhanced validation to return sanitized params
      (enhancedValidation.validateCrossChainSwapParams as jest.Mock).mockReturnValue({ 
        valid: true, 
        errors: [],
        sanitized: swapParams
      });

      mockEthereumClient.createHTLC.mockResolvedValue('htlc123');
      mockEthereumClient.getAddress.mockResolvedValue('0xmaker');

      const order = await client.createEthereumToCosmosSwap(swapParams);

      expect(enhancedValidation.validateCrossChainSwapParams).toHaveBeenCalledWith(swapParams);
      expect(utils.generateSecretPair).toHaveBeenCalled();
      expect(utils.calculateTimelock).toHaveBeenCalledWith(48 * 60 * 60);

      expect(mockEthereumClient.createHTLC).toHaveBeenCalledWith({
        token: swapParams.fromToken,
        amount: swapParams.fromAmount,
        hashlock: expect.any(String),
        timelock: expect.any(Number),
        targetChain: swapParams.toChain,
        targetAddress: swapParams.toAddress,
      });

      expect(order).toMatchObject({
        id: 'htlc123',
        htlcId: 'htlc123',
        maker: '0xmaker',
        fromToken: swapParams.fromToken,
        fromAmount: swapParams.fromAmount,
        toToken: swapParams.toToken,
        fromChain: swapParams.fromChain,
        toChain: swapParams.toChain,
        secretHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        status: 'pending',
      });
    });

    it('should throw error for invalid parameters', async () => {
      (enhancedValidation.validateCrossChainSwapParams as jest.Mock).mockReturnValue({
        valid: false,
        errors: ['Invalid amount'],
      });

      await expect(client.createEthereumToCosmosSwap(swapParams)).rejects.toThrow(
        'Invalid swap parameters: Invalid amount'
      );
    });
  });

  describe('createCosmosToEthereumSwap', () => {
    const swapParams: CrossChainSwapParams = {
      fromChain: 'cosmoshub-4',
      toChain: 'ethereum',
      fromToken: 'uatom',
      toToken: '0xusdc',
      fromAmount: '1000000',
      toAddress: '0xreceiver',
      slippageTolerance: 0.5,
    };

    it('should create a swap from Cosmos to Ethereum', async () => {
      mockCosmosClient.createHTLC.mockResolvedValue('cosmos_htlc123');
      mockCosmosClient.getAddress.mockResolvedValue('cosmos1maker');

      const order = await client.createCosmosToEthereumSwap(swapParams);

      expect(mockCosmosClient.createHTLC).toHaveBeenCalledWith({
        receiver: swapParams.toAddress,
        amount: swapParams.fromAmount,
        denom: config.cosmos.denom,
        hashlock: expect.any(String),
        timelock: expect.any(Number),
        targetChain: swapParams.toChain,
        targetAddress: swapParams.toAddress,
      });

      expect(order).toMatchObject({
        id: 'cosmos_htlc123',
        htlcId: 'cosmos_htlc123',
        maker: 'cosmos1maker',
        fromToken: swapParams.fromToken,
        fromAmount: swapParams.fromAmount,
        toToken: swapParams.toToken,
        status: 'pending',
      });
    });
  });

  describe('getQuote', () => {
    it('should return a quote for the swap', async () => {
      const swapParams: CrossChainSwapParams = {
        fromChain: 'ethereum',
        toChain: 'cosmoshub-4',
        fromToken: '0xusdc',
        toToken: 'uatom',
        fromAmount: '1000',
        toAddress: 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a',
        slippageTolerance: 0.5,
      };

      const quote = await client.getQuote(swapParams);

      expect(quote).toMatchObject({
        fromAmount: '1000',
        toAmount: '990', // 1% fee
        minimumReceived: expect.any(String),
        priceImpact: 0.1,
        estimatedGas: '200000',
        route: [{
          hopIndex: 0,
          fromChain: 'ethereum',
          toChain: 'cosmoshub-4',
          fromToken: '0xusdc',
          toToken: 'uatom',
          expectedAmount: '990',
          minimumAmount: expect.any(String)
        }],
      });
    });
  });

  describe('getSwapStatus', () => {
    it('should return completed status for withdrawn HTLC', async () => {
      mockEthereumClient.getHTLC.mockResolvedValue({
        htlcId: 'htlc123',
        sender: '0xsender',
        receiver: '0xreceiver',
        token: '0xtoken',
        amount: '1000',
        hashlock: '0xhash',
        timelock: Math.floor(Date.now() / 1000) + 3600,
        withdrawn: true,
        refunded: false,
        targetChain: 'cosmos',
        targetAddress: 'cosmos1receiver',
      });

      const status = await client.getSwapStatus('htlc123', 'ethereum');

      expect(status).toMatchObject({
        id: 'htlc123',
        status: 'completed',
      });
    });

    it('should return failed status for refunded HTLC', async () => {
      mockCosmosClient.getHTLC.mockResolvedValue({
        htlcId: 'htlc123',
        sender: 'cosmos1sender',
        receiver: 'cosmos1receiver',
        token: 'uatom',
        amount: '1000',
        hashlock: '0xhash',
        timelock: Math.floor(Date.now() / 1000) + 3600,
        withdrawn: false,
        refunded: true,
        targetChain: 'ethereum',
        targetAddress: '0xreceiver',
      });

      const status = await client.getSwapStatus('htlc123', 'cosmos');

      expect(status).toMatchObject({
        id: 'htlc123',
        status: 'failed',
      });
    });

    it('should return expired status for expired HTLC', async () => {
      mockEthereumClient.getHTLC.mockResolvedValue({
        htlcId: 'htlc123',
        sender: '0xsender',
        receiver: '0xreceiver',
        token: '0xtoken',
        amount: '1000',
        hashlock: '0xhash',
        timelock: Math.floor(Date.now() / 1000) - 3600, // Expired
        withdrawn: false,
        refunded: false,
        targetChain: 'cosmos',
        targetAddress: 'cosmos1receiver',
      });

      const status = await client.getSwapStatus('htlc123', 'ethereum');

      expect(status).toMatchObject({
        id: 'htlc123',
        status: 'expired',
      });
    });

    it('should handle HTLC not found', async () => {
      mockEthereumClient.getHTLC.mockResolvedValue(null);

      const status = await client.getSwapStatus('htlc123', 'ethereum');

      expect(status).toMatchObject({
        id: 'htlc123',
        status: 'failed',
        error: 'HTLC not found',
      });
    });
  });

  describe('withdraw', () => {
    it('should withdraw from Ethereum HTLC', async () => {
      mockEthereumClient.withdraw.mockResolvedValue('0xtxhash');

      const txHash = await client.withdraw('htlc123', '0xsecret', 'ethereum');

      expect(mockEthereumClient.withdraw).toHaveBeenCalledWith('htlc123', '0xsecret');
      expect(txHash).toBe('0xtxhash');
    });

    it('should withdraw from Cosmos HTLC', async () => {
      mockCosmosClient.withdraw.mockResolvedValue('cosmos_txhash');

      const txHash = await client.withdraw('htlc123', '0xsecret', 'cosmos');

      expect(mockCosmosClient.withdraw).toHaveBeenCalledWith('htlc123', '0xsecret');
      expect(txHash).toBe('cosmos_txhash');
    });
  });

  describe('refund', () => {
    it('should refund Ethereum HTLC', async () => {
      mockEthereumClient.refund.mockResolvedValue('0xtxhash');

      const txHash = await client.refund('htlc123', 'ethereum');

      expect(mockEthereumClient.refund).toHaveBeenCalledWith('htlc123');
      expect(txHash).toBe('0xtxhash');
    });

    it('should refund Cosmos HTLC', async () => {
      mockCosmosClient.refund.mockResolvedValue('cosmos_txhash');

      const txHash = await client.refund('htlc123', 'cosmos');

      expect(mockCosmosClient.refund).toHaveBeenCalledWith('htlc123');
      expect(txHash).toBe('cosmos_txhash');
    });
  });

  describe('getSupportedTokens', () => {
    it('should return supported tokens for Ethereum', async () => {
      const tokens = await client.getSupportedTokens('1');

      expect(tokens).toHaveLength(2);
      expect(tokens[0]).toMatchObject({
        symbol: 'USDC',
        chainId: '1',
      });
    });

    it('should return empty array for unsupported chain', async () => {
      const tokens = await client.getSupportedTokens('unsupported');

      expect(tokens).toEqual([]);
    });
  });

  describe('getSupportedChains', () => {
    it('should return configured chains', () => {
      const chains = client.getSupportedChains();

      expect(chains).toHaveLength(2);
      expect(chains[0]).toMatchObject({
        chainId: '1',
        name: 'Ethereum Mainnet',
        htlcContract: config.ethereum.htlcContract,
      });
      expect(chains[1]).toMatchObject({
        chainId: config.cosmos.chainId,
        name: 'Cosmos Hub',
        htlcContract: config.cosmos.htlcContract,
      });
    });
  });

  describe('getters', () => {
    it('should return ethereum client', () => {
      expect(client.getEthereumClient()).toBe(mockEthereumClient);
    });

    it('should return cosmos client', () => {
      expect(client.getCosmosClient()).toBe(mockCosmosClient);
    });

    it('should return dex client', () => {
      expect(client.getDexClient()).toBe(mockDexClient);
    });
  });

  describe('DEX integration', () => {
    describe('connectDexClient', () => {
      it('should connect DEX client', async () => {
        const mockStargateClient = {} as SigningStargateClient;

        await client.connectDexClient(mockStargateClient);

        expect(mockDexClient.connect).toHaveBeenCalledWith(mockStargateClient);
      });

      it('should throw error if DEX client not configured', async () => {
        const clientWithoutDex = new FusionCosmosClient({
          ...config,
          cosmos: { ...config.cosmos, routerContract: undefined },
        });

        await expect(
          clientWithoutDex.connectDexClient({} as SigningStargateClient)
        ).rejects.toThrow('DEX client not configured');
      });
    });

    describe('createCrossChainSwapWithDEX', () => {
      const swapParams = {
        sourceChain: 'ethereum' as const,
        sourceToken: '0xusdc',
        sourceAmount: '1000000',
        targetChain: 'cosmoshub-4',
        targetToken: 'uatom',
        minOutputAmount: '900000',
        slippageTolerance: 0.5,
        receiver: 'cosmos1receiver',
      };

      it('should create cross-chain swap with DEX routing', async () => {
        const mockSwapPlan = {
          htlcParams: {
            receiver: swapParams.receiver,
            amount: swapParams.sourceAmount,
            denom: 'uosmo',
            hashlock: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            timelock: Math.floor(Date.now() / 1000) + 3600,
          },
          swapRoutes: [{ poolId: '1', tokenOutDenom: 'uatom' }],
          estimatedOutput: '950000',
          totalFees: '1000',
          priceImpact: '0.05',
        };

        mockDexClient.planCrossChainSwap.mockResolvedValue(mockSwapPlan);
        mockEthereumClient.createHTLC.mockResolvedValue('htlc123');
        mockEthereumClient.getAddress.mockResolvedValue('0xmaker');

        const order = await client.createCrossChainSwapWithDEX(swapParams);

        expect(mockDexClient.planCrossChainSwap).toHaveBeenCalledWith(
          expect.objectContaining({
            sourceChain: swapParams.sourceChain,
            sourceToken: swapParams.sourceToken,
            sourceAmount: swapParams.sourceAmount,
            targetChain: swapParams.targetChain,
            targetToken: swapParams.targetToken,
            minOutputAmount: swapParams.minOutputAmount,
          })
        );

        expect(order).toMatchObject({
          htlcId: 'htlc123',
          sourceChain: 'ethereum',
          targetChain: 'cosmoshub-4',
          amount: '1000000',
          swapRoutes: mockSwapPlan.swapRoutes,
          estimatedOutput: '950000',
          priceImpact: '0.05',
        });
      });

      it('should throw error if DEX client not configured', async () => {
        const clientWithoutDex = new FusionCosmosClient({
          ...config,
          cosmos: { ...config.cosmos, routerContract: undefined },
        });

        await expect(
          clientWithoutDex.createCrossChainSwapWithDEX(swapParams)
        ).rejects.toThrow('DEX client not configured');
      });
    });

    describe('getSpotPrice', () => {
      it('should get spot price from DEX', async () => {
        const mockSpotPrice = {
          spotPrice: '10.5',
          tokenInDenom: 'uosmo',
          tokenOutDenom: 'uatom',
        };

        mockDexClient.querySpotPrice.mockResolvedValue(mockSpotPrice);

        const result = await client.getSpotPrice('pool1', 'uosmo', 'uatom');

        expect(mockDexClient.querySpotPrice).toHaveBeenCalledWith('pool1', 'uosmo', 'uatom');
        expect(result).toEqual(mockSpotPrice);
      });
    });

    describe('estimateSwapOutput', () => {
      it('should estimate swap output with routing', async () => {
        const mockRouteInfo = {
          routes: [[{ poolId: '1', tokenOutDenom: 'uatom' }]],
          estimatedOutput: '950000',
          priceImpact: '0.05',
          totalFees: '1000',
        };

        mockDexClient.findBestRoute.mockResolvedValue(mockRouteInfo);

        const result = await client.estimateSwapOutput(
          { denom: 'uosmo', amount: '1000000' },
          'uatom',
          3
        );

        expect(mockDexClient.findBestRoute).toHaveBeenCalledWith(
          'uosmo',
          'uatom',
          '1000000',
          3
        );
        expect(result).toMatchObject({
          routes: mockRouteInfo.routes[0],
          estimatedOutput: '950000',
          priceImpact: '0.05',
          totalFees: '1000',
        });
      });
    });

    describe('monitorArbitrage', () => {
      it('should monitor arbitrage opportunities', async () => {
        const tokenPairs = [{ tokenA: 'uosmo', tokenB: 'uatom' }];
        const callback = jest.fn();
        const stopFn = jest.fn();

        mockDexClient.monitorArbitrage.mockResolvedValue(stopFn);

        const result = await client.monitorArbitrage(tokenPairs, callback);

        expect(mockDexClient.monitorArbitrage).toHaveBeenCalledWith(tokenPairs, callback);
        expect(result).toBe(stopFn);
      });
    });
  });
});
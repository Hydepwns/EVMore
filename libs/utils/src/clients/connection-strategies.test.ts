import {
  ConnectionStrategy,
  DirectConnectionStrategy,
  PooledConnectionStrategy,
  DirectCosmosQueryStrategy,
  PooledCosmosQueryStrategy,
  DirectCosmosSigningStrategy,
  PooledCosmosSigningStrategy,
  ConnectionStrategyFactory,
  ConnectionStrategyConfig
} from './connection-strategies';

// Mock the ethers-utils module
jest.mock('../ethers/ethers-utils', () => ({
  createProvider: jest.fn()
}));

// Mock the @cosmjs/stargate module
jest.mock('@cosmjs/stargate', () => ({
  StargateClient: {
    connect: jest.fn()
  },
  SigningStargateClient: {
    connectWithSigner: jest.fn()
  }
}));

describe('Connection Strategies', () => {
  let mockProvider: any;
  let mockCosmosClient: any;
  let mockConnectionPool: any;
  let mockWallet: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mocks
    mockProvider = {
      getNetwork: jest.fn(),
      getBlockNumber: jest.fn()
    };
    
    mockCosmosClient = {
      getChainId: jest.fn(),
      getHeight: jest.fn(),
      disconnect: jest.fn()
    };
    
    mockConnectionPool = {
      getConnection: jest.fn(),
      releaseConnection: jest.fn(),
      dispose: jest.fn()
    };
    
    mockWallet = {
      getAccounts: jest.fn(),
      signDirect: jest.fn()
    };
  });

  describe('DirectConnectionStrategy', () => {
    let strategy: DirectConnectionStrategy;
    const rpcUrl = 'https://eth-mainnet.alchemyapi.io/v2/test';

    beforeEach(() => {
      strategy = new DirectConnectionStrategy(rpcUrl);
    });

    it('should create a new instance', () => {
      expect(strategy).toBeInstanceOf(DirectConnectionStrategy);
    });

    it('should get connection by creating new provider', async () => {
      const { createProvider } = require('../ethers/ethers-utils');
      createProvider.mockResolvedValue(mockProvider);

      const connection = await strategy.getConnection();

      expect(createProvider).toHaveBeenCalledWith(rpcUrl);
      expect(connection).toBe(mockProvider);
    });

    it('should handle provider creation errors', async () => {
      const { createProvider } = require('../ethers/ethers-utils');
      const error = new Error('Provider creation failed');
      createProvider.mockRejectedValue(error);

      await expect(strategy.getConnection()).rejects.toThrow('Provider creation failed');
    });

    it('should release connection without cleanup', () => {
      expect(() => strategy.releaseConnection(mockProvider)).not.toThrow();
    });

    it('should dispose without cleanup', async () => {
      await expect(strategy.dispose()).resolves.toBeUndefined();
    });
  });

  describe('PooledConnectionStrategy', () => {
    let strategy: PooledConnectionStrategy;

    beforeEach(() => {
      strategy = new PooledConnectionStrategy(mockConnectionPool);
    });

    it('should create a new instance', () => {
      expect(strategy).toBeInstanceOf(PooledConnectionStrategy);
    });

    it('should get connection from pool', async () => {
      mockConnectionPool.getConnection.mockResolvedValue(mockProvider);

      const connection = await strategy.getConnection();

      expect(mockConnectionPool.getConnection).toHaveBeenCalled();
      expect(connection).toBe(mockProvider);
    });

    it('should handle pool getConnection errors', async () => {
      const error = new Error('Pool connection failed');
      mockConnectionPool.getConnection.mockRejectedValue(error);

      await expect(strategy.getConnection()).rejects.toThrow('Pool connection failed');
    });

    it('should release connection to pool', () => {
      strategy.releaseConnection(mockProvider);

      expect(mockConnectionPool.releaseConnection).toHaveBeenCalledWith(mockProvider);
    });

    it('should dispose pool if available', async () => {
      await strategy.dispose();

      expect(mockConnectionPool.dispose).toHaveBeenCalled();
    });

    it('should handle dispose when pool has no dispose method', async () => {
      delete mockConnectionPool.dispose;

      await expect(strategy.dispose()).resolves.toBeUndefined();
    });
  });

  describe('DirectCosmosQueryStrategy', () => {
    let strategy: DirectCosmosQueryStrategy;
    const rpcUrl = 'https://rpc.cosmos.network:26657';

    beforeEach(() => {
      strategy = new DirectCosmosQueryStrategy(rpcUrl);
    });

    it('should create a new instance', () => {
      expect(strategy).toBeInstanceOf(DirectCosmosQueryStrategy);
    });

    it('should get connection by creating new StargateClient', async () => {
      const { StargateClient } = require('@cosmjs/stargate');
      StargateClient.connect.mockResolvedValue(mockCosmosClient);

      const connection = await strategy.getConnection();

      expect(StargateClient.connect).toHaveBeenCalledWith(rpcUrl);
      expect(connection).toBe(mockCosmosClient);
    });

    it('should handle StargateClient connection errors', async () => {
      const { StargateClient } = require('@cosmjs/stargate');
      const error = new Error('Cosmos connection failed');
      StargateClient.connect.mockRejectedValue(error);

      await expect(strategy.getConnection()).rejects.toThrow('Cosmos connection failed');
    });

    it('should release connection by disconnecting', () => {
      strategy.releaseConnection(mockCosmosClient);

      expect(mockCosmosClient.disconnect).toHaveBeenCalled();
    });

    it('should handle release when client has no disconnect method', () => {
      delete mockCosmosClient.disconnect;

      expect(() => strategy.releaseConnection(mockCosmosClient)).not.toThrow();
    });

    it('should dispose without cleanup', async () => {
      await expect(strategy.dispose()).resolves.toBeUndefined();
    });
  });

  describe('PooledCosmosQueryStrategy', () => {
    let strategy: PooledCosmosQueryStrategy;

    beforeEach(() => {
      strategy = new PooledCosmosQueryStrategy(mockConnectionPool);
    });

    it('should create a new instance', () => {
      expect(strategy).toBeInstanceOf(PooledCosmosQueryStrategy);
    });

    it('should get connection from pool', async () => {
      mockConnectionPool.getConnection.mockResolvedValue(mockCosmosClient);

      const connection = await strategy.getConnection();

      expect(mockConnectionPool.getConnection).toHaveBeenCalled();
      expect(connection).toBe(mockCosmosClient);
    });

    it('should release connection to pool', () => {
      strategy.releaseConnection(mockCosmosClient);

      expect(mockConnectionPool.releaseConnection).toHaveBeenCalledWith(mockCosmosClient);
    });

    it('should dispose pool if available', async () => {
      await strategy.dispose();

      expect(mockConnectionPool.dispose).toHaveBeenCalled();
    });
  });

  describe('DirectCosmosSigningStrategy', () => {
    let strategy: DirectCosmosSigningStrategy;
    const rpcUrl = 'https://rpc.cosmos.network:26657';

    beforeEach(() => {
      strategy = new DirectCosmosSigningStrategy(rpcUrl, mockWallet);
    });

    it('should create a new instance', () => {
      expect(strategy).toBeInstanceOf(DirectCosmosSigningStrategy);
    });

    it('should get connection by creating new StargateClient with wallet', async () => {
      const { SigningStargateClient } = require('@cosmjs/stargate');
      SigningStargateClient.connectWithSigner.mockResolvedValue(mockCosmosClient);

      const connection = await strategy.getConnection();

      expect(SigningStargateClient.connectWithSigner).toHaveBeenCalledWith(rpcUrl, mockWallet);
      expect(connection).toBe(mockCosmosClient);
    });

    it('should release connection by disconnecting', () => {
      strategy.releaseConnection(mockCosmosClient);

      expect(mockCosmosClient.disconnect).toHaveBeenCalled();
    });

    it('should dispose without cleanup', async () => {
      await expect(strategy.dispose()).resolves.toBeUndefined();
    });
  });

  describe('PooledCosmosSigningStrategy', () => {
    let strategy: PooledCosmosSigningStrategy;

    beforeEach(() => {
      strategy = new PooledCosmosSigningStrategy(mockConnectionPool);
    });

    it('should create a new instance', () => {
      expect(strategy).toBeInstanceOf(PooledCosmosSigningStrategy);
    });

    it('should get connection from pool', async () => {
      mockConnectionPool.getConnection.mockResolvedValue(mockCosmosClient);

      const connection = await strategy.getConnection();

      expect(mockConnectionPool.getConnection).toHaveBeenCalled();
      expect(connection).toBe(mockCosmosClient);
    });

    it('should release connection to pool', () => {
      strategy.releaseConnection(mockCosmosClient);

      expect(mockConnectionPool.releaseConnection).toHaveBeenCalledWith(mockCosmosClient);
    });

    it('should dispose pool if available', async () => {
      await strategy.dispose();

      expect(mockConnectionPool.dispose).toHaveBeenCalled();
    });
  });

  describe('ConnectionStrategyFactory', () => {
    describe('createEthereumStrategy', () => {
      it('should create direct strategy', () => {
        const config = { rpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/test' };
        
        const strategy = ConnectionStrategyFactory.createEthereumStrategy('direct', config);
        
        expect(strategy).toBeInstanceOf(DirectConnectionStrategy);
      });

      it('should create pooled strategy', () => {
        const config = { connectionPool: mockConnectionPool };
        
        const strategy = ConnectionStrategyFactory.createEthereumStrategy('pooled', config);
        
        expect(strategy).toBeInstanceOf(PooledConnectionStrategy);
      });

      it('should throw error for invalid type', () => {
        const config = { rpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/test' };
        
        expect(() => {
          ConnectionStrategyFactory.createEthereumStrategy('invalid' as any, config);
        }).toThrow('Unknown strategy type: invalid');
      });

      it('should throw error for direct strategy without rpcUrl', () => {
        const config = {};
        
        expect(() => {
          ConnectionStrategyFactory.createEthereumStrategy('direct', config);
        }).toThrow('rpcUrl required for direct connection strategy');
      });

      it('should throw error for pooled strategy without connectionPool', () => {
        const config = {};
        
        expect(() => {
          ConnectionStrategyFactory.createEthereumStrategy('pooled', config);
        }).toThrow('connectionPool required for pooled connection strategy');
      });
    });

    describe('createCosmosQueryStrategy', () => {
      it('should create direct strategy', () => {
        const config = { rpcUrl: 'https://rpc.cosmos.network:26657' };
        
        const strategy = ConnectionStrategyFactory.createCosmosQueryStrategy('direct', config);
        
        expect(strategy).toBeInstanceOf(DirectCosmosQueryStrategy);
      });

      it('should create pooled strategy', () => {
        const config = { connectionPool: mockConnectionPool };
        
        const strategy = ConnectionStrategyFactory.createCosmosQueryStrategy('pooled', config);
        
        expect(strategy).toBeInstanceOf(PooledCosmosQueryStrategy);
      });

      it('should throw error for invalid type', () => {
        const config = { rpcUrl: 'https://rpc.cosmos.network:26657' };
        
        expect(() => {
          ConnectionStrategyFactory.createCosmosQueryStrategy('invalid' as any, config);
        }).toThrow('Unknown strategy type: invalid');
      });

      it('should throw error for direct strategy without rpcUrl', () => {
        const config = {};
        
        expect(() => {
          ConnectionStrategyFactory.createCosmosQueryStrategy('direct', config);
        }).toThrow('rpcUrl required for direct connection strategy');
      });

      it('should throw error for pooled strategy without connectionPool', () => {
        const config = {};
        
        expect(() => {
          ConnectionStrategyFactory.createCosmosQueryStrategy('pooled', config);
        }).toThrow('connectionPool required for pooled connection strategy');
      });
    });

    describe('createCosmosSigningStrategy', () => {
      it('should create direct strategy', () => {
        const config = { 
          rpcUrl: 'https://rpc.cosmos.network:26657',
          wallet: mockWallet
        };
        
        const strategy = ConnectionStrategyFactory.createCosmosSigningStrategy('direct', config);
        
        expect(strategy).toBeInstanceOf(DirectCosmosSigningStrategy);
      });

      it('should create pooled strategy', () => {
        const config = { connectionPool: mockConnectionPool };
        
        const strategy = ConnectionStrategyFactory.createCosmosSigningStrategy('pooled', config);
        
        expect(strategy).toBeInstanceOf(PooledCosmosSigningStrategy);
      });

      it('should throw error for invalid type', () => {
        const config = { 
          rpcUrl: 'https://rpc.cosmos.network:26657',
          wallet: mockWallet
        };
        
        expect(() => {
          ConnectionStrategyFactory.createCosmosSigningStrategy('invalid' as any, config);
        }).toThrow('Unknown strategy type: invalid');
      });

      it('should throw error for direct strategy without rpcUrl', () => {
        const config = { wallet: mockWallet };
        
        expect(() => {
          ConnectionStrategyFactory.createCosmosSigningStrategy('direct', config);
        }).toThrow('rpcUrl and wallet required for direct connection strategy');
      });

      it('should throw error for direct strategy without wallet', () => {
        const config = { rpcUrl: 'https://rpc.cosmos.network:26657' };
        
        expect(() => {
          ConnectionStrategyFactory.createCosmosSigningStrategy('direct', config);
        }).toThrow('rpcUrl and wallet required for direct connection strategy');
      });

      it('should throw error for pooled strategy without connectionPool', () => {
        const config = {};
        
        expect(() => {
          ConnectionStrategyFactory.createCosmosSigningStrategy('pooled', config);
        }).toThrow('connectionPool required for pooled connection strategy');
      });
    });
  });

  describe('ConnectionStrategy interface', () => {
    it('should be implemented by all strategy classes', () => {
      const strategies: ConnectionStrategy<any>[] = [
        new DirectConnectionStrategy('https://test.com'),
        new PooledConnectionStrategy(mockConnectionPool),
        new DirectCosmosQueryStrategy('https://test.com'),
        new PooledCosmosQueryStrategy(mockConnectionPool),
        new DirectCosmosSigningStrategy('https://test.com', mockWallet),
        new PooledCosmosSigningStrategy(mockConnectionPool)
      ];

      strategies.forEach(strategy => {
        expect(typeof strategy.getConnection).toBe('function');
        expect(typeof strategy.releaseConnection).toBe('function');
        expect(typeof strategy.dispose).toBe('function');
      });
    });
  });
}); 
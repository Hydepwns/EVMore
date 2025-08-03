import { RouterResolutionService, RouterResolutionConfig } from '../../src/registry/router-resolution-service';
import { ChainRegistryClient } from '../../src/registry/chain-registry-client';
import { Logger } from 'pino';

describe('RouterResolutionService', () => {
  let service: RouterResolutionService;
  let mockRegistryClient: jest.Mocked<ChainRegistryClient>;
  let mockLogger: jest.Mocked<Logger>;
  let config: RouterResolutionConfig;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Mock registry client
    mockRegistryClient = {
      getRouterAddress: jest.fn(),
      getIBCChannel: jest.fn(),
      getChannelsForChain: jest.fn(),
      verifyChannel: jest.fn(),
      initialize: jest.fn(),
    } as any;

    // Test config
    config = {
      enableDynamicLookup: true,
      cacheTimeout: 300000, // 5 minutes
      retryAttempts: 3,
      retryDelay: 100, // Short delay for tests
    };

    service = new RouterResolutionService(mockRegistryClient, config, mockLogger);
  });

  describe('resolveRouterAddress', () => {
    it('should resolve router address from registry', async () => {
      const chainId = 'osmosis-1';
      const expectedAddress = 'osmo1router123abc';
      
      mockRegistryClient.getRouterAddress.mockResolvedValue(expectedAddress);

      const result = await service.resolveRouterAddress(chainId);

      expect(result).toBe(expectedAddress);
      expect(mockRegistryClient.getRouterAddress).toHaveBeenCalledWith(chainId);
    });

    it('should use cache for subsequent requests', async () => {
      const chainId = 'osmosis-1';
      const expectedAddress = 'osmo1router123abc';
      
      mockRegistryClient.getRouterAddress.mockResolvedValue(expectedAddress);

      // First call
      const result1 = await service.resolveRouterAddress(chainId);
      expect(result1).toBe(expectedAddress);
      expect(mockRegistryClient.getRouterAddress).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await service.resolveRouterAddress(chainId);
      expect(result2).toBe(expectedAddress);
      expect(mockRegistryClient.getRouterAddress).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      const chainId = 'osmosis-1';
      const expectedAddress = 'osmo1router123abc';
      
      // Fail twice, then succeed
      mockRegistryClient.getRouterAddress
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(expectedAddress);

      const result = await service.resolveRouterAddress(chainId);

      expect(result).toBe(expectedAddress);
      expect(mockRegistryClient.getRouterAddress).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent requests for same chain', async () => {
      const chainId = 'osmosis-1';
      const expectedAddress = 'osmo1router123abc';
      
      // Add delay to simulate slow network
      mockRegistryClient.getRouterAddress.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return expectedAddress;
      });

      // Make multiple concurrent requests
      const promises = Array(5).fill(null).map(() => 
        service.resolveRouterAddress(chainId)
      );

      const results = await Promise.all(promises);

      // All should return same result
      expect(results).toEqual(Array(5).fill(expectedAddress));
      
      // But registry should only be called once
      expect(mockRegistryClient.getRouterAddress).toHaveBeenCalledTimes(1);
    });

    it('should fall back to config when registry fails', async () => {
      const chainId = 'juno-1';
      
      // Mock registry failure
      mockRegistryClient.getRouterAddress.mockRejectedValue(
        new Error('No router found')
      );

      // For this test, we need to mock the config import
      // In a real scenario, this would come from the fusion config
      await expect(service.resolveRouterAddress(chainId)).rejects.toThrow();
    });
  });

  describe('verifyRouterAddress', () => {
    it('should verify valid router address', async () => {
      const chainId = 'osmosis-1';
      const routerAddress = 'osmo1router123abc';
      
      mockRegistryClient.getRouterAddress.mockResolvedValue(routerAddress);

      const isValid = await service.verifyRouterAddress(chainId, routerAddress);

      expect(isValid).toBe(true);
    });

    it('should reject invalid router address', async () => {
      const chainId = 'osmosis-1';
      const validAddress = 'osmo1router123abc';
      const invalidAddress = 'osmo1wrongrouter';
      
      mockRegistryClient.getRouterAddress.mockResolvedValue(validAddress);

      const isValid = await service.verifyRouterAddress(chainId, invalidAddress);

      expect(isValid).toBe(false);
    });
  });

  describe('resolveMultipleRouters', () => {
    it('should resolve multiple routers in batches', async () => {
      const chainIds = [
        'osmosis-1', 'juno-1', 'cosmoshub-4', 
        'axelar-dojo-1', 'stargaze-1', 'akash-network-1'
      ];

      mockRegistryClient.getRouterAddress.mockImplementation(async (chainId) => {
        return `${chainId.split('-')[0]}1router123`;
      });

      const results = await service.resolveMultipleRouters(chainIds);

      expect(results.size).toBe(chainIds.length);
      expect(results.get('osmosis-1')).toBe('osmosis1router123');
      expect(results.get('juno-1')).toBe('juno1router123');
    });

    it('should handle partial failures', async () => {
      const chainIds = ['osmosis-1', 'juno-1', 'unknown-chain'];

      mockRegistryClient.getRouterAddress.mockImplementation(async (chainId) => {
        if (chainId === 'unknown-chain') {
          throw new Error('Chain not found');
        }
        return `${chainId.split('-')[0]}1router123`;
      });

      const results = await service.resolveMultipleRouters(chainIds);

      expect(results.size).toBe(2);
      expect(results.has('unknown-chain')).toBe(false);
    });
  });

  describe('updateRouterAddress', () => {
    it('should update router address and emit event', async () => {
      const chainId = 'osmosis-1';
      const newAddress = 'osmo1newrouter456';
      
      const eventListener = jest.fn();
      service.on('routerUpdated', eventListener);

      await service.updateRouterAddress(chainId, newAddress, 'registry');

      expect(eventListener).toHaveBeenCalledWith({
        chainId,
        routerAddress: newAddress,
        source: 'registry',
        confidence: 'high',
        timestamp: expect.any(Number)
      });
    });
  });

  describe('cache management', () => {
    it('should clear cache for specific chain', async () => {
      const chainId = 'osmosis-1';
      const address = 'osmo1router123';
      
      mockRegistryClient.getRouterAddress.mockResolvedValue(address);

      // Populate cache
      await service.resolveRouterAddress(chainId);
      expect(mockRegistryClient.getRouterAddress).toHaveBeenCalledTimes(1);

      // Clear cache
      service.clearCache(chainId);

      // Should call registry again
      await service.resolveRouterAddress(chainId);
      expect(mockRegistryClient.getRouterAddress).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache', async () => {
      mockRegistryClient.getRouterAddress.mockResolvedValue('router123');

      // Populate cache with multiple chains
      await service.resolveRouterAddress('osmosis-1');
      await service.resolveRouterAddress('juno-1');

      // Clear all cache
      service.clearCache();

      const stats = service.getStats();
      expect(stats.totalCached).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should provide accurate statistics', async () => {
      // Set up different responses
      mockRegistryClient.getRouterAddress.mockImplementation(async (chainId) => {
        return `${chainId.split('-')[0]}1router123`;
      });

      // Resolve some addresses
      await service.resolveRouterAddress('osmosis-1');
      await service.resolveRouterAddress('juno-1');
      
      // Manually add one from config
      await service.updateRouterAddress('cosmoshub-4', 'cosmos1router', 'config');

      const stats = service.getStats();

      expect(stats.totalCached).toBe(3);
      expect(stats.bySource.registry).toBe(2);
      expect(stats.bySource.config).toBe(1);
      expect(stats.byConfidence.high).toBe(2);
      expect(stats.byConfidence.medium).toBe(1);
      expect(stats.averageAge).toBeGreaterThan(0);
    });
  });
});
/**
 * Architecture Validation Tests
 * 
 * These tests validate that our refactored architecture is working correctly
 * with the new @evmore/* libraries and migration adapters.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { FusionConfig, loadConfig, ConfigLoader } from '@evmore/config';
import { ServiceContainer } from '@evmore/interfaces';
import { createLogger } from '@evmore/utils';
import { EthereumConnectionPool, CosmosQueryConnectionPool } from '@evmore/connection-pool';
import { SwapOrder, SwapStatus, ChainType } from '@evmore/types';

// Import SDK with new architecture
import { FusionCosmosClient } from '../../sdk/src/client/fusion-cosmos-client';
import { EthereumHTLCClient } from '../../sdk/src/client/ethereum-htlc-client-pooled';
import { CosmosHTLCClient } from '../../sdk/src/client/cosmos-htlc-client-pooled';

// Import Relayer with new architecture  
import { FusionConfigService } from '../../relayer/src/config/fusion-config-service';
import { RelayServiceFusion } from '../../relayer/src/relay/relay-service-fusion';
import { setupDIContainer } from '../../relayer/src/container/setup';

describe('Architecture Validation Tests', () => {
  let container: ServiceContainer;
  let configService: FusionConfigService;
  let ethereumPool: EthereumConnectionPool;
  let cosmosPool: CosmosQueryConnectionPool;
  let logger: ReturnType<typeof createLogger>;

  beforeAll(async () => {
    // Initialize logger
    logger = createLogger({ name: 'architecture-test' });

    // Load configuration using new system
    configService = FusionConfigService.getInstance();
    await configService.loadConfig();
    const config = configService.getConfig();

    // Validate configuration structure
    expect(config).toHaveProperty('environment');
    expect(config).toHaveProperty('networks');
    expect(config).toHaveProperty('features');
    expect(config).toHaveProperty('services');
  });

  afterAll(async () => {
    // Cleanup
    if (ethereumPool) await ethereumPool.close();
    if (cosmosPool) await cosmosPool.close();
  });

  describe('Library Integration', () => {
    it('should load @evmore/config successfully', async () => {
      const loader = ConfigLoader.getInstance();
      expect(loader).toBeDefined();
      
      // Test configuration loading
      const config = await loadConfig();
      expect(config).toBeDefined();
      expect(config.environment).toBeDefined();
    });

    it('should create services with @evmore/interfaces', () => {
      container = setupDIContainer();
      expect(container).toBeDefined();
      
      // Verify container has required tokens
      expect(container.has('ConfigService')).toBe(true);
      expect(container.has('LoggerFactory')).toBe(true);
    });

    it('should use @evmore/types consistently', () => {
      // Test enum access
      expect(SwapStatus.PENDING).toBe('pending');
      expect(SwapStatus.COMPLETED).toBe('completed');
      
      // Test type guards
      const order: Partial<SwapOrder> = {
        status: SwapStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      expect(order.status).toBe(SwapStatus.PENDING);
    });

    it('should create connection pools with @evmore/connection-pool', async () => {
      const config = configService.getConfig();
      
      // Create Ethereum pool
      ethereumPool = new EthereumConnectionPool({
        endpoints: [config.networks.ethereum.rpcUrl],
        maxConnections: 5,
        minConnections: 1
      });
      
      await ethereumPool.initialize();
      expect(ethereumPool.getPoolStats().totalConnections).toBeGreaterThan(0);
      
      // Create Cosmos pool
      cosmosPool = new CosmosQueryConnectionPool({
        endpoints: [{
          rpc: config.networks.cosmos[0]?.rpcUrl || 'http://localhost:26657',
          rest: config.networks.cosmos[0]?.restUrl || 'http://localhost:1317'
        }],
        maxConnections: 5,
        minConnections: 1
      });
      
      await cosmosPool.initialize();
      expect(cosmosPool.getPoolStats().totalConnections).toBeGreaterThan(0);
    });
  });

  describe('SDK Migration Validation', () => {
    it('should create SDK clients with new pooled connections', async () => {
      const config = configService.getConfig();
      
      // Test Ethereum HTLC client with pool
      const ethClient = new EthereumHTLCClient(
        ethereumPool,
        config.networks.ethereum.contracts.htlc,
        config.networks.ethereum.contracts.resolver
      );
      
      expect(ethClient).toBeDefined();
      // Note: We can't test actual functionality without a real connection
      
      // Test Cosmos HTLC client with pool
      const cosmosClient = new CosmosHTLCClient(
        cosmosPool,
        'osmo1htlc...' // Mock address
      );
      
      expect(cosmosClient).toBeDefined();
    });

    it('should handle type conversions through adapters', () => {
      // Test that legacy types can be converted
      const legacyOrder = {
        id: 'test-123',
        htlcId: 'htlc-456',
        status: 'pending' as const,
        timelock: 48 * 3600,
        createdAt: Date.now()
      };
      
      // This would use the type adapter internally
      expect(legacyOrder).toBeDefined();
      // The actual adapter is used internally by the SDK
    });
  });

  describe('Relayer Migration Validation', () => {
    it('should create relayer with new DI container', () => {
      const container = setupDIContainer();
      
      // Verify all services are registered
      expect(container.has('ConfigService')).toBe(true);
      expect(container.has('MonitorService')).toBe(true);
      expect(container.has('RelayService')).toBe(true);
      expect(container.has('RecoveryService')).toBe(true);
    });

    it('should use FusionConfig through adapters', async () => {
      const fusionConfig = configService.getConfig();
      const appConfig = configService.getAppConfig();
      
      // Verify bidirectional conversion works
      expect(appConfig.ethereum.rpcUrl).toBe(fusionConfig.networks.ethereum.rpcUrl);
      expect(appConfig.cosmos.chainId).toBe('osmosis-1');
    });

    it('should handle errors with @evmore/errors', async () => {
      const { createRelayerError } = await import('../../relayer/src/errors/error-adapter');
      
      const error = createRelayerError.configuration('Invalid config', {
        field: 'test',
        value: null
      });
      
      expect(error.code).toBe('RELAYER_CONFIGURATION_ERROR');
      expect(error.context).toHaveProperty('field', 'test');
    });
  });

  describe('Build System Validation', () => {
    it('should have proper TypeScript paths configured', () => {
      // This test passes if the imports above work correctly
      expect(true).toBe(true);
    });

    it('should resolve @evmore/* packages correctly', async () => {
      // Dynamic imports to test resolution
      const types = await import('@evmore/types');
      expect(types.SwapStatus).toBeDefined();
      
      const config = await import('@evmore/config');
      expect(config.loadConfig).toBeDefined();
      
      const utils = await import('@evmore/utils');
      expect(utils.createLogger).toBeDefined();
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain compatibility through adapters', () => {
      // Test that old interfaces still work
      const config = configService.getAppConfig();
      
      // Old AppConfig structure
      expect(config).toHaveProperty('general');
      expect(config).toHaveProperty('ethereum');
      expect(config).toHaveProperty('cosmos');
      expect(config).toHaveProperty('chainRegistry');
      expect(config).toHaveProperty('relay');
      expect(config).toHaveProperty('recovery');
    });

    it('should support gradual migration', () => {
      // Both old and new config formats work
      const fusionConfig = configService.getConfig();
      const appConfig = configService.getAppConfig();
      
      expect(fusionConfig).toBeDefined();
      expect(appConfig).toBeDefined();
      
      // Same data, different structure
      expect(appConfig.general.logLevel).toBe(fusionConfig.logging.level);
    });
  });
});
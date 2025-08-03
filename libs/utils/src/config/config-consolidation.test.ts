/**
 * Tests for configuration consolidation
 */

import {
  EthereumNetworkConfig,
  CosmosNetworkConfig
} from './common-interfaces';
import { LogLevel } from '@evmore/interfaces';
import {
  adaptLegacyEthereumConfig,
  adaptLegacyCosmosConfig,
  toLegacyEthereumConfig,
  validateEthereumConfig,
  validateCosmosConfig,
  parseEthereumConfigFromEnv,
  parseCosmosConfigFromEnv
} from './config-adapters';
import {
  ConfigMigration,
  ConfigFactory
} from './config-migration';

describe('Configuration Consolidation', () => {
  describe('Legacy Adapters', () => {
    it('should convert legacy Ethereum config to unified format', () => {
      const legacy = {
        rpcUrl: 'https://mainnet.infura.io/v3/test',
        htlcContract: '0x123',
        resolverContract: '0x456',
        privateKey: '0xabc',
        chainId: 1,
        gasPrice: '20',
        gasLimit: 500000
      };

      const unified = adaptLegacyEthereumConfig(legacy);

      expect(unified.rpcUrl).toBe(legacy.rpcUrl);
      expect(unified.htlcContract).toBe(legacy.htlcContract);
      expect(unified.resolverContract).toBe(legacy.resolverContract);
      expect(unified.privateKey).toBe(legacy.privateKey);
      expect(unified.chainId).toBe(legacy.chainId);
      expect(unified.gasConfig?.gasPrice).toBe(legacy.gasPrice);
      expect(unified.gasConfig?.gasLimit).toBe(legacy.gasLimit);
    });

    it('should convert legacy Cosmos config to unified format', () => {
      const legacy = {
        rpcUrl: 'https://rpc.osmosis.zone',
        restUrl: 'https://lcd.osmosis.zone',
        chainId: 'osmosis-1',
        htlcContract: 'osmo123',
        mnemonic: 'test mnemonic',
        addressPrefix: 'osmo',
        denom: 'uosmo',
        gasPrice: '0.025uosmo',
        gasLimit: 200000
      };

      const unified = adaptLegacyCosmosConfig(legacy);

      expect(unified.rpcUrl).toBe(legacy.rpcUrl);
      expect(unified.restUrl).toBe(legacy.restUrl);
      expect(unified.chainId).toBe(legacy.chainId);
      expect(unified.htlcContract).toBe(legacy.htlcContract);
      expect(unified.mnemonic).toBe(legacy.mnemonic);
      expect(unified.addressPrefix).toBe(legacy.addressPrefix);
      expect(unified.denom).toBe(legacy.denom);
      expect(unified.gasConfig?.gasPrice).toBe(legacy.gasPrice);
      expect(unified.gasConfig?.gasLimit).toBe(legacy.gasLimit);
    });

    it('should convert unified config back to legacy format', () => {
      const unified: EthereumNetworkConfig = {
        chainId: 1,
        rpcUrl: 'https://mainnet.infura.io/v3/test',
        htlcContract: '0x123',
        resolverContract: '0x456',
        privateKey: '0xabc',
        gasConfig: {
          gasPrice: '20',
          gasLimit: 500000
        }
      };

      const legacy = toLegacyEthereumConfig(unified);

      expect(legacy.rpcUrl).toBe(unified.rpcUrl);
      expect(legacy.htlcContract).toBe(unified.htlcContract);
      expect(legacy.resolverContract).toBe(unified.resolverContract);
      expect(legacy.privateKey).toBe(unified.privateKey);
      expect(legacy.chainId).toBe(unified.chainId);
      expect(legacy.gasPrice).toBe(unified.gasConfig?.gasPrice);
      expect(legacy.gasLimit).toBe(unified.gasConfig?.gasLimit);
    });
  });

  describe('Validation', () => {
    it('should validate Ethereum config correctly', () => {
      const validConfig: EthereumNetworkConfig = {
        chainId: 1,
        rpcUrl: 'https://mainnet.infura.io/v3/test',
        htlcContract: '0x123'
      };

      const errors = validateEthereumConfig(validConfig);
      expect(errors).toHaveLength(0);
    });

    it('should catch Ethereum config errors', () => {
      const invalidConfig = {
        chainId: 'invalid' as any,
        rpcUrl: '',
        htlcContract: ''
      };

      const errors = validateEthereumConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('rpcUrl is required');
      expect(errors).toContain('htlcContract is required');
      expect(errors).toContain('chainId must be a number');
    });

    it('should validate Cosmos config correctly', () => {
      const validConfig: CosmosNetworkConfig = {
        chainId: 'osmosis-1',
        rpcUrl: 'https://rpc.osmosis.zone',
        restUrl: 'https://lcd.osmosis.zone',
        htlcContract: 'osmo123',
        addressPrefix: 'osmo',
        denom: 'uosmo',
        gasConfig: {
          gasPrice: '0.025uosmo',
          gasLimit: 200000
        }
      };

      const errors = validateCosmosConfig(validConfig);
      expect(errors).toHaveLength(0);
    });

    it('should catch Cosmos config errors', () => {
      const invalidConfig = {
        chainId: '',
        rpcUrl: '',
        restUrl: '',
        htlcContract: '',
        addressPrefix: '',
        denom: ''
      } as CosmosNetworkConfig;

      const errors = validateCosmosConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('rpcUrl is required');
      expect(errors).toContain('restUrl is required');
      expect(errors).toContain('chainId is required');
      expect(errors).toContain('htlcContract is required');
      expect(errors).toContain('addressPrefix is required');
      expect(errors).toContain('denom is required');
    });
  });

  describe('Environment Parsing', () => {
    beforeEach(() => {
      // Clear environment variables
      delete process.env.ETHEREUM_RPC_URL;
      delete process.env.ETHEREUM_HTLC_CONTRACT;
      delete process.env.ETHEREUM_CHAIN_ID;
      delete process.env.COSMOS_RPC_URL;
      delete process.env.COSMOS_REST_URL;
      delete process.env.COSMOS_CHAIN_ID;
    });

    it('should parse Ethereum config from environment variables', () => {
      process.env.ETHEREUM_RPC_URL = 'https://mainnet.infura.io/v3/test';
      process.env.ETHEREUM_HTLC_CONTRACT = '0x123';
      process.env.ETHEREUM_CHAIN_ID = '1';
      process.env.ETHEREUM_GAS_PRICE = '20';

      const config = parseEthereumConfigFromEnv();

      expect(config.rpcUrl).toBe('https://mainnet.infura.io/v3/test');
      expect(config.htlcContract).toBe('0x123');
      expect(config.chainId).toBe(1);
      expect(config.gasConfig?.gasPrice).toBe('20');
    });

    it('should parse Cosmos config from environment variables', () => {
      process.env.COSMOS_RPC_URL = 'https://rpc.osmosis.zone';
      process.env.COSMOS_REST_URL = 'https://lcd.osmosis.zone';
      process.env.COSMOS_CHAIN_ID = 'osmosis-1';
      process.env.COSMOS_HTLC_CONTRACT = 'osmo123';
      process.env.COSMOS_ADDRESS_PREFIX = 'osmo';
      process.env.COSMOS_DENOM = 'uosmo';

      const config = parseCosmosConfigFromEnv();

      expect(config.rpcUrl).toBe('https://rpc.osmosis.zone');
      expect(config.restUrl).toBe('https://lcd.osmosis.zone');
      expect(config.chainId).toBe('osmosis-1');
      expect(config.htlcContract).toBe('osmo123');
      expect(config.addressPrefix).toBe('osmo');
      expect(config.denom).toBe('uosmo');
    });

    it('should use default values when environment variables are not set', () => {
      const ethConfig = parseEthereumConfigFromEnv();
      expect(ethConfig.rpcUrl).toBe('http://localhost:8545');
      expect(ethConfig.chainId).toBe(1337);

      const cosmosConfig = parseCosmosConfigFromEnv();
      expect(cosmosConfig.rpcUrl).toBe('http://localhost:26657');
      expect(cosmosConfig.chainId).toBe('testing');
    });
  });

  describe('Migration Utilities', () => {
    it('should migrate SDK Ethereum config', () => {
      const oldConfig = {
        rpcUrl: 'https://mainnet.infura.io/v3/test',
        htlcContract: '0x123',
        resolverContract: '0x456',
        privateKey: '0xabc',
        chainId: 1
      };

      const newConfig = ConfigMigration.migrateSDKEthereumConfig(oldConfig);

      expect(newConfig.rpcUrl).toBe(oldConfig.rpcUrl);
      expect(newConfig.htlcContract).toBe(oldConfig.htlcContract);
      expect(newConfig.resolverContract).toBe(oldConfig.resolverContract);
      expect(newConfig.privateKey).toBe(oldConfig.privateKey);
      expect(newConfig.chainId).toBe(oldConfig.chainId);
    });

    it('should migrate SDK Cosmos config', () => {
      const oldConfig = {
        rpcUrl: 'https://rpc.osmosis.zone',
        restUrl: 'https://lcd.osmosis.zone',
        chainId: 'osmosis-1',
        htlcContract: 'osmo123',
        mnemonic: 'test mnemonic',
        addressPrefix: 'osmo',
        denom: 'uosmo'
      };

      const newConfig = ConfigMigration.migrateSDKCosmosConfig(oldConfig);

      expect(newConfig.rpcUrl).toBe(oldConfig.rpcUrl);
      expect(newConfig.restUrl).toBe(oldConfig.restUrl);
      expect(newConfig.chainId).toBe(oldConfig.chainId);
      expect(newConfig.htlcContract).toBe(oldConfig.htlcContract);
      expect(newConfig.mnemonic).toBe(oldConfig.mnemonic);
      expect(newConfig.addressPrefix).toBe(oldConfig.addressPrefix);
      expect(newConfig.denom).toBe(oldConfig.denom);
      expect(newConfig.gasConfig?.gasPrice).toBe('0.025uosmo');
      expect(newConfig.gasConfig?.gasLimit).toBe(200000);
    });

    it('should create compatibility wrapper', () => {
      const unifiedConfig = {
        general: {
          environment: 'test' as const,
          logLevel: LogLevel.INFO,
          port: 3000,
          enableMetrics: true,
          shutdownTimeout: 30000
        },
        ethereum: {
          chainId: 1,
          rpcUrl: 'https://mainnet.infura.io/v3/test',
          htlcContract: '0x123',
          resolverContract: '0x456',
          privateKey: '0xabc'
        },
        cosmos: {
          chainId: 'osmosis-1',
          rpcUrl: 'https://rpc.osmosis.zone',
          restUrl: 'https://lcd.osmosis.zone',
          htlcContract: 'osmo123',
          mnemonic: 'test mnemonic',
          addressPrefix: 'osmo',
          denom: 'uosmo',
          gasConfig: {
            gasPrice: '0.025uosmo',
            gasLimit: 200000
          }
        },
        relayer: {
          maxRetries: 3,
          retryDelay: 5000,
          batchSize: 10,
          processingInterval: 5000,
          timeoutBuffer: 300
        },
        recovery: {
          enabled: true,
          checkInterval: 60000,
          refundBuffer: 7200
        },
        chainRegistry: {
          baseUrl: 'https://registry.ping.pub',
          cacheTimeout: 3600,
          refreshInterval: 300
        }
      };

      const wrapper = ConfigMigration.createCompatibilityWrapper(unifiedConfig);

      const sdkEthConfig = wrapper.getSDKEthereumConfig();
      expect(sdkEthConfig.rpcUrl).toBe(unifiedConfig.ethereum.rpcUrl);
      expect(sdkEthConfig.htlcContract).toBe(unifiedConfig.ethereum.htlcContract);

      const sdkCosmosConfig = wrapper.getSDKCosmosConfig();
      expect(sdkCosmosConfig.rpcUrl).toBe(unifiedConfig.cosmos.rpcUrl);
      expect(sdkCosmosConfig.chainId).toBe(unifiedConfig.cosmos.chainId);

      const relayerConfig = wrapper.getRelayerConfig();
      expect(relayerConfig.ethereum.rpcUrl).toBe(unifiedConfig.ethereum.rpcUrl);
      expect(relayerConfig.cosmos.rpcUrl).toBe(unifiedConfig.cosmos.rpcUrl);

      const unified = wrapper.getUnifiedConfig();
      expect(unified).toBe(unifiedConfig);
    });
  });

  describe('Configuration Factory', () => {
    it('should create Ethereum config with defaults', () => {
      const config = ConfigFactory.createEthereumConfig({
        htlcContract: '0x123'
      });

      expect(config.chainId).toBe(1);
      expect(config.rpcUrl).toBe('https://mainnet.infura.io/v3/YOUR_KEY');
      expect(config.htlcContract).toBe('0x123');
      expect(config.confirmations).toBe(1);
      expect(config.timeout).toBe(30000);
    });

    it('should create Cosmos config with defaults', () => {
      const config = ConfigFactory.createCosmosConfig({
        htlcContract: 'osmo123'
      });

      expect(config.chainId).toBe('osmosis-1');
      expect(config.rpcUrl).toBe('https://rpc.osmosis.zone');
      expect(config.restUrl).toBe('https://lcd.osmosis.zone');
      expect(config.htlcContract).toBe('osmo123');
      expect(config.addressPrefix).toBe('osmo');
      expect(config.denom).toBe('uosmo');
      expect(config.gasConfig?.gasPrice).toBe('0.025uosmo');
      expect(config.gasConfig?.gasLimit).toBe(200000);
    });

    it('should override defaults with provided values', () => {
      const config = ConfigFactory.createEthereumConfig({
        chainId: 42,
        rpcUrl: 'https://kovan.infura.io/v3/test',
        htlcContract: '0x456',
        confirmations: 3
      });

      expect(config.chainId).toBe(42);
      expect(config.rpcUrl).toBe('https://kovan.infura.io/v3/test');
      expect(config.htlcContract).toBe('0x456');
      expect(config.confirmations).toBe(3);
    });
  });
});
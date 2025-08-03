/**
 * Migration Validation Tests
 * 
 * Validates that our migration adapters correctly handle the transition
 * from old interfaces to new @evmore/* libraries
 */

import { describe, it, expect } from '@jest/globals';

// Old interfaces (what we're migrating from)
import { 
  HTLCOrder,
  LegacySwapStatus
} from '../../sdk/src/types';
import { AppConfig } from '../../relayer/src/config/index';

// New interfaces (what we're migrating to)
import { 
  SwapStatus
} from '@evmore/types';

// Adapters
import { 
  htlcOrderToSwapOrder,
  adaptLegacyStatus
} from '../../sdk/src/migration/type-adapter-simple';

import {
  appConfigToFusionConfig,
  fusionConfigToAppConfig
} from '../../relayer/src/config/config-adapter';

describe('Migration Validation Tests', () => {
  describe('SDK Type Migration', () => {
    it('should convert HTLCOrder to SwapOrder correctly', () => {
      const legacyOrder: HTLCOrder = {
        id: 'test-123',
        htlcId: 'htlc-456',
        sender: '0x1234567890123456789012345678901234567890',
        receiver: 'cosmos1abcdefghijklmnopqrstuvwxyz',
        amount: '1000000000000000000',
        fromChain: 'ethereum',
        toChain: 'osmosis-1',
        secretHash: '0xabcdef',
        timelock: 48 * 3600,
        status: 'pending',
        createdAt: Date.now()
      };
      
      const swapOrder = htlcOrderToSwapOrder(legacyOrder);
      
      expect(swapOrder.id).toBe(legacyOrder.id);
      expect(swapOrder.orderId).toBe(legacyOrder.htlcId);
      expect(swapOrder.status).toBe(SwapStatus.PENDING);
      expect(swapOrder.createdAt).toBeInstanceOf(Date);
    });

    it('should handle all legacy status values', () => {
      const statusMappings = [
        { legacy: 'pending', expected: SwapStatus.PENDING },
        { legacy: 'filled', expected: SwapStatus.COMPLETED },
        { legacy: 'completed', expected: SwapStatus.COMPLETED },
        { legacy: 'expired', expected: SwapStatus.EXPIRED },
        { legacy: 'cancelled', expected: SwapStatus.FAILED },
        { legacy: 'failed', expected: SwapStatus.FAILED }
      ];
      
      statusMappings.forEach(({ legacy, expected }) => {
        const result = adaptLegacyStatus(legacy);
        expect(result).toBe(expected);
      });
    });

    it('should provide default values for missing fields', () => {
      const minimalOrder: HTLCOrder = {
        id: 'min-123',
        htlcId: 'htlc-min',
        timelock: 3600,
        status: 'pending',
        createdAt: Date.now()
      };
      
      const swapOrder = htlcOrderToSwapOrder(minimalOrder);
      
      expect(swapOrder.id).toBe(minimalOrder.id);
      expect(swapOrder.updatedAt).toBeInstanceOf(Date);
      expect(swapOrder.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('Relayer Config Migration', () => {
    it('should convert AppConfig to FusionConfig', () => {
      const appConfig: AppConfig = {
        general: {
          logLevel: 'debug',
          port: 3001,
          enableMetrics: true,
          shutdownTimeout: 30000
        },
        ethereum: {
          rpcUrl: 'http://localhost:8545',
          htlcContractAddress: '0xhtlc',
          resolverContractAddress: '0xresolver',
          privateKey: 'test-key',
          chainId: 1,
          confirmations: 12,
          gasLimit: 500000
        },
        cosmos: {
          rpcUrl: 'http://localhost:26657',
          restUrl: 'http://localhost:1317',
          chainId: 'osmosis-1',
          htlcContractAddress: 'osmo1htlc',
          mnemonic: 'test mnemonic',
          gasPrice: '0.025uosmo',
          gasLimit: 500000,
          denom: 'uosmo',
          addressPrefix: 'osmo'
        },
        chainRegistry: {
          apiUrl: 'https://registry.example.com',
          cacheTimeout: 3600,
          refreshInterval: 300
        },
        relay: {
          maxRetries: 3,
          retryDelay: 5000,
          batchSize: 10,
          processingInterval: 5000,
          timeoutBuffer: 300
        },
        recovery: {
          enabled: true,
          checkInterval: 60000,
          maxRetries: 5,
          retryDelay: 10000
        }
      };
      
      const fusionConfig = appConfigToFusionConfig(appConfig);
      
      // Verify core mappings
      expect(fusionConfig.environment).toBe('development');
      expect(fusionConfig.log?.level || 'info').toBe(appConfig.general.logLevel);
      expect(fusionConfig.networks.ethereum.rpcUrl).toBe(appConfig.ethereum.rpcUrl);
      expect(fusionConfig.networks.ethereum.chainId).toBe(appConfig.ethereum.chainId);
      expect(fusionConfig.networks.cosmos[0]?.chainId).toBe(appConfig.cosmos.chainId);
      
      // Verify service configurations
      expect(fusionConfig.monitoring?.enabled).toBe(appConfig.general.enableMetrics);
      expect(fusionConfig.services.relayer.maxRetries).toBe(appConfig.relay.maxRetries);
      expect(fusionConfig.services.recovery.enabled).toBe(appConfig.recovery.enabled);
    });

    it('should convert FusionConfig back to AppConfig', () => {
      const fusionConfig = {
        environment: 'production' as const,
        logging: {
          level: 'info' as const,
          format: 'json' as const
        },
        networks: {
          ethereum: {
            rpcUrl: 'https://eth-mainnet.example.com',
            chainId: 1,
            contracts: {
              htlc: '0xhtlc-prod',
              resolver: '0xresolver-prod'
            },
            confirmations: 12,
            gasConfig: {
              maxGasLimit: 1000000,
              gasPriceMultiplier: 1.2
            }
          },
          cosmos: {
            osmosis: {
              chainId: 'osmosis-1',
              rpcUrl: 'https://osmosis-rpc.example.com',
              restUrl: 'https://osmosis-rest.example.com',
              contracts: {
                htlc: 'osmo1htlcprod',
                router: 'osmo1router'
              },
              gasConfig: {
                gasPrice: '0.025uosmo',
                gasLimit: 500000
              },
              bech32Prefix: 'osmo'
            }
          }
        },
        services: {
          relay: {
            maxRetries: 5,
            retryDelay: 10000,
            batchSize: 20,
            processingInterval: 3000,
            timeoutBuffer: 600
          },
          recovery: {
            enabled: true,
            checkInterval: 30000,
            maxRetries: 10,
            retryDelay: 5000
          },
          monitoring: {
            prometheus: {
              enabled: true,
              port: 9090
            }
          }
        },
        features: {
          circuitBreaker: true,
          rateLimit: true
        }
      };
      
      const appConfig = fusionConfigToAppConfig(fusionConfig as any);
      
      // Verify reverse mappings
      expect(appConfig.general.logLevel).toBe(fusionConfig.logging.level);
      expect(appConfig.ethereum.rpcUrl).toBe(fusionConfig.networks.ethereum.rpcUrl);
      expect(appConfig.ethereum.htlcContractAddress).toBe(fusionConfig.networks.ethereum.contracts.htlc);
      expect(appConfig.cosmos.chainId).toBe(fusionConfig.networks.cosmos.osmosis.chainId);
      expect(appConfig.relay.maxRetries).toBe(fusionConfig.services.relay.maxRetries);
    });

    it('should handle missing or optional fields gracefully', () => {
      const minimalAppConfig: AppConfig = {
        general: {
          logLevel: 'info',
          port: 3000,
          enableMetrics: false,
          shutdownTimeout: 30000
        },
        ethereum: {
          rpcUrl: 'http://localhost:8545',
          htlcContractAddress: '0xhtlc',
          resolverContractAddress: '',
          privateKey: '',
          chainId: 31337,
          confirmations: 1,
          gasLimit: 500000
        },
        cosmos: {
          rpcUrl: 'http://localhost:26657',
          restUrl: 'http://localhost:1317', 
          chainId: 'test-1',
          htlcContractAddress: 'test1htlc',
          mnemonic: '',
          gasPrice: '0utest',
          gasLimit: 200000,
          denom: 'utest',
          addressPrefix: 'test'
        },
        chainRegistry: {
          apiUrl: '',
          cacheTimeout: 3600,
          refreshInterval: 300
        },
        relay: {
          maxRetries: 1,
          retryDelay: 1000,
          batchSize: 1,
          processingInterval: 1000,
          timeoutBuffer: 60
        },
        recovery: {
          enabled: false,
          checkInterval: 60000,
          maxRetries: 1,
          retryDelay: 1000
        }
      };
      
      const fusionConfig = appConfigToFusionConfig(minimalAppConfig);
      const roundTrip = fusionConfigToAppConfig(fusionConfig);
      
      // Should not throw and maintain data integrity
      expect(roundTrip.general.logLevel).toBe(minimalAppConfig.general.logLevel);
      expect(roundTrip.ethereum.chainId).toBe(minimalAppConfig.ethereum.chainId);
    });
  });

  describe('Interface Compatibility', () => {
    it('should maintain backward compatibility for existing code', () => {
      // Old code using HTLCOrder
      const oldFunction = (order: HTLCOrder) => {
        return {
          id: order.id,
          status: order.status,
          amount: order.amount
        };
      };
      
      const legacyOrder: HTLCOrder = {
        id: 'legacy-123',
        htlcId: 'htlc-legacy',
        status: 'pending',
        amount: '1000',
        timelock: 3600,
        createdAt: Date.now()
      };
      
      // Should work with legacy types
      const result = oldFunction(legacyOrder);
      expect(result.id).toBe('legacy-123');
      expect(result.status).toBe('pending');
    });

    it('should allow gradual migration with both interfaces', () => {
      // Can use both old and new status interfaces
      const legacyStatus: LegacySwapStatus = {
        id: 'swap-123',
        status: 'completed',
        updatedAt: Date.now()
      };
      
      const newStatus = SwapStatus.COMPLETED;
      
      // Both should coexist
      expect(legacyStatus.status).toBe('completed');
      expect(newStatus).toBe('completed');
    });
  });

  describe('Error Handling in Migration', () => {
    it('should handle invalid status values', () => {
      const invalidStatus = 'invalid-status';
      const result = adaptLegacyStatus(invalidStatus);
      
      // Should default to PENDING for unknown statuses
      expect(result).toBe(SwapStatus.PENDING);
    });

    it('should handle null/undefined values in config conversion', () => {
      const partialConfig = {
        general: {
          logLevel: 'info',
          port: 3000,
          enableMetrics: false,
          shutdownTimeout: 30000
        },
        ethereum: null as any,
        cosmos: undefined as any,
        chainRegistry: {} as any,
        relay: {} as any,
        recovery: {} as any
      };
      
      // Should not throw
      expect(() => {
        appConfigToFusionConfig(partialConfig as AppConfig);
      }).toThrow(); // Actually should throw for required fields
    });
  });
});
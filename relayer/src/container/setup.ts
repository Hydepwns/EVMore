/**
 * Dependency injection container setup for the relayer
 * Uses @evmore/utils DIContainer and @evmore/interfaces patterns
 */

import { DIContainer } from '@evmore/utils';
import { CORE_TOKENS, ServiceContainer } from '@evmore/interfaces';
import { FusionConfig } from '@evmore/config';
// FusionConfigManager doesn't exist in @evmore/config
import { LoggerFactory } from '@evmore/utils';
import { RELAYER_TOKENS } from './service-tokens';
import { FusionConfigService } from '../config/fusion-config-service';
import { RelayServiceFusion } from '../relay/relay-service-fusion';
import { fusionConfigToAppConfig } from '../config/config-adapter';

// Import legacy services that need adaptation
import { EthereumMonitor } from '../monitor/ethereum-monitor';
import { CosmosMonitor } from '../monitor/cosmos-monitor';
import { RecoveryService } from '../recovery/recovery-service';
import { ChainRegistryClient } from '../registry/chain-registry-client';
import { RouterResolutionService } from '../registry/router-resolution-service';
import { DexIntegrationService } from '../dex/dex-integration';
import { MultiHopManager } from '../ibc/multi-hop-manager';

/**
 * Create and configure the DI container for the relayer
 */
export async function createRelayerContainer(): Promise<ServiceContainer> {
  const container = new DIContainer();
  
  // Load configuration
  const configService = FusionConfigService.getInstance();
  const config = await configService.loadConfig();
  
  // Register core services
  container.registerSingleton(CORE_TOKENS.Config, () => config);
  
  // Register logger
  const loggerFactory = LoggerFactory.getInstance();
  const logger = loggerFactory.create('relayer');
  container.registerSingleton(CORE_TOKENS.Logger, () => logger);
  
  // Create pino-compatible logger for legacy services
  const pinoLogger = logger as any; // Type assertion for compatibility
  
  // Register RelayService with FusionConfig
  container.registerSingleton(RELAYER_TOKENS.RelayService, () => {
    return new RelayServiceFusion(config, container);
  });
  
  // Register monitors with AppConfig adapter
  const appConfig = fusionConfigToAppConfig(config);
  
  container.registerSingleton(RELAYER_TOKENS.EthereumMonitor, () => {
    return new EthereumMonitor(appConfig.ethereum, pinoLogger);
  });
  
  container.registerSingleton(RELAYER_TOKENS.CosmosMonitor, () => {
    return new CosmosMonitor(appConfig.cosmos, pinoLogger);
  });
  
  // Register recovery service
  container.registerSingleton(RELAYER_TOKENS.RecoveryService, () => {
    return new RecoveryService(appConfig, pinoLogger);
  });
  
  // Register registry services
  container.registerSingleton(RELAYER_TOKENS.ChainRegistry, () => {
    return new ChainRegistryClient(appConfig, pinoLogger);
  });
  
  container.registerSingleton(RELAYER_TOKENS.RouterResolver, async () => {
    const chainRegistry = container.get(RELAYER_TOKENS.ChainRegistry);
    const routerConfig = { timeout: 30000, retries: 3 }; // Default config
    const service = new RouterResolutionService(chainRegistry, routerConfig, pinoLogger);
    return service;
  });
  
  // Register IBC and DEX services
  container.registerSingleton(RELAYER_TOKENS.MultiHopManager, () => {
    // TODO: Create proper RouteDiscovery instance
    const routeDiscovery = {} as any; // Placeholder
    return new MultiHopManager(appConfig, routeDiscovery, pinoLogger);
  });
  
  container.registerSingleton(RELAYER_TOKENS.DexIntegration, () => {
    return new DexIntegrationService(appConfig, pinoLogger);
  });
  
  return container;
}

/**
 * Initialize all services in the container
 */
export async function initializeServices(container: ServiceContainer): Promise<void> {
  const logger = container.get(CORE_TOKENS.Logger);
  logger.info('Initializing relayer services...');
  
  // Initialize services that require startup
  const relayService = container.get(RELAYER_TOKENS.RelayService);
  await relayService.initialize();
  
  const ethereumMonitor = container.get(RELAYER_TOKENS.EthereumMonitor);
  await ethereumMonitor.start();
  
  const cosmosMonitor = container.get(RELAYER_TOKENS.CosmosMonitor);
  await cosmosMonitor.start();
  
  const recoveryService = container.get(RELAYER_TOKENS.RecoveryService);
  await recoveryService.start();
  
  const chainRegistry = container.get(RELAYER_TOKENS.ChainRegistry);
  await chainRegistry.initialize();
  
  const multiHopManager = container.get(RELAYER_TOKENS.MultiHopManager);
  await multiHopManager.initialize();
  
  const dexIntegration = container.get(RELAYER_TOKENS.DexIntegration);
  await dexIntegration.initialize();
  
  logger.info('All relayer services initialized successfully');
}

/**
 * Shutdown all services gracefully
 */
export async function shutdownServices(container: ServiceContainer): Promise<void> {
  const logger = container.get(CORE_TOKENS.Logger);
  logger.info('Shutting down relayer services...');
  
  try {
    // Stop monitors first to prevent new events
    const ethereumMonitor = container.get(RELAYER_TOKENS.EthereumMonitor);
    await ethereumMonitor.stop();
    
    const cosmosMonitor = container.get(RELAYER_TOKENS.CosmosMonitor);
    await cosmosMonitor.stop();
    
    // Stop recovery service
    const recoveryService = container.get(RELAYER_TOKENS.RecoveryService);
    await recoveryService.stop();
    
    // Shutdown relay service (waits for pending relays)
    const relayService = container.get(RELAYER_TOKENS.RelayService);
    await relayService.shutdown();
    
    // Dispose container
    if (container instanceof DIContainer) {
      await container.dispose();
    }
    
    logger.info('All relayer services shut down successfully');
  } catch (error) {
    logger.error({ error }, 'Error during service shutdown');
    throw error;
  }
}

/**
 * Create a test container with mock services
 */
export function createTestContainer(overrides?: Partial<Record<any, () => any>>): ServiceContainer {
  const container = new DIContainer();
  
  // Mock config
  const mockConfig: FusionConfig = {
    environment: {
      name: 'test',
      debug: true,
      logLevel: 0 // LogLevel.DEBUG
    },
    networks: {
      ethereum: {
        chainId: 31337,
        name: 'Hardhat',
        rpcUrl: 'http://localhost:8545',
        contracts: {
          htlc: '0x0000000000000000000000000000000000000000',
          resolver: '0x0000000000000000000000000000000000000000'
        },
        confirmations: 0,
        gasConfig: {
          maxGasLimit: 8000000
        }
      },
      cosmos: [{
        chainId: 'test-1',
        name: 'Test Chain',
        rpcUrl: 'http://localhost:26657',
        restUrl: 'http://localhost:1317',
        addressPrefix: 'cosmos',
        coinType: 118,
        gasPrice: '0.025utest',
        gasLimit: 500000,
        denominations: {
          primary: 'utest',
          display: 'test',
          decimals: 6
        },
        contracts: {
          htlc: 'cosmos1test'
        },
        ibc: {
          channels: {},
          timeout: 60
        }
      }]
    },
    services: {
      relayer: {
        maxRetries: 1,
        retryDelayMs: 100,
        batchSize: 10,
        processingIntervalMs: 1000,
        timeoutBufferSeconds: 60,
        concurrency: {
          maxParallelSwaps: 5,
          maxPendingSwaps: 10
        }
      },
      registry: {
        cacheTimeout: 5,
        refreshInterval: 10,
        maxRetries: 1,
        endpoints: {
          chainRegistry: 'http://localhost:3001',
          ibcData: 'http://localhost:3001/ibc'
        }
      },
      recovery: {
        enabled: false,
        checkInterval: 1000,
        refundBufferSeconds: 30,
        maxRecoveryAttempts: 1
      }
    },
    security: {
      secrets: { provider: 'env', encryption: false },
      encryption: { algorithm: 'aes-256-gcm', keyDerivation: 'pbkdf2' },
      rateLimit: { enabled: false, windowMs: 1000, maxRequests: 1000 },
      firewall: { enabled: false, allowedOrigins: ['*'], maxConnectionsPerIP: 100 }
    },
    monitoring: {
      metrics: { enabled: false, port: 9090, path: '/metrics', prefix: 'test_' },
      tracing: { enabled: false, serviceName: 'test', sampleRate: 1.0 },
      healthCheck: { enabled: false, interval: 1000, timeout: 500, endpoints: [] },
      alerts: { enabled: false, channels: [], thresholds: { errorRate: 1.0, responseTime: 10000, diskUsage: 1.0, memoryUsage: 1.0 } }
    },
    features: {
      multiHopRouting: true,
      automaticRecovery: false,
      dynamicGasPrice: false,
      experimentalFeatures: false
    }
  };
  
  container.registerSingleton(CORE_TOKENS.Config, () => mockConfig);
  
  // Mock logger
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(() => mockLogger)
  };
  container.registerSingleton(CORE_TOKENS.Logger, () => mockLogger);
  
  // Apply any overrides
  if (overrides) {
    for (const [tokenKey, factory] of Object.entries(overrides)) {
      // Find the actual service token by name
      const token = Object.values({...CORE_TOKENS, ...RELAYER_TOKENS}).find(t => t.name === tokenKey);
      if (token) {
        container.registerSingleton(token, factory);
      }
    }
  }
  
  return container;
}
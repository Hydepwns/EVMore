import { FusionConfig } from '@evmore/config';
import { LogLevel } from '@evmore/interfaces';
import { ServiceContainer } from '@evmore/interfaces';
import { DIContainer } from '@evmore/utils';
import { LoggerFactory } from '@evmore/utils';
import { MockChainMonitor } from '../mocks/monitor.mock';
import { CORE_TOKENS } from '@evmore/interfaces';

export interface TestOptions {
  configOverrides?: Partial<FusionConfig>;
  mockServices?: boolean;
  isolation?: boolean;
  timeout?: number;
}

export interface TestEnvironment {
  config: FusionConfig;
  container: ServiceContainer;
  cleanup: () => Promise<void>;
}

export function createTestConfig(overrides?: Partial<FusionConfig>): FusionConfig {
  const baseConfig: FusionConfig = {
    environment: {
      name: 'test',
      debug: true,
      logLevel: LogLevel.ERROR // Reduce noise in tests
    },
    
    networks: {
      ethereum: {
        chainId: 31337, // Hardhat
        name: 'Hardhat Network',
        rpcUrl: 'http://localhost:8545',
        contracts: {
          htlc: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          resolver: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
        },
        confirmations: 0, // No confirmations needed in tests
        gasConfig: {
          maxGasLimit: 8000000
        }
      },
      
      cosmos: [
        {
          chainId: 'testing',
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
            htlc: 'cosmos1test_contract',
            router: 'cosmos1test_router'
          },
          ibc: {
            channels: {
              'test-2': {
                channelId: 'channel-0',
                portId: 'transfer',
                counterpartyChainId: 'test-2',
                counterpartyChannelId: 'channel-1',
                version: 'ics20-1'
              }
            },
            timeout: 60 // Short timeout for tests
          }
        }
      ]
    },
    
    services: {
      relayer: {
        maxRetries: 1,
        retryDelayMs: 100,
        batchSize: 2,
        processingIntervalMs: 1000,
        timeoutBufferSeconds: 10,
        concurrency: {
          maxParallelSwaps: 5,
          maxPendingSwaps: 10
        }
      },
      
      registry: {
        cacheTimeout: 5,
        refreshInterval: 2,
        maxRetries: 1,
        endpoints: {
          chainRegistry: 'http://localhost:3001/test/chains',
          ibcData: 'http://localhost:3001/test/ibc'
        }
      },
      
      recovery: {
        enabled: false, // Disable recovery in tests unless explicitly enabled
        checkInterval: 1000,
        refundBufferSeconds: 30,
        maxRecoveryAttempts: 1
      }
    },
    
    security: {
      secrets: {
        provider: 'env',
        encryption: false
      },
      
      encryption: {
        algorithm: 'aes-256-gcm',
        keyDerivation: 'pbkdf2'
      },
      
      rateLimit: {
        enabled: false,
        windowMs: 1000,
        maxRequests: 1000
      },
      
      firewall: {
        enabled: false,
        allowedOrigins: ['*'],
        maxConnectionsPerIP: 1000
      }
    },
    
    monitoring: {
      metrics: {
        enabled: false
      },
      
      tracing: {
        enabled: false,
        serviceName: 'evmore-test',
        sampleRate: 1.0
      },
      
      healthCheck: {
        enabled: false,
        interval: 1000,
        timeout: 500,
        endpoints: []
      },
      
      alerts: {
        enabled: false,
        channels: [],
        thresholds: {
          errorRate: 1.0,
          responseTime: 10000,
          diskUsage: 1.0,
          memoryUsage: 1.0
        }
      }
    },
    
    features: {
      multiHopRouting: true,
      automaticRecovery: false,
      dynamicGasPrice: false,
      experimentalFeatures: true
    }
  };
  
  return deepMerge(baseConfig, overrides || {});
}

// Deep merge utility
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

// Test setup helper
export async function setupTestEnvironment(options: TestOptions = {}): Promise<TestEnvironment> {
  const config = createTestConfig(options.configOverrides);
  const container = new DIContainer();
  
  // Register core services
  container.registerSingleton(CORE_TOKENS.Config, () => config);
  
  // Create test logger that suppresses output unless debug is needed
  const logger = createTestLogger(config.environment.debug);
  container.registerSingleton(CORE_TOKENS.Logger, () => logger);
  
  if (options.mockServices !== false) {
    // Register mock services
    container.registerSingleton(
      CORE_TOKENS.EthereumMonitor,
      () => new MockChainMonitor(config.networks.ethereum.chainId.toString())
    );
    
    container.registerSingleton(
      CORE_TOKENS.CosmosMonitor,
      () => new MockChainMonitor(config.networks.cosmos[0].chainId)
    );
    
    // Add more mock services as needed
  }
  
  return {
    config,
    container,
    cleanup: async () => {
      await container.dispose();
    }
  };
}

// Test logger that can be configured to be silent
function createTestLogger(verbose: boolean = false): any {
  const factory = LoggerFactory.getInstance();
  
  if (!verbose) {
    // Silent logger for tests
    return {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: (): any => createTestLogger(false),
      setLevel: () => {},
      getLevel: () => LogLevel.ERROR,
      log: () => {}
    };
  }
  
  return factory.create('test');
}

// Test isolation utilities
export class TestIsolation {
  private cleanupTasks: Array<() => Promise<void> | void> = [];
  
  addCleanup(task: () => Promise<void> | void): void {
    this.cleanupTasks.push(task);
  }
  
  async cleanup(): Promise<void> {
    for (const task of this.cleanupTasks.reverse()) {
      try {
        await task();
      } catch (error) {
        console.error('Cleanup task failed:', error);
      }
    }
    this.cleanupTasks = [];
  }
}

// Test timeout utility
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 10000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Test timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]);
}

// Common test assertions
export function expectValidConfig(config: FusionConfig): void {
  expect(config).toBeDefined();
  expect(config.environment).toBeDefined();
  expect(config.networks).toBeDefined();
  expect(config.services).toBeDefined();
  expect(config.security).toBeDefined();
  expect(config.monitoring).toBeDefined();
  expect(config.features).toBeDefined();
}

export function expectValidContainer(container: ServiceContainer): void {
  expect(container).toBeDefined();
  expect(container.get).toBeDefined();
  expect(container.has).toBeDefined();
  expect(container.createScope).toBeDefined();
}

// Test data generators
export function generateTestSecret(): string {
  return Array.from({ length: 64 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

export function generateTestAddress(type: 'ethereum' | 'cosmos' = 'ethereum'): string {
  if (type === 'ethereum') {
    return '0x' + Array.from({ length: 40 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  } else {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const randomPart = Array.from({ length: 39 }, () => 
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    return `cosmos1${randomPart}`;
  }
}

export function generateTestOrderId(): string {
  return `test-order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
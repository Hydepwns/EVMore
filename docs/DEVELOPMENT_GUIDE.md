# Development Guide

## Configuration Management

### Environment Setup
```bash
# Development
npm install
npm run build
npm run dev:relayer

# Environment Variables
FUSION_ENV=development|staging|production
ETHEREUM_RPC_URL=<rpc-endpoint>
COSMOS_RPC_URL=<cosmos-rpc>
OSMOSIS_RPC_URL=<osmosis-rpc>
```

### Configuration Structure
```typescript
interface FusionConfig {
  ethereum: {
    rpcUrl: string;
    htlcContractAddress: string;
    privateKey: string;
  };
  cosmos: {
    rpcUrl: string;
    chainId: string;
    mnemonic: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}
```

### Configuration Loading
```typescript
import { loadConfig } from '@evmore/config';

const config = await loadConfig();
```

## Connection Pool Implementation

### Overview
The connection pool provides managed, reusable connections to blockchain networks with automatic retry, health monitoring, and resource management.

### Basic Usage
```typescript
import { EthereumConnectionPool, CosmosQueryConnectionPool } from '@evmore/connection-pool';

// Ethereum connections
const ethPool = new EthereumConnectionPool({
  rpcUrl: 'https://mainnet.infura.io/v3/YOUR-PROJECT-ID',
  maxConnections: 10,
  timeout: 30000
});

// Cosmos connections  
const cosmosPool = new CosmosQueryConnectionPool({
  rpcUrl: 'https://rpc.cosmoshub.network',
  maxConnections: 5,
  timeout: 15000
});

// Execute with automatic connection management
const provider = await ethPool.getConnection();
const block = await provider.getBlock('latest');
ethPool.releaseConnection(provider);
```

### Advanced Configuration
```typescript
const poolConfig = {
  maxConnections: 20,
  minConnections: 5,
  acquireTimeout: 30000,
  createTimeout: 10000,
  destroyTimeout: 5000,
  idleTimeout: 300000,
  reapInterval: 1000,
  createRetryInterval: 200,
  healthCheck: true,
  healthCheckInterval: 60000
};
```

### Health Monitoring
```typescript
// Monitor pool health
setInterval(() => {
  const stats = pool.getStats();
  console.log({
    total: stats.totalConnections,
    active: stats.activeConnections,
    idle: stats.idleConnections,
    pending: stats.pendingRequests
  });
}, 10000);
```

## Service Container & Dependency Injection

### Container Setup
```typescript
import { ServiceContainer } from '@evmore/interfaces';
import { setupContainer } from '../relayer/src/container/setup';

const container = new ServiceContainer();
await setupContainer(container, config);
```

### Service Registration
```typescript
// Register services
container.register('logger', () => createLogger(config.logging));
container.register('ethPool', () => new EthereumConnectionPool(config.ethereum));
container.register('cosmosPool', () => new CosmosQueryConnectionPool(config.cosmos));

// Resolve dependencies
const logger = container.resolve('logger');
const ethPool = container.resolve('ethPool');
```

### Service Tokens
```typescript
import { SERVICE_TOKENS } from '../relayer/src/container/service-tokens';

// Type-safe service resolution
const monitor = container.resolve(SERVICE_TOKENS.ETHEREUM_MONITOR);
const relayService = container.resolve(SERVICE_TOKENS.RELAY_SERVICE);
```

## Testing Infrastructure

### Test Status Summary
- **Test Coverage**: 99.14% pass rate (695/701 tests)
- **Smart Contracts**: 23+ tests across HTLC, Router, Registry modules
- **Integration Tests**: End-to-end cross-chain swap scenarios
- **Performance Tests**: 100+ swaps/second validated
- **Architecture Tests**: Enterprise library validation

### Test Configuration
```typescript
import { createTestConfig } from '@evmore/test-utils';

const testConfig = createTestConfig({
  ethereum: {
    rpcUrl: 'http://localhost:8545', // Hardhat node
    chainId: 31337
  },
  cosmos: {
    rpcUrl: 'http://localhost:26657', // Local cosmos node
    chainId: 'testing'
  }
});
```

### Test Execution
```bash
# Run all tests
npm test

# Run specific test suites  
npm run test:contracts      # Smart contract tests
npm run test:integration    # Cross-chain scenarios
npm run test:performance    # Benchmark tests
npm run test:architecture   # Library validation

# Run with coverage
npm run test:coverage
```

### Mock Services
```typescript
import { MockMonitor, MockRelayService } from '@evmore/test-utils';

// Use mocks in tests
const mockMonitor = new MockMonitor();
container.register('monitor', () => mockMonitor);
```

### Integration Testing
```typescript
import { SwapBuilder } from '@evmore/test-utils';

describe('Cross-chain swap', () => {
  it('should execute successful swap', async () => {
    const swap = SwapBuilder.create()
      .fromChain('ethereum')
      .toChain('cosmoshub-4')
      .amount('1000000')
      .build();
      
    const result = await relayService.executeSwap(swap);
    expect(result.status).toBe('completed');
  });
});
```

## Performance Optimization

### Connection Pool Tuning
- **maxConnections**: Set based on RPC provider limits
- **Health Checks**: Enable for production reliability  
- **Retry Logic**: Configure exponential backoff
- **Metrics**: Monitor pool utilization and performance

### Bundle Optimization
- **Tree Shaking**: Rollup eliminates unused code
- **Code Splitting**: Separate bundles for different use cases
- **External Dependencies**: Externalize large libraries in production

### TypeScript Performance
- **Project References**: Faster incremental builds
- **Composite Builds**: Parallel compilation
- **Build Caching**: Turborepo caches build artifacts

## Migration from Legacy Code

### Type Migration
```typescript
// Old way
import { HTLCOrder } from '../types';

// New way  
import { SwapOrder } from '@evmore/types';
import { htlcOrderToSwapOrder } from '../migration/type-adapter-simple';

const swapOrder = htlcOrderToSwapOrder(legacyOrder);
```

### Configuration Migration
```typescript
// Old AppConfig
import { AppConfig } from './config';

// New FusionConfig
import { FusionConfig } from '@evmore/config';
import { appConfigToFusionConfig } from './config-adapter';

const fusionConfig = appConfigToFusionConfig(appConfig);
```

### Service Migration
```typescript
// Old direct instantiation
const monitor = new EthereumMonitor(config);

// New DI container
const monitor = container.resolve(SERVICE_TOKENS.ETHEREUM_MONITOR);
```

## Troubleshooting

### Common Issues
1. **Module Resolution**: Ensure TypeScript project references are properly configured
2. **Build Errors**: Run `npm run clean && npm run build` to clear cache
3. **Connection Issues**: Check RPC endpoints and network connectivity
4. **Memory Leaks**: Monitor connection pool stats and release connections properly

### Debug Configuration
```typescript
const config = {
  logging: {
    level: 'debug',
    enableTracing: true
  },
  ethereum: {
    logRequests: true
  }
};
```

### Performance Monitoring
```typescript
// Enable detailed metrics
const pool = new EthereumConnectionPool({
  ...config,
  enableMetrics: true,
  metricsInterval: 5000
});

// Monitor performance
pool.on('metrics', (stats) => {
  console.log('Pool Stats:', stats);
});
```
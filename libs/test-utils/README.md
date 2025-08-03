# @evmore/test-utils

Shared testing utilities, fixtures, mocks, and builders for the EVMore project.

## Installation

```bash
npm install @evmore/test-utils
```

## Usage

### Test Environment Setup

```typescript
import { setupTestEnvironment, createTestConfig } from '@evmore/test-utils';

describe('My Test Suite', () => {
  let testEnv: TestEnvironment;
  
  beforeEach(async () => {
    testEnv = await setupTestEnvironment({
      configOverrides: {
        services: {
          relayer: {
            maxRetries: 1
          }
        }
      }
    });
  });
  
  afterEach(async () => {
    await testEnv.cleanup();
  });
  
  test('should have valid configuration', () => {
    expectValidConfig(testEnv.config);
    expectValidContainer(testEnv.container);
  });
});
```

### Test Data Builders

```typescript
import { createSwapOrder, createSwapParams } from '@evmore/test-utils';

test('should create valid swap order', () => {
  const order = createSwapOrder()
    .ethToOsmo()
    .withAmount('1000000000000000000') // 1 ETH
    .withTimelock(3600)
    .build();
    
  expect(order.status).toBe(SwapStatus.PENDING);
  expect(order.amount.symbol).toBe('ETH');
});

test('should create swap parameters', () => {
  const params = createSwapParams()
    .ethToOsmo('2000000000000000000') // 2 ETH
    .slippage(0.01)
    .build();
    
  expect(params.fromChain).toBe('1');
  expect(params.toChain).toBe('osmosis-1');
});
```

### Mock Services

```typescript
import { MockChainMonitor } from '@evmore/test-utils';

test('should emit events', async () => {
  const monitor = new MockChainMonitor('test-chain');
  let eventReceived = false;
  
  monitor.onEvent('htlc_created', (event) => {
    eventReceived = true;
  });
  
  await monitor.start();
  
  const event = monitor.createHTLCEvent({
    orderId: 'test-order-123'
  });
  
  await monitor.emitEvent('htlc_created', event);
  expect(eventReceived).toBe(true);
});
```

### Test Fixtures

```typescript
import { TEST_CHAINS, TEST_ADDRESSES, getTestChain } from '@evmore/test-utils';

test('should use test chain data', () => {
  const ethereum = getTestChain('ethereum', 'hardhat');
  expect(ethereum.id).toBe('31337');
  
  const validEthAddress = TEST_ADDRESSES.ethereum.valid;
  expect(validEthAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
});
```

### Preset Configurations

Available preset swap orders:
- `TEST_SWAP_ORDERS.ethToOsmo()` - ETH to OSMO swap
- `TEST_SWAP_ORDERS.osmoToEth()` - OSMO to ETH swap  
- `TEST_SWAP_ORDERS.atomToOsmo()` - ATOM to OSMO swap
- `TEST_SWAP_ORDERS.expired()` - Expired swap order
- `TEST_SWAP_ORDERS.completed()` - Completed swap order
- `TEST_SWAP_ORDERS.failed()` - Failed swap order

Available test chains:
- `TEST_CHAINS.ethereum.mainnet`
- `TEST_CHAINS.ethereum.goerli`
- `TEST_CHAINS.ethereum.hardhat`
- `TEST_CHAINS.cosmos.cosmoshub`
- `TEST_CHAINS.cosmos.osmosis`
- `TEST_CHAINS.cosmos.testing`

### Utilities

```typescript
import { 
  withTimeout, 
  generateTestSecret, 
  generateTestAddress,
  TestIsolation 
} from '@evmore/test-utils';

test('should timeout properly', async () => {
  const slowOperation = new Promise(resolve => setTimeout(resolve, 5000));
  
  await expect(withTimeout(slowOperation, 100))
    .rejects.toThrow('Test timeout');
});

test('should generate test data', () => {
  const secret = generateTestSecret();
  expect(secret).toHaveLength(64);
  
  const ethAddress = generateTestAddress('ethereum');
  expect(ethAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  
  const cosmosAddress = generateTestAddress('cosmos');
  expect(cosmosAddress).toMatch(/^cosmos1[a-z0-9]{39}$/);
});
```

## Test Isolation

```typescript
import { TestIsolation } from '@evmore/test-utils';

describe('Isolated Tests', () => {
  let isolation: TestIsolation;
  
  beforeEach(() => {
    isolation = new TestIsolation();
  });
  
  afterEach(async () => {
    await isolation.cleanup();
  });
  
  test('should clean up resources', async () => {
    const resource = createSomeResource();
    isolation.addCleanup(() => resource.dispose());
    
    // Test uses resource
    // Cleanup happens automatically
  });
});
```
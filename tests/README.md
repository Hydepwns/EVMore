# Testing Framework for EVMore Protocol

## Overview

This comprehensive testing framework provides unit, integration, and end-to-end testing capabilities for the cross-chain atomic swap protocol.

## Test Structure

```
tests/
├── unit/                 # Isolated component tests
├── integration/          # Multi-component integration tests
├── e2e/                 # Full end-to-end scenarios
├── fixtures/            # Test data and scenarios
├── mocks/              # Mock implementations
├── utils/              # Test utilities and helpers
└── scripts/            # Test environment setup/teardown
```

## Running Tests

### All Tests

```bash
npm test
```

### Specific Test Types

```bash
# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# End-to-end tests
npm run test:e2e

# With coverage
npm run test:coverage
```

## Test Environment Setup

### Local Development

```bash
# Start local blockchain environment
docker-compose up -d

# Setup test environment
cd tests && npm run setup:local

# Run tests
npm test

# Teardown
npm run teardown:local
```

### Configuration

Environment variables for test configuration:

```bash
# Test environment
TEST_ENV=local          # local | testnet
TEST_TIMEOUT=60000      # Test timeout in ms
FUND_TEST_ACCOUNTS=true # Auto-fund test accounts

# Chain RPC endpoints
ETH_RPC_URL=http://localhost:8545
OSMOSIS_RPC_URL=http://localhost:26657
COSMOSHUB_RPC_URL=http://localhost:26658
JUNO_RPC_URL=http://localhost:26659

# Contract addresses (populated during setup)
ETH_HTLC_ADDRESS=0x...
OSMOSIS_HTLC_ADDRESS=osmo1...
```

## Test Categories

### 1. Unit Tests

Isolated component testing:

- Smart contract functions
- Utility functions
- Individual module behavior

### 2. Integration Tests

Multi-component interaction:

- HTLC flow between chains
- Relayer functionality
- Route discovery
- Fee calculations

### 3. End-to-End Tests

Complete user scenarios:

- Full atomic swap flows
- Multi-hop transfers
- Timeout and refund scenarios
- Performance benchmarks

## Key Test Utilities

### CrossChainTestHelpers

Core utilities for cross-chain testing:

```typescript
// Generate secret/hash pair
const { secret, secretHash } = CrossChainTestHelpers.generateSecret();

// Calculate appropriate timelock
const timelock = CrossChainTestHelpers.calculateTimelock(baseTime, 'ethereum');

// Wait for transaction confirmation
await CrossChainTestHelpers.waitForTransaction(txHash, 'ethereum', provider);

// Verify HTLC state
const state = await CrossChainTestHelpers.verifyHTLCState(
  htlcAddress,
  swapId,
  'ethereum',
  provider
);
```

### HTLCTestHelpers

Specialized HTLC testing utilities:

```typescript
// Create matching HTLC pair
const { sourceSwapId, targetSwapId, secret } = await HTLCTestHelpers.createHTLCPair(
  context,
  amount,
  asset
);

// Execute complete atomic swap
const { targetWithdrawTx, sourceWithdrawTx } = await HTLCTestHelpers.executeAtomicSwap(
  context,
  { source: sourceSwapId, target: targetSwapId },
  secret
);
```

### Mock Components

- **MockHTLCContract**: Simulates Ethereum HTLC behavior
- **MockCosmWasmClient**: Simulates CosmWasm interactions
- **MockRelayer**: Simulates relayer behavior with configurable delays/failures
- **MockRouteDiscovery**: Simulates route finding logic

## Test Fixtures

Pre-defined test scenarios in `fixtures/htlc-fixtures.ts`:

- Valid swap scenarios
- Timeout scenarios
- Invalid secret attempts
- Multi-hop routes
- Edge cases

## Custom Jest Matchers

Extended matchers for blockchain testing:

```typescript
// Validate addresses
expect(address).toBeValidAddress('ethereum');
expect(address).toBeValidAddress('cosmos');

// Validate transaction hashes
expect(txHash).toBeValidTxHash('ethereum');
expect(txHash).toBeValidTxHash('cosmos');
```

## Writing New Tests

### Integration Test Template

```typescript
describe('New Integration Test', () => {
  let env: TestEnvironment;
  
  beforeAll(async () => {
    env = TestEnvironment.getInstance();
    await env.initialize();
  });
  
  test('should perform specific action', async () => {
    // Setup
    const { secret, secretHash } = CrossChainTestHelpers.generateSecret();
    
    // Execute
    // ... test logic ...
    
    // Verify
    expect(result).toBeDefined();
  });
});
```

### E2E Test Template

```typescript
describe('New E2E Scenario', () => {
  test('E2E: Complete user flow', async () => {
    console.log('Step 1: User action');
    // ... implementation ...
    
    console.log('Step 2: System response');
    // ... implementation ...
    
    // Verify end state
    expect(finalState).toMatchExpectedOutcome();
  });
});
```

## Performance Testing

The framework includes performance benchmarks:

- Swap completion time measurement
- Concurrent swap stress testing
- Route discovery performance
- Gas usage tracking

## Troubleshooting

### Common Issues

1. **Timeout Errors**
   - Increase `TEST_TIMEOUT` environment variable
   - Check blockchain node connectivity

2. **Contract Not Found**
   - Ensure contracts are deployed: `npm run setup:local`
   - Verify contract addresses in environment

3. **Insufficient Funds**
   - Set `FUND_TEST_ACCOUNTS=true`
   - Check test account balances

### Debug Mode

Enable detailed logging:

```bash
DEBUG=evmore:* npm test
```

## CI/CD Integration

The test suite is designed for CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run Tests
  run: |
    npm run test:unit
    npm run test:integration
    npm run test:e2e
```

## Contributing

When adding new tests:

1. Follow existing patterns and structure
2. Add appropriate fixtures and mocks
3. Update test documentation
4. Ensure tests are deterministic
5. Include both success and failure scenarios

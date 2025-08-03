# @evmore/test-utils

Testing utilities and mocks for the EVMore protocol.

## Overview

The `@evmore/test-utils` package provides comprehensive testing utilities, mocks, and fixtures for testing the EVMore cross-chain swap protocol, including blockchain interactions, HTLC operations, and IBC transfers.

## Core Features

- Mock blockchain clients and contracts
- Test fixtures and builders
- Integration test helpers
- Performance testing utilities
- Contract deployment helpers
- Network simulation tools

## Mock Blockchain Clients

```typescript
class MockEthereumClient {
  private blockNumber = 18500000;
  private accounts: string[] = [];
  private balances: Map<string, string> = new Map();
  private transactions: any[] = [];
  private events: any[] = [];

  constructor() {
    // Initialize with test accounts
    this.accounts = [
      '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
      '0x742d35Cc6634C0532925a3b844Bc9e7595f8b24b',
      '0x742d35Cc6634C0532925a3b844Bc9e7595f8b25c'
    ];

    // Set initial balances
    this.accounts.forEach(account => {
      this.balances.set(account, '1000000000000000000000'); // 1000 ETH
    });
  }

  async getBlockNumber(): Promise<number> {
    return this.blockNumber;
  }

  async getBalance(address: string): Promise<string> {
    return this.balances.get(address) || '0';
  }

  async sendTransaction(transaction: any): Promise<string> {
    const txHash = `0x${Math.random().toString(16).substring(2)}`;
    
    this.transactions.push({
      hash: txHash,
      ...transaction,
      blockNumber: this.blockNumber,
      timestamp: Date.now()
    });

    // Update balances
    if (transaction.value) {
      const fromBalance = this.balances.get(transaction.from) || '0';
      const toBalance = this.balances.get(transaction.to) || '0';
      
      this.balances.set(transaction.from, (BigInt(fromBalance) - BigInt(transaction.value)).toString());
      this.balances.set(transaction.to, (BigInt(toBalance) + BigInt(transaction.value)).toString());
    }

    // Increment block number
    this.blockNumber++;

    return txHash;
  }

  async getTransactionReceipt(txHash: string): Promise<any> {
    const tx = this.transactions.find(t => t.hash === txHash);
    if (!tx) {
      throw new Error('Transaction not found');
    }

    return {
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      status: 1,
      gasUsed: '150000',
      effectiveGasPrice: '20000000000'
    };
  }

  async getLogs(filter: any): Promise<any[]> {
    return this.events.filter(event => {
      if (filter.address && event.address !== filter.address) return false;
      if (filter.topics && !filter.topics.every((topic: string, i: number) => event.topics[i] === topic)) return false;
      return true;
    });
  }

  // Mock event emission
  emitEvent(event: any): void {
    this.events.push({
      ...event,
      blockNumber: this.blockNumber,
      logIndex: this.events.length
    });
  }

  // Test utilities
  setBlockNumber(blockNumber: number): void {
    this.blockNumber = blockNumber;
  }

  setBalance(address: string, balance: string): void {
    this.balances.set(address, balance);
  }

  getTransactions(): any[] {
    return [...this.transactions];
  }

  getEvents(): any[] {
    return [...this.events];
  }

  reset(): void {
    this.blockNumber = 18500000;
    this.transactions = [];
    this.events = [];
    this.balances.clear();
    
    // Reset balances
    this.accounts.forEach(account => {
      this.balances.set(account, '1000000000000000000000');
    });
  }
}
```

## Mock HTLC Contract

```typescript
class MockHTLCContract {
  private htlcs: Map<string, any> = new Map();
  private events: any[] = [];

  async createHTLC(
    receiver: string,
    hashlock: string,
    timelock: number,
    amount: string
  ): Promise<string> {
    const htlcId = `htlc_${Date.now()}_${Math.random().toString(16).substring(2)}`;
    
    const htlc = {
      id: htlcId,
      sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
      receiver,
      hashlock,
      timelock,
      amount,
      status: 'pending',
      createdAt: Date.now()
    };

    this.htlcs.set(htlcId, htlc);

    // Emit event
    this.events.push({
      event: 'HTLCCreated',
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
      blockNumber: 18500000,
      logIndex: this.events.length,
      args: {
        htlcId,
        sender: htlc.sender,
        receiver,
        hashlock,
        timelock,
        amount
      }
    });

    return htlcId;
  }

  async withdrawHTLC(htlcId: string, secret: string): Promise<boolean> {
    const htlc = this.htlcs.get(htlcId);
    if (!htlc) {
      throw new Error('HTLC not found');
    }

    if (htlc.status !== 'pending') {
      throw new Error('HTLC not in pending state');
    }

    // Verify secret
    const computedHashlock = this.computeHashlock(secret);
    if (computedHashlock !== htlc.hashlock) {
      throw new Error('Invalid secret');
    }

    // Check timelock
    if (Date.now() / 1000 > htlc.timelock) {
      throw new Error('HTLC expired');
    }

    htlc.status = 'withdrawn';
    htlc.secret = secret;
    htlc.withdrawnAt = Date.now();

    // Emit event
    this.events.push({
      event: 'HTLCWithdrawn',
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
      blockNumber: 18500000,
      logIndex: this.events.length,
      args: {
        htlcId,
        secret
      }
    });

    return true;
  }

  async refundHTLC(htlcId: string): Promise<boolean> {
    const htlc = this.htlcs.get(htlcId);
    if (!htlc) {
      throw new Error('HTLC not found');
    }

    if (htlc.status !== 'pending') {
      throw new Error('HTLC not in pending state');
    }

    // Check timelock
    if (Date.now() / 1000 <= htlc.timelock) {
      throw new Error('HTLC not expired');
    }

    htlc.status = 'refunded';
    htlc.refundedAt = Date.now();

    // Emit event
    this.events.push({
      event: 'HTLCRefunded',
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
      blockNumber: 18500000,
      logIndex: this.events.length,
      args: {
        htlcId
      }
    });

    return true;
  }

  async getHTLC(htlcId: string): Promise<any> {
    return this.htlcs.get(htlcId);
  }

  async getHTLCs(): Promise<any[]> {
    return Array.from(this.htlcs.values());
  }

  private computeHashlock(secret: string): string {
    // Simple hash implementation for testing
    return require('crypto').createHash('sha256').update(secret).digest('hex');
  }

  // Test utilities
  getEvents(): any[] {
    return [...this.events];
  }

  reset(): void {
    this.htlcs.clear();
    this.events = [];
  }
}
```

## Test Fixtures

```typescript
class TestFixtures {
  static createSwapParams(overrides: Partial<SwapParams> = {}): SwapParams {
    return {
      sourceChain: 'ethereum',
      targetChain: 'osmosis',
      amount: '100.0',
      sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
      receiver: 'osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4',
      sourceToken: 'USDC',
      targetToken: 'OSMO',
      timelock: Math.floor(Date.now() / 1000) + 3600,
      ...overrides
    };
  }

  static createHTLCParams(overrides: Partial<HTLCParams> = {}): HTLCParams {
    return {
      receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b24b',
      hashlock: '0x' + '1'.repeat(64),
      timelock: Math.floor(Date.now() / 1000) + 3600,
      amount: '100000000', // 100 USDC (6 decimals)
      ...overrides
    };
  }

  static createIBCTransferParams(overrides: Partial<IBCTransferParams> = {}): IBCTransferParams {
    return {
      sourcePort: 'transfer',
      sourceChannel: 'channel-0',
      destinationPort: 'transfer',
      destinationChannel: 'channel-1',
      amount: '100000000',
      denom: 'uatom',
      sender: 'cosmos1abc123def456...',
      receiver: 'osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4',
      timeoutHeight: 1000000,
      timeoutTimestamp: Math.floor(Date.now() / 1000) + 300,
      ...overrides
    };
  }

  static createMockHTLC(): any {
    return {
      id: 'htlc_12345',
      sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
      receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b24b',
      hashlock: '0x' + '1'.repeat(64),
      timelock: Math.floor(Date.now() / 1000) + 3600,
      amount: '100000000',
      status: 'pending',
      createdAt: Date.now()
    };
  }

  static createMockSwap(): any {
    return {
      id: 'swap_12345',
      sourceChain: 'ethereum',
      targetChain: 'osmosis',
      amount: '100.0',
      sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
      receiver: 'osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4',
      sourceToken: 'USDC',
      targetToken: 'OSMO',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
}
```

## Test Builders

```typescript
class SwapBuilder {
  private swap: any = TestFixtures.createMockSwap();

  withId(id: string): SwapBuilder {
    this.swap.id = id;
    return this;
  }

  withSourceChain(chain: string): SwapBuilder {
    this.swap.sourceChain = chain;
    return this;
  }

  withTargetChain(chain: string): SwapBuilder {
    this.swap.targetChain = chain;
    return this;
  }

  withAmount(amount: string): SwapBuilder {
    this.swap.amount = amount;
    return this;
  }

  withStatus(status: string): SwapBuilder {
    this.swap.status = status;
    return this;
  }

  withSender(sender: string): SwapBuilder {
    this.swap.sender = sender;
    return this;
  }

  withReceiver(receiver: string): SwapBuilder {
    this.swap.receiver = receiver;
    return this;
  }

  build(): any {
    return { ...this.swap };
  }
}

class HTLCBuilder {
  private htlc: any = TestFixtures.createMockHTLC();

  withId(id: string): HTLCBuilder {
    this.htlc.id = id;
    return this;
  }

  withSender(sender: string): HTLCBuilder {
    this.htlc.sender = sender;
    return this;
  }

  withReceiver(receiver: string): HTLCBuilder {
    this.htlc.receiver = receiver;
    return this;
  }

  withAmount(amount: string): HTLCBuilder {
    this.htlc.amount = amount;
    return this;
  }

  withStatus(status: string): HTLCBuilder {
    this.htlc.status = status;
    return this;
  }

  withTimelock(timelock: number): HTLCBuilder {
    this.htlc.timelock = timelock;
    return this;
  }

  build(): any {
    return { ...this.htlc };
  }
}
```

## Integration Test Helpers

```typescript
class IntegrationTestHelper {
  private ethereumClient: MockEthereumClient;
  private htlcContract: MockHTLCContract;
  private logger: ILogger;

  constructor() {
    this.ethereumClient = new MockEthereumClient();
    this.htlcContract = new MockHTLCContract();
    this.logger = new Logger('IntegrationTest');
  }

  async setupTestEnvironment(): Promise<void> {
    this.logger.info('Setting up test environment');
    
    // Reset all mocks
    this.ethereumClient.reset();
    this.htlcContract.reset();
    
    // Setup initial state
    this.ethereumClient.setBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a', '1000000000000000000000');
  }

  async simulateHTLCCreation(params: HTLCParams): Promise<string> {
    const htlcId = await this.htlcContract.createHTLC(
      params.receiver,
      params.hashlock,
      params.timelock,
      params.amount
    );

    this.logger.info('HTLC created', { htlcId, params });
    return htlcId;
  }

  async simulateHTLCWithdrawal(htlcId: string, secret: string): Promise<boolean> {
    const result = await this.htlcContract.withdrawHTLC(htlcId, secret);
    
    this.logger.info('HTLC withdrawn', { htlcId, result });
    return result;
  }

  async simulateHTLCRefund(htlcId: string): Promise<boolean> {
    const result = await this.htlcContract.refundHTLC(htlcId);
    
    this.logger.info('HTLC refunded', { htlcId, result });
    return result;
  }

  async simulateBlockMining(blocks: number = 1): Promise<void> {
    for (let i = 0; i < blocks; i++) {
      const currentBlock = await this.ethereumClient.getBlockNumber();
      this.ethereumClient.setBlockNumber(currentBlock + 1);
    }
    
    this.logger.info('Blocks mined', { blocks, newBlockNumber: await this.ethereumClient.getBlockNumber() });
  }

  async simulateTimePassing(seconds: number): Promise<void> {
    // In a real implementation, you might want to mock Date.now()
    // For now, we'll just log the time passing
    this.logger.info('Time passing', { seconds });
  }

  getEthereumClient(): MockEthereumClient {
    return this.ethereumClient;
  }

  getHTLCContract(): MockHTLCContract {
    return this.htlcContract;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up test environment');
    this.ethereumClient.reset();
    this.htlcContract.reset();
  }
}
```

## Performance Testing

```typescript
class PerformanceTester {
  private results: any[] = [];

  async measureOperation<T>(
    name: string,
    operation: () => Promise<T>,
    iterations: number = 100
  ): Promise<PerformanceResult> {
    const startTime = Date.now();
    const operationTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const opStart = Date.now();
      await operation();
      const opEnd = Date.now();
      operationTimes.push(opEnd - opStart);
    }

    const totalTime = Date.now() - startTime;
    const avgTime = operationTimes.reduce((a, b) => a + b, 0) / operationTimes.length;
    const minTime = Math.min(...operationTimes);
    const maxTime = Math.max(...operationTimes);

    const result: PerformanceResult = {
      name,
      iterations,
      totalTime,
      averageTime: avgTime,
      minTime,
      maxTime,
      operationsPerSecond: (iterations / totalTime) * 1000
    };

    this.results.push(result);
    return result;
  }

  getResults(): PerformanceResult[] {
    return [...this.results];
  }

  generateReport(): string {
    let report = 'Performance Test Report\n';
    report += '========================\n\n';

    this.results.forEach(result => {
      report += `${result.name}:\n`;
      report += `  Iterations: ${result.iterations}\n`;
      report += `  Total Time: ${result.totalTime}ms\n`;
      report += `  Average Time: ${result.averageTime.toFixed(2)}ms\n`;
      report += `  Min Time: ${result.minTime}ms\n`;
      report += `  Max Time: ${result.maxTime}ms\n`;
      report += `  Ops/sec: ${result.operationsPerSecond.toFixed(2)}\n\n`;
    });

    return report;
  }

  reset(): void {
    this.results = [];
  }
}

interface PerformanceResult {
  name: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  operationsPerSecond: number;
}
```

## Usage Examples

```typescript
import { 
  MockEthereumClient, 
  MockHTLCContract, 
  TestFixtures, 
  SwapBuilder, 
  HTLCBuilder,
  IntegrationTestHelper,
  PerformanceTester 
} from '@evmore/test-utils';

// Basic mocking
const ethereumClient = new MockEthereumClient();
const htlcContract = new MockHTLCContract();

// Create test fixtures
const swapParams = TestFixtures.createSwapParams({
  amount: '500.0',
  targetChain: 'juno'
});

const htlcParams = TestFixtures.createHTLCParams({
  amount: '500000000' // 500 USDC
});

// Use builders
const swap = new SwapBuilder()
  .withId('swap_test_123')
  .withAmount('1000.0')
  .withStatus('completed')
  .build();

const htlc = new HTLCBuilder()
  .withId('htlc_test_456')
  .withStatus('withdrawn')
  .build();

// Integration testing
const testHelper = new IntegrationTestHelper();
await testHelper.setupTestEnvironment();

const htlcId = await testHelper.simulateHTLCCreation(htlcParams);
await testHelper.simulateHTLCWithdrawal(htlcId, 'secret123');
await testHelper.simulateBlockMining(5);

// Performance testing
const perfTester = new PerformanceTester();

await perfTester.measureOperation('HTLC Creation', async () => {
  await htlcContract.createHTLC(
    '0x742d35Cc6634C0532925a3b844Bc9e7595f8b24b',
    '0x' + '1'.repeat(64),
    Math.floor(Date.now() / 1000) + 3600,
    '100000000'
  );
}, 1000);

console.log(perfTester.generateReport());

// Cleanup
await testHelper.cleanup();
```

## Installation

```bash
npm install @evmore/test-utils
```

## Development

```bash
# Build test-utils
npm run build

# Run tests
npm test

# Generate documentation
npm run docs
```

## Contributing

When adding new test utilities:

1. Create the utility with proper TypeScript types
2. Add comprehensive tests
3. Include usage examples
4. Update documentation
5. Follow existing patterns 
import { TestEnvironment } from './utils/test-environment';

// Global test setup
beforeAll(async () => {
  // Initialize test environment
  const env = TestEnvironment.getInstance();
  await env.initialize();
  
  // Set longer timeout for integration tests
  if (process.env.TEST_TYPE === 'integration' || process.env.TEST_TYPE === 'e2e') {
    jest.setTimeout(120000); // 2 minutes
  }
});

// Global test teardown
afterAll(async () => {
  const env = TestEnvironment.getInstance();
  await env.cleanup();
});

// Add custom matchers
expect.extend({
  toBeValidAddress(received: string, chainType: 'ethereum' | 'cosmos') {
    if (chainType === 'ethereum') {
      const pass = /^0x[a-fA-F0-9]{40}$/.test(received);
      return {
        pass,
        message: () => `Expected ${received} to be a valid Ethereum address`,
      };
    } else {
      const pass = /^(cosmos|osmo|juno|secret)1[a-z0-9]{38}$/.test(received);
      return {
        pass,
        message: () => `Expected ${received} to be a valid Cosmos address`,
      };
    }
  },
  
  toBeValidTxHash(received: string, chainType: 'ethereum' | 'cosmos') {
    if (chainType === 'ethereum') {
      const pass = /^0x[a-fA-F0-9]{64}$/.test(received);
      return {
        pass,
        message: () => `Expected ${received} to be a valid Ethereum transaction hash`,
      };
    } else {
      const pass = /^[A-F0-9]{64}$/.test(received);
      return {
        pass,
        message: () => `Expected ${received} to be a valid Cosmos transaction hash`,
      };
    }
  },
});

// Extend Jest matchers TypeScript definitions
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidAddress(chainType: 'ethereum' | 'cosmos'): R;
      toBeValidTxHash(chainType: 'ethereum' | 'cosmos'): R;
    }
  }
}
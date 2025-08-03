// Simple setup for architecture tests
// No external dependencies needed - we're testing the structure, not runtime behavior

beforeAll(() => {
  // Set appropriate timeout for architecture tests
  jest.setTimeout(30000); // 30 seconds should be enough
  
  // Mock console to reduce noise during tests
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    // Keep warn and error for visibility
    warn: console.warn,
    error: console.error,
  };
});

afterAll(() => {
  // Restore console
  global.console = console;
});

// Mock external dependencies that might be imported
jest.mock('ethers', () => ({
  ethers: {
    providers: {
      JsonRpcProvider: jest.fn()
    },
    Contract: jest.fn(),
    utils: {
      parseEther: jest.fn(val => val)
    }
  }
}));

jest.mock('@cosmjs/stargate', () => ({
  SigningStargateClient: {
    connectWithSigner: jest.fn()
  },
  GasPrice: {
    fromString: jest.fn()
  }
}));

jest.mock('@cosmjs/cosmwasm-stargate', () => ({
  SigningCosmWasmClient: {
    connectWithSigner: jest.fn()
  }
}));

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise
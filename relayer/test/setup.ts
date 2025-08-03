// Mock environment variables before importing any modules
process.env.ETHEREUM_RPC_URL = 'http://localhost:8545';
process.env.ETHEREUM_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';
process.env.ETHEREUM_HTLC_ADDRESS = '0x1234567890123456789012345678901234567890';
process.env.COSMOS_RPC_URL = 'http://localhost:26657';
process.env.COSMOS_MNEMONIC = 'test test test test test test test test test test test junk';
process.env.COSMOS_HTLC_ADDRESS = 'cosmos1234567890123456789012345678901234567890123456789012345678901234';
process.env.LOG_LEVEL = 'error'; // Keep logs quiet during tests

// Mock external dependencies
jest.mock('axios');
jest.mock('ethers');
jest.mock('@cosmjs/stargate');

// Set test timeout
jest.setTimeout(30000);

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
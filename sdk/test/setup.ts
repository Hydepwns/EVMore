// Mock environment variables before importing any modules
process.env.ETHEREUM_RPC_URL = 'http://localhost:8545';
process.env.ETHEREUM_HTLC_ADDRESS = '0x1234567890123456789012345678901234567890';
process.env.COSMOS_RPC_URL = 'http://localhost:26657';
process.env.COSMOS_HTLC_ADDRESS = 'cosmos1234567890123456789012345678901234567890123456789012345678901234';

// Mock external dependencies
jest.mock('ethers');
jest.mock('@cosmjs/stargate');
jest.mock('@cosmjs/cosmwasm-stargate');

// Set test timeout
jest.setTimeout(30000);

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
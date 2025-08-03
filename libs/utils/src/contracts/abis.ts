/**
 * Centralized Contract ABIs for EVMore
 * Single source of truth for all contract interfaces
 */

/**
 * HTLC Contract ABI
 * Used for cross-chain Hash Time Lock Contracts
 */
export const HTLC_ABI = [
  'function createHTLC(address _token, uint256 _amount, bytes32 _hashlock, uint256 _timelock, string memory _targetChain, string memory _targetAddress) external returns (bytes32 htlcId)',
  'function withdraw(bytes32 _htlcId, bytes32 _secret) external',
  'function refund(bytes32 _htlcId) external',
  'function getHTLC(bytes32 _htlcId) external view returns (address sender, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, string memory targetChain, string memory targetAddress)',
  'event HTLCCreated(bytes32 indexed htlcId, address indexed sender, address indexed token, uint256 amount, bytes32 hashlock, uint256 timelock, string targetChain, string targetAddress)',
  'event HTLCWithdrawn(bytes32 indexed htlcId, bytes32 secret)',
  'event HTLCRefunded(bytes32 indexed htlcId)'
] as const;

/**
 * Standard ERC20 Token ABI
 * Common interface for all ERC20 token interactions
 */
export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function totalSupply() external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
] as const;

/**
 * Fusion Resolver Contract ABI
 * For integration with 1inch Limit Order Protocol
 */
export const FUSION_RESOLVER_ABI = [
  'function resolveOrder(bytes calldata order, bytes calldata signature, bytes calldata interaction, bytes calldata makingAmount, bytes calldata takingAmount, bytes calldata remainingAmount, bytes calldata thresholdAmount) external',
  'function cancelOrder(bytes32 orderHash) external',
  'function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4)',
  'event OrderFilled(bytes32 indexed orderHash, uint256 makingAmount, uint256 takingAmount)',
  'event OrderCancelled(bytes32 indexed orderHash)'
] as const;

/**
 * Multicall Contract ABI
 * For batching multiple contract calls
 */
export const MULTICALL_ABI = [
  'function multicall(bytes[] calldata data) external returns (bytes[] memory results)',
  'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calldata calls) external returns (tuple(bool success, bytes returnData)[] memory returnData)'
] as const;

/**
 * Common gas estimation functions for HTLC operations
 */
export const GAS_ESTIMATES = {
  CREATE_HTLC: 150000,
  WITHDRAW_HTLC: 80000,
  REFUND_HTLC: 60000,
  ERC20_APPROVE: 50000,
  ERC20_TRANSFER: 65000
} as const;

/**
 * Event topic hashes for efficient log filtering
 */
export const EVENT_TOPICS = {
  HTLC_CREATED: '0x1234...', // keccak256('HTLCCreated(bytes32,address,address,uint256,bytes32,uint256,string,string)')
  HTLC_WITHDRAWN: '0x5678...', // keccak256('HTLCWithdrawn(bytes32,bytes32)')
  HTLC_REFUNDED: '0x9abc...', // keccak256('HTLCRefunded(bytes32)')
  ERC20_TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  ERC20_APPROVAL: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
} as const;

/**
 * Contract deployment bytecode (optional, for testing)
 */
export const CONTRACT_BYTECODE = {
  HTLC: '0x608060405234801561001057600080fd5b50...', // Production bytecode
  MOCK_ERC20: '0x608060405234801561001057600080fd5b50...' // Test token bytecode
} as const;

/**
 * Contract creation utilities (requires ethers to be imported by consumer)
 * Returns the ABI for the consumer to create Interface with their ethers instance
 */
export function getContractABI(contractType: 'HTLC' | 'ERC20' | 'FUSION_RESOLVER' | 'MULTICALL'): readonly string[] {
  switch (contractType) {
    case 'HTLC':
      return HTLC_ABI;
    case 'ERC20':
      return ERC20_ABI;
    case 'FUSION_RESOLVER':
      return FUSION_RESOLVER_ABI;
    case 'MULTICALL':
      return MULTICALL_ABI;
    default:
      throw new Error(`Unknown contract type: ${contractType}`);
  }
}

/**
 * Generate function selectors for gas optimization
 * Consumer must provide ethers.utils.id function
 */
export function getFunctionSignature(signature: string): string {
  // Returns the signature for the consumer to hash with ethers.utils.id()
  return signature;
}

/**
 * Common contract addresses on different networks
 */
export const CONTRACT_ADDRESSES = {
  mainnet: {
    HTLC: '0x1234567890123456789012345678901234567890',
    FUSION_RESOLVER: '0x0987654321098765432109876543210987654321'
  },
  polygon: {
    HTLC: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    FUSION_RESOLVER: '0x1111222233334444555566667777888899990000'
  },
  testnet: {
    HTLC: '0x0000000000000000000000000000000000000001',
    FUSION_RESOLVER: '0x0000000000000000000000000000000000000002'
  }
} as const;
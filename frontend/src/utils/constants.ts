export const SUPPORTED_CHAINS = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    type: 'ethereum',
    icon: '🔷',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/demo',
    chainId: 11155111, // Sepolia
    blockExplorer: 'https://sepolia.etherscan.io',
  },
  cosmos: {
    id: 'cosmos',
    name: 'Cosmos Hub',
    type: 'cosmos',
    icon: '⚛️',
    nativeCurrency: {
      name: 'ATOM',
      symbol: 'ATOM',
      decimals: 6,
    },
    rpcUrl: 'https://rpc.testnet.cosmos.network',
    chainId: 'theta-testnet-001',
    blockExplorer: 'https://explorer.theta-testnet.polypore.xyz',
  },
  osmosis: {
    id: 'osmosis',
    name: 'Osmosis Testnet',
    type: 'cosmos',
    icon: '💧',
    nativeCurrency: {
      name: 'OSMO',
      symbol: 'OSMO',
      decimals: 6,
    },
    rpcUrl: 'https://rpc.testnet.osmosis.zone',
    chainId: 'osmo-test-5',
    blockExplorer: 'https://testnet.mintscan.io/osmosis-testnet',
  },
} as const;

export const SUPPORTED_TOKENS = {
  ethereum: [
    {
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      address: '0x0000000000000000000000000000000000000000',
      icon: '🔷',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0x07865c6E87B9F70255377e024ace6630C1Eaa37F', // Sepolia USDC
      icon: '💵',
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      address: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', // Sepolia WETH
      icon: '🔷',
    },
  ],
  cosmos: [
    {
      symbol: 'ATOM',
      name: 'Cosmos',
      decimals: 6,
      address: 'uatom',
      icon: '⚛️',
    },
    {
      symbol: 'OSMO',
      name: 'Osmosis',
      decimals: 6,
      address: 'uosmo',
      icon: '💧',
    },
  ],
  osmosis: [
    {
      symbol: 'OSMO',
      name: 'Osmosis',
      decimals: 6,
      address: 'uosmo',
      icon: '💧',
    },
    {
      symbol: 'ATOM',
      name: 'Cosmos',
      decimals: 6,
      address: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
      icon: '⚛️',
    },
  ],
} as const;

export const SWAP_STATUS = {
  IDLE: 'idle',
  APPROVING: 'approving',
  APPROVED: 'approved',
  INITIATING: 'initiating',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const PARTIAL_FILL_STATUS = {
  PENDING: 'pending',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const MIN_PARTIAL_FILL_PERCENTAGE = 10;
export const MAX_PARTIAL_FILL_PERCENTAGE = 90;

export const TRANSACTION_STORAGE_KEY = 'fusion_cosmos_transactions';
export const MAX_STORED_TRANSACTIONS = 50;

// Real-time API endpoints
export const API_ENDPOINTS = {
  COINGECKO: 'https://api.coingecko.com/api/v3',
  ETHERSCAN: 'https://api.etherscan.io/api',
  COSMOS_REST: 'https://rest.testnet.cosmos.network',
  OSMOSIS_REST: 'https://rest.testnet.osmosis.zone',
  RELAYER_HEALTH: 'http://localhost:3000/health',
  RELAYER_METRICS: 'http://localhost:3000/metrics',
} as const;

// Market data cache settings
export const MARKET_DATA_CONFIG = {
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
  REFRESH_INTERVAL: 30 * 1000, // 30 seconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1 second
} as const;

// Network gas price limits
export const GAS_PRICE_LIMITS = {
  ETHEREUM: {
    LOW: 20, // Gwei
    MODERATE: 50,
    HIGH: 100,
  },
  POLYGON: {
    LOW: 30,
    MODERATE: 60,
    HIGH: 120,
  },
  ARBITRUM: {
    LOW: 0.1,
    MODERATE: 0.2,
    HIGH: 0.5,
  },
} as const;
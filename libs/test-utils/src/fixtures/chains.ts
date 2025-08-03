import { Chain, ChainType, ChainConfig } from '@evmore/types';

export const TEST_CHAINS = {
  ethereum: {
    mainnet: {
      id: '1',
      name: 'Ethereum Mainnet',
      type: ChainType.ETHEREUM,
      nativeCurrency: { symbol: 'ETH', decimals: 18 },
      endpoints: {
        rpc: 'https://eth-mainnet.g.alchemy.com/v2/test',
        ws: 'wss://eth-mainnet.g.alchemy.com/v2/test'
      },
      explorerUrl: 'https://etherscan.io'
    } as Chain,
    
    goerli: {
      id: '5',
      name: 'Goerli Testnet',
      type: ChainType.ETHEREUM,
      nativeCurrency: { symbol: 'ETH', decimals: 18 },
      endpoints: {
        rpc: 'https://goerli.infura.io/v3/test',
        ws: 'wss://goerli.infura.io/ws/v3/test'
      },
      explorerUrl: 'https://goerli.etherscan.io'
    } as Chain,
    
    hardhat: {
      id: '31337',
      name: 'Hardhat Local',
      type: ChainType.ETHEREUM,
      nativeCurrency: { symbol: 'ETH', decimals: 18 },
      endpoints: {
        rpc: 'http://localhost:8545'
      }
    } as Chain
  },
  
  cosmos: {
    cosmoshub: {
      id: 'cosmoshub-4',
      name: 'Cosmos Hub',
      type: ChainType.COSMOS,
      nativeCurrency: { symbol: 'ATOM', decimals: 6, denom: 'uatom' },
      endpoints: {
        rpc: 'https://rpc.cosmos.network',
        rest: 'https://lcd.cosmos.network'
      },
      explorerUrl: 'https://mintscan.io/cosmos'
    } as Chain,
    
    osmosis: {
      id: 'osmosis-1',
      name: 'Osmosis',
      type: ChainType.OSMOSIS,
      nativeCurrency: { symbol: 'OSMO', decimals: 6, denom: 'uosmo' },
      endpoints: {
        rpc: 'https://rpc.osmosis.zone',
        rest: 'https://lcd.osmosis.zone'
      },
      explorerUrl: 'https://mintscan.io/osmosis'
    } as Chain,
    
    testing: {
      id: 'testing',
      name: 'Test Chain',
      type: ChainType.COSMOS,
      nativeCurrency: { symbol: 'TEST', decimals: 6, denom: 'utest' },
      endpoints: {
        rpc: 'http://localhost:26657',
        rest: 'http://localhost:1317'
      }
    } as Chain
  }
};

export const TEST_CHAIN_CONFIGS: Record<string, ChainConfig> = {
  'ethereum-mainnet': {
    chainId: '1',
    name: 'Ethereum Mainnet',
    type: ChainType.ETHEREUM,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/test',
    htlcContract: '0x1234567890123456789012345678901234567890',
    nativeDenom: 'ETH',
    blockTime: 12,
    confirmations: 3,
    gasConfig: {
      maxGasLimit: 500000,
      gasPrice: '20000000000'
    }
  },
  
  'ethereum-hardhat': {
    chainId: '31337',
    name: 'Hardhat Local',
    type: ChainType.ETHEREUM,
    rpcUrl: 'http://localhost:8545',
    htlcContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    nativeDenom: 'ETH',
    blockTime: 2,
    confirmations: 1,
    gasConfig: {
      maxGasLimit: 8000000
    }
  },
  
  'cosmos-hub': {
    chainId: 'cosmoshub-4',
    name: 'Cosmos Hub',
    type: ChainType.COSMOS,
    rpcUrl: 'https://rpc.cosmos.network',
    restUrl: 'https://lcd.cosmos.network',
    htlcContract: 'cosmos1htlc_contract_address',
    nativeDenom: 'uatom',
    addressPrefix: 'cosmos',
    blockTime: 6,
    confirmations: 1,
    gasConfig: {
      maxGasLimit: 200000,
      gasPrice: '0.025uatom'
    }
  },
  
  'osmosis': {
    chainId: 'osmosis-1',
    name: 'Osmosis',
    type: ChainType.OSMOSIS,
    rpcUrl: 'https://rpc.osmosis.zone',
    restUrl: 'https://lcd.osmosis.zone',
    htlcContract: 'osmo1htlc_contract_address',
    nativeDenom: 'uosmo',
    addressPrefix: 'osmo',
    blockTime: 6,
    confirmations: 1,
    gasConfig: {
      maxGasLimit: 200000,
      gasPrice: '0.025uosmo'
    }
  },
  
  'cosmos-test': {
    chainId: 'testing',
    name: 'Test Chain',
    type: ChainType.COSMOS,
    rpcUrl: 'http://localhost:26657',
    restUrl: 'http://localhost:1317',
    htlcContract: 'cosmos1test_htlc_contract',
    nativeDenom: 'utest',
    addressPrefix: 'cosmos',
    blockTime: 1,
    confirmations: 1,
    gasConfig: {
      maxGasLimit: 500000,
      gasPrice: '0.025utest'
    }
  }
};

// Helper functions to get test chains
export function getTestChain(network: 'ethereum' | 'cosmos', name: string): Chain {
  const chain = TEST_CHAINS[network][name as keyof typeof TEST_CHAINS[typeof network]];
  if (!chain) {
    throw new Error(`Test chain not found: ${network}.${name}`);
  }
  return chain;
}

export function getTestChainConfig(name: string): ChainConfig {
  const config = TEST_CHAIN_CONFIGS[name];
  if (!config) {
    throw new Error(`Test chain config not found: ${name}`);
  }
  return config;
}

export function getAllTestChains(): Chain[] {
  const chains: Chain[] = [];
  
  Object.values(TEST_CHAINS.ethereum).forEach(chain => chains.push(chain));
  Object.values(TEST_CHAINS.cosmos).forEach(chain => chains.push(chain));
  
  return chains;
}

export function getAllTestChainConfigs(): ChainConfig[] {
  return Object.values(TEST_CHAIN_CONFIGS);
}

// Common test addresses
export const TEST_ADDRESSES = {
  ethereum: {
    valid: '0x1234567890123456789012345678901234567890',
    contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    user1: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    user2: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    zero: '0x0000000000000000000000000000000000000000'
  },
  
  cosmos: {
    valid: 'cosmos1abc123def456ghi789jkl012mno345pqr678stu',
    contract: 'cosmos1htlc_contract_address_test_123456789',
    user1: 'cosmos1user1_test_address_123456789012345',
    user2: 'cosmos1user2_test_address_123456789012345',
    validator: 'cosmosvaloper1validator_test_address_12345'
  },
  
  osmosis: {
    valid: 'osmo1abc123def456ghi789jkl012mno345pqr678stu',
    contract: 'osmo1htlc_contract_address_test_123456789',
    user1: 'osmo1user1_test_address_123456789012345',
    user2: 'osmo1user2_test_address_123456789012345'
  }
};

// Test tokens
export const TEST_TOKENS = {
  ethereum: {
    ETH: { symbol: 'ETH', decimals: 18, address: '0x0000000000000000000000000000000000000000' },
    USDT: { symbol: 'USDT', decimals: 6, address: '0xA0b86a33E6441e42c6e35b5d1c1C7C2a3B45A6E1' },
    USDC: { symbol: 'USDC', decimals: 6, address: '0xB0b86a33E6441e42c6e35b5d1c1C7C2a3B45A6E2' }
  },
  
  cosmos: {
    ATOM: { symbol: 'ATOM', decimals: 6, denom: 'uatom' },
    TEST: { symbol: 'TEST', decimals: 6, denom: 'utest' }
  },
  
  osmosis: {
    OSMO: { symbol: 'OSMO', decimals: 6, denom: 'uosmo' },
    ATOM: { symbol: 'ATOM', decimals: 6, denom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2' }
  }
};
export interface ChainConfig {
  chainId: string;
  rpcUrl: string;
  prefix?: string;
  gasPrice?: string;
}

export interface TestChains {
  ethereum: ChainConfig;
  osmosis: ChainConfig;
  cosmoshub: ChainConfig;
  juno: ChainConfig;
}

export interface EthereumAccount {
  address: string;
  privateKey: string;
}

export interface CosmosAccount {
  address: string;
  mnemonic: string;
}

export interface TestAccounts {
  ethereum: {
    deployer: EthereumAccount;
    alice: EthereumAccount;
    bob: EthereumAccount;
    resolver: EthereumAccount;
  };
  cosmos: CosmosAccount;
}

export class TestConfig {
  readonly chains: TestChains;
  
  constructor() {
    const isLocal = process.env.TEST_ENV === 'local';
    
    this.chains = {
      ethereum: {
        chainId: isLocal ? '31337' : '11155111', // Local or Sepolia
        rpcUrl: process.env.ETH_RPC_URL || 'http://localhost:8545',
      },
      osmosis: {
        chainId: isLocal ? 'localosmosis' : 'osmo-test-5',
        rpcUrl: process.env.OSMOSIS_RPC_URL || 'http://localhost:26657',
        prefix: 'osmo',
        gasPrice: '0.025uosmo',
      },
      cosmoshub: {
        chainId: isLocal ? 'localcosmos' : 'theta-testnet-001',
        rpcUrl: process.env.COSMOSHUB_RPC_URL || 'http://localhost:26658',
        prefix: 'cosmos',
        gasPrice: '0.025uatom',
      },
      juno: {
        chainId: isLocal ? 'localjuno' : 'uni-6',
        rpcUrl: process.env.JUNO_RPC_URL || 'http://localhost:26659',
        prefix: 'juno',
        gasPrice: '0.025ujuno',
      },
    };
  }
  
  getTestAccounts(): TestAccounts {
    // Deterministic test accounts
    return {
      ethereum: {
        deployer: {
          address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
          privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        },
        alice: {
          address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        },
        bob: {
          address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
          privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
        },
        resolver: {
          address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
          privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
        },
      },
      cosmos: {
        address: 'cosmos1syavy2npfyt9tcncdtsdzf7kny9lh777pahuux',
        mnemonic: 'notice oak worry limit wrap speak medal online prefer cluster roof addict wrist behave treat actual wasp year salad speed social layer crew genius',
      },
    };
  }
  
  getContractAddresses(): Record<string, Record<string, string>> {
    // These will be populated during test setup
    return {
      ethereum: {
        htlc: process.env.ETH_HTLC_ADDRESS || '',
        resolver: process.env.ETH_RESOLVER_ADDRESS || '',
      },
      osmosis: {
        htlc: process.env.OSMOSIS_HTLC_ADDRESS || '',
        router: process.env.OSMOSIS_ROUTER_ADDRESS || '',
      },
    };
  }
  
  getTestTimeout(): number {
    return parseInt(process.env.TEST_TIMEOUT || '60000', 10);
  }
  
  getRelayerConfig() {
    return {
      pollInterval: 1000, // 1 second for tests
      maxRetries: 3,
      retryDelay: 500,
    };
  }
}
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import { TestAccounts, TestConfig } from './test-config';

export class TestEnvironment {
  private static instance: TestEnvironment;
  
  private ethereumProvider?: JsonRpcProvider;
  private cosmosClients: Map<string, SigningCosmWasmClient> = new Map();
  private accounts: TestAccounts;
  private config: TestConfig;
  
  private constructor() {
    this.config = new TestConfig();
    this.accounts = this.config.getTestAccounts();
  }
  
  static getInstance(): TestEnvironment {
    if (!TestEnvironment.instance) {
      TestEnvironment.instance = new TestEnvironment();
    }
    return TestEnvironment.instance;
  }
  
  async initialize(): Promise<void> {
    // Initialize Ethereum provider
    this.ethereumProvider = new JsonRpcProvider(
      this.config.chains.ethereum.rpcUrl
    );
    
    // Initialize Cosmos clients
    for (const [chainName, chainConfig] of Object.entries(this.config.chains)) {
      if (chainName !== 'ethereum') {
        const client = await this.createCosmosClient(chainConfig);
        this.cosmosClients.set(chainName, client);
      }
    }
    
    // Fund test accounts if needed
    if (process.env.FUND_TEST_ACCOUNTS === 'true') {
      await this.fundTestAccounts();
    }
  }
  
  private async createCosmosClient(chainConfig: any): Promise<SigningCosmWasmClient> {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
      this.accounts.cosmos.mnemonic,
      { prefix: chainConfig.prefix }
    );
    
    const client = await SigningCosmWasmClient.connectWithSigner(
      chainConfig.rpcUrl,
      wallet,
      {
        gasPrice: GasPrice.fromString(chainConfig.gasPrice),
      }
    );
    
    return client;
  }
  
  private async fundTestAccounts(): Promise<void> {
    console.log('Funding test accounts...');
    
    // Fund Ethereum accounts
    const ethSigner = new Wallet(
      this.accounts.ethereum.deployer.privateKey,
      this.ethereumProvider
    );
    
    for (const account of Object.values(this.accounts.ethereum)) {
      if (account.address !== ethSigner.address) {
        const tx = await ethSigner.sendTransaction({
          to: account.address,
          value: parseEther('10'),
        });
        await tx.wait();
      }
    }
    
    // Cosmos accounts are usually funded through faucets or genesis
    console.log('Test accounts funded');
  }
  
  async cleanup(): Promise<void> {
    // Disconnect clients
    for (const client of this.cosmosClients.values()) {
      client.disconnect();
    }
    this.cosmosClients.clear();
  }
  
  getEthereumProvider(): JsonRpcProvider {
    if (!this.ethereumProvider) {
      throw new Error('Ethereum provider not initialized');
    }
    return this.ethereumProvider;
  }
  
  getCosmosClient(chain: string): SigningCosmWasmClient {
    const client = this.cosmosClients.get(chain);
    if (!client) {
      throw new Error(`Cosmos client for ${chain} not initialized`);
    }
    return client;
  }
  
  getAccounts(): TestAccounts {
    return this.accounts;
  }
  
  getConfig(): TestConfig {
    return this.config;
  }
}
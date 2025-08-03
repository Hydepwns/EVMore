import { ethers } from 'ethers';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import { Logger } from 'pino';
import { AppConfig } from '../config/index';
import { getMetrics } from '../monitoring/prometheus-metrics';

export interface ExpiredHTLC {
  chain: string;
  htlcId: string;
  sender: string;
  amount: string;
  token: string;
  timelock: number;
  createdAt: number;
}

interface RecoveryStats {
  lastCheckTime: number;
  htlcsChecked: number;
  htlcsRefunded: number;
  errors: number;
}

export class RecoveryService {
  private config: AppConfig;
  private logger: Logger;
  private isRunning: boolean = false;
  private checkInterval: number = 60000; // Check every minute
  private ethereumProvider?: ethers.providers.Provider;
  private ethereumWallet?: ethers.Wallet;
  private cosmosClients: Map<string, SigningCosmWasmClient> = new Map();
  private htlcContract?: ethers.Contract;
  private stats: RecoveryStats = {
    lastCheckTime: 0,
    htlcsChecked: 0,
    htlcsRefunded: 0,
    errors: 0
  };
  private maxRetries: number = 3;
  private retryDelay: number = 5000;

  constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'RecoveryService' });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Recovery service already running');
      return;
    }

    // Initialize connections
    await this.initializeConnections();

    this.isRunning = true;
    this.logger.info('Starting recovery service...');

    // Start monitoring for expired HTLCs
    this.monitorExpiredHTLCs();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.logger.info('Stopping recovery service...');
  }

  getStatus(): { isRunning: boolean; stats: RecoveryStats } {
    return {
      isRunning: this.isRunning,
      stats: { ...this.stats }
    };
  }

  private async monitorExpiredHTLCs(): Promise<void> {
    while (this.isRunning) {
      try {
        this.stats.lastCheckTime = Date.now();
        
        await this.checkEthereumHTLCs();
        await this.checkCosmosHTLCs();

        this.logger.info({
          stats: this.stats,
          nextCheckIn: `${this.checkInterval / 1000}s`
        }, 'Recovery check completed');

        // Wait before next check
        await this.sleep(this.checkInterval);
      } catch (error) {
        this.logger.error({ error }, 'Error monitoring expired HTLCs');
        this.stats.errors++;
        await this.sleep(5000);
      }
    }
  }

  private async checkEthereumHTLCs(): Promise<void> {
    try {
      if (!this.htlcContract) {
        this.logger.warn('HTLC contract not initialized');
        return;
      }

      this.logger.debug('Checking Ethereum HTLCs for expiration');

      // Get current block timestamp
      const currentBlock = await this.ethereumProvider!.getBlock('latest');
      const currentTime = currentBlock!.timestamp;

      // More efficient: Query active HTLCs directly from contract
      let activeHtlcIds: string[] = [];

      try {
        // Try to get all active HTLCs (if contract supports it)
        const getActiveHTLCsMethod = 'getActiveHTLCs()';
        if (this.htlcContract.interface.getFunction(getActiveHTLCsMethod)) {
          activeHtlcIds = await this.htlcContract[getActiveHTLCsMethod]();
        } else {
          // Fallback: Query events from last 10000 blocks
          const filter = this.htlcContract.filters.HTLCCreated();
          const events = await this.htlcContract.queryFilter(filter, -10000);
          
          // Collect unique HTLC IDs
          const htlcIdSet = new Set<string>();
          for (const event of events) {
            htlcIdSet.add(event.args!.htlcId);
          }
          activeHtlcIds = Array.from(htlcIdSet);
        }
      } catch (err) {
        // Fallback to event-based approach
        const filter = this.htlcContract.filters.HTLCCreated();
        const fromBlock = Math.max(0, currentBlock!.number - 10000);
        const events = await this.htlcContract.queryFilter(filter, fromBlock);
        
        const htlcIdSet = new Set<string>();
        for (const event of events) {
          htlcIdSet.add(event.args!.htlcId);
        }
        activeHtlcIds = Array.from(htlcIdSet);
      }

      this.logger.debug({ count: activeHtlcIds.length }, 'Found HTLCs to check');
      this.stats.htlcsChecked += activeHtlcIds.length;

      // Process HTLCs in batches to avoid overwhelming the RPC
      const batchSize = 10;
      for (let i = 0; i < activeHtlcIds.length; i += batchSize) {
        const batch = activeHtlcIds.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (htlcId) => {
          try {
            // Get HTLC details
            const htlc = await this.htlcContract!.htlcs(htlcId);
            
            // Check if HTLC is expired and not withdrawn/refunded
            if (htlc.timelock <= currentTime && 
                !htlc.withdrawn && 
                !htlc.refunded &&
                htlc.sender !== ethers.constants.AddressZero) {
              
              this.logger.info({ 
                htlcId, 
                timelock: htlc.timelock,
                currentTime,
                expiredFor: currentTime - htlc.timelock 
              }, 'Found expired HTLC');
              
              // Check if we should refund (only if we're the sender)
              const ourAddress = await this.ethereumWallet!.getAddress();
              if (htlc.sender.toLowerCase() === ourAddress.toLowerCase()) {
                await this.refundEthereumHTLCWithRetry(htlcId);
              } else {
                this.logger.debug({ htlcId, sender: htlc.sender, ourAddress }, 'Not our HTLC, skipping refund');
              }
            }
          } catch (err) {
            this.logger.error({ error: err, htlcId }, 'Failed to check individual HTLC');
            this.stats.errors++;
          }
        }));
        
        // Small delay between batches
        if (i + batchSize < activeHtlcIds.length) {
          await this.sleep(100);
        }
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to check Ethereum HTLCs');
    }
  }

  private async checkCosmosHTLCs(): Promise<void> {
    // Check HTLCs on all configured Cosmos chains
    const cosmosChains = this.config.cosmos.chains || [this.config.cosmos];
    
    for (const chainConfig of cosmosChains) {
      try {
        await this.checkCosmosChainHTLCs(chainConfig);
      } catch (error) {
        this.logger.error({ 
          error, 
          chainId: chainConfig.chainId 
        }, 'Failed to check Cosmos HTLCs on chain');
        this.stats.errors++;
      }
    }
  }

  private async checkCosmosChainHTLCs(chainConfig: any): Promise<void> {
    const chainId = chainConfig.chainId;
    let client = this.cosmosClients.get(chainId);
    
    if (!client) {
      this.logger.warn({ chainId }, 'Cosmos client not initialized for chain');
      return;
    }

    this.logger.debug({ chainId }, 'Checking Cosmos HTLCs for expiration');

    // Query all HTLCs from the contract
    let allHtlcs: any[] = [];
    let startAfter = null;
    
    // Paginate through all HTLCs
    while (true) {
      const response = await client.queryContractSmart(
        chainConfig.htlcContractAddress,
        {
          list_htlcs: {
            start_after: startAfter,
            limit: 100
          }
        }
      );

      if (!response.htlcs || response.htlcs.length === 0) {
        break;
      }

      allHtlcs = allHtlcs.concat(response.htlcs);
      startAfter = response.htlcs[response.htlcs.length - 1].id;
      
      if (response.htlcs.length < 100) {
        break; // Last page
      }
    }

    this.logger.debug({ 
      chainId, 
      count: allHtlcs.length 
    }, 'Found HTLCs to check');
    
    this.stats.htlcsChecked += allHtlcs.length;

    const currentTime = Math.floor(Date.now() / 1000);

    for (const htlc of allHtlcs) {
      try {
        // Check if HTLC is expired and not withdrawn/refunded
        if (htlc.timelock <= currentTime && 
            !htlc.withdrawn && 
            !htlc.refunded) {
          
          this.logger.info({ 
            chainId,
            htlcId: htlc.id, 
            timelock: htlc.timelock,
            currentTime,
            expiredFor: currentTime - htlc.timelock 
          }, 'Found expired Cosmos HTLC');
          
          // Get our address from the wallet
          const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
            chainConfig.mnemonic,
            { prefix: chainConfig.addressPrefix }
          );
          const accounts = await wallet.getAccounts();
          const ourAddress = accounts[0].address;
          
          // Check if we should refund (only if we're the sender)
          if (htlc.sender === ourAddress) {
            await this.refundCosmosHTLCWithRetry(chainId, htlc.id);
          } else {
            this.logger.debug({ 
              chainId,
              htlcId: htlc.id, 
              sender: htlc.sender, 
              ourAddress 
            }, 'Not our HTLC, skipping refund');
          }
        }
      } catch (err) {
        this.logger.error({ 
          error: err, 
          chainId,
          htlcId: htlc.id 
        }, 'Failed to check individual Cosmos HTLC');
        this.stats.errors++;
      }
    }
  }

  private async initializeConnections(): Promise<void> {
    try {
      // Initialize Ethereum connection
      this.ethereumProvider = new ethers.providers.JsonRpcProvider(this.config.ethereum.rpcUrl);
      this.ethereumWallet = new ethers.Wallet(
        this.config.ethereum.privateKey,
        this.ethereumProvider
      );

      // Initialize HTLC contract
      const htlcAbi = [
        'event HTLCCreated(bytes32 indexed htlcId, address indexed sender, address indexed token, uint256 amount, bytes32 hashlock, uint256 timelock, string targetChain, string targetAddress)',
        'function htlcs(bytes32) view returns (address sender, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, string targetChain, string targetAddress)',
        'function refund(bytes32 htlcId)'
      ];
      
      this.htlcContract = new ethers.Contract(
        this.config.ethereum.htlcContractAddress,
        htlcAbi,
        this.ethereumWallet
      );

      // Initialize Cosmos connections for all configured chains
      const cosmosChains = this.config.cosmos.chains || [this.config.cosmos];
      
      for (const chainConfig of cosmosChains) {
        try {
          const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
            chainConfig.mnemonic,
            { prefix: chainConfig.addressPrefix }
          );

          const client = await SigningCosmWasmClient.connectWithSigner(
            chainConfig.rpcUrl,
            wallet,
            { gasPrice: GasPrice.fromString(chainConfig.gasPrice) }
          );
          
          this.cosmosClients.set(chainConfig.chainId, client);
          
          this.logger.info({ 
            chainId: chainConfig.chainId 
          }, 'Initialized Cosmos client for chain');
        } catch (err) {
          this.logger.error({ 
            error: err, 
            chainId: chainConfig.chainId 
          }, 'Failed to initialize Cosmos client for chain');
        }
      }

      this.logger.info({
        ethereum: !!this.ethereumProvider,
        cosmosChains: Array.from(this.cosmosClients.keys())
      }, 'Recovery service connections initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize connections');
      throw error;
    }
  }

  private async refundEthereumHTLCWithRetry(htlcId: string): Promise<void> {
    const startTime = Date.now();
    const metrics = getMetrics();
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.refundEthereumHTLC(htlcId);
        
        // Record successful recovery
        const duration = (Date.now() - startTime) / 1000;
        metrics.recordRecoveryAttempt('refund', 'ethereum', 'success', duration);
        
        return; // Success
      } catch (error) {
        const errorType = error instanceof Error ? error.name : 'unknown';
        
        // Record failed attempt
        metrics.recordRecoveryAttempt('refund', 'ethereum', 'failed', undefined, errorType);
        
        this.logger.error({ 
          error, 
          htlcId, 
          attempt, 
          maxRetries: this.maxRetries 
        }, 'Failed to refund Ethereum HTLC, retrying...');
        
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * attempt); // Exponential backoff
        } else {
          this.stats.errors++;
        }
      }
    }
  }

  private async refundEthereumHTLC(htlcId: string): Promise<void> {
    this.logger.info({ htlcId }, 'Initiating Ethereum HTLC refund');
    
    // Check if HTLC still exists and is refundable
    const htlc = await this.htlcContract!.htlcs(htlcId);
    if (htlc.withdrawn || htlc.refunded) {
      this.logger.warn({ htlcId }, 'HTLC already withdrawn or refunded');
      return;
    }
    
    // Estimate gas to ensure transaction will succeed
    const gasEstimate = await this.htlcContract!.estimateGas.refund(htlcId);
    const gasLimit = gasEstimate.mul(120).div(100); // Add 20% buffer
    
    const tx = await this.htlcContract!.refund(htlcId, {
      gasLimit
    });
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      this.stats.htlcsRefunded++;
      this.logger.info({
        htlcId,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString()
      }, 'Ethereum HTLC refunded successfully');
    } else {
      throw new Error('Transaction failed');
    }
  }

  private async refundCosmosHTLCWithRetry(chainId: string, htlcId: string): Promise<void> {
    const startTime = Date.now();
    const metrics = getMetrics();
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.debug({ chainId, htlcId, attempt }, 'Attempting Cosmos HTLC refund');
        await this.refundCosmosHTLC(chainId, htlcId);
        
        // Record successful recovery
        const duration = (Date.now() - startTime) / 1000;
        metrics.recordRecoveryAttempt('refund', chainId, 'success', duration);
        
        return; // Success
      } catch (error) {
        const errorType = error instanceof Error ? error.name : 'unknown';
        
        this.logger.error({ 
          error, 
          chainId,
          htlcId, 
          attempt, 
          maxRetries: this.maxRetries 
        }, 'Failed to refund Cosmos HTLC, retrying...');
        
        metrics.recordRecoveryAttempt('refund', chainId, 'failed', undefined, errorType);
        
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * attempt); // Exponential backoff
        } else {
          this.stats.errors++;
        }
      }
    }
  }

  private async refundCosmosHTLC(chainId: string, htlcId: string): Promise<void> {
    this.logger.info({ chainId, htlcId }, 'Initiating Cosmos HTLC refund');
    
    const client = this.cosmosClients.get(chainId);
    if (!client) {
      throw new Error(`No client found for chain ${chainId}`);
    }
    
    // Find the chain config
    const cosmosChains = this.config.cosmos.chains || [this.config.cosmos];
    const chainConfig = cosmosChains.find((c: any) => c.chainId === chainId);
    if (!chainConfig) {
      throw new Error(`No configuration found for chain ${chainId}`);
    }
    
    // Query HTLC to ensure it's still refundable
    const htlc = await client.queryContractSmart(
      chainConfig.htlcContractAddress,
      { get_htlc: { htlc_id: htlcId } }
    );
    
    if (htlc.withdrawn || htlc.refunded) {
      this.logger.warn({ chainId, htlcId }, 'HTLC already withdrawn or refunded');
      return;
    }
    
    const msg = {
      refund: {
        htlc_id: htlcId
      }
    };

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
      chainConfig.mnemonic,
      { prefix: chainConfig.addressPrefix }
    );
    const accounts = await wallet.getAccounts();
    const senderAddress = accounts[0].address;
    
    const result = await client.execute(
      senderAddress,
      chainConfig.htlcContractAddress,
      msg,
      'auto'
    );

    // ExecuteResult doesn't have a code property - successful execution doesn't throw
    this.stats.htlcsRefunded++;
    this.logger.info({
      chainId,
      htlcId,
      txHash: result.transactionHash,
      gasUsed: result.gasUsed
    }, 'Cosmos HTLC refunded successfully');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

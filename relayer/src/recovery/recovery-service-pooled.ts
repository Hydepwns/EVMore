/**
 * Enhanced Recovery Service with Connection Pooling
 * Production-grade recovery for expired HTLCs across chains
 */

import { ethers } from 'ethers';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { Logger } from 'pino';
import { AppConfig } from '../config/index';
import { getMetrics } from '../monitoring/prometheus-metrics';
import { ConnectionPoolManager } from '../../../shared/connection-pool';

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

export class PooledRecoveryService {
  private poolManager: ConnectionPoolManager;
  private config: AppConfig;
  private logger: Logger;
  private isRunning: boolean = false;
  private checkInterval: number = 60000; // Check every minute
  private ethereumWallet?: ethers.Wallet;
  private cosmosWallets: Map<string, DirectSecp256k1HdWallet> = new Map();
  private htlcContractAbi: any[];
  private stats: RecoveryStats = {
    lastCheckTime: 0,
    htlcsChecked: 0,
    htlcsRefunded: 0,
    errors: 0
  };
  private maxRetries: number = 3;
  private retryDelay: number = 5000;

  constructor(poolManager: ConnectionPoolManager, config: AppConfig, logger: Logger) {
    this.poolManager = poolManager;
    this.config = config;
    this.logger = logger.child({ component: 'PooledRecoveryService' });
    
    // Define HTLC ABI
    this.htlcContractAbi = [
      'event HTLCCreated(bytes32 indexed htlcId, address indexed sender, address indexed token, uint256 amount, bytes32 hashlock, uint256 timelock, string targetChain, string targetAddress)',
      'function htlcs(bytes32) view returns (address sender, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, string targetChain, string targetAddress)',
      'function refund(bytes32 htlcId)'
    ];
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Recovery service already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting pooled recovery service...');

    try {
      // Initialize wallets
      await this.initializeWallets();

      // Start recovery loop
      this.recoveryLoop();
      
      this.logger.info('Pooled recovery service started');
    } catch (error) {
      this.logger.error({ error }, 'Failed to start recovery service');
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.logger.info('Stopping pooled recovery service...');
  }

  private async initializeWallets(): Promise<void> {
    try {
      // Initialize Ethereum wallet
      this.ethereumWallet = new ethers.Wallet(this.config.ethereum.privateKey);
      
      // Initialize Cosmos wallets for all configured chains
      const cosmosChains = this.config.cosmos.chains || [this.config.cosmos];
      
      for (const chainConfig of cosmosChains) {
        try {
          const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
            chainConfig.mnemonic,
            { prefix: chainConfig.addressPrefix }
          );
          
          this.cosmosWallets.set(chainConfig.chainId, wallet);
          
          this.logger.info({ 
            chainId: chainConfig.chainId 
          }, 'Initialized Cosmos wallet for chain');
        } catch (err) {
          this.logger.error({ 
            error: err, 
            chainId: chainConfig.chainId 
          }, 'Failed to initialize Cosmos wallet for chain');
        }
      }

      this.logger.info({
        ethereum: !!this.ethereumWallet,
        cosmosChains: Array.from(this.cosmosWallets.keys())
      }, 'Recovery service wallets initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize wallets');
      throw error;
    }
  }

  private async recoveryLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.checkExpiredHTLCs();
        this.stats.lastCheckTime = Date.now();
      } catch (error) {
        this.logger.error({ error }, 'Error in recovery loop');
        this.stats.errors++;
      }

      await this.sleep(this.checkInterval);
    }
  }

  private async checkExpiredHTLCs(): Promise<void> {
    const startTime = Date.now();
    const metrics = getMetrics();
    
    // Record check start
    metrics.recordRecoveryCheck('started');
    
    this.logger.debug('Checking for expired HTLCs...');

    // Check Ethereum HTLCs
    await this.checkEthereumHTLCs();

    // Check Cosmos HTLCs
    await this.checkCosmosHTLCs();

    // Record check completion
    const duration = (Date.now() - startTime) / 1000;
    metrics.recordRecoveryCheck('completed', duration);
    
    this.logger.info({
      checked: this.stats.htlcsChecked,
      refunded: this.stats.htlcsRefunded,
      errors: this.stats.errors,
      duration
    }, 'Recovery check completed');
  }

  private async checkEthereumHTLCs(): Promise<void> {
    const ethereumNetwork = this.config.ethereum.chainId === 1 ? 'mainnet' : 
                           this.config.ethereum.chainId === 11155111 ? 'sepolia' : 
                           'localhost';

    try {
      await this.poolManager.withEthereumContract(
        ethereumNetwork,
        this.config.ethereum.htlcContractAddress,
        this.htlcContractAbi,
        async (contract, provider) => {
          // Connect wallet to provider
          const connectedWallet = this.ethereumWallet!.connect(provider);
          const connectedContract = contract.connect(connectedWallet);

          // Get recent HTLC creation events
          const currentBlock = await provider.getBlockNumber();
          const fromBlock = Math.max(0, currentBlock - 10000); // Look back ~1.5 days on Ethereum

          const filter = contract.filters.HTLCCreated();
          const events = await contract.queryFilter(filter, fromBlock, currentBlock);

          this.logger.debug({ 
            eventCount: events.length,
            fromBlock,
            currentBlock 
          }, 'Found Ethereum HTLC events');

          // Check each HTLC
          for (const event of events) {
            try {
              const htlcId = event.args!.htlcId;
              const htlc = await connectedContract.htlcs(htlcId);
              
              // Skip if already processed
              if (htlc.withdrawn || htlc.refunded) {
                continue;
              }

              this.stats.htlcsChecked++;

              // Check if expired
              const currentTime = Math.floor(Date.now() / 1000);
              if (htlc.timelock < currentTime) {
                // Check if sender (only sender can refund)
                const senderAddress = await connectedWallet.getAddress();
                if (htlc.sender.toLowerCase() === senderAddress.toLowerCase()) {
                  this.logger.info({ 
                    htlcId, 
                    timelock: htlc.timelock,
                    currentTime,
                    sender: htlc.sender 
                  }, 'Found expired Ethereum HTLC eligible for refund');
                  
                  await this.refundEthereumHTLCWithRetry(connectedContract, htlcId);
                } else {
                  this.logger.debug({ 
                    htlcId,
                    sender: htlc.sender,
                    ourAddress: senderAddress
                  }, 'Expired HTLC but we are not the sender');
                }
              }
            } catch (err) {
              this.logger.error({ 
                error: err, 
                htlcId: event.args?.htlcId 
              }, 'Failed to check individual Ethereum HTLC');
              this.stats.errors++;
            }
          }
        }
      );
    } catch (error) {
      this.logger.error({ error }, 'Failed to check Ethereum HTLCs');
      this.stats.errors++;
    }
  }

  private async checkCosmosHTLCs(): Promise<void> {
    const cosmosChains = this.config.cosmos.chains || [this.config.cosmos];

    for (const chainConfig of cosmosChains) {
      try {
        const wallet = this.cosmosWallets.get(chainConfig.chainId);
        if (!wallet) {
          this.logger.warn({ chainId: chainConfig.chainId }, 'No wallet for chain');
          continue;
        }

        await this.poolManager.withCosmosSigningClient(
          chainConfig.chainId,
          wallet,
          async (client) => {
            // Query for pending HTLCs
            // This would require the contract to expose a query for pending HTLCs
            const [account] = await wallet.getAccounts();
            const senderAddress = account.address;

            // Query HTLCs where we are the sender
            const queryMsg = {
              get_htlcs_by_sender: {
                sender: senderAddress
              }
            };

            try {
              const result = await (client as any).queryContractSmart(
                chainConfig.htlcContractAddress,
                queryMsg
              );

              const htlcs = result.htlcs || [];
              this.logger.debug({ 
                chainId: chainConfig.chainId,
                htlcCount: htlcs.length 
              }, 'Found Cosmos HTLCs');

              // Check each HTLC
              for (const htlc of htlcs) {
                try {
                  // Skip if already processed
                  if (htlc.withdrawn || htlc.refunded) {
                    continue;
                  }

                  this.stats.htlcsChecked++;

                  // Check if expired
                  const currentTime = Math.floor(Date.now() / 1000);
                  if (htlc.timelock < currentTime) {
                    this.logger.info({ 
                      chainId: chainConfig.chainId,
                      htlcId: htlc.id,
                      timelock: htlc.timelock,
                      currentTime 
                    }, 'Found expired Cosmos HTLC eligible for refund');
                    
                    await this.refundCosmosHTLCWithRetry(client, chainConfig, htlc.id);
                  }
                } catch (err) {
                  this.logger.error({ 
                    error: err, 
                    chainId: chainConfig.chainId,
                    htlcId: htlc.id 
                  }, 'Failed to check individual Cosmos HTLC');
                  this.stats.errors++;
                }
              }
            } catch (queryError) {
              // Contract might not support this query
              this.logger.debug({ 
                chainId: chainConfig.chainId,
                error: queryError 
              }, 'Could not query HTLCs by sender');
            }
          }
        );
      } catch (error) {
        this.logger.error({ 
          error, 
          chainId: chainConfig.chainId 
        }, 'Failed to check Cosmos HTLCs for chain');
        this.stats.errors++;
      }
    }
  }

  private async refundEthereumHTLCWithRetry(contract: ethers.Contract, htlcId: string): Promise<void> {
    const startTime = Date.now();
    const metrics = getMetrics();
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Record recovery attempt
        metrics.recordRecoveryAttempt('refund', 'ethereum', 'pending');
        
        await this.refundEthereumHTLC(contract, htlcId);
        
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

  private async refundEthereumHTLC(contract: ethers.Contract, htlcId: string): Promise<void> {
    this.logger.info({ htlcId }, 'Initiating Ethereum HTLC refund');
    
    // Check if HTLC still exists and is refundable
    const htlc = await contract.htlcs(htlcId);
    if (htlc.withdrawn || htlc.refunded) {
      this.logger.warn({ htlcId }, 'HTLC already withdrawn or refunded');
      return;
    }
    
    // Estimate gas to ensure transaction will succeed
    const gasEstimate = await contract.estimateGas.refund(htlcId);
    const gasLimit = gasEstimate.mul(120).div(100); // Add 20% buffer
    
    const tx = await contract.refund(htlcId, {
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

  private async refundCosmosHTLCWithRetry(client: any, chainConfig: any, htlcId: string): Promise<void> {
    const startTime = Date.now();
    const metrics = getMetrics();
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Record recovery attempt
        metrics.recordRecoveryAttempt('refund', chainConfig.chainId, 'pending');
        
        await this.refundCosmosHTLC(client, chainConfig, htlcId);
        
        // Record successful recovery
        const duration = (Date.now() - startTime) / 1000;
        metrics.recordRecoveryAttempt('refund', chainConfig.chainId, 'success', duration);
        
        return; // Success
      } catch (error) {
        const errorType = error instanceof Error ? error.name : 'unknown';
        
        // Record failed attempt
        metrics.recordRecoveryAttempt('refund', chainConfig.chainId, 'failed', undefined, errorType);
        
        this.logger.error({ 
          error, 
          chainId: chainConfig.chainId,
          htlcId, 
          attempt, 
          maxRetries: this.maxRetries 
        }, 'Failed to refund Cosmos HTLC, retrying...');
        
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * attempt); // Exponential backoff
        } else {
          this.stats.errors++;
        }
      }
    }
  }

  private async refundCosmosHTLC(client: any, chainConfig: any, htlcId: string): Promise<void> {
    this.logger.info({ 
      chainId: chainConfig.chainId, 
      htlcId 
    }, 'Initiating Cosmos HTLC refund');
    
    const wallet = this.cosmosWallets.get(chainConfig.chainId);
    if (!wallet) {
      throw new Error(`No wallet for chain ${chainConfig.chainId}`);
    }

    const [account] = await wallet.getAccounts();
    const msg = {
      refund: {
        htlc_id: htlcId
      }
    };
    
    const result = await client.execute(
      account.address,
      chainConfig.htlcContractAddress,
      msg,
      'auto',
      'HTLC refund'
    );
    
    if (result.code !== 0) {
      throw new Error(`Transaction failed: ${result.rawLog}`);
    }
    
    this.stats.htlcsRefunded++;
    this.logger.info({
      chainId: chainConfig.chainId,
      htlcId,
      txHash: result.transactionHash,
      gasUsed: result.gasUsed
    }, 'Cosmos HTLC refunded successfully');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats(): RecoveryStats {
    return { ...this.stats };
  }

  getHealth() {
    return {
      running: this.isRunning,
      lastCheckTime: this.stats.lastCheckTime,
      htlcsChecked: this.stats.htlcsChecked,
      htlcsRefunded: this.stats.htlcsRefunded,
      errors: this.stats.errors,
      poolStats: this.poolManager.getStats()
    };
  }
}
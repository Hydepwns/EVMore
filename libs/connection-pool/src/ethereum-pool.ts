/**
 * Ethereum Connection Pool Implementation
 * Manages ethers.js JsonRpcProvider connections with health checking and load balancing
 */

import { ethers } from 'ethers';
import { Logger } from 'pino';
import { BaseConnectionPool } from './base-pool';
import {
  EthereumPoolConfig,
  EthereumConnection,
  RpcEndpoint,
  PoolError
} from './types';

export class EthereumConnectionPool extends BaseConnectionPool<ethers.providers.JsonRpcProvider> {
  private chainId?: number;

  constructor(config: EthereumPoolConfig, logger: Logger) {
    super(config, logger);
    this.chainId = config.chainId;
  }

  protected async createConnection(endpoint: RpcEndpoint): Promise<EthereumConnection> {
    try {
      const startTime = Date.now();
      
      // Create provider with optimization settings
      const provider = new ethers.providers.JsonRpcProvider({
        url: endpoint.url,
        timeout: endpoint.timeout || this.config.connectionTimeout,
        throttleLimit: (this.config as EthereumPoolConfig).throttleLimit || 10,
        throttleSlotInterval: (this.config as EthereumPoolConfig).throttleSlotInterval || 100
      });
      
      // Test the connection immediately
      let chainId: number | undefined;
      try {
        const network = await provider.getNetwork();
        chainId = network.chainId;
        
        // Verify chain ID if specified
        if (this.chainId && chainId !== this.chainId) {
          throw new Error(`Chain ID mismatch: expected ${this.chainId}, got ${chainId}`);
        }
      } catch (error) {
        throw new PoolError(
          `Failed to connect to ${endpoint.url}: ${error instanceof Error ? error.message : String(error)}`,
          this.config.name,
          endpoint.url,
          error instanceof Error ? error : new Error(String(error))
        );
      }

      const connection: EthereumConnection = {
        connection: provider,
        endpoint: endpoint.url,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        inUse: false,
        isHealthy: true,
        chainId
      };

      // Set up error handling
      provider.on('error', (error) => {
        this.logger.warn({ endpoint: endpoint.url, error }, 'Provider error');
        connection.isHealthy = false;
        this.recordConnectionError(endpoint.url, error);
      });

      // Track connection metrics
      this.stats.createdConnections++;
      this.stats.totalLatency += Date.now() - startTime;

      this.logger.debug({ 
        endpoint: endpoint.url, 
        chainId,
        creationTime: Date.now() - startTime 
      }, 'Created Ethereum connection');

      this.emit('connection_created', {
        type: 'connection_created',
        pool: this.config.name,
        endpoint: endpoint.url,
        data: { chainId, creationTime: Date.now() - startTime },
        timestamp: Date.now()
      });

      return connection;
    } catch (error) {
      this.logger.error({ endpoint: endpoint.url, error }, 'Failed to create Ethereum connection');
      throw error;
    }
  }

  protected async testConnection(connection: EthereumConnection): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      // Simple health check: get latest block number
      const blockNumber = await connection.connection.getBlockNumber();
      
      if (typeof blockNumber !== 'number' || blockNumber <= 0) {
        return false;
      }

      // Update latency metrics
      const latency = Date.now() - startTime;
      this.stats.totalLatency += latency;

      return true;
    } catch (error) {
      this.logger.debug({ endpoint: connection.endpoint, error }, 'Connection health check failed');
      return false;
    }
  }

  protected async closeConnection(connection: EthereumConnection): Promise<void> {
    try {
      // Remove all listeners to prevent memory leaks
      connection.connection.removeAllListeners();
      
      // ethers.js doesn't have an explicit close method, but we can clear internal state
      // The connection will be garbage collected
      connection.isHealthy = false;
      
      this.logger.debug({ endpoint: connection.endpoint }, 'Closed Ethereum connection');

      this.emit('connection_destroyed', {
        type: 'connection_destroyed',
        pool: this.config.name,
        endpoint: connection.endpoint,
        timestamp: Date.now()
      });
    } catch (error) {
      this.logger.warn({ endpoint: connection.endpoint, error }, 'Error closing Ethereum connection');
    }
  }

  /**
   * Get a provider from the pool
   * This is the main interface for clients
   */
  async getProvider(): Promise<{ provider: ethers.providers.JsonRpcProvider; release: () => void }> {
    const connection = await this.getConnection();
    
    return {
      provider: connection.connection,
      release: () => this.releaseConnection(connection)
    };
  }

  /**
   * Execute a function with a provider from the pool
   * Automatically handles connection acquisition and release
   */
  async withProvider<T>(fn: (provider: ethers.providers.JsonRpcProvider) => Promise<T>): Promise<T> {
    const { provider, release } = await this.getProvider();
    const startTime = Date.now();
    
    try {
      const result = await fn(provider);
      
      // Track latency for this operation
      const latency = Date.now() - startTime;
      this.stats.totalLatency += latency;
      
      return result;
    } finally {
      release();
    }
  }

  /**
   * Get provider for contract interaction
   * Returns a provider that can be used with ethers.Contract
   */
  async getContractProvider(contractAddress: string, abi: ethers.ContractInterface): Promise<{
    contract: ethers.Contract;
    provider: ethers.providers.JsonRpcProvider;
    release: () => void;
  }> {
    const { provider, release } = await this.getProvider();
    const contract = new ethers.Contract(contractAddress, abi, provider);
    
    return {
      contract,
      provider,
      release
    };
  }

  /**
   * Execute a contract method with automatic connection management
   */
  async withContract<T>(
    contractAddress: string,
    abi: ethers.ContractInterface,
    fn: (contract: ethers.Contract, provider: ethers.providers.JsonRpcProvider) => Promise<T>
  ): Promise<T> {
    const { contract, provider, release } = await this.getContractProvider(contractAddress, abi);
    
    try {
      return await fn(contract, provider);
    } finally {
      release();
    }
  }

  private recordConnectionError(endpointUrl: string, error: Error): void {
    this.emit('error', {
      type: 'error',
      pool: this.config.name,
      endpoint: endpointUrl,
      data: { error: error.message, stack: error.stack },
      timestamp: Date.now()
    });
  }
}
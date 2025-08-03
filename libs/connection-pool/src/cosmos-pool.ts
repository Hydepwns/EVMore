/**
 * Cosmos Connection Pool Implementation
 * Manages CosmJS StargateClient and SigningStargateClient connections
 */

import { StargateClient, SigningStargateClient, GasPrice } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { Logger } from 'pino';
import { BaseConnectionPool } from './base-pool';
import {
  CosmosPoolConfig,
  CosmosQueryConnection,
  CosmosSigningConnection,
  RpcEndpoint,
  PoolError
} from './types';

export class CosmosQueryConnectionPool extends BaseConnectionPool<StargateClient> {
  private chainId: string;

  constructor(config: CosmosPoolConfig, logger: Logger) {
    super(config, logger);
    this.chainId = config.chainId;
  }

  protected async createConnection(endpoint: RpcEndpoint): Promise<CosmosQueryConnection> {
    try {
      const startTime = Date.now();
      
      // Create StargateClient with timeout
      const client = await StargateClient.connect(endpoint.url);
      
      // Test the connection
      try {
        const chainId = await client.getChainId();
        if (chainId !== this.chainId) {
          throw new Error(`Chain ID mismatch: expected ${this.chainId}, got ${chainId}`);
        }
        
        // Additional health check - get latest block
        await client.getHeight();
      } catch (error) {
        client.disconnect();
        throw new PoolError(
          `Failed to connect to ${endpoint.url}: ${error instanceof Error ? error.message : String(error)}`,
          this.config.name,
          endpoint.url,
          error instanceof Error ? error : new Error(String(error))
        );
      }

      const connection: CosmosQueryConnection = {
        connection: client,
        endpoint: endpoint.url,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        inUse: false,
        isHealthy: true,
        chainId: this.chainId
      };

      this.stats.createdConnections++;
      this.stats.totalLatency += Date.now() - startTime;

      this.logger.debug({ 
        endpoint: endpoint.url, 
        chainId: this.chainId,
        creationTime: Date.now() - startTime 
      }, 'Created Cosmos query connection');

      this.emit('connection_created', {
        type: 'connection_created',
        pool: this.config.name,
        endpoint: endpoint.url,
        data: { chainId: this.chainId, creationTime: Date.now() - startTime },
        timestamp: Date.now()
      });

      return connection;
    } catch (error) {
      this.logger.error({ endpoint: endpoint.url, error }, 'Failed to create Cosmos query connection');
      throw error;
    }
  }

  protected async testConnection(connection: CosmosQueryConnection): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      // Health check: get chain ID and latest height
      const [chainId, height] = await Promise.all([
        connection.connection.getChainId(),
        connection.connection.getHeight()
      ]);
      
      if (chainId !== this.chainId || typeof height !== 'number' || height <= 0) {
        return false;
      }

      const latency = Date.now() - startTime;
      this.stats.totalLatency += latency;

      return true;
    } catch (error) {
      this.logger.debug({ endpoint: connection.endpoint, error }, 'Cosmos connection health check failed');
      return false;
    }
  }

  protected async closeConnection(connection: CosmosQueryConnection): Promise<void> {
    try {
      connection.connection.disconnect();
      connection.isHealthy = false;
      
      this.logger.debug({ endpoint: connection.endpoint }, 'Closed Cosmos query connection');

      this.emit('connection_destroyed', {
        type: 'connection_destroyed',
        pool: this.config.name,
        endpoint: connection.endpoint,
        timestamp: Date.now()
      });
    } catch (error) {
      this.logger.warn({ endpoint: connection.endpoint, error }, 'Error closing Cosmos connection');
    }
  }

  /**
   * Get a client from the pool
   */
  async getClient(): Promise<{ client: StargateClient; release: () => void }> {
    const connection = await this.getConnection();
    
    return {
      client: connection.connection,
      release: () => this.releaseConnection(connection)
    };
  }

  /**
   * Execute a function with a client from the pool
   */
  async withClient<T>(fn: (client: StargateClient) => Promise<T>): Promise<T> {
    const { client, release } = await this.getClient();
    
    try {
      return await fn(client);
    } finally {
      release();
    }
  }
}

export class CosmosSigningConnectionPool extends BaseConnectionPool<SigningStargateClient> {
  private chainId: string;
  // private _addressPrefix: string; // Reserved for future use
  private gasPrice?: GasPrice;

  constructor(config: CosmosPoolConfig, logger: Logger) {
    super(config, logger);
    this.chainId = config.chainId;
    // this._addressPrefix = config.addressPrefix; // Reserved for future use
    if (config.gasPrice) {
      this.gasPrice = GasPrice.fromString(config.gasPrice);
    }
  }

  protected async createConnection(_endpoint: RpcEndpoint): Promise<CosmosSigningConnection> {
    throw new Error('Cannot create signing connection without wallet. Use createConnectionWithWallet instead.');
  }

  /**
   * Create a signing connection with a specific wallet
   */
  async createConnectionWithWallet(
    endpoint: RpcEndpoint, 
    wallet: DirectSecp256k1HdWallet
  ): Promise<CosmosSigningConnection> {
    try {
      const startTime = Date.now();
      
      // Create SigningStargateClient
      const clientOptions = this.gasPrice ? { gasPrice: this.gasPrice } : undefined;
      const client = await SigningStargateClient.connectWithSigner(
        endpoint.url,
        wallet,
        clientOptions
      );
      
      // Test the connection
      try {
        const chainId = await client.getChainId();
        if (chainId !== this.chainId) {
          throw new Error(`Chain ID mismatch: expected ${this.chainId}, got ${chainId}`);
        }
        
        // Verify wallet can sign for this chain
        const accounts = await wallet.getAccounts();
        if (accounts.length === 0) {
          throw new Error('Wallet has no accounts');
        }
        
        // Test getting account info
        await client.getAccount(accounts[0].address);
      } catch (error) {
        client.disconnect();
        throw new PoolError(
          `Failed to connect to ${endpoint.url}: ${error instanceof Error ? error.message : String(error)}`,
          this.config.name,
          endpoint.url,
          error instanceof Error ? error : new Error(String(error))
        );
      }

      const connection: CosmosSigningConnection = {
        connection: client,
        endpoint: endpoint.url,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        inUse: false,
        isHealthy: true,
        chainId: this.chainId,
        wallet
      };

      this.stats.createdConnections++;
      this.stats.totalLatency += Date.now() - startTime;

      this.logger.debug({ 
        endpoint: endpoint.url, 
        chainId: this.chainId,
        creationTime: Date.now() - startTime 
      }, 'Created Cosmos signing connection');

      return connection;
    } catch (error) {
      this.logger.error({ endpoint: endpoint.url, error }, 'Failed to create Cosmos signing connection');
      throw error;
    }
  }

  protected async testConnection(connection: CosmosSigningConnection): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      const [chainId, height] = await Promise.all([
        connection.connection.getChainId(),
        connection.connection.getHeight()
      ]);
      
      if (chainId !== this.chainId || typeof height !== 'number' || height <= 0) {
        return false;
      }

      // Test wallet access
      const accounts = await connection.wallet.getAccounts();
      if (accounts.length === 0) {
        return false;
      }

      const latency = Date.now() - startTime;
      this.stats.totalLatency += latency;

      return true;
    } catch (error) {
      this.logger.debug({ endpoint: connection.endpoint, error }, 'Cosmos signing connection health check failed');
      return false;
    }
  }

  protected async closeConnection(connection: CosmosSigningConnection): Promise<void> {
    try {
      connection.connection.disconnect();
      connection.isHealthy = false;
      
      this.logger.debug({ endpoint: connection.endpoint }, 'Closed Cosmos signing connection');

      this.emit('connection_destroyed', {
        type: 'connection_destroyed',
        pool: this.config.name,
        endpoint: connection.endpoint,
        timestamp: Date.now()
      });
    } catch (error) {
      this.logger.warn({ endpoint: connection.endpoint, error }, 'Error closing Cosmos signing connection');
    }
  }

  /**
   * Get a signing client with a specific wallet
   */
  async getSigningClient(wallet: DirectSecp256k1HdWallet): Promise<{
    client: SigningStargateClient;
    release: () => void;
  }> {
    // For signing clients, we might want to create them on-demand
    // or maintain separate pools per wallet
    const endpoint = this.selectHealthyEndpoint();
    if (!endpoint) {
      throw new Error('No healthy endpoints available');
    }

    const connection = await this.createConnectionWithWallet(endpoint, wallet);
    
    return {
      client: connection.connection,
      release: () => {
        this.closeConnection(connection);
      }
    };
  }

  /**
   * Execute a function with a signing client
   */
  async withSigningClient<T>(
    wallet: DirectSecp256k1HdWallet,
    fn: (client: SigningStargateClient) => Promise<T>
  ): Promise<T> {
    const { client, release } = await this.getSigningClient(wallet);
    
    try {
      return await fn(client);
    } finally {
      release();
    }
  }

  private selectHealthyEndpoint(): RpcEndpoint | null {
    const healthyEndpoints = this.config.endpoints.filter(endpoint => {
      const health = this.endpointHealth.get(endpoint.url);
      const breaker = this.circuitBreakers.get(endpoint.url);
      return health?.isHealthy && !breaker?.isOpen;
    });

    if (healthyEndpoints.length === 0) {
      return null;
    }

    // Simple round-robin for now
    return healthyEndpoints[Math.floor(Math.random() * healthyEndpoints.length)];
  }
}
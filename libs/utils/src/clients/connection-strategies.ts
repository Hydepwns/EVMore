/**
 * Connection Strategy Pattern for HTLC Clients
 * Enables pluggable connection management (direct vs pooled)
 */

// Import ethers types without instantiation to avoid bundling issues
type JsonRpcProvider = any; // Will be ethers.JsonRpcProvider in consumer

/**
 * Generic connection strategy interface
 */
export interface ConnectionStrategy<T> {
  getConnection(): Promise<T>;
  releaseConnection(connection: T): void;
  dispose?(): Promise<void>;
}

/**
 * Direct connection strategy (no pooling)
 * Creates new connections as needed
 */
export class DirectConnectionStrategy implements ConnectionStrategy<JsonRpcProvider> {
  constructor(private rpcUrl: string) {}

  async getConnection(): Promise<JsonRpcProvider> {
    // Use compatibility utility to create provider
    const { createProvider } = await import('../ethers/ethers-utils');
    return await createProvider(this.rpcUrl);
  }

  releaseConnection(_connection: JsonRpcProvider): void {
    // No cleanup needed for direct connections
  }

  async dispose(): Promise<void> {
    // No cleanup needed for direct connections
  }
}

/**
 * Pooled connection strategy
 * Uses connection pool for better resource management
 */
export class PooledConnectionStrategy implements ConnectionStrategy<JsonRpcProvider> {
  constructor(private connectionPool: any) {} // EthereumConnectionPool type

  async getConnection(): Promise<JsonRpcProvider> {
    return await this.connectionPool.getConnection();
  }

  releaseConnection(connection: JsonRpcProvider): void {
    this.connectionPool.releaseConnection(connection);
  }

  async dispose(): Promise<void> {
    if (this.connectionPool.dispose) {
      await this.connectionPool.dispose();
    }
  }
}

/**
 * Cosmos connection strategies
 */
export interface CosmosConnectionStrategy<T> extends ConnectionStrategy<T> {}

export class DirectCosmosQueryStrategy implements CosmosConnectionStrategy<any> {
  constructor(private rpcUrl: string) {}

  async getConnection(): Promise<any> {
    // Import StargateClient dynamically to avoid bundling issues
    const { StargateClient } = await import('@cosmjs/stargate');
    return await StargateClient.connect(this.rpcUrl);
  }

  releaseConnection(connection: any): void {
    if (connection.disconnect) {
      connection.disconnect();
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}

export class PooledCosmosQueryStrategy implements CosmosConnectionStrategy<any> {
  constructor(private connectionPool: any) {} // CosmosQueryConnectionPool type

  async getConnection(): Promise<any> {
    return await this.connectionPool.getConnection();
  }

  releaseConnection(connection: any): void {
    this.connectionPool.releaseConnection(connection);
  }

  async dispose(): Promise<void> {
    if (this.connectionPool.dispose) {
      await this.connectionPool.dispose();
    }
  }
}

export class DirectCosmosSigningStrategy implements CosmosConnectionStrategy<any> {
  constructor(
    private rpcUrl: string,
    private wallet: any // DirectSecp256k1HdWallet
  ) {}

  async getConnection(): Promise<any> {
    const { SigningStargateClient } = await import('@cosmjs/stargate');
    return await SigningStargateClient.connectWithSigner(this.rpcUrl, this.wallet);
  }

  releaseConnection(connection: any): void {
    if (connection.disconnect) {
      connection.disconnect();
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}

export class PooledCosmosSigningStrategy implements CosmosConnectionStrategy<any> {
  constructor(private connectionPool: any) {} // CosmosSigningConnectionPool type

  async getConnection(): Promise<any> {
    return await this.connectionPool.getConnection();
  }

  releaseConnection(connection: any): void {
    this.connectionPool.releaseConnection(connection);
  }

  async dispose(): Promise<void> {
    if (this.connectionPool.dispose) {
      await this.connectionPool.dispose();
    }
  }
}

/**
 * Factory functions for creating connection strategies
 */
export class ConnectionStrategyFactory {
  /**
   * Create Ethereum connection strategy
   */
  static createEthereumStrategy(
    type: 'direct' | 'pooled',
    config: { rpcUrl?: string; connectionPool?: any }
  ): ConnectionStrategy<JsonRpcProvider> {
    switch (type) {
      case 'direct':
        if (!config.rpcUrl) {
          throw new Error('rpcUrl required for direct connection strategy');
        }
        return new DirectConnectionStrategy(config.rpcUrl);
      
      case 'pooled':
        if (!config.connectionPool) {
          throw new Error('connectionPool required for pooled connection strategy');
        }
        return new PooledConnectionStrategy(config.connectionPool);
      
      default:
        throw new Error(`Unknown strategy type: ${type}`);
    }
  }

  /**
   * Create Cosmos query connection strategy
   */
  static createCosmosQueryStrategy(
    type: 'direct' | 'pooled',
    config: { rpcUrl?: string; connectionPool?: any }
  ): CosmosConnectionStrategy<any> {
    switch (type) {
      case 'direct':
        if (!config.rpcUrl) {
          throw new Error('rpcUrl required for direct connection strategy');
        }
        return new DirectCosmosQueryStrategy(config.rpcUrl);
      
      case 'pooled':
        if (!config.connectionPool) {
          throw new Error('connectionPool required for pooled connection strategy');
        }
        return new PooledCosmosQueryStrategy(config.connectionPool);
      
      default:
        throw new Error(`Unknown strategy type: ${type}`);
    }
  }

  /**
   * Create Cosmos signing connection strategy
   */
  static createCosmosSigningStrategy(
    type: 'direct' | 'pooled',
    config: { rpcUrl?: string; wallet?: any; connectionPool?: any }
  ): CosmosConnectionStrategy<any> {
    switch (type) {
      case 'direct':
        if (!config.rpcUrl || !config.wallet) {
          throw new Error('rpcUrl and wallet required for direct connection strategy');
        }
        return new DirectCosmosSigningStrategy(config.rpcUrl, config.wallet);
      
      case 'pooled':
        if (!config.connectionPool) {
          throw new Error('connectionPool required for pooled connection strategy');
        }
        return new PooledCosmosSigningStrategy(config.connectionPool);
      
      default:
        throw new Error(`Unknown strategy type: ${type}`);
    }
  }
}

/**
 * Utility type for connection strategy types
 */
export type EthereumConnectionType = 'direct' | 'pooled';
export type CosmosConnectionType = 'direct' | 'pooled';

/**
 * Connection strategy configuration
 */
export interface ConnectionStrategyConfig {
  type: 'direct' | 'pooled';
  rpcUrl?: string;
  connectionPool?: any;
  wallet?: any; // For Cosmos signing
}
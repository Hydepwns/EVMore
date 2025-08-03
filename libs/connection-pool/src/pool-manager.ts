/**
 * Connection Pool Manager
 * Central manager for all RPC connection pools with monitoring and metrics
 */

import { EventEmitter } from 'events';
import { Logger } from 'pino';
import { EthereumConnectionPool } from './ethereum-pool';
import { CosmosQueryConnectionPool, CosmosSigningConnectionPool } from './cosmos-pool';
import {
  EthereumPoolConfig,
  CosmosPoolConfig,
  PoolStats,
  PoolManagerConfig,
  PoolManagerStats
} from './types';

// Re-export pool classes for index.ts
export { BaseConnectionPool } from './base-pool';
export { EthereumConnectionPool } from './ethereum-pool';
export { CosmosQueryConnectionPool, CosmosSigningConnectionPool } from './cosmos-pool';

export class ConnectionPoolManager extends EventEmitter {
  private logger: Logger;
  private config: PoolManagerConfig;
  private ethereumPools: Map<string, EthereumConnectionPool> = new Map();
  private cosmosQueryPools: Map<string, CosmosQueryConnectionPool> = new Map();
  private cosmosSigningPools: Map<string, CosmosSigningConnectionPool> = new Map();
  private isRunning: boolean = false;
  private metricsTimer?: NodeJS.Timeout;

  constructor(config: PoolManagerConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'ConnectionPoolManager' });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Pool manager already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting connection pool manager');

    // Initialize Ethereum pools
    if (this.config.ethereum) {
      for (const [networkName, poolConfig] of Object.entries(this.config.ethereum)) {
        if (poolConfig) {
          const pool = new EthereumConnectionPool(poolConfig, this.logger);
          this.ethereumPools.set(networkName, pool);
          
          // Forward pool events
          pool.on('connection_created', (event) => this.emit('pool_event', event));
          pool.on('connection_destroyed', (event) => this.emit('pool_event', event));
          pool.on('health_check', (event) => this.emit('pool_event', event));
          pool.on('circuit_breaker', (event) => this.emit('pool_event', event));
          pool.on('error', (event) => this.emit('pool_event', event));
          
          await pool.start();
        }
      }
    }

    // Initialize Cosmos pools
    if (this.config.cosmos) {
      for (const [chainId, poolConfig] of Object.entries(this.config.cosmos)) {
        // Query pool
        const queryPool = new CosmosQueryConnectionPool(poolConfig, this.logger);
        this.cosmosQueryPools.set(chainId, queryPool);
        
        // Forward events
        queryPool.on('connection_created', (event) => this.emit('pool_event', event));
        queryPool.on('connection_destroyed', (event) => this.emit('pool_event', event));
        queryPool.on('health_check', (event) => this.emit('pool_event', event));
        queryPool.on('circuit_breaker', (event) => this.emit('pool_event', event));
        queryPool.on('error', (event) => this.emit('pool_event', event));
        
        await queryPool.start();

        // Signing pool (started but connections created on-demand)
        const signingPool = new CosmosSigningConnectionPool(poolConfig, this.logger);
        this.cosmosSigningPools.set(chainId, signingPool);
        
        signingPool.on('connection_created', (event) => this.emit('pool_event', event));
        signingPool.on('connection_destroyed', (event) => this.emit('pool_event', event));
        signingPool.on('health_check', (event) => this.emit('pool_event', event));
        signingPool.on('circuit_breaker', (event) => this.emit('pool_event', event));
        signingPool.on('error', (event) => this.emit('pool_event', event));
        
        await signingPool.start();
      }
    }

    // Start metrics collection
    this.startMetricsCollection();

    this.logger.info({
      ethereumPools: this.ethereumPools.size,
      cosmosQueryPools: this.cosmosQueryPools.size,
      cosmosSigningPools: this.cosmosSigningPools.size
    }, 'Connection pool manager started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.logger.info('Stopping connection pool manager');

    // Stop metrics collection
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    // Stop all pools
    const stopPromises: Promise<void>[] = [];

    for (const pool of this.ethereumPools.values()) {
      stopPromises.push(pool.stop());
    }

    for (const pool of this.cosmosQueryPools.values()) {
      stopPromises.push(pool.stop());
    }

    for (const pool of this.cosmosSigningPools.values()) {
      stopPromises.push(pool.stop());
    }

    await Promise.allSettled(stopPromises);

    this.ethereumPools.clear();
    this.cosmosQueryPools.clear();
    this.cosmosSigningPools.clear();

    this.logger.info('Connection pool manager stopped');
  }

  // Ethereum pool access methods
  getEthereumPool(network: string): EthereumConnectionPool | undefined {
    return this.ethereumPools.get(network);
  }

  async getEthereumProvider(network: string) {
    const pool = this.ethereumPools.get(network);
    if (!pool) {
      throw new Error(`Ethereum pool not found for network: ${network}`);
    }
    return pool.getProvider();
  }

  async withEthereumProvider<T>(
    network: string, 
    fn: (provider: any) => Promise<T>
  ): Promise<T> {
    const pool = this.ethereumPools.get(network);
    if (!pool) {
      throw new Error(`Ethereum pool not found for network: ${network}`);
    }
    return pool.withProvider(fn);
  }

  async withEthereumContract<T>(
    network: string,
    contractAddress: string,
    abi: any,
    fn: (contract: any, provider: any) => Promise<T>
  ): Promise<T> {
    const pool = this.ethereumPools.get(network);
    if (!pool) {
      throw new Error(`Ethereum pool not found for network: ${network}`);
    }
    return pool.withContract(contractAddress, abi, fn);
  }

  // Cosmos pool access methods
  getCosmosQueryPool(chainId: string): CosmosQueryConnectionPool | undefined {
    return this.cosmosQueryPools.get(chainId);
  }

  getCosmosSigningPool(chainId: string): CosmosSigningConnectionPool | undefined {
    return this.cosmosSigningPools.get(chainId);
  }

  async getCosmosQueryClient(chainId: string) {
    const pool = this.cosmosQueryPools.get(chainId);
    if (!pool) {
      throw new Error(`Cosmos query pool not found for chain: ${chainId}`);
    }
    return pool.getClient();
  }

  async withCosmosQueryClient<T>(
    chainId: string,
    fn: (client: any) => Promise<T>
  ): Promise<T> {
    const pool = this.cosmosQueryPools.get(chainId);
    if (!pool) {
      throw new Error(`Cosmos query pool not found for chain: ${chainId}`);
    }
    return pool.withClient(fn);
  }

  async withCosmosSigningClient<T>(
    chainId: string,
    wallet: any,
    fn: (client: any) => Promise<T>
  ): Promise<T> {
    const pool = this.cosmosSigningPools.get(chainId);
    if (!pool) {
      throw new Error(`Cosmos signing pool not found for chain: ${chainId}`);
    }
    return pool.withSigningClient(wallet, fn);
  }

  // Monitoring and stats
  getStats(): PoolManagerStats {
    const pools: PoolStats[] = [];
    let totalConnections = 0;
    let totalRequestsServed = 0;
    let totalLatency = 0;
    let totalLatencyCount = 0;
    const unhealthyPools: string[] = [];
    const circuitBreakersPopen: string[] = [];

    // Collect Ethereum pool stats
    for (const [name, pool] of this.ethereumPools) {
      const stats = pool.getStats();
      pools.push(stats);
      totalConnections += stats.totalConnections;
      totalRequestsServed += stats.requestsServed;
      
      if (stats.averageLatency > 0) {
        totalLatency += stats.averageLatency * stats.requestsServed;
        totalLatencyCount += stats.requestsServed;
      }
      
      if (stats.endpoints.some(e => !e.isHealthy)) {
        unhealthyPools.push(`ethereum-${name}`);
      }
      
      if (stats.circuitBreakerOpen) {
        circuitBreakersPopen.push(`ethereum-${name}`);
      }
    }

    // Collect Cosmos query pool stats
    for (const [chainId, pool] of this.cosmosQueryPools) {
      const stats = pool.getStats();
      pools.push(stats);
      totalConnections += stats.totalConnections;
      totalRequestsServed += stats.requestsServed;
      
      if (stats.averageLatency > 0) {
        totalLatency += stats.averageLatency * stats.requestsServed;
        totalLatencyCount += stats.requestsServed;
      }
      
      if (stats.endpoints.some(e => !e.isHealthy)) {
        unhealthyPools.push(`cosmos-query-${chainId}`);
      }
      
      if (stats.circuitBreakerOpen) {
        circuitBreakersPopen.push(`cosmos-query-${chainId}`);
      }
    }

    // Collect Cosmos signing pool stats
    for (const [chainId, pool] of this.cosmosSigningPools) {
      const stats = pool.getStats();
      pools.push(stats);
      totalConnections += stats.totalConnections;
      totalRequestsServed += stats.requestsServed;
      
      if (stats.averageLatency > 0) {
        totalLatency += stats.averageLatency * stats.requestsServed;
        totalLatencyCount += stats.requestsServed;
      }
      
      if (stats.endpoints.some(e => !e.isHealthy)) {
        unhealthyPools.push(`cosmos-signing-${chainId}`);
      }
      
      if (stats.circuitBreakerOpen) {
        circuitBreakersPopen.push(`cosmos-signing-${chainId}`);
      }
    }

    return {
      totalPools: pools.length,
      activePools: pools.filter(p => p.totalConnections > 0).length,
      totalConnections,
      activeConnections: pools.reduce((sum, p) => sum + p.activeConnections, 0),
      totalRequests: pools.reduce((sum, p) => sum + p.requestsServed, 0),
      totalRequestsServed: pools.reduce((sum, p) => sum + p.requestsServed, 0),
      averageLatency: totalLatencyCount > 0 ? totalLatency / totalLatencyCount : 0,
      pools,
      unhealthyPools,
      circuitBreakersPopen
    };
  }

  // Dynamic pool management
  async addEthereumPool(network: string, config: EthereumPoolConfig): Promise<void> {
    if (this.ethereumPools.has(network)) {
      throw new Error(`Ethereum pool already exists for network: ${network}`);
    }

    const pool = new EthereumConnectionPool(config, this.logger);
    
    // Forward events
    pool.on('connection_created', (event) => this.emit('pool_event', event));
    pool.on('connection_destroyed', (event) => this.emit('pool_event', event));
    pool.on('health_check', (event) => this.emit('pool_event', event));
    pool.on('circuit_breaker', (event) => this.emit('pool_event', event));
    pool.on('error', (event) => this.emit('pool_event', event));
    
    this.ethereumPools.set(network, pool);
    
    if (this.isRunning) {
      await pool.start();
    }
    
    this.logger.info({ network }, 'Added Ethereum pool');
  }

  async removeEthereumPool(network: string): Promise<void> {
    const pool = this.ethereumPools.get(network);
    if (!pool) {
      throw new Error(`Ethereum pool not found for network: ${network}`);
    }

    await pool.stop();
    this.ethereumPools.delete(network);
    
    this.logger.info({ network }, 'Removed Ethereum pool');
  }

  async addCosmosPool(chainId: string, config: CosmosPoolConfig): Promise<void> {
    if (this.cosmosQueryPools.has(chainId)) {
      throw new Error(`Cosmos pool already exists for chain: ${chainId}`);
    }

    // Create query pool
    const queryPool = new CosmosQueryConnectionPool(config, this.logger);
    queryPool.on('connection_created', (event) => this.emit('pool_event', event));
    queryPool.on('connection_destroyed', (event) => this.emit('pool_event', event));
    queryPool.on('health_check', (event) => this.emit('pool_event', event));
    queryPool.on('circuit_breaker', (event) => this.emit('pool_event', event));
    queryPool.on('error', (event) => this.emit('pool_event', event));
    
    this.cosmosQueryPools.set(chainId, queryPool);

    // Create signing pool
    const signingPool = new CosmosSigningConnectionPool(config, this.logger);
    signingPool.on('connection_created', (event) => this.emit('pool_event', event));
    signingPool.on('connection_destroyed', (event) => this.emit('pool_event', event));
    signingPool.on('health_check', (event) => this.emit('pool_event', event));
    signingPool.on('circuit_breaker', (event) => this.emit('pool_event', event));
    signingPool.on('error', (event) => this.emit('pool_event', event));
    
    this.cosmosSigningPools.set(chainId, signingPool);

    if (this.isRunning) {
      await Promise.all([queryPool.start(), signingPool.start()]);
    }
    
    this.logger.info({ chainId }, 'Added Cosmos pools');
  }

  async removeCosmosPool(chainId: string): Promise<void> {
    const queryPool = this.cosmosQueryPools.get(chainId);
    const signingPool = this.cosmosSigningPools.get(chainId);

    if (!queryPool || !signingPool) {
      throw new Error(`Cosmos pools not found for chain: ${chainId}`);
    }

    await Promise.all([queryPool.stop(), signingPool.stop()]);
    this.cosmosQueryPools.delete(chainId);
    this.cosmosSigningPools.delete(chainId);
    
    this.logger.info({ chainId }, 'Removed Cosmos pools');
  }

  private startMetricsCollection(): void {
    const interval = this.config.monitoring?.metricsInterval || 30000; // 30 seconds
    
    this.metricsTimer = setInterval(() => {
      const stats = this.getStats();
      
      if (this.config.monitoring?.logStats) {
        this.logger.info(stats, 'Connection pool stats');
      }
      
      this.emit('stats', stats);
      
      // Emit warnings for unhealthy pools
      if (stats.unhealthyPools.length > 0) {
        this.logger.warn({ unhealthyPools: stats.unhealthyPools }, 'Unhealthy connection pools detected');
      }
      
      if (stats.circuitBreakersPopen.length > 0) {
        this.logger.warn({ circuitBreakers: stats.circuitBreakersPopen }, 'Circuit breakers open');
      }
    }, interval);
  }
}
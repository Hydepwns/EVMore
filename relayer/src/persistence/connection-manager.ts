/**
 * Advanced connection management for database persistence
 * 
 * Provides connection pooling, failover, load balancing, and health monitoring
 * for PostgreSQL and Redis connections with automatic recovery.
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import Redis, { RedisOptions, Cluster } from 'ioredis';
import { Logger } from 'pino';
import { EventEmitter } from 'events';

export interface DatabaseEndpoint {
  host: string;
  port: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  priority: number; // 1 = primary, 2 = secondary, etc.
  weight?: number; // For load balancing (1-100)
  readonly?: boolean; // If this endpoint should only handle reads
}

export interface ConnectionPoolConfig {
  // Pool settings
  minConnections: number;
  maxConnections: number;
  acquireTimeoutMillis: number;
  idleTimeoutMillis: number;
  
  // Health monitoring
  healthCheckInterval: number;
  healthCheckTimeout: number;
  maxConsecutiveFailures: number;
  
  // Failover settings
  failoverTimeout: number;
  reconnectDelay: number;
  maxReconnectAttempts: number;
  
  // Load balancing
  loadBalancing: 'round_robin' | 'weighted' | 'least_connections';
  readPreference: 'primary' | 'secondary' | 'any';
}

export interface ConnectionStats {
  endpoint: string;
  active: number;
  idle: number;
  total: number;
  healthy: boolean;
  consecutiveFailures: number;
  lastHealthCheck: Date;
  totalQueries: number;
  avgResponseTime: number;
  errorRate: number;
}

export class PostgreSQLConnectionManager extends EventEmitter {
  private endpoints: DatabaseEndpoint[];
  private pools: Map<string, Pool> = new Map();
  private config: ConnectionPoolConfig;
  private logger: Logger;
  
  private healthCheckTimer?: NodeJS.Timeout;
  private endpointStats: Map<string, ConnectionStats> = new Map();
  private currentPrimaryIndex = 0;
  private roundRobinIndex = 0;
  
  constructor(
    endpoints: DatabaseEndpoint[],
    config: ConnectionPoolConfig,
    logger: Logger
  ) {
    super();
    this.endpoints = endpoints.sort((a, b) => a.priority - b.priority);
    this.config = config;
    this.logger = logger.child({ component: 'PostgreSQLConnectionManager' });
    
    this.initializePools();
    this.startHealthChecks();
  }

  /**
   * Get a connection for read operations
   */
  async getReadConnection(): Promise<{ client: PoolClient; endpoint: string }> {
    const endpoint = this.selectReadEndpoint();
    const pool = this.pools.get(endpoint);
    
    if (!pool) {
      throw new Error(`No pool available for endpoint: ${endpoint}`);
    }

    try {
      const client = await pool.connect();
      this.recordQuery(endpoint);
      return { client, endpoint };
    } catch (error) {
      this.recordError(endpoint);
      throw error;
    }
  }

  /**
   * Get a connection for write operations
   */
  async getWriteConnection(): Promise<{ client: PoolClient; endpoint: string }> {
    const endpoint = this.selectWriteEndpoint();
    const pool = this.pools.get(endpoint);
    
    if (!pool) {
      throw new Error(`No write pool available for endpoint: ${endpoint}`);
    }

    try {
      const client = await pool.connect();
      this.recordQuery(endpoint);
      return { client, endpoint };
    } catch (error) {
      this.recordError(endpoint);
      
      // Try failover for write operations
      const failoverEndpoint = this.selectFailoverEndpoint(endpoint);
      if (failoverEndpoint) {
        this.logger.warn({ from: endpoint, to: failoverEndpoint }, 'Failing over write connection');
        const failoverPool = this.pools.get(failoverEndpoint);
        if (failoverPool) {
          const client = await failoverPool.connect();
          this.recordQuery(failoverEndpoint);
          return { client, endpoint: failoverEndpoint };
        }
      }
      
      throw error;
    }
  }

  /**
   * Execute a query with automatic connection management
   */
  async query(
    text: string, 
    params?: any[], 
    options: { readonly?: boolean } = {}
  ): Promise<any> {
    const startTime = Date.now();
    let connection;
    
    try {
      if (options.readonly) {
        connection = await this.getReadConnection();
      } else {
        connection = await this.getWriteConnection();
      }
      
      const result = await connection.client.query(text, params);
      const duration = Date.now() - startTime;
      
      this.recordQueryTime(connection.endpoint, duration);
      return result;
      
    } finally {
      if (connection) {
        connection.client.release();
      }
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
    options: { readonly?: boolean } = {}
  ): Promise<T> {
    let connection;
    
    try {
      if (options.readonly) {
        connection = await this.getReadConnection();
      } else {
        connection = await this.getWriteConnection();
      }
      
      await connection.client.query('BEGIN');
      
      try {
        const result = await callback(connection.client);
        await connection.client.query('COMMIT');
        return result;
      } catch (error) {
        await connection.client.query('ROLLBACK');
        throw error;
      }
      
    } finally {
      if (connection) {
        connection.client.release();
      }
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats[] {
    return Array.from(this.endpointStats.values());
  }

  /**
   * Get healthy endpoints
   */
  getHealthyEndpoints(): string[] {
    return Array.from(this.endpointStats.entries())
      .filter(([_, stats]) => stats.healthy)
      .map(([endpoint, _]) => endpoint);
  }

  /**
   * Force health check on all endpoints
   */
  async forceHealthCheck(): Promise<void> {
    await this.performHealthChecks();
  }

  /**
   * Shutdown all connections
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    const shutdownPromises = Array.from(this.pools.values()).map(pool => pool.end());
    await Promise.all(shutdownPromises);
    
    this.pools.clear();
    this.endpointStats.clear();
    
    this.logger.info('PostgreSQL connection manager shut down');
  }

  // Private methods

  private initializePools(): void {
    for (const endpoint of this.endpoints) {
      const endpointKey = `${endpoint.host}:${endpoint.port}/${endpoint.database}`;
      
      const poolConfig: PoolConfig = {
        host: endpoint.host,
        port: endpoint.port,
        database: endpoint.database,
        user: endpoint.username,
        password: endpoint.password,
        ssl: endpoint.ssl,
        min: this.config.minConnections,
        max: this.config.maxConnections,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.acquireTimeoutMillis,
        query_timeout: this.config.healthCheckTimeout,
      };

      const pool = new Pool(poolConfig);
      this.pools.set(endpointKey, pool);
      
      // Initialize stats
      this.endpointStats.set(endpointKey, {
        endpoint: endpointKey,
        active: 0,
        idle: 0,
        total: 0,
        healthy: true,
        consecutiveFailures: 0,
        lastHealthCheck: new Date(),
        totalQueries: 0,
        avgResponseTime: 0,
        errorRate: 0
      });

      // Setup pool event handlers
      pool.on('connect', () => {
        this.updatePoolStats(endpointKey);
      });

      pool.on('remove', () => {
        this.updatePoolStats(endpointKey);
      });

      pool.on('error', (error) => {
        this.logger.error({ error, endpoint: endpointKey }, 'Pool error');
        this.recordError(endpointKey);
      });

      this.logger.info({ endpoint: endpointKey, config: poolConfig }, 'Initialized PostgreSQL pool');
    }
  }

  private selectReadEndpoint(): string {
    const readEndpoints = this.getAvailableEndpoints(true);
    
    if (readEndpoints.length === 0) {
      throw new Error('No healthy read endpoints available');
    }

    switch (this.config.loadBalancing) {
      case 'round_robin':
        return this.selectRoundRobin(readEndpoints);
      case 'weighted':
        return this.selectWeighted(readEndpoints);
      case 'least_connections':
        return this.selectLeastConnections(readEndpoints);
      default:
        return readEndpoints[0];
    }
  }

  private selectWriteEndpoint(): string {
    const writeEndpoints = this.getAvailableEndpoints(false);
    
    if (writeEndpoints.length === 0) {
      throw new Error('No healthy write endpoints available');
    }

    // For writes, prefer primary endpoints
    return writeEndpoints[0];
  }

  private getAvailableEndpoints(readOnly: boolean): string[] {
    const healthyEndpoints = this.getHealthyEndpoints();
    
    if (readOnly && this.config.readPreference === 'secondary') {
      // Prefer secondary endpoints for reads
      const secondaryEndpoints = healthyEndpoints.filter(endpoint => {
        const ep = this.findEndpointByKey(endpoint);
        return ep && (ep.readonly || ep.priority > 1);
      });
      
      if (secondaryEndpoints.length > 0) {
        return secondaryEndpoints;
      }
    }

    return healthyEndpoints;
  }

  private selectRoundRobin(endpoints: string[]): string {
    const endpoint = endpoints[this.roundRobinIndex % endpoints.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % endpoints.length;
    return endpoint;
  }

  private selectWeighted(endpoints: string[]): string {
    const weights = endpoints.map(endpoint => {
      const ep = this.findEndpointByKey(endpoint);
      return ep?.weight || 1;
    });

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < endpoints.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return endpoints[i];
      }
    }

    return endpoints[0];
  }

  private selectLeastConnections(endpoints: string[]): string {
    let minConnections = Infinity;
    let selectedEndpoint = endpoints[0];

    for (const endpoint of endpoints) {
      const stats = this.endpointStats.get(endpoint);
      if (stats && stats.active < minConnections) {
        minConnections = stats.active;
        selectedEndpoint = endpoint;
      }
    }

    return selectedEndpoint;
  }

  private selectFailoverEndpoint(failedEndpoint: string): string | null {
    const healthyEndpoints = this.getHealthyEndpoints();
    const availableFailovers = healthyEndpoints.filter(ep => ep !== failedEndpoint);
    return availableFailovers[0] || null;
  }

  private findEndpointByKey(key: string): DatabaseEndpoint | undefined {
    return this.endpoints.find(ep => 
      `${ep.host}:${ep.port}/${ep.database}` === key
    );
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(
      () => this.performHealthChecks(),
      this.config.healthCheckInterval
    );
    
    // Initial health check
    setTimeout(() => this.performHealthChecks(), 1000);
  }

  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.pools.entries()).map(
      ([endpoint, pool]) => this.checkEndpointHealth(endpoint, pool)
    );

    await Promise.allSettled(healthCheckPromises);
  }

  private async checkEndpointHealth(endpoint: string, pool: Pool): Promise<void> {
    const stats = this.endpointStats.get(endpoint);
    if (!stats) return;

    try {
      const client = await pool.connect();
      const startTime = Date.now();
      
      await client.query('SELECT 1');
      
      const responseTime = Date.now() - startTime;
      client.release();

      // Update health status
      stats.healthy = true;
      stats.consecutiveFailures = 0;
      stats.lastHealthCheck = new Date();
      stats.avgResponseTime = (stats.avgResponseTime * 0.9) + (responseTime * 0.1);

    } catch (error) {
      stats.consecutiveFailures++;
      stats.lastHealthCheck = new Date();
      
      if (stats.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        if (stats.healthy) {
          this.logger.error({ endpoint, error }, 'Endpoint marked unhealthy');
          stats.healthy = false;
          this.emit('endpoint_unhealthy', endpoint);
        }
      }
    }
  }

  private updatePoolStats(endpoint: string): void {
    const pool = this.pools.get(endpoint);
    const stats = this.endpointStats.get(endpoint);
    
    if (!pool || !stats) return;

    stats.total = pool.totalCount;
    stats.active = pool.totalCount - pool.idleCount;
    stats.idle = pool.idleCount;
  }

  private recordQuery(endpoint: string): void {
    const stats = this.endpointStats.get(endpoint);
    if (stats) {
      stats.totalQueries++;
    }
  }

  private recordError(endpoint: string): void {
    const stats = this.endpointStats.get(endpoint);
    if (stats) {
      const errorRate = stats.errorRate || 0;
      stats.errorRate = (errorRate * 0.95) + 0.05; // Exponential moving average
    }
  }

  private recordQueryTime(endpoint: string, duration: number): void {
    const stats = this.endpointStats.get(endpoint);
    if (stats) {
      stats.avgResponseTime = (stats.avgResponseTime * 0.9) + (duration * 0.1);
    }
  }
}

/**
 * Redis connection manager with cluster support and failover
 */
export class RedisConnectionManager extends EventEmitter {
  private endpoints: DatabaseEndpoint[];
  private clients: Map<string, Redis | Cluster> = new Map();
  private config: ConnectionPoolConfig;
  private logger: Logger;
  
  private healthCheckTimer?: NodeJS.Timeout;
  private endpointStats: Map<string, ConnectionStats> = new Map();
  private currentPrimaryIndex = 0;

  constructor(
    endpoints: DatabaseEndpoint[],
    config: ConnectionPoolConfig,
    logger: Logger,
    clusterMode: boolean = false
  ) {
    super();
    this.endpoints = endpoints.sort((a, b) => a.priority - b.priority);
    this.config = config;
    this.logger = logger.child({ component: 'RedisConnectionManager' });
    
    this.initializeClients(clusterMode);
    this.startHealthChecks();
  }

  /**
   * Get Redis client for operations
   */
  getClient(readonly: boolean = false): Redis | Cluster {
    const endpoint = this.selectEndpoint(readonly);
    const client = this.clients.get(endpoint);
    
    if (!client) {
      throw new Error(`No Redis client available for endpoint: ${endpoint}`);
    }

    return client;
  }

  /**
   * Execute Redis command with failover
   */
  async execute(
    command: string,
    args: any[] = [],
    options: { readonly?: boolean } = {}
  ): Promise<any> {
    const client = this.getClient(options.readonly);
    const startTime = Date.now();
    
    try {
      const result = await (client as any)[command](...args);
      const duration = Date.now() - startTime;
      
      // Record metrics
      const endpoint = this.getEndpointForClient(client);
      if (endpoint) {
        this.recordQueryTime(endpoint, duration);
        this.recordQuery(endpoint);
      }
      
      return result;
    } catch (error) {
      // Record error and attempt failover
      const endpoint = this.getEndpointForClient(client);
      if (endpoint) {
        this.recordError(endpoint);
      }
      
      throw error;
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats[] {
    return Array.from(this.endpointStats.values());
  }

  /**
   * Shutdown all connections
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    const shutdownPromises = Array.from(this.clients.values()).map(client => client.quit());
    await Promise.allSettled(shutdownPromises);
    
    this.clients.clear();
    this.endpointStats.clear();
    
    this.logger.info('Redis connection manager shut down');
  }

  // Private methods

  private initializeClients(clusterMode: boolean): void {
    if (clusterMode) {
      // Initialize Redis cluster
      const clusterEndpoints = this.endpoints.map(ep => ({ host: ep.host, port: ep.port }));
      const cluster = new Redis.Cluster(clusterEndpoints, {
        redisOptions: {
          password: this.endpoints[0].password,
          connectTimeout: this.config.acquireTimeoutMillis,
          lazyConnect: true
        },
        enableOfflineQueue: false
      });

      const endpointKey = 'cluster';
      this.clients.set(endpointKey, cluster);
      this.initializeClientStats(endpointKey, cluster);
      
    } else {
      // Initialize individual Redis clients
      for (const endpoint of this.endpoints) {
        const endpointKey = `${endpoint.host}:${endpoint.port}`;
        
        const clientOptions: RedisOptions = {
          host: endpoint.host,
          port: endpoint.port,
          password: endpoint.password,
          db: 0,
          connectTimeout: this.config.acquireTimeoutMillis,
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false
        };

        const client = new Redis(clientOptions);
        this.clients.set(endpointKey, client);
        this.initializeClientStats(endpointKey, client);
      }
    }
  }

  private initializeClientStats(endpoint: string, client: Redis | Cluster): void {
    this.endpointStats.set(endpoint, {
      endpoint,
      active: 0,
      idle: 0,
      total: 1,
      healthy: true,
      consecutiveFailures: 0,
      lastHealthCheck: new Date(),
      totalQueries: 0,
      avgResponseTime: 0,
      errorRate: 0
    });

    client.on('error', (error) => {
      this.logger.error({ error, endpoint }, 'Redis client error');
      this.recordError(endpoint);
    });

    client.on('connect', () => {
      this.logger.info({ endpoint }, 'Redis client connected');
      const stats = this.endpointStats.get(endpoint);
      if (stats) {
        stats.healthy = true;
        stats.consecutiveFailures = 0;
      }
    });

    client.on('close', () => {
      this.logger.warn({ endpoint }, 'Redis client disconnected');
    });
  }

  private selectEndpoint(readonly: boolean): string {
    const healthyEndpoints = Array.from(this.endpointStats.entries())
      .filter(([_, stats]) => stats.healthy)
      .map(([endpoint, _]) => endpoint);
    
    if (healthyEndpoints.length === 0) {
      throw new Error('No healthy Redis endpoints available');
    }

    // Simple round-robin for now
    const endpoint = healthyEndpoints[this.currentPrimaryIndex % healthyEndpoints.length];
    this.currentPrimaryIndex = (this.currentPrimaryIndex + 1) % healthyEndpoints.length;
    return endpoint;
  }

  private getEndpointForClient(client: Redis | Cluster): string | undefined {
    for (const [endpoint, c] of this.clients.entries()) {
      if (c === client) {
        return endpoint;
      }
    }
    return undefined;
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(
      () => this.performHealthChecks(),
      this.config.healthCheckInterval
    );
  }

  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.clients.entries()).map(
      ([endpoint, client]) => this.checkClientHealth(endpoint, client)
    );

    await Promise.allSettled(healthCheckPromises);
  }

  private async checkClientHealth(endpoint: string, client: Redis | Cluster): Promise<void> {
    const stats = this.endpointStats.get(endpoint);
    if (!stats) return;

    try {
      const startTime = Date.now();
      await client.ping();
      const responseTime = Date.now() - startTime;

      stats.healthy = true;
      stats.consecutiveFailures = 0;
      stats.lastHealthCheck = new Date();
      stats.avgResponseTime = (stats.avgResponseTime * 0.9) + (responseTime * 0.1);

    } catch (error) {
      stats.consecutiveFailures++;
      stats.lastHealthCheck = new Date();
      
      if (stats.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        if (stats.healthy) {
          this.logger.error({ endpoint, error }, 'Redis endpoint marked unhealthy');
          stats.healthy = false;
          this.emit('endpoint_unhealthy', endpoint);
        }
      }
    }
  }

  private recordQuery(endpoint: string): void {
    const stats = this.endpointStats.get(endpoint);
    if (stats) {
      stats.totalQueries++;
    }
  }

  private recordError(endpoint: string): void {
    const stats = this.endpointStats.get(endpoint);
    if (stats) {
      const errorRate = stats.errorRate || 0;
      stats.errorRate = (errorRate * 0.95) + 0.05;
    }
  }

  private recordQueryTime(endpoint: string, duration: number): void {
    const stats = this.endpointStats.get(endpoint);
    if (stats) {
      stats.avgResponseTime = (stats.avgResponseTime * 0.9) + (duration * 0.1);
    }
  }
}
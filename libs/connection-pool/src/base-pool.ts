/**
 * Base Connection Pool Implementation
 * Provides core pooling functionality with health checking and circuit breaker
 */

import { EventEmitter } from 'events';
import { Logger } from 'pino';
import {
  PoolConfig,
  RpcEndpoint,
  PoolConnection,
  ConnectionHealth,
  PoolStats,
  PoolEvent,
  PoolError,
  CircuitBreakerError,
  NoHealthyEndpointsError
} from './types';

export abstract class BaseConnectionPool<T> extends EventEmitter {
  protected config: PoolConfig;
  protected logger: Logger;
  protected connections: Map<string, PoolConnection<T>[]> = new Map(); // endpoint -> connections
  protected circuitBreakers: Map<string, { isOpen: boolean; openedAt: number; errorCount: number }> = new Map();
  protected endpointHealth: Map<string, ConnectionHealth> = new Map();
  protected isRunning: boolean = false;
  protected healthCheckTimer?: NodeJS.Timeout;
  protected cleanupTimer?: NodeJS.Timeout;
  protected stats = {
    requestsServed: 0,
    totalLatency: 0,
    createdConnections: 0,
    destroyedConnections: 0
  };

  constructor(config: PoolConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: `ConnectionPool-${config.name}` });
    
    // Initialize endpoint health tracking
    for (const endpoint of config.endpoints) {
      this.endpointHealth.set(endpoint.url, {
        url: endpoint.url,
        isHealthy: true,
        latency: 0,
        lastCheck: 0,
        errorCount: 0
      });
      
      this.circuitBreakers.set(endpoint.url, {
        isOpen: false,
        openedAt: 0,
        errorCount: 0
      });
      
      this.connections.set(endpoint.url, []);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Pool already running');
      return;
    }

    this.isRunning = true;
    this.logger.info({ config: this.config }, 'Starting connection pool');

    // Pre-warm connections to minimum
    await this.prewarmConnections();

    // Start health checking
    this.startHealthChecking();
    
    // Start cleanup timer
    this.startCleanupTimer();

    this.emit('poolStarted', { pool: this.config.name } as PoolEvent);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.logger.info('Stopping connection pool');

    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Close all connections
    await this.closeAllConnections();

    this.emit('poolStopped', { pool: this.config.name } as PoolEvent);
  }

  async getConnection(): Promise<PoolConnection<T>> {
    if (!this.isRunning) {
      throw new PoolError('Pool not running', this.config.name);
    }

    // Find best endpoint using weighted round-robin
    const endpoint = this.selectEndpoint();
    if (!endpoint) {
      throw new NoHealthyEndpointsError(this.config.name);
    }

    // Check circuit breaker
    const breaker = this.circuitBreakers.get(endpoint.url);
    if (breaker?.isOpen) {
      throw new CircuitBreakerError(this.config.name, endpoint.url);
    }

    const connections = this.connections.get(endpoint.url) || [];
    
    // Try to find an idle connection
    let connection = connections.find(conn => !conn.inUse && conn.isHealthy);
    
    if (!connection) {
      // Create new connection if under limit
      const maxConnections = endpoint.maxConnections ?? this.config.maxConnections;
      if (connections.length >= maxConnections) {
        // Only try alternative endpoints if this endpoint is truly at max capacity
        // and we have other healthy endpoints available with capacity
        const alternativeEndpoint = this.selectAlternativeEndpointWithCapacity(endpoint.url);
        if (alternativeEndpoint) {
          return this.getConnectionFromEndpoint(alternativeEndpoint);
        }
        // Throw error when max connections reached and no alternatives
        throw new PoolError(`Max connections reached for ${endpoint.url}`, this.config.name, endpoint.url);
      }
      connection = await this.createConnection(endpoint);
      connections.push(connection);
      this.connections.set(endpoint.url, connections);
    }

    // Mark as in use
    connection.inUse = true;
    connection.lastUsed = Date.now();
    this.stats.requestsServed++;

    return connection;
  }

  releaseConnection(connection: PoolConnection<T>): void {
    connection.inUse = false;
    const now = Date.now();
    const latency = now - connection.lastUsed;
    
    // Record latency for this request
    this.stats.totalLatency += latency;
    
    this.emit('connectionReleased', {
      type: 'connection_released',
      pool: this.config.name,
      endpoint: connection.endpoint,
      timestamp: now
    } as PoolEvent);
  }

  getStats(): PoolStats {
    const endpoints = Array.from(this.endpointHealth.values());
    let totalConnections = 0;
    let activeConnections = 0;
    let idleConnections = 0;
    let failedConnections = 0;

    for (const [, connections] of this.connections) {
      totalConnections += connections.length;
      activeConnections += connections.filter(c => c.inUse).length;
      idleConnections += connections.filter(c => !c.inUse && c.isHealthy).length;
      failedConnections += connections.filter(c => !c.isHealthy).length;
    }

    const circuitBreakerOpen = Array.from(this.circuitBreakers.values()).some(b => b.isOpen);

    return {
      name: this.config.name,
      totalConnections,
      activeConnections,
      idleConnections,
      failedConnections,
      requestsServed: this.stats.requestsServed,
      averageLatency: this.stats.requestsServed > 0 ? this.stats.totalLatency / this.stats.requestsServed : 0,
      endpoints,
      circuitBreakerOpen
    };
  }

  // Abstract methods to be implemented by specific pool types
  protected abstract createConnection(endpoint: RpcEndpoint): Promise<PoolConnection<T>>;
  protected abstract testConnection(connection: PoolConnection<T>): Promise<boolean>;
  protected abstract closeConnection(connection: PoolConnection<T>): Promise<void>;

  private selectEndpoint(): RpcEndpoint | null {
    const healthyEndpoints = this.config.endpoints.filter(endpoint => {
      const health = this.endpointHealth.get(endpoint.url);
      const breaker = this.circuitBreakers.get(endpoint.url);
      return health?.isHealthy && !breaker?.isOpen;
    });

    if (healthyEndpoints.length === 0) {
      return null;
    }

    // Simple weighted round-robin selection
    // Calculate total weight and use modulo to distribute requests
    const totalWeight = healthyEndpoints.reduce((sum, endpoint) => sum + (endpoint.weight || 1), 0);
    const requestCount = this.stats.requestsServed;
    const selectedIndex = requestCount % totalWeight;
    
    let currentWeight = 0;
    for (const endpoint of healthyEndpoints) {
      currentWeight += endpoint.weight || 1;
      if (selectedIndex < currentWeight) {
        return endpoint;
      }
    }
    
    // Fallback to first endpoint
    return healthyEndpoints[0];
  }



  private selectAlternativeEndpointWithCapacity(excludeUrl: string): RpcEndpoint | null {
    const healthyEndpoints = this.config.endpoints.filter(endpoint => {
      if (endpoint.url === excludeUrl) return false;
      const health = this.endpointHealth.get(endpoint.url);
      const breaker = this.circuitBreakers.get(endpoint.url);
      if (!health?.isHealthy || breaker?.isOpen) return false;
      
      // Check if this endpoint has capacity
      const connections = this.connections.get(endpoint.url) || [];
      const maxConnections = endpoint.maxConnections ?? this.config.maxConnections;
      return connections.length < maxConnections;
    });

    if (healthyEndpoints.length === 0) {
      return null;
    }

    // Simple round-robin for alternative selection
    const requestCount = this.stats.requestsServed;
    const selectedIndex = requestCount % healthyEndpoints.length;
    return healthyEndpoints[selectedIndex];
  }

  private async getConnectionFromEndpoint(endpoint: RpcEndpoint): Promise<PoolConnection<T>> {
    const connections = this.connections.get(endpoint.url) || [];
    
    // Try to find an idle connection
    let connection = connections.find(conn => !conn.inUse && conn.isHealthy);
    
    if (!connection) {
      // Create new connection if under limit
      const maxConnections = endpoint.maxConnections ?? this.config.maxConnections;
      if (connections.length >= maxConnections) {
        throw new PoolError(`Max connections reached for ${endpoint.url}`, this.config.name, endpoint.url);
      }
      connection = await this.createConnection(endpoint);
      connections.push(connection);
      this.connections.set(endpoint.url, connections);
    }

    // Mark as in use
    connection.inUse = true;
    connection.lastUsed = Date.now();
    this.stats.requestsServed++;

    return connection;
  }

  private async prewarmConnections(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const endpoint of this.config.endpoints) {
      const targetConnections = Math.max(1, Math.floor(this.config.minConnections / this.config.endpoints.length));
      
      for (let i = 0; i < targetConnections; i++) {
        promises.push(
          this.createConnection(endpoint)
            .then(connection => {
              const connections = this.connections.get(endpoint.url) || [];
              connections.push(connection);
              this.connections.set(endpoint.url, connections);
            })
            .catch(error => {
              this.logger.warn({ endpoint: endpoint.url, error }, 'Failed to prewarm connection');
              this.recordError(endpoint.url, error);
            })
        );
      }
    }

    await Promise.allSettled(promises);
    this.logger.info('Connection prewarming completed');
  }

  private startHealthChecking(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      await this.cleanupIdleConnections();
    }, this.config.idleTimeout / 2);
  }

  private async performHealthChecks(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [endpointUrl, connections] of this.connections) {
      promises.push(
        this.performEndpointHealthCheck(endpointUrl, connections)
      );
    }

    await Promise.allSettled(promises);
  }

  private async performEndpointHealthCheck(endpointUrl: string, connections: PoolConnection<T>[]): Promise<void> {
    const startTime = Date.now();
    let isHealthy = false;
    let error: Error | undefined;

    try {
      // Test a sample connection or create a test connection
      const testConnection = connections.find(c => !c.inUse) || await this.createConnection(
        this.config.endpoints.find(e => e.url === endpointUrl)!
      );

      isHealthy = await this.testConnection(testConnection);

      // If we created a test connection, clean it up
      if (!connections.includes(testConnection)) {
        await this.closeConnection(testConnection);
      }
    } catch (err) {
      error = err as Error;
      isHealthy = false;
    }

    const latency = Date.now() - startTime;
    const health = this.endpointHealth.get(endpointUrl)!;
    
    health.isHealthy = isHealthy;
    health.latency = latency;
    health.lastCheck = Date.now();
    
    if (error) {
      health.errorCount++;
      health.lastError = error.message;
      this.recordError(endpointUrl, error);
    } else {
      health.errorCount = Math.max(0, health.errorCount - 1);
    }

    this.emit('health_check', {
      type: 'health_check',
      pool: this.config.name,
      endpoint: endpointUrl,
      data: { isHealthy, latency, error: error?.message },
      timestamp: Date.now()
    } as PoolEvent);
  }

  private recordError(endpointUrl: string, _error: Error): void {
    const breaker = this.circuitBreakers.get(endpointUrl)!;
    breaker.errorCount++;

    // Open circuit breaker if threshold exceeded
    if (breaker.errorCount >= this.config.circuitBreakerThreshold && !breaker.isOpen) {
      breaker.isOpen = true;
      breaker.openedAt = Date.now();
      
      this.logger.warn({ endpoint: endpointUrl, errorCount: breaker.errorCount }, 'Circuit breaker opened');
      
      this.emit('circuit_breaker', {
        type: 'circuit_breaker',
        pool: this.config.name,
        endpoint: endpointUrl,
        data: { action: 'opened', errorCount: breaker.errorCount },
        timestamp: Date.now()
      } as PoolEvent);
    }
  }



  private async cleanupIdleConnections(): Promise<void> {
    const now = Date.now();
    
    for (const [endpointUrl, connections] of this.connections) {
      const activeConnections: PoolConnection<T>[] = [];
      
      for (const connection of connections) {
        if (connection.inUse) {
          activeConnections.push(connection);
        } else if (now - connection.lastUsed > this.config.idleTimeout) {
          // Connection is idle, close it
          try {
            await this.closeConnection(connection);
            this.stats.destroyedConnections++;
          } catch (error) {
            this.logger.warn({ endpoint: endpointUrl, error }, 'Error closing idle connection');
          }
        } else {
          activeConnections.push(connection);
        }
      }
      
      this.connections.set(endpointUrl, activeConnections);
    }
  }

  private async closeAllConnections(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [, connections] of this.connections) {
      for (const connection of connections) {
        promises.push(
          this.closeConnection(connection).catch(error => {
            this.logger.warn({ error }, 'Error closing connection during shutdown');
          })
        );
      }
    }
    
    await Promise.allSettled(promises);
    this.connections.clear();
  }
}
# @evmore/connection-pool

RPC connection pooling for blockchain networks.

## Overview

The `@evmore/connection-pool` package provides efficient connection pooling for blockchain RPC endpoints, with automatic failover, load balancing, health checks, and circuit breaker patterns.

## Core Features

- Connection pooling for multiple RPC endpoints
- Automatic failover and load balancing
- Health checks and circuit breakers
- Connection lifecycle management
- Metrics and monitoring
- Rate limiting and throttling

## Connection Pool Manager

```typescript
interface PoolConfig {
  name: string;
  endpoints: string[];
  maxConnections: number;
  minConnections: number;
  connectionTimeout: number;
  idleTimeout: number;
  healthCheckInterval: number;
  circuitBreaker: CircuitBreakerConfig;
  rateLimit: RateLimitConfig;
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  halfOpenMaxAttempts: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  burstSize: number;
}

class ConnectionPoolManager {
  private pools: Map<string, ConnectionPool> = new Map();
  private config: PoolConfig;
  private logger: ILogger;
  private metrics: IMetricsCollector;

  constructor(config: PoolConfig, logger: ILogger, metrics?: IMetricsCollector) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
  }

  async start(): Promise<void> {
    for (const endpoint of this.config.endpoints) {
      const pool = new ConnectionPool(endpoint, this.config, this.logger);
      await pool.start();
      this.pools.set(endpoint, pool);
    }

    this.logger.info('Connection pool manager started', {
      poolCount: this.pools.size,
      totalEndpoints: this.config.endpoints.length
    });
  }

  async stop(): Promise<void> {
    for (const pool of this.pools.values()) {
      await pool.stop();
    }
    this.pools.clear();
  }

  async execute<T>(operation: (connection: RPCConnection) => Promise<T>): Promise<T> {
    const healthyPools = Array.from(this.pools.values()).filter(pool => pool.isHealthy());
    
    if (healthyPools.length === 0) {
      throw new Error('No healthy connection pools available');
    }

    // Round-robin load balancing
    const pool = this.selectPool(healthyPools);
    
    try {
      const result = await pool.execute(operation);
      this.metrics?.increment('pool_requests_success', 1, { pool: pool.name });
      return result;
    } catch (error) {
      this.metrics?.increment('pool_requests_failed', 1, { pool: pool.name });
      throw error;
    }
  }

  private selectPool(pools: ConnectionPool[]): ConnectionPool {
    // Simple round-robin selection
    const index = Math.floor(Math.random() * pools.length);
    return pools[index];
  }

  getStats(): PoolStats {
    const stats: PoolStats = {
      totalPools: this.pools.size,
      healthyPools: 0,
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      failedRequests: 0,
      successfulRequests: 0,
      averageLatency: 0
    };

    for (const pool of this.pools.values()) {
      const poolStats = pool.getStats();
      stats.totalConnections += poolStats.totalConnections;
      stats.activeConnections += poolStats.activeConnections;
      stats.idleConnections += poolStats.idleConnections;
      stats.failedRequests += poolStats.failedRequests;
      stats.successfulRequests += poolStats.successfulRequests;
      
      if (pool.isHealthy()) {
        stats.healthyPools++;
      }
    }

    if (stats.successfulRequests > 0) {
      stats.averageLatency = stats.averageLatency / stats.successfulRequests;
    }

    return stats;
  }
}
```

## Connection Pool

```typescript
class ConnectionPool {
  private name: string;
  private config: PoolConfig;
  private logger: ILogger;
  private connections: RPCConnection[] = [];
  private availableConnections: RPCConnection[] = [];
  private inUseConnections: Set<RPCConnection> = new Set();
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private healthChecker: HealthChecker;
  private stats: PoolStats = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    failedRequests: 0,
    successfulRequests: 0,
    averageLatency: 0
  };

  constructor(endpoint: string, config: PoolConfig, logger: ILogger) {
    this.name = endpoint;
    this.config = config;
    this.logger = logger;
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.healthChecker = new HealthChecker(endpoint, config.healthCheckInterval);
  }

  async start(): Promise<void> {
    // Create initial connections
    for (let i = 0; i < this.config.minConnections; i++) {
      await this.createConnection();
    }

    // Start health checker
    this.healthChecker.start((isHealthy) => {
      if (!isHealthy) {
        this.logger.warn('Pool health check failed', { pool: this.name });
      }
    });

    this.logger.info('Connection pool started', {
      pool: this.name,
      initialConnections: this.config.minConnections
    });
  }

  async stop(): Promise<void> {
    this.healthChecker.stop();
    
    // Close all connections
    for (const connection of this.connections) {
      await connection.close();
    }
    
    this.connections = [];
    this.availableConnections = [];
    this.inUseConnections.clear();
  }

  async execute<T>(operation: (connection: RPCConnection) => Promise<T>): Promise<T> {
    // Check circuit breaker
    if (!this.circuitBreaker.canExecute()) {
      throw new Error('Circuit breaker is open');
    }

    // Check rate limit
    if (!this.rateLimiter.allowRequest()) {
      throw new Error('Rate limit exceeded');
    }

    const connection = await this.getConnection();
    const startTime = Date.now();

    try {
      const result = await operation(connection);
      const latency = Date.now() - startTime;
      
      this.circuitBreaker.recordSuccess();
      this.rateLimiter.recordRequest();
      this.updateStats(true, latency);
      
      return result;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      this.updateStats(false, Date.now() - startTime);
      throw error;
    } finally {
      this.releaseConnection(connection);
    }
  }

  private async getConnection(): Promise<RPCConnection> {
    // Try to get an available connection
    if (this.availableConnections.length > 0) {
      const connection = this.availableConnections.pop()!;
      this.inUseConnections.add(connection);
      return connection;
    }

    // Create new connection if under max limit
    if (this.connections.length < this.config.maxConnections) {
      const connection = await this.createConnection();
      this.inUseConnections.add(connection);
      return connection;
    }

    // Wait for a connection to become available
    return this.waitForConnection();
  }

  private async createConnection(): Promise<RPCConnection> {
    const connection = new RPCConnection(this.name, this.config.connectionTimeout);
    await connection.connect();
    
    this.connections.push(connection);
    this.stats.totalConnections++;
    
    return connection;
  }

  private async waitForConnection(): Promise<RPCConnection> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeout);

      const checkForConnection = () => {
        if (this.availableConnections.length > 0) {
          clearTimeout(timeout);
          const connection = this.availableConnections.pop()!;
          this.inUseConnections.add(connection);
          resolve(connection);
        } else {
          setTimeout(checkForConnection, 10);
        }
      };

      checkForConnection();
    });
  }

  private releaseConnection(connection: RPCConnection): void {
    this.inUseConnections.delete(connection);
    
    if (connection.isHealthy()) {
      this.availableConnections.push(connection);
    } else {
      // Remove unhealthy connection
      const index = this.connections.indexOf(connection);
      if (index > -1) {
        this.connections.splice(index, 1);
        this.stats.totalConnections--;
      }
      connection.close();
    }
  }

  private updateStats(success: boolean, latency: number): void {
    if (success) {
      this.stats.successfulRequests++;
    } else {
      this.stats.failedRequests++;
    }

    // Update average latency
    const totalRequests = this.stats.successfulRequests + this.stats.failedRequests;
    this.stats.averageLatency = (this.stats.averageLatency * (totalRequests - 1) + latency) / totalRequests;
  }

  isHealthy(): boolean {
    return this.circuitBreaker.isClosed() && this.healthChecker.isHealthy();
  }

  getStats(): PoolStats {
    this.stats.activeConnections = this.inUseConnections.size;
    this.stats.idleConnections = this.availableConnections.length;
    return { ...this.stats };
  }
}
```

## Circuit Breaker

```typescript
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  canExecute(): boolean {
    switch (this.state) {
      case 'CLOSED':
        return true;
      case 'OPEN':
        if (Date.now() - this.lastFailureTime > this.config.recoveryTimeout) {
          this.state = 'HALF_OPEN';
          return true;
        }
        return false;
      case 'HALF_OPEN':
        return this.failureCount < this.config.halfOpenMaxAttempts;
      default:
        return false;
    }
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN' || 
        (this.state === 'CLOSED' && this.failureCount >= this.config.failureThreshold)) {
      this.state = 'OPEN';
    }
  }

  isClosed(): boolean {
    return this.state === 'CLOSED';
  }

  isOpen(): boolean {
    return this.state === 'OPEN';
  }

  isHalfOpen(): boolean {
    return this.state === 'HALF_OPEN';
  }
}
```

## Rate Limiter

```typescript
class RateLimiter {
  private requests: number[] = [];
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  allowRequest(): boolean {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.config.windowMs);
    
    // Check if we're under the limit
    if (this.requests.length < this.config.maxRequests) {
      this.requests.push(now);
      return true;
    }
    
    return false;
  }

  recordRequest(): void {
    // Already recorded in allowRequest
  }

  getCurrentUsage(): number {
    return this.requests.length;
  }
}
```

## Health Checker

```typescript
class HealthChecker {
  private endpoint: string;
  private interval: number;
  private timer?: NodeJS.Timeout;
  private isHealthy = true;
  private callback?: (isHealthy: boolean) => void;

  constructor(endpoint: string, interval: number) {
    this.endpoint = endpoint;
    this.interval = interval;
  }

  start(callback: (isHealthy: boolean) => void): void {
    this.callback = callback;
    this.timer = setInterval(() => this.checkHealth(), this.interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async checkHealth(): Promise<void> {
    try {
      const response = await fetch(`${this.endpoint}/health`, {
        method: 'GET',
        timeout: 5000
      });
      
      const healthy = response.ok;
      
      if (healthy !== this.isHealthy) {
        this.isHealthy = healthy;
        this.callback?.(healthy);
      }
    } catch (error) {
      if (this.isHealthy) {
        this.isHealthy = false;
        this.callback?.(false);
      }
    }
  }

  isHealthy(): boolean {
    return this.isHealthy;
  }
}
```

## Usage Examples

```typescript
import { ConnectionPoolManager } from '@evmore/connection-pool';

// Configure connection pools
const poolConfig = {
  name: 'ethereum-pool',
  endpoints: [
    'https://mainnet.infura.io/v3/YOUR_PROJECT_ID',
    'https://eth-mainnet.alchemyapi.io/v2/YOUR_API_KEY',
    'https://rpc.ankr.com/eth'
  ],
  maxConnections: 10,
  minConnections: 2,
  connectionTimeout: 5000,
  idleTimeout: 30000,
  healthCheckInterval: 30000,
  circuitBreaker: {
    failureThreshold: 5,
    recoveryTimeout: 60000,
    halfOpenMaxAttempts: 3
  },
  rateLimit: {
    maxRequests: 100,
    windowMs: 60000,
    burstSize: 10
  }
};

// Initialize pool manager
const poolManager = new ConnectionPoolManager(poolConfig, logger, metrics);
await poolManager.start();

// Execute operations through the pool
try {
  const blockNumber = await poolManager.execute(async (connection) => {
    return await connection.getBlockNumber();
  });
  
  console.log('Current block number:', blockNumber);
} catch (error) {
  console.error('Failed to get block number:', error);
}

// Get pool statistics
const stats = poolManager.getStats();
console.log('Pool stats:', stats);

// Cleanup
await poolManager.stop();
```

## Installation

```bash
npm install @evmore/connection-pool
```

## Development

```bash
# Build connection-pool
npm run build

# Run tests
npm test

# Generate documentation
npm run docs
```

## Contributing

When adding new features:

1. Implement the feature with proper TypeScript types
2. Add comprehensive tests
3. Update documentation
4. Add metrics and monitoring
5. Follow the existing code patterns 
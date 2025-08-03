/**
 * Base Connection Pool Test Suite
 * Comprehensive tests for core pool functionality
 */

import { BaseConnectionPool } from '../base-pool';
import { PoolConfig, RpcEndpoint, PoolConnection } from '../types';
import { Logger } from 'pino';

// Mock implementation for testing
class MockConnectionPool extends BaseConnectionPool<any> {
  private mockConnections: Map<string, any> = new Map();
  private connectionIdCounter = 0;
  
  public mockHealthStatus: Map<string, boolean> = new Map();
  public mockConnectionDelay: number = 10;
  public mockHealthCheckDelay: number = 5;
  public createConnectionCalls: number = 0;
  public testConnectionCalls: number = 0;
  public closeConnectionCalls: number = 0;

  protected async createConnection(endpoint: RpcEndpoint): Promise<PoolConnection<any>> {
    this.createConnectionCalls++;
    
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, this.mockConnectionDelay));
    
    const connectionId = `mock-connection-${++this.connectionIdCounter}`;
    const mockConnection = { id: connectionId, endpoint: endpoint.url };
    this.mockConnections.set(connectionId, mockConnection);
    
    return {
      connection: mockConnection,
      endpoint: endpoint.url,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      inUse: false,
      isHealthy: this.mockHealthStatus.get(endpoint.url) !== false
    };
  }

  protected async testConnection(connection: PoolConnection<any>): Promise<boolean> {
    this.testConnectionCalls++;
    
    // Simulate health check delay
    await new Promise(resolve => setTimeout(resolve, this.mockHealthCheckDelay));
    
    // Return mock health status or default to true
    const healthStatus = this.mockHealthStatus.get(connection.endpoint);
    return healthStatus !== false;
  }

  protected async closeConnection(connection: PoolConnection<any>): Promise<void> {
    this.closeConnectionCalls++;
    this.mockConnections.delete(connection.connection.id);
  }

  // Helper method to set endpoint health for testing
  setEndpointHealth(endpoint: string, isHealthy: boolean): void {
    this.mockHealthStatus.set(endpoint, isHealthy);
  }

  // Helper to simulate connection error
  simulateConnectionError(endpoint: string): void {
    const endpointHealth = this.endpointHealth.get(endpoint);
    if (endpointHealth) {
      endpointHealth.errorCount++;
      endpointHealth.isHealthy = false;
      endpointHealth.lastError = 'Simulated error';
    }
    
    (this as any)['recordError'](endpoint, new Error('Simulated error'));
  }

  // Expose protected method for testing
  public testRecordError(endpoint: string, error: Error): void {
    // Access private method through bracket notation
    (this as any)['recordError'](endpoint, error);
  }
}

describe('BaseConnectionPool', () => {
  let pool: MockConnectionPool;
  let logger: Logger;
  let config: PoolConfig;

  beforeEach(() => {
    logger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    config = {
      name: 'test-pool',
      endpoints: [
        { url: 'http://endpoint1.com', weight: 2, maxConnections: 5 },
        { url: 'http://endpoint2.com', weight: 1, maxConnections: 3 },
        { url: 'http://endpoint3.com', weight: 1, maxConnections: 3 }
      ],
      maxConnections: 10,
      minConnections: 2,
      connectionTimeout: 1000,
      idleTimeout: 5000,
      maxRetries: 3,
      healthCheckInterval: 1000,
      retryDelay: 100,
      circuitBreakerThreshold: 3,
      circuitBreakerTimeout: 2000
    };

    pool = new MockConnectionPool(config, logger);
  });

  afterEach(async () => {
    if (pool) {
      await pool.stop();
    }
  });

  describe('Initialization and Start', () => {
    test('should initialize with correct configuration', () => {
      expect(pool.getStats().name).toBe('test-pool');
      expect(pool.getStats().totalConnections).toBe(0);
      expect(pool.getStats().endpoints).toHaveLength(3);
    });

    test('should prewarm connections on start', async () => {
      await pool.start();
      
      // Should create at least minConnections
      expect(pool.createConnectionCalls).toBeGreaterThanOrEqual(config.minConnections);
      expect(pool.getStats().totalConnections).toBeGreaterThanOrEqual(config.minConnections);
    });

    test('should not start twice', async () => {
      await pool.start();
      const firstCallCount = pool.createConnectionCalls;
      
      await pool.start();
      expect(pool.createConnectionCalls).toBe(firstCallCount);
    });

    test('should emit poolStarted event', async () => {
      const startedPromise = new Promise(resolve => {
        pool.once('poolStarted', resolve);
      });

      await pool.start();
      await expect(startedPromise).resolves.toBeDefined();
    });
  });

  describe('Connection Management', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should get connection from pool', async () => {
      const connection = await pool.getConnection();
      
      expect(connection).toBeDefined();
      expect(connection.inUse).toBe(true);
      expect(connection.isHealthy).toBe(true);
    });

    test('should reuse idle connections', async () => {
      const conn1 = await pool.getConnection();
      const initialCreateCount = pool.createConnectionCalls;
      
      pool.releaseConnection(conn1);
      
      const conn2 = await pool.getConnection();
      expect(pool.createConnectionCalls).toBe(initialCreateCount);
      expect(conn2.connection.id).toBe(conn1.connection.id);
    });

    test('should create new connection when all are in use', async () => {
      const connections = [];
      
      // Get all prewarmed connections
      for (let i = 0; i < config.minConnections; i++) {
        connections.push(await pool.getConnection());
      }
      
      const initialCreateCount = pool.createConnectionCalls;
      
      // Get one more - should create new
      const newConn = await pool.getConnection();
      expect(pool.createConnectionCalls).toBeGreaterThan(initialCreateCount);
      
      // Cleanup
      connections.forEach(conn => pool.releaseConnection(conn));
      pool.releaseConnection(newConn);
    });

    test('should respect max connections per endpoint', async () => {
      // Set endpoint1 to be the only healthy one
      pool.setEndpointHealth('http://endpoint2.com', false);
      pool.setEndpointHealth('http://endpoint3.com', false);
      
      const connections = [];
      const endpoint1Config = config.endpoints[0];
      
      // Get max connections for endpoint1
      for (let i = 0; i < endpoint1Config.maxConnections!; i++) {
        connections.push(await pool.getConnection());
      }
      
      // Try to get one more - should timeout or throw
      pool.mockConnectionDelay = 100; // Make it fail faster
      
      await expect(pool.getConnection()).rejects.toThrow();
      
      // Cleanup
      connections.forEach(conn => pool.releaseConnection(conn));
    });

    test('should handle connection release correctly', async () => {
      const connection = await pool.getConnection();
      const stats1 = pool.getStats();
      
      expect(stats1.activeConnections).toBeGreaterThan(0);
      
      pool.releaseConnection(connection);
      
      const stats2 = pool.getStats();
      expect(stats2.activeConnections).toBe(stats1.activeConnections - 1);
      expect(stats2.idleConnections).toBe(stats1.idleConnections + 1);
    });
  });

  describe('Load Balancing', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should distribute connections based on weights', async () => {
      const endpointCounts = new Map<string, number>();
      const totalRequests = 100;
      
      // Get many connections to test distribution
      for (let i = 0; i < totalRequests; i++) {
        const conn = await pool.getConnection();
        const count = endpointCounts.get(conn.endpoint) || 0;
        endpointCounts.set(conn.endpoint, count + 1);
        pool.releaseConnection(conn);
      }
      
      // Endpoint1 has weight 2, others have weight 1
      // So endpoint1 should get roughly 50% of connections
      const endpoint1Count = endpointCounts.get('http://endpoint1.com') || 0;
      const totalCount = Array.from(endpointCounts.values()).reduce((a, b) => a + b, 0);
      const endpoint1Percentage = endpoint1Count / totalCount;
      
      // Allow some variance due to randomness and other factors
      expect(endpoint1Percentage).toBeGreaterThan(0.4);
      expect(endpoint1Percentage).toBeLessThan(0.6);
    });

    test('should skip unhealthy endpoints', async () => {
      // Mark endpoint1 as unhealthy
      pool.setEndpointHealth('http://endpoint1.com', false);
      pool.simulateConnectionError('http://endpoint1.com');
      
      // Get connections - should not use endpoint1
      const connections = [];
      for (let i = 0; i < 10; i++) {
        connections.push(await pool.getConnection());
      }
      
      const endpoint1Connections = connections.filter(c => c.endpoint === 'http://endpoint1.com');
      expect(endpoint1Connections).toHaveLength(0);
      
      // Cleanup
      connections.forEach(conn => pool.releaseConnection(conn));
    });
  });

  describe('Health Checking', () => {
    beforeEach(async () => {
      pool.mockHealthCheckDelay = 5;
      await pool.start();
    });

    test('should perform periodic health checks', async () => {
      const initialTestCount = pool.testConnectionCalls;
      
      // Wait for health check interval
      await new Promise(resolve => setTimeout(resolve, config.healthCheckInterval + 100));
      
      expect(pool.testConnectionCalls).toBeGreaterThan(initialTestCount);
    });

    test('should update endpoint health status', async () => {
      const endpoint = 'http://endpoint1.com';
      
      // Set endpoint to unhealthy
      pool.setEndpointHealth(endpoint, false);
      
      // Wait for health check
      await new Promise(resolve => setTimeout(resolve, config.healthCheckInterval + 100));
      
      const stats = pool.getStats();
      const endpointHealth = stats.endpoints.find(e => e.url === endpoint);
      
      expect(endpointHealth?.isHealthy).toBe(false);
    });

    test('should emit health check events', async () => {
      const healthCheckPromise = new Promise(resolve => {
        pool.once('health_check', resolve);
      });
      
      // Wait for health check
      await new Promise(resolve => setTimeout(resolve, config.healthCheckInterval + 100));
      
      const event: any = await healthCheckPromise;
      expect(event.type).toBe('health_check');
      expect(event.pool).toBe(config.name);
    });
  });

  describe('Circuit Breaker', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should open circuit breaker on threshold errors', async () => {
      const endpoint = 'http://endpoint1.com';
      
      // Simulate errors up to threshold
      for (let i = 0; i < config.circuitBreakerThreshold; i++) {
        pool.simulateConnectionError(endpoint);
      }
      
      const stats = pool.getStats();
      expect(stats.circuitBreakerOpen).toBe(true);
      
      // Should not be able to get connection from this endpoint
      pool.setEndpointHealth('http://endpoint2.com', false);
      pool.setEndpointHealth('http://endpoint3.com', false);
      
      await expect(pool.getConnection()).rejects.toThrow('No healthy endpoints');
    });

    test('should close circuit breaker after timeout', async () => {
      const endpoint = 'http://endpoint1.com';
      
      // Open circuit breaker
      for (let i = 0; i < config.circuitBreakerThreshold; i++) {
        pool.simulateConnectionError(endpoint);
      }
      
      // Set endpoint back to healthy
      pool.setEndpointHealth(endpoint, true);
      
      // Wait for circuit breaker timeout
      await new Promise(resolve => setTimeout(resolve, config.circuitBreakerTimeout + 100));
      
      // Should be able to get connection now
      const connection = await pool.getConnection();
      expect(connection).toBeDefined();
      pool.releaseConnection(connection);
    });

    test('should emit circuit breaker events', async () => {
      const endpoint = 'http://endpoint1.com';
      
      const circuitBreakerPromise = new Promise(resolve => {
        pool.once('circuit_breaker', resolve);
      });
      
      // Open circuit breaker
      for (let i = 0; i < config.circuitBreakerThreshold; i++) {
        pool.simulateConnectionError(endpoint);
      }
      
      const event: any = await circuitBreakerPromise;
      expect(event.type).toBe('circuit_breaker');
      expect(event.data.action).toBe('opened');
    });
  });

  describe('Connection Cleanup', () => {
    beforeEach(async () => {
      config.idleTimeout = 1000; // 1 second for faster testing
      await pool.start();
    });

    test('should clean up idle connections', async () => {
      // Get and release a connection
      const conn = await pool.getConnection();
      pool.releaseConnection(conn);
      
      const stats1 = pool.getStats();
      const totalBefore = stats1.totalConnections;
      
      // Wait for idle timeout and cleanup
      await new Promise(resolve => setTimeout(resolve, config.idleTimeout + 500));
      
      const stats2 = pool.getStats();
      expect(stats2.totalConnections).toBeLessThan(totalBefore);
    });

    test('should not clean up active connections', async () => {
      // Get a connection and keep it active
      const conn = await pool.getConnection();
      
      const stats1 = pool.getStats();
      
      // Wait for idle timeout
      await new Promise(resolve => setTimeout(resolve, config.idleTimeout + 500));
      
      const stats2 = pool.getStats();
      expect(stats2.activeConnections).toBe(stats1.activeConnections);
      
      pool.releaseConnection(conn);
    });
  });

  describe('Error Handling', () => {
    test('should handle connection creation errors', async () => {
      // Override createConnection to throw error
      // Mock the protected method using bracket notation
      (pool as any)['createConnection'] = jest.fn().mockRejectedValue(new Error('Connection failed'));
      
      // Clear all connections
      await pool.stop();
      await pool.start();
      
      await expect(pool.getConnection()).rejects.toThrow();
    });

    test('should emit error events', async () => {
      const errorPromise = new Promise(resolve => {
        pool.once('error', resolve);
      });
      
      pool.testRecordError('http://endpoint1.com', new Error('Test error'));
      
      const event: any = await errorPromise;
      expect(event.type).toBe('error');
      expect(event.data.error).toBe('Test error');
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await pool.start();
    });

    test('should provide accurate statistics', async () => {
      const conn1 = await pool.getConnection();
      const conn2 = await pool.getConnection();
      
      const stats1 = pool.getStats();
      expect(stats1.activeConnections).toBe(2);
      expect(stats1.totalConnections).toBeGreaterThanOrEqual(2);
      
      pool.releaseConnection(conn1);
      
      const stats2 = pool.getStats();
      expect(stats2.activeConnections).toBe(1);
      expect(stats2.idleConnections).toBeGreaterThan(0);
      
      pool.releaseConnection(conn2);
    });

    test('should track request count', async () => {
      const stats1 = pool.getStats();
      const initialRequests = stats1.requestsServed;
      
      const conn = await pool.getConnection();
      pool.releaseConnection(conn);
      
      const stats2 = pool.getStats();
      expect(stats2.requestsServed).toBe(initialRequests + 1);
    });

    test('should track average latency', async () => {
      // Set a known connection delay
      pool.mockConnectionDelay = 50;
      
      await pool.getConnection();
      
      const stats = pool.getStats();
      expect(stats.averageLatency).toBeGreaterThan(0);
    });
  });

  describe('Shutdown', () => {
    test('should close all connections on stop', async () => {
      await pool.start();
      
      // Get some connections
      const conn1 = await pool.getConnection();
      const conn2 = await pool.getConnection();
      pool.releaseConnection(conn1);
      // Keep conn2 active
      
      const closeCallsBefore = pool.closeConnectionCalls;
      
      await pool.stop();
      
      expect(pool.closeConnectionCalls).toBeGreaterThan(closeCallsBefore);
      expect(pool.getStats().totalConnections).toBe(0);
    });

    test('should emit poolStopped event', async () => {
      await pool.start();
      
      const stoppedPromise = new Promise(resolve => {
        pool.once('poolStopped', resolve);
      });
      
      await pool.stop();
      await expect(stoppedPromise).resolves.toBeDefined();
    });
  });
});
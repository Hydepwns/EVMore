/**
 * Connection Pool Metrics Integration
 * Prometheus metrics for connection pool monitoring
 */

import { Counter, Gauge, Histogram, register } from 'prom-client';
import { PoolStats, PoolEvent } from './types';
import { Logger } from 'pino';

// Metrics definitions
export const connectionPoolMetrics = {
  // Connection counts
  totalConnections: new Gauge({
    name: 'connection_pool_connections_total',
    help: 'Total number of connections in the pool',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  activeConnections: new Gauge({
    name: 'connection_pool_connections_active',
    help: 'Number of active (in-use) connections',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  idleConnections: new Gauge({
    name: 'connection_pool_connections_idle',
    help: 'Number of idle connections',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  failedConnections: new Gauge({
    name: 'connection_pool_connections_failed',
    help: 'Number of failed connections',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  // Request metrics
  requestsTotal: new Counter({
    name: 'connection_pool_requests_total',
    help: 'Total number of requests served by the pool',
    labelNames: ['pool_name', 'pool_type', 'status']
  }),

  requestDuration: new Histogram({
    name: 'connection_pool_request_duration_seconds',
    help: 'Time spent waiting for and using connections',
    labelNames: ['pool_name', 'pool_type'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10]
  }),

  // Connection lifecycle
  connectionsCreated: new Counter({
    name: 'connection_pool_connections_created_total',
    help: 'Total number of connections created',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  connectionsDestroyed: new Counter({
    name: 'connection_pool_connections_destroyed_total',
    help: 'Total number of connections destroyed',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  connectionCreationDuration: new Histogram({
    name: 'connection_pool_connection_creation_duration_seconds',
    help: 'Time spent creating new connections',
    labelNames: ['pool_name', 'pool_type', 'endpoint'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30]
  }),

  // Health metrics
  endpointHealth: new Gauge({
    name: 'connection_pool_endpoint_healthy',
    help: 'Endpoint health status (1 = healthy, 0 = unhealthy)',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  endpointLatency: new Gauge({
    name: 'connection_pool_endpoint_latency_seconds',
    help: 'Endpoint response latency',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  healthChecksTotal: new Counter({
    name: 'connection_pool_health_checks_total',
    help: 'Total number of health checks performed',
    labelNames: ['pool_name', 'pool_type', 'endpoint', 'result']
  }),

  // Circuit breaker metrics
  circuitBreakerState: new Gauge({
    name: 'connection_pool_circuit_breaker_open',
    help: 'Circuit breaker state (1 = open, 0 = closed)',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  circuitBreakerTrips: new Counter({
    name: 'connection_pool_circuit_breaker_trips_total',
    help: 'Total number of circuit breaker trips',
    labelNames: ['pool_name', 'pool_type', 'endpoint']
  }),

  // Error metrics
  errorsTotal: new Counter({
    name: 'connection_pool_errors_total',
    help: 'Total number of errors',
    labelNames: ['pool_name', 'pool_type', 'endpoint', 'error_type']
  })
};

export class ConnectionPoolMetricsCollector {
  private logger: Logger;
  private metricsInterval: number;
  private intervalId?: NodeJS.Timeout;

  constructor(logger: Logger, metricsInterval: number = 30000) {
    this.logger = logger.child({ component: 'PoolMetricsCollector' });
    this.metricsInterval = metricsInterval;
  }

  /**
   * Start collecting metrics from pool stats
   */
  startCollection(getStats: () => PoolStats[]): void {
    if (this.intervalId) {
      this.logger.warn('Metrics collection already started');
      return;
    }

    this.intervalId = setInterval(() => {
      try {
        const allStats = getStats();
        this.updateMetrics(allStats);
      } catch (error) {
        this.logger.error({ error }, 'Error collecting pool metrics');
      }
    }, this.metricsInterval);

    this.logger.info({ interval: this.metricsInterval }, 'Started metrics collection');
  }

  /**
   * Stop collecting metrics
   */
  stopCollection(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.logger.info('Stopped metrics collection');
    }
  }

  /**
   * Handle pool events for real-time metrics
   */
  handlePoolEvent(event: PoolEvent): void {
    const poolType = this.getPoolType(event.pool);
    const labels = { pool_name: event.pool, pool_type: poolType };

    switch (event.type) {
      case 'connection_created':
        connectionPoolMetrics.connectionsCreated.inc({
          ...labels,
          endpoint: event.endpoint || 'unknown'
        });
        
        if (event.data?.creationTime) {
          connectionPoolMetrics.connectionCreationDuration.observe(
            { ...labels, endpoint: event.endpoint || 'unknown' },
            event.data.creationTime / 1000
          );
        }
        break;

      case 'connection_destroyed':
        connectionPoolMetrics.connectionsDestroyed.inc({
          ...labels,
          endpoint: event.endpoint || 'unknown'
        });
        break;

      case 'health_check':
        const result = event.data?.isHealthy ? 'success' : 'failure';
        connectionPoolMetrics.healthChecksTotal.inc({
          ...labels,
          endpoint: event.endpoint || 'unknown',
          result
        });

        if (event.endpoint) {
          connectionPoolMetrics.endpointHealth.set(
            { ...labels, endpoint: event.endpoint },
            event.data?.isHealthy ? 1 : 0
          );

          if (event.data?.latency) {
            connectionPoolMetrics.endpointLatency.set(
              { ...labels, endpoint: event.endpoint },
              event.data.latency / 1000
            );
          }
        }
        break;

      case 'circuit_breaker':
        if (event.endpoint) {
          const isOpen = event.data?.action === 'opened' ? 1 : 0;
          connectionPoolMetrics.circuitBreakerState.set(
            { ...labels, endpoint: event.endpoint },
            isOpen
          );

          if (event.data?.action === 'opened') {
            connectionPoolMetrics.circuitBreakerTrips.inc({
              ...labels,
              endpoint: event.endpoint
            });
          }
        }
        break;

      case 'error':
        connectionPoolMetrics.errorsTotal.inc({
          ...labels,
          endpoint: event.endpoint || 'unknown',
          error_type: event.data?.error || 'unknown'
        });
        break;
    }
  }

  /**
   * Record request metrics
   */
  recordRequest(poolName: string, duration: number, success: boolean): void {
    const poolType = this.getPoolType(poolName);
    const labels = { pool_name: poolName, pool_type: poolType };

    connectionPoolMetrics.requestsTotal.inc({
      ...labels,
      status: success ? 'success' : 'failure'
    });

    connectionPoolMetrics.requestDuration.observe(labels, duration / 1000);
  }

  /**
   * Update all metrics from pool stats
   */
  private updateMetrics(allStats: PoolStats[]): void {
    for (const stats of allStats) {
      const poolType = this.getPoolType(stats.name);
      const baseLabels = { pool_name: stats.name, pool_type: poolType };

      // Update connection counts
      connectionPoolMetrics.totalConnections.set(baseLabels, stats.totalConnections);
      connectionPoolMetrics.activeConnections.set(baseLabels, stats.activeConnections);
      connectionPoolMetrics.idleConnections.set(baseLabels, stats.idleConnections);
      connectionPoolMetrics.failedConnections.set(baseLabels, stats.failedConnections);

      // Update endpoint-specific metrics
      for (const endpoint of stats.endpoints) {
        const endpointLabels = { ...baseLabels, endpoint: endpoint.url };

        connectionPoolMetrics.endpointHealth.set(
          endpointLabels,
          endpoint.isHealthy ? 1 : 0
        );

        connectionPoolMetrics.endpointLatency.set(
          endpointLabels,
          endpoint.latency / 1000
        );
      }

      // Update circuit breaker state
      connectionPoolMetrics.circuitBreakerState.set(
        baseLabels,
        stats.circuitBreakerOpen ? 1 : 0
      );
    }
  }

  /**
   * Determine pool type from pool name
   */
  private getPoolType(poolName: string): string {
    if (poolName.includes('ethereum')) return 'ethereum';
    if (poolName.includes('cosmos')) return 'cosmos';
    return 'unknown';
  }

  /**
   * Get all metrics for export
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clearMetrics(): void {
    register.clear();
  }
}

/**
 * Middleware to wrap pool operations with metrics
 */
export function withMetrics<T>(
  poolName: string,
  operation: () => Promise<T>,
  metricsCollector?: ConnectionPoolMetricsCollector
): Promise<T> {
  const startTime = Date.now();
  
  return operation()
    .then(result => {
      if (metricsCollector) {
        metricsCollector.recordRequest(poolName, Date.now() - startTime, true);
      }
      return result;
    })
    .catch(error => {
      if (metricsCollector) {
        metricsCollector.recordRequest(poolName, Date.now() - startTime, false);
      }
      throw error;
    });
}

/**
 * Default metrics collector instance
 */
export let defaultMetricsCollector: ConnectionPoolMetricsCollector | undefined;

/**
 * Initialize default metrics collector
 */
export function initializeDefaultMetricsCollector(logger: Logger, interval?: number): ConnectionPoolMetricsCollector {
  if (defaultMetricsCollector) {
    defaultMetricsCollector.stopCollection();
  }
  
  defaultMetricsCollector = new ConnectionPoolMetricsCollector(logger, interval);
  return defaultMetricsCollector;
}

/**
 * Get or create default metrics collector
 */
export function getDefaultMetricsCollector(logger?: Logger): ConnectionPoolMetricsCollector {
  if (!defaultMetricsCollector && logger) {
    defaultMetricsCollector = new ConnectionPoolMetricsCollector(logger);
  }
  
  if (!defaultMetricsCollector) {
    throw new Error('Metrics collector not initialized. Call initializeDefaultMetricsCollector first.');
  }
  
  return defaultMetricsCollector;
}
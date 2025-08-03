/**
 * Monitoring and observability exports for the 1inch Fusion+ Cosmos Relayer
 * 
 * This module provides comprehensive monitoring capabilities including:
 * - Prometheus metrics collection and exposition
 * - HTTP metrics server with health checks
 * - Structured metrics for cross-chain operations
 * - Circuit breaker and recovery operation tracking
 */

export { 
  PrometheusMetrics, 
  initializeMetrics, 
  getMetrics,
  type MetricsLabels 
} from './prometheus-metrics';

export { 
  MetricsServer, 
  createMetricsServer,
  type MetricsServerConfig 
} from './metrics-server';

// Re-export commonly used metric types for convenience
export type {
  Histogram,
  Counter,
  Gauge,
  Summary
} from 'prom-client';
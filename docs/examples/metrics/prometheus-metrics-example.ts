/**
 * Production Prometheus Metrics Example
 * 
 * This example demonstrates how to integrate and use the Prometheus metrics
 * system in the 1inch Fusion+ Cosmos Extension relayer.
 */

import { createRelayerApp } from '../../relayer/src/app';
import { getMetrics, initializeMetrics } from '../../relayer/src/monitoring/prometheus-metrics';
import { MonitoringServer } from '../../relayer/src/monitoring/monitoring-server';
import { AppConfig } from '../../relayer/src/config';
import { createLogger } from '../../relayer/src/utils/logger';
import express from 'express';

async function main() {
  const logger = createLogger({ level: 'info' });
  
  // Initialize metrics system
  initializeMetrics();
  const metrics = getMetrics();
  
  // Create monitoring server for metrics endpoint
  const monitoringServer = new MonitoringServer(9090, logger);
  await monitoringServer.start();
  
  logger.info('Prometheus metrics available at http://localhost:9090/metrics');
  
  // Example: Recording various metrics during relayer operation
  
  // 1. Recording HTLC events
  metrics.recordHtlcEvent('ethereum', 'created', 'detected');
  metrics.recordHtlcEvent('ethereum', 'created', 'processed');
  metrics.recordHtlcEvent('osmosis', 'withdrawn', 'processed');
  
  // 2. Recording swap completions with timing
  const swapStartTime = Date.now();
  
  // Simulate swap processing...
  await new Promise(resolve => setTimeout(resolve, 2500)); // 2.5 second swap
  
  const swapDuration = (Date.now() - swapStartTime) / 1000;
  metrics.recordSwapCompletion(
    'ethereum',      // source chain
    'osmosis',       // target chain
    2,               // number of hops
    swapDuration,    // duration in seconds
    'success',       // status
    100.5,           // amount (optional)
    'USDC'          // token (optional)
  );
  
  // 3. Recording recovery attempts
  metrics.recordRecoveryAttempt('refund', 'ethereum', 'pending');
  metrics.recordRecoveryAttempt('refund', 'ethereum', 'success', 1.2); // 1.2 seconds
  
  // 4. Updating active HTLCs gauge
  metrics.updateActiveHtlcs('ethereum', 'pending', 1);   // +1 pending
  metrics.updateActiveHtlcs('ethereum', 'active', 1);    // +1 active
  metrics.updateActiveHtlcs('ethereum', 'active', -1);   // -1 active (completed)
  metrics.updateActiveHtlcs('ethereum', 'pending', -1);  // -1 pending
  
  // 5. Recording system events
  metrics.recordSystemEvent('startup', { version: '1.0.0' });
  metrics.recordSystemEvent('circuit_breaker_open', { name: 'ethereum_rpc' });
  
  // 6. Recording errors
  metrics.recordError('htlc_creation', 'InsufficientBalance', 'ethereum');
  metrics.recordError('ibc_transfer', 'Timeout', 'osmosis');
  
  // Example: Creating a metrics dashboard endpoint
  const app = express();
  
  app.get('/dashboard', async (req, res) => {
    const prometheusMetrics = await metrics.getMetrics();
    
    // Parse key metrics for dashboard
    const dashboard = {
      swaps: {
        total: parseMetric(prometheusMetrics, 'swap_completions_total'),
        successful: parseMetric(prometheusMetrics, 'swap_completions_total{status="success"}'),
        failed: parseMetric(prometheusMetrics, 'swap_completions_total{status="failed"}'),
        averageDuration: parseMetric(prometheusMetrics, 'swap_completion_time_seconds_avg')
      },
      htlcs: {
        ethereum: {
          created: parseMetric(prometheusMetrics, 'htlc_events_total{chain="ethereum",type="created"}'),
          withdrawn: parseMetric(prometheusMetrics, 'htlc_events_total{chain="ethereum",type="withdrawn"}'),
          refunded: parseMetric(prometheusMetrics, 'htlc_events_total{chain="ethereum",type="refunded"}'),
          active: parseMetric(prometheusMetrics, 'active_htlcs{chain="ethereum",status="active"}')
        },
        osmosis: {
          created: parseMetric(prometheusMetrics, 'htlc_events_total{chain="osmosis",type="created"}'),
          withdrawn: parseMetric(prometheusMetrics, 'htlc_events_total{chain="osmosis",type="withdrawn"}'),
          active: parseMetric(prometheusMetrics, 'active_htlcs{chain="osmosis",status="active"}')
        }
      },
      recovery: {
        attempts: parseMetric(prometheusMetrics, 'recovery_attempts_total'),
        successful: parseMetric(prometheusMetrics, 'recovery_attempts_total{status="success"}'),
        failed: parseMetric(prometheusMetrics, 'recovery_attempts_total{status="failed"}')
      },
      errors: {
        total: parseMetric(prometheusMetrics, 'errors_total'),
        byType: {
          htlc_creation: parseMetric(prometheusMetrics, 'errors_total{operation="htlc_creation"}'),
          ibc_transfer: parseMetric(prometheusMetrics, 'errors_total{operation="ibc_transfer"}'),
          dex_swap: parseMetric(prometheusMetrics, 'errors_total{operation="dex_swap"}')
        }
      },
      system: {
        uptime: parseMetric(prometheusMetrics, 'process_uptime_seconds'),
        circuitBreakers: {
          open: parseMetric(prometheusMetrics, 'circuit_breaker_state{state="open"}')
        }
      }
    };
    
    res.json(dashboard);
  });
  
  app.listen(8080, () => {
    logger.info('Dashboard available at http://localhost:8080/dashboard');
  });
  
  // Example: Setting up alerts based on metrics
  setInterval(async () => {
    const prometheusMetrics = await metrics.getMetrics();
    
    // Check for high error rates
    const errorRate = parseMetric(prometheusMetrics, 'errors_total');
    if (errorRate > 100) {
      logger.error({ errorRate }, 'High error rate detected!');
    }
    
    // Check for stuck HTLCs
    const activeHtlcs = parseMetric(prometheusMetrics, 'active_htlcs');
    if (activeHtlcs > 50) {
      logger.warn({ activeHtlcs }, 'High number of active HTLCs');
    }
    
    // Check for open circuit breakers
    const openCircuits = parseMetric(prometheusMetrics, 'circuit_breaker_state{state="open"}');
    if (openCircuits > 0) {
      logger.warn({ openCircuits }, 'Circuit breakers are open!');
    }
  }, 60000); // Check every minute
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down metrics example...');
    await monitoringServer.stop();
    process.exit(0);
  });
}

// Helper function to parse metric value from Prometheus text format
function parseMetric(metricsText: string, metricName: string): number {
  const lines = metricsText.split('\n');
  for (const line of lines) {
    if (line.startsWith(metricName) && !line.startsWith('#')) {
      const match = line.match(/\s(\d+\.?\d*)\s*$/);
      if (match) {
        return parseFloat(match[1]);
      }
    }
  }
  return 0;
}

// Example Prometheus configuration (prometheus.yml)
const prometheusConfig = `
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: '1inch-fusion-relayer'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: '/metrics'
    
  - job_name: 'connection-pools'
    static_configs:
      - targets: ['localhost:9091']  # Connection pool metrics endpoint
    metrics_path: '/metrics'

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']

rule_files:
  - 'alerts.yml'
`;

// Example alert rules (alerts.yml)
const alertRules = `
groups:
  - name: fusion_relayer_alerts
    interval: 30s
    rules:
      - alert: HighSwapFailureRate
        expr: rate(swap_completions_total{status="failed"}[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High swap failure rate detected"
          description: "Swap failure rate is {{ $value }} per second"
      
      - alert: HTLCStuck
        expr: active_htlcs{status="active"} > 20
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High number of active HTLCs"
          description: "{{ $value }} HTLCs are currently active on {{ $labels.chain }}"
      
      - alert: CircuitBreakerOpen
        expr: circuit_breaker_state == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Circuit breaker is open"
          description: "Circuit breaker {{ $labels.name }} is open"
      
      - alert: RecoveryFailures
        expr: rate(recovery_attempts_total{status="failed"}[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High recovery failure rate"
          description: "Recovery operations are failing at {{ $value }} per second"
`;

// Example Grafana dashboard query snippets
const grafanaQueries = {
  swapSuccessRate: 'rate(swap_completions_total{status="success"}[5m]) / rate(swap_completions_total[5m]) * 100',
  averageSwapDuration: 'histogram_quantile(0.95, rate(swap_completion_time_seconds_bucket[5m]))',
  htlcThroughput: 'sum(rate(htlc_events_total[5m])) by (chain, type)',
  activeSwapsByChain: 'sum(active_htlcs) by (chain, status)',
  errorRate: 'sum(rate(errors_total[5m])) by (operation, error_type)',
  connectionPoolUsage: 'connection_pool_connections_active / connection_pool_connections_total * 100',
  circuitBreakerStatus: 'circuit_breaker_state',
  recoverySuccessRate: 'rate(recovery_attempts_total{status="success"}[5m]) / rate(recovery_attempts_total[5m]) * 100'
};

// Log example configurations
logger.info({ prometheusConfig, alertRules, grafanaQueries }, 'Example configurations for monitoring stack');

// Run the example
main().catch((error) => {
  console.error('Failed to start metrics example:', error);
  process.exit(1);
});
import { Logger } from 'pino';
import { EventEmitter } from 'events';

export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
}

export interface MetricSample {
  metric: string;
  value: number;
  timestamp: number;
  labels: Record<string, string>;
}

export interface HealthCheck {
  name: string;
  healthy: boolean;
  message?: string;
  timestamp: number;
  responseTime?: number;
}

export class MetricsCollector extends EventEmitter {
  private metrics: Map<string, Metric> = new Map();
  private samples: MetricSample[] = [];
  private healthChecks: Map<string, HealthCheck> = new Map();
  private logger: Logger;
  private maxSamples: number = 10000;
  private cleanupInterval: NodeJS.Timeout;

  constructor(logger: Logger) {
    super();
    this.logger = logger.child({ component: 'MetricsCollector' });
    
    // Clean up old samples every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldSamples();
    }, 300000);
  }

  /**
   * Increment a counter metric
   */
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const existing = this.metrics.get(name);
    const newValue = existing ? existing.value + value : value;
    
    this.setMetric(name, newValue, 'counter', labels);
    this.addSample(name, newValue, labels);
  }

  /**
   * Set a gauge metric value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    this.setMetric(name, value, 'gauge', labels);
    this.addSample(name, value, labels);
  }

  /**
   * Record a histogram observation
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    // For now, treat as gauge - in production would use proper histogram buckets
    this.setMetric(name, value, 'histogram', labels);
    this.addSample(name, value, labels);
  }

  /**
   * Record timing information
   */
  recordTiming(name: string, startTime: number, labels?: Record<string, string>): void {
    const duration = Date.now() - startTime;
    this.observeHistogram(`${name}_duration_ms`, duration, labels);
  }

  /**
   * Set metric value
   */
  private setMetric(name: string, value: number, type: Metric['type'], labels?: Record<string, string>): void {
    const metric: Metric = {
      name,
      value,
      timestamp: Date.now(),
      labels,
      type
    };
    
    this.metrics.set(name, metric);
    this.emit('metric', metric);
  }

  /**
   * Add sample for time-series data
   */
  private addSample(name: string, value: number, labels?: Record<string, string>): void {
    const sample: MetricSample = {
      metric: name,
      value,
      timestamp: Date.now(),
      labels: labels || {}
    };
    
    this.samples.push(sample);
    
    // Keep only recent samples
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(-this.maxSamples);
    }
  }

  /**
   * Record health check result
   */
  recordHealthCheck(name: string, healthy: boolean, message?: string, responseTime?: number): void {
    const healthCheck: HealthCheck = {
      name,
      healthy,
      message,
      timestamp: Date.now(),
      responseTime
    };
    
    this.healthChecks.set(name, healthCheck);
    this.emit('healthCheck', healthCheck);
    
    // Also record as metrics
    this.setGauge(`health_check_${name}`, healthy ? 1 : 0);
    if (responseTime !== undefined) {
      this.observeHistogram(`health_check_${name}_response_time`, responseTime);
    }
  }

  /**
   * Get current metric value
   */
  getMetric(name: string): Metric | undefined {
    return this.metrics.get(name);
  }

  /**
   * Get all current metrics
   */
  getAllMetrics(): Record<string, Metric> {
    const result: Record<string, Metric> = {};
    for (const [name, metric] of this.metrics.entries()) {
      result[name] = metric;
    }
    return result;
  }

  /**
   * Get samples for a metric within time range
   */
  getSamples(metricName: string, startTime?: number, endTime?: number): MetricSample[] {
    const now = Date.now();
    const start = startTime || (now - 3600000); // Default: last hour
    const end = endTime || now;
    
    return this.samples.filter(s => 
      s.metric === metricName &&
      s.timestamp >= start &&
      s.timestamp <= end
    );
  }

  /**
   * Get all health checks
   */
  getHealthChecks(): Record<string, HealthCheck> {
    const result: Record<string, HealthCheck> = {};
    for (const [name, check] of this.healthChecks.entries()) {
      result[name] = check;
    }
    return result;
  }

  /**
   * Get overall system health
   */
  getOverallHealth(): { healthy: boolean; checks: number; failures: number } {
    let checks = 0;
    let failures = 0;
    
    for (const check of this.healthChecks.values()) {
      checks++;
      if (!check.healthy) {
        failures++;
      }
    }
    
    return {
      healthy: failures === 0,
      checks,
      failures
    };
  }

  /**
   * Get metrics summary
   */
  getSummary(): {
    totalMetrics: number;
    totalSamples: number;
    totalHealthChecks: number;
    systemHealth: ReturnType<typeof this.getOverallHealth>;
  } {
    return {
      totalMetrics: this.metrics.size,
      totalSamples: this.samples.length,
      totalHealthChecks: this.healthChecks.size,
      systemHealth: this.getOverallHealth()
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    let output = '';
    
    for (const metric of this.metrics.values()) {
      const labels = metric.labels ? 
        Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',') : '';
      const labelStr = labels ? `{${labels}}` : '';
      
      output += `# TYPE ${metric.name} ${metric.type}\n`;
      output += `${metric.name}${labelStr} ${metric.value} ${metric.timestamp}\n`;
    }
    
    return output;
  }

  /**
   * Clean up old samples to prevent memory leaks
   */
  private cleanupOldSamples(): void {
    const cutoff = Date.now() - 86400000; // 24 hours ago
    const initialLength = this.samples.length;
    
    this.samples = this.samples.filter(s => s.timestamp > cutoff);
    
    const cleaned = initialLength - this.samples.length;
    if (cleaned > 0) {
      this.logger.debug({ cleaned }, 'Cleaned up old metric samples');
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.samples = [];
    this.healthChecks.clear();
    this.logger.info('All metrics reset');
  }

  /**
   * Destroy the metrics collector
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.removeAllListeners();
    this.reset();
  }
}

/**
 * Fusion-specific metrics collector with predefined metrics
 */
export class FusionMetrics extends MetricsCollector {
  constructor(logger: Logger) {
    super(logger);
    this.initializeFusionMetrics();
  }

  private initializeFusionMetrics(): void {
    // Initialize common metrics
    this.setGauge('fusion_relayer_uptime', Date.now());
    this.setGauge('fusion_active_htlcs', 0);
    this.setGauge('fusion_pending_swaps', 0);
    this.setGauge('fusion_failed_operations', 0);
    this.setGauge('fusion_ibc_packets_pending', 0);
  }

  /**
   * Record HTLC creation
   */
  recordHTLCCreated(chain: string, amount: string): void {
    this.incrementCounter('fusion_htlc_created_total', 1, { chain });
    this.incrementCounter('fusion_htlc_created_value', parseFloat(amount), { chain });
    this.incrementCounter('fusion_active_htlcs');
  }

  /**
   * Record HTLC completion
   */
  recordHTLCCompleted(chain: string, success: boolean, duration: number): void {
    this.incrementCounter('fusion_htlc_completed_total', 1, { 
      chain, 
      status: success ? 'success' : 'failed' 
    });
    this.observeHistogram('fusion_htlc_duration_ms', duration, { chain });
    this.incrementCounter('fusion_active_htlcs', -1);
  }

  /**
   * Record swap operation
   */
  recordSwap(fromChain: string, toChain: string, fromToken: string, toToken: string, amount: string): void {
    this.incrementCounter('fusion_swaps_total', 1, { 
      from_chain: fromChain, 
      to_chain: toChain,
      from_token: fromToken,
      to_token: toToken
    });
    this.incrementCounter('fusion_swap_volume', parseFloat(amount), { 
      from_chain: fromChain,
      to_chain: toChain 
    });
  }

  /**
   * Record IBC packet
   */
  recordIBCPacket(action: 'sent' | 'received' | 'timeout' | 'error', sourceChain: string, destChain: string): void {
    this.incrementCounter('fusion_ibc_packets_total', 1, { 
      action, 
      source_chain: sourceChain,
      dest_chain: destChain 
    });
    
    if (action === 'sent') {
      this.incrementCounter('fusion_ibc_packets_pending');
    } else if (action === 'received') {
      this.incrementCounter('fusion_ibc_packets_pending', -1);
    }
  }

  /**
   * Record relayer balance
   */
  recordRelayerBalance(chain: string, token: string, balance: string): void {
    this.setGauge('fusion_relayer_balance', parseFloat(balance), { 
      chain, 
      token 
    });
  }

  /**
   * Record gas usage
   */
  recordGasUsage(chain: string, operation: string, gasUsed: number, gasCost: string): void {
    this.observeHistogram('fusion_gas_used', gasUsed, { chain, operation });
    this.incrementCounter('fusion_gas_cost', parseFloat(gasCost), { chain, operation });
  }
}
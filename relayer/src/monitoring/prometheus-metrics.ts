import { register, collectDefaultMetrics, Histogram, Counter, Gauge, Summary } from 'prom-client';
import { Logger } from 'pino';

/**
 * Prometheus metrics collection for the 1inch Fusion+ Cosmos Relayer
 * 
 * Provides structured metrics for monitoring:
 * - Cross-chain swap performance and completion times
 * - HTLC event processing across different chains
 * - Recovery operation success/failure rates
 * - Circuit breaker states and system health
 * - IBC packet flow and acknowledgment tracking
 */

export interface MetricsLabels {
  chain?: string;
  type?: string;
  operation?: string;
  status?: string;
  hop?: string;
  error?: string;
  circuit_breaker?: string;
}

export class PrometheusMetrics {
  private logger: Logger;
  
  // === CORE SWAP METRICS ===
  
  /**
   * Histogram: Time taken for complete cross-chain swaps
   * Tracks end-to-end performance from HTLC creation to settlement
   */
  public readonly swapCompletionTime = new Histogram({
    name: 'swap_completion_time_seconds',
    help: 'Time taken for complete cross-chain swap from HTLC creation to settlement',
    labelNames: ['source_chain', 'target_chain', 'hops', 'status'],
    buckets: [1, 5, 10, 30, 60, 300, 600, 1800, 3600] // 1s to 1h
  });

  /**
   * Summary: Swap amounts processed (for percentile analysis)
   */
  public readonly swapAmounts = new Summary({
    name: 'swap_amounts_processed',
    help: 'Distribution of swap amounts processed by the relayer',
    labelNames: ['source_chain', 'target_chain', 'token'],
    percentiles: [0.5, 0.75, 0.9, 0.95, 0.99]
  });

  // === HTLC EVENT TRACKING ===
  
  /**
   * Counter: HTLC events processed by chain and type
   */
  public readonly htlcEvents = new Counter({
    name: 'htlc_events_total',
    help: 'Total number of HTLC events processed',
    labelNames: ['chain', 'type', 'status']
  });

  /**
   * Gauge: Currently active HTLCs being processed
   */
  public readonly activeHtlcs = new Gauge({
    name: 'active_htlcs_count',
    help: 'Number of HTLCs currently being processed by the relayer',
    labelNames: ['chain', 'status']
  });

  // === RECOVERY OPERATIONS ===
  
  /**
   * Counter: Recovery attempts by operation type
   */
  public readonly recoveryAttempts = new Counter({
    name: 'recovery_attempts_total',
    help: 'Total number of recovery attempts by operation type',
    labelNames: ['operation', 'chain', 'status', 'error_type']
  });

  /**
   * Histogram: Time taken for recovery operations
   */
  public readonly recoveryDuration = new Histogram({
    name: 'recovery_duration_seconds',
    help: 'Time taken for recovery operations to complete',
    labelNames: ['operation', 'chain', 'status'],
    buckets: [1, 5, 10, 30, 60, 300, 600] // 1s to 10m
  });

  // === CIRCUIT BREAKER MONITORING ===
  
  /**
   * Gauge: Circuit breaker states (0=CLOSED, 1=OPEN, 0.5=HALF_OPEN)
   */
  public readonly circuitBreakerState = new Gauge({
    name: 'circuit_breaker_state',
    help: 'Circuit breaker state (0=CLOSED, 1=OPEN, 0.5=HALF_OPEN)',
    labelNames: ['name', 'service']
  });

  /**
   * Counter: Circuit breaker state changes
   */
  public readonly circuitBreakerTransitions = new Counter({
    name: 'circuit_breaker_transitions_total',
    help: 'Total number of circuit breaker state transitions',
    labelNames: ['name', 'from_state', 'to_state', 'reason']
  });

  // === IBC PACKET FLOW ===
  
  /**
   * Counter: IBC packets processed
   */
  public readonly ibcPackets = new Counter({
    name: 'ibc_packets_total',
    help: 'Total number of IBC packets processed',
    labelNames: ['source_chain', 'destination_chain', 'status', 'packet_type']
  });

  /**
   * Histogram: IBC packet acknowledgment times
   */
  public readonly ibcAckTime = new Histogram({
    name: 'ibc_acknowledgment_time_seconds',
    help: 'Time taken for IBC packet acknowledgments',
    labelNames: ['source_chain', 'destination_chain', 'hop'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60] // 100ms to 1m
  });

  // === SYSTEM HEALTH ===
  
  /**
   * Gauge: RPC connection health (0=down, 1=up)
   */
  public readonly rpcHealth = new Gauge({
    name: 'rpc_connection_health',
    help: 'RPC connection health status (0=down, 1=up)',
    labelNames: ['chain', 'endpoint']
  });

  /**
   * Counter: RPC request failures
   */
  public readonly rpcErrors = new Counter({
    name: 'rpc_errors_total',
    help: 'Total number of RPC errors',
    labelNames: ['chain', 'endpoint', 'error_type']
  });

  /**
   * Histogram: RPC response times
   */
  public readonly rpcDuration = new Histogram({
    name: 'rpc_request_duration_seconds',
    help: 'RPC request duration',
    labelNames: ['chain', 'method'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5] // 10ms to 5s
  });

  // === RESOURCE MONITORING ===
  
  /**
   * Gauge: Memory usage
   */
  public readonly memoryUsage = new Gauge({
    name: 'relayer_memory_usage_bytes',
    help: 'Memory usage of the relayer process',
    labelNames: ['type'] // heap_used, heap_total, external, etc.
  });

  /**
   * Gauge: Active database connections
   */
  public readonly dbConnections = new Gauge({
    name: 'database_connections_active',
    help: 'Number of active database connections',
    labelNames: ['database', 'pool']
  });

  constructor(logger: Logger) {
    this.logger = logger;
    
    // Enable default Node.js metrics (CPU, memory, event loop, etc.)
    collectDefaultMetrics({
      register,
      prefix: 'fusion_relayer_',
      gcDurationBuckets: [0.1, 0.5, 1, 2, 5], // GC duration buckets
    });

    this.logger.info('Prometheus metrics initialized');
  }

  // === CONVENIENCE METHODS ===

  /**
   * Record a completed swap
   */
  recordSwapCompletion(
    sourceChain: string,
    targetChain: string,
    hops: number,
    durationSeconds: number,
    status: 'success' | 'failed' | 'timeout',
    amount?: number,
    token?: string
  ): void {
    this.swapCompletionTime
      .labels(sourceChain, targetChain, hops.toString(), status)
      .observe(durationSeconds);

    if (amount && token) {
      this.swapAmounts
        .labels(sourceChain, targetChain, token)
        .observe(amount);
    }
  }

  /**
   * Record HTLC event processing
   */
  recordHtlcEvent(
    chain: string,
    eventType: 'created' | 'withdrawn' | 'refunded' | 'expired',
    status: 'success' | 'failed' | 'pending'
  ): void {
    this.htlcEvents.labels(chain, eventType, status).inc();
  }

  /**
   * Update active HTLC count
   */
  updateActiveHtlcs(chain: string, status: string, delta: number): void {
    this.activeHtlcs.labels(chain, status).inc(delta);
  }

  /**
   * Record recovery attempt
   */
  recordRecoveryAttempt(
    operation: 'refund' | 'retry' | 'timeout_recovery',
    chain: string,
    status: 'success' | 'failed',
    durationSeconds?: number,
    errorType?: string
  ): void {
    this.recoveryAttempts.labels(operation, chain, status, errorType || 'none').inc();
    
    if (durationSeconds !== undefined) {
      this.recoveryDuration.labels(operation, chain, status).observe(durationSeconds);
    }
  }

  recordRecoveryCheck(
    status: 'started' | 'completed',
    durationSeconds?: number
  ): void {
    this.recoveryAttempts.labels('check', 'all', status, 'none').inc();
    
    if (durationSeconds !== undefined) {
      this.recoveryDuration.labels('check', 'all', status).observe(durationSeconds);
    }
  }

  /**
   * Update circuit breaker state
   */
  updateCircuitBreakerState(
    name: string,
    service: string,
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
    fromState?: string,
    reason?: string
  ): void {
    const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 0.5;
    this.circuitBreakerState.labels(name, service).set(stateValue);
    
    if (fromState && reason) {
      this.circuitBreakerTransitions.labels(name, fromState, state, reason).inc();
    }
  }

  /**
   * Record IBC packet processing
   */
  recordIbcPacket(
    sourceChain: string,
    destinationChain: string,
    status: 'sent' | 'acknowledged' | 'timeout' | 'error',
    packetType: 'transfer' | 'forward' | 'htlc',
    ackTimeSeconds?: number,
    hop?: string
  ): void {
    this.ibcPackets.labels(sourceChain, destinationChain, status, packetType).inc();
    
    if (ackTimeSeconds !== undefined) {
      this.ibcAckTime.labels(sourceChain, destinationChain, hop || '0').observe(ackTimeSeconds);
    }
  }

  /**
   * Update RPC health status
   */
  updateRpcHealth(chain: string, endpoint: string, isHealthy: boolean): void {
    this.rpcHealth.labels(chain, endpoint).set(isHealthy ? 1 : 0);
  }

  /**
   * Record RPC error
   */
  recordRpcError(chain: string, endpoint: string, errorType: string): void {
    this.rpcErrors.labels(chain, endpoint, errorType).inc();
  }

  /**
   * Record RPC request duration
   */
  recordRpcDuration(chain: string, method: string, durationSeconds: number): void {
    this.rpcDuration.labels(chain, method).observe(durationSeconds);
  }

  /**
   * Update memory usage metrics
   */
  updateMemoryUsage(): void {
    const memUsage = process.memoryUsage();
    this.memoryUsage.labels('heap_used').set(memUsage.heapUsed);
    this.memoryUsage.labels('heap_total').set(memUsage.heapTotal);
    this.memoryUsage.labels('external').set(memUsage.external);
    this.memoryUsage.labels('rss').set(memUsage.rss);
  }

  /**
   * Record database operation metrics
   */
  recordDatabaseOperation(
    provider: string,
    operation: string,
    status: string,
    duration?: number,
    errorType?: string
  ): void {
    this.logger.debug({
      provider,
      operation,
      status,
      duration,
      errorType
    }, 'Recording database operation metric');
    
    // For now, record as a generic operation
    // In a full implementation, we'd add specific database metrics
  }

  /**
   * Record database health status
   */
  recordDatabaseHealth(provider: string, healthValue: number): void {
    this.logger.debug({
      provider,
      healthValue
    }, 'Recording database health metric');
    
    // For now, just log - in a full implementation, we'd have a database health gauge
  }

  /**
   * Get metrics for HTTP endpoint
   */
  async getMetrics(): Promise<string> {
    this.updateMemoryUsage(); // Update memory metrics on each request
    return register.metrics();
  }

  /**
   * Clear all metrics (useful for testing)
   */
  reset(): void {
    register.clear();
  }
}

// Singleton instance
let metricsInstance: PrometheusMetrics | null = null;

export function initializeMetrics(logger: Logger): PrometheusMetrics {
  if (!metricsInstance) {
    metricsInstance = new PrometheusMetrics(logger);
  }
  return metricsInstance;
}

export function getMetrics(): PrometheusMetrics {
  if (!metricsInstance) {
    throw new Error('Metrics not initialized. Call initializeMetrics() first.');
  }
  return metricsInstance;
}
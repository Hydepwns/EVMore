/**
 * Performance monitoring for database persistence layer
 * 
 * Provides real-time monitoring, alerting, and optimization recommendations
 * for PostgreSQL and Redis performance with detailed metrics collection.
 */

import { Pool } from 'pg';
import Redis from 'ioredis';
import { Logger } from 'pino';
import { EventEmitter } from 'events';

export interface PerformanceMetrics {
  // Connection metrics
  connections: {
    active: number;
    idle: number;
    total: number;
    queued: number;
    maxUsed: number;
    avgConnectionTime: number;
  };
  
  // Query metrics
  queries: {
    total: number;
    successful: number;
    failed: number;
    avgDuration: number;
    p95Duration: number;
    p99Duration: number;
    slowQueries: number;
    qps: number; // Queries per second
  };
  
  // Resource metrics
  resources: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkIO: {
      bytesIn: number;
      bytesOut: number;
    };
  };
  
  // Database-specific metrics
  postgres?: {
    bufferHitRatio: number;
    indexUsage: number;
    tableSize: number;
    indexSize: number;
    activeConnections: number;
    locksWaiting: number;
    transactionRate: number;
    checkpointRate: number;
    walGeneration: number;
  };
  
  redis?: {
    hitRatio: number;
    memoryUsage: number;
    keyspaceHits: number;
    keyspaceMisses: number;
    evictedKeys: number;
    expiredKeys: number;
    commandsProcessed: number;
    clientConnections: number;
  };
}

export interface AlertThreshold {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  value: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  duration: number; // Seconds to maintain threshold before alerting
  cooldown: number; // Seconds between alerts
}

export interface PerformanceAlert {
  id: string;
  threshold: AlertThreshold;
  currentValue: number;
  triggeredAt: Date;
  resolvedAt?: Date;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
}

export interface QueryAnalysis {
  query: string;
  hash: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  lastSeen: Date;
  firstSeen: Date;
  planHash?: string;
  indexRecommendations?: string[];
}

export class PerformanceMonitor extends EventEmitter {
  private logger: Logger;
  private pgPool?: Pool;
  private redisClient?: Redis;
  
  // Metrics storage
  private currentMetrics: PerformanceMetrics;
  private metricsHistory: Array<{ timestamp: Date; metrics: PerformanceMetrics }> = [];
  private queryAnalytics: Map<string, QueryAnalysis> = new Map();
  
  // Alerting
  private alertThresholds: AlertThreshold[] = [];
  private activeAlerts: Map<string, PerformanceAlert> = new Map();
  private alertStates: Map<string, { startTime: Date; lastAlert: Date }> = new Map();
  
  // Monitoring intervals
  private metricsInterval?: NodeJS.Timeout;
  private alertInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  
  // Configuration
  private config = {
    metricsInterval: 30000, // 30 seconds
    alertCheckInterval: 10000, // 10 seconds
    historyRetention: 86400000, // 24 hours
    slowQueryThreshold: 1000, // 1 second
    maxHistorySize: 2880 // 24 hours of 30-second intervals
  };

  constructor(logger: Logger, config?: Partial<PerformanceMonitor['config']>) {
    super();
    this.logger = logger.child({ component: 'PerformanceMonitor' });
    this.config = { ...this.config, ...config };
    
    this.currentMetrics = this.initializeMetrics();
    this.setupDefaultAlertThresholds();
  }

  /**
   * Initialize monitoring with database connections
   */
  async initialize(pgPool?: Pool, redisClient?: Redis): Promise<void> {
    this.pgPool = pgPool;
    this.redisClient = redisClient;
    
    // Start monitoring intervals
    this.startMonitoring();
    
    this.logger.info('Performance monitoring initialized');
  }

  /**
   * Get current performance metrics
   */
  getCurrentMetrics(): PerformanceMetrics {
    return { ...this.currentMetrics };
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(duration?: number): Array<{ timestamp: Date; metrics: PerformanceMetrics }> {
    const cutoff = duration ? Date.now() - duration : 0;
    return this.metricsHistory.filter(entry => entry.timestamp.getTime() > cutoff);
  }

  /**
   * Get slow query analysis
   */
  getSlowQueries(limit: number = 50): QueryAnalysis[] {
    return Array.from(this.queryAnalytics.values())
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): PerformanceAlert[] {
    return Array.from(this.activeAlerts.values())
      .filter(alert => !alert.resolvedAt)
      .sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());
  }

  /**
   * Add custom alert threshold
   */
  addAlertThreshold(threshold: AlertThreshold): void {
    this.alertThresholds.push(threshold);
    this.logger.info({ threshold }, 'Added performance alert threshold');
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.acknowledged) {
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    this.logger.info({ alertId, acknowledgedBy }, 'Performance alert acknowledged');
    this.emit('alert_acknowledged', alert);
    return true;
  }

  /**
   * Record query execution for analysis
   */
  recordQuery(
    query: string, 
    duration: number, 
    success: boolean,
    metadata?: Record<string, any>
  ): void {
    // Update query metrics
    this.currentMetrics.queries.total++;
    if (success) {
      this.currentMetrics.queries.successful++;
    } else {
      this.currentMetrics.queries.failed++;
    }

    // Track slow queries
    if (duration > this.config.slowQueryThreshold) {
      this.currentMetrics.queries.slowQueries++;
      this.recordSlowQuery(query, duration);
    }

    // Update average duration with exponential moving average
    const alpha = 0.1;
    this.currentMetrics.queries.avgDuration = 
      (1 - alpha) * this.currentMetrics.queries.avgDuration + alpha * duration;
  }

  /**
   * Get performance recommendations
   */
  getRecommendations(): Array<{
    type: 'index' | 'query' | 'connection' | 'memory' | 'disk';
    priority: 'low' | 'medium' | 'high';
    description: string;
    impact: string;
    action: string;
  }> {
    const recommendations = [];

    // Connection pool recommendations
    if (this.currentMetrics.connections.active / this.currentMetrics.connections.total > 0.8) {
      recommendations.push({
        type: 'connection' as const,
        priority: 'high' as const,
        description: 'Connection pool utilization is high (>80%)',
        impact: 'May cause connection timeouts and performance degradation',
        action: 'Increase max connections or optimize connection usage'
      });
    }

    // Slow query recommendations
    if (this.currentMetrics.queries.slowQueries > 10) {
      recommendations.push({
        type: 'query' as const,
        priority: 'high' as const,
        description: 'High number of slow queries detected',
        impact: 'Increased response times and resource usage',
        action: 'Review and optimize slow queries, consider adding indexes'
      });
    }

    // PostgreSQL specific recommendations
    if (this.currentMetrics.postgres) {
      if (this.currentMetrics.postgres.bufferHitRatio < 0.95) {
        recommendations.push({
          type: 'memory' as const,
          priority: 'medium' as const,
          description: 'PostgreSQL buffer hit ratio is low (<95%)',
          impact: 'Increased disk I/O and slower query performance',
          action: 'Increase shared_buffers or add more RAM'
        });
      }

      if (this.currentMetrics.postgres.indexUsage < 0.9) {
        recommendations.push({
          type: 'index' as const,
          priority: 'medium' as const,
          description: 'Low index usage detected (<90%)',
          impact: 'Queries may be performing table scans',
          action: 'Analyze query patterns and add missing indexes'
        });
      }
    }

    // Redis specific recommendations
    if (this.currentMetrics.redis) {
      if (this.currentMetrics.redis.hitRatio < 0.9) {
        recommendations.push({
          type: 'memory' as const,
          priority: 'medium' as const,
          description: 'Redis cache hit ratio is low (<90%)',
          impact: 'Increased backend load and slower response times',
          action: 'Review cache strategy and increase Redis memory or TTL'
        });
      }

      if (this.currentMetrics.redis.evictedKeys > 100) {
        recommendations.push({
          type: 'memory' as const,
          priority: 'high' as const,
          description: 'High number of evicted keys in Redis',
          impact: 'Cache efficiency degradation',
          action: 'Increase Redis memory or optimize key expiration'
        });
      }
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Generate performance report
   */
  generateReport(timeframe: 'hour' | 'day' | 'week' = 'day'): {
    summary: any;
    trends: any;
    alerts: any;
    recommendations: any;
  } {
    const duration = {
      hour: 3600000,
      day: 86400000,
      week: 604800000
    }[timeframe];

    const history = this.getMetricsHistory(duration);
    const recommendations = this.getRecommendations();
    const alerts = this.getActiveAlerts();

    return {
      summary: this.generateSummary(history),
      trends: this.analyzeTrends(history),
      alerts: {
        active: alerts.length,
        critical: alerts.filter(a => a.threshold.severity === 'critical').length,
        unacknowledged: alerts.filter(a => !a.acknowledged).length
      },
      recommendations: recommendations.slice(0, 10) // Top 10 recommendations
    };
  }

  /**
   * Shutdown monitoring
   */
  async shutdown(): Promise<void> {
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    if (this.alertInterval) clearInterval(this.alertInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    this.logger.info('Performance monitoring shut down');
  }

  // Private methods

  private initializeMetrics(): PerformanceMetrics {
    return {
      connections: {
        active: 0,
        idle: 0,
        total: 0,
        queued: 0,
        maxUsed: 0,
        avgConnectionTime: 0
      },
      queries: {
        total: 0,
        successful: 0,
        failed: 0,
        avgDuration: 0,
        p95Duration: 0,
        p99Duration: 0,
        slowQueries: 0,
        qps: 0
      },
      resources: {
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        networkIO: {
          bytesIn: 0,
          bytesOut: 0
        }
      }
    };
  }

  private setupDefaultAlertThresholds(): void {
    this.alertThresholds = [
      {
        metric: 'connections.active',
        operator: 'gt',
        value: 0.9, // 90% of max connections
        severity: 'critical',
        duration: 30,
        cooldown: 300
      },
      {
        metric: 'queries.avgDuration',
        operator: 'gt',
        value: 1000, // 1 second average
        severity: 'high',
        duration: 60,
        cooldown: 300
      },
      {
        metric: 'queries.qps',
        operator: 'gt',
        value: 1000, // 1000 QPS
        severity: 'medium',
        duration: 120,
        cooldown: 600
      },
      {
        metric: 'postgres.bufferHitRatio',
        operator: 'lt',
        value: 0.95, // 95% hit ratio
        severity: 'medium',
        duration: 300,
        cooldown: 1800
      },
      {
        metric: 'redis.hitRatio',
        operator: 'lt',
        value: 0.9, // 90% hit ratio
        severity: 'medium',
        duration: 300,
        cooldown: 1800
      }
    ];
  }

  private startMonitoring(): void {
    // Collect metrics periodically
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.metricsInterval);

    // Check alerts periodically
    this.alertInterval = setInterval(() => {
      this.checkAlerts();
    }, this.config.alertCheckInterval);

    // Cleanup old data periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 300000); // 5 minutes

    // Initial collection
    setTimeout(() => this.collectMetrics(), 1000);
  }

  private async collectMetrics(): Promise<void> {
    try {
      const timestamp = new Date();
      
      // Collect PostgreSQL metrics
      if (this.pgPool) {
        await this.collectPostgreSQLMetrics();
      }

      // Collect Redis metrics
      if (this.redisClient) {
        await this.collectRedisMetrics();
      }

      // Calculate derived metrics
      this.calculateDerivedMetrics();

      // Store in history
      this.metricsHistory.push({
        timestamp,
        metrics: { ...this.currentMetrics }
      });

      // Trim history if too large
      if (this.metricsHistory.length > this.config.maxHistorySize) {
        this.metricsHistory = this.metricsHistory.slice(-this.config.maxHistorySize);
      }

      this.emit('metrics_collected', this.currentMetrics);

    } catch (error) {
      this.logger.error({ error }, 'Failed to collect performance metrics');
    }
  }

  private async collectPostgreSQLMetrics(): Promise<void> {
    if (!this.pgPool) return;

    try {
      // Connection metrics
      this.currentMetrics.connections.total = this.pgPool.totalCount;
      this.currentMetrics.connections.active = this.pgPool.totalCount - this.pgPool.idleCount;
      this.currentMetrics.connections.idle = this.pgPool.idleCount;
      this.currentMetrics.connections.queued = this.pgPool.waitingCount;

      // Database-specific metrics via SQL queries
      const client = await this.pgPool.connect();
      
      try {
        // Buffer hit ratio
        const bufferHitResult = await client.query(`
          SELECT 
            round(
              sum(blks_hit) * 100.0 / sum(blks_hit + blks_read), 2
            ) as buffer_hit_ratio
          FROM pg_stat_database
          WHERE datname = current_database()
        `);
        
        if (bufferHitResult.rows[0]) {
          this.currentMetrics.postgres = {
            ...this.currentMetrics.postgres,
            bufferHitRatio: parseFloat(bufferHitResult.rows[0].buffer_hit_ratio) / 100
          };
        }

        // Active connections
        const connectionsResult = await client.query(`
          SELECT count(*) as active_connections
          FROM pg_stat_activity
          WHERE state = 'active'
        `);
        
        if (connectionsResult.rows[0]) {
          this.currentMetrics.postgres = {
            ...this.currentMetrics.postgres,
            activeConnections: parseInt(connectionsResult.rows[0].active_connections)
          };
        }

        // Index usage
        const indexUsageResult = await client.query(`
          SELECT 
            round(
              sum(idx_scan) * 100.0 / sum(seq_scan + idx_scan), 2
            ) as index_usage
          FROM pg_stat_user_tables
          WHERE seq_scan + idx_scan > 0
        `);
        
        if (indexUsageResult.rows[0]) {
          this.currentMetrics.postgres = {
            ...this.currentMetrics.postgres,
            indexUsage: parseFloat(indexUsageResult.rows[0].index_usage) / 100
          };
        }

      } finally {
        client.release();
      }

    } catch (error) {
      this.logger.error({ error }, 'Failed to collect PostgreSQL metrics');
    }
  }

  private async collectRedisMetrics(): Promise<void> {
    if (!this.redisClient) return;

    try {
      const info = await this.redisClient.info();
      const keyspaceInfo = await this.redisClient.info('keyspace');
      const stats = await this.redisClient.info('stats');

      // Parse info output
      const parseInfo = (section: string) => {
        const result: Record<string, string> = {};
        section.split('\r\n').forEach(line => {
          if (line.includes(':')) {
            const [key, value] = line.split(':');
            result[key] = value;
          }
        });
        return result;
      };

      const memoryInfo = parseInfo(info);
      const statsInfo = parseInfo(stats);

      // Calculate hit ratio
      const keyspaceHits = parseInt(statsInfo.keyspace_hits || '0');
      const keyspaceMisses = parseInt(statsInfo.keyspace_misses || '0');
      const hitRatio = keyspaceHits + keyspaceMisses > 0 
        ? keyspaceHits / (keyspaceHits + keyspaceMisses) 
        : 1;

      this.currentMetrics.redis = {
        hitRatio,
        memoryUsage: parseInt(memoryInfo.used_memory || '0'),
        keyspaceHits,
        keyspaceMisses,
        evictedKeys: parseInt(statsInfo.evicted_keys || '0'),
        expiredKeys: parseInt(statsInfo.expired_keys || '0'),
        commandsProcessed: parseInt(statsInfo.total_commands_processed || '0'),
        clientConnections: parseInt(memoryInfo.connected_clients || '0')
      };

    } catch (error) {
      this.logger.error({ error }, 'Failed to collect Redis metrics');
    }
  }

  private calculateDerivedMetrics(): void {
    // Calculate QPS from recent history
    if (this.metricsHistory.length >= 2) {
      const current = this.metricsHistory[this.metricsHistory.length - 1];
      const previous = this.metricsHistory[this.metricsHistory.length - 2];
      const timeDiff = (current.timestamp.getTime() - previous.timestamp.getTime()) / 1000;
      const queryDiff = current.metrics.queries.total - previous.metrics.queries.total;
      
      this.currentMetrics.queries.qps = queryDiff / timeDiff;
    }
  }

  private checkAlerts(): void {
    const now = new Date();

    for (const threshold of this.alertThresholds) {
      const metricValue = this.getMetricValue(threshold.metric);
      if (metricValue === undefined) continue;

      const alertKey = `${threshold.metric}_${threshold.operator}_${threshold.value}`;
      const shouldAlert = this.evaluateThreshold(metricValue, threshold);

      if (shouldAlert) {
        const state = this.alertStates.get(alertKey);
        const isNewAlert = !state;
        const durationMet = state && (now.getTime() - state.startTime.getTime()) >= threshold.duration * 1000;
        const cooldownExpired = !state || (now.getTime() - state.lastAlert.getTime()) >= threshold.cooldown * 1000;

        if (isNewAlert) {
          // Start tracking this threshold breach
          this.alertStates.set(alertKey, {
            startTime: now,
            lastAlert: new Date(0)
          });
        } else if (durationMet && cooldownExpired) {
          // Trigger alert
          this.triggerAlert(threshold, metricValue);
          this.alertStates.set(alertKey, {
            ...state,
            lastAlert: now
          });
        }
      } else {
        // Condition no longer met, reset state
        this.alertStates.delete(alertKey);
        
        // Resolve any active alerts for this threshold
        for (const [alertId, alert] of this.activeAlerts.entries()) {
          if (alert.threshold.metric === threshold.metric && !alert.resolvedAt) {
            alert.resolvedAt = now;
            this.emit('alert_resolved', alert);
          }
        }
      }
    }
  }

  private getMetricValue(metricPath: string): number | undefined {
    const parts = metricPath.split('.');
    let value: any = this.currentMetrics;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }
    
    return typeof value === 'number' ? value : undefined;
  }

  private evaluateThreshold(value: number, threshold: AlertThreshold): boolean {
    switch (threshold.operator) {
      case 'gt': return value > threshold.value;
      case 'gte': return value >= threshold.value;
      case 'lt': return value < threshold.value;
      case 'lte': return value <= threshold.value;
      case 'eq': return value === threshold.value;
      default: return false;
    }
  }

  private triggerAlert(threshold: AlertThreshold, currentValue: number): void {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const alert: PerformanceAlert = {
      id: alertId,
      threshold,
      currentValue,
      triggeredAt: new Date(),
      acknowledged: false
    };

    this.activeAlerts.set(alertId, alert);
    
    this.logger.warn({
      alertId,
      metric: threshold.metric,
      threshold: threshold.value,
      current: currentValue,
      severity: threshold.severity
    }, 'Performance alert triggered');

    this.emit('alert_triggered', alert);
  }

  private recordSlowQuery(query: string, duration: number): void {
    const hash = this.hashQuery(query);
    const existing = this.queryAnalytics.get(hash);
    const now = new Date();

    if (existing) {
      existing.count++;
      existing.totalDuration += duration;
      existing.avgDuration = existing.totalDuration / existing.count;
      existing.minDuration = Math.min(existing.minDuration, duration);
      existing.maxDuration = Math.max(existing.maxDuration, duration);
      existing.lastSeen = now;
    } else {
      this.queryAnalytics.set(hash, {
        query: query.substring(0, 1000), // Limit query length
        hash,
        count: 1,
        totalDuration: duration,
        avgDuration: duration,
        minDuration: duration,
        maxDuration: duration,
        firstSeen: now,
        lastSeen: now
      });
    }
  }

  private hashQuery(query: string): string {
    // Simple hash function for query normalization
    let hash = 0;
    const normalized = query.replace(/\s+/g, ' ').replace(/\d+/g, '?').trim().toLowerCase();
    
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return hash.toString(36);
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.config.historyRetention;
    
    // Clean metrics history
    this.metricsHistory = this.metricsHistory.filter(entry => 
      entry.timestamp.getTime() > cutoff
    );

    // Clean query analytics (keep only recent queries)
    const queryCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    for (const [hash, analysis] of this.queryAnalytics.entries()) {
      if (analysis.lastSeen.getTime() < queryCutoff) {
        this.queryAnalytics.delete(hash);
      }
    }

    // Clean resolved alerts older than 24 hours
    const alertCutoff = Date.now() - (24 * 60 * 60 * 1000);
    for (const [alertId, alert] of this.activeAlerts.entries()) {
      if (alert.resolvedAt && alert.resolvedAt.getTime() < alertCutoff) {
        this.activeAlerts.delete(alertId);
      }
    }

    this.logger.debug('Performance monitor cleanup completed');
  }

  private generateSummary(history: Array<{ timestamp: Date; metrics: PerformanceMetrics }>): any {
    if (history.length === 0) return {};

    const latest = history[history.length - 1]?.metrics;
    const connections = history.map(h => h.metrics.connections.active);
    const queries = history.map(h => h.metrics.queries.qps);

    return {
      current: latest,
      averages: {
        connections: connections.reduce((a, b) => a + b, 0) / connections.length,
        qps: queries.reduce((a, b) => a + b, 0) / queries.length
      },
      peaks: {
        connections: Math.max(...connections),
        qps: Math.max(...queries)
      }
    };
  }

  private analyzeTrends(history: Array<{ timestamp: Date; metrics: PerformanceMetrics }>): any {
    if (history.length < 2) return {};

    // Calculate simple trend analysis
    const getSlope = (values: number[]) => {
      if (values.length < 2) return 0;
      const n = values.length;
      const x = Array.from({ length: n }, (_, i) => i);
      const meanX = x.reduce((a, b) => a + b, 0) / n;
      const meanY = values.reduce((a, b) => a + b, 0) / n;
      
      const num = x.reduce((sum, xi, i) => sum + (xi - meanX) * (values[i] - meanY), 0);
      const den = x.reduce((sum, xi) => sum + (xi - meanX) ** 2, 0);
      
      return den === 0 ? 0 : num / den;
    };

    const connections = history.map(h => h.metrics.connections.active);
    const qps = history.map(h => h.metrics.queries.qps);
    const avgDuration = history.map(h => h.metrics.queries.avgDuration);

    return {
      connections: {
        trend: getSlope(connections) > 0 ? 'increasing' : 'decreasing',
        slope: getSlope(connections)
      },
      qps: {
        trend: getSlope(qps) > 0 ? 'increasing' : 'decreasing',
        slope: getSlope(qps)
      },
      avgDuration: {
        trend: getSlope(avgDuration) > 0 ? 'increasing' : 'decreasing',
        slope: getSlope(avgDuration)
      }
    };
  }
}
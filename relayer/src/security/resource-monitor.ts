import { Logger } from 'pino';
import { EventEmitter } from 'events';
import * as os from 'os';
import { getActiveHandlesCount, getActiveRequestsCount, getThreadId } from '../types/node-internals';

export interface ResourceMetrics {
  timestamp: number;
  cpu: {
    usage: number;      // 0-100
    loadAverage: number[];
    cores: number;
  };
  memory: {
    used: number;       // bytes
    free: number;       // bytes
    total: number;      // bytes
    usage: number;      // 0-100
    heapUsed: number;   // bytes
    heapTotal: number;  // bytes
  };
  network: {
    connections: number;
    bandwidth: {
      incoming: number; // bytes/sec
      outgoing: number; // bytes/sec
    };
  };
  disk: {
    used: number;       // bytes
    free: number;       // bytes
    total: number;      // bytes
    usage: number;      // 0-100
    iops: number;       // operations/sec
  };
  process: {
    uptime: number;     // seconds
    pid: number;
    threads: number;
    handles: number;
  };
}

export interface ResourceThresholds {
  cpu: {
    warning: number;    // 70%
    critical: number;   // 90%
    sustained: number;  // Time in ms above warning
  };
  memory: {
    warning: number;    // 80%
    critical: number;   // 95%
    heap: number;       // 85%
  };
  connections: {
    warning: number;    // 1000
    critical: number;   // 5000
  };
  disk: {
    warning: number;    // 85%
    critical: number;   // 95%
  };
  loadAverage: {
    warning: number;    // cores * 0.8
    critical: number;   // cores * 1.5
  };
}

export interface ResourceAlert {
  type: 'cpu' | 'memory' | 'network' | 'disk' | 'load';
  level: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
  sustained?: number; // Duration above threshold
}

export class ResourceMonitor extends EventEmitter {
  private logger: Logger;
  private thresholds: ResourceThresholds;
  private metrics: ResourceMetrics[] = [];
  private maxHistory: number = 1000;
  private monitorInterval: NodeJS.Timeout;
  private alertCooldowns: Map<string, number> = new Map();
  private alertCooldownDuration: number = 300000; // 5 minutes
  
  // State tracking
  private previousNetworkStats: { timestamp: number; bytes: { rx: number; tx: number } } | null = null;
  private sustainedHighCPU: number = 0;
  private activeAlerts: Map<string, ResourceAlert> = new Map();

  constructor(thresholds: Partial<ResourceThresholds>, logger: Logger) {
    super();
    this.logger = logger.child({ component: 'ResourceMonitor' });
    
    // Set default thresholds
    const cores = os.cpus().length;
    this.thresholds = {
      cpu: {
        warning: 70,
        critical: 90,
        sustained: 30000, // 30 seconds
      },
      memory: {
        warning: 80,
        critical: 95,
        heap: 85,
      },
      connections: {
        warning: 1000,
        critical: 5000,
      },
      disk: {
        warning: 85,
        critical: 95,
      },
      loadAverage: {
        warning: cores * 0.8,
        critical: cores * 1.5,
      },
      ...thresholds
    };
    
    // Start monitoring
    this.monitorInterval = setInterval(() => {
      this.collectMetrics();
    }, 5000); // Every 5 seconds
    
    this.logger.info({ thresholds: this.thresholds }, 'Resource monitor started');
  }

  /**
   * Collect system resource metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const timestamp = Date.now();
      
      // CPU metrics
      const cpuUsage = await this.getCPUUsage();
      const loadAverage = os.loadavg();
      
      // Memory metrics
      const memInfo = process.memoryUsage();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      
      // Network metrics (simplified)
      const networkStats = await this.getNetworkStats();
      
      // Disk metrics (would need additional libraries for accurate disk stats)
      const diskStats = await this.getDiskStats();
      
      // Process metrics
      const processStats = {
        uptime: process.uptime(),
        pid: process.pid,
        threads: getThreadId(),
        handles: getActiveHandlesCount()
      };
      
      const metrics: ResourceMetrics = {
        timestamp,
        cpu: {
          usage: cpuUsage,
          loadAverage,
          cores: os.cpus().length
        },
        memory: {
          used: usedMemory,
          free: freeMemory,
          total: totalMemory,
          usage: (usedMemory / totalMemory) * 100,
          heapUsed: memInfo.heapUsed,
          heapTotal: memInfo.heapTotal
        },
        network: networkStats,
        disk: diskStats,
        process: processStats
      };
      
      // Store metrics
      this.metrics.push(metrics);
      if (this.metrics.length > this.maxHistory) {
        this.metrics = this.metrics.slice(-this.maxHistory);
      }
      
      // Check thresholds and emit alerts
      this.checkThresholds(metrics);
      
      this.emit('metrics', metrics);
    } catch (error) {
      this.logger.error({ error }, 'Error collecting resource metrics');
    }
  }

  /**
   * Get CPU usage percentage
   */
  private async getCPUUsage(): Promise<number> {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      const startTime = Date.now();
      
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const endTime = Date.now();
        
        const totalTime = (endTime - startTime) * 1000; // microseconds
        const userTime = endUsage.user;
        const systemTime = endUsage.system;
        const totalCPUTime = userTime + systemTime;
        
        const usage = (totalCPUTime / totalTime) * 100;
        resolve(Math.min(100, Math.max(0, usage)));
      }, 100);
    });
  }

  /**
   * Get network statistics
   */
  private async getNetworkStats(): Promise<ResourceMetrics['network']> {
    // Simplified network stats - in production, would use proper network monitoring
    const activeConnections = this.estimateActiveConnections();
    
    const stats = {
      connections: activeConnections,
      bandwidth: {
        incoming: 0,
        outgoing: 0
      }
    };
    
    // Calculate bandwidth if we have previous stats
    if (this.previousNetworkStats) {
      const timeDelta = Date.now() - this.previousNetworkStats.timestamp;
      if (timeDelta > 0) {
        // Would calculate actual bytes transferred here
        stats.bandwidth.incoming = 0; // bytes/sec
        stats.bandwidth.outgoing = 0; // bytes/sec
      }
    }
    
    this.previousNetworkStats = {
      timestamp: Date.now(),
      bytes: { rx: 0, tx: 0 } // Would track actual bytes
    };
    
    return stats;
  }

  /**
   * Estimate active connections (simplified)
   */
  private estimateActiveConnections(): number {
    // In production, would query actual network connections
    // For now, return a rough estimate based on process handles
    const handles = getActiveHandlesCount();
    const requests = getActiveRequestsCount();
    return handles + requests;
  }

  /**
   * Get disk statistics
   */
  private async getDiskStats(): Promise<ResourceMetrics['disk']> {
    // Simplified disk stats - would use fs.statSync or diskusage library
    return {
      used: 0,
      free: 0,
      total: 0,
      usage: 0,
      iops: 0
    };
  }

  /**
   * Check resource thresholds and emit alerts
   */
  private checkThresholds(metrics: ResourceMetrics): void {
    const now = Date.now();
    
    // CPU checks
    this.checkCPUThresholds(metrics, now);
    
    // Memory checks
    this.checkMemoryThresholds(metrics, now);
    
    // Load average checks
    this.checkLoadAverageThresholds(metrics, now);
    
    // Connection checks
    this.checkConnectionThresholds(metrics, now);
    
    // Disk checks (if enabled)
    if (metrics.disk.total > 0) {
      this.checkDiskThresholds(metrics, now);
    }
  }

  /**
   * Check CPU thresholds
   */
  private checkCPUThresholds(metrics: ResourceMetrics, now: number): void {
    const usage = metrics.cpu.usage;
    
    if (usage >= this.thresholds.cpu.warning) {
      this.sustainedHighCPU += 5000; // Add 5 seconds
      
      if (usage >= this.thresholds.cpu.critical) {
        this.emitAlert({
          type: 'cpu',
          level: 'critical',
          message: `CPU usage critical: ${usage.toFixed(1)}%`,
          value: usage,
          threshold: this.thresholds.cpu.critical,
          timestamp: now
        });
      } else if (this.sustainedHighCPU >= this.thresholds.cpu.sustained) {
        this.emitAlert({
          type: 'cpu',
          level: 'warning',
          message: `Sustained high CPU usage: ${usage.toFixed(1)}%`,
          value: usage,
          threshold: this.thresholds.cpu.warning,
          timestamp: now,
          sustained: this.sustainedHighCPU
        });
      }
    } else {
      this.sustainedHighCPU = Math.max(0, this.sustainedHighCPU - 5000);
      this.resolveAlert('cpu');
    }
  }

  /**
   * Check memory thresholds
   */
  private checkMemoryThresholds(metrics: ResourceMetrics, now: number): void {
    const memUsage = metrics.memory.usage;
    const heapUsage = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;
    
    if (memUsage >= this.thresholds.memory.critical) {
      this.emitAlert({
        type: 'memory',
        level: 'critical',
        message: `Memory usage critical: ${memUsage.toFixed(1)}%`,
        value: memUsage,
        threshold: this.thresholds.memory.critical,
        timestamp: now
      });
    } else if (memUsage >= this.thresholds.memory.warning) {
      this.emitAlert({
        type: 'memory',
        level: 'warning',
        message: `Memory usage high: ${memUsage.toFixed(1)}%`,
        value: memUsage,
        threshold: this.thresholds.memory.warning,
        timestamp: now
      });
    } else {
      this.resolveAlert('memory');
    }
    
    // Check heap usage separately
    if (heapUsage >= this.thresholds.memory.heap) {
      this.emitAlert({
        type: 'memory',
        level: 'warning',
        message: `Heap usage high: ${heapUsage.toFixed(1)}%`,
        value: heapUsage,
        threshold: this.thresholds.memory.heap,
        timestamp: now
      });
    }
  }

  /**
   * Check load average thresholds
   */
  private checkLoadAverageThresholds(metrics: ResourceMetrics, now: number): void {
    const load1 = metrics.cpu.loadAverage[0];
    
    if (load1 >= this.thresholds.loadAverage.critical) {
      this.emitAlert({
        type: 'load',
        level: 'critical',
        message: `Load average critical: ${load1.toFixed(2)}`,
        value: load1,
        threshold: this.thresholds.loadAverage.critical,
        timestamp: now
      });
    } else if (load1 >= this.thresholds.loadAverage.warning) {
      this.emitAlert({
        type: 'load',
        level: 'warning',
        message: `Load average high: ${load1.toFixed(2)}`,
        value: load1,
        threshold: this.thresholds.loadAverage.warning,
        timestamp: now
      });
    } else {
      this.resolveAlert('load');
    }
  }

  /**
   * Check connection thresholds
   */
  private checkConnectionThresholds(metrics: ResourceMetrics, now: number): void {
    const connections = metrics.network.connections;
    
    if (connections >= this.thresholds.connections.critical) {
      this.emitAlert({
        type: 'network',
        level: 'critical',
        message: `Connection count critical: ${connections}`,
        value: connections,
        threshold: this.thresholds.connections.critical,
        timestamp: now
      });
    } else if (connections >= this.thresholds.connections.warning) {
      this.emitAlert({
        type: 'network',
        level: 'warning',
        message: `Connection count high: ${connections}`,
        value: connections,
        threshold: this.thresholds.connections.warning,
        timestamp: now
      });
    } else {
      this.resolveAlert('network');
    }
  }

  /**
   * Check disk thresholds
   */
  private checkDiskThresholds(metrics: ResourceMetrics, now: number): void {
    const diskUsage = metrics.disk.usage;
    
    if (diskUsage >= this.thresholds.disk.critical) {
      this.emitAlert({
        type: 'disk',
        level: 'critical',
        message: `Disk usage critical: ${diskUsage.toFixed(1)}%`,
        value: diskUsage,
        threshold: this.thresholds.disk.critical,
        timestamp: now
      });
    } else if (diskUsage >= this.thresholds.disk.warning) {
      this.emitAlert({
        type: 'disk',
        level: 'warning',
        message: `Disk usage high: ${diskUsage.toFixed(1)}%`,
        value: diskUsage,
        threshold: this.thresholds.disk.warning,
        timestamp: now
      });
    } else {
      this.resolveAlert('disk');
    }
  }

  /**
   * Emit resource alert with cooldown
   */
  private emitAlert(alert: ResourceAlert): void {
    const alertKey = `${alert.type}_${alert.level}`;
    const lastAlert = this.alertCooldowns.get(alertKey) || 0;
    const now = Date.now();
    
    // Check cooldown
    if (now - lastAlert < this.alertCooldownDuration) {
      return;
    }
    
    this.alertCooldowns.set(alertKey, now);
    this.activeAlerts.set(alertKey, alert);
    
    this.logger.warn({ 
      type: alert.type,
      level: alert.level,
      value: alert.value,
      threshold: alert.threshold,
      message: alert.message
    }, 'Resource alert');
    
    this.emit('resourceAlert', alert);
  }

  /**
   * Resolve an alert
   */
  private resolveAlert(type: string): void {
    const warningKey = `${type}_warning`;
    const criticalKey = `${type}_critical`;
    
    if (this.activeAlerts.has(warningKey)) {
      this.activeAlerts.delete(warningKey);
      this.emit('alertResolved', { type, level: 'warning' });
    }
    
    if (this.activeAlerts.has(criticalKey)) {
      this.activeAlerts.delete(criticalKey);
      this.emit('alertResolved', { type, level: 'critical' });
    }
  }

  /**
   * Get current resource metrics
   */
  getCurrentMetrics(): ResourceMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(duration: number = 3600000): ResourceMetrics[] {
    const cutoff = Date.now() - duration;
    return this.metrics.filter(m => m.timestamp > cutoff);
  }

  /**
   * Get resource health status
   */
  getHealthStatus(): {
    healthy: boolean;
    issues: string[];
    metrics: ResourceMetrics | null;
    activeAlerts: ResourceAlert[];
  } {
    const current = this.getCurrentMetrics();
    const issues: string[] = [];
    let healthy = true;
    
    if (!current) {
      return { healthy: false, issues: ['No metrics available'], metrics: null, activeAlerts: [] };
    }
    
    // Check current resource levels
    if (current.cpu.usage >= this.thresholds.cpu.warning) {
      issues.push(`High CPU usage: ${current.cpu.usage.toFixed(1)}%`);
      healthy = false;
    }
    
    if (current.memory.usage >= this.thresholds.memory.warning) {
      issues.push(`High memory usage: ${current.memory.usage.toFixed(1)}%`);
      healthy = false;
    }
    
    if (current.cpu.loadAverage[0] >= this.thresholds.loadAverage.warning) {
      issues.push(`High load average: ${current.cpu.loadAverage[0].toFixed(2)}`);
      healthy = false;
    }
    
    if (current.network.connections >= this.thresholds.connections.warning) {
      issues.push(`High connection count: ${current.network.connections}`);
      healthy = false;
    }
    
    return {
      healthy,
      issues,
      metrics: current,
      activeAlerts: Array.from(this.activeAlerts.values())
    };
  }

  /**
   * Check if system is under stress
   */
  isUnderStress(): boolean {
    const current = this.getCurrentMetrics();
    if (!current) return false;
    
    return current.cpu.usage >= this.thresholds.cpu.warning ||
           current.memory.usage >= this.thresholds.memory.warning ||
           current.cpu.loadAverage[0] >= this.thresholds.loadAverage.warning ||
           current.network.connections >= this.thresholds.connections.warning;
  }

  /**
   * Get system performance score (0-100)
   */
  getPerformanceScore(): number {
    const current = this.getCurrentMetrics();
    if (!current) return 0;
    
    let score = 100;
    
    // CPU penalty
    if (current.cpu.usage > 50) {
      score -= Math.min(40, (current.cpu.usage - 50) * 0.8);
    }
    
    // Memory penalty
    if (current.memory.usage > 60) {
      score -= Math.min(30, (current.memory.usage - 60) * 0.75);
    }
    
    // Load average penalty
    const loadRatio = current.cpu.loadAverage[0] / current.cpu.cores;
    if (loadRatio > 0.5) {
      score -= Math.min(20, (loadRatio - 0.5) * 40);
    }
    
    // Connection penalty
    if (current.network.connections > 500) {
      score -= Math.min(10, (current.network.connections - 500) * 0.01);
    }
    
    return Math.max(0, Math.round(score));
  }

  /**
   * Force garbage collection if available
   */
  forceGC(): void {
    if (global.gc) {
      global.gc();
      this.logger.info('Forced garbage collection');
    } else {
      this.logger.warn('Garbage collection not available (run with --expose-gc)');
    }
  }

  /**
   * Get resource statistics
   */
  getStats(): {
    uptime: number;
    metricsCollected: number;
    activeAlerts: number;
    averageCPU: number;
    averageMemory: number;
    peakCPU: number;
    peakMemory: number;
    performanceScore: number;
  } {
    const recent = this.getMetricsHistory(3600000); // Last hour
    
    if (recent.length === 0) {
      return {
        uptime: process.uptime(),
        metricsCollected: 0,
        activeAlerts: this.activeAlerts.size,
        averageCPU: 0,
        averageMemory: 0,
        peakCPU: 0,
        peakMemory: 0,
        performanceScore: 0
      };
    }
    
    const avgCPU = recent.reduce((sum, m) => sum + m.cpu.usage, 0) / recent.length;
    const avgMemory = recent.reduce((sum, m) => sum + m.memory.usage, 0) / recent.length;
    const peakCPU = Math.max(...recent.map(m => m.cpu.usage));
    const peakMemory = Math.max(...recent.map(m => m.memory.usage));
    
    return {
      uptime: process.uptime(),
      metricsCollected: this.metrics.length,
      activeAlerts: this.activeAlerts.size,
      averageCPU: avgCPU,
      averageMemory: avgMemory,
      peakCPU,
      peakMemory,
      performanceScore: this.getPerformanceScore()
    };
  }

  /**
   * Destroy the resource monitor
   */
  destroy(): void {
    clearInterval(this.monitorInterval);
    this.metrics = [];
    this.activeAlerts.clear();
    this.alertCooldowns.clear();
    this.removeAllListeners();
  }
}
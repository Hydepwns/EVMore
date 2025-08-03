import { Logger } from 'pino';
import { EventEmitter } from 'events';
import { MetricsCollector, MetricSample, HealthCheck } from './metrics-collector';

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export interface Alert {
  id: string;
  name: string;
  severity: AlertSeverity;
  message: string;
  timestamp: number;
  resolved?: boolean;
  resolvedAt?: number;
  metadata?: Record<string, any>;
}

export interface AlertRule {
  name: string;
  condition: (metrics: MetricsCollector) => Promise<boolean>;
  severity: AlertSeverity;
  message: string;
  cooldownMs: number; // Minimum time between alerts
  autoResolve?: boolean; // Whether to auto-resolve when condition is false
}

export interface AlertChannel {
  name: string;
  enabled: boolean;
  send: (alert: Alert) => Promise<void>;
}

export class AlertingSystem extends EventEmitter {
  private rules: Map<string, AlertRule> = new Map();
  private channels: Map<string, AlertChannel> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private metrics: MetricsCollector;
  private logger: Logger;
  private checkInterval: NodeJS.Timeout;
  private alertHistory: Alert[] = [];

  constructor(metrics: MetricsCollector, logger: Logger) {
    super();
    this.metrics = metrics;
    this.logger = logger.child({ component: 'AlertingSystem' });
    
    // Check rules every 30 seconds
    this.checkInterval = setInterval(() => {
      this.checkRules();
    }, 30000);

    this.initializeDefaultRules();
  }

  /**
   * Add an alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.name, rule);
    this.logger.info({ ruleName: rule.name, severity: rule.severity }, 'Alert rule added');
  }

  /**
   * Remove an alert rule
   */
  removeRule(name: string): void {
    this.rules.delete(name);
    this.logger.info({ ruleName: name }, 'Alert rule removed');
  }

  /**
   * Add an alert channel
   */
  addChannel(channel: AlertChannel): void {
    this.channels.set(channel.name, channel);
    this.logger.info({ channelName: channel.name }, 'Alert channel added');
  }

  /**
   * Remove an alert channel
   */
  removeChannel(name: string): void {
    this.channels.delete(name);
    this.logger.info({ channelName: name }, 'Alert channel removed');
  }

  /**
   * Fire an alert manually
   */
  async fireAlert(name: string, severity: AlertSeverity, message: string, metadata?: Record<string, any>): Promise<void> {
    const alert: Alert = {
      id: `${name}-${Date.now()}`,
      name,
      severity,
      message,
      timestamp: Date.now(),
      metadata
    };

    await this.processAlert(alert);
  }

  /**
   * Resolve an alert manually
   */
  resolveAlert(name: string): void {
    const alert = this.activeAlerts.get(name);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      this.activeAlerts.delete(name);
      
      this.logger.info({ alertName: name }, 'Alert manually resolved');
      this.emit('alertResolved', alert);
    }
  }

  /**
   * Get all active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit: number = 100): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Check all rules and process alerts
   */
  private async checkRules(): Promise<void> {
    for (const [name, rule] of this.rules.entries()) {
      try {
        const shouldAlert = await rule.condition(this.metrics);
        const lastAlert = this.lastAlertTime.get(name) || 0;
        const now = Date.now();
        
        if (shouldAlert) {
          // Check cooldown period
          if (now - lastAlert < rule.cooldownMs) {
            continue;
          }

          const alert: Alert = {
            id: `${name}-${now}`,
            name,
            severity: rule.severity,
            message: rule.message,
            timestamp: now
          };

          await this.processAlert(alert);
          this.lastAlertTime.set(name, now);
        } else if (rule.autoResolve) {
          // Auto-resolve if condition is no longer met
          const activeAlert = this.activeAlerts.get(name);
          if (activeAlert) {
            activeAlert.resolved = true;
            activeAlert.resolvedAt = now;
            this.activeAlerts.delete(name);
            
            this.logger.info({ alertName: name }, 'Alert auto-resolved');
            this.emit('alertResolved', activeAlert);
          }
        }
      } catch (error) {
        this.logger.error({ error, ruleName: name }, 'Error checking alert rule');
      }
    }
  }

  /**
   * Process and send an alert
   */
  private async processAlert(alert: Alert): Promise<void> {
    // Add to active alerts
    this.activeAlerts.set(alert.name, alert);
    
    // Add to history
    this.alertHistory.push(alert);
    
    // Keep history size manageable
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-500);
    }

    this.logger.warn({ 
      alert: alert.name, 
      severity: alert.severity, 
      message: alert.message 
    }, 'Alert fired');

    // Send to all enabled channels
    for (const channel of this.channels.values()) {
      if (channel.enabled) {
        try {
          await channel.send(alert);
        } catch (error) {
          this.logger.error({ 
            error, 
            channelName: channel.name, 
            alertName: alert.name 
          }, 'Failed to send alert');
        }
      }
    }

    this.emit('alert', alert);
  }

  /**
   * Initialize default alert rules for Fusion+
   */
  private initializeDefaultRules(): void {
    // High failure rate
    this.addRule({
      name: 'high_failure_rate',
      condition: async (metrics) => {
        const failed = metrics.getMetric('fusion_htlc_completed_total')?.value || 0;
        const total = (metrics.getMetric('fusion_htlc_created_total')?.value || 0);
        return total > 0 && (failed / total) > 0.1; // >10% failure rate
      },
      severity: AlertSeverity.WARNING,
      message: 'High HTLC failure rate detected (>10%)',
      cooldownMs: 300000, // 5 minutes
      autoResolve: true
    });

    // Low relayer balance
    this.addRule({
      name: 'low_relayer_balance',
      condition: async (metrics) => {
        const balance = metrics.getMetric('fusion_relayer_balance')?.value || 0;
        return balance < 1000; // Less than 1000 units
      },
      severity: AlertSeverity.ERROR,
      message: 'Relayer balance is critically low',
      cooldownMs: 600000, // 10 minutes
      autoResolve: true
    });

    // Health check failures
    this.addRule({
      name: 'health_check_failure',
      condition: async (metrics) => {
        const health = metrics.getOverallHealth();
        return !health.healthy;
      },
      severity: AlertSeverity.ERROR,
      message: 'System health check failures detected',
      cooldownMs: 180000, // 3 minutes
      autoResolve: true
    });

    // High pending IBC packets
    this.addRule({
      name: 'high_pending_ibc',
      condition: async (metrics) => {
        const pending = metrics.getMetric('fusion_ibc_packets_pending')?.value || 0;
        return pending > 50;
      },
      severity: AlertSeverity.WARNING,
      message: 'High number of pending IBC packets',
      cooldownMs: 300000, // 5 minutes
      autoResolve: true
    });

    // Stuck HTLCs
    this.addRule({
      name: 'stuck_htlcs',
      condition: async (metrics) => {
        const active = metrics.getMetric('fusion_active_htlcs')?.value || 0;
        const samples = metrics.getSamples('fusion_active_htlcs', Date.now() - 1800000); // Last 30 min
        
        // If active HTLCs haven't decreased in 30 minutes and we have >5
        return active > 5 && samples.length > 0 && 
               Math.min(...samples.map(s => s.value)) >= active;
      },
      severity: AlertSeverity.WARNING,
      message: 'HTLCs appear to be stuck (no completion in 30 minutes)',
      cooldownMs: 900000, // 15 minutes
      autoResolve: true
    });

    // Circuit breaker alerts would be added by the circuit breaker system
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    totalRules: number;
    totalChannels: number;
    activeAlerts: number;
    totalAlertsToday: number;
    alertsByType: Record<AlertSeverity, number>;
  } {
    const today = Date.now() - 86400000; // 24 hours ago
    const todayAlerts = this.alertHistory.filter(a => a.timestamp > today);
    
    const alertsByType: Record<AlertSeverity, number> = {
      [AlertSeverity.INFO]: 0,
      [AlertSeverity.WARNING]: 0,
      [AlertSeverity.ERROR]: 0,
      [AlertSeverity.CRITICAL]: 0
    };

    for (const alert of todayAlerts) {
      alertsByType[alert.severity]++;
    }

    return {
      totalRules: this.rules.size,
      totalChannels: this.channels.size,
      activeAlerts: this.activeAlerts.size,
      totalAlertsToday: todayAlerts.length,
      alertsByType
    };
  }

  /**
   * Destroy the alerting system
   */
  destroy(): void {
    clearInterval(this.checkInterval);
    this.rules.clear();
    this.channels.clear();
    this.activeAlerts.clear();
    this.removeAllListeners();
  }
}

/**
 * Simple log-based alert channel
 */
export class LogAlertChannel implements AlertChannel {
  name = 'log';
  enabled = true;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'LogAlertChannel' });
  }

  async send(alert: Alert): Promise<void> {
    const logLevel = this.getLogLevel(alert.severity);
    this.logger[logLevel]({
      alert: alert.name,
      severity: alert.severity,
      message: alert.message,
      metadata: alert.metadata
    }, `ALERT: ${alert.message}`);
  }

  private getLogLevel(severity: AlertSeverity): keyof Logger {
    switch (severity) {
      case AlertSeverity.CRITICAL:
      case AlertSeverity.ERROR:
        return 'error';
      case AlertSeverity.WARNING:
        return 'warn';
      default:
        return 'info';
    }
  }
}

/**
 * Webhook-based alert channel
 */
export class WebhookAlertChannel implements AlertChannel {
  name = 'webhook';
  enabled = true;
  private url: string;
  private logger: Logger;

  constructor(url: string, logger: Logger) {
    this.url = url;
    this.logger = logger.child({ component: 'WebhookAlertChannel' });
  }

  async send(alert: Alert): Promise<void> {
    try {
      const payload = {
        alert: alert.name,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp,
        metadata: alert.metadata
      };

      // In a real implementation, use fetch or axios
      this.logger.info({ url: this.url, payload }, 'Would send webhook alert');
      
      // For now, just log - uncomment for real webhook
      // const response = await fetch(this.url, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(payload)
      // });
      
      // if (!response.ok) {
      //   throw new Error(`Webhook failed: ${response.status}`);
      // }
    } catch (error) {
      this.logger.error({ error, url: this.url }, 'Failed to send webhook alert');
      throw error;
    }
  }
}
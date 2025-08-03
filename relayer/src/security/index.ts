/**
 * Comprehensive security suite for the Fusion+ relayer
 * 
 * This module integrates:
 * - Rate limiting to prevent DoS attacks
 * - Circuit breakers for emergency stops
 * - Security manager for threat detection
 * - Monitoring and alerting systems
 */

export { RateLimiter, HTLCRateLimiter, SwapRateLimiter, APIRateLimiter } from '../middleware/rate-limiter';
export { SecurityManager, SecurityConfig, SecurityEvent } from './security-manager';
export { 
  CircuitBreaker, 
  CircuitBreakerManager, 
  FusionCircuitBreakers,
  CircuitState 
} from './circuit-breaker';
import { AlertSeverity } from '../monitoring/alerting-system';

export { 
  MetricsCollector,
  FusionMetrics,
  Metric,
  MetricSample,
  HealthCheck 
} from '../monitoring/metrics-collector';
export {
  AlertingSystem,
  AlertSeverity,
  Alert,
  AlertRule,
  AlertChannel,
  LogAlertChannel,
  WebhookAlertChannel
} from '../monitoring/alerting-system';

import { Logger } from 'pino';
import { SecurityManager, SecurityConfig } from './security-manager';
import { FusionCircuitBreakers } from './circuit-breaker';
import { FusionMetrics } from '../monitoring/metrics-collector';
import { AlertingSystem, LogAlertChannel, WebhookAlertChannel } from '../monitoring/alerting-system';

export interface SecuritySuiteConfig {
  security: SecurityConfig;
  webhookUrl?: string;
  enableMetrics: boolean;
  enableAlerting: boolean;
}

/**
 * Integrated security suite for the Fusion+ relayer
 */
export class FusionSecuritySuite {
  private logger: Logger;
  private securityManager: SecurityManager;
  private circuitBreakers: FusionCircuitBreakers;
  private metrics: FusionMetrics;
  private alerting?: AlertingSystem;

  constructor(config: SecuritySuiteConfig, logger: Logger) {
    this.logger = logger.child({ component: 'FusionSecuritySuite' });
    
    // Initialize metrics first (needed by other components)
    this.metrics = new FusionMetrics(logger);
    
    // Initialize security manager
    this.securityManager = new SecurityManager(config.security, logger);
    
    // Initialize circuit breakers
    this.circuitBreakers = new FusionCircuitBreakers(logger);
    
    // Initialize alerting if enabled
    if (config.enableAlerting) {
      this.alerting = new AlertingSystem(this.metrics, logger);
      
      // Add default channels
      this.alerting.addChannel(new LogAlertChannel(logger));
      
      if (config.webhookUrl) {
        this.alerting.addChannel(new WebhookAlertChannel(config.webhookUrl, logger));
      }
    }
    
    this.setupIntegrations();
    this.logger.info('Fusion security suite initialized');
  }

  /**
   * Setup integrations between different security components
   */
  private setupIntegrations(): void {
    // Connect security events to metrics
    this.securityManager.onSecurityEvent('metrics', (event) => {
      this.metrics.incrementCounter('fusion_security_events_total', 1, {
        type: event.type,
        address: event.address || 'unknown',
        ip: event.ip || 'unknown'
      });
    });

    // Connect circuit breaker events to metrics and alerts
    const manager = this.circuitBreakers.getManager();
    
    // Monitor circuit breaker state changes
    setInterval(() => {
      const stats = manager.getAllStats();
      
      for (const [name, stat] of Object.entries(stats)) {
        this.metrics.setGauge(`fusion_circuit_breaker_state`, 
          stat.state === 'closed' ? 0 : stat.state === 'open' ? 1 : 0.5, 
          { circuit: name }
        );
        
        this.metrics.setGauge(`fusion_circuit_breaker_failures`, stat.failures, { circuit: name });
        this.metrics.setGauge(`fusion_circuit_breaker_requests`, stat.requests, { circuit: name });
      }
    }, 30000); // Every 30 seconds

    // Add circuit breaker alert rules
    if (this.alerting) {
      this.alerting.addRule({
        name: 'circuit_breaker_open',
        condition: async (metrics) => {
          return manager.hasOpenCircuits();
        },
        severity: AlertSeverity.ERROR,
        message: `Circuit breakers open: ${manager.getOpenCircuits().join(', ')}`,
        cooldownMs: 300000, // 5 minutes
        autoResolve: true
      });
    }

    this.logger.info('Security integrations configured');
  }

  /**
   * Comprehensive security check for HTLC operations
   */
  async checkHTLCOperation(request: {
    sender: string;
    ip?: string;
    amount?: string;
    operation: 'create' | 'withdraw' | 'refund';
  }): Promise<{ allowed: boolean; reason?: string; retryAfter?: number }> {
    // 1. Security manager check
    const securityCheck = await this.securityManager.checkHTLCOperation(request);
    if (!securityCheck.allowed) {
      this.metrics.incrementCounter('fusion_htlc_blocked_total', 1, { 
        reason: 'security',
        operation: request.operation 
      });
      return securityCheck;
    }

    // 2. Circuit breaker check
    const circuitName = request.operation === 'create' ? 'ethereum' : 'cosmos';
    const circuit = circuitName === 'ethereum' ? this.circuitBreakers.ethereum : this.circuitBreakers.cosmos;
    
    if (!circuit.isOperationAllowed()) {
      this.metrics.incrementCounter('fusion_htlc_blocked_total', 1, { 
        reason: 'circuit_breaker',
        operation: request.operation 
      });
      return { 
        allowed: false, 
        reason: `${circuitName} circuit breaker is open`
      };
    }

    return { allowed: true };
  }

  /**
   * Execute HTLC operation with full security protection
   */
  async executeHTLCOperation<T>(
    request: { sender: string; ip?: string; amount?: string; operation: 'create' | 'withdraw' | 'refund' },
    operation: () => Promise<T>
  ): Promise<T> {
    // Security check
    const check = await this.checkHTLCOperation(request);
    if (!check.allowed) {
      throw new Error(check.reason || 'Operation blocked by security');
    }

    // Execute with circuit breaker protection
    const circuitName = request.operation === 'create' ? 'ethereum' : 'cosmos';
    const circuit = circuitName === 'ethereum' ? this.circuitBreakers.ethereum : this.circuitBreakers.cosmos;
    
    const startTime = Date.now();
    
    try {
      const result = await circuit.execute(operation);
      
      // Record success metrics
      this.metrics.recordHTLCCompleted(circuitName, true, Date.now() - startTime);
      
      return result;
    } catch (error) {
      // Record failure metrics
      this.metrics.recordHTLCCompleted(circuitName, false, Date.now() - startTime);
      
      // Record failed attempt for security tracking
      this.securityManager.recordFailedAttempt(request.sender, {
        operation: request.operation,
        error: error instanceof Error ? error.message : 'Unknown error',
        ip: request.ip
      });
      
      throw error;
    }
  }

  /**
   * Get comprehensive security status
   */
  getSecurityStatus(): {
    security: ReturnType<SecurityManager['getStats']>;
    circuitBreakers: Record<string, any>;
    metrics: ReturnType<FusionMetrics['getSummary']>;
    alerts?: ReturnType<AlertingSystem['getStats']>;
  } {
    return {
      security: this.securityManager.getStats(),
      circuitBreakers: this.circuitBreakers.getManager().getAllStats(),
      metrics: this.metrics.getSummary(),
      alerts: this.alerting?.getStats()
    };
  }

  /**
   * Emergency stop - trip all circuit breakers and block all operations
   */
  emergencyStop(reason: string = 'Manual emergency stop'): void {
    this.logger.error({ reason }, 'EMERGENCY STOP ACTIVATED');
    
    // Trip all circuit breakers
    const manager = this.circuitBreakers.getManager();
    manager.resetAll(); // Reset first to ensure they can be tripped
    
    ['ethereum', 'cosmos', 'ibc', 'dex'].forEach(name => {
      manager.trip(name, reason);
    });
    
    // Fire critical alert
    if (this.alerting) {
      this.alerting.fireAlert('emergency_stop', AlertSeverity.CRITICAL, `Emergency stop activated: ${reason}`);
    }
    
    // Record metrics
    this.metrics.incrementCounter('fusion_emergency_stops_total', 1);
    this.metrics.setGauge('fusion_emergency_active', 1);
  }

  /**
   * Recover from emergency stop
   */
  emergencyRecover(): void {
    this.logger.info('Recovering from emergency stop');
    
    // Reset all circuit breakers
    this.circuitBreakers.getManager().resetAll();
    
    // Reset security state
    this.securityManager.resetAll();
    
    // Clear emergency flag
    this.metrics.setGauge('fusion_emergency_active', 0);
    
    if (this.alerting) {
      this.alerting.fireAlert('emergency_recover', AlertSeverity.INFO, 'System recovered from emergency stop');
    }
  }

  /**
   * Get health status of all security components
   */
  async getHealthStatus(): Promise<Record<string, { healthy: boolean; details?: any }>> {
    const status: Record<string, { healthy: boolean; details?: any }> = {};
    
    // Security manager health
    const secStats = this.securityManager.getStats();
    status.security = {
      healthy: secStats.blockedIPs < 10 && secStats.failedAttempts < 100,
      details: secStats
    };
    
    // Circuit breakers health
    const cbStats = this.circuitBreakers.getManager().getAllStats();
    const openCircuits = Object.values(cbStats).filter(s => s.state === 'open').length;
    status.circuitBreakers = {
      healthy: openCircuits === 0,
      details: { openCircuits, total: Object.keys(cbStats).length }
    };
    
    // Metrics health
    const metricsStats = this.metrics.getSummary();
    status.metrics = {
      healthy: metricsStats.systemHealth.healthy,
      details: metricsStats
    };
    
    // Alerting health
    if (this.alerting) {
      const alertStats = this.alerting.getStats();
      status.alerting = {
        healthy: alertStats.activeAlerts < 5,
        details: alertStats
      };
    }
    
    return status;
  }

  /**
   * Cleanup and destroy all security components
   */
  destroy(): void {
    this.securityManager.destroy();
    this.metrics.destroy();
    this.alerting?.destroy();
    
    this.logger.info('Fusion security suite destroyed');
  }
}
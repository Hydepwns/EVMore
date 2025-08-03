import { Logger } from 'pino';
import { EventEmitter } from 'events';

export interface AbusePattern {
  type: 'rate_limit_violation' | 'volume_anomaly' | 'bot_behavior' | 'repeated_failures' | 'suspicious_timing';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-1
  description: string;
  evidence: Record<string, any>;
  affectedAddresses: string[];
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface AbuseAlert {
  id: string;
  pattern: AbusePattern;
  status: 'active' | 'resolved' | 'escalated';
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  escalatedAt?: number;
  actions: Array<{
    type: string;
    timestamp: number;
    result: 'success' | 'failure';
    details?: string;
  }>;
}

export interface AbuseConfig {
  // Rate limiting thresholds
  maxRequestsPerMinute: number;
  maxFailuresPerMinute: number;
  maxVolumePerHour: number;
  
  // Pattern detection
  minConfidenceThreshold: number;
  patternWindowMs: number;
  alertCooldownMs: number;
  
  // Auto-response
  enableAutoBlacklist: boolean;
  autoBlacklistThreshold: number;
  enableAutoScaling: boolean;
  
  // Notification settings
  webhookUrl?: string;
  slackWebhook?: string;
  emailAlerts?: string[];
}

export class AbuseDetector extends EventEmitter {
  private config: AbuseConfig;
  private logger: Logger;
  
  // Pattern tracking
  private requestHistory: Array<{
    address: string;
    timestamp: number;
    success: boolean;
    volume?: number;
    endpoint: string;
    metadata?: Record<string, any>;
  }> = [];
  
  private detectedPatterns: Map<string, AbusePattern> = new Map();
  private activeAlerts: Map<string, AbuseAlert> = new Map();
  private suppressedAddresses: Set<string> = new Set();
  
  // Performance metrics
  private metrics = {
    totalRequests: 0,
    blockedRequests: 0,
    patternsDetected: 0,
    alertsGenerated: 0,
    autoActionsTriggered: 0
  };
  
  private cleanupInterval: NodeJS.Timeout;
  private analysisInterval: NodeJS.Timeout;

  constructor(config: AbuseConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'AbuseDetector' });
    
    // Start background analysis
    this.analysisInterval = setInterval(() => {
      this.analyzePatterns();
    }, 10000); // Analyze every 10 seconds
    
    // Clean up old data
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 300000); // Clean up every 5 minutes
    
    this.logger.info({ config }, 'Abuse detector initialized');
  }

  /**
   * Record a request for analysis
   */
  recordRequest(data: {
    address: string;
    endpoint: string;
    success: boolean;
    volume?: number;
    responseTime?: number;
    userAgent?: string;
    metadata?: Record<string, any>;
  }): void {
    this.metrics.totalRequests++;
    
    this.requestHistory.push({
      address: data.address,
      timestamp: Date.now(),
      success: data.success,
      volume: data.volume,
      endpoint: data.endpoint,
      metadata: {
        responseTime: data.responseTime,
        userAgent: data.userAgent,
        ...data.metadata
      }
    });
    
    // Immediate analysis for high-risk patterns
    this.checkImmediateThreats(data);
  }

  /**
   * Check for immediate threats that require instant action
   */
  private checkImmediateThreats(data: {
    address: string;
    endpoint: string;
    success: boolean;
  }): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Check recent requests from this address
    const recentRequests = this.requestHistory.filter(r => 
      r.address === data.address && r.timestamp > oneMinuteAgo
    );
    
    // Rate limit violation
    if (recentRequests.length > this.config.maxRequestsPerMinute) {
      this.reportPattern({
        type: 'rate_limit_violation',
        severity: 'high',
        confidence: 0.9,
        description: `Address exceeded ${this.config.maxRequestsPerMinute} requests per minute`,
        evidence: {
          requestCount: recentRequests.length,
          timeWindow: '1 minute',
          endpoints: [...new Set(recentRequests.map(r => r.endpoint))]
        },
        affectedAddresses: [data.address],
        timestamp: now
      });
    }
    
    // Excessive failures
    const recentFailures = recentRequests.filter(r => !r.success);
    if (recentFailures.length > this.config.maxFailuresPerMinute) {
      this.reportPattern({
        type: 'repeated_failures',
        severity: 'medium',
        confidence: 0.8,
        description: `Address has ${recentFailures.length} failures in the last minute`,
        evidence: {
          failureCount: recentFailures.length,
          successRate: (recentRequests.length - recentFailures.length) / recentRequests.length,
          endpoints: [...new Set(recentFailures.map(r => r.endpoint))]
        },
        affectedAddresses: [data.address],
        timestamp: now
      });
    }
  }

  /**
   * Analyze patterns in request history
   */
  private analyzePatterns(): void {
    const now = Date.now();
    const windowStart = now - this.config.patternWindowMs;
    const recentRequests = this.requestHistory.filter(r => r.timestamp > windowStart);
    
    if (recentRequests.length === 0) return;
    
    // Group by address for analysis
    const addressGroups = new Map<string, typeof recentRequests>();
    recentRequests.forEach(request => {
      if (!addressGroups.has(request.address)) {
        addressGroups.set(request.address, []);
      }
      addressGroups.get(request.address)!.push(request);
    });
    
    // Analyze each address
    addressGroups.forEach((requests, address) => {
      this.analyzeAddressBehavior(address, requests, now);
    });
    
    // Global pattern analysis
    this.analyzeGlobalPatterns(recentRequests, now);
  }

  /**
   * Analyze behavior patterns for a specific address
   */
  private analyzeAddressBehavior(address: string, requests: any[], now: number): void {
    if (requests.length < 5) return; // Need minimum data for analysis
    
    // Bot behavior detection
    const botScore = this.calculateBotScore(requests);
    if (botScore > 0.7) {
      this.reportPattern({
        type: 'bot_behavior',
        severity: botScore > 0.9 ? 'high' : 'medium',
        confidence: botScore,
        description: `Address shows bot-like behavior patterns`,
        evidence: {
          botScore,
          regularTiming: this.hasRegularTiming(requests),
          identicalRequests: this.hasIdenticalRequests(requests),
          missingUserAgent: this.hasMissingUserAgent(requests)
        },
        affectedAddresses: [address],
        timestamp: now
      });
    }
    
    // Volume anomaly detection
    const totalVolume = requests.reduce((sum, r) => sum + (r.volume || 0), 0);
    if (totalVolume > this.config.maxVolumePerHour) {
      this.reportPattern({
        type: 'volume_anomaly',
        severity: 'high',
        confidence: 0.95,
        description: `Address exceeded volume threshold`,
        evidence: {
          totalVolume,
          threshold: this.config.maxVolumePerHour,
          requestCount: requests.length,
          averageVolume: totalVolume / requests.length
        },
        affectedAddresses: [address],
        timestamp: now
      });
    }
    
    // Suspicious timing patterns
    if (this.hasSuspiciousTiming(requests)) {
      this.reportPattern({
        type: 'suspicious_timing',
        severity: 'medium',
        confidence: 0.75,
        description: `Address shows suspicious timing patterns`,
        evidence: {
          timingVariance: this.calculateTimingVariance(requests),
          requestCount: requests.length,
          timeSpread: Math.max(...requests.map(r => r.timestamp)) - Math.min(...requests.map(r => r.timestamp))
        },
        affectedAddresses: [address],
        timestamp: now
      });
    }
  }

  /**
   * Analyze global patterns across all addresses
   */
  private analyzeGlobalPatterns(requests: any[], now: number): void {
    // Coordinated attack detection
    const addressCounts = new Map<string, number>();
    requests.forEach(request => {
      addressCounts.set(request.address, (addressCounts.get(request.address) || 0) + 1);
    });
    
    // Look for many addresses with similar behavior
    const suspiciousAddresses = Array.from(addressCounts.entries())
      .filter(([_, count]) => count > 10)
      .map(([address, _]) => address);
    
    if (suspiciousAddresses.length > 10) {
      this.reportPattern({
        type: 'bot_behavior',
        severity: 'critical',
        confidence: 0.85,
        description: `Coordinated attack detected from ${suspiciousAddresses.length} addresses`,
        evidence: {
          addressCount: suspiciousAddresses.length,
          totalRequests: requests.length,
          timeWindow: this.config.patternWindowMs / 1000 / 60 + ' minutes'
        },
        affectedAddresses: suspiciousAddresses.slice(0, 50), // Limit for event size
        timestamp: now
      });
    }
  }

  /**
   * Calculate bot behavior score
   */
  private calculateBotScore(requests: any[]): number {
    let score = 0;
    
    // Regular timing (very precise intervals suggest automation)
    if (this.hasRegularTiming(requests)) score += 0.3;
    
    // Identical requests
    if (this.hasIdenticalRequests(requests)) score += 0.2;
    
    // Missing or suspicious user agents
    if (this.hasMissingUserAgent(requests)) score += 0.2;
    
    // High request frequency
    const timeSpread = Math.max(...requests.map(r => r.timestamp)) - Math.min(...requests.map(r => r.timestamp));
    const frequency = requests.length / (timeSpread / 1000); // requests per second
    if (frequency > 2) score += 0.3;
    
    return Math.min(1, score);
  }

  /**
   * Check if requests have suspiciously regular timing
   */
  private hasRegularTiming(requests: any[]): boolean {
    if (requests.length < 3) return false;
    
    const timestamps = requests.map(r => r.timestamp).sort();
    const intervals = [];
    
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => 
      sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
    
    // Very low variance suggests bot behavior
    return variance < 1000 && avgInterval < 5000; // Less than 1 second variance, less than 5 second intervals
  }

  /**
   * Check if requests are identical (suggesting bot behavior)
   */
  private hasIdenticalRequests(requests: any[]): boolean {
    const uniqueEndpoints = new Set(requests.map(r => r.endpoint));
    return uniqueEndpoints.size === 1 && requests.length > 10;
  }

  /**
   * Check for missing user agents
   */
  private hasMissingUserAgent(requests: any[]): boolean {
    const withUserAgent = requests.filter(r => r.metadata?.userAgent).length;
    return withUserAgent / requests.length < 0.5; // Less than 50% have user agents
  }

  /**
   * Check for suspicious timing patterns
   */
  private hasSuspiciousTiming(requests: any[]): boolean {
    if (requests.length < 10) return false;
    
    // Check for burst patterns followed by silence
    const timestamps = requests.map(r => r.timestamp).sort();
    const intervals = [];
    
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    
    // Look for very short intervals followed by very long intervals
    const shortIntervals = intervals.filter(i => i < 100).length; // Less than 100ms
    const longIntervals = intervals.filter(i => i > 10000).length; // More than 10s
    
    return shortIntervals > 0 && longIntervals > 0;
  }

  /**
   * Calculate timing variance for a set of requests
   */
  private calculateTimingVariance(requests: any[]): number {
    if (requests.length < 2) return 0;
    
    const timestamps = requests.map(r => r.timestamp).sort();
    const intervals = [];
    
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return intervals.reduce((sum, interval) => 
      sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
  }

  /**
   * Report a detected abuse pattern
   */
  private reportPattern(pattern: AbusePattern): void {
    if (pattern.confidence < this.config.minConfidenceThreshold) {
      return; // Below threshold
    }
    
    const patternKey = `${pattern.type}-${pattern.affectedAddresses.join(',')}-${Math.floor(pattern.timestamp / this.config.alertCooldownMs)}`;
    
    // Prevent spam alerts
    if (this.detectedPatterns.has(patternKey)) {
      return;
    }
    
    this.detectedPatterns.set(patternKey, pattern);
    this.metrics.patternsDetected++;
    
    // Create alert
    const alert: AbuseAlert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      pattern,
      status: 'active',
      createdAt: pattern.timestamp,
      updatedAt: pattern.timestamp,
      actions: []
    };
    
    this.activeAlerts.set(alert.id, alert);
    this.metrics.alertsGenerated++;
    
    // Log the alert
    this.logger.warn({
      alertId: alert.id,
      pattern: pattern.type,
      severity: pattern.severity,
      confidence: pattern.confidence,
      addresses: pattern.affectedAddresses.slice(0, 5) // Limit log size
    }, 'Abuse pattern detected');
    
    // Emit event for external handling
    this.emit('abuseDetected', alert);
    
    // Auto-response if enabled
    if (this.shouldAutoRespond(pattern)) {
      this.triggerAutoResponse(alert);
    }
    
    // Send notifications
    this.sendNotifications(alert);
  }

  /**
   * Determine if auto-response should be triggered
   */
  private shouldAutoRespond(pattern: AbusePattern): boolean {
    if (!this.config.enableAutoBlacklist) return false;
    
    return pattern.confidence >= this.config.autoBlacklistThreshold &&
           (pattern.severity === 'high' || pattern.severity === 'critical');
  }

  /**
   * Trigger automatic response to abuse
   */
  private async triggerAutoResponse(alert: AbuseAlert): Promise<void> {
    try {
      this.metrics.autoActionsTriggered++;
      
      // Blacklist affected addresses
      for (const address of alert.pattern.affectedAddresses) {
        this.suppressedAddresses.add(address);
      }
      
      alert.actions.push({
        type: 'auto_blacklist',
        timestamp: Date.now(),
        result: 'success',
        details: `Blacklisted ${alert.pattern.affectedAddresses.length} addresses`
      });
      
      alert.updatedAt = Date.now();
      
      this.logger.warn({
        alertId: alert.id,
        addressCount: alert.pattern.affectedAddresses.length
      }, 'Auto-blacklist triggered');
      
      this.emit('autoActionTriggered', alert);
      
    } catch (error) {
      alert.actions.push({
        type: 'auto_blacklist',
        timestamp: Date.now(),
        result: 'failure',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
      
      this.logger.error({ error, alertId: alert.id }, 'Auto-response failed');
    }
  }

  /**
   * Send notifications for the alert
   */
  private async sendNotifications(alert: AbuseAlert): Promise<void> {
    // Implementation would depend on configured notification channels
    if (this.config.webhookUrl) {
      // Send webhook notification
      // Implementation left for specific deployment
    }
    
    if (this.config.slackWebhook) {
      // Send Slack notification
      // Implementation left for specific deployment
    }
    
    if (this.config.emailAlerts && this.config.emailAlerts.length > 0) {
      // Send email alerts
      // Implementation left for specific deployment
    }
  }

  /**
   * Check if an address is suppressed
   */
  isAddressSuppressed(address: string): boolean {
    return this.suppressedAddresses.has(address);
  }

  /**
   * Remove address from suppression list
   */
  unsuppressAddress(address: string): void {
    this.suppressedAddresses.delete(address);
    this.logger.info({ address }, 'Address removed from suppression list');
  }

  /**
   * Get current abuse detection statistics
   */
  getStats(): {
    metrics: typeof this.metrics;
    activeAlerts: number;
    suppressedAddresses: number;
    recentPatterns: number;
  } {
    const now = Date.now();
    const recentPatterns = Array.from(this.detectedPatterns.values())
      .filter(p => now - p.timestamp < 3600000).length; // Last hour
    
    return {
      metrics: { ...this.metrics },
      activeAlerts: this.activeAlerts.size,
      suppressedAddresses: this.suppressedAddresses.size,
      recentPatterns
    };
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): AbuseAlert[] {
    return Array.from(this.activeAlerts.values())
      .filter(alert => alert.status === 'active');
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string, reason?: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return false;
    
    alert.status = 'resolved';
    alert.resolvedAt = Date.now();
    alert.updatedAt = Date.now();
    
    if (reason) {
      alert.actions.push({
        type: 'manual_resolve',
        timestamp: Date.now(),
        result: 'success',
        details: reason
      });
    }
    
    this.logger.info({ alertId, reason }, 'Alert resolved');
    return true;
  }

  /**
   * Clean up old data
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = this.config.patternWindowMs * 2;
    
    // Clean request history
    this.requestHistory = this.requestHistory.filter(r => now - r.timestamp < maxAge);
    
    // Clean old patterns
    for (const [key, pattern] of this.detectedPatterns.entries()) {
      if (now - pattern.timestamp > maxAge) {
        this.detectedPatterns.delete(key);
      }
    }
    
    // Clean resolved alerts older than 24 hours
    for (const [id, alert] of this.activeAlerts.entries()) {
      if (alert.status === 'resolved' && alert.resolvedAt && now - alert.resolvedAt > 86400000) {
        this.activeAlerts.delete(id);
      }
    }
    
    this.logger.debug('Abuse detector cleanup completed');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AbuseConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info({ config: this.config }, 'Abuse detector configuration updated');
  }

  /**
   * Destroy the abuse detector
   */
  destroy(): void {
    clearInterval(this.analysisInterval);
    clearInterval(this.cleanupInterval);
    this.removeAllListeners();
    
    this.logger.info('Abuse detector destroyed');
  }
}
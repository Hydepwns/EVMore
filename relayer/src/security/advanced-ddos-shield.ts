/**
 * Advanced DDoS Protection Shield
 * 
 * Comprehensive multi-layer protection against high-volume attacks:
 * - Layer 3/4: Network-level volumetric attack detection
 * - Layer 7: Application-level attack pattern recognition
 * - Adaptive defense: Real-time threshold adjustment
 * - Resource protection: System stress monitoring
 * - Intelligence: IP reputation and geoblocking
 */

import { Logger } from 'pino';
import { EventEmitter } from 'events';
import { DDoSProtectionSystem, DDoSConfig, RequestFingerprint, AttackPattern } from './ddos-protection';
import { IPReputationSystem, GeoBlockConfig, IPInfo } from './ip-reputation';
import { ResourceMonitor, ResourceThresholds, ResourceMetrics } from './resource-monitor';
import { FusionMetrics } from '../monitoring/metrics-collector';
import { AlertingSystem, AlertSeverity } from '../monitoring/alerting-system';
import { FusionConfigService } from '../config/fusion-config-service';

export interface DDoSShieldConfig {
  ddos: DDoSConfig;
  geoBlocking: GeoBlockConfig;
  resourceThresholds: Partial<ResourceThresholds>;
  enabled: boolean;
  emergencyMode: boolean;
  autoResponse: boolean;
}

export interface ThreatAssessment {
  ip: string;
  threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  factors: {
    volume: number;        // Request volume score (0-100)
    pattern: number;       // Pattern suspicion score (0-100) 
    reputation: number;    // IP reputation score (0-100)
    resource: number;      // Resource impact score (0-100)
    geographic: number;    // Geographic risk score (0-100)
  };
  recommendation: 'allow' | 'rate_limit' | 'delay' | 'block' | 'emergency_block';
  metadata: Record<string, any>;
}

export interface AttackMitigation {
  type: 'rate_limit' | 'delay' | 'block' | 'captcha' | 'emergency';
  duration: number;
  reason: string;
  confidence: number;
}

export class AdvancedDDoSShield extends EventEmitter {
  private logger: Logger;
  private config: DDoSShieldConfig;
  
  // Protection layers
  private ddosProtection: DDoSProtectionSystem;
  private ipReputation: IPReputationSystem;
  private resourceMonitor: ResourceMonitor;
  private metrics: FusionMetrics;
  private alerting: AlertingSystem;
  
  // State tracking
  private isEmergencyMode: boolean = false;
  private attackInProgress: boolean = false;
  private lastAttackTime: number = 0;
  private mitigationHistory: AttackMitigation[] = [];
  
  // Adaptive thresholds
  private baselineMetrics: ResourceMetrics | null = null;
  private currentDefenseLevel: number = 1; // 1-5 scale
  
  // Statistics
  private totalRequests: number = 0;
  private blockedRequests: number = 0;
  private threatAssessments: Map<string, ThreatAssessment> = new Map();

  constructor(config: DDoSShieldConfig, metrics: FusionMetrics, alerting: AlertingSystem, logger: Logger) {
    super();
    this.config = config;
    this.metrics = metrics;
    this.alerting = alerting;
    this.logger = logger.child({ component: 'DDoSShield' });
    
    // Initialize protection layers
    this.ddosProtection = new DDoSProtectionSystem(config.ddos, logger);
    this.ipReputation = new IPReputationSystem(config.geoBlocking, logger);
    this.resourceMonitor = new ResourceMonitor(config.resourceThresholds, logger);
    
    this.setupEventHandlers();
    this.setupAlertRules();
    
    // Establish baseline after 1 minute
    setTimeout(() => {
      this.establishBaseline();
    }, 60000);
    
    this.logger.info({ config }, 'Advanced DDoS Shield initialized');
  }

  /**
   * Main protection check - comprehensive threat assessment
   */
  async checkRequest(fingerprint: RequestFingerprint): Promise<{
    allowed: boolean;
    mitigation?: AttackMitigation;
    assessment?: ThreatAssessment;
    delay?: number;
  }> {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    this.totalRequests++;
    
    try {
      // 1. Perform comprehensive threat assessment
      const assessment = await this.assessThreat(fingerprint);
      
      // 2. Determine mitigation strategy
      const mitigation = this.determineMitigation(assessment);
      
      // 3. Apply mitigation
      if (mitigation.type !== 'rate_limit') {
        this.blockedRequests++;
        this.recordMitigation(mitigation);
        
        // Update metrics
        this.metrics.incrementCounter('fusion_ddos_blocked_total', 1, {
          type: mitigation.type,
          reason: mitigation.reason,
          ip: fingerprint.ip
        });
        
        return {
          allowed: false,
          mitigation,
          assessment,
          delay: mitigation.type === 'delay' ? mitigation.duration : undefined
        };
      }
      
      // 4. Store assessment for analysis
      this.threatAssessments.set(fingerprint.ip, assessment);
      
      return { allowed: true, assessment };
    } catch (error) {
      this.logger.error({ error, ip: fingerprint.ip }, 'Error in DDoS shield check');
      
      // Fail safely - allow request but increase defense level
      this.adjustDefenseLevel(1);
      return { allowed: true };
    }
  }

  /**
   * Comprehensive threat assessment using all protection layers
   */
  private async assessThreat(fingerprint: RequestFingerprint): Promise<ThreatAssessment> {
    const factors = {
      volume: 0,
      pattern: 0,
      reputation: 0,
      resource: 0,
      geographic: 0
    };
    
    let metadata: Record<string, any> = {};
    
    // 1. Volume-based assessment (DDoS protection)
    const ddosCheck = await this.ddosProtection.checkRequest(fingerprint);
    if (!ddosCheck.allowed) {
      factors.volume = ddosCheck.threatLevel === 'critical' ? 100 : 
                      ddosCheck.threatLevel === 'high' ? 80 : 60;
      metadata.ddosReason = ddosCheck.reason;
    }
    
    // 2. IP reputation assessment
    const repCheck = await this.ipReputation.checkIP(fingerprint.ip);
    if (!repCheck.allowed) {
      factors.reputation = 90;
      factors.geographic = repCheck.info?.isVPN ? 20 : repCheck.info?.isTor ? 40 : 0;
      metadata.reputation = repCheck.info?.reputation;
      metadata.country = repCheck.info?.country;
    } else if (repCheck.info) {
      factors.reputation = repCheck.info.threatScore;
      factors.geographic = (repCheck.info.isVPN ? 10 : 0) + 
                          (repCheck.info.isProxy ? 15 : 0) + 
                          (repCheck.info.isTor ? 30 : 0);
    }
    
    // 3. Resource impact assessment
    if (this.resourceMonitor.isUnderStress()) {
      factors.resource = 70;
      const performance = this.resourceMonitor.getPerformanceScore();
      factors.resource += (100 - performance) * 0.3;
      metadata.performanceScore = performance;
    }
    
    // 4. Pattern analysis (would include behavioral analysis)
    factors.pattern = this.analyzeRequestPattern(fingerprint);
    
    // 5. Calculate overall threat level
    const { threatLevel, confidence } = this.calculateThreatLevel(factors);
    
    // 6. Determine recommendation
    const recommendation = this.getRecommendation(threatLevel, factors);
    
    return {
      ip: fingerprint.ip,
      threatLevel,
      confidence,
      factors,
      recommendation,
      metadata
    };
  }

  /**
   * Analyze request patterns for suspicious behavior
   */
  private analyzeRequestPattern(fingerprint: RequestFingerprint): number {
    let score = 0;
    
    // Check recent requests from same IP
    const recentAssessments = Array.from(this.threatAssessments.values())
      .filter(a => a.ip === fingerprint.ip && Date.now() - (a.metadata.timestamp || 0) < 300000);
    
    if (recentAssessments.length > 10) {
      score += 30; // High request frequency
    }
    
    // Check for suspicious paths/methods
    if (fingerprint.path.includes('admin') || 
        fingerprint.path.includes('config') ||
        fingerprint.path.includes('..')) {
      score += 40;
    }
    
    // Check for unusual request characteristics
    if (!fingerprint.userAgent || fingerprint.userAgent.length < 10) {
      score += 20;
    }
    
    if (fingerprint.bodySize > 1000000) { // >1MB
      score += 25;
    }
    
    // Check timing patterns
    if (recentAssessments.length > 2) {
      const timings = recentAssessments.map(a => a.metadata.timestamp).sort();
      const intervals = [];
      
      for (let i = 1; i < timings.length; i++) {
        intervals.push(timings[i] - timings[i-1]);
      }
      
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval < 1000) { // <1 second average
        score += 30;
      }
    }
    
    return Math.min(100, score);
  }

  /**
   * Calculate overall threat level from factors
   */
  private calculateThreatLevel(factors: ThreatAssessment['factors']): {
    threatLevel: ThreatAssessment['threatLevel'];
    confidence: number;
  } {
    // Weighted scoring
    const weights = {
      volume: 0.3,
      pattern: 0.25,
      reputation: 0.2,
      resource: 0.15,
      geographic: 0.1
    };
    
    const score = (factors.volume * weights.volume) +
                  (factors.pattern * weights.pattern) +
                  (factors.reputation * weights.reputation) +
                  (factors.resource * weights.resource) +
                  (factors.geographic * weights.geographic);
    
    // Adjust score based on current defense level
    const adjustedScore = score * (this.currentDefenseLevel / 3);
    
    // Calculate confidence based on how many factors contribute
    const activeFactors = Object.values(factors).filter(f => f > 0).length;
    const confidence = Math.min(1, activeFactors / 3);
    
    let threatLevel: ThreatAssessment['threatLevel'];
    if (adjustedScore >= 80) threatLevel = 'critical';
    else if (adjustedScore >= 60) threatLevel = 'high';
    else if (adjustedScore >= 40) threatLevel = 'medium';
    else if (adjustedScore >= 20) threatLevel = 'low';
    else threatLevel = 'none';
    
    return { threatLevel, confidence };
  }

  /**
   * Get recommendation based on threat assessment
   */
  private getRecommendation(
    threatLevel: ThreatAssessment['threatLevel'],
    factors: ThreatAssessment['factors']
  ): ThreatAssessment['recommendation'] {
    if (this.isEmergencyMode || threatLevel === 'critical') {
      return 'emergency_block';
    }
    
    if (threatLevel === 'high') {
      return factors.volume > 70 ? 'block' : 'delay';
    }
    
    if (threatLevel === 'medium') {
      return factors.pattern > 60 ? 'delay' : 'rate_limit';
    }
    
    return 'allow';
  }

  /**
   * Determine mitigation strategy
   */
  private determineMitigation(assessment: ThreatAssessment): AttackMitigation {
    switch (assessment.recommendation) {
      case 'emergency_block':
        return {
          type: 'emergency',
          duration: 3600000, // 1 hour default
          reason: 'Emergency block due to critical threat',
          confidence: assessment.confidence
        };
        
      case 'block':
        return {
          type: 'block',
          duration: 1800000, // 30 minutes
          reason: `High threat level: ${assessment.threatLevel}`,
          confidence: assessment.confidence
        };
        
      case 'delay':
        const delayMs = Math.min(10000, assessment.factors.pattern * 100);
        return {
          type: 'delay',
          duration: delayMs,
          reason: `Suspicious patterns detected`,
          confidence: assessment.confidence
        };
        
      case 'rate_limit':
        return {
          type: 'rate_limit',
          duration: 300000, // 5 minutes
          reason: 'Rate limiting due to medium threat',
          confidence: assessment.confidence
        };
        
      default:
        return {
          type: 'rate_limit',
          duration: 0,
          reason: 'Allowed',
          confidence: assessment.confidence
        };
    }
  }

  /**
   * Record mitigation for analysis
   */
  private recordMitigation(mitigation: AttackMitigation): void {
    this.mitigationHistory.push({
      ...mitigation,
      duration: Date.now() // Store timestamp instead of duration for history
    });
    
    // Keep only recent history
    if (this.mitigationHistory.length > 1000) {
      this.mitigationHistory = this.mitigationHistory.slice(-500);
    }
    
    this.logger.info({ mitigation }, 'Attack mitigation applied');
    this.emit('mitigationApplied', mitigation);
  }

  /**
   * Setup event handlers for adaptive response
   */
  private setupEventHandlers(): void {
    // DDoS protection events
    this.ddosProtection.on('attackDetected', (attack: AttackPattern) => {
      this.handleAttackDetected(attack);
    });
    
    // Resource monitor events
    this.resourceMonitor.on('resourceAlert', (alert) => {
      this.handleResourceAlert(alert);
    });
    
    // IP reputation events
    this.ipReputation.on('threatIPAdded', (event) => {
      this.logger.warn({ event }, 'New threat IP detected');
    });
  }

  /**
   * Handle detected attacks
   */
  private handleAttackDetected(attack: AttackPattern): void {
    this.attackInProgress = true;
    this.lastAttackTime = Date.now();
    
    // Increase defense level based on attack severity
    const levelIncrease = attack.severity === 'critical' ? 3 :
                         attack.severity === 'high' ? 2 : 1;
    this.adjustDefenseLevel(levelIncrease);
    
    // Auto-response if enabled
    if (this.config.autoResponse) {
      if (attack.severity === 'critical') {
        this.activateEmergencyMode('Critical attack detected');
      }
      
      // Add attacking IPs to reputation system
      attack.sourceIPs.forEach(ip => {
        this.ipReputation.addThreatIP(ip, `${attack.type} attack`);
      });
    }
    
    // Update metrics
    this.metrics.incrementCounter('fusion_ddos_attacks_total', 1, {
      type: attack.type,
      severity: attack.severity
    });
    
    // Fire alert
    this.alerting.fireAlert(
      'ddos_attack',
      attack.severity === 'critical' ? AlertSeverity.CRITICAL : AlertSeverity.ERROR,
      `${attack.type} attack detected from ${attack.sourceIPs.length} IPs`,
      { attack }
    );
    
    this.emit('attackDetected', attack);
  }

  /**
   * Handle resource alerts
   */
  private handleResourceAlert(alert: any): void {
    if (alert.level === 'critical') {
      this.adjustDefenseLevel(2);
      
      if (this.config.autoResponse) {
        this.activateEmergencyMode(`Critical resource usage: ${alert.message}`);
      }
    } else if (alert.level === 'warning') {
      this.adjustDefenseLevel(1);
    }
  }

  /**
   * Adjust defense level dynamically
   */
  private adjustDefenseLevel(change: number): void {
    const oldLevel = this.currentDefenseLevel;
    this.currentDefenseLevel = Math.max(1, Math.min(5, this.currentDefenseLevel + change));
    
    if (this.currentDefenseLevel !== oldLevel) {
      this.logger.info({ 
        oldLevel, 
        newLevel: this.currentDefenseLevel 
      }, 'Defense level adjusted');
      
      this.metrics.setGauge('fusion_ddos_defense_level', this.currentDefenseLevel);
      this.emit('defenseLevelChanged', { oldLevel, newLevel: this.currentDefenseLevel });
    }
    
    // Gradually reduce defense level over time
    setTimeout(() => {
      if (this.currentDefenseLevel > 1 && !this.attackInProgress) {
        this.adjustDefenseLevel(-1);
      }
    }, 300000); // 5 minutes
  }

  /**
   * Activate emergency mode
   */
  activateEmergencyMode(reason: string): void {
    if (this.isEmergencyMode) return;
    
    this.isEmergencyMode = true;
    this.currentDefenseLevel = 5;
    
    this.logger.error({ reason }, 'EMERGENCY MODE ACTIVATED');
    
    // Trigger emergency lockdown in all protection layers
    this.ddosProtection.emergencyLockdown();
    
    // Update metrics
    this.metrics.setGauge('fusion_ddos_emergency_mode', 1);
    
    // Fire critical alert
    this.alerting.fireAlert(
      'ddos_emergency',
      AlertSeverity.CRITICAL,
      `DDoS emergency mode activated: ${reason}`
    );
    
    // Auto-deactivate after 1 hour
    setTimeout(() => {
      this.deactivateEmergencyMode();
    }, 3600000); // 1 hour default
    
    this.emit('emergencyModeActivated', { reason });
  }

  /**
   * Deactivate emergency mode
   */
  deactivateEmergencyMode(): void {
    if (!this.isEmergencyMode) return;
    
    this.isEmergencyMode = false;
    this.currentDefenseLevel = 2; // Elevated but not emergency
    
    this.logger.info('Emergency mode deactivated');
    
    // Update metrics
    this.metrics.setGauge('fusion_ddos_emergency_mode', 0);
    
    this.emit('emergencyModeDeactivated');
  }

  /**
   * Establish performance baseline
   */
  private establishBaseline(): void {
    this.baselineMetrics = this.resourceMonitor.getCurrentMetrics();
    if (this.baselineMetrics) {
      this.logger.info('Performance baseline established');
    }
  }

  /**
   * Setup alert rules
   */
  private setupAlertRules(): void {
    // High block rate alert
    this.alerting.addRule({
      name: 'high_ddos_block_rate',
      condition: async () => {
        const blockRate = this.totalRequests > 0 ? 
          (this.blockedRequests / this.totalRequests) * 100 : 0;
        return blockRate > 20; // >20% block rate
      },
      severity: AlertSeverity.WARNING,
      message: 'High DDoS block rate detected',
      cooldownMs: 300000,
      autoResolve: true
    });
  }

  /**
   * Get comprehensive shield status
   */
  getShieldStatus(): {
    enabled: boolean;
    emergencyMode: boolean;
    defenseLevel: number;
    attackInProgress: boolean;
    totalRequests: number;
    blockedRequests: number;
    blockRate: number;
    threatAssessments: number;
    lastAttack?: number;
    layers: {
      ddos: any;
      reputation: any;
      resources: any;
    };
  } {
    const blockRate = this.totalRequests > 0 ? 
      (this.blockedRequests / this.totalRequests) * 100 : 0;
    
    return {
      enabled: this.config.enabled,
      emergencyMode: this.isEmergencyMode,
      defenseLevel: this.currentDefenseLevel,
      attackInProgress: this.attackInProgress,
      totalRequests: this.totalRequests,
      blockedRequests: this.blockedRequests,
      blockRate: Math.round(blockRate * 100) / 100,
      threatAssessments: this.threatAssessments.size,
      lastAttack: this.lastAttackTime || undefined,
      layers: {
        ddos: this.ddosProtection.getStats(),
        reputation: this.ipReputation.getStats(),
        resources: this.resourceMonitor.getStats()
      }
    };
  }

  /**
   * Manual shield control
   */
  setShieldEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.logger.info({ enabled }, 'DDoS shield enabled state changed');
    
    this.metrics.setGauge('fusion_ddos_shield_enabled', enabled ? 1 : 0);
  }

  /**
   * Reset shield statistics
   */
  resetStats(): void {
    this.totalRequests = 0;
    this.blockedRequests = 0;
    this.threatAssessments.clear();
    this.mitigationHistory = [];
    this.attackInProgress = false;
    
    this.logger.info('DDoS shield statistics reset');
  }

  /**
   * Destroy the shield
   */
  destroy(): void {
    this.ddosProtection.destroy();
    this.ipReputation.destroy();
    this.resourceMonitor.destroy();
    this.removeAllListeners();
    
    this.logger.info('DDoS shield destroyed');
  }
}
import { Logger } from 'pino';
import { EventEmitter } from 'events';

export interface AttackPattern {
  type: 'volumetric' | 'protocol' | 'application';
  severity: 'low' | 'medium' | 'high' | 'critical';
  indicators: string[];
  confidence: number; // 0-1
  timestamp: number;
  sourceIPs: string[];
  requestCount: number;
  duration: number;
}

export interface DDoSConfig {
  // Adaptive rate limiting
  baseRateLimit: number;
  maxRateLimit: number;
  rateMultiplier: number;
  adaptationSpeed: number;
  
  // Attack detection thresholds
  volumeThreshold: number;
  burstThreshold: number;
  patternThreshold: number;
  
  // Response levels
  warningLevel: number;
  blockLevel: number;
  emergencyLevel: number;
  
  // Temporal settings
  analysisWindow: number;
  blacklistDuration: number;
  adaptationWindow: number;
}

export interface RequestFingerprint {
  ip: string;
  userAgent?: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  bodySize: number;
  timestamp: number;
}

export interface TrafficAnalysis {
  totalRequests: number;
  uniqueIPs: number;
  requestsPerSecond: number;
  averageResponseTime: number;
  errorRate: number;
  topIPs: Array<{ ip: string; requests: number; percentage: number }>;
  topPaths: Array<{ path: string; requests: number; percentage: number }>;
  patternScore: number;
  threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

export class DDoSProtectionSystem extends EventEmitter {
  private config: DDoSConfig;
  private logger: Logger;
  
  // Request tracking
  private requestHistory: RequestFingerprint[] = [];
  private ipRequestCounts: Map<string, number[]> = new Map();
  private pathRequestCounts: Map<string, number[]> = new Map();
  private blacklistedIPs: Map<string, number> = new Map(); // IP -> expiry time
  
  // Adaptive rate limiting
  private currentRateLimit: Map<string, number> = new Map();
  private rateHistory: Array<{ timestamp: number; rate: number }> = [];
  
  // Attack detection
  private detectedAttacks: AttackPattern[] = [];
  private suspiciousActivity: Map<string, number> = new Map();
  
  // Resource monitoring
  private cpuUsage: number[] = [];
  private memoryUsage: number[] = [];
  private connectionCount: number[] = [];
  
  private analysisInterval: NodeJS.Timeout;
  private cleanupInterval: NodeJS.Timeout;

  constructor(config: DDoSConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'DDoSProtection' });
    
    // Start background analysis
    this.analysisInterval = setInterval(() => {
      this.analyzeTraffic();
    }, 1000); // Analyze every second
    
    // Cleanup old data every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
    
    this.logger.info({ config }, 'DDoS protection system initialized');
  }

  /**
   * Check if request should be allowed (main entry point)
   */
  async checkRequest(fingerprint: RequestFingerprint): Promise<{
    allowed: boolean;
    reason?: string;
    rateLimit?: number;
    retryAfter?: number;
    threatLevel?: string;
  }> {
    const now = Date.now();
    
    // 1. Check blacklist
    const blacklistExpiry = this.blacklistedIPs.get(fingerprint.ip);
    if (blacklistExpiry && now < blacklistExpiry) {
      return {
        allowed: false,
        reason: 'IP blacklisted due to attack behavior',
        retryAfter: blacklistExpiry - now
      };
    }
    
    // 2. Real-time attack detection
    const attackDetected = await this.detectRealTimeAttack(fingerprint);
    if (attackDetected) {
      this.blacklistIP(fingerprint.ip, 'Real-time attack detected');
      return {
        allowed: false,
        reason: 'Attack pattern detected',
        threatLevel: 'high'
      };
    }
    
    // 3. Adaptive rate limiting
    const rateCheck = this.checkAdaptiveRateLimit(fingerprint);
    if (!rateCheck.allowed) {
      return rateCheck;
    }
    
    // 4. Record request for analysis
    this.recordRequest(fingerprint);
    
    return { allowed: true, rateLimit: rateCheck.rateLimit };
  }

  /**
   * Real-time attack detection using multiple heuristics
   */
  private async detectRealTimeAttack(fingerprint: RequestFingerprint): Promise<boolean> {
    const now = Date.now();
    const window = 10000; // 10 second window
    const recentRequests = this.requestHistory.filter(r => 
      now - r.timestamp < window && r.ip === fingerprint.ip
    );
    
    // Volumetric attack detection
    if (recentRequests.length > this.config.burstThreshold) {
      this.recordAttack({
        type: 'volumetric',
        severity: 'high',
        indicators: ['high_request_volume'],
        confidence: 0.9,
        timestamp: now,
        sourceIPs: [fingerprint.ip],
        requestCount: recentRequests.length,
        duration: window
      });
      return true;
    }
    
    // Pattern-based detection
    const patterns = this.analyzeRequestPatterns(recentRequests);
    if (patterns.suspiciousScore > 0.8) {
      this.recordAttack({
        type: 'application',
        severity: 'medium',
        indicators: patterns.indicators,
        confidence: patterns.suspiciousScore,
        timestamp: now,
        sourceIPs: [fingerprint.ip],
        requestCount: recentRequests.length,
        duration: window
      });
      return true;
    }
    
    // Protocol anomaly detection
    if (this.detectProtocolAnomalies(fingerprint)) {
      this.recordAttack({
        type: 'protocol',
        severity: 'medium',
        indicators: ['protocol_anomaly'],
        confidence: 0.7,
        timestamp: now,
        sourceIPs: [fingerprint.ip],
        requestCount: 1,
        duration: 0
      });
      return true;
    }
    
    return false;
  }

  /**
   * Adaptive rate limiting that adjusts based on attack patterns
   */
  private checkAdaptiveRateLimit(fingerprint: RequestFingerprint): {
    allowed: boolean;
    reason?: string;
    rateLimit?: number;
    retryAfter?: number;
  } {
    const now = Date.now();
    const window = 60000; // 1 minute window
    
    // Get current rate limit for this IP
    let rateLimit = this.currentRateLimit.get(fingerprint.ip) || this.config.baseRateLimit;
    
    // Adjust rate limit based on global threat level
    const threatLevel = this.getCurrentThreatLevel();
    rateLimit = this.adjustRateForThreat(rateLimit, threatLevel);
    
    // Check if IP exceeds rate limit
    const ipRequests = this.ipRequestCounts.get(fingerprint.ip) || [];
    const recentRequests = ipRequests.filter(timestamp => now - timestamp < window);
    
    if (recentRequests.length >= rateLimit) {
      // Increase suspicion for this IP
      const suspicion = this.suspiciousActivity.get(fingerprint.ip) || 0;
      this.suspiciousActivity.set(fingerprint.ip, suspicion + 1);
      
      // Reduce rate limit for repeat offenders
      const newRateLimit = Math.max(1, Math.floor(rateLimit * 0.5));
      this.currentRateLimit.set(fingerprint.ip, newRateLimit);
      
      return {
        allowed: false,
        reason: 'Rate limit exceeded',
        rateLimit: newRateLimit,
        retryAfter: window - (now - Math.min(...recentRequests))
      };
    }
    
    return { allowed: true, rateLimit };
  }

  /**
   * Analyze request patterns for suspicious behavior
   */
  private analyzeRequestPatterns(requests: RequestFingerprint[]): {
    suspiciousScore: number;
    indicators: string[];
  } {
    const indicators: string[] = [];
    let score = 0;
    
    if (requests.length === 0) return { suspiciousScore: 0, indicators: [] };
    
    // Check for identical requests (potential bot behavior)
    const uniquePaths = new Set(requests.map(r => r.path)).size;
    if (uniquePaths === 1 && requests.length > 5) {
      score += 0.3;
      indicators.push('identical_requests');
    }
    
    // Check for missing or suspicious user agents
    const userAgents = requests.map(r => r.userAgent).filter(Boolean);
    if (userAgents.length < requests.length * 0.5) {
      score += 0.2;
      indicators.push('missing_user_agent');
    }
    
    // Check for rapid-fire requests (too regular timing)
    const timings = requests.map(r => r.timestamp).sort();
    if (timings.length > 3) {
      const intervals = [];
      for (let i = 1; i < timings.length; i++) {
        intervals.push(timings[i] - timings[i-1]);
      }
      
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sum, interval) => 
        sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
      
      // Very regular timing suggests bot behavior
      if (variance < 100 && avgInterval < 1000) {
        score += 0.4;
        indicators.push('regular_timing');
      }
    }
    
    // Check for abnormal request sizes
    const avgBodySize = requests.reduce((sum, r) => sum + r.bodySize, 0) / requests.length;
    if (avgBodySize > 100000) { // >100KB average
      score += 0.2;
      indicators.push('large_requests');
    }
    
    // Check for suspicious paths
    const suspiciousPaths = requests.filter(r => 
      r.path.includes('..') || 
      r.path.includes('<script>') ||
      r.path.includes('admin') ||
      r.path.includes('config')
    );
    if (suspiciousPaths.length > 0) {
      score += 0.5;
      indicators.push('suspicious_paths');
    }
    
    return { suspiciousScore: Math.min(1, score), indicators };
  }

  /**
   * Detect protocol-level anomalies
   */
  private detectProtocolAnomalies(fingerprint: RequestFingerprint): boolean {
    // Check for malformed headers
    const suspiciousHeaders = [
      'x-forwarded-for',
      'x-real-ip',
      'x-originating-ip'
    ].filter(header => 
      fingerprint.headers[header] && 
      fingerprint.headers[header].split(',').length > 10
    );
    
    if (suspiciousHeaders.length > 0) return true;
    
    // Check for abnormal header patterns
    const headerCount = Object.keys(fingerprint.headers).length;
    if (headerCount > 50 || headerCount < 3) return true;
    
    // Check for suspicious user agents
    const userAgent = fingerprint.userAgent?.toLowerCase() || '';
    const botIndicators = ['bot', 'crawler', 'spider', 'scraper', 'scanner'];
    if (botIndicators.some(indicator => userAgent.includes(indicator))) {
      return true;
    }
    
    return false;
  }

  /**
   * Record a request for analysis
   */
  private recordRequest(fingerprint: RequestFingerprint): void {
    this.requestHistory.push(fingerprint);
    
    // Update IP request counts
    const ipCounts = this.ipRequestCounts.get(fingerprint.ip) || [];
    ipCounts.push(fingerprint.timestamp);
    this.ipRequestCounts.set(fingerprint.ip, ipCounts);
    
    // Update path request counts
    const pathCounts = this.pathRequestCounts.get(fingerprint.path) || [];
    pathCounts.push(fingerprint.timestamp);
    this.pathRequestCounts.set(fingerprint.path, pathCounts);
  }

  /**
   * Blacklist an IP address
   */
  private blacklistIP(ip: string, reason: string): void {
    const expiry = Date.now() + this.config.blacklistDuration;
    this.blacklistedIPs.set(ip, expiry);
    
    this.logger.warn({ ip, reason, expiry }, 'IP blacklisted');
    this.emit('ipBlacklisted', { ip, reason, expiry });
  }

  /**
   * Record detected attack
   */
  private recordAttack(attack: AttackPattern): void {
    this.detectedAttacks.push(attack);
    
    this.logger.error({ 
      attack: attack.type,
      severity: attack.severity,
      confidence: attack.confidence,
      sourceIPs: attack.sourceIPs,
      indicators: attack.indicators
    }, 'Attack detected');
    
    this.emit('attackDetected', attack);
    
    // Auto-blacklist IPs involved in high-confidence attacks
    if (attack.confidence > 0.8) {
      attack.sourceIPs.forEach(ip => {
        this.blacklistIP(ip, `${attack.type} attack`);
      });
    }
  }

  /**
   * Analyze traffic patterns and adjust defenses
   */
  private analyzeTraffic(): void {
    const now = Date.now();
    const window = this.config.analysisWindow;
    const recentRequests = this.requestHistory.filter(r => now - r.timestamp < window);
    
    if (recentRequests.length === 0) return;
    
    const analysis: TrafficAnalysis = {
      totalRequests: recentRequests.length,
      uniqueIPs: new Set(recentRequests.map(r => r.ip)).size,
      requestsPerSecond: recentRequests.length / (window / 1000),
      averageResponseTime: 0, // Would be calculated from response times
      errorRate: 0, // Would be calculated from error responses
      topIPs: this.getTopIPs(recentRequests),
      topPaths: this.getTopPaths(recentRequests),
      patternScore: this.calculateGlobalPatternScore(recentRequests),
      threatLevel: this.getCurrentThreatLevel()
    };
    
    // Adjust defenses based on analysis
    this.adjustDefenses(analysis);
    
    this.emit('trafficAnalysis', analysis);
  }

  /**
   * Get current global threat level
   */
  private getCurrentThreatLevel(): TrafficAnalysis['threatLevel'] {
    const now = Date.now();
    const recentAttacks = this.detectedAttacks.filter(a => now - a.timestamp < 300000); // 5 minutes
    
    if (recentAttacks.some(a => a.severity === 'critical')) return 'critical';
    if (recentAttacks.some(a => a.severity === 'high')) return 'high';
    if (recentAttacks.some(a => a.severity === 'medium')) return 'medium';
    if (recentAttacks.length > 0) return 'low';
    
    return 'none';
  }

  /**
   * Adjust rate limits based on threat level
   */
  private adjustRateForThreat(baseRate: number, threatLevel: TrafficAnalysis['threatLevel']): number {
    switch (threatLevel) {
      case 'critical': return Math.floor(baseRate * 0.1);
      case 'high': return Math.floor(baseRate * 0.25);
      case 'medium': return Math.floor(baseRate * 0.5);
      case 'low': return Math.floor(baseRate * 0.75);
      default: return baseRate;
    }
  }

  /**
   * Adjust defenses based on traffic analysis
   */
  private adjustDefenses(analysis: TrafficAnalysis): void {
    // Implement adaptive defense adjustments
    if (analysis.requestsPerSecond > this.config.volumeThreshold) {
      // Reduce rate limits globally
      for (const [ip, rate] of this.currentRateLimit.entries()) {
        this.currentRateLimit.set(ip, Math.max(1, Math.floor(rate * 0.8)));
      }
    }
    
    // Auto-blacklist top offending IPs during high threat
    if (analysis.threatLevel === 'high' || analysis.threatLevel === 'critical') {
      analysis.topIPs.slice(0, 3).forEach(({ ip, percentage }) => {
        if (percentage > 20) { // If IP represents >20% of traffic
          this.blacklistIP(ip, 'High traffic percentage during attack');
        }
      });
    }
  }

  /**
   * Get top IPs by request count
   */
  private getTopIPs(requests: RequestFingerprint[]): Array<{ ip: string; requests: number; percentage: number }> {
    const ipCounts = new Map<string, number>();
    
    requests.forEach(r => {
      ipCounts.set(r.ip, (ipCounts.get(r.ip) || 0) + 1);
    });
    
    return Array.from(ipCounts.entries())
      .map(([ip, count]) => ({ 
        ip, 
        requests: count, 
        percentage: (count / requests.length) * 100 
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 10);
  }

  /**
   * Get top paths by request count
   */
  private getTopPaths(requests: RequestFingerprint[]): Array<{ path: string; requests: number; percentage: number }> {
    const pathCounts = new Map<string, number>();
    
    requests.forEach(r => {
      pathCounts.set(r.path, (pathCounts.get(r.path) || 0) + 1);
    });
    
    return Array.from(pathCounts.entries())
      .map(([path, count]) => ({ 
        path, 
        requests: count, 
        percentage: (count / requests.length) * 100 
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 10);
  }

  /**
   * Calculate global pattern suspicion score
   */
  private calculateGlobalPatternScore(requests: RequestFingerprint[]): number {
    if (requests.length === 0) return 0;
    
    let score = 0;
    
    // High concentration from few IPs
    const uniqueIPs = new Set(requests.map(r => r.ip)).size;
    if (uniqueIPs < requests.length * 0.1) score += 0.3;
    
    // High concentration on few paths
    const uniquePaths = new Set(requests.map(r => r.path)).size;
    if (uniquePaths < 5 && requests.length > 100) score += 0.2;
    
    // Unusual timing patterns
    const timeSpread = Math.max(...requests.map(r => r.timestamp)) - 
                      Math.min(...requests.map(r => r.timestamp));
    if (timeSpread < 10000 && requests.length > 50) score += 0.3;
    
    return Math.min(1, score);
  }

  /**
   * Clean up old data
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = this.config.analysisWindow * 2;
    
    // Clean request history
    this.requestHistory = this.requestHistory.filter(r => now - r.timestamp < maxAge);
    
    // Clean IP request counts
    for (const [ip, timestamps] of this.ipRequestCounts.entries()) {
      const filtered = timestamps.filter(t => now - t < maxAge);
      if (filtered.length === 0) {
        this.ipRequestCounts.delete(ip);
      } else {
        this.ipRequestCounts.set(ip, filtered);
      }
    }
    
    // Clean expired blacklisted IPs
    for (const [ip, expiry] of this.blacklistedIPs.entries()) {
      if (now >= expiry) {
        this.blacklistedIPs.delete(ip);
        this.logger.info({ ip }, 'IP removed from blacklist');
      }
    }
    
    // Clean old attacks
    this.detectedAttacks = this.detectedAttacks.filter(a => now - a.timestamp < 3600000); // 1 hour
    
    // Clean suspicious activity scores
    this.suspiciousActivity.clear(); // Reset hourly
  }

  /**
   * Get comprehensive DDoS protection stats
   */
  getStats(): {
    blacklistedIPs: number;
    detectedAttacks: number;
    currentThreatLevel: string;
    requestsLastMinute: number;
    uniqueIPsLastMinute: number;
    adaptiveRateLimits: number;
    topThreats: Array<{ ip: string; score: number }>;
  } {
    const now = Date.now();
    const lastMinute = this.requestHistory.filter(r => now - r.timestamp < 60000);
    
    return {
      blacklistedIPs: this.blacklistedIPs.size,
      detectedAttacks: this.detectedAttacks.length,
      currentThreatLevel: this.getCurrentThreatLevel(),
      requestsLastMinute: lastMinute.length,
      uniqueIPsLastMinute: new Set(lastMinute.map(r => r.ip)).size,
      adaptiveRateLimits: this.currentRateLimit.size,
      topThreats: Array.from(this.suspiciousActivity.entries())
        .map(([ip, score]) => ({ ip, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
    };
  }

  /**
   * Manual emergency response
   */
  emergencyLockdown(): void {
    this.logger.error('EMERGENCY LOCKDOWN ACTIVATED');
    
    // Drastically reduce all rate limits
    for (const [ip] of this.currentRateLimit.entries()) {
      this.currentRateLimit.set(ip, 1);
    }
    
    // Blacklist all suspicious IPs
    for (const [ip, score] of this.suspiciousActivity.entries()) {
      if (score > 1) {
        this.blacklistIP(ip, 'Emergency lockdown');
      }
    }
    
    this.emit('emergencyLockdown');
  }

  /**
   * Destroy the DDoS protection system
   */
  destroy(): void {
    clearInterval(this.analysisInterval);
    clearInterval(this.cleanupInterval);
    this.removeAllListeners();
  }
}
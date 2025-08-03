import { Logger } from 'pino';
import { RateLimiter, HTLCRateLimiter, SwapRateLimiter, APIRateLimiter } from '../middleware/rate-limiter';

export interface SecurityConfig {
  enableRateLimit: boolean;
  enableIPBlocking: boolean;
  enableSuspiciousActivityDetection: boolean;
  maxFailedAttempts: number;
  blockDurationMs: number;
  suspiciousThreshold: number;
}

export interface SecurityEvent {
  type: 'rate_limit' | 'suspicious_activity' | 'blocked_ip' | 'failed_attempt';
  address?: string;
  ip?: string;
  timestamp: number;
  details: any;
}

export class SecurityManager {
  private config: SecurityConfig;
  private logger: Logger;
  
  // Rate limiters
  private htlcRateLimiter: HTLCRateLimiter;
  private swapRateLimiter: SwapRateLimiter;
  private apiRateLimiter: APIRateLimiter;
  
  // Security tracking
  private blockedIPs: Set<string> = new Set();
  private failedAttempts: Map<string, { count: number; firstAttempt: number }> = new Map();
  private suspiciousActivity: Map<string, SecurityEvent[]> = new Map();
  
  // Event handlers
  private eventHandlers: Map<string, (event: SecurityEvent) => void> = new Map();

  constructor(config: SecurityConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'SecurityManager' });
    
    // Initialize rate limiters
    this.htlcRateLimiter = new HTLCRateLimiter(logger);
    this.swapRateLimiter = new SwapRateLimiter(logger);
    this.apiRateLimiter = new APIRateLimiter(logger);
    
    this.logger.info({ config }, 'Security manager initialized');
  }

  /**
   * Check if an HTLC operation should be allowed
   */
  async checkHTLCOperation(request: { sender: string; ip?: string; amount?: string }): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfter?: number;
  }> {
    // Check IP blocking
    if (this.config.enableIPBlocking && request.ip && this.blockedIPs.has(request.ip)) {
      return { allowed: false, reason: 'IP blocked due to suspicious activity' };
    }

    // Check rate limiting
    if (this.config.enableRateLimit) {
      const { limited, resetTime } = await this.htlcRateLimiter.isLimited(request);
      if (limited) {
        this.recordSecurityEvent({
          type: 'rate_limit',
          address: request.sender,
          ip: request.ip,
          timestamp: Date.now(),
          details: { operation: 'htlc', resetTime }
        });
        
        return { 
          allowed: false, 
          reason: 'Rate limit exceeded for HTLC operations',
          retryAfter: resetTime ? resetTime - Date.now() : undefined
        };
      }
    }

    // Check for suspicious activity patterns
    if (this.config.enableSuspiciousActivityDetection) {
      const suspicious = await this.detectSuspiciousActivity(request);
      if (suspicious) {
        return { allowed: false, reason: 'Suspicious activity detected' };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if a swap operation should be allowed
   */
  async checkSwapOperation(request: { sender: string; ip?: string; tokenIn?: string; tokenOut?: string; amount?: string }): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfter?: number;
  }> {
    // Check IP blocking
    if (this.config.enableIPBlocking && request.ip && this.blockedIPs.has(request.ip)) {
      return { allowed: false, reason: 'IP blocked due to suspicious activity' };
    }

    // Check rate limiting
    if (this.config.enableRateLimit) {
      const { limited, resetTime } = await this.swapRateLimiter.isLimited(request);
      if (limited) {
        this.recordSecurityEvent({
          type: 'rate_limit',
          address: request.sender,
          ip: request.ip,
          timestamp: Date.now(),
          details: { operation: 'swap', resetTime }
        });
        
        return { 
          allowed: false, 
          reason: 'Rate limit exceeded for swap operations',
          retryAfter: resetTime ? resetTime - Date.now() : undefined
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if an API request should be allowed
   */
  async checkAPIRequest(request: { ip: string; endpoint?: string; userAgent?: string }): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfter?: number;
  }> {
    // Check IP blocking
    if (this.config.enableIPBlocking && this.blockedIPs.has(request.ip)) {
      return { allowed: false, reason: 'IP blocked due to suspicious activity' };
    }

    // Check rate limiting
    if (this.config.enableRateLimit) {
      const { limited, resetTime } = await this.apiRateLimiter.isLimited(request);
      if (limited) {
        this.recordSecurityEvent({
          type: 'rate_limit',
          ip: request.ip,
          timestamp: Date.now(),
          details: { operation: 'api', endpoint: request.endpoint, resetTime }
        });
        
        return { 
          allowed: false, 
          reason: 'Rate limit exceeded for API requests',
          retryAfter: resetTime ? resetTime - Date.now() : undefined
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a failed operation attempt
   */
  recordFailedAttempt(identifier: string, details: any): void {
    const now = Date.now();
    const existing = this.failedAttempts.get(identifier);
    
    if (!existing) {
      this.failedAttempts.set(identifier, { count: 1, firstAttempt: now });
    } else {
      existing.count++;
      
      // Check if we should block this identifier
      if (existing.count >= this.config.maxFailedAttempts) {
        if (details.ip) {
          this.blockIP(details.ip, 'Too many failed attempts');
        }
        
        this.recordSecurityEvent({
          type: 'blocked_ip',
          ip: details.ip,
          timestamp: now,
          details: { reason: 'max_failed_attempts', count: existing.count }
        });
      }
    }

    this.recordSecurityEvent({
      type: 'failed_attempt',
      address: details.address,
      ip: details.ip,
      timestamp: now,
      details
    });
  }

  /**
   * Block an IP address
   */
  blockIP(ip: string, reason: string): void {
    this.blockedIPs.add(ip);
    this.logger.warn({ ip, reason }, 'IP address blocked');
    
    // Auto-unblock after configured duration
    setTimeout(() => {
      this.unblockIP(ip);
    }, this.config.blockDurationMs);
  }

  /**
   * Unblock an IP address
   */
  unblockIP(ip: string): void {
    this.blockedIPs.delete(ip);
    this.logger.info({ ip }, 'IP address unblocked');
  }

  /**
   * Detect suspicious activity patterns
   */
  private async detectSuspiciousActivity(request: any): Promise<boolean> {
    const identifier = request.ip || request.sender;
    if (!identifier) return false;

    const events = this.suspiciousActivity.get(identifier) || [];
    const now = Date.now();
    const recentEvents = events.filter(e => now - e.timestamp < 300000); // Last 5 minutes

    // Pattern detection
    if (recentEvents.length >= this.config.suspiciousThreshold) {
      this.logger.warn({ identifier, eventCount: recentEvents.length }, 'Suspicious activity detected');
      
      if (request.ip) {
        this.blockIP(request.ip, 'Suspicious activity pattern');
      }
      
      return true;
    }

    return false;
  }

  /**
   * Record a security event
   */
  private recordSecurityEvent(event: SecurityEvent): void {
    const identifier = event.ip || event.address;
    if (!identifier) return;

    let events = this.suspiciousActivity.get(identifier) || [];
    events.push(event);

    // Keep only recent events (last hour)
    const oneHourAgo = Date.now() - 3600000;
    events = events.filter(e => e.timestamp > oneHourAgo);
    
    this.suspiciousActivity.set(identifier, events);

    // Emit event to handlers
    this.eventHandlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        this.logger.error({ error }, 'Error in security event handler');
      }
    });

    this.logger.info({ event }, 'Security event recorded');
  }

  /**
   * Subscribe to security events
   */
  onSecurityEvent(name: string, handler: (event: SecurityEvent) => void): void {
    this.eventHandlers.set(name, handler);
  }

  /**
   * Get security statistics
   */
  getStats(): {
    blockedIPs: number;
    failedAttempts: number;
    suspiciousActivities: number;
    rateLimiters: {
      htlc: { totalKeys: number; activeEntries: number };
      swap: { totalKeys: number; activeEntries: number };
      api: { totalKeys: number; activeEntries: number };
    };
  } {
    return {
      blockedIPs: this.blockedIPs.size,
      failedAttempts: this.failedAttempts.size,
      suspiciousActivities: this.suspiciousActivity.size,
      rateLimiters: {
        htlc: this.htlcRateLimiter.getStats(),
        swap: this.swapRateLimiter.getStats(),
        api: this.apiRateLimiter.getStats()
      }
    };
  }

  /**
   * Reset all security state (admin function)
   */
  resetAll(): void {
    this.blockedIPs.clear();
    this.failedAttempts.clear();
    this.suspiciousActivity.clear();
    this.htlcRateLimiter.resetAll();
    this.swapRateLimiter.resetAll();
    this.apiRateLimiter.resetAll();
    
    this.logger.warn('All security state reset');
  }

  /**
   * Destroy the security manager
   */
  destroy(): void {
    this.htlcRateLimiter.destroy();
    this.swapRateLimiter.destroy();
    this.apiRateLimiter.destroy();
    this.eventHandlers.clear();
  }
}
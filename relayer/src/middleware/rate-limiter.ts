import { Logger } from 'pino';

export interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Maximum requests per window
  keyGenerator?: (req: any) => string;  // Function to generate rate limit key
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  onLimitReached?: (key: string) => void;
}

export interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private config: Required<RateLimitConfig>;
  private logger: Logger;
  private cleanupInterval: NodeJS.Timeout;

  constructor(config: RateLimitConfig, logger: Logger) {
    this.config = {
      keyGenerator: (req: any) => req.ip || 'unknown',
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      onLimitReached: () => {},
      ...config
    };
    this.logger = logger.child({ component: 'RateLimiter' });

    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Check if request should be rate limited
   */
  async isLimited(request: any): Promise<{ limited: boolean; resetTime?: number; remaining?: number }> {
    const key = this.config.keyGenerator(request);
    const now = Date.now();
    
    let entry = this.store.get(key);
    
    // Initialize or reset expired entry
    if (!entry || now >= entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + this.config.windowMs
      };
      this.store.set(key, entry);
    }

    // Check if limit exceeded
    if (entry.count >= this.config.maxRequests) {
      this.logger.warn({ key, count: entry.count, resetTime: entry.resetTime }, 'Rate limit exceeded');
      this.config.onLimitReached(key);
      
      return {
        limited: true,
        resetTime: entry.resetTime,
        remaining: 0
      };
    }

    // Increment counter
    entry.count++;
    this.store.set(key, entry);

    return {
      limited: false,
      resetTime: entry.resetTime,
      remaining: this.config.maxRequests - entry.count
    };
  }

  /**
   * Record a request for rate limiting
   */
  async recordRequest(request: any, success: boolean = true): Promise<void> {
    // Skip recording based on configuration
    if ((success && this.config.skipSuccessfulRequests) || 
        (!success && this.config.skipFailedRequests)) {
      return;
    }

    await this.isLimited(request);
  }

  /**
   * Get current rate limit status for a request
   */
  getStatus(request: any): { count: number; remaining: number; resetTime: number } {
    const key = this.config.keyGenerator(request);
    const entry = this.store.get(key);
    const now = Date.now();

    if (!entry || now >= entry.resetTime) {
      return {
        count: 0,
        remaining: this.config.maxRequests,
        resetTime: now + this.config.windowMs
      };
    }

    return {
      count: entry.count,
      remaining: Math.max(0, this.config.maxRequests - entry.count),
      resetTime: entry.resetTime
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  reset(key: string): void {
    this.store.delete(key);
    this.logger.info({ key }, 'Rate limit reset');
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.store.clear();
    this.logger.info('All rate limits reset');
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetTime) {
        this.store.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug({ cleaned }, 'Cleaned up expired rate limit entries');
    }
  }

  /**
   * Get rate limiter statistics
   */
  getStats(): { totalKeys: number; activeEntries: number } {
    const now = Date.now();
    let activeEntries = 0;

    for (const entry of this.store.values()) {
      if (now < entry.resetTime) {
        activeEntries++;
      }
    }

    return {
      totalKeys: this.store.size,
      activeEntries
    };
  }

  /**
   * Destroy the rate limiter and cleanup
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

/**
 * Specialized rate limiter for HTLC operations
 */
export class HTLCRateLimiter extends RateLimiter {
  constructor(logger: Logger) {
    super({
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 10, // Max 10 HTLC operations per minute per address
      keyGenerator: (req: any) => req.sender || req.address || 'unknown'
    }, logger);
  }
}

/**
 * Specialized rate limiter for swap operations
 */
export class SwapRateLimiter extends RateLimiter {
  constructor(logger: Logger) {
    super({
      windowMs: 60 * 1000, // 1 minute  
      maxRequests: 20, // Max 20 swaps per minute per address
      keyGenerator: (req: any) => req.sender || req.address || 'unknown'
    }, logger);
  }
}

/**
 * IP-based rate limiter for general API requests
 */
export class APIRateLimiter extends RateLimiter {
  constructor(logger: Logger) {
    super({
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100, // Max 100 API calls per minute per IP
      keyGenerator: (req: any) => req.ip || req.clientIP || 'unknown'
    }, logger);
  }
}
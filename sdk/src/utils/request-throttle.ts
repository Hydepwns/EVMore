import { Logger } from 'pino';

export interface ThrottleConfig {
  maxConcurrent: number;
  queueLimit: number;
  defaultDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  enableAdaptiveThrottling: boolean;
}

export interface RequestContext {
  priority: 'high' | 'medium' | 'low';
  retryCount: number;
  timeout?: number;
  metadata?: Record<string, any>;
}

interface QueuedRequest {
  fn: () => Promise<any>;
  context: RequestContext;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: number;
}

export class RequestThrottle {
  private config: ThrottleConfig;
  private logger?: Logger;
  private activeRequests = 0;
  private queue: QueuedRequest[] = [];
  private recentErrors: Array<{ timestamp: number; type: string }> = [];
  private adaptiveDelay = 0;
  private lastRequestTime = 0;
  private consecutiveErrors = 0;

  constructor(config: Partial<ThrottleConfig> = {}, logger?: Logger) {
    this.config = {
      maxConcurrent: 10,
      queueLimit: 100,
      defaultDelay: 100,
      maxDelay: 5000,
      backoffMultiplier: 1.5,
      enableAdaptiveThrottling: true,
      ...config
    };
    this.logger = logger?.child({ component: 'RequestThrottle' });
  }

  /**
   * Execute a request with throttling
   */
  async execute<T>(
    requestFn: () => Promise<T>,
    context: Partial<RequestContext> = {}
  ): Promise<T> {
    const fullContext: RequestContext = {
      priority: 'medium',
      retryCount: 0,
      ...context
    };

    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        fn: requestFn,
        context: fullContext,
        resolve,
        reject,
        timestamp: Date.now()
      };

      if (this.queue.length >= this.config.queueLimit) {
        reject(new Error('Request queue full'));
        return;
      }

      this.queue.push(queuedRequest);
      this.processQueue();
    });
  }

  /**
   * Process the request queue
   */
  private async processQueue(): Promise<void> {
    if (this.activeRequests >= this.config.maxConcurrent || this.queue.length === 0) {
      return;
    }

    // Sort queue by priority
    this.queue.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.context.priority] - priorityOrder[a.context.priority];
    });

    const request = this.queue.shift();
    if (!request) return;

    // Check for timeout
    if (request.context.timeout && Date.now() - request.timestamp > request.context.timeout) {
      request.reject(new Error('Request timeout in queue'));
      this.processQueue(); // Process next request
      return;
    }

    this.activeRequests++;

    try {
      // Apply throttling delay
      await this.applyThrottling();

      // Execute the request
      const result = await request.fn();
      
      // Success - reset error counters
      this.consecutiveErrors = 0;
      this.reduceAdaptiveDelay();
      
      request.resolve(result);
    } catch (error) {
      // Handle error
      this.handleRequestError(error, request);
    } finally {
      this.activeRequests--;
      this.lastRequestTime = Date.now();
      
      // Process next request
      setTimeout(() => this.processQueue(), 0);
    }
  }

  /**
   * Apply throttling delay based on current conditions
   */
  private async applyThrottling(): Promise<void> {
    let delay = this.config.defaultDelay;

    // Add adaptive delay based on error rate
    if (this.config.enableAdaptiveThrottling) {
      delay += this.adaptiveDelay;
    }

    // Rate limiting based on recent activity
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < delay) {
      delay = delay - timeSinceLastRequest;
    } else {
      delay = 0;
    }

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Handle request errors and adaptive throttling
   */
  private handleRequestError(error: any, request: QueuedRequest): void {
    this.consecutiveErrors++;
    this.recentErrors.push({
      timestamp: Date.now(),
      type: this.getErrorType(error)
    });

    // Clean old errors (older than 1 minute)
    const oneMinuteAgo = Date.now() - 60000;
    this.recentErrors = this.recentErrors.filter(e => e.timestamp > oneMinuteAgo);

    // Increase adaptive delay based on error patterns
    if (this.config.enableAdaptiveThrottling) {
      this.increaseAdaptiveDelay(error);
    }

    // Determine if request should be retried
    if (this.shouldRetry(error, request.context)) {
      const newContext = {
        ...request.context,
        retryCount: request.context.retryCount + 1
      };

      // Re-queue with backoff
      setTimeout(() => {
        this.queue.unshift({
          ...request,
          context: newContext,
          timestamp: Date.now()
        });
        this.processQueue();
      }, this.calculateRetryDelay(newContext.retryCount));
    } else {
      request.reject(error);
    }

    this.logger?.warn({
      error: error.message,
      retryCount: request.context.retryCount,
      consecutiveErrors: this.consecutiveErrors,
      adaptiveDelay: this.adaptiveDelay
    }, 'Request failed');
  }

  /**
   * Determine if a request should be retried
   */
  private shouldRetry(error: any, context: RequestContext): boolean {
    // Don't retry if already retried too many times
    if (context.retryCount >= 3) return false;

    // Retry on network errors, timeouts, and rate limits
    const retryableErrors = [
      'ECONNRESET',
      'ECONNREFUSED', 
      'ETIMEDOUT',
      'ENOTFOUND',
      'Rate limited',
      'Service Unavailable'
    ];

    const errorMessage = error.message || error.toString();
    return retryableErrors.some(retryable => errorMessage.includes(retryable));
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retryCount: number): number {
    const baseDelay = this.config.defaultDelay;
    const delay = baseDelay * Math.pow(this.config.backoffMultiplier, retryCount);
    return Math.min(delay, this.config.maxDelay);
  }

  /**
   * Increase adaptive delay based on error patterns
   */
  private increaseAdaptiveDelay(error: any): void {
    const errorType = this.getErrorType(error);
    
    // Increase delay more aggressively for rate limiting errors
    if (errorType === 'rate_limit') {
      this.adaptiveDelay = Math.min(
        this.adaptiveDelay + 1000, // Add 1 second
        this.config.maxDelay
      );
    } else if (this.consecutiveErrors >= 3) {
      this.adaptiveDelay = Math.min(
        this.adaptiveDelay + 500, // Add 500ms
        this.config.maxDelay
      );
    }
  }

  /**
   * Reduce adaptive delay on successful requests
   */
  private reduceAdaptiveDelay(): void {
    if (this.adaptiveDelay > 0) {
      this.adaptiveDelay = Math.max(0, this.adaptiveDelay - 100);
    }
  }

  /**
   * Classify error type for adaptive handling
   */
  private getErrorType(error: any): string {
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('rate limit') || message.includes('429')) {
      return 'rate_limit';
    } else if (message.includes('timeout')) {
      return 'timeout';
    } else if (message.includes('connection')) {
      return 'connection';
    } else if (message.includes('service unavailable') || message.includes('503')) {
      return 'service_unavailable';
    } else {
      return 'unknown';
    }
  }

  /**
   * Get current throttle statistics
   */
  getStats(): {
    activeRequests: number;
    queueLength: number;
    adaptiveDelay: number;
    consecutiveErrors: number;
    recentErrorRate: number;
  } {
    const recentErrorRate = this.recentErrors.length / 60; // errors per minute
    
    return {
      activeRequests: this.activeRequests,
      queueLength: this.queue.length,
      adaptiveDelay: this.adaptiveDelay,
      consecutiveErrors: this.consecutiveErrors,
      recentErrorRate
    };
  }

  /**
   * Update throttle configuration
   */
  updateConfig(newConfig: Partial<ThrottleConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger?.info({ config: this.config }, 'Throttle configuration updated');
  }

  /**
   * Clear the request queue (emergency)
   */
  clearQueue(): void {
    const clearedCount = this.queue.length;
    this.queue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    
    this.logger?.warn({ clearedCount }, 'Request queue cleared');
  }

  /**
   * Reset throttle state
   */
  reset(): void {
    this.clearQueue();
    this.adaptiveDelay = 0;
    this.consecutiveErrors = 0;
    this.recentErrors = [];
    
    this.logger?.info('Request throttle reset');
  }
}
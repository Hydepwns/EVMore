import { Logger } from 'pino';
import { getMetrics } from '../monitoring/prometheus-metrics';

export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Circuit tripped, blocking requests
  HALF_OPEN = 'half_open' // Testing if circuit can close
}

export interface CircuitBreakerConfig {
  failureThreshold: number;    // Number of failures to trip circuit
  successThreshold: number;    // Number of successes to close circuit from half-open
  timeout: number;            // How long to wait before trying half-open (ms)
  monitoringPeriod: number;   // Time window for failure counting (ms)
  resetTimeout?: number;      // Optional auto-reset timeout
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  requests: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  nextAttempt?: number;
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private logger: Logger;
  private name: string;
  
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private requests: number = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private nextAttempt?: number;
  private resetTimer?: NodeJS.Timeout;

  constructor(name: string, config: CircuitBreakerConfig, logger: Logger) {
    this.name = name;
    this.config = config;
    this.logger = logger.child({ component: 'CircuitBreaker', name });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        const oldState = this.state;
        this.state = CircuitState.HALF_OPEN;
        
        // Record state transition
        getMetrics().updateCircuitBreakerState(
          this.name,
          'relayer',
          'HALF_OPEN',
          oldState,
          'timeout_reset'
        );
        
        this.logger.info('Circuit breaker moved to HALF_OPEN state');
      } else {
        const error = new Error(`Circuit breaker is OPEN for ${this.name}`);
        this.logger.warn('Request blocked by circuit breaker');
        throw error;
      }
    }

    this.requests++;
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Check if operation should be allowed
   */
  isOperationAllowed(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }
    
    if (this.state === CircuitState.HALF_OPEN) {
      return true; // Allow one request to test
    }
    
    if (this.state === CircuitState.OPEN && this.shouldAttemptReset()) {
      this.state = CircuitState.HALF_OPEN;
      this.logger.info('Circuit breaker moved to HALF_OPEN state');
      return true;
    }
    
    return false;
  }

  /**
   * Manually trip the circuit breaker
   */
  trip(reason?: string): void {
    this.state = CircuitState.OPEN;
    this.lastFailureTime = Date.now();
    this.nextAttempt = this.lastFailureTime + this.config.timeout;
    
    this.logger.warn({ reason }, 'Circuit breaker manually tripped');
    this.scheduleReset();
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = undefined;
    this.nextAttempt = undefined;
    
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
    
    this.logger.info('Circuit breaker manually reset');
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      requests: this.requests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttempt: this.nextAttempt
    };
  }

  private onSuccess(): void {
    this.lastSuccessTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      
      if (this.successes >= this.config.successThreshold) {
        const oldState = this.state;
        this.reset();
        
        // Record state transition
        getMetrics().updateCircuitBreakerState(
          this.name,
          'relayer',
          'CLOSED',
          oldState,
          'success_threshold_reached'
        );
        
        this.logger.info('Circuit breaker reset to CLOSED after successful tests');
      }
    } else {
      // Reset failure count on success in closed state
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      // Immediately open on failure in half-open state
      const oldState = this.state;
      this.state = CircuitState.OPEN;
      this.nextAttempt = this.lastFailureTime + this.config.timeout;
      this.successes = 0;
      
      // Record state transition
      getMetrics().updateCircuitBreakerState(
        this.name,
        'relayer',
        'OPEN',
        oldState,
        'failure_in_half_open'
      );
      
      this.logger.warn('Circuit breaker opened after failure in HALF_OPEN state');
      this.scheduleReset();
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we should trip the circuit
      if (this.shouldTrip()) {
        const oldState = this.state;
        this.state = CircuitState.OPEN;
        this.nextAttempt = this.lastFailureTime + this.config.timeout;
        
        // Record state transition
        getMetrics().updateCircuitBreakerState(
          this.name,
          'relayer',
          'OPEN',
          oldState,
          'failure_threshold_exceeded'
        );
        
        this.logger.warn({ 
          failures: this.failures, 
          threshold: this.config.failureThreshold 
        }, 'Circuit breaker tripped');
        
        this.scheduleReset();
      }
    }
  }

  private shouldTrip(): boolean {
    if (this.failures < this.config.failureThreshold) {
      return false;
    }

    // Check if failures occurred within monitoring period
    const now = Date.now();
    const cutoff = now - this.config.monitoringPeriod;
    
    return this.lastFailureTime ? this.lastFailureTime > cutoff : false;
  }

  private shouldAttemptReset(): boolean {
    if (!this.nextAttempt) {
      return false;
    }
    
    return Date.now() >= this.nextAttempt;
  }

  private scheduleReset(): void {
    if (this.config.resetTimeout && !this.resetTimer) {
      this.resetTimer = setTimeout(() => {
        this.reset();
        this.logger.info('Circuit breaker auto-reset after timeout');
      }, this.config.resetTimeout);
    }
  }
}

/**
 * Circuit breaker manager for coordinating multiple circuit breakers
 */
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'CircuitBreakerManager' });
  }

  /**
   * Create or get a circuit breaker
   */
  getBreaker(name: string, config?: CircuitBreakerConfig): CircuitBreaker {
    let breaker = this.breakers.get(name);
    
    if (!breaker) {
      const defaultConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 60000, // 1 minute
        monitoringPeriod: 300000, // 5 minutes
        resetTimeout: 300000 // 5 minutes auto-reset
      };
      
      breaker = new CircuitBreaker(name, config || defaultConfig, this.logger);
      this.breakers.set(name, breaker);
      
      this.logger.info({ name, config: config || defaultConfig }, 'Circuit breaker created');
    }
    
    return breaker;
  }

  /**
   * Execute operation with named circuit breaker
   */
  async execute<T>(name: string, operation: () => Promise<T>, config?: CircuitBreakerConfig): Promise<T> {
    const breaker = this.getBreaker(name, config);
    return breaker.execute(operation);
  }

  /**
   * Trip a circuit breaker by name
   */
  trip(name: string, reason?: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.trip(reason);
    }
  }

  /**
   * Reset a circuit breaker by name
   */
  reset(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    this.logger.info('All circuit breakers reset');
  }

  /**
   * Get statistics for all circuit breakers
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    
    for (const [name, breaker] of this.breakers.entries()) {
      stats[name] = breaker.getStats();
    }
    
    return stats;
  }

  /**
   * Check if any circuit breakers are open
   */
  hasOpenCircuits(): boolean {
    for (const breaker of this.breakers.values()) {
      if (breaker.getStats().state === CircuitState.OPEN) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get names of all open circuit breakers
   */
  getOpenCircuits(): string[] {
    const openCircuits: string[] = [];
    
    for (const [name, breaker] of this.breakers.entries()) {
      if (breaker.getStats().state === CircuitState.OPEN) {
        openCircuits.push(name);
      }
    }
    
    return openCircuits;
  }
}

/**
 * Pre-configured circuit breakers for common operations
 */
export class FusionCircuitBreakers {
  private manager: CircuitBreakerManager;

  constructor(logger: Logger) {
    this.manager = new CircuitBreakerManager(logger);
  }

  /**
   * Circuit breaker for Ethereum operations
   */
  get ethereum(): CircuitBreaker {
    return this.manager.getBreaker('ethereum', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 30000, // 30 seconds
      monitoringPeriod: 120000, // 2 minutes
      resetTimeout: 180000 // 3 minutes
    });
  }

  /**
   * Circuit breaker for Cosmos operations
   */
  get cosmos(): CircuitBreaker {
    return this.manager.getBreaker('cosmos', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 30000,
      monitoringPeriod: 120000,
      resetTimeout: 180000
    });
  }

  /**
   * Circuit breaker for IBC operations
   */
  get ibc(): CircuitBreaker {
    return this.manager.getBreaker('ibc', {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 60000, // 1 minute
      monitoringPeriod: 300000, // 5 minutes
      resetTimeout: 300000
    });
  }

  /**
   * Circuit breaker for DEX operations
   */
  get dex(): CircuitBreaker {
    return this.manager.getBreaker('dex', {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30000,
      monitoringPeriod: 180000,
      resetTimeout: 240000
    });
  }

  /**
   * Get the underlying manager
   */
  getManager(): CircuitBreakerManager {
    return this.manager;
  }
}
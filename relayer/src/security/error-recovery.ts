import { Logger } from 'pino';
import { CircuitBreaker, FusionCircuitBreakers } from './circuit-breaker';

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter?: boolean;
}

export interface ErrorRecoveryConfig {
  retryConfigs: Record<string, RetryConfig>;
  circuitBreakerEnabled: boolean;
  emergencyStopEnabled: boolean;
  healthCheckInterval: number;
}

export enum OperationType {
  ETHEREUM_RPC = 'ethereum_rpc',
  COSMOS_RPC = 'cosmos_rpc',
  IBC_TRANSFER = 'ibc_transfer',
  DEX_SWAP = 'dex_swap',
  CONTRACT_CALL = 'contract_call',
  ROUTE_DISCOVERY = 'route_discovery',
  HTLC_CREATION = 'htlc_creation',
  RECOVERY_CHECK = 'recovery_check',
  RELAY = 'relay'
}

export class ErrorRecoveryManager {
  private logger: Logger;
  private config: ErrorRecoveryConfig;
  private circuitBreakers: FusionCircuitBreakers;
  private emergencyStop: boolean = false;
  private operationMetrics: Map<string, OperationMetrics> = new Map();
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(config: ErrorRecoveryConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'ErrorRecoveryManager' });
    this.circuitBreakers = new FusionCircuitBreakers(logger);
    
    if (config.healthCheckInterval > 0) {
      this.startHealthChecking();
    }
  }

  /**
   * Execute an operation with comprehensive error recovery
   */
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    operationType: OperationType,
    operationId?: string
  ): Promise<T> {
    if (this.emergencyStop) {
      throw new Error('System is in emergency stop mode');
    }

    const retryConfig = this.getRetryConfig(operationType);
    const circuitBreaker = this.getCircuitBreaker(operationType);
    const metrics = this.getOperationMetrics(operationType);

    return await this.executeWithRetryAndCircuitBreaker(
      operation,
      retryConfig,
      circuitBreaker,
      metrics,
      operationId || `${operationType}_${Date.now()}`
    );
  }

  /**
   * Execute with both retry logic and circuit breaker protection
   */
  private async executeWithRetryAndCircuitBreaker<T>(
    operation: () => Promise<T>,
    retryConfig: RetryConfig,
    circuitBreaker: CircuitBreaker,
    metrics: OperationMetrics,
    operationId: string
  ): Promise<T> {
    let lastError: Error;
    let attempt = 0;

    while (attempt < retryConfig.maxAttempts) {
      attempt++;
      metrics.totalAttempts++;

      try {
        const result = await circuitBreaker.execute(async () => {
          this.logger.debug({ operationId, attempt }, 'Executing operation');
          const startTime = Date.now();
          
          try {
            const result = await operation();
            const duration = Date.now() - startTime;
            
            metrics.successCount++;
            metrics.totalDuration += duration;
            metrics.lastSuccess = Date.now();
            
            this.logger.debug({ 
              operationId, 
              attempt, 
              duration 
            }, 'Operation succeeded');
            
            return result;
          } catch (error) {
            const duration = Date.now() - startTime;
            metrics.totalDuration += duration;
            throw error;
          }
        });

        return result;
      } catch (error) {
        lastError = error as Error;
        metrics.errorCount++;
        metrics.lastError = Date.now();

        this.logger.warn({ 
          operationId, 
          attempt, 
          maxAttempts: retryConfig.maxAttempts,
          error: lastError.message 
        }, 'Operation failed');

        // Don't retry if circuit breaker is open
        if (lastError.message.includes('Circuit breaker is OPEN')) {
          throw lastError;
        }

        // Don't retry on last attempt
        if (attempt >= retryConfig.maxAttempts) {
          break;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt, retryConfig);
        
        this.logger.debug({ 
          operationId, 
          attempt, 
          delay,
          nextAttempt: attempt + 1
        }, 'Retrying operation after delay');
        
        await this.sleep(delay);
      }
    }

    // All attempts failed
    metrics.finalFailureCount++;
    this.logger.error({ 
      operationId, 
      attempts: attempt,
      error: lastError!.message 
    }, 'Operation failed after all retry attempts');
    
    throw lastError!;
  }

  /**
   * Calculate retry delay with exponential backoff and optional jitter
   */
  private calculateDelay(attempt: number, config: RetryConfig): number {
    let delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
    delay = Math.min(delay, config.maxDelay);

    if (config.jitter) {
      // Add ±25% jitter to prevent thundering herd
      const jitterRange = delay * 0.25;
      const jitter = (Math.random() * 2 - 1) * jitterRange;
      delay += jitter;
    }

    return Math.max(delay, 0);
  }

  /**
   * Get retry configuration for operation type
   */
  private getRetryConfig(operationType: OperationType): RetryConfig {
    return this.config.retryConfigs[operationType] || this.getDefaultRetryConfig();
  }

  /**
   * Get appropriate circuit breaker for operation type
   */
  private getCircuitBreaker(operationType: OperationType): CircuitBreaker {
    switch (operationType) {
      case OperationType.ETHEREUM_RPC:
      case OperationType.CONTRACT_CALL:
      case OperationType.HTLC_CREATION:
        return this.circuitBreakers.ethereum;
      
      case OperationType.COSMOS_RPC:
        return this.circuitBreakers.cosmos;
      
      case OperationType.IBC_TRANSFER:
        return this.circuitBreakers.ibc;
      
      case OperationType.DEX_SWAP:
        return this.circuitBreakers.dex;
      
      default:
        return this.circuitBreakers.getManager().getBreaker('default');
    }
  }

  /**
   * Get or create operation metrics
   */
  private getOperationMetrics(operationType: OperationType): OperationMetrics {
    let metrics = this.operationMetrics.get(operationType);
    if (!metrics) {
      metrics = new OperationMetrics();
      this.operationMetrics.set(operationType, metrics);
    }
    return metrics;
  }

  /**
   * Get default retry configuration
   */
  private getDefaultRetryConfig(): RetryConfig {
    return {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitter: true
    };
  }

  /**
   * Trigger emergency stop
   */
  emergencyStopSystem(reason: string): void {
    this.emergencyStop = true;
    
    // Trip all circuit breakers
    this.circuitBreakers.getManager().resetAll();
    
    this.logger.error({ reason }, 'EMERGENCY STOP ACTIVATED');
    
    // Emit system-wide alert
    // In production, this would trigger alerts to monitoring systems
  }

  /**
   * Resume from emergency stop
   */
  resumeSystem(): void {
    this.emergencyStop = false;
    
    // Reset circuit breakers
    this.circuitBreakers.getManager().resetAll();
    
    this.logger.info('System resumed from emergency stop');
  }

  /**
   * Check if system is healthy
   */
  isSystemHealthy(): boolean {
    if (this.emergencyStop) {
      return false;
    }

    // Check if too many circuit breakers are open
    const openCircuits = this.circuitBreakers.getManager().getOpenCircuits();
    if (openCircuits.length > 2) {
      return false;
    }

    // Check error rates
    for (const [operationType, metrics] of this.operationMetrics.entries()) {
      const errorRate = metrics.getErrorRate();
      if (errorRate > 0.5) { // More than 50% error rate
        this.logger.warn({ operationType, errorRate }, 'High error rate detected');
        return false;
      }
    }

    return true;
  }

  /**
   * Get system health report
   */
  getHealthReport(): SystemHealthReport {
    const circuitBreakerStats = this.circuitBreakers.getManager().getAllStats();
    const operationStats: Record<string, any> = {};

    for (const [operationType, metrics] of this.operationMetrics.entries()) {
      operationStats[operationType] = {
        errorRate: metrics.getErrorRate(),
        averageLatency: metrics.getAverageLatency(),
        totalAttempts: metrics.totalAttempts,
        successCount: metrics.successCount,
        errorCount: metrics.errorCount,
        lastSuccess: metrics.lastSuccess,
        lastError: metrics.lastError
      };
    }

    return {
      healthy: this.isSystemHealthy(),
      emergencyStop: this.emergencyStop,
      circuitBreakers: circuitBreakerStats,
      operations: operationStats
    };
  }

  /**
   * Start periodic health checking
   */
  private startHealthChecking(): void {
    this.healthCheckTimer = setInterval(() => {
      const healthy = this.isSystemHealthy();
      
      if (!healthy) {
        this.logger.warn('System health check failed');
        const report = this.getHealthReport();
        this.logger.warn({ report }, 'Health report');
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health checking
   */
  stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Metrics tracking for operations
 */
class OperationMetrics {
  totalAttempts: number = 0;
  successCount: number = 0;
  errorCount: number = 0;
  finalFailureCount: number = 0;
  totalDuration: number = 0;
  lastSuccess?: number;
  lastError?: number;

  getErrorRate(): number {
    if (this.totalAttempts === 0) return 0;
    return this.errorCount / this.totalAttempts;
  }

  getSuccessRate(): number {
    if (this.totalAttempts === 0) return 0;
    return this.successCount / this.totalAttempts;
  }

  getAverageLatency(): number {
    const totalOps = this.successCount + this.finalFailureCount;
    if (totalOps === 0) return 0;
    return this.totalDuration / totalOps;
  }
}

/**
 * System health report interface
 */
export interface SystemHealthReport {
  healthy: boolean;
  emergencyStop: boolean;
  circuitBreakers: Record<string, any>;
  operations: Record<string, any>;
}

/**
 * Default error recovery configuration
 */
export const DEFAULT_ERROR_RECOVERY_CONFIG: ErrorRecoveryConfig = {
  retryConfigs: {
    [OperationType.ETHEREUM_RPC]: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
      jitter: true
    },
    [OperationType.COSMOS_RPC]: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
      jitter: true
    },
    [OperationType.IBC_TRANSFER]: {
      maxAttempts: 5,
      baseDelay: 2000,
      maxDelay: 30000,
      backoffMultiplier: 1.5,
      jitter: true
    },
    [OperationType.DEX_SWAP]: {
      maxAttempts: 3,
      baseDelay: 1500,
      maxDelay: 15000,
      backoffMultiplier: 2,
      jitter: true
    },
    [OperationType.CONTRACT_CALL]: {
      maxAttempts: 4,
      baseDelay: 2000,
      maxDelay: 20000,
      backoffMultiplier: 2,
      jitter: true
    },
    [OperationType.ROUTE_DISCOVERY]: {
      maxAttempts: 2,
      baseDelay: 1000,
      maxDelay: 5000,
      backoffMultiplier: 2,
      jitter: false
    },
    [OperationType.HTLC_CREATION]: {
      maxAttempts: 4,
      baseDelay: 2000,
      maxDelay: 20000,
      backoffMultiplier: 2,
      jitter: true
    },
    [OperationType.RECOVERY_CHECK]: {
      maxAttempts: 2,
      baseDelay: 5000,
      maxDelay: 15000,
      backoffMultiplier: 1.5,
      jitter: true
    }
  },
  circuitBreakerEnabled: true,
  emergencyStopEnabled: true,
  healthCheckInterval: 30000 // 30 seconds
};
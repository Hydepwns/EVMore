/**
 * Persistence manager for the 1inch Fusion+ Cosmos Relayer
 * 
 * Provides a unified interface for persistence operations with automatic
 * provider selection, health monitoring, and graceful degradation.
 */

import { Logger } from 'pino';
import { EventEmitter } from 'events';
import {
  PersistenceProvider,
  PersistenceTransaction,
  PersistenceConfig,
  PersistenceStats,
  PendingRelay,
  RelayAttempt,
  ChainState,
  CircuitBreakerState,
  MetricsSnapshot,
  RelayStatus
} from './types';
import { PostgresPersistenceProvider } from './postgres-provider';
import { RedisPersistenceProvider } from './redis-provider';
import { HybridPersistenceProvider } from './hybrid-provider';
import { getMetrics } from '../monitoring/prometheus-metrics';

export type PersistenceMode = 'postgres' | 'redis' | 'hybrid';

export interface PersistenceManagerConfig extends PersistenceConfig {
  mode: PersistenceMode;
  healthCheckInterval?: number; // Health check interval in ms
  autoRetry?: boolean; // Automatic retry on failures
  maxRetries?: number; // Maximum retry attempts
  retryDelay?: number; // Delay between retries in ms
  gracefulDegradation?: boolean; // Allow fallback to single provider
}

export class PersistenceManager extends EventEmitter {
  private provider: PersistenceProvider;
  private config: PersistenceManagerConfig;
  private logger: Logger;
  private healthCheckTimer?: NodeJS.Timeout;
  private _isHealthy: boolean = false;
  private lastHealthCheck: Date = new Date(0);
  private retryCount: number = 0;

  constructor(config: PersistenceManagerConfig, logger: Logger) {
    super();
    this.config = {
      healthCheckInterval: 30000, // 30 seconds
      autoRetry: true,
      maxRetries: 3,
      retryDelay: 5000, // 5 seconds
      gracefulDegradation: true,
      ...config
    };
    this.logger = logger.child({ component: 'PersistenceManager' });

    this.provider = this.createProvider();
    this.setupEventHandlers();
  }

  async initialize(): Promise<void> {
    try {
      await this.provider.connect();
      this._isHealthy = true;
      this.retryCount = 0;
      this.startHealthCheck();
      
      this.logger.info({
        mode: this.config.mode,
        provider: this.provider.constructor.name
      }, 'Persistence manager initialized');

      this.emit('initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize persistence manager');
      this._isHealthy = false;
      
      if (this.config.autoRetry && this.retryCount < this.config.maxRetries!) {
        this.scheduleRetry();
      } else {
        this.emit('error', error);
        throw error;
      }
    }
  }

  async shutdown(): Promise<void> {
    this.stopHealthCheck();
    
    try {
      await this.provider.disconnect();
      this._isHealthy = false;
      this.emit('shutdown');
      this.logger.info('Persistence manager shut down');
    } catch (error) {
      this.logger.error({ error }, 'Error during persistence manager shutdown');
      throw error;
    }
  }

  // Close method for graceful shutdown
  async close(): Promise<void> {
    await this.shutdown();
  }

  // Health status method
  getHealthStatus(): any {
    return {
      healthy: this.isHealthy(),
      mode: this.getMode(),
      lastHealthCheck: this.getLastHealthCheck()
    };
  }

  // Provider delegation with error handling and metrics
  async saveRelay(relay: PendingRelay): Promise<void> {
    return this.executeWithMetrics('saveRelay', () => 
      this.provider.saveRelay(relay)
    );
  }

  async updateRelay(id: string, updates: Partial<PendingRelay>): Promise<void> {
    return this.executeWithMetrics('updateRelay', () => 
      this.provider.updateRelay(id, updates)
    );
  }

  async getRelay(id: string): Promise<PendingRelay | null> {
    return this.executeWithMetrics('getRelay', () => 
      this.provider.getRelay(id)
    );
  }

  async listPendingRelays(limit?: number): Promise<PendingRelay[]> {
    return this.executeWithMetrics('listPendingRelays', () => 
      this.provider.listPendingRelays(limit)
    );
  }

  async listRelaysByStatus(status: RelayStatus, limit?: number): Promise<PendingRelay[]> {
    return this.executeWithMetrics('listRelaysByStatus', () => 
      this.provider.listRelaysByStatus(status, limit)
    );
  }

  async deleteRelay(id: string): Promise<void> {
    return this.executeWithMetrics('deleteRelay', () => 
      this.provider.deleteRelay(id)
    );
  }

  async saveRelayAttempt(attempt: RelayAttempt): Promise<void> {
    return this.executeWithMetrics('saveRelayAttempt', () => 
      this.provider.saveRelayAttempt(attempt)
    );
  }

  async getRelayAttempts(relayId: string): Promise<RelayAttempt[]> {
    return this.executeWithMetrics('getRelayAttempts', () => 
      this.provider.getRelayAttempts(relayId)
    );
  }

  async updateRelayAttempt(id: string, updates: Partial<RelayAttempt>): Promise<void> {
    return this.executeWithMetrics('updateRelayAttempt', () => 
      this.provider.updateRelayAttempt(id, updates)
    );
  }

  async saveChainState(state: ChainState): Promise<void> {
    return this.executeWithMetrics('saveChainState', () => 
      this.provider.saveChainState(state)
    );
  }

  async getChainState(chainId: string): Promise<ChainState | null> {
    return this.executeWithMetrics('getChainState', () => 
      this.provider.getChainState(chainId)
    );
  }

  async listChainStates(): Promise<ChainState[]> {
    return this.executeWithMetrics('listChainStates', () => 
      this.provider.listChainStates()
    );
  }

  async updateChainState(chainId: string, updates: Partial<ChainState>): Promise<void> {
    return this.executeWithMetrics('updateChainState', () => 
      this.provider.updateChainState(chainId, updates)
    );
  }

  async saveCircuitBreakerState(state: CircuitBreakerState): Promise<void> {
    return this.executeWithMetrics('saveCircuitBreakerState', () => 
      this.provider.saveCircuitBreakerState(state)
    );
  }

  async getCircuitBreakerState(name: string): Promise<CircuitBreakerState | null> {
    return this.executeWithMetrics('getCircuitBreakerState', () => 
      this.provider.getCircuitBreakerState(name)
    );
  }

  async listCircuitBreakerStates(): Promise<CircuitBreakerState[]> {
    return this.executeWithMetrics('listCircuitBreakerStates', () => 
      this.provider.listCircuitBreakerStates()
    );
  }

  async updateCircuitBreakerState(name: string, updates: Partial<CircuitBreakerState>): Promise<void> {
    return this.executeWithMetrics('updateCircuitBreakerState', () => 
      this.provider.updateCircuitBreakerState(name, updates)
    );
  }

  async saveMetricsSnapshot(snapshot: MetricsSnapshot): Promise<void> {
    return this.executeWithMetrics('saveMetricsSnapshot', () => 
      this.provider.saveMetricsSnapshot(snapshot)
    );
  }

  async getLatestMetricsSnapshot(): Promise<MetricsSnapshot | null> {
    return this.executeWithMetrics('getLatestMetricsSnapshot', () => 
      this.provider.getLatestMetricsSnapshot()
    );
  }

  async getMetricsHistory(fromTime: Date, toTime: Date): Promise<MetricsSnapshot[]> {
    return this.executeWithMetrics('getMetricsHistory', () => 
      this.provider.getMetricsHistory(fromTime, toTime)
    );
  }

  async cleanup(retentionPeriod: number): Promise<number> {
    return this.executeWithMetrics('cleanup', () => 
      this.provider.cleanup(retentionPeriod)
    );
  }

  async vacuum(): Promise<void> {
    return this.executeWithMetrics('vacuum', () => 
      this.provider.vacuum()
    );
  }

  async getStats(): Promise<PersistenceStats> {
    return this.executeWithMetrics('getStats', () => 
      this.provider.getStats()
    );
  }

  async beginTransaction(): Promise<PersistenceTransaction> {
    if (!this.isPostgreSQLBased()) {
      throw new Error('Transactions are only supported with PostgreSQL-based providers');
    }

    return this.executeWithMetrics('beginTransaction', () => 
      (this.provider as any).beginTransaction()
    );
  }

  // Health and monitoring
  isHealthy(): boolean {
    return this._isHealthy && this.provider.isConnected();
  }

  getMode(): PersistenceMode {
    return this.config.mode;
  }

  getLastHealthCheck(): Date {
    return this.lastHealthCheck;
  }

  async forceHealthCheck(): Promise<boolean> {
    return this.performHealthCheck();
  }

  // Utility methods for atomic operations
  async withTransaction<T>(
    operation: (tx: PersistenceTransaction) => Promise<T>
  ): Promise<T> {
    if (!this.isPostgreSQLBased()) {
      // Fallback to regular operation without transaction for Redis-only mode
      this.logger.warn('Transaction requested but not supported by current provider, executing without transaction');
      return operation({} as any); // This will fail, but that's expected behavior
    }

    const tx = await this.beginTransaction();
    
    try {
      const result = await operation(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(rollbackError => 
        this.logger.error({ error: rollbackError }, 'Failed to rollback transaction')
      );
      throw error;
    }
  }

  async saveRelayWithAttempt(relay: PendingRelay, attempt: RelayAttempt): Promise<void> {
    if (this.isPostgreSQLBased()) {
      // Use transaction for atomicity
      await this.withTransaction(async (tx) => {
        await tx.saveRelay(relay);
        await tx.saveRelayAttempt(attempt);
      });
    } else {
      // Best effort for Redis-only mode
      await this.saveRelay(relay);
      await this.saveRelayAttempt(attempt);
    }
  }

  // Private methods
  private createProvider(): PersistenceProvider {
    switch (this.config.mode) {
      case 'postgres':
        if (!this.config.postgres) {
          throw new Error('PostgreSQL configuration required for postgres mode');
        }
        return new PostgresPersistenceProvider(this.config, this.logger);

      case 'redis':
        if (!this.config.redis) {
          throw new Error('Redis configuration required for redis mode');
        }
        return new RedisPersistenceProvider(this.config, this.logger);

      case 'hybrid':
        if (!this.config.postgres || !this.config.redis) {
          throw new Error('Both PostgreSQL and Redis configuration required for hybrid mode');
        }
        return new HybridPersistenceProvider(this.config, this.logger);

      default:
        throw new Error(`Unsupported persistence mode: ${this.config.mode}`);
    }
  }

  private isPostgreSQLBased(): boolean {
    return this.config.mode === 'postgres' || this.config.mode === 'hybrid';
  }

  private async executeWithMetrics<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const metrics = getMetrics();
    const startTime = Date.now();

    try {
      const result = await fn();
      
      // Record successful operation
      const duration = (Date.now() - startTime) / 1000;
      metrics.recordDatabaseOperation(
        this.config.mode,
        operation,
        'success',
        duration
      );

      return result;
    } catch (error) {
      // Record failed operation
      const duration = (Date.now() - startTime) / 1000;
      const errorType = error instanceof Error ? error.name : 'unknown';
      
      metrics.recordDatabaseOperation(
        this.config.mode,
        operation,
        'error',
        duration,
        errorType
      );

      this.logger.error({
        error,
        operation,
        duration: Date.now() - startTime
      }, 'Persistence operation failed');

      // Mark as unhealthy if critical operations fail
      if (['saveRelay', 'updateRelay', 'saveChainState'].includes(operation)) {
        this._isHealthy = false;
      }

      throw error;
    }
  }

  private setupEventHandlers(): void {
    this.provider.on('connected', () => {
      this._isHealthy = true;
      this.retryCount = 0;
      this.emit('connected');
    });

    this.provider.on('disconnected', () => {
      this._isHealthy = false;
      this.emit('disconnected');
    });

    this.provider.on('error', (error) => {
      this.logger.error({ error }, 'Persistence provider error');
      this._isHealthy = false;
      this.emit('error', error);

      if (this.config.autoRetry && this.retryCount < this.config.maxRetries!) {
        this.scheduleRetry();
      }
    });

    // Forward other events
    this.provider.on('slow_query', (query, duration) => 
      this.emit('slow_query', query, duration)
    );
    this.provider.on('relay_saved', (relay) => 
      this.emit('relay_saved', relay)
    );
    this.provider.on('relay_updated', (id, updates) => 
      this.emit('relay_updated', id, updates)
    );
    this.provider.on('cleanup_completed', (count) => 
      this.emit('cleanup_completed', count)
    );
  }

  private startHealthCheck(): void {
    if (this.config.healthCheckInterval && this.config.healthCheckInterval > 0) {
      this.healthCheckTimer = setInterval(
        () => this.performHealthCheck(),
        this.config.healthCheckInterval
      );
      
      this.logger.debug({
        interval: this.config.healthCheckInterval
      }, 'Started persistence health checks');
    }
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      this.logger.debug('Stopped persistence health checks');
    }
  }

  private async performHealthCheck(): Promise<boolean> {
    try {
      const isHealthy = await this.provider.ping();
      this.lastHealthCheck = new Date();
      
      if (isHealthy !== this._isHealthy) {
        this._isHealthy = isHealthy;
        
        if (isHealthy) {
          this.logger.info('Persistence provider health restored');
          this.emit('health_restored');
        } else {
          this.logger.warn('Persistence provider health check failed');
          this.emit('health_degraded');
        }
      }

      // Record health check in metrics
      const metrics = getMetrics();
      metrics.recordDatabaseHealth(this.config.mode, isHealthy ? 1 : 0);

      return isHealthy;
    } catch (error) {
      this.logger.error({ error }, 'Health check error');
      this._isHealthy = false;
      this.emit('health_degraded');
      return false;
    }
  }

  private scheduleRetry(): void {
    this.retryCount++;
    const delay = this.config.retryDelay! * Math.pow(2, this.retryCount - 1); // Exponential backoff
    
    this.logger.info({
      attempt: this.retryCount,
      maxRetries: this.config.maxRetries,
      delay
    }, 'Scheduling persistence retry');

    setTimeout(() => {
      this.initialize().catch(error => {
        this.logger.error({ error, attempt: this.retryCount }, 'Persistence retry failed');
        
        if (this.retryCount >= this.config.maxRetries!) {
          this.logger.error('Max persistence retries exceeded');
          this.emit('max_retries_exceeded');
        }
      });
    }, delay);
  }
}

/**
 * Factory function for creating persistence managers with common configurations
 */
export class PersistenceFactory {
  static createManager(
    config: PersistenceManagerConfig,
    logger: Logger
  ): PersistenceManager {
    return new PersistenceManager(config, logger);
  }

  static createPostgreSQLManager(
    postgresConfig: NonNullable<PersistenceConfig['postgres']>,
    logger: Logger,
    options: Partial<PersistenceManagerConfig> = {}
  ): PersistenceManager {
    return new PersistenceManager(
      {
        mode: 'postgres',
        postgres: postgresConfig,
        ...options
      },
      logger
    );
  }

  static createRedisManager(
    redisConfig: NonNullable<PersistenceConfig['redis']>,
    logger: Logger,
    options: Partial<PersistenceManagerConfig> = {}
  ): PersistenceManager {
    return new PersistenceManager(
      {
        mode: 'redis',
        redis: redisConfig,
        ...options
      },
      logger
    );
  }

  static createHybridManager(
    postgresConfig: NonNullable<PersistenceConfig['postgres']>,
    redisConfig: NonNullable<PersistenceConfig['redis']>,
    logger: Logger,
    options: Partial<PersistenceManagerConfig> = {}
  ): PersistenceManager {
    return new PersistenceManager(
      {
        mode: 'hybrid',
        postgres: postgresConfig,
        redis: redisConfig,
        ...options
      },
      logger
    );
  }
}
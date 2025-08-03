/**
 * Hybrid persistence provider for the 1inch Fusion+ Cosmos Relayer
 * 
 * Combines PostgreSQL for ACID compliance and Redis for high-performance caching.
 * Provides the best of both worlds for production cross-chain operations.
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

export class HybridPersistenceProvider extends EventEmitter implements PersistenceProvider {
  private postgres: PostgresPersistenceProvider;
  private redis: RedisPersistenceProvider;
  private logger: Logger;
  private config: PersistenceConfig;
  private cacheStrategy: CacheStrategy;

  constructor(config: PersistenceConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'HybridPersistence' });
    this.cacheStrategy = new CacheStrategy(logger);

    // Initialize both providers
    this.postgres = new PostgresPersistenceProvider(config, logger);
    this.redis = new RedisPersistenceProvider(config, logger);

    this.setupEventHandlers();
  }

  async connect(): Promise<void> {
    try {
      // Connect both providers
      await Promise.all([
        this.postgres.connect(),
        this.redis.connect()
      ]);

      this.emit('connected');
      this.logger.info('Hybrid persistence provider connected');
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect hybrid persistence');
      this.emit('error', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all([
      this.postgres.disconnect(),
      this.redis.disconnect()
    ]);

    this.emit('disconnected');
    this.logger.info('Hybrid persistence provider disconnected');
  }

  isConnected(): boolean {
    return this.postgres.isConnected() && this.redis.isConnected();
  }

  async ping(): Promise<boolean> {
    const [postgresOk, redisOk] = await Promise.all([
      this.postgres.ping(),
      this.redis.ping()
    ]);

    return postgresOk && redisOk;
  }

  // Relay management - Write to both, read from cache first
  async saveRelay(relay: PendingRelay): Promise<void> {
    try {
      // Write to both systems
      await Promise.all([
        this.postgres.saveRelay(relay),
        this.redis.saveRelay(relay)
      ]);

      this.emit('relay_saved', relay);
    } catch (error) {
      this.logger.error({ error, relayId: relay.id }, 'Failed to save relay');
      
      // Try to save to at least one system
      try {
        await this.postgres.saveRelay(relay);
        this.logger.warn({ relayId: relay.id }, 'Saved relay to PostgreSQL only');
      } catch (pgError) {
        this.logger.error({ error: pgError, relayId: relay.id }, 'Failed to save to PostgreSQL fallback');
        throw error;
      }
    }
  }

  async updateRelay(id: string, updates: Partial<PendingRelay>): Promise<void> {
    try {
      // Update both systems
      await Promise.all([
        this.postgres.updateRelay(id, updates),
        this.redis.updateRelay(id, updates)
      ]);

      this.emit('relay_updated', id, updates);
    } catch (error) {
      this.logger.error({ error, relayId: id }, 'Failed to update relay');
      
      // Ensure PostgreSQL (source of truth) is updated
      try {
        await this.postgres.updateRelay(id, updates);
        this.logger.warn({ relayId: id }, 'Updated relay in PostgreSQL only');
        
        // Try to sync to Redis in background
        this.syncRelayToCache(id).catch(err => 
          this.logger.warn({ error: err, relayId: id }, 'Failed to sync relay to cache')
        );
      } catch (pgError) {
        this.logger.error({ error: pgError, relayId: id }, 'Failed to update PostgreSQL');
        throw error;
      }
    }
  }

  async getRelay(id: string): Promise<PendingRelay | null> {
    // Try cache first
    try {
      const cachedRelay = await this.redis.getRelay(id);
      if (cachedRelay) {
        this.cacheStrategy.recordHit('relay');
        return cachedRelay;
      }
    } catch (error) {
      this.logger.warn({ error, relayId: id }, 'Failed to get relay from cache');
    }

    // Fallback to PostgreSQL
    this.cacheStrategy.recordMiss('relay');
    const relay = await this.postgres.getRelay(id);

    // Cache the result if found
    if (relay) {
      this.cacheRelayInBackground(relay);
    }

    return relay;
  }

  async listPendingRelays(limit = 100): Promise<PendingRelay[]> {
    // Try cache first for recent pending relays
    try {
      const cachedRelays = await this.redis.listPendingRelays(limit);
      if (cachedRelays.length > 0) {
        this.cacheStrategy.recordHit('pending_relays');
        return cachedRelays;
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to get pending relays from cache');
    }

    // Fallback to PostgreSQL
    this.cacheStrategy.recordMiss('pending_relays');
    const relays = await this.postgres.listPendingRelays(limit);

    // Cache results in background
    this.cacheRelaysInBackground(relays);

    return relays;
  }

  async listRelaysByStatus(status: RelayStatus, limit = 100): Promise<PendingRelay[]> {
    // Use cache for active statuses, PostgreSQL for historical data
    if (['pending', 'routing', 'executing', 'confirming'].includes(status)) {
      try {
        const cachedRelays = await this.redis.listRelaysByStatus(status, limit);
        if (cachedRelays.length > 0) {
          this.cacheStrategy.recordHit('relay_status');
          return cachedRelays;
        }
      } catch (error) {
        this.logger.warn({ error, status }, 'Failed to get relays by status from cache');
      }
    }

    // Use PostgreSQL for completed/failed relays or cache miss
    this.cacheStrategy.recordMiss('relay_status');
    return await this.postgres.listRelaysByStatus(status, limit);
  }

  async deleteRelay(id: string): Promise<void> {
    // Delete from both systems
    await Promise.all([
      this.postgres.deleteRelay(id),
      this.redis.deleteRelay(id).catch(err => 
        this.logger.warn({ error: err, relayId: id }, 'Failed to delete from cache')
      )
    ]);
  }

  // Relay attempts - PostgreSQL primary, Redis for active attempts
  async saveRelayAttempt(attempt: RelayAttempt): Promise<void> {
    // Always save to PostgreSQL (source of truth)
    await this.postgres.saveRelayAttempt(attempt);

    // Cache active attempts for quick access
    if (['pending', 'in_progress'].includes(attempt.status)) {
      try {
        await this.redis.saveRelayAttempt(attempt);
      } catch (error) {
        this.logger.warn({ error, attemptId: attempt.id }, 'Failed to cache relay attempt');
      }
    }
  }

  async getRelayAttempts(relayId: string): Promise<RelayAttempt[]> {
    // Try cache first for active relays
    try {
      const relay = await this.getRelay(relayId);
      if (relay && ['pending', 'routing', 'executing', 'confirming'].includes(relay.status)) {
        const cachedAttempts = await this.redis.getRelayAttempts(relayId);
        if (cachedAttempts.length > 0) {
          this.cacheStrategy.recordHit('relay_attempts');
          return cachedAttempts;
        }
      }
    } catch (error) {
      this.logger.warn({ error, relayId }, 'Failed to get relay attempts from cache');
    }

    // Use PostgreSQL as fallback and for historical data
    this.cacheStrategy.recordMiss('relay_attempts');
    return await this.postgres.getRelayAttempts(relayId);
  }

  async updateRelayAttempt(id: string, updates: Partial<RelayAttempt>): Promise<void> {
    // Only update in PostgreSQL (Redis doesn't support attempt updates efficiently)
    await this.postgres.updateRelayAttempt(id, updates);
  }

  // Chain state - Redis primary for real-time data, PostgreSQL for persistence
  async saveChainState(state: ChainState): Promise<void> {
    // Write to both systems
    await Promise.all([
      this.postgres.saveChainState(state),
      this.redis.saveChainState(state)
    ]);
  }

  async getChainState(chainId: string): Promise<ChainState | null> {
    // Try cache first (more up-to-date for chain states)
    try {
      const cachedState = await this.redis.getChainState(chainId);
      if (cachedState) {
        this.cacheStrategy.recordHit('chain_state');
        return cachedState;
      }
    } catch (error) {
      this.logger.warn({ error, chainId }, 'Failed to get chain state from cache');
    }

    // Fallback to PostgreSQL
    this.cacheStrategy.recordMiss('chain_state');
    const state = await this.postgres.getChainState(chainId);

    // Cache the result
    if (state) {
      this.redis.saveChainState(state).catch(err =>
        this.logger.warn({ error: err, chainId }, 'Failed to cache chain state')
      );
    }

    return state;
  }

  async listChainStates(): Promise<ChainState[]> {
    // Use cache for real-time chain states
    try {
      const cachedStates = await this.redis.listChainStates();
      if (cachedStates.length > 0) {
        this.cacheStrategy.recordHit('chain_states');
        return cachedStates;
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to get chain states from cache');
    }

    // Fallback to PostgreSQL
    this.cacheStrategy.recordMiss('chain_states');
    const states = await this.postgres.listChainStates();

    // Cache results
    states.forEach(state => {
      this.redis.saveChainState(state).catch(err =>
        this.logger.warn({ error: err, chainId: state.chainId }, 'Failed to cache chain state')
      );
    });

    return states;
  }

  async updateChainState(chainId: string, updates: Partial<ChainState>): Promise<void> {
    // Update both systems
    await Promise.all([
      this.postgres.updateChainState(chainId, updates),
      this.redis.updateChainState(chainId, updates).catch(err =>
        this.logger.warn({ error: err, chainId }, 'Failed to update chain state in cache')
      )
    ]);
  }

  // Circuit breaker state - Redis primary for real-time access
  async saveCircuitBreakerState(state: CircuitBreakerState): Promise<void> {
    // Write to both systems
    await Promise.all([
      this.postgres.saveCircuitBreakerState(state),
      this.redis.saveCircuitBreakerState(state)
    ]);
  }

  async getCircuitBreakerState(name: string): Promise<CircuitBreakerState | null> {
    // Try cache first (circuit breaker states change frequently)
    try {
      const cachedState = await this.redis.getCircuitBreakerState(name);
      if (cachedState) {
        this.cacheStrategy.recordHit('circuit_breaker');
        return cachedState;
      }
    } catch (error) {
      this.logger.warn({ error, name }, 'Failed to get circuit breaker state from cache');
    }

    // Fallback to PostgreSQL
    this.cacheStrategy.recordMiss('circuit_breaker');
    const state = await this.postgres.getCircuitBreakerState(name);

    // Cache the result
    if (state) {
      this.redis.saveCircuitBreakerState(state).catch(err =>
        this.logger.warn({ error: err, name }, 'Failed to cache circuit breaker state')
      );
    }

    return state;
  }

  async listCircuitBreakerStates(): Promise<CircuitBreakerState[]> {
    // Use cache for real-time circuit breaker states
    try {
      const cachedStates = await this.redis.listCircuitBreakerStates();
      if (cachedStates.length > 0) {
        this.cacheStrategy.recordHit('circuit_breaker_states');
        return cachedStates;
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to get circuit breaker states from cache');
    }

    // Fallback to PostgreSQL
    this.cacheStrategy.recordMiss('circuit_breaker_states');
    return await this.postgres.listCircuitBreakerStates();
  }

  async updateCircuitBreakerState(name: string, updates: Partial<CircuitBreakerState>): Promise<void> {
    // Update both systems
    await Promise.all([
      this.postgres.updateCircuitBreakerState(name, updates),
      this.redis.updateCircuitBreakerState(name, updates).catch(err =>
        this.logger.warn({ error: err, name }, 'Failed to update circuit breaker state in cache')
      )
    ]);
  }

  // Metrics - PostgreSQL for long-term storage, Redis for recent data
  async saveMetricsSnapshot(snapshot: MetricsSnapshot): Promise<void> {
    // Save to both systems
    await Promise.all([
      this.postgres.saveMetricsSnapshot(snapshot),
      this.redis.saveMetricsSnapshot(snapshot)
    ]);
  }

  async getLatestMetricsSnapshot(): Promise<MetricsSnapshot | null> {
    // Try cache first (latest metrics are frequently accessed)
    try {
      const cachedSnapshot = await this.redis.getLatestMetricsSnapshot();
      if (cachedSnapshot) {
        this.cacheStrategy.recordHit('latest_metrics');
        return cachedSnapshot;
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to get latest metrics from cache');
    }

    // Fallback to PostgreSQL
    this.cacheStrategy.recordMiss('latest_metrics');
    return await this.postgres.getLatestMetricsSnapshot();
  }

  async getMetricsHistory(fromTime: Date, toTime: Date): Promise<MetricsSnapshot[]> {
    // Use PostgreSQL for historical data (more reliable for time-series queries)
    return await this.postgres.getMetricsHistory(fromTime, toTime);
  }

  // Maintenance operations
  async cleanup(retentionPeriod: number): Promise<number> {
    // Cleanup both systems
    const [pgCleaned, redisCleaned] = await Promise.all([
      this.postgres.cleanup(retentionPeriod),
      this.redis.cleanup(retentionPeriod)
    ]);

    const totalCleaned = pgCleaned + redisCleaned;
    this.emit('cleanup_completed', totalCleaned);
    
    return totalCleaned;
  }

  async vacuum(): Promise<void> {
    // Vacuum both systems
    await Promise.all([
      this.postgres.vacuum(),
      this.redis.vacuum()
    ]);
  }

  async getStats(): Promise<PersistenceStats> {
    // Get stats from both systems and combine
    const [pgStats, redisStats] = await Promise.all([
      this.postgres.getStats(),
      this.redis.getStats()
    ]);

    return {
      totalRelays: pgStats.totalRelays,
      pendingRelays: pgStats.pendingRelays,
      completedRelays: pgStats.completedRelays,
      failedRelays: pgStats.failedRelays,
      totalAttempts: pgStats.totalAttempts,
      databaseSize: pgStats.databaseSize + redisStats.databaseSize,
      connectionPool: {
        active: pgStats.connectionPool.active + redisStats.connectionPool.active,
        idle: pgStats.connectionPool.idle + redisStats.connectionPool.idle,
        total: pgStats.connectionPool.total + redisStats.connectionPool.total
      },
      performance: {
        avgQueryTime: (pgStats.performance.avgQueryTime + redisStats.performance.avgQueryTime) / 2,
        slowQueries: pgStats.performance.slowQueries + redisStats.performance.slowQueries,
        cacheHitRate: this.cacheStrategy.getHitRate()
      }
    };
  }

  // Transaction support - delegate to PostgreSQL for ACID compliance
  async beginTransaction(): Promise<PersistenceTransaction> {
    return await this.postgres.beginTransaction();
  }

  // Private helper methods
  private async syncRelayToCache(id: string): Promise<void> {
    try {
      const relay = await this.postgres.getRelay(id);
      if (relay) {
        await this.redis.saveRelay(relay);
      }
    } catch (error) {
      this.logger.warn({ error, relayId: id }, 'Failed to sync relay to cache');
    }
  }

  private cacheRelayInBackground(relay: PendingRelay): void {
    this.redis.saveRelay(relay).catch(err =>
      this.logger.warn({ error: err, relayId: relay.id }, 'Failed to cache relay')
    );
  }

  private cacheRelaysInBackground(relays: PendingRelay[]): void {
    relays.forEach(relay => this.cacheRelayInBackground(relay));
  }

  private setupEventHandlers(): void {
    // Forward events from both providers
    this.postgres.on('error', (error) => this.emit('error', error));
    this.redis.on('error', (error) => this.emit('error', error));
    
    this.postgres.on('slow_query', (query, duration) => this.emit('slow_query', query, duration));
    
    this.postgres.on('relay_saved', (relay) => this.emit('relay_saved', relay));
    this.postgres.on('relay_updated', (id, updates) => this.emit('relay_updated', id, updates));
    
    this.postgres.on('cleanup_completed', (count) => this.emit('cleanup_completed', count));
  }
}

/**
 * Cache strategy for tracking hit/miss rates and optimizing cache usage
 */
class CacheStrategy {
  private hits: Map<string, number> = new Map();
  private misses: Map<string, number> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'CacheStrategy' });
  }

  recordHit(type: string): void {
    this.hits.set(type, (this.hits.get(type) || 0) + 1);
  }

  recordMiss(type: string): void {
    this.misses.set(type, (this.misses.get(type) || 0) + 1);
  }

  getHitRate(type?: string): number {
    if (type) {
      const hits = this.hits.get(type) || 0;
      const misses = this.misses.get(type) || 0;
      const total = hits + misses;
      return total > 0 ? hits / total : 0;
    }

    // Overall hit rate
    const totalHits = Array.from(this.hits.values()).reduce((sum, count) => sum + count, 0);
    const totalMisses = Array.from(this.misses.values()).reduce((sum, count) => sum + count, 0);
    const total = totalHits + totalMisses;
    
    return total > 0 ? totalHits / total : 0;
  }

  getStats(): Record<string, { hits: number; misses: number; hitRate: number }> {
    const stats: Record<string, { hits: number; misses: number; hitRate: number }> = {};
    
    const allTypes = new Set([...this.hits.keys(), ...this.misses.keys()]);
    
    for (const type of allTypes) {
      const hits = this.hits.get(type) || 0;
      const misses = this.misses.get(type) || 0;
      const total = hits + misses;
      
      stats[type] = {
        hits,
        misses,
        hitRate: total > 0 ? hits / total : 0
      };
    }
    
    return stats;
  }

  logStats(): void {
    const stats = this.getStats();
    const overallHitRate = this.getHitRate();
    
    this.logger.info({
      overallHitRate,
      typeStats: stats
    }, 'Cache performance statistics');
  }
}
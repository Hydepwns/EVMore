/**
 * Redis persistence provider for the 1inch Fusion+ Cosmos Relayer
 * 
 * Provides high-performance caching and session storage with Redis.
 * Complements PostgreSQL for fast lookups and temporary state storage.
 */

import Redis from 'ioredis';
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
  RelayStatus,
  AttemptStatus,
  ChainStatus
} from './types';

export class RedisPersistenceProvider extends EventEmitter implements PersistenceProvider {
  private redis: Redis;
  private logger: Logger;
  private config: PersistenceConfig;
  private keyPrefix: string;
  private isInitialized: boolean = false;

  constructor(config: PersistenceConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'RedisPersistence' });

    if (!config.redis) {
      throw new Error('Redis configuration is required');
    }

    this.keyPrefix = config.redis.keyPrefix || 'fusion:';

    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db || 0,
      enableOfflineQueue: config.redis.enableOfflineQueue ?? true,
      lazyConnect: true,
      connectionName: 'fusion-relayer'
    });

    this.setupEventHandlers();
  }

  async connect(): Promise<void> {
    try {
      await this.redis.connect();
      
      // Test connection
      await this.redis.ping();
      
      this.isInitialized = true;
      this.emit('connected');
      this.logger.info('Redis persistence provider connected');
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to Redis');
      this.emit('error', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.isInitialized = false;
      this.emit('disconnected');
      this.logger.info('Redis persistence provider disconnected');
    }
  }

  isConnected(): boolean {
    return this.isInitialized && this.redis.status === 'ready';
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.warn({ error }, 'Redis ping failed');
      return false;
    }
  }

  // Relay management
  async saveRelay(relay: PendingRelay): Promise<void> {
    const key = this.getRelayKey(relay.id);
    const data = JSON.stringify(relay);
    
    // Use pipeline for atomic operations
    const pipeline = this.redis.pipeline();
    
    // Store relay data
    pipeline.set(key, data);
    
    // Add to status-based sets for efficient queries
    pipeline.sadd(this.getRelayStatusKey(relay.status), relay.id);
    
    // Add to pending set if applicable
    if (['pending', 'routing', 'executing', 'confirming'].includes(relay.status)) {
      pipeline.sadd(this.getPendingRelaysKey(), relay.id);
    }
    
    // Set TTL for completed/failed relays (24 hours)
    if (['completed', 'failed', 'expired', 'refunded'].includes(relay.status)) {
      pipeline.expire(key, 86400);
    }
    
    await pipeline.exec();
    this.emit('relay_saved', relay);
  }

  async updateRelay(id: string, updates: Partial<PendingRelay>): Promise<void> {
    const key = this.getRelayKey(id);
    const existingData = await this.redis.get(key);
    
    if (!existingData) {
      throw new Error(`Relay ${id} not found`);
    }
    
    const existing: PendingRelay = JSON.parse(existingData);
    const updated: PendingRelay = {
      ...existing,
      ...updates,
      updatedAt: new Date()
    };
    
    const pipeline = this.redis.pipeline();
    
    // Update relay data
    pipeline.set(key, JSON.stringify(updated));
    
    // Update status-based sets if status changed
    if (updates.status && updates.status !== existing.status) {
      pipeline.srem(this.getRelayStatusKey(existing.status), id);
      pipeline.sadd(this.getRelayStatusKey(updated.status), id);
      
      // Update pending set
      if (['pending', 'routing', 'executing', 'confirming'].includes(updated.status)) {
        pipeline.sadd(this.getPendingRelaysKey(), id);
      } else {
        pipeline.srem(this.getPendingRelaysKey(), id);
      }
    }
    
    await pipeline.exec();
    this.emit('relay_updated', id, updates);
  }

  async getRelay(id: string): Promise<PendingRelay | null> {
    const key = this.getRelayKey(id);
    const data = await this.redis.get(key);
    
    if (!data) {
      return null;
    }
    
    const relay = JSON.parse(data);
    // Parse dates back from JSON
    relay.createdAt = new Date(relay.createdAt);
    relay.updatedAt = new Date(relay.updatedAt);
    
    return relay;
  }

  async listPendingRelays(limit = 100): Promise<PendingRelay[]> {
    const relayIds = await this.redis.smembers(this.getPendingRelaysKey());
    const limitedIds = relayIds.slice(0, limit);
    
    if (limitedIds.length === 0) {
      return [];
    }
    
    const keys = limitedIds.map(id => this.getRelayKey(id));
    const data = await this.redis.mget(...keys);
    
    return data
      .filter(item => item !== null)
      .map(item => {
        const relay = JSON.parse(item!);
        relay.createdAt = new Date(relay.createdAt);
        relay.updatedAt = new Date(relay.updatedAt);
        return relay;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async listRelaysByStatus(status: RelayStatus, limit = 100): Promise<PendingRelay[]> {
    const relayIds = await this.redis.smembers(this.getRelayStatusKey(status));
    const limitedIds = relayIds.slice(0, limit);
    
    if (limitedIds.length === 0) {
      return [];
    }
    
    const keys = limitedIds.map(id => this.getRelayKey(id));
    const data = await this.redis.mget(...keys);
    
    return data
      .filter(item => item !== null)
      .map(item => {
        const relay = JSON.parse(item!);
        relay.createdAt = new Date(relay.createdAt);
        relay.updatedAt = new Date(relay.updatedAt);
        return relay;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async deleteRelay(id: string): Promise<void> {
    const relay = await this.getRelay(id);
    if (!relay) {
      return;
    }
    
    const pipeline = this.redis.pipeline();
    
    // Delete relay data
    pipeline.del(this.getRelayKey(id));
    
    // Remove from status sets
    pipeline.srem(this.getRelayStatusKey(relay.status), id);
    pipeline.srem(this.getPendingRelaysKey(), id);
    
    // Delete related attempts
    pipeline.del(this.getRelayAttemptsKey(id));
    
    await pipeline.exec();
  }

  // Relay attempt tracking
  async saveRelayAttempt(attempt: RelayAttempt): Promise<void> {
    const key = this.getRelayAttemptsKey(attempt.relayId);
    const attemptData = JSON.stringify(attempt);
    
    // Store as a list (ordered by attempt number)
    await this.redis.lpush(key, attemptData);
    
    // Set TTL (24 hours for attempts)
    await this.redis.expire(key, 86400);
  }

  async getRelayAttempts(relayId: string): Promise<RelayAttempt[]> {
    const key = this.getRelayAttemptsKey(relayId);
    const data = await this.redis.lrange(key, 0, -1);
    
    return data
      .map(item => {
        const attempt = JSON.parse(item);
        attempt.startedAt = new Date(attempt.startedAt);
        if (attempt.completedAt) {
          attempt.completedAt = new Date(attempt.completedAt);
        }
        return attempt;
      })
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
  }

  async updateRelayAttempt(id: string, updates: Partial<RelayAttempt>): Promise<void> {
    // For Redis implementation, we need the relay ID to find the attempt
    // This is less efficient than PostgreSQL - consider using a separate key per attempt
    throw new Error('Redis updateRelayAttempt not implemented - use saveRelayAttempt instead');
  }

  // Chain state management
  async saveChainState(state: ChainState): Promise<void> {
    const key = this.getChainStateKey(state.chainId);
    const data = JSON.stringify(state);
    await this.redis.set(key, data);
  }

  async getChainState(chainId: string): Promise<ChainState | null> {
    const key = this.getChainStateKey(chainId);
    const data = await this.redis.get(key);
    
    if (!data) {
      return null;
    }
    
    const state = JSON.parse(data);
    state.lastUpdated = new Date(state.lastUpdated);
    return state;
  }

  async listChainStates(): Promise<ChainState[]> {
    const keys = await this.redis.keys(this.getChainStateKey('*'));
    
    if (keys.length === 0) {
      return [];
    }
    
    const data = await this.redis.mget(...keys);
    
    return data
      .filter(item => item !== null)
      .map(item => {
        const state = JSON.parse(item!);
        state.lastUpdated = new Date(state.lastUpdated);
        return state;
      })
      .sort((a, b) => a.chainId.localeCompare(b.chainId));
  }

  async updateChainState(chainId: string, updates: Partial<ChainState>): Promise<void> {
    const key = this.getChainStateKey(chainId);
    const existingData = await this.redis.get(key);
    
    if (!existingData) {
      throw new Error(`Chain state ${chainId} not found`);
    }
    
    const existing: ChainState = JSON.parse(existingData);
    const updated: ChainState = {
      ...existing,
      ...updates,
      lastUpdated: new Date()
    };
    
    await this.redis.set(key, JSON.stringify(updated));
  }

  // Circuit breaker state
  async saveCircuitBreakerState(state: CircuitBreakerState): Promise<void> {
    const key = this.getCircuitBreakerKey(state.name);
    const data = JSON.stringify(state);
    await this.redis.set(key, data);
  }

  async getCircuitBreakerState(name: string): Promise<CircuitBreakerState | null> {
    const key = this.getCircuitBreakerKey(name);
    const data = await this.redis.get(key);
    
    if (!data) {
      return null;
    }
    
    const state = JSON.parse(data);
    if (state.lastFailureTime) state.lastFailureTime = new Date(state.lastFailureTime);
    if (state.lastSuccessTime) state.lastSuccessTime = new Date(state.lastSuccessTime);
    if (state.nextAttempt) state.nextAttempt = new Date(state.nextAttempt);
    state.updatedAt = new Date(state.updatedAt);
    
    return state;
  }

  async listCircuitBreakerStates(): Promise<CircuitBreakerState[]> {
    const keys = await this.redis.keys(this.getCircuitBreakerKey('*'));
    
    if (keys.length === 0) {
      return [];
    }
    
    const data = await this.redis.mget(...keys);
    
    return data
      .filter(item => item !== null)
      .map(item => {
        const state = JSON.parse(item!);
        if (state.lastFailureTime) state.lastFailureTime = new Date(state.lastFailureTime);
        if (state.lastSuccessTime) state.lastSuccessTime = new Date(state.lastSuccessTime);
        if (state.nextAttempt) state.nextAttempt = new Date(state.nextAttempt);
        state.updatedAt = new Date(state.updatedAt);
        return state;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateCircuitBreakerState(name: string, updates: Partial<CircuitBreakerState>): Promise<void> {
    const key = this.getCircuitBreakerKey(name);
    const existingData = await this.redis.get(key);
    
    if (!existingData) {
      throw new Error(`Circuit breaker state ${name} not found`);
    }
    
    const existing: CircuitBreakerState = JSON.parse(existingData);
    const updated: CircuitBreakerState = {
      ...existing,
      ...updates,
      updatedAt: new Date()
    };
    
    await this.redis.set(key, JSON.stringify(updated));
  }

  // Metrics and monitoring
  async saveMetricsSnapshot(snapshot: MetricsSnapshot): Promise<void> {
    const key = this.getMetricsSnapshotKey(snapshot.id);
    const data = JSON.stringify(snapshot);
    
    // Store snapshot
    await this.redis.set(key, data);
    
    // Add to sorted set for time-based queries
    const timestamp = snapshot.timestamp.getTime();
    await this.redis.zadd(this.getMetricsTimelineKey(), timestamp, snapshot.id);
    
    // Set TTL (7 days for metrics)
    await this.redis.expire(key, 604800);
  }

  async getLatestMetricsSnapshot(): Promise<MetricsSnapshot | null> {
    // Get latest from sorted set
    const results = await this.redis.zrevrange(this.getMetricsTimelineKey(), 0, 0);
    
    if (results.length === 0) {
      return null;
    }
    
    const key = this.getMetricsSnapshotKey(results[0]);
    const data = await this.redis.get(key);
    
    if (!data) {
      return null;
    }
    
    const snapshot = JSON.parse(data);
    snapshot.timestamp = new Date(snapshot.timestamp);
    return snapshot;
  }

  async getMetricsHistory(fromTime: Date, toTime: Date): Promise<MetricsSnapshot[]> {
    const fromScore = fromTime.getTime();
    const toScore = toTime.getTime();
    
    // Get snapshot IDs within time range
    const snapshotIds = await this.redis.zrangebyscore(
      this.getMetricsTimelineKey(),
      fromScore,
      toScore
    );
    
    if (snapshotIds.length === 0) {
      return [];
    }
    
    const keys = snapshotIds.map(id => this.getMetricsSnapshotKey(id));
    const data = await this.redis.mget(...keys);
    
    return data
      .filter(item => item !== null)
      .map(item => {
        const snapshot = JSON.parse(item!);
        snapshot.timestamp = new Date(snapshot.timestamp);
        return snapshot;
      })
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // Maintenance operations
  async cleanup(retentionPeriod: number): Promise<number> {
    const cutoffTime = Date.now() - retentionPeriod;
    let cleaned = 0;
    
    // Clean up old metrics snapshots
    const oldSnapshots = await this.redis.zrangebyscore(
      this.getMetricsTimelineKey(),
      '-inf',
      cutoffTime
    );
    
    if (oldSnapshots.length > 0) {
      const pipeline = this.redis.pipeline();
      
      // Remove from timeline
      pipeline.zremrangebyscore(this.getMetricsTimelineKey(), '-inf', cutoffTime);
      
      // Delete snapshot data
      for (const snapshotId of oldSnapshots) {
        pipeline.del(this.getMetricsSnapshotKey(snapshotId));
      }
      
      await pipeline.exec();
      cleaned += oldSnapshots.length;
    }
    
    // Clean up completed/failed relays (Redis handles this via TTL)
    
    this.emit('cleanup_completed', cleaned);
    this.logger.info({ recordsRemoved: cleaned }, 'Redis cleanup completed');
    
    return cleaned;
  }

  async vacuum(): Promise<void> {
    // Redis doesn't need vacuum like PostgreSQL
    // Could implement memory optimization here if needed
    this.logger.info('Redis vacuum completed (no-op)');
  }

  async getStats(): Promise<PersistenceStats> {
    const info = await this.redis.info('memory');
    const memoryInfo = this.parseRedisInfo(info);
    
    // Count keys by pattern
    const relayKeys = await this.redis.keys(this.getRelayKey('*'));
    const pendingCount = await this.redis.scard(this.getPendingRelaysKey());
    
    const statusCounts = await Promise.all([
      this.redis.scard(this.getRelayStatusKey(RelayStatus.COMPLETED)),
      this.redis.scard(this.getRelayStatusKey(RelayStatus.FAILED)),
      this.redis.scard(this.getRelayStatusKey(RelayStatus.EXPIRED))
    ]);
    
    return {
      totalRelays: relayKeys.length,
      pendingRelays: pendingCount,
      completedRelays: statusCounts[0],
      failedRelays: statusCounts[1] + statusCounts[2],
      totalAttempts: 0, // Would need to count all attempt lists
      databaseSize: parseInt(memoryInfo.used_memory || '0'),
      connectionPool: {
        active: 1, // Redis single connection
        idle: 0,
        total: 1
      },
      performance: {
        avgQueryTime: 0, // Would need monitoring to implement
        slowQueries: 0,
        cacheHitRate: parseFloat(memoryInfo.keyspace_hit_rate || '0')
      }
    };
  }

  // Key generation helpers
  private getRelayKey(id: string): string {
    return `${this.keyPrefix}relay:${id}`;
  }

  private getRelayStatusKey(status: RelayStatus): string {
    return `${this.keyPrefix}relay:status:${status}`;
  }

  private getPendingRelaysKey(): string {
    return `${this.keyPrefix}relay:pending`;
  }

  private getRelayAttemptsKey(relayId: string): string {
    return `${this.keyPrefix}relay:${relayId}:attempts`;
  }

  private getChainStateKey(chainId: string): string {
    return `${this.keyPrefix}chain:${chainId}`;
  }

  private getCircuitBreakerKey(name: string): string {
    return `${this.keyPrefix}circuit:${name}`;
  }

  private getMetricsSnapshotKey(id: string): string {
    return `${this.keyPrefix}metrics:${id}`;
  }

  private getMetricsTimelineKey(): string {
    return `${this.keyPrefix}metrics:timeline`;
  }

  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      this.logger.debug('Redis connected');
    });

    this.redis.on('ready', () => {
      this.logger.debug('Redis ready');
    });

    this.redis.on('error', (error) => {
      this.logger.error({ error }, 'Redis error');
      this.emit('error', error);
    });

    this.redis.on('close', () => {
      this.logger.debug('Redis connection closed');
    });

    this.redis.on('reconnecting', (delay) => {
      this.logger.info({ delay }, 'Redis reconnecting');
    });

    this.redis.on('end', () => {
      this.logger.debug('Redis connection ended');
    });
  }

  private parseRedisInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = info.split('\r\n');
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    }
    
    return result;
  }
}

/**
 * Redis doesn't support transactions in the same way as PostgreSQL,
 * but we can use MULTI/EXEC for atomic operations
 */
export class RedisTransaction implements PersistenceTransaction {
  private redis: Redis;
  private logger: Logger;
  private pipeline: any;
  private isExecuted: boolean = false;

  constructor(redis: Redis, logger: Logger) {
    this.redis = redis;
    this.logger = logger.child({ component: 'RedisTransaction' });
    this.pipeline = redis.multi();
  }

  async saveRelay(relay: PendingRelay): Promise<void> {
    this.checkTransactionState();
    
    const key = `fusion:relay:${relay.id}`;
    const data = JSON.stringify(relay);
    
    this.pipeline.set(key, data);
    this.pipeline.sadd(`fusion:relay:status:${relay.status}`, relay.id);
    
    if (['pending', 'routing', 'executing', 'confirming'].includes(relay.status)) {
      this.pipeline.sadd('fusion:relay:pending', relay.id);
    }
  }

  async updateRelay(id: string, updates: Partial<PendingRelay>): Promise<void> {
    this.checkTransactionState();
    
    // Note: Redis transactions don't support reading within the transaction
    // This is a limitation compared to PostgreSQL
    throw new Error('Redis updateRelay in transaction requires the full relay object');
  }

  async saveRelayAttempt(attempt: RelayAttempt): Promise<void> {
    this.checkTransactionState();
    
    const key = `fusion:relay:${attempt.relayId}:attempts`;
    const attemptData = JSON.stringify(attempt);
    
    this.pipeline.lpush(key, attemptData);
    this.pipeline.expire(key, 86400);
  }

  async updateChainState(chainId: string, updates: Partial<ChainState>): Promise<void> {
    this.checkTransactionState();
    
    // Similar limitation as updateRelay
    throw new Error('Redis updateChainState in transaction requires the full state object');
  }

  async commit(): Promise<void> {
    if (this.isExecuted) {
      throw new Error('Transaction already executed');
    }

    await this.pipeline.exec();
    this.isExecuted = true;
    this.logger.debug('Redis transaction committed');
  }

  async rollback(): Promise<void> {
    if (this.isExecuted) {
      throw new Error('Transaction already executed');
    }

    this.pipeline.discard();
    this.isExecuted = true;
    this.logger.debug('Redis transaction rolled back');
  }

  private checkTransactionState(): void {
    if (this.isExecuted) {
      throw new Error('Cannot execute operations on finalized transaction');
    }
  }
}
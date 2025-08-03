/**
 * PostgreSQL persistence provider for the 1inch Fusion+ Cosmos Relayer
 * 
 * Provides ACID-compliant persistence with WAL support for high-throughput
 * cross-chain relay operations.
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
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

export class PostgresPersistenceProvider extends EventEmitter implements PersistenceProvider {
  private pool: Pool;
  private logger: Logger;
  private config: PersistenceConfig;
  private isInitialized: boolean = false;

  constructor(config: PersistenceConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'PostgresPersistence' });

    if (!config.postgres) {
      throw new Error('PostgreSQL configuration is required');
    }

    const poolConfig: PoolConfig = {
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.username,
      password: config.postgres.password,
      ssl: config.postgres.ssl,
      max: config.postgres.maxConnections || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: config.postgres.connectionTimeout || 5000,
    };

    this.pool = new Pool(poolConfig);
    this.setupEventHandlers();
  }

  async connect(): Promise<void> {
    try {
      // Test connection
      const client = await this.pool.connect();
      client.release();
      
      // Initialize database schema
      await this.initializeSchema();
      
      this.isInitialized = true;
      this.emit('connected');
      this.logger.info('PostgreSQL persistence provider connected');
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to PostgreSQL');
      this.emit('error', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.isInitialized = false;
      this.emit('disconnected');
      this.logger.info('PostgreSQL persistence provider disconnected');
    }
  }

  isConnected(): boolean {
    return this.isInitialized && !this.pool.ended;
  }

  async ping(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch (error) {
      this.logger.warn({ error }, 'PostgreSQL ping failed');
      return false;
    }
  }

  // Relay management
  async saveRelay(relay: PendingRelay): Promise<void> {
    const query = `
      INSERT INTO pending_relays (
        id, source_chain, target_chain, htlc_id, sender, recipient,
        amount, token, hashlock, timelock, route, status, created_at,
        updated_at, retry_count, last_error, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at,
        retry_count = EXCLUDED.retry_count,
        last_error = EXCLUDED.last_error,
        metadata = EXCLUDED.metadata
    `;

    const values = [
      relay.id,
      relay.sourceChain,
      relay.targetChain,
      relay.htlcId,
      relay.sender,
      relay.recipient,
      relay.amount,
      relay.token,
      relay.hashlock,
      relay.timelock,
      relay.route,
      relay.status,
      relay.createdAt,
      relay.updatedAt,
      relay.retryCount,
      relay.lastError,
      relay.metadata
    ];

    await this.executeQuery(query, values);
    this.emit('relay_saved', relay);
  }

  async updateRelay(id: string, updates: Partial<PendingRelay>): Promise<void> {
    const setFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Always update the timestamp
    updates.updatedAt = new Date();

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const columnName = this.camelToSnake(key);
        setFields.push(`${columnName} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setFields.length === 0) {
      return;
    }

    const query = `
      UPDATE pending_relays 
      SET ${setFields.join(', ')}
      WHERE id = $${paramIndex}
    `;
    values.push(id);

    await this.executeQuery(query, values);
    this.emit('relay_updated', id, updates);
  }

  async getRelay(id: string): Promise<PendingRelay | null> {
    const query = 'SELECT * FROM pending_relays WHERE id = $1';
    const result = await this.executeQuery(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRelay(result.rows[0]);
  }

  async listPendingRelays(limit = 100): Promise<PendingRelay[]> {
    const query = `
      SELECT * FROM pending_relays 
      WHERE status IN ('pending', 'routing', 'executing', 'confirming')
      ORDER BY created_at ASC
      LIMIT $1
    `;
    const result = await this.executeQuery(query, [limit]);
    return result.rows.map(row => this.mapRowToRelay(row));
  }

  async listRelaysByStatus(status: RelayStatus, limit = 100): Promise<PendingRelay[]> {
    const query = `
      SELECT * FROM pending_relays 
      WHERE status = $1
      ORDER BY created_at ASC
      LIMIT $2
    `;
    const result = await this.executeQuery(query, [status, limit]);
    return result.rows.map(row => this.mapRowToRelay(row));
  }

  async deleteRelay(id: string): Promise<void> {
    // Delete attempts first due to foreign key constraint
    await this.executeQuery('DELETE FROM relay_attempts WHERE relay_id = $1', [id]);
    await this.executeQuery('DELETE FROM pending_relays WHERE id = $1', [id]);
  }

  // Relay attempt tracking
  async saveRelayAttempt(attempt: RelayAttempt): Promise<void> {
    const query = `
      INSERT INTO relay_attempts (
        id, relay_id, attempt_number, action, status, started_at,
        completed_at, tx_hash, error_message, gas_used, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    const values = [
      attempt.id,
      attempt.relayId,
      attempt.attemptNumber,
      attempt.action,
      attempt.status,
      attempt.startedAt,
      attempt.completedAt,
      attempt.txHash,
      attempt.errorMessage,
      attempt.gasUsed,
      attempt.metadata
    ];

    await this.executeQuery(query, values);
  }

  async getRelayAttempts(relayId: string): Promise<RelayAttempt[]> {
    const query = `
      SELECT * FROM relay_attempts 
      WHERE relay_id = $1 
      ORDER BY attempt_number ASC
    `;
    const result = await this.executeQuery(query, [relayId]);
    return result.rows.map(row => this.mapRowToAttempt(row));
  }

  async updateRelayAttempt(id: string, updates: Partial<RelayAttempt>): Promise<void> {
    const setFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const columnName = this.camelToSnake(key);
        setFields.push(`${columnName} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setFields.length === 0) {
      return;
    }

    const query = `
      UPDATE relay_attempts 
      SET ${setFields.join(', ')}
      WHERE id = $${paramIndex}
    `;
    values.push(id);

    await this.executeQuery(query, values);
  }

  // Chain state management
  async saveChainState(state: ChainState): Promise<void> {
    const query = `
      INSERT INTO chain_states (
        chain_id, last_processed_block, last_processed_height, 
        status, last_updated, error_count, last_error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (chain_id) DO UPDATE SET
        last_processed_block = EXCLUDED.last_processed_block,
        last_processed_height = EXCLUDED.last_processed_height,
        status = EXCLUDED.status,
        last_updated = EXCLUDED.last_updated,
        error_count = EXCLUDED.error_count,
        last_error = EXCLUDED.last_error
    `;

    const values = [
      state.chainId,
      state.lastProcessedBlock,
      state.lastProcessedHeight,
      state.status,
      state.lastUpdated,
      state.errorCount,
      state.lastError
    ];

    await this.executeQuery(query, values);
  }

  async getChainState(chainId: string): Promise<ChainState | null> {
    const query = 'SELECT * FROM chain_states WHERE chain_id = $1';
    const result = await this.executeQuery(query, [chainId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToChainState(result.rows[0]);
  }

  async listChainStates(): Promise<ChainState[]> {
    const query = 'SELECT * FROM chain_states ORDER BY chain_id';
    const result = await this.executeQuery(query, []);
    return result.rows.map(row => this.mapRowToChainState(row));
  }

  async updateChainState(chainId: string, updates: Partial<ChainState>): Promise<void> {
    const setFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Always update the timestamp
    updates.lastUpdated = new Date();

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const columnName = this.camelToSnake(key);
        setFields.push(`${columnName} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setFields.length === 0) {
      return;
    }

    const query = `
      UPDATE chain_states 
      SET ${setFields.join(', ')}
      WHERE chain_id = $${paramIndex}
    `;
    values.push(chainId);

    await this.executeQuery(query, values);
  }

  // Circuit breaker state
  async saveCircuitBreakerState(state: CircuitBreakerState): Promise<void> {
    const query = `
      INSERT INTO circuit_breaker_states (
        name, state, failures, successes, last_failure_time,
        last_success_time, next_attempt, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (name) DO UPDATE SET
        state = EXCLUDED.state,
        failures = EXCLUDED.failures,
        successes = EXCLUDED.successes,
        last_failure_time = EXCLUDED.last_failure_time,
        last_success_time = EXCLUDED.last_success_time,
        next_attempt = EXCLUDED.next_attempt,
        updated_at = EXCLUDED.updated_at
    `;

    const values = [
      state.name,
      state.state,
      state.failures,
      state.successes,
      state.lastFailureTime,
      state.lastSuccessTime,
      state.nextAttempt,
      state.updatedAt
    ];

    await this.executeQuery(query, values);
  }

  async getCircuitBreakerState(name: string): Promise<CircuitBreakerState | null> {
    const query = 'SELECT * FROM circuit_breaker_states WHERE name = $1';
    const result = await this.executeQuery(query, [name]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToCircuitBreakerState(result.rows[0]);
  }

  async listCircuitBreakerStates(): Promise<CircuitBreakerState[]> {
    const query = 'SELECT * FROM circuit_breaker_states ORDER BY name';
    const result = await this.executeQuery(query, []);
    return result.rows.map(row => this.mapRowToCircuitBreakerState(row));
  }

  async updateCircuitBreakerState(name: string, updates: Partial<CircuitBreakerState>): Promise<void> {
    const setFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Always update the timestamp
    updates.updatedAt = new Date();

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const columnName = this.camelToSnake(key);
        setFields.push(`${columnName} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setFields.length === 0) {
      return;
    }

    const query = `
      UPDATE circuit_breaker_states 
      SET ${setFields.join(', ')}
      WHERE name = $${paramIndex}
    `;
    values.push(name);

    await this.executeQuery(query, values);
  }

  // Metrics and monitoring
  async saveMetricsSnapshot(snapshot: MetricsSnapshot): Promise<void> {
    const query = `
      INSERT INTO metrics_snapshots (
        id, timestamp, total_relays, successful_relays, failed_relays,
        avg_completion_time, chain_states, circuit_breaker_states, system_health
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    const values = [
      snapshot.id,
      snapshot.timestamp,
      snapshot.totalRelays,
      snapshot.successfulRelays,
      snapshot.failedRelays,
      snapshot.avgCompletionTime,
      snapshot.chainStates,
      snapshot.circuitBreakerStates,
      snapshot.systemHealth
    ];

    await this.executeQuery(query, values);
  }

  async getLatestMetricsSnapshot(): Promise<MetricsSnapshot | null> {
    const query = `
      SELECT * FROM metrics_snapshots 
      ORDER BY timestamp DESC 
      LIMIT 1
    `;
    const result = await this.executeQuery(query, []);
    
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToMetricsSnapshot(result.rows[0]);
  }

  async getMetricsHistory(fromTime: Date, toTime: Date): Promise<MetricsSnapshot[]> {
    const query = `
      SELECT * FROM metrics_snapshots 
      WHERE timestamp >= $1 AND timestamp <= $2
      ORDER BY timestamp ASC
    `;
    const result = await this.executeQuery(query, [fromTime, toTime]);
    return result.rows.map(row => this.mapRowToMetricsSnapshot(row));
  }

  // Maintenance operations
  async cleanup(retentionPeriod: number): Promise<number> {
    const cutoffTime = new Date(Date.now() - retentionPeriod);
    
    // Clean up completed/failed relays older than retention period
    const relayCleanupQuery = `
      DELETE FROM pending_relays 
      WHERE status IN ('completed', 'failed', 'expired', 'refunded')
      AND updated_at < $1
    `;
    const relayResult = await this.executeQuery(relayCleanupQuery, [cutoffTime]);
    
    // Clean up old metrics snapshots
    const metricsCleanupQuery = `
      DELETE FROM metrics_snapshots 
      WHERE timestamp < $1
    `;
    const metricsResult = await this.executeQuery(metricsCleanupQuery, [cutoffTime]);
    
    const totalCleaned = (relayResult.rowCount || 0) + (metricsResult.rowCount || 0);
    
    this.emit('cleanup_completed', totalCleaned);
    this.logger.info({ recordsRemoved: totalCleaned }, 'Database cleanup completed');
    
    return totalCleaned;
  }

  async vacuum(): Promise<void> {
    // Run VACUUM ANALYZE to optimize database performance
    await this.executeQuery('VACUUM ANALYZE', []);
    this.logger.info('Database vacuum completed');
  }

  async getStats(): Promise<PersistenceStats> {
    const queries = [
      'SELECT COUNT(*) as total FROM pending_relays',
      'SELECT COUNT(*) as pending FROM pending_relays WHERE status IN (\'pending\', \'routing\', \'executing\', \'confirming\')',
      'SELECT COUNT(*) as completed FROM pending_relays WHERE status = \'completed\'',
      'SELECT COUNT(*) as failed FROM pending_relays WHERE status IN (\'failed\', \'expired\')',
      'SELECT COUNT(*) as attempts FROM relay_attempts',
      'SELECT pg_database_size(current_database()) as size'
    ];

    const results = await Promise.all(
      queries.map(query => this.executeQuery(query, []))
    );

    return {
      totalRelays: parseInt(results[0].rows[0].total),
      pendingRelays: parseInt(results[1].rows[0].pending),
      completedRelays: parseInt(results[2].rows[0].completed),
      failedRelays: parseInt(results[3].rows[0].failed),
      totalAttempts: parseInt(results[4].rows[0].attempts),
      databaseSize: parseInt(results[5].rows[0].size),
      connectionPool: {
        active: this.pool.totalCount - this.pool.idleCount,
        idle: this.pool.idleCount,
        total: this.pool.totalCount
      },
      performance: {
        avgQueryTime: 0, // Would need query monitoring to implement
        slowQueries: 0
      }
    };
  }

  // Transaction support
  async beginTransaction(): Promise<PostgresTransaction> {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    return new PostgresTransaction(client, this.logger);
  }

  // Private helper methods
  private async initializeSchema(): Promise<void> {
    const schemas = [
      // Pending relays table
      `CREATE TABLE IF NOT EXISTS pending_relays (
        id VARCHAR(255) PRIMARY KEY,
        source_chain VARCHAR(100) NOT NULL,
        target_chain VARCHAR(100) NOT NULL,
        htlc_id VARCHAR(255) NOT NULL,
        sender VARCHAR(255) NOT NULL,
        recipient VARCHAR(255) NOT NULL,
        amount VARCHAR(100) NOT NULL,
        token VARCHAR(255) NOT NULL,
        hashlock VARCHAR(255) NOT NULL,
        timelock BIGINT NOT NULL,
        route TEXT NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        metadata TEXT
      )`,

      // Relay attempts table
      `CREATE TABLE IF NOT EXISTS relay_attempts (
        id VARCHAR(255) PRIMARY KEY,
        relay_id VARCHAR(255) NOT NULL REFERENCES pending_relays(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        action VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        started_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP,
        tx_hash VARCHAR(255),
        error_message TEXT,
        gas_used VARCHAR(100),
        metadata TEXT
      )`,

      // Chain states table
      `CREATE TABLE IF NOT EXISTS chain_states (
        chain_id VARCHAR(100) PRIMARY KEY,
        last_processed_block BIGINT DEFAULT 0,
        last_processed_height BIGINT DEFAULT 0,
        status VARCHAR(50) NOT NULL,
        last_updated TIMESTAMP NOT NULL,
        error_count INTEGER DEFAULT 0,
        last_error TEXT
      )`,

      // Circuit breaker states table
      `CREATE TABLE IF NOT EXISTS circuit_breaker_states (
        name VARCHAR(100) PRIMARY KEY,
        state VARCHAR(20) NOT NULL,
        failures INTEGER DEFAULT 0,
        successes INTEGER DEFAULT 0,
        last_failure_time TIMESTAMP,
        last_success_time TIMESTAMP,
        next_attempt TIMESTAMP,
        updated_at TIMESTAMP NOT NULL
      )`,

      // Metrics snapshots table
      `CREATE TABLE IF NOT EXISTS metrics_snapshots (
        id VARCHAR(255) PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        total_relays INTEGER NOT NULL,
        successful_relays INTEGER NOT NULL,
        failed_relays INTEGER NOT NULL,
        avg_completion_time FLOAT NOT NULL,
        chain_states TEXT NOT NULL,
        circuit_breaker_states TEXT NOT NULL,
        system_health FLOAT NOT NULL
      )`
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_pending_relays_status ON pending_relays(status)',
      'CREATE INDEX IF NOT EXISTS idx_pending_relays_created_at ON pending_relays(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_relay_attempts_relay_id ON relay_attempts(relay_id)',
      'CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_timestamp ON metrics_snapshots(timestamp)'
    ];

    for (const schema of schemas) {
      await this.executeQuery(schema, []);
    }

    for (const index of indexes) {
      await this.executeQuery(index, []);
    }

    this.logger.info('PostgreSQL schema initialized');
  }

  private async executeQuery(query: string, params: any[]): Promise<any> {
    const start = Date.now();
    try {
      const result = await this.pool.query(query, params);
      const duration = Date.now() - start;
      
      if (duration > 1000) { // Log slow queries
        this.emit('slow_query', query, duration);
        this.logger.warn({ query, duration, params }, 'Slow query detected');
      }
      
      return result;
    } catch (error) {
      this.logger.error({ error, query, params }, 'Database query failed');
      throw error;
    }
  }

  private setupEventHandlers(): void {
    this.pool.on('error', (error) => {
      this.logger.error({ error }, 'PostgreSQL pool error');
      this.emit('error', error);
    });

    this.pool.on('connect', () => {
      this.logger.debug('New PostgreSQL client connected');
    });

    this.pool.on('remove', () => {
      this.logger.debug('PostgreSQL client removed from pool');
    });
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  private mapRowToRelay(row: any): PendingRelay {
    return {
      id: row.id,
      sourceChain: row.source_chain,
      targetChain: row.target_chain,
      htlcId: row.htlc_id,
      sender: row.sender,
      recipient: row.recipient,
      amount: row.amount,
      token: row.token,
      hashlock: row.hashlock,
      timelock: row.timelock,
      route: row.route,
      status: row.status as RelayStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      retryCount: row.retry_count,
      lastError: row.last_error,
      metadata: row.metadata
    };
  }

  private mapRowToAttempt(row: any): RelayAttempt {
    return {
      id: row.id,
      relayId: row.relay_id,
      attemptNumber: row.attempt_number,
      action: row.action,
      status: row.status as AttemptStatus,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      txHash: row.tx_hash,
      errorMessage: row.error_message,
      gasUsed: row.gas_used,
      metadata: row.metadata
    };
  }

  private mapRowToChainState(row: any): ChainState {
    return {
      chainId: row.chain_id,
      lastProcessedBlock: row.last_processed_block,
      lastProcessedHeight: row.last_processed_height,
      status: row.status as ChainStatus,
      lastUpdated: row.last_updated,
      errorCount: row.error_count,
      lastError: row.last_error
    };
  }

  private mapRowToCircuitBreakerState(row: any): CircuitBreakerState {
    return {
      name: row.name,
      state: row.state as 'closed' | 'open' | 'half_open',
      failures: row.failures,
      successes: row.successes,
      lastFailureTime: row.last_failure_time,
      lastSuccessTime: row.last_success_time,
      nextAttempt: row.next_attempt,
      updatedAt: row.updated_at
    };
  }

  private mapRowToMetricsSnapshot(row: any): MetricsSnapshot {
    return {
      id: row.id,
      timestamp: row.timestamp,
      totalRelays: row.total_relays,
      successfulRelays: row.successful_relays,
      failedRelays: row.failed_relays,
      avgCompletionTime: row.avg_completion_time,
      chainStates: row.chain_states,
      circuitBreakerStates: row.circuit_breaker_states,
      systemHealth: row.system_health
    };
  }
}

/**
 * PostgreSQL transaction implementation
 */
class PostgresTransaction implements PersistenceTransaction {
  private client: PoolClient;
  private logger: Logger;
  private isCommitted: boolean = false;
  private isRolledBack: boolean = false;

  constructor(client: PoolClient, logger: Logger) {
    this.client = client;
    this.logger = logger.child({ component: 'PostgresTransaction' });
  }

  async saveRelay(relay: PendingRelay): Promise<void> {
    this.checkTransactionState();
    
    const query = `
      INSERT INTO pending_relays (
        id, source_chain, target_chain, htlc_id, sender, recipient,
        amount, token, hashlock, timelock, route, status, created_at,
        updated_at, retry_count, last_error, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `;

    const values = [
      relay.id, relay.sourceChain, relay.targetChain, relay.htlcId,
      relay.sender, relay.recipient, relay.amount, relay.token,
      relay.hashlock, relay.timelock, relay.route, relay.status,
      relay.createdAt, relay.updatedAt, relay.retryCount,
      relay.lastError, relay.metadata
    ];

    await this.client.query(query, values);
  }

  async updateRelay(id: string, updates: Partial<PendingRelay>): Promise<void> {
    this.checkTransactionState();
    
    const setFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    updates.updatedAt = new Date();

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const columnName = this.camelToSnake(key);
        setFields.push(`${columnName} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setFields.length === 0) {
      return;
    }

    const query = `
      UPDATE pending_relays 
      SET ${setFields.join(', ')}
      WHERE id = $${paramIndex}
    `;
    values.push(id);

    await this.client.query(query, values);
  }

  async saveRelayAttempt(attempt: RelayAttempt): Promise<void> {
    this.checkTransactionState();
    
    const query = `
      INSERT INTO relay_attempts (
        id, relay_id, attempt_number, action, status, started_at,
        completed_at, tx_hash, error_message, gas_used, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    const values = [
      attempt.id, attempt.relayId, attempt.attemptNumber, attempt.action,
      attempt.status, attempt.startedAt, attempt.completedAt, attempt.txHash,
      attempt.errorMessage, attempt.gasUsed, attempt.metadata
    ];

    await this.client.query(query, values);
  }

  async updateChainState(chainId: string, updates: Partial<ChainState>): Promise<void> {
    this.checkTransactionState();
    
    const setFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    updates.lastUpdated = new Date();

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const columnName = this.camelToSnake(key);
        setFields.push(`${columnName} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setFields.length === 0) {
      return;
    }

    const query = `
      UPDATE chain_states 
      SET ${setFields.join(', ')}
      WHERE chain_id = $${paramIndex}
    `;
    values.push(chainId);

    await this.client.query(query, values);
  }

  async commit(): Promise<void> {
    if (this.isCommitted || this.isRolledBack) {
      throw new Error('Transaction already finalized');
    }

    try {
      await this.client.query('COMMIT');
      this.isCommitted = true;
      this.logger.debug('Transaction committed');
    } finally {
      this.client.release();
    }
  }

  async rollback(): Promise<void> {
    if (this.isCommitted || this.isRolledBack) {
      throw new Error('Transaction already finalized');
    }

    try {
      await this.client.query('ROLLBACK');
      this.isRolledBack = true;
      this.logger.debug('Transaction rolled back');
    } finally {
      this.client.release();
    }
  }

  private checkTransactionState(): void {
    if (this.isCommitted || this.isRolledBack) {
      throw new Error('Cannot execute operations on finalized transaction');
    }
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
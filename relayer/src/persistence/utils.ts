/**
 * Persistence utility functions for the 1inch Fusion+ Cosmos Relayer
 */

import { Logger } from 'pino';
import { 
  PersistenceConfig, 
  PersistenceProvider,
  PendingRelay,
  RelayStatus,
  AttemptStatus,
  ChainStatus
} from './types';
import { 
  PersistenceManager, 
  PersistenceManagerConfig,
  PersistenceMode,
  PersistenceFactory
} from './persistence-manager';

/**
 * Create a persistence manager with environment-based configuration
 */
export function createPersistenceManager(logger: Logger): PersistenceManager {
  const config = getPersistenceConfigFromEnv();
  return PersistenceFactory.createManager(config, logger);
}

/**
 * Get persistence configuration from environment variables
 */
export function getPersistenceConfigFromEnv(): PersistenceManagerConfig {
  const mode = (process.env.PERSISTENCE_MODE || 'hybrid') as PersistenceMode;
  
  const config: PersistenceManagerConfig = {
    mode,
    healthCheckInterval: parseInt(process.env.PERSISTENCE_HEALTH_CHECK_INTERVAL || '30000'),
    autoRetry: process.env.PERSISTENCE_AUTO_RETRY !== 'false',
    maxRetries: parseInt(process.env.PERSISTENCE_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.PERSISTENCE_RETRY_DELAY || '5000'),
    gracefulDegradation: process.env.PERSISTENCE_GRACEFUL_DEGRADATION !== 'false',
    enableWAL: process.env.PERSISTENCE_ENABLE_WAL !== 'false',
    snapshotInterval: parseInt(process.env.PERSISTENCE_SNAPSHOT_INTERVAL || '60000'),
    retentionPeriod: parseInt(process.env.PERSISTENCE_RETENTION_PERIOD || '604800000'), // 7 days
    batchSize: parseInt(process.env.PERSISTENCE_BATCH_SIZE || '100')
  };

  // PostgreSQL configuration
  if (mode === 'postgres' || mode === 'hybrid') {
    config.postgres = {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DATABASE || 'fusion_relayer',
      username: process.env.POSTGRES_USERNAME || 'postgres',
      password: process.env.POSTGRES_PASSWORD || '',
      ssl: process.env.POSTGRES_SSL === 'true',
      maxConnections: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '20'),
      connectionTimeout: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT || '5000')
    };
  }

  // Redis configuration
  if (mode === 'redis' || mode === 'hybrid') {
    config.redis = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'fusion:',
      maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
      retryDelay: parseInt(process.env.REDIS_RETRY_DELAY || '100'),
      enableOfflineQueue: process.env.REDIS_ENABLE_OFFLINE_QUEUE !== 'false'
    };
  }

  return config;
}

/**
 * Get default persistence configuration for development
 */
export function getDefaultPersistenceConfig(): PersistenceManagerConfig {
  return {
    mode: 'hybrid',
    healthCheckInterval: 30000,
    autoRetry: true,
    maxRetries: 3,
    retryDelay: 5000,
    gracefulDegradation: true,
    enableWAL: true,
    snapshotInterval: 60000,
    retentionPeriod: 604800000, // 7 days
    batchSize: 100,
    postgres: {
      host: 'localhost',
      port: 5432,
      database: 'fusion_relayer_dev',
      username: 'postgres',
      password: 'postgres',
      ssl: false,
      maxConnections: 10,
      connectionTimeout: 5000
    },
    redis: {
      host: 'localhost',
      port: 6379,
      db: 0,
      keyPrefix: 'fusion:dev:',
      maxRetries: 3,
      retryDelay: 100,
      enableOfflineQueue: true
    }
  };
}

/**
 * Validate persistence configuration
 */
export function validatePersistenceConfig(config: PersistenceManagerConfig): string[] {
  const errors: string[] = [];

  if (!config.mode || !['postgres', 'redis', 'hybrid'].includes(config.mode)) {
    errors.push('Invalid or missing persistence mode');
  }

  if (config.mode === 'postgres' || config.mode === 'hybrid') {
    if (!config.postgres) {
      errors.push('PostgreSQL configuration required for postgres/hybrid mode');
    } else {
      if (!config.postgres.host) errors.push('PostgreSQL host is required');
      if (!config.postgres.port) errors.push('PostgreSQL port is required');
      if (!config.postgres.database) errors.push('PostgreSQL database is required');
      if (!config.postgres.username) errors.push('PostgreSQL username is required');
      if (config.postgres.port < 1 || config.postgres.port > 65535) {
        errors.push('PostgreSQL port must be between 1 and 65535');
      }
    }
  }

  if (config.mode === 'redis' || config.mode === 'hybrid') {
    if (!config.redis) {
      errors.push('Redis configuration required for redis/hybrid mode');
    } else {
      if (!config.redis.host) errors.push('Redis host is required');
      if (!config.redis.port) errors.push('Redis port is required');
      if (config.redis.port < 1 || config.redis.port > 65535) {
        errors.push('Redis port must be between 1 and 65535');
      }
      if (config.redis.db !== undefined && (config.redis.db < 0 || config.redis.db > 15)) {
        errors.push('Redis DB must be between 0 and 15');
      }
    }
  }

  if (config.healthCheckInterval !== undefined) {
    if (config.healthCheckInterval < 0) {
      errors.push('Health check interval must be non-negative');
    }
  }

  if (config.maxRetries !== undefined) {
    if (config.maxRetries < 0) {
      errors.push('Max retries must be non-negative');
    }
  }

  if (config.retryDelay !== undefined) {
    if (config.retryDelay < 0) {
      errors.push('Retry delay must be non-negative');
    }
  }

  if (config.retentionPeriod !== undefined) {
    if (config.retentionPeriod < 0) {
      errors.push('Retention period must be non-negative');
    }
  }

  if (config.batchSize !== undefined) {
    if (config.batchSize < 1) {
      errors.push('Batch size must be at least 1');
    }
  }

  return errors;
}

/**
 * Create a sample relay for testing
 */
export function createSampleRelay(overrides: Partial<PendingRelay> = {}): PendingRelay {
  const now = new Date();
  
  return {
    id: `relay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    sourceChain: 'ethereum',
    targetChain: 'osmosis',
    htlcId: `htlc_${Math.random().toString(36).substr(2, 16)}`,
    sender: '0x' + Math.random().toString(16).substr(2, 40),
    recipient: 'osmo1' + Math.random().toString(36).substr(2, 38),
    amount: (Math.random() * 1000).toFixed(6),
    token: 'USDC',
    hashlock: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
    timelock: Math.floor(Date.now() / 1000) + 86400, // 24 hours from now
    route: JSON.stringify({
      hops: ['ethereum', 'cosmos-hub', 'osmosis'],
      channels: ['channel-0', 'channel-1'],
      timeouts: [3600, 1800]
    }),
    status: RelayStatus.PENDING,
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    ...overrides
  };
}

/**
 * Create a database migration script for PostgreSQL
 */
export function generatePostgreSQLMigration(): string {
  return `
-- 1inch Fusion+ Cosmos Relayer Database Schema
-- Generated: ${new Date().toISOString()}

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Pending relays table
CREATE TABLE IF NOT EXISTS pending_relays (
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
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    metadata TEXT,
    
    CONSTRAINT chk_status CHECK (status IN ('pending', 'routing', 'executing', 'confirming', 'completed', 'failed', 'expired', 'refunded')),
    CONSTRAINT chk_retry_count CHECK (retry_count >= 0),
    CONSTRAINT chk_timelock CHECK (timelock > 0)
);

-- Relay attempts table
CREATE TABLE IF NOT EXISTS relay_attempts (
    id VARCHAR(255) PRIMARY KEY,
    relay_id VARCHAR(255) NOT NULL REFERENCES pending_relays(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    action VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    tx_hash VARCHAR(255),
    error_message TEXT,
    gas_used VARCHAR(100),
    metadata TEXT,
    
    CONSTRAINT chk_attempt_status CHECK (status IN ('pending', 'in_progress', 'success', 'failed', 'timeout')),
    CONSTRAINT chk_attempt_number CHECK (attempt_number > 0),
    CONSTRAINT chk_completed_after_started CHECK (completed_at IS NULL OR completed_at >= started_at),
    UNIQUE(relay_id, attempt_number)
);

-- Chain states table
CREATE TABLE IF NOT EXISTS chain_states (
    chain_id VARCHAR(100) PRIMARY KEY,
    last_processed_block BIGINT DEFAULT 0,
    last_processed_height BIGINT DEFAULT 0,
    status VARCHAR(50) NOT NULL,
    last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    
    CONSTRAINT chk_chain_status CHECK (status IN ('active', 'syncing', 'error', 'disabled')),
    CONSTRAINT chk_error_count CHECK (error_count >= 0),
    CONSTRAINT chk_processed_block CHECK (last_processed_block >= 0),
    CONSTRAINT chk_processed_height CHECK (last_processed_height >= 0)
);

-- Circuit breaker states table
CREATE TABLE IF NOT EXISTS circuit_breaker_states (
    name VARCHAR(100) PRIMARY KEY,
    state VARCHAR(20) NOT NULL,
    failures INTEGER DEFAULT 0,
    successes INTEGER DEFAULT 0,
    last_failure_time TIMESTAMP,
    last_success_time TIMESTAMP,
    next_attempt TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_breaker_state CHECK (state IN ('closed', 'open', 'half_open')),
    CONSTRAINT chk_failures CHECK (failures >= 0),
    CONSTRAINT chk_successes CHECK (successes >= 0)
);

-- Metrics snapshots table
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id VARCHAR(255) PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    total_relays INTEGER NOT NULL DEFAULT 0,
    successful_relays INTEGER NOT NULL DEFAULT 0,
    failed_relays INTEGER NOT NULL DEFAULT 0,
    avg_completion_time FLOAT NOT NULL DEFAULT 0,
    chain_states TEXT NOT NULL DEFAULT '{}',
    circuit_breaker_states TEXT NOT NULL DEFAULT '{}',
    system_health FLOAT NOT NULL DEFAULT 0,
    
    CONSTRAINT chk_total_relays CHECK (total_relays >= 0),
    CONSTRAINT chk_successful_relays CHECK (successful_relays >= 0),
    CONSTRAINT chk_failed_relays CHECK (failed_relays >= 0),
    CONSTRAINT chk_completion_time CHECK (avg_completion_time >= 0),
    CONSTRAINT chk_system_health CHECK (system_health >= 0 AND system_health <= 1)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pending_relays_status ON pending_relays(status);
CREATE INDEX IF NOT EXISTS idx_pending_relays_created_at ON pending_relays(created_at);
CREATE INDEX IF NOT EXISTS idx_pending_relays_source_chain ON pending_relays(source_chain);
CREATE INDEX IF NOT EXISTS idx_pending_relays_target_chain ON pending_relays(target_chain);
CREATE INDEX IF NOT EXISTS idx_pending_relays_timelock ON pending_relays(timelock);

CREATE INDEX IF NOT EXISTS idx_relay_attempts_relay_id ON relay_attempts(relay_id);
CREATE INDEX IF NOT EXISTS idx_relay_attempts_status ON relay_attempts(status);
CREATE INDEX IF NOT EXISTS idx_relay_attempts_started_at ON relay_attempts(started_at);

CREATE INDEX IF NOT EXISTS idx_chain_states_status ON chain_states(status);
CREATE INDEX IF NOT EXISTS idx_chain_states_last_updated ON chain_states(last_updated);

CREATE INDEX IF NOT EXISTS idx_circuit_breaker_states_state ON circuit_breaker_states(state);
CREATE INDEX IF NOT EXISTS idx_circuit_breaker_states_updated_at ON circuit_breaker_states(updated_at);

CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_timestamp ON metrics_snapshots(timestamp);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pending_relays_status_created ON pending_relays(status, created_at);
CREATE INDEX IF NOT EXISTS idx_relay_attempts_relay_status ON relay_attempts(relay_id, status);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_pending_relays_updated_at 
    BEFORE UPDATE ON pending_relays 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chain_states_updated_at 
    BEFORE UPDATE ON chain_states 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_circuit_breaker_states_updated_at 
    BEFORE UPDATE ON circuit_breaker_states 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for common queries
CREATE OR REPLACE VIEW active_relays AS
SELECT * FROM pending_relays 
WHERE status IN ('pending', 'routing', 'executing', 'confirming');

CREATE OR REPLACE VIEW relay_summary AS
SELECT 
    status,
    COUNT(*) as count,
    AVG(retry_count) as avg_retries,
    MIN(created_at) as oldest,
    MAX(created_at) as newest
FROM pending_relays 
GROUP BY status;

CREATE OR REPLACE VIEW chain_health AS
SELECT 
    chain_id,
    status,
    error_count,
    EXTRACT(EPOCH FROM (NOW() - last_updated)) as seconds_since_update,
    CASE 
        WHEN status = 'active' AND error_count = 0 THEN 'healthy'
        WHEN status = 'active' AND error_count < 5 THEN 'warning'
        ELSE 'critical'
    END as health_status
FROM chain_states;

-- Comments for documentation
COMMENT ON TABLE pending_relays IS 'Cross-chain relay operations and their current state';
COMMENT ON TABLE relay_attempts IS 'Individual attempts for each relay operation';
COMMENT ON TABLE chain_states IS 'Current processing state for each blockchain';
COMMENT ON TABLE circuit_breaker_states IS 'Circuit breaker states for fault tolerance';
COMMENT ON TABLE metrics_snapshots IS 'Historical snapshots of system metrics';

COMMENT ON COLUMN pending_relays.hashlock IS 'SHA256 hash of the secret for HTLC';
COMMENT ON COLUMN pending_relays.timelock IS 'Unix timestamp when the HTLC expires';
COMMENT ON COLUMN pending_relays.route IS 'JSON-encoded route information';
COMMENT ON COLUMN pending_relays.metadata IS 'JSON-encoded additional relay metadata';

-- Grant permissions for application user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fusion_relayer_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fusion_relayer_app;
`;
}

/**
 * Health check utility for persistence providers
 */
export async function performPersistenceHealthCheck(
  provider: PersistenceProvider,
  logger: Logger
): Promise<{
  isHealthy: boolean;
  details: {
    connection: boolean;
    readTest: boolean;
    writeTest: boolean;
    latency: number;
  };
}> {
  const startTime = Date.now();
  const details = {
    connection: false,
    readTest: false,
    writeTest: false,
    latency: 0
  };

  try {
    // Test connection
    details.connection = await provider.ping();
    
    if (details.connection) {
      // Test read operation
      try {
        await provider.listChainStates();
        details.readTest = true;
      } catch (error) {
        logger.warn({ error }, 'Read test failed during health check');
      }

      // Test write operation (with cleanup)
      try {
        const testRelay = createSampleRelay({
          id: `health_check_${Date.now()}`,
          status: RelayStatus.COMPLETED // Will be cleaned up
        });
        
        await provider.saveRelay(testRelay);
        await provider.deleteRelay(testRelay.id);
        details.writeTest = true;
      } catch (error) {
        logger.warn({ error }, 'Write test failed during health check');
      }
    }

    details.latency = Date.now() - startTime;
    const isHealthy = details.connection && details.readTest && details.writeTest;

    return { isHealthy, details };
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    details.latency = Date.now() - startTime;
    return { isHealthy: false, details };
  }
}

/**
 * Utility to calculate database storage requirements
 */
export function estimateStorageRequirements(params: {
  expectedRelaysPerDay: number;
  retentionDays: number;
  avgRouteComplexity: number; // 1-5 scale
  enableMetricsSnapshots: boolean;
  snapshotsPerDay?: number;
}): {
  estimatedSizeGB: number;
  breakdown: {
    relays: number;
    attempts: number;
    chainStates: number;
    circuitBreakers: number;
    metricsSnapshots: number;
  };
  recommendations: string[];
} {
  const {
    expectedRelaysPerDay,
    retentionDays,
    avgRouteComplexity,
    enableMetricsSnapshots,
    snapshotsPerDay = 24
  } = params;

  // Size estimates in bytes
  const avgRelaySize = 1024 + (avgRouteComplexity * 512); // Base + route complexity
  const avgAttemptSize = 512;
  const avgChainStateSize = 256;
  const avgCircuitBreakerSize = 200;
  const avgMetricsSnapshotSize = 2048;

  const totalRelays = expectedRelaysPerDay * retentionDays;
  const totalAttempts = totalRelays * (1 + avgRouteComplexity); // More complex routes = more attempts
  const chainStatesCount = 10; // Reasonable estimate
  const circuitBreakersCount = 20; // Reasonable estimate
  const totalSnapshots = enableMetricsSnapshots ? snapshotsPerDay * retentionDays : 0;

  const breakdown = {
    relays: totalRelays * avgRelaySize,
    attempts: totalAttempts * avgAttemptSize,
    chainStates: chainStatesCount * avgChainStateSize,
    circuitBreakers: circuitBreakersCount * avgCircuitBreakerSize,
    metricsSnapshots: totalSnapshots * avgMetricsSnapshotSize
  };

  const totalBytes = Object.values(breakdown).reduce((sum, size) => sum + size, 0);
  const estimatedSizeGB = totalBytes / (1024 * 1024 * 1024);

  const recommendations: string[] = [];
  
  if (estimatedSizeGB > 100) {
    recommendations.push('Consider implementing data archival for old completed relays');
  }
  
  if (totalSnapshots > 1000) {
    recommendations.push('Consider reducing metrics snapshot frequency or retention');
  }
  
  if (avgRouteComplexity > 3) {
    recommendations.push('Monitor relay attempt storage growth due to high route complexity');
  }
  
  if (estimatedSizeGB > 50) {
    recommendations.push('Enable database compression and regular VACUUM operations');
  }

  return {
    estimatedSizeGB: Math.ceil(estimatedSizeGB * 10) / 10, // Round to 1 decimal
    breakdown,
    recommendations
  };
}
-- 1inch Fusion+ Cosmos Relayer Database Setup
-- Run this script to initialize the PostgreSQL database

-- Create database and user
CREATE DATABASE fusion_relayer;
CREATE USER fusion_relayer_app WITH PASSWORD 'change_me_in_production';

-- Grant permissions
GRANT CONNECT ON DATABASE fusion_relayer TO fusion_relayer_app;

-- Connect to the database
\c fusion_relayer;

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

-- Grant permissions to application user
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fusion_relayer_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fusion_relayer_app;
GRANT EXECUTE ON FUNCTION update_updated_at_column() TO fusion_relayer_app;

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
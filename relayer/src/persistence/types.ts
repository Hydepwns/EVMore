/**
 * Database persistence types for the 1inch Fusion+ Cosmos Relayer
 * 
 * This module defines the data structures for persisting relayer state
 * across service restarts and ensuring atomic cross-chain operations.
 */

export interface PendingRelay {
  id: string;
  sourceChain: string;
  targetChain: string;
  htlcId: string;
  sender: string;
  recipient: string;
  amount: string;
  token: string;
  hashlock: string;
  timelock: number;
  route: string; // JSON serialized route data
  status: RelayStatus;
  createdAt: Date;
  updatedAt: Date;
  retryCount: number;
  lastError?: string;
  metadata?: string; // JSON serialized additional data
}

export enum RelayStatus {
  PENDING = 'pending',
  ROUTING = 'routing',
  EXECUTING = 'executing',
  CONFIRMING = 'confirming',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
  REFUNDED = 'refunded'
}

export interface RelayAttempt {
  id: string;
  relayId: string;
  attemptNumber: number;
  action: string; // 'route_discovery', 'ibc_transfer', 'dex_swap', etc.
  status: AttemptStatus;
  startedAt: Date;
  completedAt?: Date;
  txHash?: string;
  errorMessage?: string;
  gasUsed?: string;
  metadata?: string; // JSON serialized attempt-specific data
}

export enum AttemptStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  SUCCESS = 'success',
  FAILED = 'failed',
  TIMEOUT = 'timeout'
}

export interface ChainState {
  chainId: string;
  lastProcessedBlock: number;
  lastProcessedHeight: number; // For Cosmos chains
  status: ChainStatus;
  lastUpdated: Date;
  errorCount: number;
  lastError?: string;
}

export enum ChainStatus {
  ACTIVE = 'active',
  SYNCING = 'syncing',
  ERROR = 'error',
  DISABLED = 'disabled'
}

export interface CircuitBreakerState {
  name: string;
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  successes: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  nextAttempt?: Date;
  updatedAt: Date;
}

export interface MetricsSnapshot {
  id: string;
  timestamp: Date;
  totalRelays: number;
  successfulRelays: number;
  failedRelays: number;
  avgCompletionTime: number;
  chainStates: string; // JSON serialized chain status map
  circuitBreakerStates: string; // JSON serialized circuit breaker states
  systemHealth: number; // 0.0 to 1.0
}

export interface PersistenceConfig {
  // PostgreSQL configuration
  postgres?: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean;
    maxConnections?: number;
    connectionTimeout?: number;
  };
  
  // Redis configuration  
  redis?: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
    maxRetries?: number;
    retryDelay?: number;
    enableOfflineQueue?: boolean;
  };
  
  // General persistence settings
  enableWAL?: boolean; // Write-ahead logging
  snapshotInterval?: number; // How often to take metrics snapshots (ms)
  retentionPeriod?: number; // How long to keep completed relays (ms)
  batchSize?: number; // Batch size for bulk operations
}

/**
 * Abstract persistence interface that can be implemented by different storage backends
 */
export interface PersistenceProvider extends NodeJS.EventEmitter {
  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  ping(): Promise<boolean>;

  // Relay management
  saveRelay(relay: PendingRelay): Promise<void>;
  updateRelay(id: string, updates: Partial<PendingRelay>): Promise<void>;
  getRelay(id: string): Promise<PendingRelay | null>;
  listPendingRelays(limit?: number): Promise<PendingRelay[]>;
  listRelaysByStatus(status: RelayStatus, limit?: number): Promise<PendingRelay[]>;
  deleteRelay(id: string): Promise<void>;

  // Relay attempt tracking
  saveRelayAttempt(attempt: RelayAttempt): Promise<void>;
  getRelayAttempts(relayId: string): Promise<RelayAttempt[]>;
  updateRelayAttempt(id: string, updates: Partial<RelayAttempt>): Promise<void>;

  // Chain state management
  saveChainState(state: ChainState): Promise<void>;
  getChainState(chainId: string): Promise<ChainState | null>;
  listChainStates(): Promise<ChainState[]>;
  updateChainState(chainId: string, updates: Partial<ChainState>): Promise<void>;

  // Circuit breaker state
  saveCircuitBreakerState(state: CircuitBreakerState): Promise<void>;
  getCircuitBreakerState(name: string): Promise<CircuitBreakerState | null>;
  listCircuitBreakerStates(): Promise<CircuitBreakerState[]>;
  updateCircuitBreakerState(name: string, updates: Partial<CircuitBreakerState>): Promise<void>;

  // Metrics and monitoring
  saveMetricsSnapshot(snapshot: MetricsSnapshot): Promise<void>;
  getLatestMetricsSnapshot(): Promise<MetricsSnapshot | null>;
  getMetricsHistory(fromTime: Date, toTime: Date): Promise<MetricsSnapshot[]>;

  // Maintenance operations
  cleanup(retentionPeriod: number): Promise<number>; // Returns number of records cleaned
  vacuum(): Promise<void>; // Database optimization
  getStats(): Promise<PersistenceStats>;
}

export interface PersistenceStats {
  totalRelays: number;
  pendingRelays: number;
  completedRelays: number;
  failedRelays: number;
  totalAttempts: number;
  databaseSize: number; // bytes
  connectionPool: {
    active: number;
    idle: number;
    total: number;
  };
  performance: {
    avgQueryTime: number; // milliseconds
    slowQueries: number;
    cacheHitRate?: number;
  };
}

/**
 * Transaction interface for atomic operations
 */
export interface PersistenceTransaction {
  // Relay operations within transaction
  saveRelay(relay: PendingRelay): Promise<void>;
  updateRelay(id: string, updates: Partial<PendingRelay>): Promise<void>;
  saveRelayAttempt(attempt: RelayAttempt): Promise<void>;
  
  // Chain state operations
  updateChainState(chainId: string, updates: Partial<ChainState>): Promise<void>;
  
  // Transaction control
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * Events emitted by persistence providers
 */
export interface PersistenceEvents {
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'slow_query': (query: string, duration: number) => void;
  'relay_saved': (relay: PendingRelay) => void;
  'relay_updated': (id: string, updates: Partial<PendingRelay>) => void;
  'cleanup_completed': (recordsRemoved: number) => void;
}
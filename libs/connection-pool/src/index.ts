/**
 * Connection Pool Export Module
 * Production-grade RPC connection pooling for Ethereum and Cosmos chains
 */

// Core types and interfaces
export * from './types';

// Base connection pool implementation
export * from './base-pool';

// Specific pool implementations
export * from './ethereum-pool';
export * from './cosmos-pool';

// Pool manager for centralized control
export * from './pool-manager';

// Metrics and monitoring
export * from './metrics';

// Configuration examples and utilities
export * from './config-examples';

// Re-export commonly used types for convenience
export type {
  PoolConfig,
  EthereumPoolConfig,
  CosmosPoolConfig,
  PoolStats,
  ConnectionHealth,
  PoolManagerConfig,
  PoolManagerStats,
  RpcEndpoint,
  PoolConnection,
  PoolEvent,
  PoolError,
  CircuitBreakerError,
  NoHealthyEndpointsError
} from './types';

// Re-export main classes  
export { BaseConnectionPool } from './base-pool';
export { EthereumConnectionPool } from './ethereum-pool';
export { CosmosQueryConnectionPool, CosmosSigningConnectionPool } from './cosmos-pool';
export { ConnectionPoolManager } from './pool-manager';

// Re-export metrics utilities
export {
  ConnectionPoolMetricsCollector,
  connectionPoolMetrics,
  initializeDefaultMetricsCollector,
  getDefaultMetricsCollector,
  withMetrics
} from './metrics';

// Re-export configuration utilities
export {
  createPoolConfig,
  createPoolConfigFromEnv,
  developmentPoolConfig,
  testnetPoolConfig,
  productionPoolConfig,
  hftPoolConfig
} from './config-examples';

// Version information
export const VERSION = '1.0.0';

// Import the classes we need for the default export
import { BaseConnectionPool } from './base-pool';
import { EthereumConnectionPool } from './ethereum-pool';
import { CosmosQueryConnectionPool, CosmosSigningConnectionPool } from './cosmos-pool';
import { ConnectionPoolManager } from './pool-manager';
import { ConnectionPoolMetricsCollector, connectionPoolMetrics, initializeDefaultMetricsCollector } from './metrics';
import { createPoolConfig, createPoolConfigFromEnv } from './config-examples';

// Default export for CommonJS compatibility
const ConnectionPool = {
  // Main classes
  BaseConnectionPool,
  ConnectionPoolManager,
  EthereumConnectionPool,
  CosmosQueryConnectionPool,
  CosmosSigningConnectionPool,
  
  // Metrics
  ConnectionPoolMetricsCollector,
  connectionPoolMetrics,
  initializeDefaultMetricsCollector,
  
  // Configuration
  createPoolConfig,
  createPoolConfigFromEnv,
  
  // Version
  VERSION
};

export default ConnectionPool;
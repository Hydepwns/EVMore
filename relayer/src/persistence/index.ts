/**
 * Persistence layer exports for the 1inch Fusion+ Cosmos Relayer
 * 
 * This module provides a comprehensive persistence solution supporting:
 * - PostgreSQL for ACID-compliant storage
 * - Redis for high-performance caching
 * - Hybrid mode combining both systems
 * - Automatic health monitoring and graceful degradation
 */

// Core types and interfaces
export * from './types';

// Provider implementations
export { PostgresPersistenceProvider } from './postgres-provider';
export { RedisPersistenceProvider } from './redis-provider';
export { HybridPersistenceProvider } from './hybrid-provider';

// Management layer
export { 
  PersistenceManager, 
  PersistenceFactory,
  type PersistenceMode,
  type PersistenceManagerConfig
} from './persistence-manager';

// Utility functions for common operations
export {
  createPersistenceManager,
  getDefaultPersistenceConfig,
  validatePersistenceConfig
} from './utils';

// Re-export commonly used enums
export {
  RelayStatus,
  AttemptStatus,
  ChainStatus
} from './types';
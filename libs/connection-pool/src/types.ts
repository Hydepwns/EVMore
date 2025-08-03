/**
 * Connection Pool Types and Interfaces
 * Provides typed interfaces for RPC connection pooling
 */

import { ethers } from 'ethers';
import { StargateClient, SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';

export interface RpcEndpoint {
  url: string;
  weight?: number; // For load balancing (higher = more traffic)
  maxConnections?: number;
  timeout?: number;
  retryAttempts?: number;
  healthCheckInterval?: number;
}

export interface PoolConfig {
  name: string;
  endpoints: RpcEndpoint[];
  maxConnections: number;
  minConnections: number;
  connectionTimeout: number;
  idleTimeout: number;
  maxRetries: number;
  healthCheckInterval: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

export interface ConnectionHealth {
  url: string;
  isHealthy: boolean;
  latency: number;
  lastCheck: number;
  errorCount: number;
  lastError?: string;
}

export interface PoolStats {
  name: string;
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  failedConnections: number;
  requestsServed: number;
  averageLatency: number;
  endpoints: ConnectionHealth[];
  circuitBreakerOpen: boolean;
}

export interface PoolConnection<T> {
  connection: T;
  endpoint: string;
  createdAt: number;
  lastUsed: number;
  inUse: boolean;
  isHealthy: boolean;
}

// Ethereum-specific types
export interface EthereumPoolConfig extends PoolConfig {
  chainId?: number;
  throttleLimit?: number;
  throttleSlotInterval?: number;
}

export interface EthereumConnection extends PoolConnection<ethers.providers.JsonRpcProvider> {
  chainId?: number;
}

// Cosmos-specific types
export interface CosmosPoolConfig extends PoolConfig {
  chainId: string;
  addressPrefix: string;
  gasPrice?: string;
}

export interface CosmosQueryConnection extends PoolConnection<StargateClient> {
  chainId: string;
}

export interface CosmosSigningConnection extends PoolConnection<SigningStargateClient> {
  chainId: string;
  wallet: DirectSecp256k1HdWallet;
}

// Pool events
export interface PoolEvent {
  type: 'connection_created' | 'connection_destroyed' | 'connection_released' | 'health_check' | 'circuit_breaker' | 'error';
  pool: string;
  endpoint?: string;
  data?: any;
  timestamp: number;
}

// Error types
export class PoolError extends Error {
  constructor(
    message: string,
    public pool: string,
    public endpoint?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'PoolError';
  }
}

export class CircuitBreakerError extends PoolError {
  constructor(pool: string, endpoint: string) {
    super(`Circuit breaker open for ${endpoint}`, pool, endpoint);
    this.name = 'CircuitBreakerError';
  }
}

export class NoHealthyEndpointsError extends PoolError {
  constructor(pool: string) {
    super(`No healthy endpoints available in pool ${pool}`, pool);
    this.name = 'NoHealthyEndpointsError';
  }
}

// Pool Manager types
export interface PoolManagerConfig {
  ethereum?: {
    [networkName: string]: EthereumPoolConfig;
  };
  cosmos?: {
    [chainId: string]: CosmosPoolConfig;
  };
  metricsInterval?: number;
  enableMetrics?: boolean;
  monitoring?: {
    metricsInterval?: number;
    healthCheckInterval?: number;
    logStats?: boolean;
  };
}

export interface PoolManagerStats {
  totalPools: number;
  activePools: number;
  totalConnections: number;
  activeConnections: number;
  totalRequests: number;
  totalRequestsServed: number;
  averageLatency: number;
  pools: PoolStats[];
  unhealthyPools: string[];
  circuitBreakersPopen: string[];
}
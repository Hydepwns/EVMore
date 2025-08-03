/**
 * Common Configuration Interfaces
 * Centralized configuration types to eliminate duplication across the codebase
 */

import { LogLevel } from '@evmore/interfaces';

/**
 * Base network configuration shared by all chains
 */
export interface BaseNetworkConfig {
  chainId: string | number;
  name?: string;
  rpcUrl: string;
  wsUrl?: string;
  explorerUrl?: string;
  confirmations?: number;
  timeout?: number;
}

/**
 * Ethereum network configuration
 */
export interface EthereumNetworkConfig extends BaseNetworkConfig {
  chainId: number;
  htlcContract: string;
  resolverContract?: string;
  routerContract?: string;
  privateKey?: string;
  gasConfig?: {
    gasPrice?: string;
    gasLimit?: number;
    maxPriorityFeePerGas?: string;
    maxFeePerGas?: string;
    maxGasLimit?: number;
  };
}

/**
 * Cosmos network configuration
 */
export interface CosmosNetworkConfig extends BaseNetworkConfig {
  chainId: string;
  restUrl: string;
  htlcContract: string;
  routerContract?: string;
  registryContract?: string;
  mnemonic?: string;
  addressPrefix: string;
  denom: string;
  gasConfig?: {
    gasPrice: string;
    gasLimit: number;
  };
  coinType?: number;
  decimals?: number;
}

/**
 * Connection pool configuration
 */
export interface PoolConfig {
  name: string;
  maxConnections: number;
  minConnections: number;
  connectionTimeout: number;
  idleTimeout: number;
  maxRetries: number;
  healthCheckInterval: number;
  retryDelay: number;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
}

/**
 * RPC endpoint configuration
 */
export interface RpcEndpointConfig {
  url: string;
  weight?: number;
  maxConnections?: number;
  timeout?: number;
  retryAttempts?: number;
  healthCheckInterval?: number;
}

/**
 * Ethereum-specific pool configuration
 */
export interface EthereumPoolConfig extends PoolConfig {
  chainId?: number;
  endpoints: RpcEndpointConfig[];
  throttleLimit?: number;
  throttleSlotInterval?: number;
}

/**
 * Cosmos-specific pool configuration
 */
export interface CosmosPoolConfig extends PoolConfig {
  chainId: string;
  addressPrefix: string;
  endpoints: RpcEndpointConfig[];
  gasPrice?: string;
}

/**
 * Relayer service configuration
 */
export interface RelayerConfig {
  maxRetries: number;
  retryDelay: number;
  batchSize: number;
  processingInterval: number;
  timeoutBuffer: number;
  concurrency?: {
    maxParallelSwaps: number;
    maxPendingSwaps: number;
  };
}

/**
 * Recovery service configuration
 */
export interface RecoveryConfig {
  enabled: boolean;
  checkInterval: number;
  refundBuffer: number;
  maxRecoveryAttempts?: number;
  emergencyContact?: string;
}

/**
 * Chain registry configuration
 */
export interface ChainRegistryConfig {
  baseUrl: string;
  cacheTimeout: number;
  refreshInterval: number;
  maxRetries?: number;
  endpoints?: {
    chainRegistry: string;
    ibcData: string;
  };
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  secrets?: SecretsConfig;
  encryption?: EncryptionConfig;
  rateLimit?: RateLimitConfig;
  firewall?: FirewallConfig;
}

export interface SecretsConfig {
  provider: 'env' | 'aws' | 'vault' | '1password';
  encryption: boolean;
  rotationInterval?: number;
  awsConfig?: {
    region: string;
    secretPrefix: string;
  };
  vaultConfig?: {
    endpoint: string;
    mountPath: string;
  };
  onePasswordConfig?: {
    serviceAccountToken: string;
    vaultId: string;
  };
}

export interface EncryptionConfig {
  algorithm: 'aes-256-gcm' | 'aes-256-cbc';
  keyDerivation: 'pbkdf2' | 'scrypt';
  iterations?: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface FirewallConfig {
  enabled: boolean;
  allowedOrigins: string[];
  allowedIPs?: string[];
  blockedIPs?: string[];
  maxConnectionsPerIP: number;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  metrics?: MetricsConfig;
  tracing?: TracingConfig;
  healthCheck?: HealthCheckConfig;
  alerts?: AlertsConfig;
}

export interface MetricsConfig {
  enabled: boolean;
  port?: number;
  path?: string;
  prefix?: string;
  labels?: Record<string, string>;
}

export interface TracingConfig {
  enabled: boolean;
  serviceName: string;
  endpoint?: string;
  sampleRate: number;
}

export interface HealthCheckConfig {
  enabled: boolean;
  interval: number;
  timeout: number;
  endpoints: string[];
}

export interface AlertsConfig {
  enabled: boolean;
  channels: AlertChannel[];
  thresholds: {
    errorRate: number;
    responseTime: number;
    diskUsage: number;
    memoryUsage: number;
  };
}

export interface AlertChannel {
  type: 'slack' | 'email' | 'webhook';
  config: Record<string, any>;
}

/**
 * General application configuration
 */
export interface GeneralConfig {
  environment?: 'development' | 'staging' | 'production' | 'test';
  logLevel: LogLevel;
  port: number;
  enableMetrics: boolean;
  shutdownTimeout: number;
  debug?: boolean;
}

/**
 * IBC channel configuration
 */
export interface IBCChannelConfig {
  channelId: string;
  portId: string;
  counterpartyChainId: string;
  counterpartyChannelId: string;
  version: string;
  timeout?: number;
}

/**
 * Feature flags
 */
export interface FeatureFlags {
  [key: string]: boolean | string | number;
}

/**
 * HTLC creation parameters (Ethereum)
 */
export interface CreateEthereumHTLCParams {
  token: string;
  amount: string;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

/**
 * HTLC creation parameters (Cosmos)
 */
export interface CreateCosmosHTLCParams {
  receiver: string;
  amount: string;
  denom: string;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

/**
 * Cross-chain swap parameters
 */
export interface CrossChainSwapParams {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAddress: string;
  slippageTolerance?: number;
  deadline?: number;
  metadata?: Record<string, any>;
}

/**
 * Throttle configuration for rate limiting
 */
export interface ThrottleConfig {
  maxConcurrent: number;
  queueLimit: number;
  defaultDelay: number;
  maxDelay: number;
  ratePerSecond?: number;
}

/**
 * Client options for connection management
 */
export interface ClientOptions {
  retries?: number;
  retryDelay?: number;
  gasMultiplier?: number;
  confirmations?: number;
  timeout?: number;
}

/**
 * Legacy compatibility types (for migration)
 */
export interface LegacyEthereumConfig {
  rpcUrl: string;
  htlcContract: string;
  resolverContract?: string;
  privateKey?: string;
  chainId: number;
  gasPrice?: string;
  gasLimit?: number;
}

export interface LegacyCosmosConfig {
  rpcUrl: string;
  restUrl: string;
  chainId: string;
  htlcContract: string;
  mnemonic?: string;
  addressPrefix: string;
  denom: string;
  gasPrice?: string;
  gasLimit?: number;
}

/**
 * Type aliases for backward compatibility
 */
export type EthereumConfig = EthereumNetworkConfig;
export type CosmosConfig = CosmosNetworkConfig;
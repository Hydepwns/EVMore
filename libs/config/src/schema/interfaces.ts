import { LogLevel } from '@evmore/interfaces';

export interface FusionConfig {
  environment: EnvironmentConfig;
  networks: NetworksConfig;
  services: ServicesConfig;
  security: SecurityConfig;
  monitoring: MonitoringConfig;
  features: FeatureFlags;
}

export interface EnvironmentConfig {
  name: 'development' | 'staging' | 'production' | 'test';
  debug: boolean;
  logLevel: LogLevel;
}

export interface NetworksConfig {
  ethereum: EthereumNetworkConfig;
  cosmos: CosmosNetworkConfig[];
}

export interface EthereumNetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  wsUrl?: string;
  explorerUrl?: string;
  contracts: {
    htlc: string;
    resolver?: string;
    router?: string;
  };
  confirmations: number;
  gasConfig: {
    maxGasLimit: number;
    maxPriorityFeePerGas?: string;
    maxFeePerGas?: string;
  };
}

export interface CosmosNetworkConfig {
  chainId: string;
  name: string;
  rpcUrl: string;
  restUrl: string;
  wsUrl?: string;
  addressPrefix: string;
  coinType: number;
  gasPrice: string;
  gasLimit: number;
  denominations: {
    primary: string;
    display: string;
    decimals: number;
  };
  contracts: {
    htlc: string;
    router?: string;
    registry?: string;
  };
  ibc: {
    channels: Record<string, IBCChannelConfig>;
    timeout: number;
  };
}

export interface IBCChannelConfig {
  channelId: string;
  portId: string;
  counterpartyChainId: string;
  counterpartyChannelId: string;
  version: string;
}

export interface ServicesConfig {
  relayer: RelayerServiceConfig;
  registry: RegistryServiceConfig;
  recovery: RecoveryServiceConfig;
}

export interface RelayerServiceConfig {
  maxRetries: number;
  retryDelayMs: number;
  batchSize: number;
  processingIntervalMs: number;
  timeoutBufferSeconds: number;
  concurrency: {
    maxParallelSwaps: number;
    maxPendingSwaps: number;
  };
}

export interface RegistryServiceConfig {
  cacheTimeout: number;
  refreshInterval: number;
  maxRetries: number;
  endpoints: {
    chainRegistry: string;
    ibcData: string;
  };
}

export interface RecoveryServiceConfig {
  enabled: boolean;
  checkInterval: number;
  refundBufferSeconds: number;
  maxRecoveryAttempts: number;
  emergencyContact?: string;
}

export interface SecurityConfig {
  secrets: SecretsConfig;
  encryption: EncryptionConfig;
  rateLimit: RateLimitConfig;
  firewall: FirewallConfig;
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

export interface MonitoringConfig {
  metrics: MetricsConfig;
  tracing: TracingConfig;
  healthCheck: HealthCheckConfig;
  alerts: AlertsConfig;
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

export interface FeatureFlags {
  [key: string]: boolean | string | number;
}

// Legacy compatibility types for migration
export interface LegacyTimelockConfig {
  maxDuration: number;
  cascade: {
    ethereum: number;
    cosmosHop1: number;
    cosmosHop2: number;
    finalHop: number;
  };
}

export interface LegacyRoutingConfig {
  maxHops: number;
  maxRoutesToExplore: number;
  minimalAmount: number;
  poolDiscoveryRange: {
    start: number;
    end: number;
  };
}

export interface LegacyChainConfig {
  chainId: string;
  addressPrefix: string;
  denom: string;
  decimals: number;
  routerAddress: string;
  ibcChannels: Record<string, string>;
}
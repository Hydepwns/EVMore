export interface MetricsData {
  timestamp: Date;
  service: string;
  metrics: Record<string, MetricValue>;
}

export interface MetricValue {
  value: number;
  unit: string;
  tags?: Record<string, string>;
}

export interface HealthStatus {
  healthy: boolean;
  lastCheck: Date;
  details: Record<string, any>;
  services?: ServiceHealth[];
}

export interface ServiceHealth {
  name: string;
  healthy: boolean;
  responseTime?: number;
  error?: string;
  lastCheck: Date;
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  disk: {
    used: number;
    total: number;
    percentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
}

export interface RelayerMetrics {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  averageExecutionTime: number;
  totalGasUsed: number;
  uptime: number;
  queueSize: number;
  lastProcessedSwap?: Date;
}

export interface ChainMetrics {
  chainId: string;
  blockHeight: number;
  blockTime: number;
  peersConnected: number;
  transactionsInMempool: number;
  averageBlockTime: number;
  lastBlock: Date;
}

export interface AlertThreshold {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  value: number;
  duration?: number; // How long the condition must persist
}

export interface Alert {
  id: string;
  level: AlertLevel;
  message: string;
  service: string;
  metric: string;
  value: number;
  threshold: AlertThreshold;
  triggeredAt: Date;
  resolvedAt?: Date;
  acknowledged?: boolean;
}

export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  tags: Record<string, any>;
  logs: TraceLog[];
  status: SpanStatus;
}

export interface TraceLog {
  timestamp: Date;
  fields: Record<string, any>;
}

export enum SpanStatus {
  OK = 'ok',
  CANCELLED = 'cancelled',
  UNKNOWN = 'unknown',
  INVALID_ARGUMENT = 'invalid_argument',
  DEADLINE_EXCEEDED = 'deadline_exceeded',
  NOT_FOUND = 'not_found',
  ALREADY_EXISTS = 'already_exists',
  PERMISSION_DENIED = 'permission_denied',
  RESOURCE_EXHAUSTED = 'resource_exhausted',
  FAILED_PRECONDITION = 'failed_precondition',
  ABORTED = 'aborted',
  OUT_OF_RANGE = 'out_of_range',
  UNIMPLEMENTED = 'unimplemented',
  INTERNAL = 'internal',
  UNAVAILABLE = 'unavailable',
  DATA_LOSS = 'data_loss',
  UNAUTHENTICATED = 'unauthenticated'
}
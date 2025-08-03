export interface RelayResult {
  success: boolean;
  transactionHash?: string;
  error?: Error;
  timestamp: Date;
  gasUsed?: number;
  executionTime?: number;
}

export interface RelayMetrics {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  averageExecutionTime: number;
  totalGasUsed: number;
  uptime: number;
}

export enum ServiceStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  ERROR = 'error'
}

export interface RelayService {
  handleSwap(swap: any): Promise<RelayResult>; // Using any for now, will be SwapOrder from types
  getStatus(): ServiceStatus;
  getMetrics(): RelayMetrics;
  
  pause(): Promise<void>;
  resume(): Promise<void>;
  emergencyStop(reason: string): Promise<void>;
  
  // Health check
  isHealthy(): boolean;
  getLastActivity(): Date;
}
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
export declare enum ServiceStatus {
    STOPPED = "stopped",
    STARTING = "starting",
    RUNNING = "running",
    PAUSED = "paused",
    STOPPING = "stopping",
    ERROR = "error"
}
export interface RelayService {
    handleSwap(swap: any): Promise<RelayResult>;
    getStatus(): ServiceStatus;
    getMetrics(): RelayMetrics;
    pause(): Promise<void>;
    resume(): Promise<void>;
    emergencyStop(reason: string): Promise<void>;
    isHealthy(): boolean;
    getLastActivity(): Date;
}
//# sourceMappingURL=relay.d.ts.map
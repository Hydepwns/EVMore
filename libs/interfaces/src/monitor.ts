export interface ChainEvent {
  type: string;
  chainId: string;
  blockNumber: number;
  transactionHash?: string;
  timestamp: Date;
  data: any;
}

export interface HTLCEvent extends ChainEvent {
  type: 'htlc_created' | 'htlc_locked' | 'htlc_revealed' | 'htlc_refunded';
  orderId: string;
  amount: string;
  secretHash: string;
  timelock: number;
}

export interface IBCEvent extends ChainEvent {
  type: 'ibc_packet_sent' | 'ibc_packet_received' | 'ibc_acknowledgment' | 'ibc_timeout';
  packetSequence: number;
  sourceChannel: string;
  destChannel: string;
  destChainId: string;
}

export type EventType = 'htlc_created' | 'htlc_locked' | 'htlc_revealed' | 'htlc_refunded' |
                       'ibc_packet_sent' | 'ibc_packet_received' | 'ibc_acknowledgment' | 'ibc_timeout';

export interface EventHandler<T extends ChainEvent> {
  (event: T): void | Promise<void>;
}

export type Unsubscribe = () => void;

export enum MonitorStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  ERROR = 'error'
}

export interface HealthStatus {
  healthy: boolean;
  lastCheck: Date;
  details: Record<string, any>;
}

export interface ChainMonitor {
  readonly chainId: string;
  readonly status: MonitorStatus;
  
  start(): Promise<void>;
  stop(): Promise<void>;
  
  onEvent<T extends ChainEvent>(
    eventType: EventType,
    handler: EventHandler<T>
  ): Unsubscribe;
  
  getHealth(): HealthStatus;
  getLastBlock(): number;
}
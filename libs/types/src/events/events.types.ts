export interface BaseEvent {
  id: string;
  type: string;
  chainId: string;
  blockNumber: number;
  transactionHash?: string;
  timestamp: Date;
  data: any;
}

export interface HTLCEvent extends BaseEvent {
  type: 'htlc_created' | 'htlc_locked' | 'htlc_revealed' | 'htlc_refunded';
  orderId: string;
  amount: string;
  secretHash: string;
  timelock: number;
  sender: string;
  receiver: string;
  token: string;
}

export interface IBCEvent extends BaseEvent {
  type: 'ibc_packet_sent' | 'ibc_packet_received' | 'ibc_acknowledgment' | 'ibc_timeout';
  packetSequence: number;
  sourceChannel: string;
  destChannel: string;
  destChainId: string;
  packetData?: any;
}

export interface SwapEvent extends BaseEvent {
  type: 'swap_initiated' | 'swap_executed' | 'swap_completed' | 'swap_failed';
  swapId: string;
  fromChain: string;
  toChain: string;
  fromAmount: string;
  toAmount?: string;
  fromToken: string;
  toToken: string;
  user: string;
  route?: string[];
}

export interface ChainEvent extends BaseEvent {
  type: 'block_produced' | 'transaction_confirmed' | 'chain_halted' | 'chain_resumed';
  blockHash?: string;
  validator?: string;
  reason?: string;
}

export interface RelayerEvent extends BaseEvent {
  type: 'relay_started' | 'relay_completed' | 'relay_failed' | 'relay_timeout';
  relayId: string;
  sourceChain: string;
  targetChain: string;
  packetSequence?: number;
  error?: string;
  retryCount?: number;
}

export interface SystemEvent extends BaseEvent {
  type: 'service_started' | 'service_stopped' | 'config_reloaded' | 'error_occurred';
  serviceName: string;
  version?: string;
  error?: string;
  configPath?: string;
}

export type EventType = 
  | 'htlc_created' | 'htlc_locked' | 'htlc_revealed' | 'htlc_refunded'
  | 'ibc_packet_sent' | 'ibc_packet_received' | 'ibc_acknowledgment' | 'ibc_timeout'
  | 'swap_initiated' | 'swap_executed' | 'swap_completed' | 'swap_failed'
  | 'block_produced' | 'transaction_confirmed' | 'chain_halted' | 'chain_resumed'
  | 'relay_started' | 'relay_completed' | 'relay_failed' | 'relay_timeout'
  | 'service_started' | 'service_stopped' | 'config_reloaded' | 'error_occurred';

export type AnyEvent = HTLCEvent | IBCEvent | SwapEvent | ChainEvent | RelayerEvent | SystemEvent;

export interface EventFilter {
  types?: EventType[];
  chainIds?: string[];
  fromBlock?: number;
  toBlock?: number;
  addresses?: string[];
  limit?: number;
  offset?: number;
}

export interface EventSubscription {
  id: string;
  filter: EventFilter;
  callback: (event: AnyEvent) => void | Promise<void>;
  active: boolean;
  createdAt: Date;
}

export interface EventBatch {
  events: AnyEvent[];
  fromBlock: number;
  toBlock: number;
  chainId: string;
  timestamp: Date;
}
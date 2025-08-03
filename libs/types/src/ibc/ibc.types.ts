export interface IBCRoute {
  source: string;
  destination: string;
  hops: IBCHop[];
  estimatedTime: number;
  estimatedFees: Fee[];
  totalHops: number;
  isMultiHop: boolean;
}

export interface IBCHop {
  from: IBCEndpoint;
  to: IBCEndpoint;
  channel: IBCChannel;
  timeoutHeight?: Height;
  timeoutTimestamp?: number;
  packetData?: IBCPacketData;
}

export interface IBCEndpoint {
  chainId: string;
  portId: string;
  channelId: string;
}

export interface IBCChannel {
  state: ChannelState;
  ordering: ChannelOrder;
  counterparty: IBCEndpoint;
  connectionHops: string[];
  version: string;
}

export enum ChannelState {
  UNINITIALIZED = 'UNINITIALIZED',
  INIT = 'INIT',
  TRYOPEN = 'TRYOPEN',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED'
}

export enum ChannelOrder {
  ORDERED = 'ORDERED',
  UNORDERED = 'UNORDERED'
}

export interface Height {
  revisionNumber: number;
  revisionHeight: number;
}

export interface Fee {
  amount: string;
  denom: string;
}

export interface IBCPacketData {
  amount: string;
  denom: string;
  receiver: string;
  sender: string;
  memo?: string;
}

export interface IBCPacket {
  sequence: number;
  sourcePort: string;
  sourceChannel: string;
  destinationPort: string;
  destinationChannel: string;
  data: IBCPacketData;
  timeoutHeight: Height;
  timeoutTimestamp: number;
}

export interface IBCPacketReceipt {
  packet: IBCPacket;
  acknowledgement?: IBCPacketAcknowledgement;
  status: IBCPacketStatus;
  relayedAt?: Date;
  timeoutAt: Date;
}

export enum IBCPacketStatus {
  PENDING = 'pending',
  RELAYED = 'relayed',
  ACKNOWLEDGED = 'acknowledged',
  TIMEOUT = 'timeout',
  FAILED = 'failed'
}

export interface IBCPacketAcknowledgement {
  result?: string;
  error?: string;
}

export interface IBCConnection {
  id: string;
  clientId: string;
  state: ConnectionState;
  counterparty: {
    clientId: string;
    connectionId: string;
    prefix: {
      keyPrefix: string;
    };
  };
  delayPeriod: number;
}

export enum ConnectionState {
  UNINITIALIZED = 'UNINITIALIZED',
  INIT = 'INIT',
  TRYOPEN = 'TRYOPEN',
  OPEN = 'OPEN'
}

export interface IBCClient {
  clientId: string;
  clientState: any;
  consensusState: any;
  trustLevel: {
    numerator: number;
    denominator: number;
  };
  trustingPeriod: string;
  unbondingPeriod: string;
  maxClockDrift: string;
}

export interface IBCTransferParams {
  sourcePort: string;
  sourceChannel: string;
  token: {
    denom: string;
    amount: string;
  };
  sender: string;
  receiver: string;
  timeoutHeight?: Height;
  timeoutTimestamp?: number;
  memo?: string;
}
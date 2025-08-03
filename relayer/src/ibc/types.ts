export interface IBCTransferPacket {
  sender: string;
  receiver: string;
  denom: string;
  amount: string;
  memo: string;
}

export interface HTLCMemo {
  type: 'htlc_create';
  htlcId: string;
  receiver: string;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
  sourceChain: string;
  sourceHTLCId: string;
}

export interface PacketForwardMemo {
  forward: {
    receiver: string;
    port: string;
    channel: string;
    timeout?: string;
    retries?: number;
    next?: PacketForwardMemo;
  };
}

export interface IBCPacket {
  sequence: bigint;
  sourcePort: string;
  sourceChannel: string;
  destinationPort: string;
  destinationChannel: string;
  data: Uint8Array;
  timeoutHeight?: {
    revisionNumber: bigint;
    revisionHeight: bigint;
  };
  timeoutTimestamp: bigint;
}

export interface IBCAcknowledgement {
  result?: Uint8Array;
  error?: string;
}

export interface IBCHeight {
  revisionNumber: bigint;
  revisionHeight: bigint;
}

export interface ChannelInfo {
  state: 'INIT' | 'TRYOPEN' | 'OPEN' | 'CLOSED';
  ordering: 'ORDERED' | 'UNORDERED';
  counterparty: {
    portId: string;
    channelId: string;
  };
  connectionHops: string[];
  version: string;
}

export interface IBCTransferOptions {
  sourcePort: string;
  sourceChannel: string;
  token: {
    denom: string;
    amount: string;
  };
  sender: string;
  receiver: string;
  timeoutHeight?: IBCHeight;
  timeoutTimestamp?: bigint;
  memo?: string;
}

// Helper function to create HTLC memo for IBC transfers
export function createHTLCMemo(params: Omit<HTLCMemo, 'type'>): string {
  const memo: HTLCMemo = {
    type: 'htlc_create',
    ...params
  };
  return JSON.stringify(memo);
}

// Helper function to create packet forward memo
export function createPacketForwardMemo(
  hops: Array<{
    receiver: string;
    channel: string;
    port?: string;
    timeout?: string;
  }>
): string {
  if (hops.length === 0) {
    throw new Error('At least one hop is required');
  }

  let memo: PacketForwardMemo | undefined;
  
  // Build the memo from the last hop backwards
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i];
    const forward: PacketForwardMemo = {
      forward: {
        receiver: hop.receiver,
        port: hop.port || 'transfer',
        channel: hop.channel,
        timeout: hop.timeout,
        retries: 0
      }
    };

    if (memo) {
      forward.forward.next = memo;
    }
    
    memo = forward;
  }

  return JSON.stringify(memo!);
}

// Combine HTLC memo with packet forward memo
export function createMultiHopHTLCMemo(
  htlcParams: Omit<HTLCMemo, 'type'>,
  forwardHops: Array<{
    receiver: string;
    channel: string;
    port?: string;
    timeout?: string;
  }>
): string {
  const htlcMemo = createHTLCMemo(htlcParams);
  
  if (forwardHops.length === 0) {
    return htlcMemo;
  }

  // The HTLC memo goes in the final hop's memo field
  const hopsWithMemo = [...forwardHops];
  
  // Create a combined memo structure
  const combinedMemo: any = {
    forward: {
      ...hopsWithMemo[0],
      port: hopsWithMemo[0].port || 'transfer'
    },
    htlc: JSON.parse(htlcMemo)
  };

  // Build nested structure for remaining hops
  let current: any = combinedMemo.forward;
  for (let i = 1; i < hopsWithMemo.length; i++) {
    current.next = {
      forward: {
        ...hopsWithMemo[i],
        port: hopsWithMemo[i].port || 'transfer'
      }
    };
    current = current.next.forward;
  }

  return JSON.stringify(combinedMemo);
}
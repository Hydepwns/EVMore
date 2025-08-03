import { 
  SwapOrder, 
  SwapStatus, 
  SwapEndpoint, 
  SwapAmount, 
  TimelockConfig,
  ChainType,
  Chain,
  IBCRoute,
  IBCHop,
  IBCChannel,
  HTLCEvent,
  IBCEvent,
  SwapEvent,
  AnyEvent,
  TransactionStatus,
  TransactionInfo
} from '../index';

// Swap type guards
export function isSwapOrder(obj: any): obj is SwapOrder {
  return obj &&
    typeof obj.id === 'string' &&
    typeof obj.orderId === 'string' &&
    Object.values(SwapStatus).includes(obj.status) &&
    isSwapEndpoint(obj.source) &&
    isSwapEndpoint(obj.destination) &&
    isSwapAmount(obj.amount) &&
    isTimelockConfig(obj.timelock) &&
    obj.createdAt instanceof Date &&
    obj.updatedAt instanceof Date;
}

export function isSwapEndpoint(obj: any): obj is SwapEndpoint {
  return obj &&
    typeof obj.chainId === 'string' &&
    typeof obj.address === 'string' &&
    obj.chainId.length > 0 &&
    obj.address.length > 0;
}

export function isSwapAmount(obj: any): obj is SwapAmount {
  return obj &&
    typeof obj.value === 'string' &&
    typeof obj.decimals === 'number' &&
    typeof obj.displayValue === 'string' &&
    typeof obj.symbol === 'string' &&
    obj.decimals >= 0 &&
    obj.decimals <= 18;
}

export function isTimelockConfig(obj: any): obj is TimelockConfig {
  return obj &&
    typeof obj.startTime === 'number' &&
    typeof obj.duration === 'number' &&
    typeof obj.expiryTime === 'number' &&
    typeof obj.buffer === 'number' &&
    obj.startTime > 0 &&
    obj.duration > 0 &&
    obj.expiryTime > obj.startTime &&
    obj.buffer > 0;
}

export function isValidSwapStatus(status: any): status is SwapStatus {
  return Object.values(SwapStatus).includes(status);
}

// Chain type guards
export function isChain(obj: any): obj is Chain {
  return obj &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    Object.values(ChainType).includes(obj.type) &&
    obj.nativeCurrency &&
    typeof obj.nativeCurrency.symbol === 'string' &&
    typeof obj.nativeCurrency.decimals === 'number' &&
    obj.endpoints &&
    typeof obj.endpoints.rpc === 'string';
}

export function isEthereumChain(chainId: string): boolean {
  // Ethereum chain IDs are numeric or hex strings
  return /^\d+$/.test(chainId) || /^0x[0-9a-fA-F]+$/.test(chainId);
}

export function isCosmosChain(chainId: string): boolean {
  // Cosmos chain IDs typically contain hyphens and are not purely numeric
  return chainId.includes('-') && !/^\d+$/.test(chainId);
}

export function isValidChainType(type: any): type is ChainType {
  return Object.values(ChainType).includes(type);
}

// IBC type guards
export function isIBCRoute(obj: any): obj is IBCRoute {
  return obj &&
    typeof obj.source === 'string' &&
    typeof obj.destination === 'string' &&
    Array.isArray(obj.hops) &&
    obj.hops.every(isIBCHop) &&
    typeof obj.estimatedTime === 'number' &&
    Array.isArray(obj.estimatedFees);
}

export function isIBCHop(obj: any): obj is IBCHop {
  return obj &&
    obj.from &&
    obj.to &&
    obj.channel &&
    typeof obj.from.chainId === 'string' &&
    typeof obj.from.portId === 'string' &&
    typeof obj.from.channelId === 'string' &&
    typeof obj.to.chainId === 'string' &&
    typeof obj.to.portId === 'string' &&
    typeof obj.to.channelId === 'string';
}

export function isIBCChannel(obj: any): obj is IBCChannel {
  return obj &&
    typeof obj.state === 'string' &&
    typeof obj.ordering === 'string' &&
    obj.counterparty &&
    Array.isArray(obj.connectionHops) &&
    typeof obj.version === 'string';
}

// Event type guards
export function isHTLCEvent(obj: any): obj is HTLCEvent {
  return obj &&
    isBaseEvent(obj) &&
    ['htlc_created', 'htlc_locked', 'htlc_revealed', 'htlc_refunded'].includes(obj.type) &&
    typeof obj.orderId === 'string' &&
    typeof obj.amount === 'string' &&
    typeof obj.secretHash === 'string' &&
    typeof obj.timelock === 'number';
}

export function isIBCEvent(obj: any): obj is IBCEvent {
  return obj &&
    isBaseEvent(obj) &&
    ['ibc_packet_sent', 'ibc_packet_received', 'ibc_acknowledgment', 'ibc_timeout'].includes(obj.type) &&
    typeof obj.packetSequence === 'number' &&
    typeof obj.sourceChannel === 'string' &&
    typeof obj.destChannel === 'string' &&
    typeof obj.destChainId === 'string';
}

export function isSwapEvent(obj: any): obj is SwapEvent {
  return obj &&
    isBaseEvent(obj) &&
    ['swap_initiated', 'swap_executed', 'swap_completed', 'swap_failed'].includes(obj.type) &&
    typeof obj.swapId === 'string' &&
    typeof obj.fromChain === 'string' &&
    typeof obj.toChain === 'string' &&
    typeof obj.fromAmount === 'string' &&
    typeof obj.fromToken === 'string' &&
    typeof obj.toToken === 'string' &&
    typeof obj.user === 'string';
}

export function isBaseEvent(obj: any): boolean {
  return obj &&
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.chainId === 'string' &&
    typeof obj.blockNumber === 'number' &&
    obj.timestamp instanceof Date &&
    obj.data !== undefined;
}

export function isAnyEvent(obj: any): obj is AnyEvent {
  return isHTLCEvent(obj) || isIBCEvent(obj) || isSwapEvent(obj) || isBaseEvent(obj);
}

// Transaction type guards
export function isTransactionInfo(obj: any): obj is TransactionInfo {
  return obj &&
    typeof obj.hash === 'string' &&
    typeof obj.blockNumber === 'number' &&
    typeof obj.blockHash === 'string' &&
    typeof obj.from === 'string' &&
    typeof obj.value === 'string' &&
    typeof obj.gasUsed === 'string' &&
    typeof obj.gasPrice === 'string' &&
    Object.values(TransactionStatus).includes(obj.status) &&
    typeof obj.timestamp === 'number' &&
    Array.isArray(obj.logs);
}

export function isValidTransactionStatus(status: any): status is TransactionStatus {
  return Object.values(TransactionStatus).includes(status);
}

// Address validation
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function isValidCosmosAddress(address: string, prefix?: string): boolean {
  if (prefix) {
    return address.startsWith(prefix) && address.length > prefix.length + 10;
  }
  // Generic Cosmos address validation (bech32-like)
  return /^[a-z]{2,10}1[a-z0-9]{38,58}$/.test(address);
}

export function isValidAddress(address: string, chainType: ChainType, prefix?: string): boolean {
  switch (chainType) {
    case ChainType.ETHEREUM:
      return isValidEthereumAddress(address);
    case ChainType.COSMOS:
    case ChainType.OSMOSIS:
      return isValidCosmosAddress(address, prefix);
    default:
      return false;
  }
}

// Amount validation
export function isValidAmount(amount: string): boolean {
  try {
    const value = BigInt(amount);
    return value > 0n;
  } catch {
    return false;
  }
}

export function isValidDecimalAmount(amount: string, decimals: number): boolean {
  const regex = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  return regex.test(amount) && parseFloat(amount) > 0;
}

// Hash validation
export function isValidSHA256Hash(hash: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(hash);
}

export function isValidKeccak256Hash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

export function isValidSecret(secret: string): boolean {
  return /^(0x)?[a-fA-F0-9]{64}$/.test(secret);
}

// Channel and connection validation
export function isValidChannelId(channelId: string): boolean {
  return /^channel-\d+$/.test(channelId);
}

export function isValidConnectionId(connectionId: string): boolean {
  return /^connection-\d+$/.test(connectionId);
}

export function isValidPortId(portId: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(portId);
}

// Utility function to check if value is defined and not null
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

// Utility function to check if array is non-empty
export function isNonEmpty<T>(array: T[]): array is [T, ...T[]] {
  return array.length > 0;
}

// Utility function to check if object has all required keys
export function hasRequiredKeys<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): obj is T & Required<Pick<T, K>> {
  return keys.every(key => key in obj && obj[key] !== undefined);
}
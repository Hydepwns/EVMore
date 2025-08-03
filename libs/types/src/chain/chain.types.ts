export interface Chain {
  id: string;
  name: string;
  type: ChainType;
  nativeCurrency: Currency;
  explorerUrl?: string;
  endpoints: ChainEndpoints;
}

export enum ChainType {
  ETHEREUM = 'ethereum',
  COSMOS = 'cosmos',
  OSMOSIS = 'osmosis'
}

export interface Currency {
  symbol: string;
  decimals: number;
  denom?: string; // For Cosmos chains
  displayName?: string;
}

export interface ChainEndpoints {
  rpc: string;
  rest?: string;
  ws?: string;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: string;
  logoUrl?: string;
  denom?: string; // For Cosmos tokens
}

export interface ChainConfig {
  chainId: string;
  name: string;
  type: ChainType;
  rpcUrl: string;
  restUrl?: string;
  wsUrl?: string;
  htlcContract: string;
  nativeDenom: string;
  addressPrefix?: string;
  blockTime: number;
  confirmations: number;
  gasConfig: {
    maxGasLimit: number;
    gasPrice?: string;
    maxPriorityFee?: string;
    maxFee?: string;
  };
}

export interface BlockInfo {
  number: number;
  hash: string;
  timestamp: number;
  parentHash: string;
  transactions: string[];
}

export interface TransactionInfo {
  hash: string;
  blockNumber: number;
  blockHash: string;
  from: string;
  to?: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  status: TransactionStatus;
  timestamp: number;
  logs: TransactionLog[];
}

export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}

export interface TransactionLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
  blockNumber: number;
  transactionHash: string;
}
/**
 * Cosmos HTLC Types
 * 
 * This file contains all type definitions related to Cosmos HTLC operations,
 * including configuration, parameters, responses, and internal data structures.
 */

import { DeliverTxResponse, IndexedTx } from '@cosmjs/stargate';

// Configuration types
export interface CosmosConfig {
  rpcUrl: string;
  restUrl: string;
  chainId: string;
  htlcContract: string;
  mnemonic?: string;
  addressPrefix: string;
  denom: string;
}

// HTLC operation parameters
export interface CreateCosmosHTLCParams {
  receiver: string;
  amount: string;
  denom: string;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

export interface WithdrawHTLCParams {
  htlcId: string;
  secret: string;
}

export interface RefundHTLCParams {
  htlcId: string;
}

// HTLC details structure
export interface HTLCDetails {
  htlcId: string;
  sender: string;
  receiver: string;
  token: string;
  amount: string;
  hashlock: string;
  timelock: number;
  withdrawn: boolean;
  refunded: boolean;
  targetChain: string;
  targetAddress: string;
}

// CosmWasm query response types
export interface WasmHTLC {
  id: string;
  sender: string;
  receiver: string;
  amount: Array<{ denom: string; amount: string }>;
  hashlock: string;
  timelock: number;
  withdrawn: boolean;
  refunded: boolean;
  target_chain: string;
  target_address: string;
}

export interface WasmHTLCQueryResult {
  htlcs: WasmHTLC[];
}

export interface WasmHTLCGetResult {
  htlc: WasmHTLC;
}

// Transaction result types
export type CosmosTransactionResult = DeliverTxResponse | IndexedTx;

// Query message types
export interface ListHTLCsQuery extends Record<string, unknown> {
  list_htlcs: {
    start_after?: string;
    limit: number;
  };
}

export interface GetHTLCQuery extends Record<string, unknown> {
  get_htlc: {
    id: string;
  };
}

// Execute message types
export interface CreateHTLCMessage extends Record<string, unknown> {
  create_htlc: {
    receiver: string;
    amount: string;
    denom: string;
    hashlock: string;
    timelock: number;
    target_chain: string;
    target_address: string;
  };
}

export interface WithdrawHTLCMessage extends Record<string, unknown> {
  withdraw: {
    id: string;
    secret: string;
  };
}

export interface RefundHTLCMessage extends Record<string, unknown> {
  refund: {
    id: string;
  };
}

// Type guards
export function isDeliverTxResponse(result: CosmosTransactionResult): result is DeliverTxResponse {
  return 'code' in result && 'transactionHash' in result;
}

export function isIndexedTx(result: CosmosTransactionResult): result is IndexedTx {
  return 'height' in result && 'txIndex' in result;
}

export function hasLogs(result: CosmosTransactionResult): result is IndexedTx {
  return isIndexedTx(result) && 'logs' in result;
}

// Error types
export class CosmosHTLCError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CosmosHTLCError';
  }
}

export class CosmosHTLCNotFoundError extends CosmosHTLCError {
  constructor(htlcId: string) {
    super(`HTLC with ID ${htlcId} not found`);
    this.name = 'CosmosHTLCNotFoundError';
  }
}

export class CosmosHTLCAlreadyWithdrawnError extends CosmosHTLCError {
  constructor(htlcId: string) {
    super(`HTLC with ID ${htlcId} has already been withdrawn`);
    this.name = 'CosmosHTLCAlreadyWithdrawnError';
  }
}

export class CosmosHTLCAlreadyRefundedError extends CosmosHTLCError {
  constructor(htlcId: string) {
    super(`HTLC with ID ${htlcId} has already been refunded`);
    this.name = 'CosmosHTLCAlreadyRefundedError';
  }
}

export class CosmosHTLCExpiredError extends CosmosHTLCError {
  constructor(htlcId: string) {
    super(`HTLC with ID ${htlcId} has expired`);
    this.name = 'CosmosHTLCExpiredError';
  }
} 
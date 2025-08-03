/**
 * Ethereum HTLC Types
 * 
 * This file contains all type definitions related to Ethereum HTLC operations,
 * including configuration, parameters, responses, and internal data structures.
 */

import { ethers } from 'ethers';

// Configuration types
export interface EthereumConfig {
  rpcUrl: string;
  htlcContractAddress: string;
  privateKey?: string;
  chainId: number;
  gasLimit?: number;
  gasPrice?: string;
}

// HTLC operation parameters
export interface CreateEthereumHTLCParams {
  receiver: string;
  amount: string;
  tokenAddress?: string; // If not provided, uses native ETH
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
}

export interface WithdrawEthereumHTLCParams {
  htlcId: string;
  secret: string;
}

export interface RefundEthereumHTLCParams {
  htlcId: string;
}

// HTLC details structure (matches Cosmos for consistency)
export interface EthereumHTLCDetails {
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

// Contract event types
export interface HTLCCreatedEvent {
  htlcId: string;
  sender: string;
  receiver: string;
  amount: ethers.BigNumber;
  hashlock: string;
  timelock: number;
  targetChain: string;
  targetAddress: string;
  blockNumber: number;
  transactionHash: string;
}

export interface HTLCWithdrawnEvent {
  htlcId: string;
  receiver: string;
  secret: string;
  blockNumber: number;
  transactionHash: string;
}

export interface HTLCRefundedEvent {
  htlcId: string;
  sender: string;
  blockNumber: number;
  transactionHash: string;
}

// Contract call result types
export interface HTLCContractData {
  sender: string;
  receiver: string;
  amount: ethers.BigNumber;
  hashlock: string;
  timelock: number;
  withdrawn: boolean;
  refunded: boolean;
  targetChain: string;
  targetAddress: string;
}

// Token information
export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: ethers.BigNumber;
}

// Gas estimation types
export interface GasEstimate {
  gasLimit: ethers.BigNumber;
  gasPrice: ethers.BigNumber;
  estimatedCost: ethers.BigNumber;
}

// Transaction options
export interface TransactionOptions {
  gasLimit?: number;
  gasPrice?: string | ethers.BigNumber;
  maxFeePerGas?: string | ethers.BigNumber;
  maxPriorityFeePerGas?: string | ethers.BigNumber;
  nonce?: number;
}

// Query parameters
export interface GetHTLCParams {
  htlcId: string;
}

export interface ListHTLCsParams {
  fromBlock?: number;
  toBlock?: number | 'latest';
  filter?: {
    sender?: string;
    receiver?: string;
    withdrawn?: boolean;
    refunded?: boolean;
  };
}

// Event filter types
export interface HTLCEventFilter {
  htlcId?: string;
  sender?: string;
  receiver?: string;
  fromBlock?: number;
  toBlock?: number | 'latest';
}

// Error types
export class EthereumHTLCError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'EthereumHTLCError';
  }
}

export class HTLCNotFoundError extends EthereumHTLCError {
  constructor(htlcId: string) {
    super(`HTLC with ID ${htlcId} not found`);
    this.name = 'HTLCNotFoundError';
  }
}

export class HTLCAlreadyWithdrawnError extends EthereumHTLCError {
  constructor(htlcId: string) {
    super(`HTLC with ID ${htlcId} has already been withdrawn`);
    this.name = 'HTLCAlreadyWithdrawnError';
  }
}

export class HTLCAlreadyRefundedError extends EthereumHTLCError {
  constructor(htlcId: string) {
    super(`HTLC with ID ${htlcId} has already been refunded`);
    this.name = 'HTLCAlreadyRefundedError';
  }
}

export class HTLCExpiredError extends EthereumHTLCError {
  constructor(htlcId: string) {
    super(`HTLC with ID ${htlcId} has expired`);
    this.name = 'HTLCExpiredError';
  }
}

export class InsufficientBalanceError extends EthereumHTLCError {
  constructor(required: string, available: string) {
    super(`Insufficient balance. Required: ${required}, Available: ${available}`);
    this.name = 'InsufficientBalanceError';
  }
}

export class InvalidSecretError extends EthereumHTLCError {
  constructor(htlcId: string) {
    super(`Invalid secret for HTLC ${htlcId}`);
    this.name = 'InvalidSecretError';
  }
}

// Type guards
export function isValidEthereumAddress(address: string): boolean {
  return ethers.utils.isAddress(address);
}

export function isValidHTLCId(htlcId: string): boolean {
  return ethers.utils.isHexString(htlcId, 32); // 32 bytes = 64 hex characters
}

export function isValidHashlock(hashlock: string): boolean {
  return ethers.utils.isHexString(hashlock, 32);
}

export function isValidSecret(secret: string): boolean {
  return ethers.utils.isHexString(secret, 32);
} 
/**
 * Base HTLC Client with shared functionality
 * Eliminates duplication between direct and pooled clients
 */

import { ConnectionStrategy } from './connection-strategies';

/**
 * Common HTLC operation parameters
 */
export interface HTLCOperationParams {
  htlcId?: string;
  amount?: string;
  receiver?: string;
  hashlock?: string;
  timelock?: number;
  targetChain?: string;
  targetAddress?: string;
  secret?: string;
  token?: string;
}

/**
 * HTLC operation result
 */
export interface HTLCOperationResult {
  transactionHash: string;
  htlcId?: string;
  blockNumber?: number;
  gasUsed?: string;
  success: boolean;
  error?: string;
}

/**
 * HTLC details structure
 */
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
  createdAt?: Date;
  expiresAt?: Date;
}

/**
 * Base HTLC client with shared functionality
 */
export abstract class BaseHTLCClient<TConnection> {
  protected connectionStrategy: ConnectionStrategy<TConnection>;
  protected config: any;

  constructor(config: any, connectionStrategy: ConnectionStrategy<TConnection>) {
    this.config = config;
    this.connectionStrategy = connectionStrategy;
  }

  /**
   * Execute an operation with connection management
   */
  protected async executeWithConnection<T>(
    operation: (connection: TConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.connectionStrategy.getConnection();
    try {
      return await operation(connection);
    } finally {
      this.connectionStrategy.releaseConnection(connection);
    }
  }

  /**
   * Validate common parameters
   */
  protected validateHTLCParams(params: HTLCOperationParams): void {
    if (params.amount) {
      const amount = parseFloat(params.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid amount: must be a positive number');
      }
    }

    if (params.hashlock && !/^0x[a-fA-F0-9]{64}$/.test(params.hashlock)) {
      throw new Error('Invalid hashlock: must be a 32-byte hex string with 0x prefix');
    }

    if (params.secret && !/^(0x)?[a-fA-F0-9]{64}$/.test(params.secret)) {
      throw new Error('Invalid secret: must be a 32-byte hex string');
    }

    if (params.timelock && params.timelock <= Math.floor(Date.now() / 1000)) {
      throw new Error('Invalid timelock: must be in the future');
    }
  }

  /**
   * Calculate HTLC expiration time
   */
  protected calculateExpiration(timelock: number): Date {
    return new Date(timelock * 1000);
  }

  /**
   * Generate unique HTLC ID (implementation specific)
   */
  protected abstract generateHTLCId(params: HTLCOperationParams): string;

  /**
   * Create HTLC (implementation specific)
   */
  public abstract createHTLC(params: HTLCOperationParams): Promise<HTLCOperationResult>;

  /**
   * Withdraw from HTLC (implementation specific)
   */
  public abstract withdraw(htlcId: string, secret: string): Promise<HTLCOperationResult>;

  /**
   * Refund HTLC (implementation specific)
   */
  public abstract refund(htlcId: string): Promise<HTLCOperationResult>;

  /**
   * Get HTLC details (implementation specific)
   */
  public abstract getHTLC(htlcId: string): Promise<HTLCDetails>;

  /**
   * Cleanup resources
   */
  public async dispose(): Promise<void> {
    if (this.connectionStrategy.dispose) {
      await this.connectionStrategy.dispose();
    }
  }
}

/**
 * Error types for HTLC operations
 */
export class HTLCError extends Error {
  constructor(
    message: string,
    public code: HTLCErrorCode,
    public htlcId?: string,
    public transactionHash?: string
  ) {
    super(message);
    this.name = 'HTLCError';
  }
}

export enum HTLCErrorCode {
  INVALID_PARAMS = 'INVALID_PARAMS',
  HTLC_NOT_FOUND = 'HTLC_NOT_FOUND',
  HTLC_EXPIRED = 'HTLC_EXPIRED',
  HTLC_ALREADY_WITHDRAWN = 'HTLC_ALREADY_WITHDRAWN',
  HTLC_ALREADY_REFUNDED = 'HTLC_ALREADY_REFUNDED',
  INVALID_SECRET = 'INVALID_SECRET',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  TIMEOUT = 'TIMEOUT'
}

/**
 * Utility functions for HTLC operations
 */
export class HTLCUtils {
  /**
   * Check if HTLC is expired
   */
  static isExpired(timelock: number): boolean {
    return Math.floor(Date.now() / 1000) > timelock;
  }

  /**
   * Calculate time remaining
   */
  static getTimeRemaining(timelock: number): number {
    return Math.max(0, timelock - Math.floor(Date.now() / 1000));
  }

  /**
   * Format timelock for display
   */
  static formatTimelock(timelock: number): string {
    const remaining = HTLCUtils.getTimeRemaining(timelock);
    if (remaining === 0) return 'Expired';
    
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Validate address format (override in implementations)
   */
  static validateAddress(address: string, chainType: 'ethereum' | 'cosmos'): boolean {
    switch (chainType) {
      case 'ethereum':
        return /^0x[a-fA-F0-9]{40}$/.test(address);
      case 'cosmos':
        // Basic bech32 validation
        return /^[a-z]+1[a-z0-9]{38,58}$/.test(address);
      default:
        return false;
    }
  }

  /**
   * Normalize secret format
   */
  static normalizeSecret(secret: string): string {
    return secret.startsWith('0x') ? secret : `0x${secret}`;
  }

  /**
   * Generate deterministic HTLC ID
   */
  static generateDeterministicHTLCId(
    sender: string,
    receiver: string,
    hashlock: string,
    timelock: number
  ): string {
    // Implementation would use crypto hash
    return `htlc_${sender}_${receiver}_${hashlock}_${timelock}`.slice(0, 66);
  }
}

/**
 * Event types for HTLC operations
 */
export interface HTLCEvent {
  type: 'created' | 'withdrawn' | 'refunded';
  htlcId: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: Date;
  data: any;
}

/**
 * HTLC event listener interface
 */
export interface HTLCEventListener {
  onHTLCCreated?(event: HTLCEvent): void;
  onHTLCWithdrawn?(event: HTLCEvent): void;
  onHTLCRefunded?(event: HTLCEvent): void;
  onError?(error: HTLCError): void;
}
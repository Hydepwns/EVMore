export enum ErrorCode {
  // Configuration errors (1xxx)
  CONFIG_INVALID = 1001,
  CONFIG_MISSING = 1002,
  CONFIG_TYPE_MISMATCH = 1003,
  
  // Validation errors (2xxx)
  VALIDATION_FAILED = 2001,
  INVALID_ADDRESS = 2002,
  INVALID_AMOUNT = 2003,
  
  // Chain errors (3xxx)
  CHAIN_UNREACHABLE = 3001,
  CHAIN_MISMATCH = 3002,
  INSUFFICIENT_GAS = 3003,
  
  // HTLC errors (4xxx)
  HTLC_ALREADY_EXISTS = 4001,
  HTLC_NOT_FOUND = 4002,
  HTLC_EXPIRED = 4003,
  INVALID_SECRET = 4004,
  
  // IBC errors (5xxx)
  IBC_CHANNEL_CLOSED = 5001,
  IBC_TIMEOUT = 5002,
  IBC_PACKET_FAILED = 5003
}

export abstract class FusionError extends Error {
  public readonly timestamp: Date;
  
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, any>,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}
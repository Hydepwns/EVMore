import { FusionError, ErrorCode } from './base';

export class HTLCError extends FusionError {
  constructor(
    code: ErrorCode,
    message: string,
    public readonly orderId: string,
    details?: Record<string, any>
  ) {
    super(code, message, { orderId, ...details });
  }
}

export class HTLCAlreadyExistsError extends HTLCError {
  constructor(
    orderId: string,
    chainId: string,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.HTLC_ALREADY_EXISTS,
      `HTLC already exists for order ${orderId} on chain ${chainId}`,
      orderId,
      { chainId, ...details }
    );
  }
}

export class HTLCNotFoundError extends HTLCError {
  constructor(
    orderId: string,
    chainId: string,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.HTLC_NOT_FOUND,
      `HTLC not found for order ${orderId} on chain ${chainId}`,
      orderId,
      { chainId, ...details }
    );
  }
}

export class HTLCExpiredError extends HTLCError {
  constructor(
    orderId: string,
    expiryTime: number,
    currentTime: number,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.HTLC_EXPIRED,
      `HTLC for order ${orderId} has expired at ${new Date(expiryTime * 1000).toISOString()}`,
      orderId,
      { expiryTime, currentTime, ...details }
    );
  }
}

export class InvalidSecretError extends HTLCError {
  constructor(
    orderId: string,
    reason: string,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.INVALID_SECRET,
      `Invalid secret for order ${orderId}: ${reason}`,
      orderId,
      { reason, ...details }
    );
  }
}
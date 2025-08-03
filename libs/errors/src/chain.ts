import { FusionError, ErrorCode } from './base';

export class ChainError extends FusionError {
  constructor(
    code: ErrorCode,
    message: string,
    public readonly chainId: string,
    details?: Record<string, any>,
    cause?: Error
  ) {
    super(code, message, { chainId, ...details }, cause);
  }
}

export class ChainUnreachableError extends ChainError {
  constructor(
    chainId: string,
    endpoint: string,
    cause?: Error,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.CHAIN_UNREACHABLE,
      `Cannot reach chain ${chainId} at ${endpoint}`,
      chainId,
      { endpoint, ...details },
      cause
    );
  }
}

export class ChainMismatchError extends ChainError {
  constructor(
    expectedChainId: string,
    actualChainId: string,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.CHAIN_MISMATCH,
      `Chain ID mismatch: expected ${expectedChainId}, got ${actualChainId}`,
      expectedChainId,
      { actualChainId, ...details }
    );
  }
}

export class InsufficientGasError extends ChainError {
  constructor(
    chainId: string,
    required: string,
    available: string,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.INSUFFICIENT_GAS,
      `Insufficient gas on chain ${chainId}: required ${required}, available ${available}`,
      chainId,
      { required, available, ...details }
    );
  }
}
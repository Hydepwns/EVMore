import { FusionError, ErrorCode } from './base';

export class ValidationError extends FusionError {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: any,
    details?: Record<string, any>
  ) {
    super(ErrorCode.VALIDATION_FAILED, message, { field, value, ...details });
  }
}

export class InvalidAddressError extends FusionError {
  constructor(
    address: string,
    chainType: 'ethereum' | 'cosmos',
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.INVALID_ADDRESS,
      `Invalid ${chainType} address: ${address}`,
      { address, chainType, ...details }
    );
  }
}

export class InvalidAmountError extends FusionError {
  constructor(
    amount: string | number,
    reason: string,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.INVALID_AMOUNT,
      `Invalid amount ${amount}: ${reason}`,
      { amount, reason, ...details }
    );
  }
}
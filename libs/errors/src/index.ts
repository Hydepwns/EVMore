// Base error classes
import { ErrorCode, FusionError } from './base';
export { ErrorCode, FusionError } from './base';

// Configuration errors
export {
  ConfigurationError,
  ConfigMissingError,
  ConfigTypeMismatchError
} from './configuration';

// Validation errors
export {
  ValidationError,
  InvalidAddressError,
  InvalidAmountError
} from './validation';

// Chain errors
export {
  ChainError,
  ChainUnreachableError,
  ChainMismatchError,
  InsufficientGasError
} from './chain';

// HTLC errors
export {
  HTLCError,
  HTLCAlreadyExistsError,
  HTLCNotFoundError,
  HTLCExpiredError,
  InvalidSecretError
} from './htlc';

// IBC errors
export {
  IBCError,
  IBCChannelClosedError,
  IBCTimeoutError,
  IBCPacketFailedError
} from './ibc';

// Utility function to check if an error is a FusionError
export function isFusionError(error: any): error is FusionError {
  return error instanceof FusionError;
}

// Utility function to get error code from any error
export function getErrorCode(error: any): ErrorCode | null {
  if (isFusionError(error)) {
    return error.code;
  }
  return null;
}
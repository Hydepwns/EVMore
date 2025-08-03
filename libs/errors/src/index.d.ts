import { ErrorCode, FusionError } from './base';
export { ErrorCode, FusionError } from './base';
export { ConfigurationError, ConfigMissingError, ConfigTypeMismatchError } from './configuration';
export { ValidationError, InvalidAddressError, InvalidAmountError } from './validation';
export { ChainError, ChainUnreachableError, ChainMismatchError, InsufficientGasError } from './chain';
export { HTLCError, HTLCAlreadyExistsError, HTLCNotFoundError, HTLCExpiredError, InvalidSecretError } from './htlc';
export { IBCError, IBCChannelClosedError, IBCTimeoutError, IBCPacketFailedError } from './ibc';
export declare function isFusionError(error: any): error is FusionError;
export declare function getErrorCode(error: any): ErrorCode | null;
//# sourceMappingURL=index.d.ts.map
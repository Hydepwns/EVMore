import { FusionError, ErrorCode } from './base';
export declare class HTLCError extends FusionError {
    readonly orderId: string;
    constructor(code: ErrorCode, message: string, orderId: string, details?: Record<string, any>);
}
export declare class HTLCAlreadyExistsError extends HTLCError {
    constructor(orderId: string, chainId: string, details?: Record<string, any>);
}
export declare class HTLCNotFoundError extends HTLCError {
    constructor(orderId: string, chainId: string, details?: Record<string, any>);
}
export declare class HTLCExpiredError extends HTLCError {
    constructor(orderId: string, expiryTime: number, currentTime: number, details?: Record<string, any>);
}
export declare class InvalidSecretError extends HTLCError {
    constructor(orderId: string, reason: string, details?: Record<string, any>);
}
//# sourceMappingURL=htlc.d.ts.map
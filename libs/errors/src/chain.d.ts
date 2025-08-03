import { FusionError, ErrorCode } from './base';
export declare class ChainError extends FusionError {
    readonly chainId: string;
    constructor(code: ErrorCode, message: string, chainId: string, details?: Record<string, any>, cause?: Error);
}
export declare class ChainUnreachableError extends ChainError {
    constructor(chainId: string, endpoint: string, cause?: Error, details?: Record<string, any>);
}
export declare class ChainMismatchError extends ChainError {
    constructor(expectedChainId: string, actualChainId: string, details?: Record<string, any>);
}
export declare class InsufficientGasError extends ChainError {
    constructor(chainId: string, required: string, available: string, details?: Record<string, any>);
}
//# sourceMappingURL=chain.d.ts.map
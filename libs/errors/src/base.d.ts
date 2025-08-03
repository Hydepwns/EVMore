export declare enum ErrorCode {
    CONFIG_INVALID = 1001,
    CONFIG_MISSING = 1002,
    CONFIG_TYPE_MISMATCH = 1003,
    VALIDATION_FAILED = 2001,
    INVALID_ADDRESS = 2002,
    INVALID_AMOUNT = 2003,
    CHAIN_UNREACHABLE = 3001,
    CHAIN_MISMATCH = 3002,
    INSUFFICIENT_GAS = 3003,
    HTLC_ALREADY_EXISTS = 4001,
    HTLC_NOT_FOUND = 4002,
    HTLC_EXPIRED = 4003,
    INVALID_SECRET = 4004,
    IBC_CHANNEL_CLOSED = 5001,
    IBC_TIMEOUT = 5002,
    IBC_PACKET_FAILED = 5003
}
export declare abstract class FusionError extends Error {
    readonly code: ErrorCode;
    readonly details?: Record<string, any> | undefined;
    readonly cause?: Error | undefined;
    readonly timestamp: Date;
    constructor(code: ErrorCode, message: string, details?: Record<string, any> | undefined, cause?: Error | undefined);
    toJSON(): {
        name: string;
        code: ErrorCode;
        message: string;
        details: Record<string, any> | undefined;
        timestamp: Date;
        stack: string | undefined;
    };
}
//# sourceMappingURL=base.d.ts.map
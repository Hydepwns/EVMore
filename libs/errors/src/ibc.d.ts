import { FusionError, ErrorCode } from './base';
export declare class IBCError extends FusionError {
    readonly channelId: string;
    readonly sourceChainId: string;
    readonly destChainId: string;
    constructor(code: ErrorCode, message: string, channelId: string, sourceChainId: string, destChainId: string, details?: Record<string, any>);
}
export declare class IBCChannelClosedError extends IBCError {
    constructor(channelId: string, sourceChainId: string, destChainId: string, details?: Record<string, any>);
}
export declare class IBCTimeoutError extends IBCError {
    constructor(channelId: string, sourceChainId: string, destChainId: string, packetSequence: number, details?: Record<string, any>);
}
export declare class IBCPacketFailedError extends IBCError {
    constructor(channelId: string, sourceChainId: string, destChainId: string, reason: string, details?: Record<string, any>);
}
//# sourceMappingURL=ibc.d.ts.map
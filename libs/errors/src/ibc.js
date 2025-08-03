"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IBCPacketFailedError = exports.IBCTimeoutError = exports.IBCChannelClosedError = exports.IBCError = void 0;
const base_1 = require("./base");
class IBCError extends base_1.FusionError {
    constructor(code, message, channelId, sourceChainId, destChainId, details) {
        super(code, message, { channelId, sourceChainId, destChainId, ...details });
        this.channelId = channelId;
        this.sourceChainId = sourceChainId;
        this.destChainId = destChainId;
    }
}
exports.IBCError = IBCError;
class IBCChannelClosedError extends IBCError {
    constructor(channelId, sourceChainId, destChainId, details) {
        super(base_1.ErrorCode.IBC_CHANNEL_CLOSED, `IBC channel ${channelId} is closed between ${sourceChainId} and ${destChainId}`, channelId, sourceChainId, destChainId, details);
    }
}
exports.IBCChannelClosedError = IBCChannelClosedError;
class IBCTimeoutError extends IBCError {
    constructor(channelId, sourceChainId, destChainId, packetSequence, details) {
        super(base_1.ErrorCode.IBC_TIMEOUT, `IBC packet timeout on channel ${channelId} from ${sourceChainId} to ${destChainId}, sequence: ${packetSequence}`, channelId, sourceChainId, destChainId, { packetSequence, ...details });
    }
}
exports.IBCTimeoutError = IBCTimeoutError;
class IBCPacketFailedError extends IBCError {
    constructor(channelId, sourceChainId, destChainId, reason, details) {
        super(base_1.ErrorCode.IBC_PACKET_FAILED, `IBC packet failed on channel ${channelId}: ${reason}`, channelId, sourceChainId, destChainId, { reason, ...details });
    }
}
exports.IBCPacketFailedError = IBCPacketFailedError;
//# sourceMappingURL=ibc.js.map
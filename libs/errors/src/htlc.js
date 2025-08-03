"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidSecretError = exports.HTLCExpiredError = exports.HTLCNotFoundError = exports.HTLCAlreadyExistsError = exports.HTLCError = void 0;
const base_1 = require("./base");
class HTLCError extends base_1.FusionError {
    constructor(code, message, orderId, details) {
        super(code, message, { orderId, ...details });
        this.orderId = orderId;
    }
}
exports.HTLCError = HTLCError;
class HTLCAlreadyExistsError extends HTLCError {
    constructor(orderId, chainId, details) {
        super(base_1.ErrorCode.HTLC_ALREADY_EXISTS, `HTLC already exists for order ${orderId} on chain ${chainId}`, orderId, { chainId, ...details });
    }
}
exports.HTLCAlreadyExistsError = HTLCAlreadyExistsError;
class HTLCNotFoundError extends HTLCError {
    constructor(orderId, chainId, details) {
        super(base_1.ErrorCode.HTLC_NOT_FOUND, `HTLC not found for order ${orderId} on chain ${chainId}`, orderId, { chainId, ...details });
    }
}
exports.HTLCNotFoundError = HTLCNotFoundError;
class HTLCExpiredError extends HTLCError {
    constructor(orderId, expiryTime, currentTime, details) {
        super(base_1.ErrorCode.HTLC_EXPIRED, `HTLC for order ${orderId} has expired at ${new Date(expiryTime * 1000).toISOString()}`, orderId, { expiryTime, currentTime, ...details });
    }
}
exports.HTLCExpiredError = HTLCExpiredError;
class InvalidSecretError extends HTLCError {
    constructor(orderId, reason, details) {
        super(base_1.ErrorCode.INVALID_SECRET, `Invalid secret for order ${orderId}: ${reason}`, orderId, { reason, ...details });
    }
}
exports.InvalidSecretError = InvalidSecretError;
//# sourceMappingURL=htlc.js.map
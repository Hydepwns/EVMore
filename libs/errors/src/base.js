"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FusionError = exports.ErrorCode = void 0;
var ErrorCode;
(function (ErrorCode) {
    // Configuration errors (1xxx)
    ErrorCode[ErrorCode["CONFIG_INVALID"] = 1001] = "CONFIG_INVALID";
    ErrorCode[ErrorCode["CONFIG_MISSING"] = 1002] = "CONFIG_MISSING";
    ErrorCode[ErrorCode["CONFIG_TYPE_MISMATCH"] = 1003] = "CONFIG_TYPE_MISMATCH";
    // Validation errors (2xxx)
    ErrorCode[ErrorCode["VALIDATION_FAILED"] = 2001] = "VALIDATION_FAILED";
    ErrorCode[ErrorCode["INVALID_ADDRESS"] = 2002] = "INVALID_ADDRESS";
    ErrorCode[ErrorCode["INVALID_AMOUNT"] = 2003] = "INVALID_AMOUNT";
    // Chain errors (3xxx)
    ErrorCode[ErrorCode["CHAIN_UNREACHABLE"] = 3001] = "CHAIN_UNREACHABLE";
    ErrorCode[ErrorCode["CHAIN_MISMATCH"] = 3002] = "CHAIN_MISMATCH";
    ErrorCode[ErrorCode["INSUFFICIENT_GAS"] = 3003] = "INSUFFICIENT_GAS";
    // HTLC errors (4xxx)
    ErrorCode[ErrorCode["HTLC_ALREADY_EXISTS"] = 4001] = "HTLC_ALREADY_EXISTS";
    ErrorCode[ErrorCode["HTLC_NOT_FOUND"] = 4002] = "HTLC_NOT_FOUND";
    ErrorCode[ErrorCode["HTLC_EXPIRED"] = 4003] = "HTLC_EXPIRED";
    ErrorCode[ErrorCode["INVALID_SECRET"] = 4004] = "INVALID_SECRET";
    // IBC errors (5xxx)
    ErrorCode[ErrorCode["IBC_CHANNEL_CLOSED"] = 5001] = "IBC_CHANNEL_CLOSED";
    ErrorCode[ErrorCode["IBC_TIMEOUT"] = 5002] = "IBC_TIMEOUT";
    ErrorCode[ErrorCode["IBC_PACKET_FAILED"] = 5003] = "IBC_PACKET_FAILED";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
class FusionError extends Error {
    constructor(code, message, details, cause) {
        super(message);
        this.code = code;
        this.details = details;
        this.cause = cause;
        this.name = this.constructor.name;
        this.timestamp = new Date();
        // Maintain proper stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}
exports.FusionError = FusionError;
//# sourceMappingURL=base.js.map
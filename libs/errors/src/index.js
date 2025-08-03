"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IBCPacketFailedError = exports.IBCTimeoutError = exports.IBCChannelClosedError = exports.IBCError = exports.InvalidSecretError = exports.HTLCExpiredError = exports.HTLCNotFoundError = exports.HTLCAlreadyExistsError = exports.HTLCError = exports.InsufficientGasError = exports.ChainMismatchError = exports.ChainUnreachableError = exports.ChainError = exports.InvalidAmountError = exports.InvalidAddressError = exports.ValidationError = exports.ConfigTypeMismatchError = exports.ConfigMissingError = exports.ConfigurationError = exports.FusionError = exports.ErrorCode = void 0;
exports.isFusionError = isFusionError;
exports.getErrorCode = getErrorCode;
// Base error classes
const base_1 = require("./base");
var base_2 = require("./base");
Object.defineProperty(exports, "ErrorCode", { enumerable: true, get: function () { return base_2.ErrorCode; } });
Object.defineProperty(exports, "FusionError", { enumerable: true, get: function () { return base_2.FusionError; } });
// Configuration errors
var configuration_1 = require("./configuration");
Object.defineProperty(exports, "ConfigurationError", { enumerable: true, get: function () { return configuration_1.ConfigurationError; } });
Object.defineProperty(exports, "ConfigMissingError", { enumerable: true, get: function () { return configuration_1.ConfigMissingError; } });
Object.defineProperty(exports, "ConfigTypeMismatchError", { enumerable: true, get: function () { return configuration_1.ConfigTypeMismatchError; } });
// Validation errors
var validation_1 = require("./validation");
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return validation_1.ValidationError; } });
Object.defineProperty(exports, "InvalidAddressError", { enumerable: true, get: function () { return validation_1.InvalidAddressError; } });
Object.defineProperty(exports, "InvalidAmountError", { enumerable: true, get: function () { return validation_1.InvalidAmountError; } });
// Chain errors
var chain_1 = require("./chain");
Object.defineProperty(exports, "ChainError", { enumerable: true, get: function () { return chain_1.ChainError; } });
Object.defineProperty(exports, "ChainUnreachableError", { enumerable: true, get: function () { return chain_1.ChainUnreachableError; } });
Object.defineProperty(exports, "ChainMismatchError", { enumerable: true, get: function () { return chain_1.ChainMismatchError; } });
Object.defineProperty(exports, "InsufficientGasError", { enumerable: true, get: function () { return chain_1.InsufficientGasError; } });
// HTLC errors
var htlc_1 = require("./htlc");
Object.defineProperty(exports, "HTLCError", { enumerable: true, get: function () { return htlc_1.HTLCError; } });
Object.defineProperty(exports, "HTLCAlreadyExistsError", { enumerable: true, get: function () { return htlc_1.HTLCAlreadyExistsError; } });
Object.defineProperty(exports, "HTLCNotFoundError", { enumerable: true, get: function () { return htlc_1.HTLCNotFoundError; } });
Object.defineProperty(exports, "HTLCExpiredError", { enumerable: true, get: function () { return htlc_1.HTLCExpiredError; } });
Object.defineProperty(exports, "InvalidSecretError", { enumerable: true, get: function () { return htlc_1.InvalidSecretError; } });
// IBC errors
var ibc_1 = require("./ibc");
Object.defineProperty(exports, "IBCError", { enumerable: true, get: function () { return ibc_1.IBCError; } });
Object.defineProperty(exports, "IBCChannelClosedError", { enumerable: true, get: function () { return ibc_1.IBCChannelClosedError; } });
Object.defineProperty(exports, "IBCTimeoutError", { enumerable: true, get: function () { return ibc_1.IBCTimeoutError; } });
Object.defineProperty(exports, "IBCPacketFailedError", { enumerable: true, get: function () { return ibc_1.IBCPacketFailedError; } });
// Utility function to check if an error is a FusionError
function isFusionError(error) {
    return error instanceof base_1.FusionError;
}
// Utility function to get error code from any error
function getErrorCode(error) {
    if (isFusionError(error)) {
        return error.code;
    }
    return null;
}
//# sourceMappingURL=index.js.map
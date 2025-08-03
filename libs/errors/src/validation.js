"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidAmountError = exports.InvalidAddressError = exports.ValidationError = void 0;
const base_1 = require("./base");
class ValidationError extends base_1.FusionError {
    constructor(message, field, value, details) {
        super(base_1.ErrorCode.VALIDATION_FAILED, message, { field, value, ...details });
        this.field = field;
        this.value = value;
    }
}
exports.ValidationError = ValidationError;
class InvalidAddressError extends base_1.FusionError {
    constructor(address, chainType, details) {
        super(base_1.ErrorCode.INVALID_ADDRESS, `Invalid ${chainType} address: ${address}`, { address, chainType, ...details });
    }
}
exports.InvalidAddressError = InvalidAddressError;
class InvalidAmountError extends base_1.FusionError {
    constructor(amount, reason, details) {
        super(base_1.ErrorCode.INVALID_AMOUNT, `Invalid amount ${amount}: ${reason}`, { amount, reason, ...details });
    }
}
exports.InvalidAmountError = InvalidAmountError;
//# sourceMappingURL=validation.js.map
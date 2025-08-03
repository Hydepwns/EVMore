"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InsufficientGasError = exports.ChainMismatchError = exports.ChainUnreachableError = exports.ChainError = void 0;
const base_1 = require("./base");
class ChainError extends base_1.FusionError {
    constructor(code, message, chainId, details, cause) {
        super(code, message, { chainId, ...details }, cause);
        this.chainId = chainId;
    }
}
exports.ChainError = ChainError;
class ChainUnreachableError extends ChainError {
    constructor(chainId, endpoint, cause, details) {
        super(base_1.ErrorCode.CHAIN_UNREACHABLE, `Cannot reach chain ${chainId} at ${endpoint}`, chainId, { endpoint, ...details }, cause);
    }
}
exports.ChainUnreachableError = ChainUnreachableError;
class ChainMismatchError extends ChainError {
    constructor(expectedChainId, actualChainId, details) {
        super(base_1.ErrorCode.CHAIN_MISMATCH, `Chain ID mismatch: expected ${expectedChainId}, got ${actualChainId}`, expectedChainId, { actualChainId, ...details });
    }
}
exports.ChainMismatchError = ChainMismatchError;
class InsufficientGasError extends ChainError {
    constructor(chainId, required, available, details) {
        super(base_1.ErrorCode.INSUFFICIENT_GAS, `Insufficient gas on chain ${chainId}: required ${required}, available ${available}`, chainId, { required, available, ...details });
    }
}
exports.InsufficientGasError = InsufficientGasError;
//# sourceMappingURL=chain.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigTypeMismatchError = exports.ConfigMissingError = exports.ConfigurationError = void 0;
const base_1 = require("./base");
class ConfigurationError extends base_1.FusionError {
    constructor(message, details) {
        super(base_1.ErrorCode.CONFIG_INVALID, message, details);
    }
}
exports.ConfigurationError = ConfigurationError;
class ConfigMissingError extends base_1.FusionError {
    constructor(configKey, details) {
        super(base_1.ErrorCode.CONFIG_MISSING, `Configuration key missing: ${configKey}`, { configKey, ...details });
    }
}
exports.ConfigMissingError = ConfigMissingError;
class ConfigTypeMismatchError extends base_1.FusionError {
    constructor(configKey, expectedType, actualType, details) {
        super(base_1.ErrorCode.CONFIG_TYPE_MISMATCH, `Configuration type mismatch for ${configKey}: expected ${expectedType}, got ${actualType}`, { configKey, expectedType, actualType, ...details });
    }
}
exports.ConfigTypeMismatchError = ConfigTypeMismatchError;
//# sourceMappingURL=configuration.js.map
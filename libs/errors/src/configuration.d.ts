import { FusionError } from './base';
export declare class ConfigurationError extends FusionError {
    constructor(message: string, details?: Record<string, any>);
}
export declare class ConfigMissingError extends FusionError {
    constructor(configKey: string, details?: Record<string, any>);
}
export declare class ConfigTypeMismatchError extends FusionError {
    constructor(configKey: string, expectedType: string, actualType: string, details?: Record<string, any>);
}
//# sourceMappingURL=configuration.d.ts.map
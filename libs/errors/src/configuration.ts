import { FusionError, ErrorCode } from './base';

export class ConfigurationError extends FusionError {
  constructor(message: string, details?: Record<string, any>) {
    super(ErrorCode.CONFIG_INVALID, message, details);
  }
}

export class ConfigMissingError extends FusionError {
  constructor(configKey: string, details?: Record<string, any>) {
    super(
      ErrorCode.CONFIG_MISSING,
      `Configuration key missing: ${configKey}`,
      { configKey, ...details }
    );
  }
}

export class ConfigTypeMismatchError extends FusionError {
  constructor(
    configKey: string,
    expectedType: string,
    actualType: string,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.CONFIG_TYPE_MISMATCH,
      `Configuration type mismatch for ${configKey}: expected ${expectedType}, got ${actualType}`,
      { configKey, expectedType, actualType, ...details }
    );
  }
}
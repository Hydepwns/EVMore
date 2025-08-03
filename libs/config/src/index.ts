// Configuration interfaces
export * from './schema/interfaces';

// Configuration loader
import { ConfigLoader } from './loader/config-loader';
export { ConfigLoader, LoadOptions, ConfigSource } from './loader/config-loader';

// Configuration validation
export { ConfigValidator, ValidationResult } from './validators/config-validator';

// Default configurations
export { defaultConfig } from './defaults/config.default';

// Environment-specific configurations
export { developmentConfig } from './environments/development';
export { productionConfig } from './environments/production';
export { testConfig } from './environments/test';

// Convenience functions
export async function loadConfig(options?: { environment?: string }): Promise<import('./schema/interfaces').FusionConfig> {
  const loader = ConfigLoader.getInstance();
  return await loader.load(options);
}

export function getConfig(): import('./schema/interfaces').FusionConfig {
  const loader = ConfigLoader.getInstance();
  return loader.get();
}

export function clearConfig(): void {
  const loader = ConfigLoader.getInstance();
  loader.clear();
}

// Re-export common types from errors for convenience
export { ConfigurationError, ConfigMissingError, ConfigTypeMismatchError } from '@evmore/errors';
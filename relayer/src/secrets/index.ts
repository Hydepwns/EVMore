/**
 * Secrets management exports for the 1inch Fusion+ Cosmos Relayer
 * 
 * This module provides comprehensive secrets management with support for:
 * - AWS Secrets Manager for enterprise environments
 * - HashiCorp Vault for hybrid and on-premise deployments
 * - 1Password for secure personal and team deployments
 * - Environment variables for development and simple deployments
 * - Multi-provider fallback for high availability
 * - Automatic validation and audit logging
 */

// Core types and interfaces
export * from './types';

// Provider implementations
export { AWSSecretsProvider } from './aws-secrets-provider';
export { VaultSecretsProvider } from './vault-secrets-provider';
export { EnvSecretsProvider } from './env-secrets-provider';
export { OnePasswordSecretsProvider } from './onepassword-secrets-provider';

// Main secrets manager
export { SecretsManager } from './secrets-manager';

// Utility functions
export {
  createSecretsManager,
  getSecretsConfigFromEnv,
  validateSecretsConfig,
  getDefaultSecretsConfig
} from './utils';
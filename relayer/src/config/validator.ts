import { ethers } from 'ethers';
import { AppConfig, EthereumConfig, CosmosConfig, ChainRegistryConfig, RelayConfig, RecoveryConfig, GeneralConfig } from './index';
import { LogLevel } from '@evmore/interfaces';
import pino from 'pino';

const logger = pino({ name: 'ConfigValidator' });

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export class ConfigValidator {
  private errors: ValidationError[] = [];
  private warnings: ValidationError[] = [];

  /**
   * Validate the entire application configuration
   */
  async validate(config: AppConfig): Promise<{ valid: boolean; errors: ValidationError[]; warnings: ValidationError[] }> {
    this.errors = [];
    this.warnings = [];

    // Validate each section
    this.validateGeneralConfig(config.general);
    await this.validateEthereumConfig(config.ethereum);
    await this.validateCosmosConfig(config.cosmos);
    this.validateChainRegistryConfig(config.chainRegistry);
    this.validateRelayConfig(config.relay);
    this.validateRecoveryConfig(config.recovery);

    // Validate cross-configuration consistency
    this.validateCrossConfigConsistency(config);

    const valid = this.errors.length === 0;

    if (!valid) {
      logger.error('Configuration validation failed', { errors: this.errors });
    }

    if (this.warnings.length > 0) {
      logger.warn('Configuration warnings detected', { warnings: this.warnings });
    }

    return {
      valid,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  /**
   * Validate general configuration
   */
  private validateGeneralConfig(config: GeneralConfig): void {
    // Log level validation
    const validLogLevels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL];
    if (!validLogLevels.includes(config.logLevel)) {
      this.addError('general.logLevel', `Invalid log level. Must be one of: ${Object.values(LogLevel).join(', ')}`);
    }

    // Port validation
    if (config.port < 1 || config.port > 65535) {
      this.addError('general.port', 'Port must be between 1 and 65535');
    }

    // Shutdown timeout validation
    if (config.shutdownTimeout < 0) {
      this.addError('general.shutdownTimeout', 'Shutdown timeout must be non-negative');
    }

    if (config.shutdownTimeout < 10000) {
      this.addWarning('general.shutdownTimeout', 'Shutdown timeout less than 10 seconds may not allow graceful shutdown');
    }
  }

  /**
   * Validate Ethereum configuration
   */
  private async validateEthereumConfig(config: EthereumConfig): Promise<void> {
    // RPC URL validation
    if (!this.isValidUrl(config.rpcUrl)) {
      this.addError('ethereum.rpcUrl', 'Invalid RPC URL format');
    }

    // Contract address validation
    if (!ethers.utils.isAddress(config.htlcContractAddress)) {
      this.addError('ethereum.htlcContractAddress', 'Invalid Ethereum contract address');
    }

    if (config.resolverContractAddress && !ethers.utils.isAddress(config.resolverContractAddress)) {
      this.addError('ethereum.resolverContractAddress', 'Invalid Ethereum resolver contract address');
    }

    // Private key validation
    if (!config.privateKey || config.privateKey.length === 0) {
      this.addError('ethereum.privateKey', 'Private key is required');
    } else {
      try {
        new ethers.Wallet(config.privateKey);
      } catch (e) {
        this.addError('ethereum.privateKey', 'Invalid private key format');
      }
    }

    // Chain ID validation
    if (config.chainId <= 0) {
      this.addError('ethereum.chainId', 'Chain ID must be positive');
    }

    // Confirmations validation
    if (config.confirmations < 0) {
      this.addError('ethereum.confirmations', 'Confirmations must be non-negative');
    }

    if (config.confirmations === 0) {
      this.addWarning('ethereum.confirmations', 'Zero confirmations may lead to reorg issues');
    }

    // Gas limit validation
    if (config.gasLimit < 21000) {
      this.addError('ethereum.gasLimit', 'Gas limit must be at least 21000');
    }

    if (config.gasLimit > 10000000) {
      this.addWarning('ethereum.gasLimit', 'Gas limit seems unusually high');
    }

    // Gas price validation
    if (config.gasPrice) {
      try {
        ethers.utils.parseUnits(config.gasPrice, 'gwei');
      } catch (e) {
        this.addError('ethereum.gasPrice', 'Invalid gas price format');
      }
    }

    // Test RPC connection if not in test mode
    if (process.env.NODE_ENV !== 'test') {
      try {
        const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
        const network = await provider.getNetwork();
        if (network.chainId !== config.chainId) {
          this.addError('ethereum.chainId', `Chain ID mismatch. Expected ${config.chainId}, got ${network.chainId}`);
        }
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown error';
        this.addWarning('ethereum.rpcUrl', `Could not connect to Ethereum RPC: ${errorMessage}`);
      }
    }
  }

  /**
   * Validate Cosmos configuration
   */
  private async validateCosmosConfig(config: CosmosConfig): Promise<void> {
    // RPC URL validation
    if (!this.isValidUrl(config.rpcUrl)) {
      this.addError('cosmos.rpcUrl', 'Invalid RPC URL format');
    }

    // REST URL validation
    if (!this.isValidUrl(config.restUrl)) {
      this.addError('cosmos.restUrl', 'Invalid REST URL format');
    }

    // Chain ID validation
    if (!config.chainId || config.chainId.length === 0) {
      this.addError('cosmos.chainId', 'Chain ID is required');
    }

    // Contract address validation (basic check for Bech32 format)
    if (!this.isValidCosmosAddress(config.htlcContractAddress, config.addressPrefix)) {
      this.addError('cosmos.htlcContractAddress', 'Invalid Cosmos contract address');
    }

    // Mnemonic validation
    if (!config.mnemonic || config.mnemonic.trim().length === 0) {
      this.addError('cosmos.mnemonic', 'Mnemonic is required');
    } else {
      const words = config.mnemonic.trim().split(' ');
      if (words.length !== 12 && words.length !== 24) {
        this.addError('cosmos.mnemonic', 'Mnemonic must be 12 or 24 words');
      }
    }

    // Gas price validation
    const gasPriceRegex = /^\d+(\.\d+)?[a-z]+$/;
    if (!gasPriceRegex.test(config.gasPrice)) {
      this.addError('cosmos.gasPrice', 'Invalid gas price format. Expected format: <amount><denom>');
    }

    // Gas limit validation
    if (config.gasLimit < 100000) {
      this.addWarning('cosmos.gasLimit', 'Gas limit seems low for Cosmos transactions');
    }

    if (config.gasLimit > 10000000) {
      this.addWarning('cosmos.gasLimit', 'Gas limit seems unusually high');
    }

    // Denom validation
    if (!config.denom || !config.denom.match(/^[a-z]+$/)) {
      this.addError('cosmos.denom', 'Invalid denom format');
    }

    // Address prefix validation
    if (!config.addressPrefix || !config.addressPrefix.match(/^[a-z]+$/)) {
      this.addError('cosmos.addressPrefix', 'Invalid address prefix format');
    }

    // Additional chains validation removed - not part of current CosmosConfig interface
  }

  /**
   * Validate additional Cosmos chain configuration
   */
  private async validateCosmosChainConfig(config: CosmosConfig, prefix: string): Promise<void> {
    // Validate same fields as main Cosmos config
    if (!this.isValidUrl(config.rpcUrl)) {
      this.addError(`${prefix}.rpcUrl`, 'Invalid RPC URL format');
    }

    if (!this.isValidUrl(config.restUrl)) {
      this.addError(`${prefix}.restUrl`, 'Invalid REST URL format');
    }

    if (!config.chainId || config.chainId.length === 0) {
      this.addError(`${prefix}.chainId`, 'Chain ID is required');
    }

    if (!this.isValidCosmosAddress(config.htlcContractAddress, config.addressPrefix)) {
      this.addError(`${prefix}.htlcContractAddress`, 'Invalid Cosmos contract address');
    }
  }

  /**
   * Validate Chain Registry configuration
   */
  private validateChainRegistryConfig(config: ChainRegistryConfig): void {
    // Base URL validation
    if (!this.isValidUrl(config.baseUrl)) {
      this.addError('chainRegistry.baseUrl', 'Invalid base URL format');
    }

    // Cache timeout validation
    if (config.cacheTimeout < 60) {
      this.addWarning('chainRegistry.cacheTimeout', 'Cache timeout less than 60 seconds may cause excessive API calls');
    }

    if (config.cacheTimeout > 86400) {
      this.addWarning('chainRegistry.cacheTimeout', 'Cache timeout greater than 24 hours may lead to stale data');
    }

    // Refresh interval validation
    if (config.refreshInterval < config.cacheTimeout) {
      this.addWarning('chainRegistry.refreshInterval', 'Refresh interval less than cache timeout is inefficient');
    }

    if (config.refreshInterval < 60) {
      this.addError('chainRegistry.refreshInterval', 'Refresh interval must be at least 60 seconds');
    }
  }

  /**
   * Validate Relay configuration
   */
  private validateRelayConfig(config: RelayConfig): void {
    // Max retries validation
    if (config.maxRetries < 0) {
      this.addError('relay.maxRetries', 'Max retries must be non-negative');
    }

    if (config.maxRetries > 10) {
      this.addWarning('relay.maxRetries', 'High retry count may delay failure detection');
    }

    // Retry delay validation
    if (config.retryDelay < 1000) {
      this.addWarning('relay.retryDelay', 'Retry delay less than 1 second may overload the system');
    }

    if (config.retryDelay > 60000) {
      this.addWarning('relay.retryDelay', 'Retry delay greater than 1 minute may miss time-sensitive operations');
    }

    // Batch size validation
    if (config.batchSize < 1) {
      this.addError('relay.batchSize', 'Batch size must be at least 1');
    }

    if (config.batchSize > 100) {
      this.addWarning('relay.batchSize', 'Large batch sizes may cause timeout issues');
    }

    // Processing interval validation
    if (config.processingInterval < 1000) {
      this.addWarning('relay.processingInterval', 'Processing interval less than 1 second may overload the system');
    }

    // Timeout buffer validation
    if (config.timeoutBuffer < 300) {
      this.addError('relay.timeoutBuffer', 'Timeout buffer must be at least 300 seconds (5 minutes)');
    }

    if (config.timeoutBuffer > 7200) {
      this.addWarning('relay.timeoutBuffer', 'Large timeout buffer may delay refund opportunities');
    }
  }

  /**
   * Validate Recovery configuration
   */
  private validateRecoveryConfig(config: RecoveryConfig): void {
    // Check interval validation
    if (config.checkInterval < 10000) {
      this.addWarning('recovery.checkInterval', 'Check interval less than 10 seconds may overload the system');
    }

    if (config.checkInterval > 300000) {
      this.addWarning('recovery.checkInterval', 'Check interval greater than 5 minutes may miss refund opportunities');
    }

    // Refund buffer validation
    if (config.refundBuffer < 600) {
      this.addError('recovery.refundBuffer', 'Refund buffer must be at least 600 seconds (10 minutes)');
    }

    if (config.refundBuffer > config.refundBuffer) {
      this.addError('recovery.refundBuffer', 'Refund buffer cannot be greater than relay timeout buffer');
    }
  }

  /**
   * Validate cross-configuration consistency
   */
  private validateCrossConfigConsistency(config: AppConfig): void {
    // Ensure recovery refund buffer is less than relay timeout buffer
    if (config.recovery.refundBuffer >= config.relay.timeoutBuffer) {
      this.addError('recovery.refundBuffer', 'Recovery refund buffer must be less than relay timeout buffer');
    }

    // Ensure processing interval allows for batch processing
    const minProcessingTime = config.relay.batchSize * 100; // Assume 100ms per swap minimum
    if (config.relay.processingInterval < minProcessingTime) {
      this.addWarning('relay.processingInterval', `Processing interval may be too short for batch size of ${config.relay.batchSize}`);
    }

    // Check if Ethereum and Cosmos endpoints are both testnet or mainnet
    if (this.isTestnet(config.ethereum.chainId) !== this.isTestnetChainId(config.cosmos.chainId)) {
      this.addWarning('config', 'Ethereum and Cosmos appear to be on different network types (mainnet/testnet)');
    }
  }

  /**
   * Helper: Check if URL is valid
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper: Check if Cosmos address is valid
   */
  private isValidCosmosAddress(address: string, expectedPrefix: string): boolean {
    if (!address || address.length === 0) {
      return false;
    }

    // Basic Bech32 format check
    if (!address.startsWith(expectedPrefix)) {
      return false;
    }

    // Check length (typically 45-47 characters)
    if (address.length < 40 || address.length > 50) {
      return false;
    }

    // Check allowed characters
    const allowedChars = /^[a-z0-9]+$/;
    return allowedChars.test(address);
  }

  /**
   * Helper: Check if Ethereum chain ID is testnet
   */
  private isTestnet(chainId: number): boolean {
    const testnetChainIds = [1337, 31337, 5, 11155111, 80001, 421613]; // Local, Hardhat, Goerli, Sepolia, Mumbai, Arbitrum Goerli
    return testnetChainIds.includes(chainId);
  }

  /**
   * Helper: Check if Cosmos chain ID is testnet
   */
  private isTestnetChainId(chainId: string): boolean {
    return chainId.includes('test') || chainId.includes('devnet') || chainId === 'testing';
  }

  /**
   * Add validation error
   */
  private addError(field: string, message: string): void {
    this.errors.push({ field, message, severity: 'error' });
  }

  /**
   * Add validation warning
   */
  private addWarning(field: string, message: string): void {
    this.warnings.push({ field, message, severity: 'warning' });
  }

  /**
   * Format validation results for display
   */
  static formatResults(results: { valid: boolean; errors: ValidationError[]; warnings: ValidationError[] }): string {
    const lines: string[] = [];

    if (results.valid) {
      lines.push('✅ Configuration is valid');
    } else {
      lines.push('❌ Configuration validation failed');
    }

    if (results.errors.length > 0) {
      lines.push('\nErrors:');
      results.errors.forEach(error => {
        lines.push(`  ❌ ${error.field}: ${error.message}`);
      });
    }

    if (results.warnings.length > 0) {
      lines.push('\nWarnings:');
      results.warnings.forEach(warning => {
        lines.push(`  ⚠️  ${warning.field}: ${warning.message}`);
      });
    }

    return lines.join('\n');
  }
}
/**
 * New Configuration System for Relayer
 * Uses @evmore/config with backward compatibility
 */

import { ConfigLoader, FusionConfig } from '@evmore/config';
import { Logger } from '@evmore/interfaces';
import { ConfigurationError } from '@evmore/errors';

// Legacy compatibility
import { Config as LegacyConfig, AppConfig as LegacyAppConfig } from '../config';
import { 
  ConfigCompatibilityLayer, 
  adaptLegacyConfig,
  adaptToLegacyConfig 
} from '../migration/config-adapter';

export class RelayerConfigManager {
  private static instance: RelayerConfigManager;
  private configLoader: ConfigLoader;
  private fusionConfig: FusionConfig | null = null;
  private compatibilityLayer: ConfigCompatibilityLayer | null = null;
  private logger?: Logger;
  
  private constructor() {
    this.configLoader = ConfigLoader.getInstance();
  }
  
  static getInstance(): RelayerConfigManager {
    if (!this.instance) {
      this.instance = new RelayerConfigManager();
    }
    return this.instance;
  }
  
  /**
   * Initialize configuration - tries new system first, falls back to legacy
   */
  async initialize(logger?: Logger): Promise<void> {
    this.logger = logger;
    
    try {
      // Try to load using new configuration system
      this.fusionConfig = await this.configLoader.load({
        environment: process.env.NODE_ENV as any || 'development',
        allowEnvOverrides: true
      });
      
      this.compatibilityLayer = new ConfigCompatibilityLayer(this.fusionConfig);
      
      this.logger?.info('Configuration loaded using new @evmore/config system');
      
    } catch (error) {
      this.logger?.warn('Failed to load new configuration, falling back to legacy system', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      
      // Fallback to legacy configuration
      const legacyConfig = await LegacyConfig.load();
      this.fusionConfig = adaptLegacyConfig(legacyConfig);
      this.compatibilityLayer = new ConfigCompatibilityLayer(this.fusionConfig);
      
      this.logger?.info('Configuration loaded using legacy system with adaptation');
    }
  }
  
  /**
   * Get the new FusionConfig
   */
  getFusionConfig(): FusionConfig {
    if (!this.fusionConfig) {
      throw new ConfigurationError('Configuration not initialized. Call initialize() first.');
    }
    return this.fusionConfig;
  }
  
  /**
   * Get legacy AppConfig for backward compatibility
   */
  getLegacyConfig(): LegacyAppConfig {
    if (!this.compatibilityLayer) {
      throw new ConfigurationError('Configuration not initialized. Call initialize() first.');
    }
    return this.compatibilityLayer.getLegacyConfig();
  }
  
  /**
   * Get specific configuration sections (backward compatible)
   */
  getEthereumConfig() {
    return this.compatibilityLayer?.getEthereumConfig();
  }
  
  getCosmosConfig() {
    return this.compatibilityLayer?.getCosmosConfig();
  }
  
  getRelayConfig() {
    return this.compatibilityLayer?.getRelayConfig();
  }
  
  getRecoveryConfig() {
    return this.compatibilityLayer?.getRecoveryConfig();
  }
  
  /**
   * Validate current configuration
   */
  async validateConfig(): Promise<void> {
    if (!this.fusionConfig) {
      throw new ConfigurationError('Configuration not loaded');
    }
    
    // The ConfigLoader already validates, but we can add relayer-specific validation here
    const ethereum = this.fusionConfig.networks.ethereum;
    const cosmos = this.fusionConfig.networks.cosmos[0];
    
    const errors: string[] = [];
    
    // Critical validations
    if (!ethereum.contracts.htlc) {
      errors.push('Ethereum HTLC contract address is required');
    }
    
    if (!cosmos?.contracts.htlc) {
      errors.push('Cosmos HTLC contract address is required');
    }
    
    if (!process.env.ETHEREUM_PRIVATE_KEY && !process.env.ETHEREUM_MNEMONIC) {
      errors.push('Ethereum signing key (ETHEREUM_PRIVATE_KEY or ETHEREUM_MNEMONIC) is required');
    }
    
    if (!process.env.COSMOS_MNEMONIC) {
      errors.push('Cosmos mnemonic (COSMOS_MNEMONIC) is required');
    }
    
    // Performance validations (warnings)
    const relayer = this.fusionConfig.services.relayer;
    if (relayer.batchSize > 50) {
      this.logger?.warn('Large batch size may impact performance', { batchSize: relayer.batchSize });
    }
    
    if (relayer.timeoutBufferSeconds < 300) {
      this.logger?.warn('Short timeout buffer may cause failed swaps', { 
        timeoutBuffer: relayer.timeoutBufferSeconds 
      });
    }
    
    if (errors.length > 0) {
      throw new ConfigurationError(`Relayer configuration validation failed: ${errors.join(', ')}`);
    }
  }
  
  /**
   * Reload configuration (useful for development)
   */
  async reload(): Promise<void> {
    this.fusionConfig = null;
    this.compatibilityLayer = null;
    await this.initialize(this.logger);
  }
  
  /**
   * Get configuration summary for logging
   */
  getConfigSummary(): Record<string, any> {
    if (!this.fusionConfig) {
      return { status: 'not_initialized' };
    }
    
    const ethereum = this.fusionConfig.networks.ethereum;
    const cosmos = this.fusionConfig.networks.cosmos[0];
    
    return {
      environment: this.fusionConfig.environment.name,
      ethereum: {
        chainId: ethereum.chainId,
        name: ethereum.name,
        hasHtlcContract: !!ethereum.contracts.htlc,
        confirmations: ethereum.confirmations
      },
      cosmos: {
        chainId: cosmos?.chainId,
        name: cosmos?.name,
        hasHtlcContract: !!cosmos?.contracts.htlc,
        addressPrefix: cosmos?.addressPrefix
      },
      relayer: {
        maxRetries: this.fusionConfig.services.relayer.maxRetries,
        batchSize: this.fusionConfig.services.relayer.batchSize,
        timeoutBuffer: this.fusionConfig.services.relayer.timeoutBufferSeconds
      },
      monitoring: {
        metricsEnabled: this.fusionConfig.monitoring.metrics.enabled,
        tracingEnabled: this.fusionConfig.monitoring.tracing.enabled
      }
    };
  }
}

/**
 * Convenience functions for backward compatibility
 */

// Global instance for easy access
let globalConfigManager: RelayerConfigManager | null = null;

export async function initializeRelayerConfig(logger?: Logger): Promise<void> {
  globalConfigManager = RelayerConfigManager.getInstance();
  await globalConfigManager.initialize(logger);
}

export function getRelayerConfig(): RelayerConfigManager {
  if (!globalConfigManager) {
    throw new ConfigurationError('Relayer configuration not initialized. Call initializeRelayerConfig() first.');
  }
  return globalConfigManager;
}

// Legacy compatibility helpers
export function getLegacyAppConfig(): LegacyAppConfig {
  return getRelayerConfig().getLegacyConfig();
}

export function getEthereumConfig() {
  return getRelayerConfig().getEthereumConfig();
}

export function getCosmosConfig() {
  return getRelayerConfig().getCosmosConfig();
}

export function getRelayConfig() {
  return getRelayerConfig().getRelayConfig();
}

export function getRecoveryConfig() {
  return getRelayerConfig().getRecoveryConfig();
}

// New config system helpers
export function getFusionConfig(): FusionConfig {
  return getRelayerConfig().getFusionConfig();
}

export async function validateRelayerConfig(): Promise<void> {
  await getRelayerConfig().validateConfig();
}

export function getConfigSummary(): Record<string, any> {
  return getRelayerConfig().getConfigSummary();
}
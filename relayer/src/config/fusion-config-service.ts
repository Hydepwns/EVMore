/**
 * Configuration service using @evmore/config
 * This is the new standard configuration for the relayer
 */

import { FusionConfig, ConfigLoader, loadConfig, getConfig as getFusionConfig } from '@evmore/config';
import { AppConfig } from './index';
import { appConfigToFusionConfig, fusionConfigToAppConfig } from './config-adapter';
import * as fs from 'fs';
import * as path from 'path';

export class FusionConfigService {
  private static instance: FusionConfigService;
  private configLoader: ConfigLoader;
  private config: FusionConfig | null = null;
  
  private constructor() {
    this.configLoader = ConfigLoader.getInstance();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): FusionConfigService {
    if (!FusionConfigService.instance) {
      FusionConfigService.instance = new FusionConfigService();
    }
    return FusionConfigService.instance;
  }
  
  /**
   * Load configuration from environment and files
   */
  async loadConfig(): Promise<FusionConfig> {
    if (this.config) {
      return this.config;
    }
    
    // Load using the ConfigLoader
    try {
      this.config = await loadConfig();
    } catch (error) {
      // Fall back to legacy AppConfig and convert
      const { Config } = await import('./index');
      const appConfig = await Config.load();
      this.config = appConfigToFusionConfig(appConfig);
    }
    
    if (!this.config) {
      throw new Error('Failed to load configuration');
    }
    
    return this.config;
  }
  
  /**
   * Get current configuration
   */
  getConfig(): FusionConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.config;
  }
  
  /**
   * Get configuration as legacy AppConfig for backward compatibility
   */
  getAppConfig(): AppConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return fusionConfigToAppConfig(this.config);
  }
  
  /**
   * Update configuration at runtime
   */
  async updateConfig(updates: Partial<FusionConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    
    // Merge updates with existing config
    this.config = {
      ...this.config,
      ...updates
    } as FusionConfig;
  }
  
  /**
   * Get specific service configuration
   */
  getServiceConfig<K extends keyof FusionConfig['services']>(
    service: K
  ): FusionConfig['services'][K] {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.config.services[service];
  }
  
  /**
   * Get network configuration
   */
  getNetworkConfig(type: 'ethereum' | 'cosmos'): any {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    
    if (type === 'ethereum') {
      return this.config.networks.ethereum;
    } else {
      return this.config.networks.cosmos;
    }
  }
  
  /**
   * Get environment configuration
   */
  getEnvironment(): FusionConfig['environment'] {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.config.environment;
  }
  
  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: keyof FusionConfig['features']): boolean {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return Boolean(this.config.features[feature]);
  }
  
  /**
   * Save current configuration to file
   */
  async saveConfig(filepath?: string): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    
    const configPath = filepath || process.env.FUSION_CONFIG_PATH || 
                      path.join(process.cwd(), 'fusion.config.json');
    
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }
}
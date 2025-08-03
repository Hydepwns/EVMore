import * as fs from 'fs/promises';
import * as path from 'path';
import { FusionConfig } from '../schema/interfaces';
import { ConfigurationError } from '@evmore/errors';
import { ConfigValidator } from '../validators/config-validator';
import { defaultConfig } from '../defaults/config.default';
import { developmentConfig } from '../environments/development';
import { productionConfig } from '../environments/production';
import { testConfig } from '../environments/test';

export interface LoadOptions {
  environment?: string;
  localConfigPath?: string;
  overrides?: Partial<FusionConfig>;
  allowEnvOverrides?: boolean;
}

export interface ConfigSource {
  type: 'defaults' | 'environment' | 'local' | 'runtime';
  priority: number;
  name?: string;
  path?: string;
  config?: Partial<FusionConfig>;
}

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: FusionConfig | null = null;
  private validators: ConfigValidator[] = [];
  private builtInValidator = new ConfigValidator();
  
  static getInstance(): ConfigLoader {
    if (!this.instance) {
      this.instance = new ConfigLoader();
    }
    return this.instance;
  }
  
  /**
   * Load configuration from multiple sources
   */
  async load(options: LoadOptions = {}): Promise<FusionConfig> {
    const sources = this.determineSources(options);
    let config = this.deepClone(defaultConfig);
    
    // Layer configurations in order of precedence
    for (const source of sources) {
      const sourceConfig = await this.loadFromSource(source);
      if (sourceConfig) {
        config = this.mergeConfigs(config, sourceConfig);
      }
    }
    
    // Apply environment variable overrides
    if (options.allowEnvOverrides !== false) {
      config = this.applyEnvOverrides(config);
    }
    
    // Validate final configuration
    await this.validate(config);
    
    this.config = config;
    return config;
  }
  
  /**
   * Get current configuration
   */
  get(): FusionConfig {
    if (!this.config) {
      throw new ConfigurationError('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }
  
  /**
   * Register custom validator
   */
  registerValidator(validator: ConfigValidator): void {
    this.validators.push(validator);
  }
  
  /**
   * Clear cached configuration
   */
  clear(): void {
    this.config = null;
  }
  
  private determineSources(options: LoadOptions): ConfigSource[] {
    const sources: ConfigSource[] = [];
    
    // 1. Built-in defaults (always loaded)
    sources.push({ type: 'defaults', priority: 0 });
    
    // 2. Environment-specific config
    const env = options.environment || process.env.NODE_ENV || 'development';
    sources.push({ type: 'environment', name: env, priority: 1 });
    
    // 3. Local overrides (if exists)
    const localPath = options.localConfigPath || this.findLocalConfig();
    if (localPath) {
      sources.push({ type: 'local', path: localPath, priority: 2 });
    }
    
    // 4. Runtime overrides
    if (options.overrides) {
      sources.push({ type: 'runtime', config: options.overrides, priority: 3 });
    }
    
    return sources.sort((a, b) => a.priority - b.priority);
  }
  
  private async loadFromSource(source: ConfigSource): Promise<Partial<FusionConfig> | null> {
    switch (source.type) {
      case 'defaults':
        return defaultConfig;
        
      case 'environment':
        return this.loadEnvironmentConfig(source.name!);
        
      case 'local':
        return await this.loadLocalConfig(source.path!);
        
      case 'runtime':
        return source.config || null;
        
      default:
        return null;
    }
  }
  
  private loadEnvironmentConfig(environment: string): Partial<FusionConfig> | null {
    switch (environment) {
      case 'development':
        return developmentConfig;
      case 'production':
        return productionConfig;
      case 'test':
        return testConfig;
      default:
        return null;
    }
  }
  
  private async loadLocalConfig(configPath: string): Promise<Partial<FusionConfig> | null> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      return config;
    } catch (error) {
      // Local config is optional, don't throw
      return null;
    }
  }
  
  private findLocalConfig(): string | null {
    const possiblePaths = [
      './config.local.json',
      './config/local.json',
      path.join(process.cwd(), 'config.local.json'),
      path.join(process.cwd(), 'config', 'local.json')
    ];
    
    for (const configPath of possiblePaths) {
      try {
        // Use synchronous check since this is called during initialization
        require('fs').accessSync(configPath);
        return configPath;
      } catch {
        // File doesn't exist, continue
      }
    }
    
    return null;
  }
  
  private mergeConfigs(base: FusionConfig, override: Partial<FusionConfig>): FusionConfig {
    return this.deepMerge(base, override);
  }
  
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
          result[key] = this.deepMerge(target[key], source[key]);
        } else {
          result[key] = this.deepClone(source[key]);
        }
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
  
  private deepClone(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item));
    }
    
    const cloned: any = {};
    for (const key in obj) {
      cloned[key] = this.deepClone(obj[key]);
    }
    
    return cloned;
  }
  
  private applyEnvOverrides(config: FusionConfig): FusionConfig {
    const result = this.deepClone(config);
    
    // Map environment variables to config paths
    const envMappings = {
      'ETHEREUM_RPC_URL': 'networks.ethereum.rpcUrl',
      'ETHEREUM_CHAIN_ID': 'networks.ethereum.chainId',
      'ETHEREUM_HTLC_CONTRACT': 'networks.ethereum.contracts.htlc',
      'OSMOSIS_RPC_URL': 'networks.cosmos.0.rpcUrl',
      'OSMOSIS_REST_URL': 'networks.cosmos.0.restUrl',
      'LOG_LEVEL': 'environment.logLevel',
      'DEBUG': 'environment.debug',
      'RELAYER_MAX_RETRIES': 'services.relayer.maxRetries',
      'RELAYER_BATCH_SIZE': 'services.relayer.batchSize',
      'METRICS_ENABLED': 'monitoring.metrics.enabled',
      'METRICS_PORT': 'monitoring.metrics.port',
      'RATE_LIMIT_ENABLED': 'security.rateLimit.enabled',
      'RATE_LIMIT_MAX_REQUESTS': 'security.rateLimit.maxRequests'
    };
    
    for (const [envVar, configPath] of Object.entries(envMappings)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        this.setByPath(result, configPath, this.parseEnvValue(value));
      }
    }
    
    return result;
  }
  
  private setByPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      
      // Handle array indices
      if (/^\d+$/.test(key)) {
        const index = parseInt(key);
        if (!Array.isArray(current)) {
          return; // Can't set array index on non-array
        }
        if (!current[index]) {
          current[index] = {};
        }
        current = current[index];
      } else {
        if (!current[key]) {
          current[key] = {};
        }
        current = current[key];
      }
    }
    
    const finalKey = keys[keys.length - 1];
    if (/^\d+$/.test(finalKey) && Array.isArray(current)) {
      current[parseInt(finalKey)] = value;
    } else {
      current[finalKey] = value;
    }
  }
  
  private parseEnvValue(value: string): any {
    // Try to parse as boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    
    // Try to parse as number
    const numValue = Number(value);
    if (!isNaN(numValue) && isFinite(numValue)) {
      return numValue;
    }
    
    // Try to parse as JSON
    try {
      return JSON.parse(value);
    } catch {
      // Return as string
      return value;
    }
  }
  
  private async validate(config: FusionConfig): Promise<void> {
    // Run built-in validator
    const result = await this.builtInValidator.validate(config);
    
    // Run custom validators
    for (const validator of this.validators) {
      const customResult = await validator.validate(config);
      result.errors.push(...customResult.errors);
      result.warnings.push(...customResult.warnings);
    }
    
    // Log warnings
    if (result.warnings.length > 0) {
      console.warn('Configuration warnings:');
      result.warnings.forEach(warning => {
        console.warn(`  - ${warning.message} (${warning.field})`);
      });
    }
    
    // Throw if there are errors
    if (result.errors.length > 0) {
      const errorMessages = result.errors.map(e => `${e.field}: ${e.message}`);
      throw new ConfigurationError(
        `Configuration validation failed:\n${errorMessages.join('\n')}`,
        {
          errors: result.errors.map(e => e.toJSON()),
          warnings: result.warnings.map(w => w.toJSON())
        }
      );
    }
  }
}
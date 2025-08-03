import { FusionConfig, EthereumNetworkConfig, CosmosNetworkConfig } from '../schema/interfaces';
import { ValidationError } from '@evmore/errors';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export class ConfigValidator {
  async validate(config: FusionConfig): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    
    // Environment validation
    this.validateEnvironment(config, errors);
    
    // Network validation
    await this.validateNetworks(config, errors, warnings);
    
    // Services validation
    this.validateServices(config, errors, warnings);
    
    // Security validation
    this.validateSecurity(config, errors, warnings);
    
    // Monitoring validation
    this.validateMonitoring(config, errors, warnings);
    
    // Cross-config validation
    this.validateCrossConfig(config, errors, warnings);
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  private validateEnvironment(config: FusionConfig, errors: ValidationError[]): void {
    const env = config.environment;
    
    const validEnvs = ['development', 'staging', 'production', 'test'];
    if (!validEnvs.includes(env.name)) {
      errors.push(new ValidationError(
        `Invalid environment: ${env.name}. Must be one of: ${validEnvs.join(', ')}`,
        'environment.name',
        env.name
      ));
    }
    
    if (typeof env.debug !== 'boolean') {
      errors.push(new ValidationError(
        'Environment debug must be a boolean',
        'environment.debug',
        env.debug
      ));
    }
    
    const validLogLevels = [0, 1, 2, 3, 4]; // LogLevel enum values
    if (!validLogLevels.includes(env.logLevel)) {
      errors.push(new ValidationError(
        `Invalid log level: ${env.logLevel}. Must be 0-4`,
        'environment.logLevel',
        env.logLevel
      ));
    }
  }
  
  private async validateNetworks(
    config: FusionConfig, 
    errors: ValidationError[], 
    warnings: ValidationError[]
  ): Promise<void> {
    // Validate Ethereum network
    await this.validateEthereumNetwork(config.networks.ethereum, errors, warnings);
    
    // Validate Cosmos networks
    if (!Array.isArray(config.networks.cosmos) || config.networks.cosmos.length === 0) {
      errors.push(new ValidationError(
        'At least one Cosmos network must be configured',
        'networks.cosmos',
        config.networks.cosmos
      ));
    } else {
      for (let i = 0; i < config.networks.cosmos.length; i++) {
        await this.validateCosmosNetwork(
          config.networks.cosmos[i], 
          `networks.cosmos[${i}]`, 
          errors, 
          warnings
        );
      }
    }
    
    // Validate IBC connections
    this.validateIBCConnections(config.networks.cosmos, errors, warnings);
  }
  
  private async validateEthereumNetwork(
    network: EthereumNetworkConfig,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): Promise<void> {
    // Chain ID validation
    if (!network.chainId || network.chainId <= 0) {
      errors.push(new ValidationError(
        'Ethereum chain ID must be a positive number',
        'networks.ethereum.chainId',
        network.chainId
      ));
    }
    
    // RPC URL validation
    if (!this.isValidUrl(network.rpcUrl)) {
      errors.push(new ValidationError(
        'Invalid Ethereum RPC URL format',
        'networks.ethereum.rpcUrl',
        network.rpcUrl
      ));
    }
    
    // WebSocket URL validation (optional)
    if (network.wsUrl && !this.isValidWsUrl(network.wsUrl)) {
      errors.push(new ValidationError(
        'Invalid Ethereum WebSocket URL format',
        'networks.ethereum.wsUrl',
        network.wsUrl
      ));
    }
    
    // Contract address validation
    if (!this.isValidEthereumAddress(network.contracts.htlc)) {
      errors.push(new ValidationError(
        'Invalid HTLC contract address',
        'networks.ethereum.contracts.htlc',
        network.contracts.htlc
      ));
    }
    
    if (network.contracts.resolver && !this.isValidEthereumAddress(network.contracts.resolver)) {
      errors.push(new ValidationError(
        'Invalid resolver contract address',
        'networks.ethereum.contracts.resolver',
        network.contracts.resolver
      ));
    }
    
    // Gas configuration validation
    if (network.gasConfig.maxGasLimit < 21000) {
      errors.push(new ValidationError(
        'Gas limit too low (minimum 21000 for basic transaction)',
        'networks.ethereum.gasConfig.maxGasLimit',
        network.gasConfig.maxGasLimit
      ));
    }
    
    if (network.gasConfig.maxGasLimit > 15000000) {
      warnings.push(new ValidationError(
        'Gas limit very high, may cause issues with some networks',
        'networks.ethereum.gasConfig.maxGasLimit',
        network.gasConfig.maxGasLimit,
        { severity: 'warning' }
      ));
    }
    
    // Confirmations validation
    if (network.confirmations < 0) {
      errors.push(new ValidationError(
        'Confirmations must be non-negative',
        'networks.ethereum.confirmations',
        network.confirmations
      ));
    }
    
    if (network.confirmations > 100) {
      warnings.push(new ValidationError(
        'Very high confirmation requirement may slow down processing',
        'networks.ethereum.confirmations',
        network.confirmations,
        { severity: 'warning' }
      ));
    }
    
    // Network connectivity test (if not in test mode)
    if (process.env.NODE_ENV !== 'test' && process.env.SKIP_NETWORK_VALIDATION !== 'true') {
      try {
        await this.testEthereumConnection(network);
      } catch (error) {
        warnings.push(new ValidationError(
          `Cannot connect to Ethereum RPC: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'networks.ethereum.rpcUrl',
          network.rpcUrl,
          { severity: 'warning', connectivityTest: true }
        ));
      }
    }
  }
  
  private async validateCosmosNetwork(
    network: CosmosNetworkConfig,
    path: string,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): Promise<void> {
    // Chain ID validation
    if (!network.chainId || typeof network.chainId !== 'string') {
      errors.push(new ValidationError(
        'Cosmos chain ID must be a non-empty string',
        `${path}.chainId`,
        network.chainId
      ));
    }
    
    // URL validations
    if (!this.isValidUrl(network.rpcUrl)) {
      errors.push(new ValidationError(
        'Invalid Cosmos RPC URL format',
        `${path}.rpcUrl`,
        network.rpcUrl
      ));
    }
    
    if (!this.isValidUrl(network.restUrl)) {
      errors.push(new ValidationError(
        'Invalid Cosmos REST URL format',
        `${path}.restUrl`,
        network.restUrl
      ));
    }
    
    if (network.wsUrl && !this.isValidWsUrl(network.wsUrl)) {
      errors.push(new ValidationError(
        'Invalid Cosmos WebSocket URL format',
        `${path}.wsUrl`,
        network.wsUrl
      ));
    }
    
    // Address prefix validation
    if (!network.addressPrefix || !/^[a-z]{2,10}$/.test(network.addressPrefix)) {
      errors.push(new ValidationError(
        'Address prefix must be 2-10 lowercase letters',
        `${path}.addressPrefix`,
        network.addressPrefix
      ));
    }
    
    // Coin type validation
    if (!Number.isInteger(network.coinType) || network.coinType < 0) {
      errors.push(new ValidationError(
        'Coin type must be a non-negative integer',
        `${path}.coinType`,
        network.coinType
      ));
    }
    
    // Gas configuration validation
    if (!this.isValidGasPrice(network.gasPrice)) {
      errors.push(new ValidationError(
        'Invalid gas price format (should be like "0.025uatom")',
        `${path}.gasPrice`,
        network.gasPrice
      ));
    }
    
    if (network.gasLimit < 1000) {
      errors.push(new ValidationError(
        'Gas limit too low (minimum 1000)',
        `${path}.gasLimit`,
        network.gasLimit
      ));
    }
    
    // Denominations validation
    if (!network.denominations.primary || !network.denominations.display) {
      errors.push(new ValidationError(
        'Primary and display denominations are required',
        `${path}.denominations`,
        network.denominations
      ));
    }
    
    if (network.denominations.decimals < 0 || network.denominations.decimals > 18) {
      errors.push(new ValidationError(
        'Decimals must be between 0 and 18',
        `${path}.denominations.decimals`,
        network.denominations.decimals
      ));
    }
    
    // Contract address validation
    if (!this.isValidCosmosAddress(network.contracts.htlc, network.addressPrefix)) {
      errors.push(new ValidationError(
        'Invalid HTLC contract address for this chain',
        `${path}.contracts.htlc`,
        network.contracts.htlc
      ));
    }
    
    // IBC timeout validation
    if (network.ibc.timeout < 60) {
      warnings.push(new ValidationError(
        'IBC timeout very short, may cause failed transfers',
        `${path}.ibc.timeout`,
        network.ibc.timeout,
        { severity: 'warning' }
      ));
    }
    
    if (network.ibc.timeout > 3600) {
      warnings.push(new ValidationError(
        'IBC timeout very long, may delay error detection',
        `${path}.ibc.timeout`,
        network.ibc.timeout,
        { severity: 'warning' }
      ));
    }
  }
  
  private validateServices(
    config: FusionConfig,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    const services = config.services;
    
    // Relayer service validation
    const relayer = services.relayer;
    if (relayer.maxRetries < 0 || relayer.maxRetries > 100) {
      errors.push(new ValidationError(
        'Max retries must be between 0 and 100',
        'services.relayer.maxRetries',
        relayer.maxRetries
      ));
    }
    
    if (relayer.retryDelayMs < 100 || relayer.retryDelayMs > 300000) {
      errors.push(new ValidationError(
        'Retry delay must be between 100ms and 5 minutes',
        'services.relayer.retryDelayMs',
        relayer.retryDelayMs
      ));
    }
    
    if (relayer.batchSize < 1 || relayer.batchSize > 1000) {
      errors.push(new ValidationError(
        'Batch size must be between 1 and 1000',
        'services.relayer.batchSize',
        relayer.batchSize
      ));
    }
    
    if (relayer.processingIntervalMs < 1000) {
      warnings.push(new ValidationError(
        'Very short processing interval may cause high CPU usage',
        'services.relayer.processingIntervalMs',
        relayer.processingIntervalMs,
        { severity: 'warning' }
      ));
    }
    
    // Registry service validation
    const registry = services.registry;
    if (registry.cacheTimeout < 60) {
      warnings.push(new ValidationError(
        'Very short cache timeout may cause excessive API calls',
        'services.registry.cacheTimeout',
        registry.cacheTimeout,
        { severity: 'warning' }
      ));
    }
    
    if (registry.refreshInterval >= registry.cacheTimeout) {
      errors.push(new ValidationError(
        'Refresh interval should be less than cache timeout',
        'services.registry.refreshInterval',
        registry.refreshInterval
      ));
    }
    
    // Recovery service validation
    const recovery = services.recovery;
    if (recovery.enabled && recovery.checkInterval < 5000) {
      warnings.push(new ValidationError(
        'Very frequent recovery checks may impact performance',
        'services.recovery.checkInterval',
        recovery.checkInterval,
        { severity: 'warning' }
      ));
    }
  }
  
  private validateSecurity(
    config: FusionConfig,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    const security = config.security;
    
    // Secrets validation
    const validProviders = ['env', 'aws', 'vault', '1password'];
    if (!validProviders.includes(security.secrets.provider)) {
      errors.push(new ValidationError(
        `Invalid secrets provider. Must be one of: ${validProviders.join(', ')}`,
        'security.secrets.provider',
        security.secrets.provider
      ));
    }
    
    // Rate limiting validation
    if (security.rateLimit.enabled) {
      if (security.rateLimit.windowMs < 1000) {
        errors.push(new ValidationError(
          'Rate limit window must be at least 1 second',
          'security.rateLimit.windowMs',
          security.rateLimit.windowMs
        ));
      }
      
      if (security.rateLimit.maxRequests < 1) {
        errors.push(new ValidationError(
          'Max requests must be at least 1',
          'security.rateLimit.maxRequests',
          security.rateLimit.maxRequests
        ));
      }
    }
    
    // Firewall validation
    if (security.firewall.enabled) {
      if (security.firewall.maxConnectionsPerIP < 1) {
        errors.push(new ValidationError(
          'Max connections per IP must be at least 1',
          'security.firewall.maxConnectionsPerIP',
          security.firewall.maxConnectionsPerIP
        ));
      }
      
      if (security.firewall.allowedOrigins.includes('*') && config.environment.name === 'production') {
        warnings.push(new ValidationError(
          'Wildcard origins in production may be a security risk',
          'security.firewall.allowedOrigins',
          security.firewall.allowedOrigins,
          { severity: 'warning' }
        ));
      }
    }
  }
  
  private validateMonitoring(
    config: FusionConfig,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    const monitoring = config.monitoring;
    
    // Metrics validation
    if (monitoring.metrics.enabled && monitoring.metrics.port) {
      if (monitoring.metrics.port < 1024 || monitoring.metrics.port > 65535) {
        errors.push(new ValidationError(
          'Metrics port must be between 1024 and 65535',
          'monitoring.metrics.port',
          monitoring.metrics.port
        ));
      }
    }
    
    // Tracing validation
    if (monitoring.tracing.enabled) {
      if (monitoring.tracing.sampleRate < 0 || monitoring.tracing.sampleRate > 1) {
        errors.push(new ValidationError(
          'Tracing sample rate must be between 0 and 1',
          'monitoring.tracing.sampleRate',
          monitoring.tracing.sampleRate
        ));
      }
      
      if (!monitoring.tracing.serviceName) {
        errors.push(new ValidationError(
          'Service name is required when tracing is enabled',
          'monitoring.tracing.serviceName',
          monitoring.tracing.serviceName
        ));
      }
    }
    
    // Health check validation
    if (monitoring.healthCheck.enabled) {
      if (monitoring.healthCheck.interval < 1000) {
        warnings.push(new ValidationError(
          'Very frequent health checks may impact performance',
          'monitoring.healthCheck.interval',
          monitoring.healthCheck.interval,
          { severity: 'warning' }
        ));
      }
      
      if (monitoring.healthCheck.timeout >= monitoring.healthCheck.interval) {
        errors.push(new ValidationError(
          'Health check timeout should be less than interval',
          'monitoring.healthCheck.timeout',
          monitoring.healthCheck.timeout
        ));
      }
    }
  }
  
  private validateCrossConfig(
    config: FusionConfig,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    // Validate recovery buffer vs timeout buffer
    if (config.services.recovery.enabled) {
      const recoveryBuffer = config.services.recovery.refundBufferSeconds;
      const timeoutBuffer = config.services.relayer.timeoutBufferSeconds;
      
      if (recoveryBuffer >= timeoutBuffer) {
        errors.push(new ValidationError(
          'Recovery refund buffer must be less than relay timeout buffer',
          'services.recovery.refundBufferSeconds',
          recoveryBuffer,
          { relatedField: 'services.relayer.timeoutBufferSeconds', relatedValue: timeoutBuffer }
        ));
      }
    }
    
    // Validate batch processing capacity
    const processTime = config.services.relayer.batchSize * 100; // Assume 100ms per swap
    if (config.services.relayer.processingIntervalMs < processTime) {
      warnings.push(new ValidationError(
        `Processing interval (${config.services.relayer.processingIntervalMs}ms) may be too short for batch size ${config.services.relayer.batchSize}`,
        'services.relayer.processingIntervalMs',
        config.services.relayer.processingIntervalMs,
        { 
          severity: 'warning',
          suggestion: `Consider increasing to at least ${processTime}ms or reducing batch size`
        }
      ));
    }
    
    // Validate that at least one Cosmos chain has IBC connections
    const hasIBCConnections = config.networks.cosmos.some(chain => 
      Object.keys(chain.ibc.channels).length > 0
    );
    
    if (!hasIBCConnections) {
      warnings.push(new ValidationError(
        'No IBC channels configured, cross-chain swaps will not work',
        'networks.cosmos',
        config.networks.cosmos,
        { severity: 'warning' }
      ));
    }
  }
  
  private validateIBCConnections(
    cosmosNetworks: CosmosNetworkConfig[],
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    const chainIds = new Set(cosmosNetworks.map(n => n.chainId));
    
    for (let i = 0; i < cosmosNetworks.length; i++) {
      const network = cosmosNetworks[i];
      const path = `networks.cosmos[${i}]`;
      
      for (const [targetChain, channelConfig] of Object.entries(network.ibc.channels)) {
        // Check if target chain exists in our configuration
        if (!chainIds.has(targetChain)) {
          warnings.push(new ValidationError(
            `IBC channel configured for unknown chain: ${targetChain}`,
            `${path}.ibc.channels.${targetChain}`,
            channelConfig,
            { severity: 'warning' }
          ));
        }
        
        // Validate channel ID format
        if (!/^channel-\d+$/.test(channelConfig.channelId)) {
          errors.push(new ValidationError(
            'Invalid channel ID format (should be "channel-N")',
            `${path}.ibc.channels.${targetChain}.channelId`,
            channelConfig.channelId
          ));
        }
        
        // Validate port ID
        if (!channelConfig.portId) {
          errors.push(new ValidationError(
            'Port ID is required for IBC channel',
            `${path}.ibc.channels.${targetChain}.portId`,
            channelConfig.portId
          ));
        }
      }
    }
  }
  
  private async testEthereumConnection(network: EthereumNetworkConfig): Promise<void> {
    // Simple connectivity test - in a real implementation, this would use ethers.js
    const response = await fetch(network.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json() as { error?: { message: string }; result?: string };
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    const chainId = parseInt(data.result || '0x0', 16);
    if (chainId !== network.chainId) {
      throw new Error(`Chain ID mismatch: expected ${network.chainId}, got ${chainId}`);
    }
  }
  
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }
  
  private isValidWsUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['ws:', 'wss:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }
  
  private isValidEthereumAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
  
  private isValidCosmosAddress(address: string, prefix: string): boolean {
    return address.startsWith(prefix) && address.length > prefix.length + 10;
  }
  
  private isValidGasPrice(gasPrice: string): boolean {
    return /^\d+(\.\d+)?[a-z]+$/.test(gasPrice);
  }
}
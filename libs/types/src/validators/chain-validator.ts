import { ValidationError } from '@evmore/errors';
import { Chain, ChainConfig, ChainType, TokenInfo } from '../index';
import { isValidAddress } from '../guards/type-guards';

export interface ChainValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export class ChainValidator {
  static validateChain(chain: Partial<Chain>): ChainValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    
    // ID validation
    if (!chain.id || typeof chain.id !== 'string' || chain.id.length === 0) {
      errors.push(new ValidationError(
        'Chain ID is required and must be a non-empty string',
        'id',
        chain.id
      ));
    }
    
    // Name validation
    if (!chain.name || typeof chain.name !== 'string' || chain.name.length === 0) {
      errors.push(new ValidationError(
        'Chain name is required and must be a non-empty string',
        'name',
        chain.name
      ));
    }
    
    // Type validation
    if (!chain.type || !Object.values(ChainType).includes(chain.type)) {
      errors.push(new ValidationError(
        `Chain type must be one of: ${Object.values(ChainType).join(', ')}`,
        'type',
        chain.type
      ));
    }
    
    // Native currency validation
    if (!chain.nativeCurrency) {
      errors.push(new ValidationError(
        'Native currency is required',
        'nativeCurrency',
        chain.nativeCurrency
      ));
    } else {
      const currencyErrors = this.validateCurrency(chain.nativeCurrency, 'nativeCurrency');
      errors.push(...currencyErrors);
    }
    
    // Endpoints validation
    if (!chain.endpoints) {
      errors.push(new ValidationError(
        'Chain endpoints are required',
        'endpoints',
        chain.endpoints
      ));
    } else {
      const endpointErrors = this.validateEndpoints(chain.endpoints, chain.type);
      errors.push(...endpointErrors);
    }
    
    // Explorer URL validation (optional)
    if (chain.explorerUrl && !this.isValidUrl(chain.explorerUrl)) {
      errors.push(new ValidationError(
        'Invalid explorer URL format',
        'explorerUrl',
        chain.explorerUrl
      ));
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  static validateChainConfig(config: Partial<ChainConfig>): ChainValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    
    // Chain ID validation
    if (!config.chainId || typeof config.chainId !== 'string') {
      errors.push(new ValidationError(
        'Chain ID is required and must be a string',
        'chainId',
        config.chainId
      ));
    }
    
    // Name validation
    if (!config.name || typeof config.name !== 'string') {
      errors.push(new ValidationError(
        'Chain name is required and must be a string',
        'name',
        config.name
      ));
    }
    
    // Type validation
    if (!config.type || !Object.values(ChainType).includes(config.type)) {
      errors.push(new ValidationError(
        `Chain type must be one of: ${Object.values(ChainType).join(', ')}`,
        'type',
        config.type
      ));
    }
    
    // RPC URL validation
    if (!config.rpcUrl || !this.isValidUrl(config.rpcUrl)) {
      errors.push(new ValidationError(
        'Valid RPC URL is required',
        'rpcUrl',
        config.rpcUrl
      ));
    }
    
    // REST URL validation (required for Cosmos chains)
    if (config.type === ChainType.COSMOS || config.type === ChainType.OSMOSIS) {
      if (!config.restUrl || !this.isValidUrl(config.restUrl)) {
        errors.push(new ValidationError(
          'Valid REST URL is required for Cosmos chains',
          'restUrl',
          config.restUrl
        ));
      }
    }
    
    // WebSocket URL validation (optional)
    if (config.wsUrl && !this.isValidWsUrl(config.wsUrl)) {
      errors.push(new ValidationError(
        'Invalid WebSocket URL format',
        'wsUrl',
        config.wsUrl
      ));
    }
    
    // HTLC contract validation
    if (!config.htlcContract || typeof config.htlcContract !== 'string') {
      errors.push(new ValidationError(
        'HTLC contract address is required',
        'htlcContract',
        config.htlcContract
      ));
    } else if (config.type) {
      if (!isValidAddress(config.htlcContract, config.type, config.addressPrefix)) {
        errors.push(new ValidationError(
          'Invalid HTLC contract address format for this chain type',
          'htlcContract',
          config.htlcContract,
          { chainType: config.type }
        ));
      }
    }
    
    // Native denomination validation
    if (!config.nativeDenom || typeof config.nativeDenom !== 'string') {
      errors.push(new ValidationError(
        'Native denomination is required and must be a string',
        'nativeDenom',
        config.nativeDenom
      ));
    } else if (config.type === ChainType.COSMOS || config.type === ChainType.OSMOSIS) {
      if (!/^[a-z][a-z0-9]{2,15}$/.test(config.nativeDenom)) {
        errors.push(new ValidationError(
          'Invalid Cosmos denomination format (should be lowercase, 3-16 chars)',
          'nativeDenom',
          config.nativeDenom
        ));
      }
    }
    
    // Address prefix validation (for Cosmos chains)
    if (config.type === ChainType.COSMOS || config.type === ChainType.OSMOSIS) {
      if (!config.addressPrefix || !/^[a-z]{2,10}$/.test(config.addressPrefix)) {
        errors.push(new ValidationError(
          'Address prefix is required for Cosmos chains (2-10 lowercase letters)',
          'addressPrefix',
          config.addressPrefix
        ));
      }
    }
    
    // Block time validation
    if (typeof config.blockTime !== 'number' || config.blockTime <= 0) {
      errors.push(new ValidationError(
        'Block time must be a positive number (seconds)',
        'blockTime',
        config.blockTime
      ));
    } else {
      if (config.blockTime < 0.1) {
        warnings.push(new ValidationError(
          'Very fast block time may not be realistic',
          'blockTime',
          config.blockTime,
          { severity: 'warning' }
        ));
      } else if (config.blockTime > 60) {
        warnings.push(new ValidationError(
          'Very slow block time may impact user experience',
          'blockTime',
          config.blockTime,
          { severity: 'warning' }
        ));
      }
    }
    
    // Confirmations validation
    if (typeof config.confirmations !== 'number' || config.confirmations < 0) {
      errors.push(new ValidationError(
        'Confirmations must be a non-negative number',
        'confirmations',
        config.confirmations
      ));
    } else if (config.confirmations > 100) {
      warnings.push(new ValidationError(
        'Very high confirmation requirement may slow processing',
        'confirmations',
        config.confirmations,
        { severity: 'warning' }
      ));
    }
    
    // Gas configuration validation
    if (!config.gasConfig) {
      errors.push(new ValidationError(
        'Gas configuration is required',
        'gasConfig',
        config.gasConfig
      ));
    } else {
      const gasErrors = this.validateGasConfig(config.gasConfig, config.type);
      errors.push(...gasErrors);
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  static validateTokenInfo(token: Partial<TokenInfo>): ChainValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    
    // Address validation
    if (!token.address || typeof token.address !== 'string') {
      errors.push(new ValidationError(
        'Token address is required and must be a string',
        'address',
        token.address
      ));
    }
    
    // Symbol validation
    if (!token.symbol || typeof token.symbol !== 'string' || token.symbol.length === 0) {
      errors.push(new ValidationError(
        'Token symbol is required and must be a non-empty string',
        'symbol',
        token.symbol
      ));
    } else {
      if (token.symbol.length > 20) {
        warnings.push(new ValidationError(
          'Token symbol is unusually long',
          'symbol',
          token.symbol,
          { severity: 'warning' }
        ));
      }
    }
    
    // Name validation
    if (!token.name || typeof token.name !== 'string' || token.name.length === 0) {
      errors.push(new ValidationError(
        'Token name is required and must be a non-empty string',
        'name',
        token.name
      ));
    }
    
    // Decimals validation
    if (typeof token.decimals !== 'number' || token.decimals < 0 || token.decimals > 18) {
      errors.push(new ValidationError(
        'Token decimals must be a number between 0 and 18',
        'decimals',
        token.decimals
      ));
    }
    
    // Chain ID validation
    if (!token.chainId || typeof token.chainId !== 'string') {
      errors.push(new ValidationError(
        'Chain ID is required and must be a string',
        'chainId',
        token.chainId
      ));
    }
    
    // Logo URL validation (optional)
    if (token.logoUrl && !this.isValidUrl(token.logoUrl)) {
      warnings.push(new ValidationError(
        'Invalid logo URL format',
        'logoUrl',
        token.logoUrl,
        { severity: 'warning' }
      ));
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  private static validateCurrency(currency: any, fieldPath: string): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (!currency.symbol || typeof currency.symbol !== 'string') {
      errors.push(new ValidationError(
        'Currency symbol is required and must be a string',
        `${fieldPath}.symbol`,
        currency.symbol
      ));
    }
    
    if (typeof currency.decimals !== 'number' || currency.decimals < 0 || currency.decimals > 18) {
      errors.push(new ValidationError(
        'Currency decimals must be a number between 0 and 18',
        `${fieldPath}.decimals`,
        currency.decimals
      ));
    }
    
    return errors;
  }
  
  private static validateEndpoints(endpoints: any, chainType?: ChainType): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (!endpoints.rpc || !this.isValidUrl(endpoints.rpc)) {
      errors.push(new ValidationError(
        'Valid RPC endpoint is required',
        'endpoints.rpc',
        endpoints.rpc
      ));
    }
    
    if (chainType === ChainType.COSMOS || chainType === ChainType.OSMOSIS) {
      if (!endpoints.rest || !this.isValidUrl(endpoints.rest)) {
        errors.push(new ValidationError(
          'Valid REST endpoint is required for Cosmos chains',
          'endpoints.rest',
          endpoints.rest
        ));
      }
    }
    
    if (endpoints.ws && !this.isValidWsUrl(endpoints.ws)) {
      errors.push(new ValidationError(
        'Invalid WebSocket endpoint format',
        'endpoints.ws',
        endpoints.ws
      ));
    }
    
    return errors;
  }
  
  private static validateGasConfig(gasConfig: any, chainType?: ChainType): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (typeof gasConfig.maxGasLimit !== 'number' || gasConfig.maxGasLimit <= 0) {
      errors.push(new ValidationError(
        'Max gas limit must be a positive number',
        'gasConfig.maxGasLimit',
        gasConfig.maxGasLimit
      ));
    } else {
      const minGasLimit = chainType === ChainType.ETHEREUM ? 21000 : 1000;
      if (gasConfig.maxGasLimit < minGasLimit) {
        errors.push(new ValidationError(
          `Gas limit too low (minimum ${minGasLimit} for ${chainType} chains)`,
          'gasConfig.maxGasLimit',
          gasConfig.maxGasLimit
        ));
      }
    }
    
    if (gasConfig.gasPrice && typeof gasConfig.gasPrice !== 'string') {
      errors.push(new ValidationError(
        'Gas price must be a string if provided',
        'gasConfig.gasPrice',
        gasConfig.gasPrice
      ));
    }
    
    if (chainType === ChainType.ETHEREUM) {
      if (gasConfig.maxPriorityFee && typeof gasConfig.maxPriorityFee !== 'string') {
        errors.push(new ValidationError(
          'Max priority fee must be a string if provided',
          'gasConfig.maxPriorityFee',
          gasConfig.maxPriorityFee
        ));
      }
      
      if (gasConfig.maxFee && typeof gasConfig.maxFee !== 'string') {
        errors.push(new ValidationError(
          'Max fee must be a string if provided',
          'gasConfig.maxFee',
          gasConfig.maxFee
        ));
      }
    }
    
    return errors;
  }
  
  private static isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }
  
  private static isValidWsUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['ws:', 'wss:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }
}
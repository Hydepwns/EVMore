import { ValidationError } from '@evmore/errors';
import { 
  SwapOrder, 
  SwapEndpoint, 
  SwapAmount, 
  TimelockConfig, 
  CrossChainSwapParams,
  ChainType 
} from '../index';
import { 
  isValidAddress, 
  isValidAmount, 
  isValidSHA256Hash,
  isEthereumChain,
  isCosmosChain 
} from '../guards/type-guards';

export interface SwapValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export class SwapValidator {
  static validateSwapOrder(order: Partial<SwapOrder>): SwapValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    
    // ID validation
    if (!order.id || typeof order.id !== 'string' || order.id.length === 0) {
      errors.push(new ValidationError(
        'Swap order ID is required and must be a non-empty string',
        'id',
        order.id
      ));
    }
    
    if (!order.orderId || typeof order.orderId !== 'string' || order.orderId.length === 0) {
      errors.push(new ValidationError(
        'On-chain order ID is required and must be a non-empty string',
        'orderId',
        order.orderId
      ));
    }
    
    // Source endpoint validation
    if (!order.source) {
      errors.push(new ValidationError(
        'Source endpoint is required',
        'source',
        order.source
      ));
    } else {
      const sourceErrors = this.validateSwapEndpoint(order.source, 'source');
      errors.push(...sourceErrors);
    }
    
    // Destination endpoint validation
    if (!order.destination) {
      errors.push(new ValidationError(
        'Destination endpoint is required',
        'destination',
        order.destination
      ));
    } else {
      const destErrors = this.validateSwapEndpoint(order.destination, 'destination');
      errors.push(...destErrors);
    }
    
    // Cross-validation: source and destination must be different chains
    if (order.source && order.destination && order.source.chainId === order.destination.chainId) {
      errors.push(new ValidationError(
        'Source and destination must be different chains',
        'destination.chainId',
        order.destination.chainId,
        { sourceChainId: order.source.chainId }
      ));
    }
    
    // Amount validation
    if (!order.amount) {
      errors.push(new ValidationError(
        'Swap amount is required',
        'amount',
        order.amount
      ));
    } else {
      const amountErrors = this.validateSwapAmount(order.amount);
      errors.push(...amountErrors);
    }
    
    // Timelock validation
    if (!order.timelock) {
      errors.push(new ValidationError(
        'Timelock configuration is required',
        'timelock',
        order.timelock
      ));
    } else {
      const timelockErrors = this.validateTimelockConfig(order.timelock);
      errors.push(...timelockErrors);
    }
    
    // Secret validation
    if (order.secret) {
      const secretErrors = this.validateSecretPair(order.secret);
      errors.push(...secretErrors);
    }
    
    // Date validation
    if (order.createdAt && !(order.createdAt instanceof Date)) {
      errors.push(new ValidationError(
        'createdAt must be a Date object',
        'createdAt',
        order.createdAt
      ));
    }
    
    if (order.updatedAt && !(order.updatedAt instanceof Date)) {
      errors.push(new ValidationError(
        'updatedAt must be a Date object',
        'updatedAt',
        order.updatedAt
      ));
    }
    
    // Cross-validation: createdAt should be before updatedAt
    if (order.createdAt && order.updatedAt && order.createdAt > order.updatedAt) {
      warnings.push(new ValidationError(
        'createdAt should not be after updatedAt',
        'updatedAt',
        order.updatedAt,
        { severity: 'warning', createdAt: order.createdAt }
      ));
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  static validateSwapEndpoint(endpoint: SwapEndpoint, fieldPath: string = 'endpoint'): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (!endpoint.chainId || typeof endpoint.chainId !== 'string') {
      errors.push(new ValidationError(
        'Chain ID is required and must be a non-empty string',
        `${fieldPath}.chainId`,
        endpoint.chainId
      ));
    }
    
    if (!endpoint.address || typeof endpoint.address !== 'string') {
      errors.push(new ValidationError(
        'Address is required and must be a non-empty string',
        `${fieldPath}.address`,
        endpoint.address
      ));
    } else if (endpoint.chainId) {
      // Validate address format based on chain type
      let chainType: ChainType;
      if (isEthereumChain(endpoint.chainId)) {
        chainType = ChainType.ETHEREUM;
      } else if (isCosmosChain(endpoint.chainId)) {
        chainType = ChainType.COSMOS;
      } else {
        // Default validation for unknown chain types
        chainType = ChainType.COSMOS;
      }
      
      if (!isValidAddress(endpoint.address, chainType)) {
        errors.push(new ValidationError(
          `Invalid address format for ${chainType} chain`,
          `${fieldPath}.address`,
          endpoint.address,
          { chainType, chainId: endpoint.chainId }
        ));
      }
    }
    
    // Token address/denom validation
    if (endpoint.tokenAddress && endpoint.tokenDenom) {
      errors.push(new ValidationError(
        'Cannot specify both tokenAddress and tokenDenom',
        fieldPath,
        endpoint,
        { hasTokenAddress: true, hasTokenDenom: true }
      ));
    }
    
    if (endpoint.tokenAddress && !isValidAddress(endpoint.tokenAddress, ChainType.ETHEREUM)) {
      errors.push(new ValidationError(
        'Invalid token address format',
        `${fieldPath}.tokenAddress`,
        endpoint.tokenAddress
      ));
    }
    
    if (endpoint.tokenDenom && (typeof endpoint.tokenDenom !== 'string' || endpoint.tokenDenom.length === 0)) {
      errors.push(new ValidationError(
        'Token denomination must be a non-empty string',
        `${fieldPath}.tokenDenom`,
        endpoint.tokenDenom
      ));
    }
    
    return errors;
  }
  
  static validateSwapAmount(amount: SwapAmount): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (!amount.value || typeof amount.value !== 'string') {
      errors.push(new ValidationError(
        'Amount value is required and must be a string',
        'amount.value',
        amount.value
      ));
    } else if (!isValidAmount(amount.value)) {
      errors.push(new ValidationError(
        'Amount value must be a valid positive integer string',
        'amount.value',
        amount.value
      ));
    }
    
    if (typeof amount.decimals !== 'number' || amount.decimals < 0 || amount.decimals > 18) {
      errors.push(new ValidationError(
        'Decimals must be a number between 0 and 18',
        'amount.decimals',
        amount.decimals
      ));
    }
    
    if (!amount.displayValue || typeof amount.displayValue !== 'string') {
      errors.push(new ValidationError(
        'Display value is required and must be a string',
        'amount.displayValue',
        amount.displayValue
      ));
    }
    
    if (!amount.symbol || typeof amount.symbol !== 'string' || amount.symbol.length === 0) {
      errors.push(new ValidationError(
        'Symbol is required and must be a non-empty string',
        'amount.symbol',
        amount.symbol
      ));
    }
    
    // Cross-validation: check if displayValue matches value/decimals
    if (amount.value && typeof amount.decimals === 'number' && amount.displayValue) {
      try {
        const expectedDisplay = (BigInt(amount.value) / BigInt(10 ** amount.decimals)).toString();
        const actualDisplay = parseFloat(amount.displayValue).toString();
        if (expectedDisplay !== actualDisplay) {
          // This is a warning since display values might have different formatting
          errors.push(new ValidationError(
            'Display value may not match the actual amount and decimals',
            'amount.displayValue',
            amount.displayValue,
            { 
              severity: 'warning',
              expectedDisplay,
              actualValue: amount.value,
              decimals: amount.decimals
            }
          ));
        }
      } catch {
        // If calculation fails, it's likely due to invalid value format
        // This error would be caught in the value validation above
      }
    }
    
    return errors;
  }
  
  static validateTimelockConfig(timelock: TimelockConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    const now = Math.floor(Date.now() / 1000);
    
    if (typeof timelock.startTime !== 'number' || timelock.startTime <= 0) {
      errors.push(new ValidationError(
        'Start time must be a positive number (Unix timestamp)',
        'timelock.startTime',
        timelock.startTime
      ));
    }
    
    if (typeof timelock.duration !== 'number' || timelock.duration <= 0) {
      errors.push(new ValidationError(
        'Duration must be a positive number (seconds)',
        'timelock.duration',
        timelock.duration
      ));
    }
    
    if (typeof timelock.expiryTime !== 'number' || timelock.expiryTime <= 0) {
      errors.push(new ValidationError(
        'Expiry time must be a positive number (Unix timestamp)',
        'timelock.expiryTime',
        timelock.expiryTime
      ));
    }
    
    if (typeof timelock.buffer !== 'number' || timelock.buffer <= 0) {
      errors.push(new ValidationError(
        'Buffer must be a positive number (seconds)',
        'timelock.buffer',
        timelock.buffer
      ));
    }
    
    // Cross-validations
    if (timelock.startTime && timelock.duration && timelock.expiryTime) {
      if (timelock.expiryTime !== timelock.startTime + timelock.duration) {
        errors.push(new ValidationError(
          'Expiry time must equal start time plus duration',
          'timelock.expiryTime',
          timelock.expiryTime,
          { 
            startTime: timelock.startTime,
            duration: timelock.duration,
            expectedExpiry: timelock.startTime + timelock.duration
          }
        ));
      }
    }
    
    if (timelock.buffer && timelock.duration && timelock.buffer >= timelock.duration) {
      errors.push(new ValidationError(
        'Buffer must be less than duration',
        'timelock.buffer',
        timelock.buffer,
        { duration: timelock.duration }
      ));
    }
    
    if (timelock.startTime && timelock.startTime <= now) {
      errors.push(new ValidationError(
        'Start time must be in the future',
        'timelock.startTime',
        timelock.startTime,
        { currentTime: now }
      ));
    }
    
    if (timelock.expiryTime && timelock.expiryTime <= now) {
      errors.push(new ValidationError(
        'Expiry time must be in the future',
        'timelock.expiryTime',
        timelock.expiryTime,
        { currentTime: now }
      ));
    }
    
    // Duration sanity checks
    if (timelock.duration) {
      const oneHour = 3600;
      const oneWeek = 7 * 24 * 3600;
      
      if (timelock.duration < oneHour) {
        errors.push(new ValidationError(
          'Duration too short (minimum 1 hour for security)',
          'timelock.duration',
          timelock.duration,
          { minimumDuration: oneHour }
        ));
      }
      
      if (timelock.duration > oneWeek) {
        errors.push(new ValidationError(
          'Duration very long (maximum 1 week recommended)',
          'timelock.duration',
          timelock.duration,
          { severity: 'warning', maximumRecommended: oneWeek }
        ));
      }
    }
    
    return errors;
  }
  
  static validateSecretPair(secret: any): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (!secret.hash || typeof secret.hash !== 'string') {
      errors.push(new ValidationError(
        'Secret hash is required and must be a string',
        'secret.hash',
        secret.hash
      ));
    } else if (!isValidSHA256Hash(secret.hash.replace('0x', ''))) {
      errors.push(new ValidationError(
        'Secret hash must be a valid SHA256 hash',
        'secret.hash',
        secret.hash
      ));
    }
    
    if (secret.preimage && typeof secret.preimage !== 'string') {
      errors.push(new ValidationError(
        'Secret preimage must be a string if provided',
        'secret.preimage',
        secret.preimage
      ));
    }
    
    const validAlgorithms = ['sha256', 'keccak256'];
    if (!secret.algorithm || !validAlgorithms.includes(secret.algorithm)) {
      errors.push(new ValidationError(
        `Algorithm must be one of: ${validAlgorithms.join(', ')}`,
        'secret.algorithm',
        secret.algorithm
      ));
    }
    
    // Cross-validation: verify hash matches preimage if both are provided
    if (secret.preimage && secret.hash && secret.algorithm === 'sha256') {
      // Note: In a real implementation, you would compute the hash and compare
      // For now, we just check the format
      if (secret.preimage.length !== 64 && !secret.preimage.startsWith('0x')) {
        errors.push(new ValidationError(
          'Secret preimage format appears invalid',
          'secret.preimage',
          secret.preimage,
          { severity: 'warning' }
        ));
      }
    }
    
    return errors;
  }
  
  static validateCrossChainSwapParams(params: CrossChainSwapParams): SwapValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    
    // Chain validation
    if (!params.fromChain || typeof params.fromChain !== 'string') {
      errors.push(new ValidationError(
        'From chain is required and must be a string',
        'fromChain',
        params.fromChain
      ));
    }
    
    if (!params.toChain || typeof params.toChain !== 'string') {
      errors.push(new ValidationError(
        'To chain is required and must be a string',
        'toChain',
        params.toChain
      ));
    }
    
    if (params.fromChain === params.toChain) {
      errors.push(new ValidationError(
        'From chain and to chain must be different',
        'toChain',
        params.toChain,
        { fromChain: params.fromChain }
      ));
    }
    
    // Token validation
    if (!params.fromToken || typeof params.fromToken !== 'string') {
      errors.push(new ValidationError(
        'From token is required and must be a string',
        'fromToken',
        params.fromToken
      ));
    }
    
    if (!params.toToken || typeof params.toToken !== 'string') {
      errors.push(new ValidationError(
        'To token is required and must be a string',
        'toToken',
        params.toToken
      ));
    }
    
    // Amount validation
    if (!params.fromAmount || typeof params.fromAmount !== 'string') {
      errors.push(new ValidationError(
        'From amount is required and must be a string',
        'fromAmount',
        params.fromAmount
      ));
    } else if (!isValidAmount(params.fromAmount)) {
      errors.push(new ValidationError(
        'From amount must be a valid positive integer string',
        'fromAmount',
        params.fromAmount
      ));
    }
    
    // Address validation  
    if (!params.toAddress || typeof params.toAddress !== 'string') {
      errors.push(new ValidationError(
        'To address is required and must be a string',
        'toAddress',
        params.toAddress
      ));
    } else if (params.toChain) {
      let chainType: ChainType;
      if (isEthereumChain(params.toChain)) {
        chainType = ChainType.ETHEREUM;
      } else if (isCosmosChain(params.toChain)) {
        chainType = ChainType.COSMOS;
      } else {
        chainType = ChainType.COSMOS; // Default
      }
      
      if (!isValidAddress(params.toAddress, chainType)) {
        errors.push(new ValidationError(
          `Invalid address format for ${chainType} chain`,
          'toAddress',
          params.toAddress,
          { chainType, chainId: params.toChain }
        ));
      }
    }
    
    // Optional parameter validation
    if (params.slippageTolerance !== undefined) {
      if (typeof params.slippageTolerance !== 'number' || 
          params.slippageTolerance < 0 || 
          params.slippageTolerance > 1) {
        errors.push(new ValidationError(
          'Slippage tolerance must be a number between 0 and 1',
          'slippageTolerance',
          params.slippageTolerance
        ));
      } else if (params.slippageTolerance > 0.1) {
        warnings.push(new ValidationError(
          'High slippage tolerance may result in poor trade execution',
          'slippageTolerance',
          params.slippageTolerance,
          { severity: 'warning' }
        ));
      }
    }
    
    if (params.deadline !== undefined) {
      if (typeof params.deadline !== 'number' || params.deadline <= 0) {
        errors.push(new ValidationError(
          'Deadline must be a positive number (Unix timestamp)',
          'deadline',
          params.deadline
        ));
      } else {
        const now = Math.floor(Date.now() / 1000);
        if (params.deadline <= now) {
          errors.push(new ValidationError(
            'Deadline must be in the future',
            'deadline',
            params.deadline,
            { currentTime: now }
          ));
        } else if (params.deadline - now > 86400) { // 24 hours
          warnings.push(new ValidationError(
            'Very long deadline may not be necessary',
            'deadline',
            params.deadline,
            { severity: 'warning', currentTime: now }
          ));
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}
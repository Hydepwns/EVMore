/**
 * Validation utilities for amounts, addresses, and other inputs
 */

import { isValidEthereumAddress, isValidCosmosAddress } from './address';
import { isValidHash, isValidSecret } from './crypto';
import { isValidTimelock } from './time';

// Re-export for enhanced-validation.ts
export { isValidHash, isValidSecret } from './crypto';
export { isValidEthereumAddress, isValidCosmosAddress } from './address';

/**
 * Validate that an amount string is valid
 * @param amount - Amount string to validate
 * @param decimals - Number of decimals for the token
 * @returns True if valid amount
 */
export function validateAmount(amount: string, decimals: number = 18): boolean {
  if (!amount || typeof amount !== 'string') {
    return false;
  }

  // Check if it's a valid number
  const num = parseFloat(amount);
  if (isNaN(num) || num < 0) {
    return false;
  }

  // Check decimal places
  const decimalIndex = amount.indexOf('.');
  if (decimalIndex !== -1) {
    const decimalPlaces = amount.length - decimalIndex - 1;
    if (decimalPlaces > decimals) {
      return false;
    }
  }

  return true;
}

/**
 * Validate that an amount is greater than zero
 * @param amount - Amount string to validate
 * @returns True if amount > 0
 */
export function validateAmountPositive(amount: string): boolean {
  const num = parseFloat(amount);
  return !isNaN(num) && num > 0;
}

/**
 * Validate that an amount doesn't exceed a maximum
 * @param amount - Amount string to validate
 * @param maxAmount - Maximum allowed amount
 * @returns True if amount <= maxAmount
 */
export function validateAmountMax(amount: string, maxAmount: string): boolean {
  const num = parseFloat(amount);
  const max = parseFloat(maxAmount);
  return !isNaN(num) && !isNaN(max) && num <= max;
}

/**
 * Validate that an amount meets minimum requirements
 * @param amount - Amount string to validate
 * @param minAmount - Minimum required amount
 * @returns True if amount >= minAmount
 */
export function validateAmountMin(amount: string, minAmount: string): boolean {
  const num = parseFloat(amount);
  const min = parseFloat(minAmount);
  return !isNaN(num) && !isNaN(min) && num >= min;
}

/**
 * Validate an address for a specific chain
 * @param address - Address to validate
 * @param chainType - Type of chain ('ethereum' or 'cosmos')
 * @param expectedPrefix - Expected prefix for cosmos addresses
 * @returns True if valid address
 */
export function validateAddress(
  address: string,
  chainType: 'ethereum' | 'cosmos',
  expectedPrefix?: string
): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  if (chainType === 'ethereum') {
    return isValidEthereumAddress(address);
  } else if (chainType === 'cosmos') {
    return isValidCosmosAddress(address, expectedPrefix);
  }

  return false;
}

/**
 * Validate HTLC parameters
 * @param params - HTLC parameters to validate
 * @returns Validation result with any errors
 */
export interface HTLCValidationParams {
  amount: string;
  token: string;
  hashlock: string;
  timelock: number;
  sender: string;
  receiver: string;
  senderChainType: 'ethereum' | 'cosmos';
  receiverChainType: 'ethereum' | 'cosmos';
  receiverPrefix?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateHTLCParams(params: HTLCValidationParams): ValidationResult {
  const errors: string[] = [];

  // Validate amount
  if (!validateAmount(params.amount)) {
    errors.push('Invalid amount format');
  } else if (!validateAmountPositive(params.amount)) {
    errors.push('Amount must be greater than zero');
  }

  // Validate token address
  if (!params.token || typeof params.token !== 'string') {
    errors.push('Token address is required');
  } else if (params.senderChainType === 'ethereum' && !isValidEthereumAddress(params.token)) {
    errors.push('Invalid token address for Ethereum');
  }

  // Validate hashlock
  if (!isValidHash(params.hashlock)) {
    errors.push('Invalid hashlock format (must be 64-character hex string)');
  }

  // Validate timelock
  if (!isValidTimelock(params.timelock)) {
    errors.push('Invalid timelock (must be reasonable future timestamp)');
  }

  // Validate sender address
  if (!validateAddress(params.sender, params.senderChainType)) {
    errors.push(`Invalid sender address for ${params.senderChainType}`);
  }

  // Validate receiver address
  if (!validateAddress(params.receiver, params.receiverChainType, params.receiverPrefix)) {
    errors.push(`Invalid receiver address for ${params.receiverChainType}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate cross-chain swap parameters
 * @param params - Swap parameters to validate
 * @returns Validation result
 */
export interface SwapValidationParams {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAddress: string;
  slippageTolerance?: number;
  deadline?: number;
}

export function validateSwapParams(params: SwapValidationParams): ValidationResult {
  const errors: string[] = [];

  // Validate chains
  if (!params.fromChain || typeof params.fromChain !== 'string') {
    errors.push('From chain is required');
  }
  if (!params.toChain || typeof params.toChain !== 'string') {
    errors.push('To chain is required');
  }
  if (params.fromChain === params.toChain) {
    errors.push('From chain and to chain must be different');
  }

  // Validate tokens
  if (!params.fromToken || typeof params.fromToken !== 'string') {
    errors.push('From token is required');
  }
  if (!params.toToken || typeof params.toToken !== 'string') {
    errors.push('To token is required');
  }

  // Validate amount
  if (!validateAmount(params.fromAmount)) {
    errors.push('Invalid from amount format');
  } else if (!validateAmountPositive(params.fromAmount)) {
    errors.push('From amount must be greater than zero');
  }

  // Validate to address
  if (!params.toAddress || typeof params.toAddress !== 'string') {
    errors.push('To address is required');
  }

  // Validate slippage tolerance if provided
  if (params.slippageTolerance !== undefined) {
    if (typeof params.slippageTolerance !== 'number' ||
        params.slippageTolerance < 0 ||
        params.slippageTolerance > 100) {
      errors.push('Slippage tolerance must be between 0 and 100');
    }
  }

  // Validate deadline if provided
  if (params.deadline !== undefined) {
    if (!isValidTimelock(params.deadline)) {
      errors.push('Invalid deadline timestamp');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate a secret string
 * @param secret - Secret to validate
 * @returns True if valid secret
 */
export function validateSecret(secret: string): boolean {
  return isValidSecret(secret);
}

/**
 * Validate a transaction hash
 * @param hash - Transaction hash to validate
 * @param chainType - Type of chain
 * @returns True if valid transaction hash
 */
export function validateTransactionHash(hash: string, chainType: 'ethereum' | 'cosmos'): boolean {
  if (!hash || typeof hash !== 'string') {
    return false;
  }

  if (chainType === 'ethereum') {
    // Ethereum transaction hashes are 32 bytes (64 hex chars) with 0x prefix
    return /^0x[a-fA-F0-9]{64}$/.test(hash);
  } else if (chainType === 'cosmos') {
    // Cosmos transaction hashes are typically 32 bytes (64 hex chars) uppercase
    return /^[A-F0-9]{64}$/.test(hash);
  }

  return false;
}

/**
 * Validate chain ID format
 * @param chainId - Chain ID to validate
 * @param chainType - Type of chain
 * @returns True if valid chain ID
 */
export function validateChainId(chainId: string | number, chainType: 'ethereum' | 'cosmos'): boolean {
  if (chainType === 'ethereum') {
    // Ethereum chain IDs are numbers
    const id = typeof chainId === 'string' ? parseInt(chainId) : chainId;
    return !isNaN(id) && id > 0;
  } else if (chainType === 'cosmos') {
    // Cosmos chain IDs are strings like "cosmoshub-4"
    return typeof chainId === 'string' && chainId.length > 0;
  }

  return false;
}

/**
 * Validate percentage value
 * @param percentage - Percentage to validate (0-100)
 * @returns True if valid percentage
 */
export function validatePercentage(percentage: number): boolean {
  return typeof percentage === 'number' &&
         !isNaN(percentage) &&
         percentage >= 0 &&
         percentage <= 100;
}

import { CrossChainSwapParams } from '../types';
import {
  validateAddress,
  validateAmount,
  validateAmountPositive,
  isValidHash,
  isValidSecret,
  validateChainId,
} from '../utils/validation';

/**
 * Enhanced validation utilities with comprehensive sanitization
 */

// Maximum values for security
const MAX_AMOUNT = '1000000000'; // 1 billion tokens max
const MIN_AMOUNT = '0.000001'; // Minimum practical amount
const MAX_TIMELOCK_DURATION = 48 * 3600; // 48 hours
const MIN_TIMELOCK_BUFFER = 300; // 5 minutes
const MAX_MEMO_LENGTH = 256;
const MAX_ROUTE_HOPS = 4;

// Sanitization utilities
export function sanitizeAmount(amount: string): string {
  // Remove any non-numeric characters except decimal point
  const cleaned = amount.replace(/[^0-9.]/g, '');
  
  // Ensure only one decimal point
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    return parts[0] + '.' + parts.slice(1).join('');
  }
  
  // Remove leading zeros (except for decimals)
  if (parts[0]) {
    parts[0] = parts[0].replace(/^0+/, '') || '0';
  }
  
  return parts.join('.');
}

export function sanitizeAddress(address: string): string {
  // Trim whitespace
  let cleaned = address.trim();
  
  // Normalize Ethereum addresses to lowercase with 0x prefix
  if (cleaned.match(/^(0x)?[a-fA-F0-9]{40}$/)) {
    if (!cleaned.startsWith('0x')) {
      cleaned = '0x' + cleaned;
    }
    return cleaned.toLowerCase();
  }
  
  // Cosmos addresses - just trim and return
  return cleaned;
}

export function sanitizeHex(hex: string): string {
  // Remove whitespace and convert to lowercase
  let sanitized = hex.trim().toLowerCase();
  
  // Remove 0x prefix if present
  if (sanitized.startsWith('0x')) {
    sanitized = sanitized.slice(2);
  }
  
  // Remove control characters and non-hex characters
  sanitized = sanitized.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  sanitized = sanitized.replace(/[^0-9a-f]/g, '');
  
  return sanitized;
}

export function sanitizeMemo(memo: string): string {
  // Remove control characters
  let cleaned = memo.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Trim to max length
  if (cleaned.length > MAX_MEMO_LENGTH) {
    cleaned = cleaned.substring(0, MAX_MEMO_LENGTH);
  }
  
  return cleaned.trim();
}

// Enhanced validation functions
export interface ValidationResult<T = unknown> {
  valid: boolean;
  errors: string[];
  sanitized?: T;
}

export function validateCrossChainSwapParams(
  params: CrossChainSwapParams
): ValidationResult {
  const errors: string[] = [];
  const sanitized: CrossChainSwapParams = { ...params };

  // Sanitize inputs
  sanitized.fromAmount = sanitizeAmount(params.fromAmount);
  sanitized.toAddress = sanitizeAddress(params.toAddress);
  sanitized.fromToken = sanitizeAddress(params.fromToken);
  sanitized.toToken = sanitizeAddress(params.toToken);

  // Validate amount
  if (!validateAmountPositive(sanitized.fromAmount)) {
    errors.push('Amount must be positive');
  }
  
  if (!validateAmount(sanitized.fromAmount, 18)) {
    errors.push('Invalid amount format');
  }
  
  // Check amount bounds
  try {
    const amountNum = parseFloat(sanitized.fromAmount);
    const minNum = parseFloat(MIN_AMOUNT);
    const maxNum = parseFloat(MAX_AMOUNT);
    
    if (amountNum < minNum) {
      errors.push(`Amount too small (minimum ${MIN_AMOUNT})`);
    }
    if (amountNum > maxNum) {
      errors.push(`Amount too large (maximum ${MAX_AMOUNT})`);
    }
  } catch {
    errors.push('Invalid amount value');
  }

  // Validate addresses
  if (!validateAddress(sanitized.toAddress, 'cosmos')) {
    errors.push('Invalid receiver address');
  }
  
  if (sanitized.fromChain === 'ethereum' && !sanitized.fromToken.startsWith('0x')) {
    errors.push('Invalid Ethereum token address');
  }

  // Validate chains
  if (params.fromChain !== 'ethereum') {
    errors.push('Source chain must be ethereum');
  }
  
  if (!validateChainId(params.toChain, 'cosmos')) {
    errors.push('Invalid target chain ID');
  }

  // Validate deadline if provided
  if (params.deadline !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    
    if (params.deadline <= now + MIN_TIMELOCK_BUFFER) {
      errors.push(`Deadline too short (minimum ${MIN_TIMELOCK_BUFFER} seconds in future)`);
    }
    
    if (params.deadline > now + MAX_TIMELOCK_DURATION) {
      errors.push(`Deadline too long (maximum ${MAX_TIMELOCK_DURATION} seconds)`);
    }
  }
  
  if (params.slippageTolerance !== undefined) {
    if (params.slippageTolerance < 0 || params.slippageTolerance > 50) {
      errors.push('Slippage tolerance must be between 0 and 50%');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined
  };
}

// Removed validateCreateHTLCParams - CreateHTLCParams type doesn't exist

export function validateSecret(secret: string): ValidationResult {
  const errors: string[] = [];
  const sanitized = sanitizeHex(secret);

  if (!isValidSecret(sanitized)) {
    errors.push('Invalid secret format (must be 32 bytes hex)');
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined
  };
}

export function validateSwapStatus(
  htlcId: string,
  chain: 'ethereum' | 'cosmos'
): ValidationResult {
  const errors: string[] = [];
  const sanitizedId = sanitizeHex(htlcId);

  if (!isValidHash(sanitizedId)) {
    errors.push('Invalid HTLC ID format');
  }

  if (chain !== 'ethereum' && chain !== 'cosmos') {
    errors.push('Invalid chain (must be ethereum or cosmos)');
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? { htlcId: sanitizedId, chain } : undefined
  };
}

// Security check utilities
export function detectSuspiciousPatterns(input: string): string[] {
  const suspiciousPatterns: string[] = [];

  // Check for script injection attempts
  if (/<script|javascript:|on\w+=/i.test(input)) {
    suspiciousPatterns.push('Potential script injection');
  }

  // Check for SQL injection patterns
  if (/union\s+select|drop\s+table|insert\s+into/i.test(input)) {
    suspiciousPatterns.push('Potential SQL injection');
  }

  // Check for command injection
  if (/[;&|]|\.\.\/|~\//i.test(input)) {
    suspiciousPatterns.push('Potential command injection');
  }

  // Check for null bytes
  if (/\x00/.test(input)) {
    suspiciousPatterns.push('Null byte detected');
  }

  return suspiciousPatterns;
}

// Rate limiting helper
export class RateLimitChecker {
  private attempts: Map<string, number[]> = new Map();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts: number = 10, windowMs: number = 60000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  checkLimit(identifier: string): { allowed: boolean; remainingAttempts: number } {
    const now = Date.now();
    const attempts = this.attempts.get(identifier) || [];
    
    // Remove old attempts outside the window
    const validAttempts = attempts.filter(time => now - time < this.windowMs);
    
    if (validAttempts.length >= this.maxAttempts) {
      this.attempts.set(identifier, validAttempts);
      return { allowed: false, remainingAttempts: 0 };
    }
    
    // Add current attempt
    validAttempts.push(now);
    this.attempts.set(identifier, validAttempts);
    
    return {
      allowed: true,
      remainingAttempts: this.maxAttempts - validAttempts.length
    };
  }

  reset(identifier: string): void {
    this.attempts.delete(identifier);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, attempts] of this.attempts.entries()) {
      const validAttempts = attempts.filter(time => now - time < this.windowMs);
      if (validAttempts.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, validAttempts);
      }
    }
  }
}
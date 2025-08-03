import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult, ValidationChain } from 'express-validator';
import { Logger } from 'pino';
import { getMetrics } from '../monitoring/prometheus-metrics';
import DOMPurify from 'isomorphic-dompurify';
import { ethers } from 'ethers';

/**
 * Comprehensive input validation middleware for API endpoints
 */

// Constants for validation
const MAX_REASON_LENGTH = 500;
const MAX_MEMO_LENGTH = 256;
const MAX_HTLC_ID_LENGTH = 66; // 0x + 64 hex chars
const MAX_SECRET_LENGTH = 66;
const MIN_TIMELOCK_BUFFER = 300; // 5 minutes minimum
const MAX_TIMELOCK_DURATION = 48 * 3600; // 48 hours maximum
const VALID_CHAIN_TYPES = ['ethereum', 'cosmos'] as const;
const VALID_IP_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const VALID_COSMOS_CHAIN_ID_REGEX = /^[a-z0-9\-]+$/;
const VALID_HEX_REGEX = /^0x[a-fA-F0-9]+$/;

// Sanitization functions
export function sanitizeText(text: string): string {
  // Remove any HTML/script tags
  const cleaned = DOMPurify.sanitize(text, { ALLOWED_TAGS: [] });
  // Normalize whitespace
  return cleaned.trim().replace(/\s+/g, ' ');
}

export function sanitizeHex(hex: string): string {
  if (!hex.startsWith('0x')) {
    hex = '0x' + hex;
  }
  return hex.toLowerCase();
}

export function normalizeAmount(amount: string): string {
  // Remove any non-numeric characters except decimal point
  const cleaned = amount.replace(/[^0-9.]/g, '');
  // Ensure only one decimal point
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    return parts[0] + '.' + parts.slice(1).join('');
  }
  return cleaned;
}

// Custom validators
export const isValidEthereumAddress = (address: string): boolean => {
  try {
    return ethers.utils.isAddress(address);
  } catch {
    return false;
  }
};

export const isValidCosmosAddress = (address: string, prefix?: string): boolean => {
  const cosmosRegex = prefix 
    ? new RegExp(`^${prefix}1[a-z0-9]{38,}$`)
    : /^[a-z]+1[a-z0-9]{38,}$/;
  return cosmosRegex.test(address);
};

export const isValidAmount = (amount: string): boolean => {
  const normalized = normalizeAmount(amount);
  if (!normalized || normalized === '0') return false;
  
  try {
    const value = parseFloat(normalized);
    return value > 0 && value < Number.MAX_SAFE_INTEGER;
  } catch {
    return false;
  }
};

export const isValidTimelock = (timelock: number): boolean => {
  const now = Math.floor(Date.now() / 1000);
  return timelock > now + MIN_TIMELOCK_BUFFER && 
         timelock < now + MAX_TIMELOCK_DURATION;
};

export const isValidHashlock = (hashlock: string): boolean => {
  const cleaned = sanitizeHex(hashlock);
  return VALID_HEX_REGEX.test(cleaned) && cleaned.length === 66;
};

export const isValidSecret = (secret: string): boolean => {
  const cleaned = sanitizeHex(secret);
  return VALID_HEX_REGEX.test(cleaned) && cleaned.length === 66;
};

// Validation middleware factory
export function createValidationMiddleware(logger: Logger) {
  const metrics = getMetrics();

  // Error handler for validation failures
  const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      logger.warn({ 
        errors: errors.array(),
        path: req.path,
        method: req.method,
        ip: req.ip
      }, 'Input validation failed');
      
      metrics.recordRpcError('input_validation', 'validation_failed', req.path);
      
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array().map(err => ({
          field: (err as any).param || 'unknown',
          message: err.msg,
          value: process.env.NODE_ENV === 'development' ? (err as any).value : undefined
        }))
      });
    }
    
    next();
  };

  return {
    handleValidationErrors,

    // Emergency stop validation
    validateEmergencyStop: [
      body('reason')
        .trim()
        .notEmpty().withMessage('Reason is required')
        .isLength({ max: MAX_REASON_LENGTH }).withMessage(`Reason too long (max ${MAX_REASON_LENGTH} chars)`)
        .customSanitizer(sanitizeText),
      handleValidationErrors
    ],

    // Blacklist validation
    validateBlacklistAdd: [
      param('ip')
        .matches(VALID_IP_REGEX).withMessage('Invalid IP address format'),
      body('reason')
        .trim()
        .notEmpty().withMessage('Reason is required')
        .isLength({ max: MAX_REASON_LENGTH }).withMessage(`Reason too long (max ${MAX_REASON_LENGTH} chars)`)
        .customSanitizer(sanitizeText),
      body('duration')
        .optional()
        .isInt({ min: 60, max: 86400 }).withMessage('Duration must be between 60 and 86400 seconds'),
      handleValidationErrors
    ],

    // Blacklist removal validation
    validateBlacklistRemove: [
      param('ip')
        .matches(VALID_IP_REGEX).withMessage('Invalid IP address format'),
      handleValidationErrors
    ],

    // Circuit breaker validation
    validateCircuitBreaker: [
      param('name')
        .trim()
        .notEmpty().withMessage('Circuit breaker name is required')
        .matches(/^[a-zA-Z0-9_\-]+$/).withMessage('Invalid circuit breaker name format')
        .isLength({ max: 50 }).withMessage('Circuit breaker name too long'),
      body('reason')
        .optional()
        .trim()
        .isLength({ max: MAX_REASON_LENGTH }).withMessage(`Reason too long (max ${MAX_REASON_LENGTH} chars)`)
        .customSanitizer(sanitizeText),
      handleValidationErrors
    ],

    // Persistence cleanup validation
    validateCleanup: [
      body('retentionPeriod')
        .optional()
        .isInt({ min: 1, max: 365 }).withMessage('Retention period must be between 1 and 365 days'),
      handleValidationErrors
    ],

    // Secrets audit validation
    validateSecretsAudit: [
      query('limit')
        .optional()
        .isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
      handleValidationErrors
    ],

    // HTLC operation validation
    validateHTLCOperation: [
      body('htlcId')
        .trim()
        .notEmpty().withMessage('HTLC ID is required')
        .isLength({ max: MAX_HTLC_ID_LENGTH }).withMessage('Invalid HTLC ID length')
        .custom(value => {
          const cleaned = sanitizeHex(value);
          return VALID_HEX_REGEX.test(cleaned);
        }).withMessage('Invalid HTLC ID format')
        .customSanitizer(sanitizeHex),
      body('secret')
        .optional()
        .trim()
        .custom(isValidSecret).withMessage('Invalid secret format')
        .customSanitizer(sanitizeHex),
      body('chain')
        .optional()
        .isIn(VALID_CHAIN_TYPES).withMessage('Invalid chain type'),
      handleValidationErrors
    ],

    // Swap creation validation
    validateSwapCreation: [
      body('sourceChain')
        .isIn(VALID_CHAIN_TYPES).withMessage('Invalid source chain'),
      body('targetChain')
        .trim()
        .notEmpty().withMessage('Target chain is required')
        .matches(VALID_COSMOS_CHAIN_ID_REGEX).withMessage('Invalid target chain ID format'),
      body('amount')
        .trim()
        .notEmpty().withMessage('Amount is required')
        .custom(isValidAmount).withMessage('Invalid amount format')
        .customSanitizer(normalizeAmount),
      body('tokenAddress')
        .trim()
        .notEmpty().withMessage('Token address is required')
        .custom(isValidEthereumAddress).withMessage('Invalid token address'),
      body('sender')
        .trim()
        .notEmpty().withMessage('Sender address is required')
        .custom((value, { req }) => {
          if (req.body.sourceChain === 'ethereum') {
            return isValidEthereumAddress(value);
          }
          return isValidCosmosAddress(value);
        }).withMessage('Invalid sender address'),
      body('receiver')
        .trim()
        .notEmpty().withMessage('Receiver address is required')
        .custom((value, { req }) => {
          if (req.body.targetChain.startsWith('osmo')) {
            return isValidCosmosAddress(value, 'osmo');
          }
          return isValidCosmosAddress(value);
        }).withMessage('Invalid receiver address'),
      body('timelock')
        .optional()
        .isInt().withMessage('Timelock must be a number')
        .custom(isValidTimelock).withMessage('Invalid timelock value'),
      body('hashlock')
        .optional()
        .trim()
        .custom(isValidHashlock).withMessage('Invalid hashlock format')
        .customSanitizer(sanitizeHex),
      body('memo')
        .optional()
        .trim()
        .isLength({ max: MAX_MEMO_LENGTH }).withMessage(`Memo too long (max ${MAX_MEMO_LENGTH} chars)`)
        .customSanitizer(sanitizeText),
      handleValidationErrors
    ],

    // DEX swap validation
    validateDEXSwap: [
      body('targetToken')
        .trim()
        .notEmpty().withMessage('Target token is required')
        .matches(/^[a-zA-Z0-9\/\-]+$/).withMessage('Invalid token denomination'),
      body('minOutputAmount')
        .trim()
        .notEmpty().withMessage('Minimum output amount is required')
        .custom(isValidAmount).withMessage('Invalid minimum output amount')
        .customSanitizer(normalizeAmount),
      body('slippageTolerance')
        .optional()
        .isFloat({ min: 0, max: 100 }).withMessage('Slippage tolerance must be between 0 and 100'),
      body('poolId')
        .optional()
        .isInt({ min: 1 }).withMessage('Invalid pool ID'),
      handleValidationErrors
    ],

    // Route query validation
    validateRouteQuery: [
      query('sourceChain')
        .trim()
        .notEmpty().withMessage('Source chain is required'),
      query('targetChain')
        .trim()
        .notEmpty().withMessage('Target chain is required')
        .matches(VALID_COSMOS_CHAIN_ID_REGEX).withMessage('Invalid target chain format'),
      query('amount')
        .optional()
        .custom(isValidAmount).withMessage('Invalid amount format')
        .customSanitizer(normalizeAmount),
      handleValidationErrors
    ],

    // Generic text field sanitizer (for custom use)
    sanitizeTextField: (fieldName: string, maxLength: number = MAX_REASON_LENGTH): ValidationChain => {
      return body(fieldName)
        .optional()
        .trim()
        .isLength({ max: maxLength }).withMessage(`${fieldName} too long (max ${maxLength} chars)`)
        .customSanitizer(sanitizeText);
    },

    // Generic amount field validator
    validateAmountField: (fieldName: string, required: boolean = true): ValidationChain => {
      const validator = body(fieldName)
        .trim()
        .custom(isValidAmount).withMessage(`Invalid ${fieldName} format`)
        .customSanitizer(normalizeAmount);
      
      return required 
        ? validator.notEmpty().withMessage(`${fieldName} is required`)
        : validator.optional();
    },

    // Generic address field validator
    validateAddressField: (fieldName: string, chainType: 'ethereum' | 'cosmos', prefix?: string): ValidationChain => {
      return body(fieldName)
        .trim()
        .notEmpty().withMessage(`${fieldName} is required`)
        .custom(value => {
          if (chainType === 'ethereum') {
            return isValidEthereumAddress(value);
          }
          return isValidCosmosAddress(value, prefix);
        }).withMessage(`Invalid ${fieldName} format`);
    }
  };
}

// SQL injection prevention helper
export function sanitizeForSQL(input: string): string {
  // Basic SQL injection prevention - should be used with parameterized queries
  return input
    .replace(/'/g, "''")
    .replace(/;/g, '')
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '');
}

// Path traversal prevention
export function sanitizePath(path: string): string {
  return path
    .replace(/\.\./g, '')
    .replace(/~\//g, '')
    .replace(/^\/+/, '');
}

// Export validation regex patterns for reuse
export const ValidationPatterns = {
  IP: VALID_IP_REGEX,
  COSMOS_CHAIN_ID: VALID_COSMOS_CHAIN_ID_REGEX,
  HEX: VALID_HEX_REGEX,
  ETHEREUM_ADDRESS: /^0x[a-fA-F0-9]{40}$/,
  COSMOS_ADDRESS: /^[a-z]+1[a-z0-9]{38,}$/,
  AMOUNT: /^\d+(\.\d+)?$/,
  ALPHANUMERIC: /^[a-zA-Z0-9]+$/,
  ALPHANUMERIC_WITH_SYMBOLS: /^[a-zA-Z0-9_\-]+$/,
} as const;
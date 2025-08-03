/**
 * SDK Crypto Utilities - Delegation to @evmore/utils
 * 
 * This module re-exports crypto functions from @evmore/utils to maintain
 * backward compatibility while eliminating code duplication.
 */

// Re-export all crypto functions from the centralized utils
export {
  generateSecret,
  hashSecret,
  verifySecret,
  generateSecretPair,
  isValidSecret,
  isValidHash,
  sha256Hash,
  generateEthereumPrivateKey,
  generateToken,
  generateUUID,
  maskSecret,
  constantTimeCompare,
  hmacSha256,
  deriveKey,
  CRYPTO_CONSTANTS
} from '@evmore/utils';

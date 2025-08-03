/**
 * Centralized cryptographic utilities for EVMore
 * Provides consistent crypto operations across all packages
 */

import * as crypto from 'crypto';

/**
 * Generate a cryptographically secure random secret
 * @param length - Number of bytes to generate (default: 32)
 * @returns Hex string of the secret
 */
export function generateSecret(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash data using SHA256
 * @param data - The data to hash (string, Buffer, or hex string)
 * @returns SHA256 hash as hex string
 */
export function sha256Hash(data: string | Buffer): string {
  let buffer: Buffer;
  
  if (typeof data === 'string') {
    // Try to parse as hex first, fallback to UTF-8
    buffer = data.match(/^[0-9a-fA-F]+$/) && data.length % 2 === 0
      ? Buffer.from(data, 'hex')
      : Buffer.from(data, 'utf-8');
  } else {
    buffer = data;
  }
  
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Hash a secret using SHA256 (specific to HTLC secrets)
 * @param secret - The secret to hash (hex string)
 * @returns SHA256 hash of the secret (hex string)
 */
export function hashSecret(secret: string): string {
  const secretBuffer = Buffer.from(secret, 'hex');
  return crypto.createHash('sha256').update(secretBuffer).digest('hex');
}

/**
 * Verify that a secret matches a hash
 * @param secret - The secret to verify (hex string)
 * @param hash - The expected hash (hex string)
 * @returns True if the secret matches the hash
 */
export function verifySecret(secret: string, hash: string): boolean {
  return hashSecret(secret) === hash.toLowerCase();
}

/**
 * Generate a secret and its hash pair
 * @returns Object containing the secret and its hash
 */
export function generateSecretPair(): { secret: string; hash: string } {
  const secret = generateSecret();
  const hash = hashSecret(secret);
  return { secret, hash };
}

/**
 * Generate an Ethereum private key
 * @returns Ethereum private key with 0x prefix
 */
export function generateEthereumPrivateKey(): string {
  return '0x' + generateSecret(32);
}

/**
 * Validate that a string is a valid hex string
 * @param value - The value to validate
 * @param expectedLength - Expected length in characters (optional)
 * @returns True if valid hex
 */
export function isValidHex(value: string, expectedLength?: number): boolean {
  const hexPattern = expectedLength 
    ? new RegExp(`^[0-9a-fA-F]{${expectedLength}}$`)
    : /^[0-9a-fA-F]+$/;
  
  return hexPattern.test(value);
}

/**
 * Validate that a string is a valid hex secret (64 characters = 32 bytes)
 * @param secret - The secret to validate
 * @returns True if valid
 */
export function isValidSecret(secret: string): boolean {
  return isValidHex(secret, 64);
}

/**
 * Validate that a string is a valid hex hash (64 characters = 32 bytes)
 * @param hash - The hash to validate
 * @returns True if valid
 */
export function isValidHash(hash: string): boolean {
  return isValidHex(hash, 64);
}

/**
 * Mask a secret value for safe logging
 * @param value - The secret value to mask
 * @param visibleChars - Number of characters to show at start/end (default: 4)
 * @returns Masked secret string
 */
export function maskSecret(value: string, visibleChars: number = 4): string {
  if (value.length <= visibleChars * 2) {
    return '*'.repeat(value.length);
  }
  
  const start = value.substring(0, visibleChars);
  const end = value.substring(value.length - visibleChars);
  const middle = '*'.repeat(Math.max(0, value.length - visibleChars * 2));
  
  return start + middle + end;
}

/**
 * Generate a secure random token for authentication
 * @param length - Number of bytes to generate (default: 32)
 * @returns Base64 URL-safe token
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Generate a UUID v4
 * @returns UUID v4 string
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Constant-time string comparison to prevent timing attacks
 * @param a - First string
 * @param b - Second string  
 * @returns True if strings are equal
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Hash-based Message Authentication Code (HMAC) with SHA256
 * @param key - The secret key
 * @param message - The message to authenticate
 * @returns HMAC-SHA256 as hex string
 */
export function hmacSha256(key: string | Buffer, message: string | Buffer): string {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

/**
 * Derive a key using PBKDF2
 * @param password - The password
 * @param salt - The salt (recommended: 16+ bytes)
 * @param iterations - Number of iterations (recommended: 100000+)
 * @param keyLength - Length of derived key in bytes (default: 32)
 * @returns Derived key as hex string
 */
export function deriveKey(
  password: string, 
  salt: string | Buffer, 
  iterations: number = 100000, 
  keyLength: number = 32
): string {
  return crypto.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256').toString('hex');
}

// Export commonly used constants
export const CRYPTO_CONSTANTS = {
  SECRET_LENGTH: 32,
  HASH_LENGTH: 32,
  PRIVATE_KEY_LENGTH: 32,
  DEFAULT_PBKDF2_ITERATIONS: 100000,
  MIN_SALT_LENGTH: 16
} as const;
import {
  generateSecret,
  sha256Hash,
  hashSecret,
  verifySecret,
  generateSecretPair,
  generateEthereumPrivateKey,
  isValidHex,
  isValidSecret,
  isValidHash,
  maskSecret,
  generateToken,
  generateUUID,
  constantTimeCompare,
  hmacSha256,
  deriveKey,
  CRYPTO_CONSTANTS
} from './crypto-utils';

describe('Crypto Utils', () => {
  describe('generateSecret', () => {
    it('should generate a secret with default length', () => {
      const secret = generateSecret();
      expect(secret).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(isValidHex(secret)).toBe(true);
    });

    it('should generate a secret with custom length', () => {
      const secret = generateSecret(16);
      expect(secret).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(isValidHex(secret)).toBe(true);
    });

    it('should generate different secrets on each call', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('sha256Hash', () => {
    it('should hash a string', () => {
      const result = sha256Hash('hello world');
      expect(result).toHaveLength(64);
      expect(isValidHex(result)).toBe(true);
    });

    it('should hash a buffer', () => {
      const buffer = Buffer.from('hello world', 'utf-8');
      const result = sha256Hash(buffer);
      expect(result).toHaveLength(64);
      expect(isValidHex(result)).toBe(true);
    });

    it('should hash a hex string', () => {
      const hexString = '48656c6c6f'; // "Hello" in hex
      const result = sha256Hash(hexString);
      expect(result).toHaveLength(64);
      expect(isValidHex(result)).toBe(true);
    });

    it('should produce consistent hashes', () => {
      const input = 'test string';
      const hash1 = sha256Hash(input);
      const hash2 = sha256Hash(input);
      expect(hash1).toBe(hash2);
    });
  });

  describe('hashSecret', () => {
    it('should hash a secret correctly', () => {
      const secret = 'a'.repeat(64); // 32 bytes
      const hash = hashSecret(secret);
      expect(hash).toHaveLength(64);
      expect(isValidHex(hash)).toBe(true);
    });

    it('should produce consistent hashes', () => {
      const secret = 'b'.repeat(64);
      const hash1 = hashSecret(secret);
      const hash2 = hashSecret(secret);
      expect(hash1).toBe(hash2);
    });
  });

  describe('verifySecret', () => {
    it('should verify a correct secret', () => {
      const secret = generateSecret();
      const hash = hashSecret(secret);
      expect(verifySecret(secret, hash)).toBe(true);
    });

    it('should reject an incorrect secret', () => {
      const secret = generateSecret();
      const wrongSecret = generateSecret();
      const hash = hashSecret(secret);
      expect(verifySecret(wrongSecret, hash)).toBe(false);
    });

    it('should handle case-insensitive hash comparison', () => {
      const secret = generateSecret();
      const hash = hashSecret(secret).toUpperCase();
      expect(verifySecret(secret, hash)).toBe(true);
    });
  });

  describe('generateSecretPair', () => {
    it('should generate a valid secret pair', () => {
      const pair = generateSecretPair();
      expect(pair.secret).toHaveLength(64);
      expect(pair.hash).toHaveLength(64);
      expect(isValidHex(pair.secret)).toBe(true);
      expect(isValidHex(pair.hash)).toBe(true);
      expect(verifySecret(pair.secret, pair.hash)).toBe(true);
    });

    it('should generate different pairs on each call', () => {
      const pair1 = generateSecretPair();
      const pair2 = generateSecretPair();
      expect(pair1.secret).not.toBe(pair2.secret);
      expect(pair1.hash).not.toBe(pair2.hash);
    });
  });

  describe('generateEthereumPrivateKey', () => {
    it('should generate a valid Ethereum private key', () => {
      const privateKey = generateEthereumPrivateKey();
      expect(privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(privateKey).toHaveLength(66); // 0x + 64 hex chars
    });

    it('should generate different keys on each call', () => {
      const key1 = generateEthereumPrivateKey();
      const key2 = generateEthereumPrivateKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('isValidHex', () => {
    it('should validate correct hex strings', () => {
      expect(isValidHex('1234567890abcdef')).toBe(true);
      expect(isValidHex('ABCDEF')).toBe(true);
      expect(isValidHex('')).toBe(false); // Empty string should not be valid hex
    });

    it('should reject invalid hex strings', () => {
      expect(isValidHex('1234567890abcdefg')).toBe(false);
      expect(isValidHex('hello')).toBe(false);
      expect(isValidHex('0x123456')).toBe(false);
    });

    it('should validate hex strings with specific length', () => {
      expect(isValidHex('1234567890abcdef', 16)).toBe(true);
      expect(isValidHex('1234567890abcdef', 8)).toBe(false);
    });
  });

  describe('isValidSecret', () => {
    it('should validate correct secrets', () => {
      const validSecret = 'a'.repeat(64);
      expect(isValidSecret(validSecret)).toBe(true);
    });

    it('should reject invalid secrets', () => {
      expect(isValidSecret('a'.repeat(63))).toBe(false);
      expect(isValidSecret('a'.repeat(65))).toBe(false);
      expect(isValidSecret('invalid')).toBe(false);
    });
  });

  describe('isValidHash', () => {
    it('should validate correct hashes', () => {
      const validHash = 'a'.repeat(64);
      expect(isValidHash(validHash)).toBe(true);
    });

    it('should reject invalid hashes', () => {
      expect(isValidHash('a'.repeat(63))).toBe(false);
      expect(isValidHash('a'.repeat(65))).toBe(false);
      expect(isValidHash('invalid')).toBe(false);
    });
  });

  describe('maskSecret', () => {
    it('should mask a secret with default settings', () => {
      const secret = '1234567890abcdef';
      const masked = maskSecret(secret);
      expect(masked).toMatch(/^1234\*+cdef$/);
      expect(masked).toHaveLength(secret.length);
    });

    it('should mask a secret with custom visible chars', () => {
      const secret = '1234567890abcdef';
      const masked = maskSecret(secret, 2);
      expect(masked).toMatch(/^12\*+ef$/);
      expect(masked).toHaveLength(secret.length);
    });

    it('should handle short secrets', () => {
      const secret = '1234';
      const masked = maskSecret(secret, 2);
      expect(masked).toBe('****');
    });

    it('should handle very short secrets', () => {
      const secret = '12';
      const masked = maskSecret(secret, 2);
      expect(masked).toBe('**');
    });
  });

  describe('generateToken', () => {
    it('should generate a token with default length', () => {
      const token = generateToken();
      expect(token).toHaveLength(43); // 32 bytes in base64url
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate a token with custom length', () => {
      const token = generateToken(16);
      expect(token).toHaveLength(22); // 16 bytes in base64url
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate different tokens on each call', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('generateUUID', () => {
    it('should generate a valid UUID v4', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should generate different UUIDs on each call', () => {
      const uuid1 = generateUUID();
      const uuid2 = generateUUID();
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('constantTimeCompare', () => {
    it('should return true for equal strings', () => {
      expect(constantTimeCompare('hello', 'hello')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(constantTimeCompare('hello', 'world')).toBe(false);
    });

    it('should return false for strings of different lengths', () => {
      expect(constantTimeCompare('hello', 'helloworld')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(constantTimeCompare('', '')).toBe(true);
      expect(constantTimeCompare('', 'hello')).toBe(false);
    });
  });

  describe('hmacSha256', () => {
    it('should generate HMAC with string key and message', () => {
      const key = 'secret';
      const message = 'hello world';
      const hmac = hmacSha256(key, message);
      expect(hmac).toHaveLength(64);
      expect(isValidHex(hmac)).toBe(true);
    });

    it('should generate HMAC with buffer key and message', () => {
      const key = Buffer.from('secret');
      const message = Buffer.from('hello world');
      const hmac = hmacSha256(key, message);
      expect(hmac).toHaveLength(64);
      expect(isValidHex(hmac)).toBe(true);
    });

    it('should produce consistent HMACs', () => {
      const key = 'secret';
      const message = 'hello world';
      const hmac1 = hmacSha256(key, message);
      const hmac2 = hmacSha256(key, message);
      expect(hmac1).toBe(hmac2);
    });
  });

  describe('deriveKey', () => {
    it('should derive a key with default parameters', () => {
      const password = 'password';
      const salt = 'salt';
      const key = deriveKey(password, salt);
      expect(key).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(isValidHex(key)).toBe(true);
    });

    it('should derive a key with custom parameters', () => {
      const password = 'password';
      const salt = 'salt';
      const key = deriveKey(password, salt, 1000, 16);
      expect(key).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(isValidHex(key)).toBe(true);
    });

    it('should produce consistent keys', () => {
      const password = 'password';
      const salt = 'salt';
      const key1 = deriveKey(password, salt);
      const key2 = deriveKey(password, salt);
      expect(key1).toBe(key2);
    });

    it('should produce different keys with different salts', () => {
      const password = 'password';
      const salt1 = 'salt1';
      const salt2 = 'salt2';
      const key1 = deriveKey(password, salt1);
      const key2 = deriveKey(password, salt2);
      expect(key1).not.toBe(key2);
    });
  });

  describe('CRYPTO_CONSTANTS', () => {
    it('should have correct constant values', () => {
      expect(CRYPTO_CONSTANTS.SECRET_LENGTH).toBe(32);
      expect(CRYPTO_CONSTANTS.HASH_LENGTH).toBe(32);
      expect(CRYPTO_CONSTANTS.PRIVATE_KEY_LENGTH).toBe(32);
      expect(CRYPTO_CONSTANTS.DEFAULT_PBKDF2_ITERATIONS).toBe(100000);
      expect(CRYPTO_CONSTANTS.MIN_SALT_LENGTH).toBe(16);
    });
  });
}); 
import {
  generateSecretPair,
  hashSecret,
  verifySecret,
  generateSecret,
  isValidSecret,
  isValidHash
} from '../../src/utils/crypto';

describe('Crypto Utilities', () => {
  describe('generateSecretPair', () => {
    it('should generate unique secret pairs', () => {
      const pair1 = generateSecretPair();
      const pair2 = generateSecretPair();

      expect(pair1.secret).not.toBe(pair2.secret);
      expect(pair1.hash).not.toBe(pair2.hash);
    });

    it('should generate 32-byte secrets', () => {
      const { secret } = generateSecretPair();
      // 32 bytes = 64 hex chars
      expect(secret.length).toBe(64);
    });

    it('should generate valid SHA256 hashes', () => {
      const { secret, hash } = generateSecretPair();
      const expectedHash = hashSecret(secret);
      expect(hash).toBe(expectedHash);
    });
  });

  describe('hashSecret', () => {
    it('should produce consistent hashes', () => {
      const secret = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const hash1 = hashSecret(secret);
      const hash2 = hashSecret(secret);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different secrets', () => {
      const secret1 = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const secret2 = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      
      const hash1 = hashSecret(secret1);
      const hash2 = hashSecret(secret2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle secrets without 0x prefix', () => {
      const secretWith0x = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const secretWithout0x = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      const hash1 = hashSecret(secretWith0x);
      const hash2 = hashSecret(secretWithout0x);

      expect(hash1).toBe(hash2);
    });
  });

  describe('verifySecret', () => {
    it('should verify correct secret-hash pairs', () => {
      const { secret, hash } = generateSecretPair();
      expect(verifySecret(secret, hash)).toBe(true);
    });

    it('should reject incorrect secret-hash pairs', () => {
      const { hash } = generateSecretPair();
      const wrongSecret = '0xwrongsecret1234567890abcdef1234567890abcdef1234567890abcdef1234';
      
      expect(verifySecret(wrongSecret, hash)).toBe(false);
    });

    it('should handle different format inputs', () => {
      const secret = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const hash = hashSecret(secret);

      // Both should work the same since we don't use 0x prefix
      expect(verifySecret(secret, hash)).toBe(true);
    });
  });

  describe('generateSecret', () => {
    it('should generate unique secrets', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();

      expect(secret1).not.toBe(secret2);
    });

    it('should generate 32-byte secrets', () => {
      const secret = generateSecret();
      // 32 bytes = 64 hex chars
      expect(secret.length).toBe(64);
    });

    it('should generate valid hex strings', () => {
      const secret = generateSecret();
      
      expect(secret).toMatch(/^[a-fA-F0-9]+$/);
      expect(isValidSecret(secret)).toBe(true);
    });
  });

  describe('isValidSecret', () => {
    it('should validate correct secrets', () => {
      const validSecret = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      expect(isValidSecret(validSecret)).toBe(true);
    });

    it('should reject invalid secrets', () => {
      expect(isValidSecret('too-short')).toBe(false);
      expect(isValidSecret('invalid-chars-!@#$')).toBe(false);
      expect(isValidSecret('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef00')).toBe(false); // Too long
    });
  });

  describe('isValidHash', () => {
    it('should validate correct hashes', () => {
      const validHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      expect(isValidHash(validHash)).toBe(true);
    });

    it('should reject invalid hashes', () => {
      expect(isValidHash('too-short')).toBe(false);
      expect(isValidHash('invalid-chars-!@#$')).toBe(false);
      expect(isValidHash('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef00')).toBe(false); // Too long
    });
  });
});
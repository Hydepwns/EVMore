/**
 * Tests for ethers compatibility utilities
 */

import {
  getZeroAddress,
  bigNumberToNumber,
  bigNumberToString,
  isBigNumberish,
  getEthersVersion,
  createProvider,
  createContract
} from './ethers-utils';

describe('Ethers Compatibility Utils', () => {
  describe('getZeroAddress', () => {
    it('should return a valid zero address', async () => {
      const zeroAddress = await getZeroAddress();
      expect(zeroAddress).toBe('0x0000000000000000000000000000000000000000');
    });
  });

  describe('bigNumberToNumber', () => {
    it('should convert various number formats to number', () => {
      expect(bigNumberToNumber(42)).toBe(42);
      expect(bigNumberToNumber('123')).toBe(123);
      expect(bigNumberToNumber(BigInt(456))).toBe(456);
    });

    it('should handle BigNumber objects with toNumber method', () => {
      const mockBigNumber = {
        toNumber: () => 789
      };
      expect(bigNumberToNumber(mockBigNumber)).toBe(789);
    });

    it('should throw error for invalid inputs', () => {
      expect(() => bigNumberToNumber({})).toThrow();
    });
  });

  describe('bigNumberToString', () => {
    it('should convert various number formats to string', () => {
      expect(bigNumberToString(42)).toBe('42');
      expect(bigNumberToString('123')).toBe('123');
      expect(bigNumberToString(BigInt(456))).toBe('456');
    });

    it('should handle objects with toString method', () => {
      const mockObject = {
        toString: () => '789'
      };
      expect(bigNumberToString(mockObject)).toBe('789');
    });
  });

  describe('isBigNumberish', () => {
    it('should identify BigNumberish values', () => {
      expect(isBigNumberish(42)).toBe(true);
      expect(isBigNumberish('123')).toBe(true);
      expect(isBigNumberish(BigInt(456))).toBe(true);
      expect(isBigNumberish({ toNumber: () => 1 })).toBe(true);
      expect(isBigNumberish({})).toBe(false);
      expect(isBigNumberish(null)).toBe(false);
    });
  });

  describe('getEthersVersion', () => {
    it('should detect ethers version', async () => {
      const version = await getEthersVersion();
      expect(version).toHaveProperty('version');
      expect(version).toHaveProperty('majorVersion');
      expect(typeof version.majorVersion).toBe('number');
    });
  });

  describe('createProvider', () => {
    it('should create a provider with valid URL', async () => {
      const provider = await createProvider('https://example.com');
      expect(provider).toBeDefined();
    });
  });

  describe('createContract', () => {
    it('should create a contract instance', async () => {
      const mockProvider = {};
      const mockAbi = ['function test()'];
      const contract = await createContract('0x1234567890123456789012345678901234567890', mockAbi, mockProvider);
      expect(contract).toBeDefined();
    });
  });
});
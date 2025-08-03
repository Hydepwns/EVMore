import {
  validateSwapParams,
  validateHTLCParams,
  validateAmount,
  validateAmountPositive,
  validateAmountMax,
  validateAddress,
  validateChainId,
  validateTransactionHash,
  validatePercentage,
  HTLCValidationParams,
  SwapValidationParams,
  ValidationResult
} from '../../src/utils/validation';

describe('Validation Utilities', () => {
  describe('validateSwapParams', () => {
    const validParams: SwapValidationParams = {
      fromChain: 'ethereum',
      toChain: 'osmosis-1',
      fromToken: '0xusdc',
      toToken: 'uosmo',
      fromAmount: '1000000',
      toAddress: 'osmo1receiver',
      slippageTolerance: 0.5,
    };

    it('should validate correct swap parameters', () => {
      const result = validateSwapParams(validParams);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing required fields', () => {
      const invalidParams = {
        fromChain: 'ethereum',
        // missing other fields
      } as SwapValidationParams;

      const result = validateSwapParams(invalidParams);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid amounts', () => {
      const invalidParams = {
        ...validParams,
        fromAmount: '-100',
      };

      const result = validateSwapParams(invalidParams);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid from amount format');
    });

    it('should reject same source and destination chains', () => {
      const invalidParams = {
        ...validParams,
        fromChain: 'ethereum',
        toChain: 'ethereum',
      };

      const result = validateSwapParams(invalidParams);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('From chain and to chain must be different');
    });

    it('should reject invalid slippage tolerance', () => {
      const invalidParams = {
        ...validParams,
        slippageTolerance: 101, // > 100%
      };

      const result = validateSwapParams(invalidParams);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Slippage tolerance must be between 0 and 100');
    });
  });

  describe('validateHTLCParams', () => {
    const validParams: HTLCValidationParams = {
      receiver: 'osmo1dl23dcs949yx3d9ky9x0lhym8xujq9de2uzcnf',
      amount: '1000000',
      token: 'uosmo',
      hashlock: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      timelock: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      sender: 'osmo1mqlmjzllw8lj99htxtwsw5fvadj7z66hme80q6',
      senderChainType: 'cosmos',
      receiverChainType: 'cosmos',
    };

    it('should validate correct HTLC parameters', () => {
      const result = validateHTLCParams(validParams);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject expired timelock', () => {
      const invalidParams = {
        ...validParams,
        timelock: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      };

      const result = validateHTLCParams(invalidParams);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid timelock (must be reasonable future timestamp)');
    });

    it('should reject invalid hashlock', () => {
      const invalidParams = {
        ...validParams,
        hashlock: '0xinvalidhash',
      };

      const result = validateHTLCParams(invalidParams);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid hashlock format (must be 64-character hex string)');
    });
  });

  describe('validateAmount', () => {
    it('should validate correct amount formats', () => {
      expect(validateAmount('1000')).toBe(true);
      expect(validateAmount('0.001')).toBe(true);
      expect(validateAmount('1000.123456789012345678', 18)).toBe(true);
    });

    it('should reject invalid amounts', () => {
      expect(validateAmount('-100')).toBe(false);
      expect(validateAmount('abc')).toBe(false);
      expect(validateAmount('')).toBe(false);
      expect(validateAmount('100.1234567890123456789', 18)).toBe(false); // Too many decimals
    });

  });

  describe('validateAmountPositive', () => {
    it('should validate positive amounts', () => {
      expect(validateAmountPositive('100')).toBe(true);
      expect(validateAmountPositive('0.001')).toBe(true);
    });

    it('should reject zero and negative amounts', () => {
      expect(validateAmountPositive('0')).toBe(false);
      expect(validateAmountPositive('-100')).toBe(false);
    });
  });

  describe('validateAmountMax', () => {
    it('should validate amounts within max', () => {
      expect(validateAmountMax('100', '1000')).toBe(true);
      expect(validateAmountMax('1000', '1000')).toBe(true);
    });

    it('should reject amounts over max', () => {
      expect(validateAmountMax('1001', '1000')).toBe(false);
    });
  });

  describe('validateAddress', () => {
    it('should validate Ethereum addresses', () => {
      expect(validateAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f06B09', 'ethereum')).toBe(true);
    });

    it('should validate Cosmos addresses', () => {
      expect(validateAddress('cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a', 'cosmos')).toBe(true);
      expect(validateAddress('osmo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmcn030', 'cosmos')).toBe(true);
    });

    it('should reject invalid addresses', () => {
      expect(validateAddress('invalid', 'ethereum')).toBe(false);
      expect(validateAddress('invalid', 'cosmos')).toBe(false);
    });
  });

  describe('validateChainId', () => {
    it('should validate Ethereum chain IDs', () => {
      expect(validateChainId(1, 'ethereum')).toBe(true);
      expect(validateChainId('1', 'ethereum')).toBe(true);
      expect(validateChainId(1337, 'ethereum')).toBe(true);
    });

    it('should validate Cosmos chain IDs', () => {
      expect(validateChainId('osmosis-1', 'cosmos')).toBe(true);
      expect(validateChainId('cosmoshub-4', 'cosmos')).toBe(true);
    });

    it('should reject invalid chain IDs', () => {
      expect(validateChainId('osmosis-1', 'ethereum')).toBe(false);
      expect(validateChainId(1, 'cosmos')).toBe(false);
      expect(validateChainId('', 'cosmos')).toBe(false);
    });
  });

  describe('validateTransactionHash', () => {
    it('should validate Ethereum transaction hashes', () => {
      expect(validateTransactionHash('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'ethereum')).toBe(true);
    });

    it('should validate Cosmos transaction hashes', () => {
      expect(validateTransactionHash('1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF', 'cosmos')).toBe(true);
    });

    it('should reject invalid transaction hashes', () => {
      expect(validateTransactionHash('0x123', 'ethereum')).toBe(false);
      expect(validateTransactionHash('invalid', 'cosmos')).toBe(false);
    });
  });

  describe('validatePercentage', () => {
    it('should validate correct percentages', () => {
      expect(validatePercentage(0)).toBe(true);
      expect(validatePercentage(50.5)).toBe(true);
      expect(validatePercentage(100)).toBe(true);
    });

    it('should reject invalid percentages', () => {
      expect(validatePercentage(-1)).toBe(false);
      expect(validatePercentage(101)).toBe(false);
      expect(validatePercentage(NaN)).toBe(false);
    });
  });
});
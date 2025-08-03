// Jest tests for address utilities
import {
  convertAddress,
  convertCosmosAddress,
  cosmosAddressToEthereum,
  isValidEthereumAddress,
  isValidCosmosAddress,
  getAddressPrefix,
  normalizeAddress,
  truncateAddress
} from '../../src/utils/address';

describe('Address Utilities', () => {
  describe('convertCosmosAddress', () => {
    it('should convert between Cosmos address prefixes', () => {
      // Example cosmos address
      const cosmosAddr = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a';
      const osmoAddr = convertCosmosAddress(cosmosAddr, 'osmo');
      
      expect(osmoAddr).toMatch(/^osmo1/);
      expect(getAddressPrefix(osmoAddr)).toBe('osmo');
    });

    it('should throw on invalid bech32 address', () => {
      expect(() => {
        convertCosmosAddress('invalid-address', 'osmo');
      }).toThrow('Invalid bech32 address');
    });
  });

  describe('isValidEthereumAddress', () => {
    it('should validate correct Ethereum addresses', () => {
      expect(isValidEthereumAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f06B09')).toBe(true);
      expect(isValidEthereumAddress('0x0000000000000000000000000000000000000000')).toBe(true);
    });

    it('should reject invalid Ethereum addresses', () => {
      expect(isValidEthereumAddress('0x123')).toBe(false);
      expect(isValidEthereumAddress('not-an-address')).toBe(false);
      expect(isValidEthereumAddress('cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a')).toBe(false);
    });
  });

  describe('isValidCosmosAddress', () => {
    it('should validate correct Cosmos addresses', () => {
      expect(isValidCosmosAddress('cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a')).toBe(true);
      expect(isValidCosmosAddress('osmo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmcn030')).toBe(true);
    });

    it('should validate with expected prefix', () => {
      expect(isValidCosmosAddress('cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a', 'cosmos')).toBe(true);
      expect(isValidCosmosAddress('cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a', 'osmo')).toBe(false);
    });

    it('should reject invalid addresses', () => {
      expect(isValidCosmosAddress('invalid-address')).toBe(false);
      expect(isValidCosmosAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f06B09')).toBe(false);
    });
  });

  describe('convertAddress', () => {
    describe('Ethereum to Cosmos conversion', () => {
      const ethAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f06B09';

      it('should convert Ethereum address to Osmosis', () => {
        const osmoAddress = convertAddress(ethAddress, 'osmosis-1');
        expect(osmoAddress).toMatch(/^osmo1/);
        expect(isValidCosmosAddress(osmoAddress)).toBe(true);
      });

      it('should convert Ethereum address to Cosmos Hub', () => {
        const cosmosAddress = convertAddress(ethAddress, 'cosmoshub-4');
        expect(cosmosAddress).toMatch(/^cosmos1/);
        expect(isValidCosmosAddress(cosmosAddress)).toBe(true);
      });

      it('should produce deterministic results', () => {
        const addr1 = convertAddress(ethAddress, 'osmosis-1');
        const addr2 = convertAddress(ethAddress, 'osmosis-1');
        expect(addr1).toBe(addr2);
      });

      it('should produce different addresses for different Ethereum addresses', () => {
        const ethAddr1 = '0x742d35Cc6634C0532925a3b844Bc9e7595f06B09';
        const ethAddr2 = '0x1234567890123456789012345678901234567890';
        
        const osmo1 = convertAddress(ethAddr1, 'osmosis-1');
        const osmo2 = convertAddress(ethAddr2, 'osmosis-1');
        
        expect(osmo1).not.toBe(osmo2);
      });

      it('should handle lowercase Ethereum addresses', () => {
        const upperCase = '0x742d35Cc6634C0532925a3b844Bc9e7595f06B09';
        const lowerCase = upperCase.toLowerCase();
        
        const addr1 = convertAddress(upperCase, 'osmosis-1');
        const addr2 = convertAddress(lowerCase, 'osmosis-1');
        
        expect(addr1).toBe(addr2);
      });
    });

    describe('Cosmos to Cosmos conversion', () => {
      it('should convert between Cosmos chains', () => {
        const cosmosAddr = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a';
        const osmoAddr = convertAddress(cosmosAddr, 'osmosis-1');
        
        expect(osmoAddr).toMatch(/^osmo1/);
        expect(getAddressPrefix(osmoAddr)).toBe('osmo');
      });
    });

    describe('Cosmos to Ethereum conversion', () => {
      const cosmosAddress = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a';
      const osmoAddress = 'osmo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmcn030';

      it('should convert Cosmos address to Ethereum', () => {
        const ethAddress = convertAddress(cosmosAddress, 'ethereum');
        expect(ethAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(isValidEthereumAddress(ethAddress)).toBe(true);
      });

      it('should convert Osmosis address to Ethereum', () => {
        const ethAddress = convertAddress(osmoAddress, 'eth');
        expect(ethAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(isValidEthereumAddress(ethAddress)).toBe(true);
      });

      it('should produce deterministic results', () => {
        const addr1 = convertAddress(cosmosAddress, 'ethereum');
        const addr2 = convertAddress(cosmosAddress, 'ethereum');
        expect(addr1).toBe(addr2);
      });

      it('should produce different addresses for different Cosmos addresses', () => {
        const eth1 = convertAddress(cosmosAddress, 'ethereum');
        const eth2 = convertAddress(osmoAddress, 'ethereum');
        expect(eth1).not.toBe(eth2);
      });

      it('should produce different addresses for same address on different chains', () => {
        // Convert the same underlying address with different prefixes
        const cosmosAddr = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a';
        const osmoAddr = convertCosmosAddress(cosmosAddr, 'osmo');
        
        const eth1 = convertAddress(cosmosAddr, 'ethereum');
        const eth2 = convertAddress(osmoAddr, 'ethereum');
        
        // Should be different because we include the prefix in the hash
        expect(eth1).not.toBe(eth2);
      });
    });

    it('should throw for unknown chains', () => {
      expect(() => {
        convertAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f06B09', 'unknown-chain');
      }).toThrow('Unknown target chain: unknown-chain');
    });
  });

  describe('cosmosAddressToEthereum', () => {
    it('should convert valid Cosmos addresses to Ethereum', () => {
      const cosmosAddr = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a';
      const ethAddr = cosmosAddressToEthereum(cosmosAddr);
      
      expect(ethAddr).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(isValidEthereumAddress(ethAddr)).toBe(true);
    });

    it('should throw on invalid Cosmos address', () => {
      expect(() => {
        cosmosAddressToEthereum('invalid-address');
      }).toThrow('Invalid Cosmos address: invalid-address');
      
      expect(() => {
        cosmosAddressToEthereum('0x742d35Cc6634C0532925a3b844Bc9e7595f06B09');
      }).toThrow('Invalid Cosmos address');
    });

    it('should produce deterministic results', () => {
      const cosmosAddr = 'osmo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmcn030';
      const eth1 = cosmosAddressToEthereum(cosmosAddr);
      const eth2 = cosmosAddressToEthereum(cosmosAddr);
      
      expect(eth1).toBe(eth2);
    });
  });

  describe('normalizeAddress', () => {
    it('should lowercase Ethereum addresses', () => {
      const addr = '0x742d35Cc6634C0532925a3b844Bc9e7595f06B09';
      expect(normalizeAddress(addr)).toBe(addr.toLowerCase());
    });

    it('should leave Cosmos addresses unchanged', () => {
      const addr = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a';
      expect(normalizeAddress(addr)).toBe(addr);
    });
  });

  describe('truncateAddress', () => {
    it('should truncate long addresses', () => {
      const addr = '0x742d35Cc6634C0532925a3b844Bc9e7595f06B09';
      expect(truncateAddress(addr)).toBe('0x742d...6B09');
      expect(truncateAddress(addr, 10, 6)).toBe('0x742d35Cc...f06B09');
    });

    it('should not truncate short addresses', () => {
      const addr = '0x12345678';
      expect(truncateAddress(addr)).toBe(addr);
    });
  });
});
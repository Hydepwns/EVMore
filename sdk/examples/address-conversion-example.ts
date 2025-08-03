import { convertAddress, cosmosAddressToEthereum, isValidEthereumAddress, isValidCosmosAddress } from '../src/utils/address';

/**
 * Example: Cross-chain address conversion
 * 
 * This example demonstrates how to convert addresses between Ethereum and Cosmos chains
 * for cross-chain swaps in the 1inch Fusion+ protocol.
 */

// Example Ethereum addresses
const ethereumAddresses = [
  '0x742d35Cc6634C0532925a3b844Bc9e7595f06B09',
  '0x1234567890123456789012345678901234567890',
  '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDT contract
];

// Supported Cosmos chains
const cosmosChains = ['osmosis-1', 'cosmoshub-4', 'juno-1'];

console.log('=== Ethereum to Cosmos Address Conversion ===\n');

ethereumAddresses.forEach(ethAddr => {
  console.log(`Ethereum address: ${ethAddr}`);
  
  cosmosChains.forEach(chain => {
    try {
      const cosmosAddr = convertAddress(ethAddr, chain);
      console.log(`  ${chain}: ${cosmosAddr}`);
    } catch (error) {
      console.error(`  ${chain}: Error - ${error.message}`);
    }
  });
  
  console.log('');
});

// Example Cosmos addresses
const cosmosAddresses = [
  'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a',
  'osmo1cyyzpxplxdzkeea7kwsydadg87357qnahakaks',
  'juno1v4887y83d6g28puzvt8cl0f3cdhd3y6y9mpysnsp3k8krdm7l6jqgm0rkn'
];

console.log('=== Cosmos to Ethereum Address Conversion ===\n');

cosmosAddresses.forEach(cosmosAddr => {
  console.log(`Cosmos address: ${cosmosAddr}`);
  
  try {
    // Convert to Ethereum using the general function
    const ethAddr = convertAddress(cosmosAddr, 'ethereum');
    console.log(`  As Ethereum (via convertAddress): ${ethAddr}`);
    
    // Also demonstrate direct conversion
    const ethAddrDirect = cosmosAddressToEthereum(cosmosAddr);
    console.log(`  As Ethereum (direct function): ${ethAddrDirect}`);
    console.log(`  Both methods match: ${ethAddr === ethAddrDirect} ✓`);
  } catch (error) {
    console.error(`  Error: ${error.message}`);
  }
  
  console.log('');
});

console.log('=== Cosmos to Cosmos Address Conversion ===\n');

cosmosAddresses.forEach(cosmosAddr => {
  console.log(`Original address: ${cosmosAddr}`);
  
  // Convert to other Cosmos chains
  const targetChains = cosmosChains.filter(chain => {
    // Don't convert to the same chain
    const isOsmo = cosmosAddr.startsWith('osmo') && chain === 'osmosis-1';
    const isCosmos = cosmosAddr.startsWith('cosmos') && chain === 'cosmoshub-4';
    const isJuno = cosmosAddr.startsWith('juno') && chain === 'juno-1';
    return !(isOsmo || isCosmos || isJuno);
  });
  
  targetChains.forEach(chain => {
    try {
      const convertedAddr = convertAddress(cosmosAddr, chain);
      console.log(`  ${chain}: ${convertedAddr}`);
    } catch (error) {
      console.error(`  ${chain}: Error - ${error.message}`);
    }
  });
  
  console.log('');
});

// Cross-chain swap address mapping example
console.log('=== Cross-Chain Swap Address Mapping ===\n');

const swapExample = {
  ethereum: {
    userAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f06B09',
    htlcContract: '0x1234567890123456789012345678901234567890'
  },
  osmosis: {
    userAddress: '',
    htlcContract: 'osmo1htlc...'
  },
  cosmos: {
    userAddress: '',
    htlcContract: 'cosmos1htlc...'
  }
};

// Convert user address for each chain
swapExample.osmosis.userAddress = convertAddress(swapExample.ethereum.userAddress, 'osmosis-1');
swapExample.cosmos.userAddress = convertAddress(swapExample.ethereum.userAddress, 'cosmoshub-4');

console.log('User initiating swap from Ethereum:');
console.log(`  Ethereum: ${swapExample.ethereum.userAddress}`);
console.log(`  Will receive on Osmosis as: ${swapExample.osmosis.userAddress}`);
console.log(`  Or on Cosmos Hub as: ${swapExample.cosmos.userAddress}`);
console.log('');

// Validation examples
console.log('=== Address Validation ===\n');

const testAddresses = [
  '0x742d35Cc6634C0532925a3b844Bc9e7595f06B09',
  'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a',
  'invalid-address',
  '0xinvalid',
  'osmo1cyyzpxplxdzkeea7kwsydadg87357qnahakaks'
];

testAddresses.forEach(addr => {
  const isEth = isValidEthereumAddress(addr);
  const isCosmos = isValidCosmosAddress(addr);
  
  console.log(`${addr}:`);
  console.log(`  Valid Ethereum: ${isEth}`);
  console.log(`  Valid Cosmos: ${isCosmos}`);
  console.log('');
});

// Deterministic conversion verification
console.log('=== Deterministic Conversion ===\n');

const ethAddr = '0x742d35Cc6634C0532925a3b844Bc9e7595f06B09';
const conversions: string[] = [];

// Convert the same address multiple times
for (let i = 0; i < 5; i++) {
  conversions.push(convertAddress(ethAddr, 'osmosis-1'));
}

console.log(`Converting ${ethAddr} to Osmosis 5 times:`);
conversions.forEach((addr, i) => {
  console.log(`  Attempt ${i + 1}: ${addr}`);
});

const allSame = conversions.every(addr => addr === conversions[0]);
console.log(`\nAll conversions identical: ${allSame} ✓`);

// Important notes
console.log('\n=== Important Notes ===\n');
console.log('1. Both Ethereum↔Cosmos conversions are deterministic - same input always produces same output');
console.log('2. The conversion uses SHA256 hashing with a salt for security');
console.log('3. Converted addresses are valid but do not share private keys with original addresses');
console.log('4. Conversions are ONE-WAY - you cannot recover the original address from a converted one');
console.log('5. Users must use the cross-chain bridge to move assets, not just convert addresses');
console.log('6. Always validate addresses before using them in transactions');
console.log('7. Cosmos→Ethereum conversion includes the chain prefix in the hash for uniqueness');
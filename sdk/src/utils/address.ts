import { bech32 } from 'bech32';
import { sha256Hash } from '@evmore/utils';

/**
 * Convert between different address formats for cross-chain compatibility
 */

/**
 * SHA256 hash function that returns Buffer
 */
function sha256(data: Buffer): Buffer {
  const hexHash = sha256Hash(data);
  return Buffer.from(hexHash, 'hex');
}

/**
 * Convert a Cosmos bech32 address to another prefix
 * @param address - The original bech32 address
 * @param newPrefix - The target address prefix
 * @returns The address with the new prefix
 */
export function convertCosmosAddress(address: string, newPrefix: string): string {
  try {
    const decoded = bech32.decode(address);
    return bech32.encode(newPrefix, decoded.words);
  } catch (error) {
    throw new Error(`Invalid bech32 address: ${address}`);
  }
}

/**
 * Validate an Ethereum address
 * @param address - The address to validate
 * @returns True if valid Ethereum address
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate a Cosmos bech32 address
 * @param address - The address to validate
 * @param expectedPrefix - Optional expected prefix
 * @returns True if valid bech32 address
 */
export function isValidCosmosAddress(address: string, expectedPrefix?: string): boolean {
  try {
    const decoded = bech32.decode(address);
    if (expectedPrefix && decoded.prefix !== expectedPrefix) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the prefix from a bech32 address
 * @param address - The bech32 address
 * @returns The address prefix
 */
export function getAddressPrefix(address: string): string {
  try {
    const decoded = bech32.decode(address);
    return decoded.prefix;
  } catch (error) {
    throw new Error(`Invalid bech32 address: ${address}`);
  }
}

/**
 * Convert Cosmos address to Ethereum address
 * @param cosmosAddress - The Cosmos bech32 address
 * @returns The deterministic Ethereum address
 */
export function cosmosAddressToEthereum(cosmosAddress: string): string {
  if (!isValidCosmosAddress(cosmosAddress)) {
    throw new Error(`Invalid Cosmos address: ${cosmosAddress}`);
  }

  // Decode the bech32 address to get the raw bytes
  const decoded = bech32.decode(cosmosAddress);
  const addressBytes = Buffer.from(bech32.fromWords(decoded.words));
  
  // Create a deterministic Ethereum address from Cosmos address
  // This uses a hash to ensure the mapping is one-way and deterministic
  const hash = sha256(Buffer.concat([
    Buffer.from('cosmos-ethereum-bridge'),
    addressBytes,
    Buffer.from(decoded.prefix) // Include prefix to differentiate chains
  ]));
  
  // Take first 20 bytes of the hash for the Ethereum address
  const ethAddressBytes = hash.slice(0, 20);
  
  // Convert to hex and add 0x prefix
  const ethAddress = '0x' + ethAddressBytes.toString('hex');
  
  return ethAddress;
}

/**
 * Convert address based on chain type
 * @param address - The address to convert
 * @param targetChain - The target chain identifier or 'ethereum' for Ethereum
 * @returns The converted address
 */
export function convertAddress(address: string, targetChain: string): string {
  // Simple mapping - in production this would be more sophisticated
  const chainPrefixes: Record<string, string> = {
    'cosmoshub-4': 'cosmos',
    'osmosis-1': 'osmo',
    'juno-1': 'juno',
    'secret-4': 'secret',
    'stargaze-1': 'stars'
  };

  if (isValidEthereumAddress(address)) {
    // Convert Ethereum address to Cosmos address
    const targetPrefix = chainPrefixes[targetChain];
    if (!targetPrefix) {
      throw new Error(`Unknown target chain: ${targetChain}`);
    }
    
    // Remove 0x prefix and convert to bytes
    const ethAddressHex = address.toLowerCase().replace('0x', '');
    const ethAddressBytes = Buffer.from(ethAddressHex, 'hex');
    
    // Create a deterministic Cosmos address from Ethereum address
    // This uses a hash of the Ethereum address to generate a valid Cosmos address
    const hash = sha256(Buffer.concat([
      Buffer.from('ethereum-cosmos-bridge'),
      ethAddressBytes
    ]));
    
    // Take first 20 bytes of the hash for the address
    const addressBytes = hash.slice(0, 20);
    
    // Convert to bech32
    const words = bech32.toWords(addressBytes);
    const encoded = bech32.encode(targetPrefix, words);
    
    return encoded;
  }

  if (isValidCosmosAddress(address)) {
    // Check if converting to Ethereum
    if (targetChain === 'ethereum' || targetChain === 'eth') {
      return cosmosAddressToEthereum(address);
    }
    
    // Otherwise convert to another Cosmos chain
    const targetPrefix = chainPrefixes[targetChain];
    if (targetPrefix) {
      return convertCosmosAddress(address, targetPrefix);
    }
  }

  throw new Error(`Cannot convert address ${address} for chain ${targetChain}`);
}

/**
 * Normalize an address to lowercase for comparisons
 * @param address - The address to normalize
 * @returns Normalized address
 */
export function normalizeAddress(address: string): string {
  if (isValidEthereumAddress(address)) {
    return address.toLowerCase();
  }
  return address; // Cosmos addresses are case-sensitive
}

/**
 * Truncate an address for display purposes
 * @param address - The address to truncate
 * @param startChars - Number of characters to show at start
 * @param endChars - Number of characters to show at end
 * @returns Truncated address
 */
export function truncateAddress(
  address: string,
  startChars: number = 6,
  endChars: number = 4
): string {
  if (address.length <= startChars + endChars) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

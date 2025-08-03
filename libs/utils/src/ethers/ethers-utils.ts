/**
 * Ethers.js version compatibility utilities
 * Handles differences between ethers v5 and v6
 */

/**
 * Get zero address compatible with both ethers v5 and v6
 */
export async function getZeroAddress(): Promise<string> {
  const { ethers } = await import('ethers');
  
  // v6 has ZeroAddress, v5 has constants.AddressZero
  return (ethers as any).ZeroAddress || 
         (ethers as any).constants?.AddressZero || 
         '0x0000000000000000000000000000000000000000';
}

/**
 * Convert BigNumber/bigint to number, compatible with both ethers v5 and v6
 */
export function bigNumberToNumber(value: any): number {
  if (typeof value === 'bigint') {
    // ethers v6 uses native bigint
    return Number(value);
  } else if (value && typeof value.toNumber === 'function') {
    // ethers v5 BigNumber
    return value.toNumber();
  } else if (typeof value === 'number') {
    // Already a number
    return value;
  } else if (typeof value === 'string') {
    // String representation
    return parseInt(value, 10);
  }
  
  throw new Error(`Cannot convert value to number: ${value}`);
}

/**
 * Convert BigNumber/bigint to string, compatible with both ethers v5 and v6
 */
export function bigNumberToString(value: any): string {
  if (typeof value === 'bigint') {
    // ethers v6 uses native bigint
    return value.toString();
  } else if (value && typeof value.toString === 'function') {
    // ethers v5 BigNumber or any object with toString
    return value.toString();
  } else if (typeof value === 'string') {
    // Already a string
    return value;
  } else if (typeof value === 'number') {
    // Number to string
    return value.toString();
  }
  
  throw new Error(`Cannot convert value to string: ${value}`);
}

/**
 * Check if value is a BigNumber/bigint
 */
export function isBigNumberish(value: any): boolean {
  return (
    typeof value === 'bigint' ||
    (value && typeof value.toNumber === 'function') ||
    (value && typeof value.toString === 'function' && value._isBigNumber) ||
    typeof value === 'number' ||
    typeof value === 'string'
  );
}

/**
 * Create a provider compatible with both ethers v5 and v6
 */
export async function createProvider(rpcUrl: string): Promise<any> {
  const { ethers } = await import('ethers');
  
  // Try v6 first, then fallback to v5
  if ((ethers as any).JsonRpcProvider) {
    // ethers v6
    return new (ethers as any).JsonRpcProvider(rpcUrl);
  } else if ((ethers as any).providers?.JsonRpcProvider) {
    // ethers v5
    return new (ethers as any).providers.JsonRpcProvider(rpcUrl);
  }
  
  throw new Error('Unable to create JsonRpcProvider with current ethers version');
}

/**
 * Create a contract compatible with both ethers v5 and v6
 */
export async function createContract(address: string, abi: any, providerOrSigner: any): Promise<any> {
  const { ethers } = await import('ethers');
  return new (ethers as any).Contract(address, abi, providerOrSigner);
}

/**
 * Format ether value compatible with both ethers v5 and v6
 */
export async function formatEther(value: any): Promise<string> {
  const { ethers } = await import('ethers');
  
  if ((ethers as any).formatEther) {
    // ethers v6
    return (ethers as any).formatEther(value);
  } else if ((ethers as any).utils?.formatEther) {
    // ethers v5
    return (ethers as any).utils.formatEther(value);
  }
  
  throw new Error('Unable to format ether with current ethers version');
}

/**
 * Parse ether value compatible with both ethers v5 and v6
 */
export async function parseEther(value: string): Promise<any> {
  const { ethers } = await import('ethers');
  
  if ((ethers as any).parseEther) {
    // ethers v6
    return (ethers as any).parseEther(value);
  } else if ((ethers as any).utils?.parseEther) {
    // ethers v5
    return (ethers as any).utils.parseEther(value);
  }
  
  throw new Error('Unable to parse ether with current ethers version');
}

/**
 * Get ethers version info
 */
export async function getEthersVersion(): Promise<{ version: string; majorVersion: number }> {
  const { ethers } = await import('ethers');
  
  // Try to detect version based on available APIs
  const hasV6APIs = Boolean((ethers as any).JsonRpcProvider && (ethers as any).parseEther && (ethers as any).formatEther);
  const hasV5APIs = Boolean((ethers as any).providers && (ethers as any).utils);
  
  if (hasV6APIs) {
    return { version: '6.x', majorVersion: 6 };
  } else if (hasV5APIs) {
    return { version: '5.x', majorVersion: 5 };
  }
  
  return { version: 'unknown', majorVersion: 0 };
}
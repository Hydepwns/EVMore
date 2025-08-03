/**
 * Formatting utilities for amounts, addresses, and other display values
 */

import { BigNumber } from 'ethers';

/**
 * Format an amount string with proper decimal places
 * @param amount - Amount to format
 * @param decimals - Number of decimal places
 * @param maxDecimals - Maximum decimal places to show
 * @returns Formatted amount string
 */
export function formatAmount(
  amount: string | number,
  decimals: number = 18,
  maxDecimals: number = 6
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (isNaN(num)) {
    return '0';
  }

  // Convert to appropriate decimal places
  const factor = Math.pow(10, decimals);
  const scaled = num / factor;

  // Format with limited decimal places
  return scaled.toFixed(Math.min(maxDecimals, decimals));
}

/**
 * Format a BigNumber amount for display
 * @param amount - BigNumber amount
 * @param decimals - Token decimals
 * @param maxDecimals - Maximum decimal places to show
 * @returns Formatted amount string
 */
export function formatBigNumber(
  amount: BigNumber,
  decimals: number = 18,
  maxDecimals: number = 6
): string {
  try {
    const divisor = BigNumber.from(10).pow(decimals);
    const quotient = amount.div(divisor);
    const remainder = amount.mod(divisor);

    if (remainder.isZero()) {
      return quotient.toString();
    }

    // Calculate decimal part
    const decimalPart = remainder.mul(BigNumber.from(10).pow(maxDecimals)).div(divisor);
    const decimalStr = decimalPart.toString().padStart(maxDecimals, '0');

    // Remove trailing zeros
    const trimmed = decimalStr.replace(/0+$/, '');

    if (trimmed.length === 0) {
      return quotient.toString();
    }

    return `${quotient.toString()}.${trimmed}`;
  } catch (error) {
    return '0';
  }
}

/**
 * Format amount with unit suffix (K, M, B, T)
 * @param amount - Amount to format
 * @param decimals - Decimal places for the result
 * @returns Formatted amount with unit
 */
export function formatAmountWithUnit(amount: number, decimals: number = 2): string {
  const units = ['', 'K', 'M', 'B', 'T'];
  let unitIndex = 0;
  let value = Math.abs(amount);

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }

  const sign = amount < 0 ? '-' : '';
  return `${sign}${value.toFixed(decimals)}${units[unitIndex]}`;
}

/**
 * Format percentage with specified decimal places
 * @param percentage - Percentage value (0-100)
 * @param decimals - Number of decimal places
 * @returns Formatted percentage string with % symbol
 */
export function formatPercentage(percentage: number, decimals: number = 2): string {
  if (isNaN(percentage)) {
    return '0%';
  }
  return `${percentage.toFixed(decimals)}%`;
}

/**
 * Format price with appropriate decimal places based on value
 * @param price - Price to format
 * @param currency - Currency symbol (default: '$')
 * @returns Formatted price string
 */
export function formatPrice(price: number, currency: string = '$'): string {
  if (isNaN(price) || price === 0) {
    return `${currency}0.00`;
  }

  let decimals = 2;

  // Use more decimal places for very small amounts
  if (price < 0.01) {
    decimals = 6;
  } else if (price < 1) {
    decimals = 4;
  }

  return `${currency}${price.toFixed(decimals)}`;
}

/**
 * Format gas amount for display
 * @param gas - Gas amount
 * @param unit - Gas unit (e.g., 'gwei', 'wei')
 * @returns Formatted gas string
 */
export function formatGas(gas: string | number, unit: string = 'gwei'): string {
  const amount = typeof gas === 'string' ? parseFloat(gas) : gas;

  if (isNaN(amount)) {
    return `0 ${unit}`;
  }

  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(2)}M ${unit}`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(2)}K ${unit}`;
  } else {
    return `${amount.toFixed(2)} ${unit}`;
  }
}

/**
 * Format duration in seconds to human readable format
 * @param seconds - Duration in seconds
 * @param short - Use short format (1h 30m vs 1 hour 30 minutes)
 * @returns Formatted duration string
 */
export function formatDuration(seconds: number, short: boolean = true): string {
  if (seconds <= 0) {
    return short ? '0s' : '0 seconds';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(short ? `${hours}h` : `${hours} hour${hours !== 1 ? 's' : ''}`);
  }
  if (minutes > 0) {
    parts.push(short ? `${minutes}m` : `${minutes} minute${minutes !== 1 ? 's' : ''}`);
  }
  if (secs > 0 && hours === 0) {
    parts.push(short ? `${secs}s` : `${secs} second${secs !== 1 ? 's' : ''}`);
  }

  return parts.join(' ');
}

/**
 * Format timestamp to human readable date/time
 * @param timestamp - Unix timestamp
 * @param includeTime - Whether to include time
 * @returns Formatted date string
 */
export function formatTimestamp(timestamp: number, includeTime: boolean = true): string {
  const date = new Date(timestamp * 1000);

  if (includeTime) {
    return date.toLocaleString();
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Format relative time (e.g., "2 hours ago", "in 30 minutes")
 * @param timestamp - Unix timestamp
 * @returns Relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = timestamp - now;
  const absDiff = Math.abs(diff);

  if (absDiff < 60) {
    return diff > 0 ? 'in less than a minute' : 'less than a minute ago';
  }

  const minutes = Math.floor(absDiff / 60);
  const hours = Math.floor(absDiff / 3600);
  const days = Math.floor(absDiff / 86400);

  let unit: string;
  let value: number;

  if (days > 0) {
    unit = `day${days !== 1 ? 's' : ''}`;
    value = days;
  } else if (hours > 0) {
    unit = `hour${hours !== 1 ? 's' : ''}`;
    value = hours;
  } else {
    unit = `minute${minutes !== 1 ? 's' : ''}`;
    value = minutes;
  }

  return diff > 0 ? `in ${value} ${unit}` : `${value} ${unit} ago`;
}

/**
 * Format token symbol for display
 * @param symbol - Token symbol
 * @param maxLength - Maximum length to display
 * @returns Formatted symbol
 */
export function formatTokenSymbol(symbol: string, maxLength: number = 10): string {
  if (!symbol) {
    return 'UNKNOWN';
  }

  if (symbol.length <= maxLength) {
    return symbol.toUpperCase();
  }

  return symbol.slice(0, maxLength - 3).toUpperCase() + '...';
}

/**
 * Format network name for display
 * @param networkId - Network identifier
 * @returns Human readable network name
 */
export function formatNetworkName(networkId: string): string {
  const networkNames: Record<string, string> = {
    '1': 'Ethereum Mainnet',
    '5': 'Goerli Testnet',
    '11155111': 'Sepolia Testnet',
    'cosmoshub-4': 'Cosmos Hub',
    'osmosis-1': 'Osmosis',
    'juno-1': 'Juno',
    'secret-4': 'Secret Network',
    'stargaze-1': 'Stargaze',
  };

  return networkNames[networkId] || networkId;
}

/**
 * Format transaction status for display
 * @param status - Transaction status
 * @returns Formatted status with color indication
 */
export function formatTransactionStatus(status: string): {
  text: string;
  color: 'green' | 'yellow' | 'red' | 'gray';
} {
  switch (status.toLowerCase()) {
    case 'confirmed':
    case 'completed':
    case 'success':
      return { text: 'Confirmed', color: 'green' };
    case 'pending':
    case 'processing':
      return { text: 'Pending', color: 'yellow' };
    case 'failed':
    case 'error':
      return { text: 'Failed', color: 'red' };
    case 'expired':
      return { text: 'Expired', color: 'red' };
    default:
      return { text: status, color: 'gray' };
  }
}

/**
 * Truncate text with ellipsis
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @param position - Where to truncate ('end', 'middle', 'start')
 * @returns Truncated text
 */
export function truncateText(
  text: string,
  maxLength: number,
  position: 'end' | 'middle' | 'start' = 'end'
): string {
  if (text.length <= maxLength) {
    return text;
  }

  switch (position) {
    case 'start':
      return '...' + text.slice(-(maxLength - 3));
    case 'middle':
      const start = Math.ceil((maxLength - 3) / 2);
      const end = Math.floor((maxLength - 3) / 2);
      return text.slice(0, start) + '...' + text.slice(-end);
    case 'end':
    default:
      return text.slice(0, maxLength - 3) + '...';
  }
}

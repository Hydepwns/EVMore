export function formatAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatAmount(amount: string, decimals: number): string {
  if (!amount) return '0';
  const value = parseFloat(amount) / Math.pow(10, decimals);
  
  if (value < 0.000001) return '< 0.000001';
  if (value < 1) return value.toFixed(6);
  if (value < 1000) return value.toFixed(4);
  if (value < 1000000) return `${(value / 1000).toFixed(2)}K`;
  return `${(value / 1000000).toFixed(2)}M`;
}

export function formatTokenAmount(amount: string, decimals: number, precision = 6): string {
  if (!amount || amount === '0') return '0';
  
  const value = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const quotient = value / divisor;
  const remainder = value % divisor;
  
  const decimalStr = remainder.toString().padStart(decimals, '0').slice(0, precision);
  const trimmedDecimal = decimalStr.replace(/0+$/, '');
  
  return trimmedDecimal ? `${quotient}.${trimmedDecimal}` : quotient.toString();
}

export function parseTokenAmount(amount: string, decimals: number): string {
  if (!amount || amount === '') return '0';
  
  const [whole, decimal = ''] = amount.split('.');
  const paddedDecimal = decimal.padEnd(decimals, '0').slice(0, decimals);
  
  const wholeBigInt = BigInt(whole || 0) * BigInt(10 ** decimals);
  const decimalBigInt = BigInt(paddedDecimal);
  
  return (wholeBigInt + decimalBigInt).toString();
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTransactionHash(hash: string, chars = 6): string {
  if (!hash) return '';
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}

export function calculatePartialAmount(totalAmount: string, percentage: number): string {
  const amount = BigInt(totalAmount);
  const partial = (amount * BigInt(percentage)) / BigInt(100);
  return partial.toString();
}
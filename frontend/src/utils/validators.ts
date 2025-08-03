export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function isValidCosmosAddress(address: string): boolean {
  return /^cosmos[a-z0-9]{39}$/.test(address);
}

export function isValidAmount(amount: string): boolean {
  if (!amount || amount === '') return false;
  
  const regex = /^\d*\.?\d*$/;
  if (!regex.test(amount)) return false;
  
  const value = parseFloat(amount);
  return !isNaN(value) && value > 0;
}

export function validateSwapParams(params: {
  amount: string;
  fromToken?: { symbol: string };
  toToken?: { symbol: string };
  fromChain?: { id: string };
  toChain?: { id: string };
}): { isValid: boolean; error?: string } {
  if (!params.fromChain) {
    return { isValid: false, error: 'Please select source chain' };
  }
  
  if (!params.toChain) {
    return { isValid: false, error: 'Please select destination chain' };
  }
  
  if (params.fromChain.id === params.toChain.id) {
    return { isValid: false, error: 'Source and destination chains must be different' };
  }
  
  if (!params.fromToken) {
    return { isValid: false, error: 'Please select source token' };
  }
  
  if (!params.toToken) {
    return { isValid: false, error: 'Please select destination token' };
  }
  
  if (!isValidAmount(params.amount)) {
    return { isValid: false, error: 'Please enter a valid amount' };
  }
  
  return { isValid: true };
}

export function validatePartialFill(
  partialAmount: string,
  totalAmount: string,
  minPercentage: number,
  maxPercentage: number
): { isValid: boolean; error?: string } {
  if (!isValidAmount(partialAmount)) {
    return { isValid: false, error: 'Please enter a valid partial amount' };
  }
  
  const partial = BigInt(partialAmount);
  const total = BigInt(totalAmount);
  
  if (partial >= total) {
    return { isValid: false, error: 'Partial amount must be less than total amount' };
  }
  
  const percentage = Number((partial * BigInt(100)) / total);
  
  if (percentage < minPercentage) {
    return { isValid: false, error: `Partial fill must be at least ${minPercentage}%` };
  }
  
  if (percentage > maxPercentage) {
    return { isValid: false, error: `Partial fill cannot exceed ${maxPercentage}%` };
  }
  
  return { isValid: true };
}
import { 
  SwapOrder, 
  SwapStatus,
  SwapMetadata,
  SwapFees,
  CrossChainSwapParams
} from '@evmore/types';
import { SwapValidator } from '@evmore/types';
import { generateSecret, hashSecret } from '@evmore/utils';

export class SwapOrderBuilder {
  private order: Partial<SwapOrder> = {
    id: this.generateId(),
    status: SwapStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  withId(id: string): this {
    this.order.id = id;
    return this;
  }
  
  withOrderId(orderId: string): this {
    this.order.orderId = orderId;
    return this;
  }
  
  withStatus(status: SwapStatus): this {
    this.order.status = status;
    return this;
  }
  
  withSource(chainId: string, address: string, tokenAddress?: string, tokenDenom?: string): this {
    this.order.source = { 
      chainId, 
      address,
      tokenAddress,
      tokenDenom
    };
    return this;
  }
  
  withDestination(chainId: string, address: string, tokenAddress?: string, tokenDenom?: string): this {
    this.order.destination = { 
      chainId, 
      address,
      tokenAddress,
      tokenDenom
    };
    return this;
  }
  
  withAmount(value: string, decimals: number = 18, symbol: string = 'TEST'): this {
    this.order.amount = {
      value,
      decimals,
      displayValue: this.formatDisplayValue(value, decimals),
      symbol
    };
    return this;
  }
  
  withEthereumAmount(eth: string): this {
    const value = BigInt(parseFloat(eth) * 10**18).toString();
    return this.withAmount(value, 18, 'ETH');
  }
  
  withCosmosAmount(amount: string, denom: string = 'uatom'): this {
    const value = BigInt(parseFloat(amount) * 10**6).toString();
    return this.withAmount(value, 6, denom.toUpperCase());
  }
  
  withTimelock(duration: number = 3600, startTime?: number): this {
    const now = startTime || Math.floor(Date.now() / 1000);
    const buffer = Math.min(duration * 0.1, 300); // 10% of duration, max 5 minutes
    
    this.order.timelock = {
      startTime: now,
      duration,
      expiryTime: now + duration,
      buffer
    };
    
    this.order.expiresAt = new Date((now + duration) * 1000);
    return this;
  }
  
  withSecret(preimage?: string): this {
    const secret = preimage || generateSecret();
    const hash = hashSecret(secret);
    
    this.order.secret = {
      preimage: secret,
      hash,
      algorithm: 'sha256'
    };
    return this;
  }
  
  withSecretHash(hash: string): this {
    this.order.secret = {
      hash,
      algorithm: 'sha256'
    };
    return this;
  }
  
  withMetadata(metadata: Partial<SwapMetadata>): this {
    this.order.metadata = {
      ...this.order.metadata,
      ...metadata
    };
    return this;
  }
  
  withFees(fees: Partial<SwapFees>): this {
    const defaultFees: SwapFees = {
      networkFee: '0',
      protocolFee: '0',
      relayerFee: '0',
      total: '0'
    };
    
    const completeFees = { ...defaultFees, ...fees };
    
    if (!fees.total) {
      completeFees.total = (
        BigInt(completeFees.networkFee) + 
        BigInt(completeFees.protocolFee) + 
        BigInt(completeFees.relayerFee)
      ).toString();
    }
    
    this.order.metadata = {
      ...this.order.metadata,
      fees: completeFees
    };
    
    return this;
  }
  
  withDates(createdAt: Date, updatedAt?: Date): this {
    this.order.createdAt = createdAt;
    this.order.updatedAt = updatedAt || createdAt;
    return this;
  }
  
  // Preset configurations
  ethToOsmo(): this {
    return this
      .withSource('1', '0x1234567890123456789012345678901234567890')
      .withDestination('osmosis-1', 'osmo1abc123def456ghi789jkl012mno345pqr678stu')
      .withAmount('1000000000000000000', 18, 'ETH')
      .withTimelock(3600)
      .withSecret();
  }
  
  osmoToEth(): this {
    return this
      .withSource('osmosis-1', 'osmo1abc123def456ghi789jkl012mno345pqr678stu', undefined, 'uosmo')
      .withDestination('1', '0x1234567890123456789012345678901234567890')
      .withAmount('1000000', 6, 'OSMO')
      .withTimelock(3600)
      .withSecret();
  }
  
  atomToOsmo(): this {
    return this
      .withSource('cosmoshub-4', 'cosmos1abc123def456ghi789jkl012mno345pqr678stu', undefined, 'uatom')
      .withDestination('osmosis-1', 'osmo1def456ghi789jkl012mno345pqr678stu123abc')
      .withAmount('1000000', 6, 'ATOM')
      .withTimelock(3600)
      .withSecret();
  }
  
  expired(): this {
    const pastTime = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
    return this
      .withTimelock(3600, pastTime)
      .withStatus(SwapStatus.EXPIRED);
  }
  
  completed(): this {
    return this
      .withStatus(SwapStatus.COMPLETED)
      .withMetadata({
        sourceTransaction: '0xabc123def456...',
        targetTransaction: '0x789ghi012jkl...'
      });
  }
  
  failed(): this {
    return this
      .withStatus(SwapStatus.FAILED)
      .withMetadata({
        notes: 'Test failure'
      });
  }
  
  build(): SwapOrder {
    // Set defaults for required fields
    if (!this.order.orderId) {
      this.order.orderId = `order-${this.order.id}`;
    }
    
    if (!this.order.metadata) {
      this.order.metadata = {};
    }
    
    if (!this.order.expiresAt && this.order.timelock) {
      this.order.expiresAt = new Date(this.order.timelock.expiryTime * 1000);
    }
    
    // Validate the order
    const validation = SwapValidator.validateSwapOrder(this.order);
    if (!validation.valid) {
      throw new Error(`Invalid swap order: ${JSON.stringify(validation.errors)}`);
    }
    
    return this.order as SwapOrder;
  }
  
  buildUnsafe(): SwapOrder {
    // Build without validation for testing invalid states
    return this.order as SwapOrder;
  }
  
  private generateId(): string {
    return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private formatDisplayValue(value: string, decimals: number): string {
    try {
      const bigIntValue = BigInt(value);
      const divisor = BigInt(10 ** decimals);
      const wholePart = bigIntValue / divisor;
      const fractionalPart = bigIntValue % divisor;
      
      if (fractionalPart === BigInt(0)) {
        return wholePart.toString();
      }
      
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
      return `${wholePart.toString()}.${fractionalStr.replace(/0+$/, '')}`;
    } catch {
      return '0';
    }
  }
}

// Builder for CrossChainSwapParams
export class SwapParamsBuilder {
  private params: Partial<CrossChainSwapParams> = {};
  
  fromChain(chainId: string): this {
    this.params.fromChain = chainId;
    return this;
  }
  
  toChain(chainId: string): this {
    this.params.toChain = chainId;
    return this;
  }
  
  fromToken(token: string): this {
    this.params.fromToken = token;
    return this;
  }
  
  toToken(token: string): this {
    this.params.toToken = token;
    return this;
  }
  
  amount(amount: string): this {
    this.params.fromAmount = amount;
    return this;
  }
  
  toAddress(address: string): this {
    this.params.toAddress = address;
    return this;
  }
  
  slippage(tolerance: number): this {
    this.params.slippageTolerance = tolerance;
    return this;
  }
  
  deadline(timestamp: number): this {
    this.params.deadline = timestamp;
    return this;
  }
  
  metadata(data: Record<string, any>): this {
    this.params.metadata = data;
    return this;
  }
  
  // Preset configurations
  ethToOsmo(amount: string = '1000000000000000000'): this {
    return this
      .fromChain('1')
      .toChain('osmosis-1')
      .fromToken('ETH')
      .toToken('OSMO')
      .amount(amount)
      .toAddress('osmo1abc123def456ghi789jkl012mno345pqr678stu')
      .slippage(0.01)
      .deadline(Math.floor(Date.now() / 1000) + 1800);
  }
  
  build(): CrossChainSwapParams {
    // Validate required fields
    const required = ['fromChain', 'toChain', 'fromToken', 'toToken', 'fromAmount', 'toAddress'];
    for (const field of required) {
      if (!this.params[field as keyof CrossChainSwapParams]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    return this.params as CrossChainSwapParams;
  }
}

// Factory functions
export function createSwapOrder(): SwapOrderBuilder {
  return new SwapOrderBuilder();
}

export function createSwapParams(): SwapParamsBuilder {
  return new SwapParamsBuilder();
}

// Common test orders
export const TEST_SWAP_ORDERS = {
  ethToOsmo: () => createSwapOrder().ethToOsmo().build(),
  osmoToEth: () => createSwapOrder().osmoToEth().build(),
  atomToOsmo: () => createSwapOrder().atomToOsmo().build(),
  expired: () => createSwapOrder().ethToOsmo().expired().build(),
  completed: () => createSwapOrder().ethToOsmo().completed().build(),
  failed: () => createSwapOrder().ethToOsmo().failed().build()
};
# @evmore/types

Central type system for the EVMore cross-chain swap protocol.

## Overview

The `@evmore/types` package provides comprehensive TypeScript type definitions for all aspects of the EVMore protocol, including cross-chain swaps, HTLC operations, IBC transfers, and DEX integrations.

## Core Types

### Swap Types

```typescript
interface CrossChainSwap {
  id: string;
  sourceChain: string;
  targetChain: string;
  amount: string;
  sender: string;
  receiver: string;
  sourceToken: string;
  targetToken: string;
  timelock: number;
  status: SwapStatus;
  createdAt: Date;
  updatedAt: Date;
}

enum SwapStatus {
  PENDING = 'pending',
  HTLC_CREATED = 'htlc_created',
  IBC_TRANSFERRING = 'ibc_transferring',
  DEX_SWAPPING = 'dex_swapping',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded'
}
```

### HTLC Types

```typescript
interface HTLC {
  id: string;
  chain: string;
  sender: string;
  receiver: string;
  amount: string;
  hashlock: string;
  timelock: number;
  secret?: string;
  status: HTLCStatus;
  contractAddress: string;
  transactionHash: string;
  blockNumber: number;
}

enum HTLCStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  WITHDRAWN = 'withdrawn',
  REFUNDED = 'refunded',
  EXPIRED = 'expired'
}
```

### IBC Types

```typescript
interface IBCTransfer {
  sourcePort: string;
  sourceChannel: string;
  destinationPort: string;
  destinationChannel: string;
  amount: string;
  denom: string;
  sender: string;
  receiver: string;
  timeoutHeight?: number;
  timeoutTimestamp?: number;
  memo?: string;
}

interface IBCPacket {
  sequence: number;
  sourcePort: string;
  sourceChannel: string;
  destinationPort: string;
  destinationChannel: string;
  data: Uint8Array;
  timeoutHeight?: number;
  timeoutTimestamp?: number;
}
```

### DEX Types

```typescript
interface DEXSwap {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  slippageTolerance: number;
  fee: string;
  route: string[];
}

interface PoolInfo {
  id: string;
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  fee: string;
  totalSupply: string;
}
```

## Type Guards

```typescript
export function isCrossChainSwap(obj: any): obj is CrossChainSwap {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.sourceChain === 'string' &&
    typeof obj.targetChain === 'string' &&
    typeof obj.amount === 'string' &&
    typeof obj.sender === 'string' &&
    typeof obj.receiver === 'string'
  );
}

export function isHTLC(obj: any): obj is HTLC {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.chain === 'string' &&
    typeof obj.hashlock === 'string' &&
    typeof obj.timelock === 'number'
  );
}

export function isIBCTransfer(obj: any): obj is IBCTransfer {
  return (
    typeof obj === 'object' &&
    typeof obj.sourcePort === 'string' &&
    typeof obj.sourceChannel === 'string' &&
    typeof obj.amount === 'string' &&
    typeof obj.denom === 'string'
  );
}
```

## Validation Functions

```typescript
export function validateSwapAmount(amount: string): boolean {
  const num = parseFloat(amount);
  return !isNaN(num) && num > 0;
}

export function validateChainId(chainId: string): boolean {
  // Chain ID validation logic
  return /^[a-zA-Z0-9-]+$/.test(chainId);
}

export function validateAddress(address: string, chain: string): boolean {
  // Address validation based on chain
  switch (chain) {
    case 'ethereum':
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    case 'osmosis':
    case 'cosmoshub':
      return /^[a-z]{1,10}1[a-zA-Z0-9]{38}$/.test(address);
    default:
      return false;
  }
}
```

## Usage Examples

```typescript
import { CrossChainSwap, SwapStatus, isCrossChainSwap } from '@evmore/types';

// Create a new swap
const swap: CrossChainSwap = {
  id: 'swap_123',
  sourceChain: 'ethereum',
  targetChain: 'osmosis',
  amount: '1000.0',
  sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a',
  receiver: 'osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4',
  sourceToken: 'USDC',
  targetToken: 'OSMO',
  timelock: Date.now() + 3600000, // 1 hour
  status: SwapStatus.PENDING,
  createdAt: new Date(),
  updatedAt: new Date()
};

// Validate swap object
if (isCrossChainSwap(swap)) {
  console.log('Valid swap object');
}
```

## Installation

```bash
npm install @evmore/types
```

## Development

```bash
# Build types
npm run build

# Run tests
npm test

# Generate documentation
npm run docs
```

## Contributing

When adding new types:

1. Define the interface/type in the appropriate module
2. Add type guards for runtime validation
3. Include validation functions if needed
4. Update this documentation
5. Add tests for new types and validations

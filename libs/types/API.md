# @evmore/types API Documentation

The central type system for the EVMore cross-chain swap protocol.

## Installation

```bash
npm install @evmore/types
```

## Overview

This library provides all TypeScript types, interfaces, and enums used throughout the EVMore ecosystem. It serves as the single source of truth for type definitions.

## Core Types

### Swap Types

#### `SwapOrder`
Represents a cross-chain swap order.

```typescript
interface SwapOrder {
  id: string;                    // Unique identifier
  orderId: string;              // HTLC order ID
  status: SwapStatus;           // Current status
  source: SwapEndpoint;         // Source chain details
  destination: SwapEndpoint;    // Destination chain details
  amount: SwapAmount;           // Swap amount details
  timelock: TimelockConfig;     // Timelock configuration
  secret: SecretPair;           // Hash and preimage
  metadata: SwapMetadata;       // Additional metadata
  createdAt: Date;              // Creation timestamp
  updatedAt: Date;              // Last update timestamp
  expiresAt: Date;              // Expiration timestamp
}
```

#### `SwapStatus` (Enum)
```typescript
enum SwapStatus {
  PENDING = "pending",
  LOCKED = "locked",
  COMMITTED = "committed", 
  REVEALED = "revealed",
  COMPLETED = "completed",
  REFUNDED = "refunded",
  FAILED = "failed",
  EXPIRED = "expired"
}
```

#### `SwapEndpoint`
```typescript
interface SwapEndpoint {
  chainId: string;           // Chain identifier
  address: string;           // User address
  tokenAddress?: string;     // Token contract (EVM)
  tokenDenom?: string;       // Token denom (Cosmos)
}
```

#### `CrossChainSwapParams`
Parameters for initiating a cross-chain swap.

```typescript
interface CrossChainSwapParams {
  fromChain: string;              // Source chain ID
  toChain: string;                // Destination chain ID
  fromToken: string;              // Source token
  toToken: string;                // Destination token
  fromAmount: string;             // Amount to swap
  toAddress: string;              // Recipient address
  slippageTolerance?: number;     // Max slippage (0-100)
  deadline?: number;              // Unix timestamp
  metadata?: Record<string, any>; // Additional data
}
```

### Chain Types

#### `Chain`
```typescript
interface Chain {
  chainId: string;              // Unique chain identifier
  name: string;                 // Human-readable name
  type: ChainType;              // 'ethereum' | 'cosmos'
  nativeCurrency: Currency;     // Native token
  rpcUrl?: string;              // RPC endpoint
  restUrl?: string;             // REST endpoint (Cosmos)
  explorerUrl?: string;         // Block explorer
  chainRegistryName?: string;   // Chain registry ID
}
```

#### `ChainType` (Enum)
```typescript
enum ChainType {
  ETHEREUM = "ethereum",
  COSMOS = "cosmos"
}
```

#### `ChainConfig`
```typescript
interface ChainConfig {
  chainId: string;
  name: string;
  rpcUrl: string;
  restUrl?: string;
  htlcContract: string;
  nativeDenom?: string;
  addressPrefix?: string;
  blockTime?: number;
  endpoints: ChainEndpoints;
  features: ChainFeatures;
}
```

### Transaction Types

#### `TransactionInfo`
```typescript
interface TransactionInfo {
  hash: string;                   // Transaction hash
  chainId: string;                // Chain ID
  blockNumber: number;            // Block number
  timestamp: number;              // Block timestamp
  from: string;                   // Sender address
  to: string;                     // Recipient address
  value: string;                  // Transaction value
  gasUsed: string;                // Gas consumed
  gasPrice: string;               // Gas price
  status: TransactionStatus;      // Status
  logs?: TransactionLog[];        // Event logs
}
```

#### `TransactionStatus` (Enum)
```typescript
enum TransactionStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  FAILED = "failed"
}
```

### HTLC Types

#### `HTLCDetails`
```typescript
interface HTLCDetails {
  htlcId: string;              // HTLC identifier
  sender: string;              // Sender address
  receiver: string;            // Receiver address
  token: string;               // Token address/denom
  amount: string;              // Lock amount
  hashlock: string;            // Hash lock (32 bytes)
  timelock: number;            // Expiry timestamp
  withdrawn: boolean;          // Withdrawal status
  refunded: boolean;           // Refund status
  targetChain: string;         // Target chain ID
  targetAddress: string;       // Target recipient
  swapParams?: {               // DEX swap parameters
    routes: SwapRoute[];
    minOutputAmount: string;
    slippageTolerance: number;
  };
  swapExecuted?: boolean;      // Swap execution status
}
```

## Type Guards

The library includes type guard functions for runtime validation:

```typescript
import { isSwapOrder, isValidChainType } from '@evmore/types';

// Check if object is a valid SwapOrder
if (isSwapOrder(data)) {
  // TypeScript knows data is SwapOrder here
  console.log(data.status);
}

// Validate chain type
if (isValidChainType(chainType)) {
  // chainType is 'ethereum' | 'cosmos'
}
```

## Validators

Built-in validation functions:

```typescript
import { validateSwapOrder, validateChainConfig } from '@evmore/types';

// Validate swap order
const validation = validateSwapOrder(order);
if (validation.valid) {
  // Order is valid
} else {
  console.error(validation.errors);
}
```

## Migration Support

For backward compatibility during migration:

```typescript
import { createLegacyAdapter } from '@evmore/types';

// Convert old types to new
const adapter = createLegacyAdapter();
const newOrder = adapter.convertHTLCOrder(legacyOrder);
```

## Constants

Common constants are exported:

```typescript
import { 
  CHAIN_TYPES,
  SWAP_STATUSES,
  TRANSACTION_STATUSES 
} from '@evmore/types';
```

## Best Practices

1. **Always use enums** for status values:
   ```typescript
   order.status = SwapStatus.PENDING; // ✅
   order.status = 'pending';          // ❌
   ```

2. **Use type guards** for runtime validation:
   ```typescript
   if (isSwapOrder(data)) {
     processOrder(data);
   }
   ```

3. **Import only what you need**:
   ```typescript
   import { SwapOrder, SwapStatus } from '@evmore/types';
   ```

## Error Handling

Types include error information:

```typescript
interface SwapError {
  code: string;
  message: string;
  details?: any;
  timestamp: number;
}
```

## Related Documentation

- [Development Guide](../../docs/DEVELOPMENT_GUIDE.md) - Integration examples
- [Protocol Design](../../docs/PROTOCOL_DESIGN.md) - Architecture overview
- [Operations Guide](../../docs/OPERATIONS_GUIDE.md) - Production deployment
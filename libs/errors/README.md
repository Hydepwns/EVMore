# @evmore/errors

Standardized error handling for the EVMore project. This package provides a hierarchical error system with typed error codes and detailed error information.

## Installation

```bash
npm install @evmore/errors
```

## Usage

```typescript
import { 
  ConfigurationError, 
  ValidationError, 
  ChainUnreachableError,
  ErrorCode 
} from '@evmore/errors';

// Throw configuration error
throw new ConfigurationError('Invalid configuration', { 
  configFile: 'config.json' 
});

// Throw validation error
throw new ValidationError(
  'Invalid amount',
  'amount',
  '-100',
  { min: 0 }
);

// Throw chain error with cause
try {
  await connectToChain();
} catch (error) {
  throw new ChainUnreachableError(
    'ethereum-1',
    'https://eth-rpc.example.com',
    error as Error
  );
}

// Check error type and code
try {
  // ... some operation
} catch (error) {
  if (isFusionError(error)) {
    console.log('Error code:', error.code);
    console.log('Error details:', error.details);
    
    if (error.code === ErrorCode.CHAIN_UNREACHABLE) {
      // Handle chain unreachable error
    }
  }
}
```

## Error Codes

Error codes are organized by category:

- **1xxx**: Configuration errors
- **2xxx**: Validation errors  
- **3xxx**: Chain errors
- **4xxx**: HTLC errors
- **5xxx**: IBC errors

## Error Types

### Base Error

All errors extend from `FusionError` which provides:
- `code`: Numeric error code
- `message`: Human-readable error message
- `details`: Additional error context
- `cause`: Original error (if any)
- `timestamp`: When the error occurred
- `toJSON()`: Serialization method

### Configuration Errors

- `ConfigurationError`: General configuration issues
- `ConfigMissingError`: Required configuration missing
- `ConfigTypeMismatchError`: Configuration type mismatch

### Validation Errors

- `ValidationError`: General validation failure
- `InvalidAddressError`: Invalid blockchain address
- `InvalidAmountError`: Invalid amount value

### Chain Errors

- `ChainError`: Base class for chain-related errors
- `ChainUnreachableError`: Cannot connect to chain
- `ChainMismatchError`: Chain ID mismatch
- `InsufficientGasError`: Not enough gas

### HTLC Errors

- `HTLCError`: Base class for HTLC errors
- `HTLCAlreadyExistsError`: HTLC already exists
- `HTLCNotFoundError`: HTLC not found
- `HTLCExpiredError`: HTLC has expired
- `InvalidSecretError`: Invalid HTLC secret

### IBC Errors

- `IBCError`: Base class for IBC errors
- `IBCChannelClosedError`: IBC channel is closed
- `IBCTimeoutError`: IBC packet timeout
- `IBCPacketFailedError`: IBC packet processing failed
# @evmore/errors

Hierarchical error system with structured error handling and recovery mechanisms.

## Overview

The `@evmore/errors` package provides a comprehensive error handling system designed specifically for cross-chain operations, with hierarchical error types, structured error information, and built-in recovery strategies.

## Error Hierarchy

### Base Error Classes

```typescript
abstract class EVMoreError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly chainId?: string;
  public readonly operation: string;

  constructor(
    message: string,
    code: string,
    context: ErrorContext,
    chainId?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
    this.chainId = chainId;
    this.operation = context.operation;
  }

  abstract getRecoveryStrategy(): RecoveryStrategy;
  abstract isRetryable(): boolean;
}
```

### HTLC Errors

```typescript
class HTLCError extends EVMoreError {
  public readonly htlcId?: string;
  public readonly htlcStatus?: HTLCStatus;

  constructor(
    message: string,
    code: HTLCErrorCode,
    context: ErrorContext,
    htlcId?: string,
    chainId?: string
  ) {
    super(message, code, context, chainId);
    this.htlcId = htlcId;
  }

  getRecoveryStrategy(): RecoveryStrategy {
    switch (this.code) {
      case HTLCErrorCode.CREATION_FAILED:
        return { type: 'retry', maxAttempts: 3, delay: 5000 };
      case HTLCErrorCode.INSUFFICIENT_BALANCE:
        return { type: 'alert', fallbackOperation: 'notify_user' };
      case HTLCErrorCode.TIMELOCK_EXPIRED:
        return { type: 'compensate', fallbackOperation: 'refund_htlc' };
      default:
        return { type: 'retry', maxAttempts: 2, delay: 2000 };
    }
  }

  isRetryable(): boolean {
    return ['CREATION_FAILED', 'NETWORK_ERROR'].includes(this.code);
  }
}

enum HTLCErrorCode {
  CREATION_FAILED = 'HTLC_CREATION_FAILED',
  WITHDRAWAL_FAILED = 'HTLC_WITHDRAWAL_FAILED',
  REFUND_FAILED = 'HTLC_REFUND_FAILED',
  INSUFFICIENT_BALANCE = 'HTLC_INSUFFICIENT_BALANCE',
  TIMELOCK_EXPIRED = 'HTLC_TIMELOCK_EXPIRED',
  INVALID_SECRET = 'HTLC_INVALID_SECRET',
  NETWORK_ERROR = 'HTLC_NETWORK_ERROR'
}
```

### IBC Errors

```typescript
class IBCError extends EVMoreError {
  public readonly channelId?: string;
  public readonly packetSequence?: number;
  public readonly timeoutHeight?: number;
  public readonly timeoutTimestamp?: number;

  constructor(
    message: string,
    code: IBCErrorCode,
    context: ErrorContext,
    channelId?: string,
    chainId?: string
  ) {
    super(message, code, context, chainId);
    this.channelId = channelId;
  }

  getRecoveryStrategy(): RecoveryStrategy {
    switch (this.code) {
      case IBCErrorCode.CHANNEL_CLOSED:
        return { type: 'fallback', fallbackOperation: 'find_alternative_route' };
      case IBCErrorCode.PACKET_TIMEOUT:
        return { type: 'compensate', fallbackOperation: 'refund_on_source' };
      case IBCErrorCode.RELAY_FAILED:
        return { type: 'retry', maxAttempts: 5, delay: 10000 };
      default:
        return { type: 'retry', maxAttempts: 3, delay: 5000 };
    }
  }

  isRetryable(): boolean {
    return ['RELAY_FAILED', 'NETWORK_ERROR', 'TEMPORARY_FAILURE'].includes(this.code);
  }
}

enum IBCErrorCode {
  CHANNEL_CLOSED = 'IBC_CHANNEL_CLOSED',
  PACKET_TIMEOUT = 'IBC_PACKET_TIMEOUT',
  RELAY_FAILED = 'IBC_RELAY_FAILED',
  INVALID_PACKET = 'IBC_INVALID_PACKET',
  NETWORK_ERROR = 'IBC_NETWORK_ERROR',
  TEMPORARY_FAILURE = 'IBC_TEMPORARY_FAILURE'
}
```

### DEX Errors

```typescript
class DEXError extends EVMoreError {
  public readonly poolId?: string;
  public readonly tokenIn?: string;
  public readonly tokenOut?: string;
  public readonly slippageTolerance?: number;

  constructor(
    message: string,
    code: DEXErrorCode,
    context: ErrorContext,
    poolId?: string,
    chainId?: string
  ) {
    super(message, code, context, chainId);
    this.poolId = poolId;
  }

  getRecoveryStrategy(): RecoveryStrategy {
    switch (this.code) {
      case DEXErrorCode.INSUFFICIENT_LIQUIDITY:
        return { type: 'fallback', fallbackOperation: 'find_alternative_pool' };
      case DEXErrorCode.SLIPPAGE_EXCEEDED:
        return { type: 'retry', maxAttempts: 2, delay: 1000 };
      case DEXErrorCode.POOL_NOT_FOUND:
        return { type: 'fallback', fallbackOperation: 'use_alternative_dex' };
      default:
        return { type: 'retry', maxAttempts: 3, delay: 2000 };
    }
  }

  isRetryable(): boolean {
    return ['SLIPPAGE_EXCEEDED', 'NETWORK_ERROR', 'TEMPORARY_FAILURE'].includes(this.code);
  }
}

enum DEXErrorCode {
  INSUFFICIENT_LIQUIDITY = 'DEX_INSUFFICIENT_LIQUIDITY',
  SLIPPAGE_EXCEEDED = 'DEX_SLIPPAGE_EXCEEDED',
  POOL_NOT_FOUND = 'DEX_POOL_NOT_FOUND',
  SWAP_FAILED = 'DEX_SWAP_FAILED',
  NETWORK_ERROR = 'DEX_NETWORK_ERROR',
  TEMPORARY_FAILURE = 'DEX_TEMPORARY_FAILURE'
}
```

## Error Context

```typescript
interface ErrorContext {
  operation: string;
  userId?: string;
  swapId?: string;
  metadata?: Record<string, any>;
  stack?: string;
  cause?: Error;
}

interface RecoveryStrategy {
  type: 'retry' | 'fallback' | 'compensate' | 'alert';
  maxAttempts?: number;
  delay?: number;
  fallbackOperation?: string;
  alertLevel?: 'info' | 'warning' | 'error' | 'critical';
}
```

## Error Factory

```typescript
class ErrorFactory {
  static createHTLCError(
    code: HTLCErrorCode,
    message: string,
    context: ErrorContext,
    htlcId?: string,
    chainId?: string
  ): HTLCError {
    return new HTLCError(message, code, context, htlcId, chainId);
  }

  static createIBCError(
    code: IBCErrorCode,
    message: string,
    context: ErrorContext,
    channelId?: string,
    chainId?: string
  ): IBCError {
    return new IBCError(message, code, context, channelId, chainId);
  }

  static createDEXError(
    code: DEXErrorCode,
    message: string,
    context: ErrorContext,
    poolId?: string,
    chainId?: string
  ): DEXError {
    return new DEXError(message, code, context, poolId, chainId);
  }

  static wrapError(
    error: Error,
    context: ErrorContext,
    chainId?: string
  ): EVMoreError {
    if (error instanceof EVMoreError) {
      return error;
    }

    // Determine error type based on context and error message
    if (context.operation.includes('htlc')) {
      return new HTLCError(
        error.message,
        HTLCErrorCode.NETWORK_ERROR,
        context,
        undefined,
        chainId
      );
    } else if (context.operation.includes('ibc')) {
      return new IBCError(
        error.message,
        IBCErrorCode.NETWORK_ERROR,
        context,
        undefined,
        chainId
      );
    } else if (context.operation.includes('dex')) {
      return new DEXError(
        error.message,
        DEXErrorCode.NETWORK_ERROR,
        context,
        undefined,
        chainId
      );
    }

    // Default to generic error
    return new GenericError(error.message, context, chainId);
  }
}
```

## Error Recovery

```typescript
class ErrorRecoveryManager {
  private readonly logger: ILogger;
  private readonly metrics: IMetricsCollector;

  constructor(logger: ILogger, metrics: IMetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
  }

  async handleError(error: EVMoreError): Promise<RecoveryResult> {
    this.logger.error('Handling error', {
      code: error.code,
      operation: error.operation,
      chainId: error.chainId,
      context: error.context
    });

    this.metrics.increment('errors_total', 1, {
      operation: error.operation,
      error_type: error.code,
      chain: error.chainId || 'unknown'
    });

    const strategy = error.getRecoveryStrategy();
    
    switch (strategy.type) {
      case 'retry':
        return this.handleRetry(error, strategy);
      case 'fallback':
        return this.handleFallback(error, strategy);
      case 'compensate':
        return this.handleCompensation(error, strategy);
      case 'alert':
        return this.handleAlert(error, strategy);
      default:
        return { success: false, action: 'none' };
    }
  }

  private async handleRetry(
    error: EVMoreError,
    strategy: RecoveryStrategy
  ): Promise<RecoveryResult> {
    if (!error.isRetryable()) {
      return { success: false, action: 'retry_not_allowed' };
    }

    const maxAttempts = strategy.maxAttempts || 3;
    const delay = strategy.delay || 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Retry the original operation
        // This would be implemented based on the specific operation
        
        this.logger.info('Retry successful', { attempt, operation: error.operation });
        return { success: true, action: 'retry_success', attempts: attempt };
      } catch (retryError) {
        this.logger.warn('Retry failed', { attempt, maxAttempts, error: retryError });
        
        if (attempt === maxAttempts) {
          return { success: false, action: 'retry_exhausted', attempts: attempt };
        }
      }
    }

    return { success: false, action: 'retry_failed' };
  }

  private async handleFallback(
    error: EVMoreError,
    strategy: RecoveryStrategy
  ): Promise<RecoveryResult> {
    if (!strategy.fallbackOperation) {
      return { success: false, action: 'no_fallback' };
    }

    try {
      // Execute fallback operation
      // This would be implemented based on the specific fallback
      
      this.logger.info('Fallback successful', { 
        fallback: strategy.fallbackOperation,
        originalError: error.code 
      });
      
      return { success: true, action: 'fallback_success', fallback: strategy.fallbackOperation };
    } catch (fallbackError) {
      this.logger.error('Fallback failed', { 
        fallback: strategy.fallbackOperation,
        error: fallbackError 
      });
      
      return { success: false, action: 'fallback_failed', fallback: strategy.fallbackOperation };
    }
  }

  private async handleCompensation(
    error: EVMoreError,
    strategy: RecoveryStrategy
  ): Promise<RecoveryResult> {
    if (!strategy.fallbackOperation) {
      return { success: false, action: 'no_compensation' };
    }

    try {
      // Execute compensation operation (e.g., refund)
      // This would be implemented based on the specific compensation
      
      this.logger.info('Compensation successful', { 
        compensation: strategy.fallbackOperation,
        originalError: error.code 
      });
      
      return { success: true, action: 'compensation_success', compensation: strategy.fallbackOperation };
    } catch (compensationError) {
      this.logger.error('Compensation failed', { 
        compensation: strategy.fallbackOperation,
        error: compensationError 
      });
      
      return { success: false, action: 'compensation_failed', compensation: strategy.fallbackOperation };
    }
  }

  private async handleAlert(
    error: EVMoreError,
    strategy: RecoveryStrategy
  ): Promise<RecoveryResult> {
    const alertLevel = strategy.alertLevel || 'error';
    
    this.logger.error('Alert triggered', {
      level: alertLevel,
      error: error.code,
      operation: error.operation,
      context: error.context
    });

    // Send alert to monitoring system
    // This would integrate with your alerting system
    
    return { success: true, action: 'alert_sent', alertLevel };
  }
}

interface RecoveryResult {
  success: boolean;
  action: string;
  attempts?: number;
  fallback?: string;
  compensation?: string;
  alertLevel?: string;
}
```

## Usage Examples

```typescript
import { 
  ErrorFactory, 
  HTLCErrorCode, 
  IBCErrorCode,
  ErrorRecoveryManager 
} from '@evmore/errors';

// Creating specific errors
const htlcError = ErrorFactory.createHTLCError(
  HTLCErrorCode.CREATION_FAILED,
  'Failed to create HTLC on Ethereum',
  { operation: 'htlc_create', userId: 'user123', swapId: 'swap_456' },
  'htlc_789',
  'ethereum'
);

const ibcError = ErrorFactory.createIBCError(
  IBCErrorCode.PACKET_TIMEOUT,
  'IBC packet timed out',
  { operation: 'ibc_transfer', swapId: 'swap_456' },
  'channel-0',
  'cosmoshub'
);

// Error recovery
const recoveryManager = new ErrorRecoveryManager(logger, metrics);

try {
  // Some operation that might fail
  await createHTLC(params);
} catch (error) {
  const evmoreError = ErrorFactory.wrapError(error, {
    operation: 'htlc_create',
    userId: 'user123'
  }, 'ethereum');

  const result = await recoveryManager.handleError(evmoreError);
  
  if (!result.success) {
    // Handle unrecoverable error
    throw evmoreError;
  }
}
```

## Installation

```bash
npm install @evmore/errors
```

## Development

```bash
# Build errors
npm run build

# Run tests
npm test

# Generate documentation
npm run docs
```

## Contributing

When adding new error types:

1. Extend the appropriate base error class
2. Define error codes in the corresponding enum
3. Implement recovery strategies
4. Add tests for error handling
5. Update this documentation 
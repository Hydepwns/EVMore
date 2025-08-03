# @evmore/utils

Common utilities and dependency injection container.

## Overview

The `@evmore/utils` package provides essential utilities for the EVMore protocol, including dependency injection, logging, crypto operations, and common helper functions.

## Core Utilities

### Dependency Injection Container

```typescript
class DIContainer {
  private services = new Map<string, any>();
  private factories = new Map<string, () => any>();
  private singletons = new Map<string, any>();

  register<T>(token: string, implementation: T): void {
    this.services.set(token, implementation);
  }

  registerFactory<T>(token: string, factory: () => T): void {
    this.factories.set(token, factory);
  }

  registerSingleton<T>(token: string, factory: () => T): void {
    this.factories.set(token, factory);
    this.singletons.set(token, null);
  }

  resolve<T>(token: string): T {
    // Check for existing service
    if (this.services.has(token)) {
      return this.services.get(token);
    }

    // Check for singleton
    if (this.singletons.has(token)) {
      if (this.singletons.get(token) === null) {
        const factory = this.factories.get(token);
        const instance = factory();
        this.singletons.set(token, instance);
      }
      return this.singletons.get(token);
    }

    // Check for factory
    if (this.factories.has(token)) {
      const factory = this.factories.get(token);
      return factory();
    }

    throw new Error(`Service ${token} not found`);
  }

  has(token: string): boolean {
    return this.services.has(token) || this.factories.has(token);
  }

  dispose(): void {
    this.services.clear();
    this.factories.clear();
    this.singletons.clear();
  }
}
```

### Logger

```typescript
interface LogLevel {
  DEBUG: 0;
  INFO: 1;
  WARN: 2;
  ERROR: 3;
}

class Logger {
  private level: number;
  private context: string;

  constructor(context: string, level: number = LogLevel.INFO) {
    this.context = context;
    this.level = level;
  }

  debug(message: string, meta?: any): void {
    if (this.level <= LogLevel.DEBUG) {
      this.log('DEBUG', message, meta);
    }
  }

  info(message: string, meta?: any): void {
    if (this.level <= LogLevel.INFO) {
      this.log('INFO', message, meta);
    }
  }

  warn(message: string, meta?: any): void {
    if (this.level <= LogLevel.WARN) {
      this.log('WARN', message, meta);
    }
  }

  error(message: string, meta?: any): void {
    if (this.level <= LogLevel.ERROR) {
      this.log('ERROR', message, meta);
    }
  }

  private log(level: string, message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      context: this.context,
      message,
      ...meta
    };

    if (level === 'ERROR') {
      console.error(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  }
}
```

### Crypto Utilities

```typescript
import { createHash, randomBytes } from 'crypto';

class CryptoUtils {
  static generateSecret(): string {
    return randomBytes(32).toString('hex');
  }

  static generateHashlock(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  static verifyHashlock(secret: string, hashlock: string): boolean {
    const computedHashlock = this.generateHashlock(secret);
    return computedHashlock === hashlock;
  }

  static generateHTLCId(): string {
    return randomBytes(16).toString('hex');
  }

  static generateSwapId(): string {
    return `swap_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  static validateAddress(address: string, chain: string): boolean {
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

  static normalizeAddress(address: string, chain: string): string {
    switch (chain) {
      case 'ethereum':
        return address.toLowerCase();
      case 'osmosis':
      case 'cosmoshub':
        return address.toLowerCase();
      default:
        return address;
    }
  }
}
```

### Validation Utilities

```typescript
class ValidationUtils {
  static validateAmount(amount: string): boolean {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0 && isFinite(num);
  }

  static validateChainId(chainId: string): boolean {
    return /^[a-zA-Z0-9-]+$/.test(chainId);
  }

  static validateTokenSymbol(symbol: string): boolean {
    return /^[A-Z]{2,10}$/.test(symbol);
  }

  static validateTimelock(timelock: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    return timelock > now && timelock < now + 86400 * 7; // Max 7 days
  }

  static validateSlippage(slippage: number): boolean {
    return slippage >= 0 && slippage <= 100;
  }

  static sanitizeInput(input: string): string {
    return input
      .trim()
      .replace(/[<>]/g, '') // Remove potential HTML
      .replace(/[;&|]/g, '') // Remove command separators
      .substring(0, 1000); // Limit length
  }
}
```

### Time Utilities

```typescript
class TimeUtils {
  static getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  static addSeconds(timestamp: number, seconds: number): number {
    return timestamp + seconds;
  }

  static addMinutes(timestamp: number, minutes: number): number {
    return timestamp + (minutes * 60);
  }

  static addHours(timestamp: number, hours: number): number {
    return timestamp + (hours * 3600);
  }

  static isExpired(timestamp: number): boolean {
    return this.getCurrentTimestamp() > timestamp;
  }

  static timeUntil(timestamp: number): number {
    return Math.max(0, timestamp - this.getCurrentTimestamp());
  }

  static formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
}
```

### Network Utilities

```typescript
class NetworkUtils {
  static async checkEndpoint(endpoint: string, timeout: number = 5000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(endpoint, {
        method: 'HEAD',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  static async getGasPrice(chainId: string): Promise<string> {
    // Implementation would vary by chain
    switch (chainId) {
      case 'ethereum':
        return await this.getEthereumGasPrice();
      case 'polygon':
        return await this.getPolygonGasPrice();
      default:
        throw new Error(`Unsupported chain: ${chainId}`);
    }
  }

  private static async getEthereumGasPrice(): Promise<string> {
    // Implementation for Ethereum gas price
    return '20000000000'; // 20 gwei
  }

  private static async getPolygonGasPrice(): Promise<string> {
    // Implementation for Polygon gas price
    return '30000000000'; // 30 gwei
  }

  static estimateGasLimit(operation: string): number {
    const gasLimits = {
      'htlc_create': 150000,
      'htlc_withdraw': 100000,
      'htlc_refund': 80000,
      'ibc_transfer': 200000,
      'dex_swap': 300000
    };

    return gasLimits[operation] || 100000;
  }
}
```

### Retry Utilities

```typescript
interface RetryOptions {
  maxAttempts: number;
  delay: number;
  backoffMultiplier: number;
  maxDelay: number;
}

class RetryUtils {
  static async withRetry<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const {
      maxAttempts = 3,
      delay = 1000,
      backoffMultiplier = 2,
      maxDelay = 30000
    } = options;

    let lastError: Error;
    let currentDelay = delay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxAttempts) {
          throw lastError;
        }

        await this.sleep(currentDelay);
        currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelay);
      }
    }

    throw lastError!;
  }

  static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'NETWORK_ERROR',
      'TIMEOUT'
    ];

    return retryableErrors.some(retryableError => 
      error.message.includes(retryableError) || 
      error.name.includes(retryableError)
    );
  }
}
```

### Event Bus

```typescript
type EventHandler<T = any> = (data: T) => void | Promise<void>;

class EventBus {
  private handlers = new Map<string, EventHandler[]>();

  on<T>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }

    this.handlers.get(event)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  async emit<T>(event: string, data: T): Promise<void> {
    const handlers = this.handlers.get(event);
    if (handlers) {
      await Promise.all(handlers.map(handler => handler(data)));
    }
  }

  once<T>(event: string, handler: EventHandler<T>): () => void {
    const onceHandler: EventHandler<T> = async (data) => {
      await handler(data);
      this.off(event, onceHandler);
    };

    return this.on(event, onceHandler);
  }
}
```

## Usage Examples

```typescript
import { 
  DIContainer, 
  Logger, 
  CryptoUtils, 
  ValidationUtils,
  TimeUtils,
  NetworkUtils,
  RetryUtils,
  EventBus 
} from '@evmore/utils';

// Dependency Injection
const container = new DIContainer();
container.register('logger', new Logger('HTLCService'));
container.register('eventBus', new EventBus());

const logger = container.resolve<Logger>('logger');
const eventBus = container.resolve<EventBus>('eventBus');

// Crypto operations
const secret = CryptoUtils.generateSecret();
const hashlock = CryptoUtils.generateHashlock(secret);
const htlcId = CryptoUtils.generateHTLCId();

// Validation
const isValidAmount = ValidationUtils.validateAmount('100.5');
const isValidAddress = CryptoUtils.validateAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f8b23a', 'ethereum');

// Time operations
const now = TimeUtils.getCurrentTimestamp();
const future = TimeUtils.addHours(now, 2);
const isExpired = TimeUtils.isExpired(future);

// Network operations
const isEndpointUp = await NetworkUtils.checkEndpoint('https://api.example.com');
const gasPrice = await NetworkUtils.getGasPrice('ethereum');

// Retry operations
const result = await RetryUtils.withRetry(
  async () => {
    // Some operation that might fail
    return await someUnreliableOperation();
  },
  { maxAttempts: 3, delay: 1000 }
);

// Event handling
const unsubscribe = eventBus.on('htlc_created', async (htlc) => {
  logger.info('HTLC created', { htlcId: htlc.id });
});

await eventBus.emit('htlc_created', { id: htlcId, amount: '100' });
```

## Installation

```bash
npm install @evmore/utils
```

## Development

```bash
# Build utils
npm run build

# Run tests
npm test

# Generate documentation
npm run docs
```

## Contributing

When adding new utilities:

1. Create the utility function/class
2. Add TypeScript types
3. Include JSDoc documentation
4. Add unit tests
5. Update this documentation 
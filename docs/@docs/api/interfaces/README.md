# @evmore/interfaces

Service contracts and dependency injection interfaces for modular architecture.

## Overview

The `@evmore/interfaces` package defines the core service contracts and dependency injection interfaces that enable the modular, extensible architecture of the EVMore protocol.

## Core Interfaces

### Service Contracts

```typescript
interface IHTLCService {
  createHTLC(params: HTLCCreateParams): Promise<HTLC>;
  withdrawHTLC(htlcId: string, secret: string): Promise<TransactionResult>;
  refundHTLC(htlcId: string): Promise<TransactionResult>;
  getHTLC(htlcId: string): Promise<HTLC | null>;
  monitorHTLC(htlcId: string): Observable<HTLCStatus>;
}

interface IIBCService {
  transferTokens(params: IBCTransferParams): Promise<IBCTransfer>;
  relayPacket(packet: IBCPacket): Promise<RelayResult>;
  queryChannel(channelId: string): Promise<ChannelInfo>;
  monitorChannel(channelId: string): Observable<ChannelEvent>;
}

interface IDEXService {
  getPoolInfo(poolId: string): Promise<PoolInfo>;
  estimateSwap(params: SwapEstimateParams): Promise<SwapEstimate>;
  executeSwap(params: SwapExecuteParams): Promise<SwapResult>;
  getRoute(tokenIn: string, tokenOut: string): Promise<SwapRoute[]>;
}
```

### Dependency Injection

```typescript
interface IServiceContainer {
  register<T>(token: InjectionToken<T>, implementation: T): void;
  resolve<T>(token: InjectionToken<T>): T;
  has<T>(token: InjectionToken<T>): boolean;
  dispose(): Promise<void>;
}

interface ILogger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

interface IConfigService {
  get<T>(key: string, defaultValue?: T): T;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
  validate(): ValidationResult;
}
```

### Event System

```typescript
interface IEventBus {
  emit<T>(event: string, data: T): void;
  on<T>(event: string, handler: EventHandler<T>): Subscription;
  off(event: string, handler: EventHandler<any>): void;
  once<T>(event: string, handler: EventHandler<T>): Subscription;
}

interface IEventHandler<T> {
  (data: T): void | Promise<void>;
}

interface ISubscription {
  unsubscribe(): void;
}
```

## Plugin System

```typescript
interface IPlugin {
  name: string;
  version: string;
  initialize(container: IServiceContainer): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getCapabilities(): PluginCapability[];
}

interface IPluginManager {
  register(plugin: IPlugin): void;
  unregister(pluginName: string): void;
  getPlugin(name: string): IPlugin | null;
  getAllPlugins(): IPlugin[];
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}

interface PluginCapability {
  name: string;
  description: string;
  version: string;
}
```

## Extension Points

```typescript
interface IExtensionPoint<T> {
  register(extension: T): void;
  unregister(extension: T): void;
  getAll(): T[];
  find(predicate: (extension: T) => boolean): T | null;
}

interface IChainAdapter {
  chainId: string;
  createHTLC(params: HTLCCreateParams): Promise<HTLC>;
  withdrawHTLC(htlcId: string, secret: string): Promise<TransactionResult>;
  refundHTLC(htlcId: string): Promise<TransactionResult>;
  getBalance(address: string): Promise<string>;
  estimateGas(transaction: Transaction): Promise<number>;
}

interface IDEXAdapter {
  name: string;
  chainId: string;
  getPoolInfo(poolId: string): Promise<PoolInfo>;
  estimateSwap(params: SwapEstimateParams): Promise<SwapEstimate>;
  executeSwap(params: SwapExecuteParams): Promise<SwapResult>;
}
```

## Error Handling

```typescript
interface IErrorHandler {
  handle(error: Error, context?: ErrorContext): Promise<void>;
  canHandle(error: Error): boolean;
  getRecoveryStrategy(error: Error): RecoveryStrategy;
}

interface ErrorContext {
  operation: string;
  chainId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

interface RecoveryStrategy {
  type: 'retry' | 'fallback' | 'compensate' | 'alert';
  maxAttempts?: number;
  delay?: number;
  fallbackOperation?: string;
}
```

## Monitoring & Metrics

```typescript
interface IMetricsCollector {
  increment(metric: string, value?: number, labels?: Record<string, string>): void;
  gauge(metric: string, value: number, labels?: Record<string, string>): void;
  histogram(metric: string, value: number, labels?: Record<string, string>): void;
  timing(metric: string, duration: number, labels?: Record<string, string>): void;
}

interface IHealthChecker {
  check(): Promise<HealthStatus>;
  registerCheck(name: string, check: HealthCheck): void;
  unregisterCheck(name: string): void;
}

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: Record<string, HealthCheckResult>;
  timestamp: Date;
}
```

## Usage Examples

```typescript
import { 
  IHTLCService, 
  IBCService, 
  IDEXService,
  IServiceContainer 
} from '@evmore/interfaces';

// Service registration
class ServiceContainer implements IServiceContainer {
  private services = new Map();

  register<T>(token: string, implementation: T): void {
    this.services.set(token, implementation);
  }

  resolve<T>(token: string): T {
    const service = this.services.get(token);
    if (!service) {
      throw new Error(`Service ${token} not found`);
    }
    return service;
  }

  has<T>(token: string): boolean {
    return this.services.has(token);
  }

  async dispose(): Promise<void> {
    this.services.clear();
  }
}

// Using services
const container = new ServiceContainer();
container.register<IHTLCService>('htlc', new EthereumHTLCService());
container.register<IIBCService>('ibc', new IBCService());
container.register<IDEXService>('dex', new OsmosisDEXService());

const htlcService = container.resolve<IHTLCService>('htlc');
const ibcService = container.resolve<IIBCService>('ibc');
const dexService = container.resolve<IDEXService>('dex');
```

## Installation

```bash
npm install @evmore/interfaces
```

## Development

```bash
# Build interfaces
npm run build

# Run tests
npm test

# Generate documentation
npm run docs
```

## Contributing

When adding new interfaces:

1. Define the interface in the appropriate module
2. Add JSDoc comments for documentation
3. Include usage examples
4. Add tests for interface implementations
5. Update this documentation

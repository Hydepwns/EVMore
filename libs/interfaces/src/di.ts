export interface ServiceContainer {
  register<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): void;
  registerSingleton<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): void;
  registerInstance<T>(token: ServiceToken<T>, instance: T): void;
  
  get<T>(token: ServiceToken<T>): T;
  getOptional<T>(token: ServiceToken<T>): T | null;
  
  has(token: ServiceToken<any>): boolean;
  
  createScope(): ServiceContainer;
  dispose(): Promise<void>;
}

export interface ServiceToken<T = any> {
  readonly name: string;
  readonly description?: string;
  readonly _type?: T; // Phantom type for type safety
}

export interface ServiceFactory<T> {
  (container: ServiceContainer): T | Promise<T>;
}

export interface ServiceRegistration<T = any> {
  factory: ServiceFactory<T>;
  singleton: boolean;
  instance?: T;
}

export interface Disposable {
  dispose(): Promise<void> | void;
}

// Helper function to create service tokens
export function createServiceToken<T>(name: string, description?: string): ServiceToken<T> {
  return { name, description };
}

// Built-in service tokens
export const CORE_TOKENS = {
  Logger: createServiceToken<any>('Logger', 'Application logger'),
  Config: createServiceToken<any>('Config', 'Application configuration'),
  
  // Monitors
  EthereumMonitor: createServiceToken<any>('EthereumMonitor', 'Ethereum blockchain monitor'),
  CosmosMonitor: createServiceToken<any>('CosmosMonitor', 'Cosmos blockchain monitor'),
  
  // Services
  RelayService: createServiceToken<any>('RelayService', 'Cross-chain relay service'),
  ChainRegistry: createServiceToken<any>('ChainRegistry', 'Chain registry service'),
  
  // Utilities
  SecretManager: createServiceToken<any>('SecretManager', 'Secret management service'),
  MetricsCollector: createServiceToken<any>('MetricsCollector', 'Metrics collection service'),
} as const;
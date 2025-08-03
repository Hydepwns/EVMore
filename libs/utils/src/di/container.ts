import { 
  ServiceContainer, 
  ServiceToken, 
  ServiceFactory, 
  ServiceRegistration,
  Disposable 
} from '@evmore/interfaces';

export class DIContainer implements ServiceContainer {
  private services = new Map<string, ServiceRegistration>();
  private instances = new Map<string, any>();
  private parent?: DIContainer;
  private disposed = false;
  
  constructor(parent?: DIContainer) {
    this.parent = parent;
  }
  
  register<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): void {
    this.ensureNotDisposed();
    this.services.set(token.name, {
      factory,
      singleton: false
    });
  }
  
  registerSingleton<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): void {
    this.ensureNotDisposed();
    this.services.set(token.name, {
      factory,
      singleton: true
    });
  }
  
  registerInstance<T>(token: ServiceToken<T>, instance: T): void {
    this.ensureNotDisposed();
    this.services.set(token.name, {
      factory: () => instance,
      singleton: true,
      instance
    });
    this.instances.set(token.name, instance);
  }
  
  get<T>(token: ServiceToken<T>): T {
    const service = this.getOptional(token);
    if (!service) {
      throw new Error(`Service not found: ${token.name}. Did you forget to register it?`);
    }
    return service;
  }
  
  getOptional<T>(token: ServiceToken<T>): T | null {
    this.ensureNotDisposed();
    
    // Check instances cache first
    if (this.instances.has(token.name)) {
      return this.instances.get(token.name);
    }
    
    // Check service registration in this container
    let registration = this.services.get(token.name);
    
    // Check parent container if not found
    if (!registration && this.parent) {
      return this.parent.getOptional(token);
    }
    
    if (!registration) {
      return null;
    }
    
    // Create instance
    try {
      const instance = registration.factory(this);
      
      // Cache if singleton
      if (registration.singleton) {
        this.instances.set(token.name, instance);
        registration.instance = instance;
      }
      
      return instance;
    } catch (error) {
      throw new Error(
        `Failed to create service '${token.name}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  
  has(token: ServiceToken<any>): boolean {
    this.ensureNotDisposed();
    return this.services.has(token.name) || (this.parent?.has(token) ?? false);
  }
  
  createScope(): ServiceContainer {
    this.ensureNotDisposed();
    return new DIContainer(this);
  }
  
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    
    this.disposed = true;
    
    // Dispose all created instances that implement Disposable
    const disposePromises: Promise<void>[] = [];
    
    for (const instance of this.instances.values()) {
      if (this.isDisposable(instance)) {
        try {
          const result = instance.dispose();
          if (result && typeof result.then === 'function') {
            disposePromises.push(result);
          }
        } catch (error) {
          console.error('Error disposing service:', error);
        }
      }
    }
    
    await Promise.all(disposePromises);
    
    // Clear all maps
    this.services.clear();
    this.instances.clear();
  }
  
  // Debugging and introspection methods
  getRegisteredServices(): string[] {
    const services = Array.from(this.services.keys());
    if (this.parent) {
      services.push(...this.parent.getRegisteredServices());
    }
    return [...new Set(services)]; // Remove duplicates
  }
  
  getServiceInfo(tokenName: string): ServiceRegistration | null {
    return this.services.get(tokenName) || this.parent?.getServiceInfo(tokenName) || null;
  }
  
  printDependencyTree(): void {
    console.log('\n=== Dependency Container ===');
    this.printServices(0);
    console.log('============================\n');
  }
  
  private printServices(depth: number): void {
    const indent = '  '.repeat(depth);
    
    for (const [name, registration] of this.services.entries()) {
      const type = registration.singleton ? 'Singleton' : 'Transient';
      const status = this.instances.has(name) ? 'Created' : 'Not Created';
      console.log(`${indent}${name} (${type}) - ${status}`);
    }
    
    if (this.parent) {
      console.log(`${indent}Parent Container:`);
      this.parent.printServices(depth + 1);
    }
  }
  
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Container has been disposed');
    }
  }
  
  private isDisposable(obj: any): obj is Disposable {
    return obj && typeof obj.dispose === 'function';
  }
}

// Factory functions for common patterns
export function singleton<T>(factory: ServiceFactory<T>): ServiceFactory<T> {
  return factory;
}

export function transient<T>(factory: ServiceFactory<T>): ServiceFactory<T> {
  return factory;
}

export function value<T>(instance: T): ServiceFactory<T> {
  return () => instance;
}

// Utility to create typed service tokens
export function createToken<T>(name: string, description?: string): ServiceToken<T> {
  return { name, description };
}

// Service resolution helpers
export function inject<T>(_token: ServiceToken<T>) {
  return function (_target: any, _propertyKey: string | symbol | undefined, _parameterIndex: number) {
    // This would be used with a decorator-based DI system
    // For now, it's a placeholder for future enhancement
    // TODO: Implement metadata storage without Reflect
  };
}

// Container builder for easier setup
export class ContainerBuilder {
  private registrations: Array<(container: ServiceContainer) => void> = [];
  
  register<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): this {
    this.registrations.push(container => container.register(token, factory));
    return this;
  }
  
  registerSingleton<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): this {
    this.registrations.push(container => container.registerSingleton(token, factory));
    return this;
  }
  
  registerInstance<T>(token: ServiceToken<T>, instance: T): this {
    this.registrations.push(container => container.registerInstance(token, instance));
    return this;
  }
  
  build(parent?: ServiceContainer): ServiceContainer {
    const container = new DIContainer(parent as DIContainer);
    
    for (const register of this.registrations) {
      register(container);
    }
    
    return container;
  }
  
  // Configuration from object
  static fromConfig(config: DIConfig): ContainerBuilder {
    const builder = new ContainerBuilder();
    
    for (const [tokenName, serviceConfig] of Object.entries(config.services)) {
      const token = createToken(tokenName);
      
      if (serviceConfig.type === 'singleton' && serviceConfig.factory) {
        builder.registerSingleton(token, serviceConfig.factory);
      } else if (serviceConfig.type === 'instance' && serviceConfig.instance) {
        builder.registerInstance(token, serviceConfig.instance);
      } else if (serviceConfig.factory) {
        builder.register(token, serviceConfig.factory);
      }
    }
    
    return builder;
  }
}

export interface DIConfig {
  services: Record<string, {
    type: 'transient' | 'singleton' | 'instance';
    factory?: ServiceFactory<any>;
    instance?: any;
  }>;
}

// Global container for convenience (optional)
let globalContainer: ServiceContainer | null = null;

export function setGlobalContainer(container: ServiceContainer): void {
  globalContainer = container;
}

export function getGlobalContainer(): ServiceContainer {
  if (!globalContainer) {
    throw new Error('Global container not set. Call setGlobalContainer() first.');
  }
  return globalContainer;
}

export function clearGlobalContainer(): void {
  globalContainer = null;
}
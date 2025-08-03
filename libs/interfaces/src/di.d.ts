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
    readonly _type?: T;
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
export declare function createServiceToken<T>(name: string, description?: string): ServiceToken<T>;
export declare const CORE_TOKENS: {
    readonly Logger: ServiceToken<any>;
    readonly Config: ServiceToken<any>;
    readonly EthereumMonitor: ServiceToken<any>;
    readonly CosmosMonitor: ServiceToken<any>;
    readonly RelayService: ServiceToken<any>;
    readonly ChainRegistry: ServiceToken<any>;
    readonly SecretManager: ServiceToken<any>;
    readonly MetricsCollector: ServiceToken<any>;
};
//# sourceMappingURL=di.d.ts.map
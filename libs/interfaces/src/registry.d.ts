export interface Chain {
    id: string;
    name: string;
    type: 'ethereum' | 'cosmos';
    nativeCurrency: {
        symbol: string;
        decimals: number;
        denom?: string;
    };
    explorerUrl?: string;
}
export interface IBCRoute {
    source: string;
    destination: string;
    hops: IBCHop[];
    estimatedTime: number;
    estimatedFees: Fee[];
}
export interface IBCHop {
    from: IBCEndpoint;
    to: IBCEndpoint;
    channel: IBCChannel;
    timeoutHeight?: Height;
    timeoutTimestamp?: number;
}
export interface IBCEndpoint {
    chainId: string;
    portId: string;
    channelId: string;
}
export interface IBCChannel {
    state: 'UNINITIALIZED' | 'INIT' | 'TRYOPEN' | 'OPEN' | 'CLOSED';
    ordering: 'ORDERED' | 'UNORDERED';
    counterparty: IBCEndpoint;
    connectionHops: string[];
    version: string;
}
export interface Height {
    revisionNumber: number;
    revisionHeight: number;
}
export interface Fee {
    amount: string;
    denom: string;
}
export interface ChainFilter {
    type?: 'ethereum' | 'cosmos';
    status?: 'active' | 'inactive';
    hasIBC?: boolean;
}
export interface UpdateHandler {
    (type: 'chain_added' | 'chain_updated' | 'route_changed', data: any): void | Promise<void>;
}
export interface ChainRegistry {
    getChain(chainId: string): Promise<Chain | null>;
    getChains(filter?: ChainFilter): Promise<Chain[]>;
    getRoute(source: string, destination: string): Promise<IBCRoute | null>;
    getRoutes(source: string, destination: string, limit?: number): Promise<IBCRoute[]>;
    registerChain(chain: Chain): Promise<void>;
    updateChain(chainId: string, updates: Partial<Chain>): Promise<void>;
    onUpdate(handler: UpdateHandler): () => void;
    clearCache(): Promise<void>;
    refreshCache(): Promise<void>;
}
//# sourceMappingURL=registry.d.ts.map
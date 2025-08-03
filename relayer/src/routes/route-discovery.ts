import axios from 'axios';
import { Logger } from 'pino';
import { ChainRegistryConfig } from '../config/index';
import { RouterResolutionService } from '../registry/router-resolution-service';
import { ChainRegistryClient } from '../registry/chain-registry-client';

export interface IBCChannel {
  chainId: string;
  channelId: string;
  portId: string;
  counterparty: {
    chainId: string;
    channelId: string;
    portId: string;
  };
  state: string;
}

export interface Route {
  source: string;
  destination: string;
  path: string[];
  channels: IBCChannel[];
  estimatedTime: number;
  estimatedFee: number;
}

export interface RouteWithAddresses extends Route {
  routerAddresses: string[];
}

export class RouteDiscovery {
  private config: ChainRegistryConfig;
  private logger: Logger;
  private routeCache: Map<string, Route[]> = new Map();
  private channelCache: Map<string, IBCChannel[]> = new Map();
  private routerResolver?: RouterResolutionService;
  private registryClient?: ChainRegistryClient;
  private lastCacheUpdate: number = 0;

  constructor(config: ChainRegistryConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'RouteDiscovery' });
  }

  /**
   * Initialize with registry services
   */
  async initialize(routerResolver: RouterResolutionService, registryClient: ChainRegistryClient): Promise<void> {
    this.routerResolver = routerResolver;
    this.registryClient = registryClient;
    
    // Pre-populate cache with known chains
    await this.updateChannelCache();
  }

  async findRoutes(sourceChain: string, targetChain: string): Promise<Route[]> {
    const cacheKey = `${sourceChain}->${targetChain}`;

    // Check cache
    if (this.routeCache.has(cacheKey) && this.isCacheValid()) {
      return this.routeCache.get(cacheKey) || [];
    }

    this.logger.info({ sourceChain, targetChain }, 'Finding routes');

    try {
      // Update channel information if needed
      await this.updateChannelCache();

      // Find all possible routes
      const routes = await this.calculateRoutes(sourceChain, targetChain);

      // Cache the results
      this.routeCache.set(cacheKey, routes);

      return routes;
    } catch (error) {
      this.logger.error({ error, sourceChain, targetChain }, 'Failed to find routes');
      return [];
    }
  }

  private async updateChannelCache(): Promise<void> {
    if (this.isCacheValid()) {
      return;
    }

    this.logger.info('Updating channel cache from Chain Registry');

    try {
      // Fetch IBC channels from Chain Registry
      const response = await axios.get(`${this.config.baseUrl}/v1/ibc`);
      const channels = response.data as IBCChannel[];

      // Group channels by chain
      this.channelCache.clear();
      for (const channel of channels) {
        if (channel.state !== 'OPEN') continue;

        // Add to source chain's channels
        const sourceChannels = this.channelCache.get(channel.chainId) || [];
        sourceChannels.push(channel);
        this.channelCache.set(channel.chainId, sourceChannels);
      }

      this.lastCacheUpdate = Date.now();
      this.logger.info({ channelCount: channels.length }, 'Channel cache updated');
    } catch (error) {
      this.logger.error({ error }, 'Failed to update channel cache');
    }
  }

  private async calculateRoutes(source: string, target: string): Promise<Route[]> {
    const routes: Route[] = [];
    const visited = new Set<string>();
    const queue: Array<{ chain: string; path: string[]; channels: IBCChannel[] }> = [];

    // Start from source chain
    queue.push({ chain: source, path: [source], channels: [] });
    visited.add(source);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Check if we reached the target
      if (current.chain === target) {
        routes.push({
          source,
          destination: target,
          path: current.path,
          channels: current.channels,
          estimatedTime: current.path.length * 30, // 30 seconds per hop (estimate)
          estimatedFee: current.path.length * 0.01, // 0.01 USD per hop (estimate)
        });
        continue;
      }

      // Limit path length to avoid too many hops
      if (current.path.length >= 4) {
        continue;
      }

      // Get connected chains
      const channels = this.channelCache.get(current.chain) || [];
      for (const channel of channels) {
        const nextChain = channel.counterparty.chainId;

        if (!visited.has(nextChain)) {
          visited.add(nextChain);
          queue.push({
            chain: nextChain,
            path: [...current.path, nextChain],
            channels: [...current.channels, channel],
          });
        }
      }
    }

    // Sort routes by hop count and estimated time
    routes.sort((a, b) => {
      if (a.path.length !== b.path.length) {
        return a.path.length - b.path.length;
      }
      return a.estimatedTime - b.estimatedTime;
    });

    return routes;
  }

  private isCacheValid(): boolean {
    return Date.now() - this.lastCacheUpdate < this.config.cacheTimeout * 1000;
  }

  getCachedRoutesCount(): number {
    return this.routeCache.size;
  }

  clearCache(): void {
    this.routeCache.clear();
    this.channelCache.clear();
    this.lastCacheUpdate = 0;
  }

  /**
   * Build route details with router addresses
   */
  async buildRouteWithAddresses(route: Route): Promise<RouteWithAddresses> {
    if (!this.routerResolver) {
      throw new Error('Router resolver not initialized');
    }

    const routerAddresses: string[] = [];
    
    // Get router address for each hop in the path
    for (const chainId of route.path) {
      try {
        const address = await this.routerResolver.resolveRouterAddress(chainId);
        routerAddresses.push(address);
      } catch (error) {
        this.logger.error({ error, chainId }, 'Failed to resolve router address');
        throw new Error(`Cannot resolve router for ${chainId}`);
      }
    }

    return {
      ...route,
      routerAddresses
    };
  }

  /**
   * Get router address for a specific chain
   */
  async getRouterAddress(chainId: string): Promise<string> {
    if (!this.routerResolver) {
      throw new Error('Router resolver not initialized');
    }

    return this.routerResolver.resolveRouterAddress(chainId);
  }

  /**
   * Verify route viability with dynamic checks
   */
  async verifyRoute(route: Route): Promise<boolean> {
    if (!this.registryClient) {
      return true; // Skip verification if registry client not available
    }

    try {
      // Verify all channels in the route are active
      for (let i = 0; i < route.channels.length; i++) {
        const channel = route.channels[i];
        const isActive = await this.registryClient.verifyChannel(
          channel.chainId,
          channel.counterparty.chainId,
          channel.channelId
        );

        if (!isActive) {
          this.logger.warn(
            { channel: channel.channelId, chain: channel.chainId },
            'Channel is not active'
          );
          return false;
        }
      }

      // Verify all router addresses are available
      for (const chainId of route.path) {
        try {
          await this.getRouterAddress(chainId);
        } catch (error) {
          this.logger.warn({ error, chainId }, 'Router address not available');
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.error({ error, route }, 'Failed to verify route');
      return false;
    }
  }
}

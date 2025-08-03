/**
 * Router Resolution Service
 * 
 * Provides dynamic router address resolution with caching and fallback mechanisms
 */

import { Logger } from 'pino';
import { ChainRegistryClient } from './chain-registry-client';
// Note: Shared config import removed - using local defaults
import { EventEmitter } from 'events';

export interface RouterResolutionConfig {
  enableDynamicLookup: boolean;
  cacheTimeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface ResolvedRouter {
  chainId: string;
  routerAddress: string;
  htlcAddress?: string;
  source: 'registry' | 'config' | 'cache';
  confidence: 'high' | 'medium' | 'low';
  timestamp: number;
}

export class RouterResolutionService extends EventEmitter {
  private logger: Logger;
  private registryClient: ChainRegistryClient;
  private config: RouterResolutionConfig;
  private routerCache: Map<string, ResolvedRouter> = new Map();
  private resolutionInProgress: Map<string, Promise<string>> = new Map();

  constructor(
    registryClient: ChainRegistryClient,
    config: RouterResolutionConfig,
    logger: Logger
  ) {
    super();
    this.registryClient = registryClient;
    this.config = config;
    this.logger = logger.child({ component: 'RouterResolutionService' });
  }

  /**
   * Resolve router address for a specific chain
   * Implements retry logic and fallback mechanisms
   */
  async resolveRouterAddress(chainId: string): Promise<string> {
    // Check if resolution is already in progress
    const inProgress = this.resolutionInProgress.get(chainId);
    if (inProgress) {
      return inProgress;
    }

    // Check cache first
    const cached = this.getCachedRouter(chainId);
    if (cached && this.isCacheValid(cached)) {
      this.logger.debug({ chainId, address: cached.routerAddress }, 'Using cached router address');
      return cached.routerAddress;
    }

    // Start new resolution
    const resolutionPromise = this.performResolution(chainId);
    this.resolutionInProgress.set(chainId, resolutionPromise);

    try {
      const address = await resolutionPromise;
      return address;
    } finally {
      this.resolutionInProgress.delete(chainId);
    }
  }

  /**
   * Batch resolve multiple router addresses
   */
  async resolveMultipleRouters(chainIds: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    
    // Resolve in parallel with concurrency limit
    const concurrency = 5;
    for (let i = 0; i < chainIds.length; i += concurrency) {
      const batch = chainIds.slice(i, i + concurrency);
      const promises = batch.map(async (chainId) => {
        try {
          const address = await this.resolveRouterAddress(chainId);
          results.set(chainId, address);
        } catch (error) {
          this.logger.error({ error, chainId }, 'Failed to resolve router address');
        }
      });
      
      await Promise.all(promises);
    }

    return results;
  }

  /**
   * Verify router address is still valid
   */
  async verifyRouterAddress(chainId: string, routerAddress: string): Promise<boolean> {
    try {
      // Query the contract to ensure it exists and is a router
      // This would involve querying the contract's info or a specific method
      // For now, we'll do a basic validation
      
      if (!routerAddress || routerAddress.length < 10) {
        return false;
      }

      // Check if it matches expected prefix
      const chainInfo = await this.registryClient.getRouterAddress(chainId);
      return chainInfo === routerAddress;
    } catch (error) {
      this.logger.warn({ error, chainId, routerAddress }, 'Failed to verify router address');
      return false;
    }
  }

  /**
   * Update router address (admin function)
   */
  async updateRouterAddress(chainId: string, routerAddress: string, source: 'registry' | 'config'): Promise<void> {
    const resolved: ResolvedRouter = {
      chainId,
      routerAddress,
      source,
      confidence: source === 'registry' ? 'high' : 'medium',
      timestamp: Date.now()
    };

    this.routerCache.set(chainId, resolved);
    this.emit('routerUpdated', resolved);
    
    this.logger.info({ chainId, routerAddress, source }, 'Router address updated');
  }

  /**
   * Get all known routers
   */
  getAllRouters(): Map<string, ResolvedRouter> {
    return new Map(this.routerCache);
  }

  /**
   * Clear cache for a specific chain or all chains
   */
  clearCache(chainId?: string): void {
    if (chainId) {
      this.routerCache.delete(chainId);
    } else {
      this.routerCache.clear();
    }
  }

  /**
   * Perform the actual resolution with retries
   */
  private async performResolution(chainId: string): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        // Try dynamic lookup if enabled
        if (this.config.enableDynamicLookup) {
          const address = await this.registryClient.getRouterAddress(chainId);
          
          const resolved: ResolvedRouter = {
            chainId,
            routerAddress: address,
            source: 'registry',
            confidence: 'high',
            timestamp: Date.now()
          };
          
          this.routerCache.set(chainId, resolved);
          this.emit('routerResolved', resolved);
          
          return address;
        }
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          { error, chainId, attempt: attempt + 1 },
          'Failed to resolve router from registry'
        );
        
        if (attempt < this.config.retryAttempts - 1) {
          await this.delay(this.config.retryDelay * (attempt + 1));
        }
      }
    }

    // Fall back to configuration
    const configAddress = undefined; // No config available
    if (configAddress && !configAddress.includes('placeholder')) {
      const resolved: ResolvedRouter = {
        chainId,
        routerAddress: configAddress,
        source: 'config',
        confidence: 'medium',
        timestamp: Date.now()
      };
      
      this.routerCache.set(chainId, resolved);
      this.emit('routerResolved', resolved);
      
      this.logger.info(
        { chainId, address: configAddress },
        'Using configured router address as fallback'
      );
      
      return configAddress;
    }

    // If all else fails, throw error
    throw new Error(
      `Failed to resolve router address for ${chainId}: ${lastError?.message || 'No address found'}`
    );
  }

  /**
   * Get cached router if available
   */
  private getCachedRouter(chainId: string): ResolvedRouter | undefined {
    return this.routerCache.get(chainId);
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(cached: ResolvedRouter): boolean {
    const age = Date.now() - cached.timestamp;
    
    // Different cache times based on confidence
    const maxAge = cached.confidence === 'high' 
      ? this.config.cacheTimeout 
      : this.config.cacheTimeout / 2;
    
    return age < maxAge;
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get resolution statistics
   */
  getStats(): {
    totalCached: number;
    bySource: Record<string, number>;
    byConfidence: Record<string, number>;
    averageAge: number;
  } {
    const entries = Array.from(this.routerCache.values());
    const now = Date.now();

    const bySource: Record<string, number> = {};
    const byConfidence: Record<string, number> = {};
    let totalAge = 0;

    for (const entry of entries) {
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      byConfidence[entry.confidence] = (byConfidence[entry.confidence] || 0) + 1;
      totalAge += now - entry.timestamp;
    }

    return {
      totalCached: entries.length,
      bySource,
      byConfidence,
      averageAge: entries.length > 0 ? totalAge / entries.length : 0
    };
  }
}
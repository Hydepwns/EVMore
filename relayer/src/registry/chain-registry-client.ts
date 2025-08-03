/**
 * Chain Registry Client for Dynamic Router Address Resolution
 * 
 * This module provides dynamic lookup of router addresses and IBC channels
 * from multiple sources:
 * 1. On-chain registry contract (primary)
 * 2. External chain registry API (fallback)
 * 3. Local configuration (last resort)
 */

import { Logger } from 'pino';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { StargateClient } from '@cosmjs/stargate';
import axios from 'axios';
import { ChainInfo, IBCChannel, ChainRegistryData } from '../../../shared/config/chain-registry';
import { getChainsConfig, getConfig } from '../../../shared/config/fusion-config';
import { AppConfig } from '../config';

export interface RouterInfo {
  chainId: string;
  routerAddress: string;
  htlcAddress?: string;
  lastUpdated: number;
}

export interface ChannelInfo {
  sourceChainId: string;
  destChainId: string;
  sourceChannel: string;
  destChannel: string;
  status: 'active' | 'inactive' | 'unknown';
  lastVerified: number;
}

export interface RegistryQueryMsg {
  GetChain: { chain_id: string };
  GetAllChains: {};
  GetIBCChannels: { chain_id: string };
}

export interface ChainInfoResponse {
  chain: {
    chain_id: string;
    chain_name: string;
    chain_type: 'Cosmos' | 'Ethereum' | { Other: string };
    native_denom: string;
    prefix: string;
    gas_price: string;
    htlc_contract?: string;
    router_contract?: string;
    active: boolean;
    metadata: {
      rpc_endpoints: string[];
      rest_endpoints: string[];
      explorer_url?: string;
      logo_url?: string;
      block_time_seconds: number;
    };
  };
}

export class ChainRegistryClient {
  private logger: Logger;
  private config: AppConfig;
  private cosmWasmClient?: SigningCosmWasmClient;
  private registryContractAddress?: string;
  
  // Caches
  private routerCache: Map<string, RouterInfo> = new Map();
  private channelCache: Map<string, ChannelInfo[]> = new Map();
  private cacheTimeout = 300000; // 5 minutes
  
  // External registry endpoints
  private readonly CHAIN_REGISTRY_API = 'https://api.github.com/repos/cosmos/chain-registry/contents/';
  private readonly PING_PUB_API = 'https://api.ping.pub/';

  constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'ChainRegistryClient' });
  }

  async initialize(cosmWasmClient: SigningCosmWasmClient, registryContractAddress?: string): Promise<void> {
    this.cosmWasmClient = cosmWasmClient;
    this.registryContractAddress = registryContractAddress || process.env.REGISTRY_CONTRACT_ADDRESS;
    
    // Load initial data
    await this.refreshAllData();
    
    // Set up periodic refresh
    setInterval(() => {
      this.refreshAllData().catch(err => 
        this.logger.error({ error: err }, 'Failed to refresh registry data')
      );
    }, this.cacheTimeout);
  }

  /**
   * Get router address for a specific chain
   * Tries multiple sources in order of preference
   */
  async getRouterAddress(chainId: string): Promise<string> {
    // Check cache first
    const cached = this.routerCache.get(chainId);
    if (cached && Date.now() - cached.lastUpdated < this.cacheTimeout) {
      return cached.routerAddress;
    }

    // Try on-chain registry first
    try {
      const address = await this.queryOnChainRegistry(chainId);
      if (address) {
        this.updateRouterCache(chainId, address);
        return address;
      }
    } catch (error) {
      this.logger.warn({ error, chainId }, 'Failed to query on-chain registry');
    }

    // Try external registry API
    try {
      const address = await this.queryExternalRegistry(chainId);
      if (address) {
        this.updateRouterCache(chainId, address);
        return address;
      }
    } catch (error) {
      this.logger.warn({ error, chainId }, 'Failed to query external registry');
    }

    // Fall back to configuration
    const configAddress = getChainsConfig().routerAddresses[chainId];
    if (configAddress && !configAddress.includes('placeholder')) {
      this.updateRouterCache(chainId, configAddress);
      return configAddress;
    }

    throw new Error(`No router address found for chain ${chainId}`);
  }

  /**
   * Get IBC channel between two chains
   */
  async getIBCChannel(sourceChainId: string, destChainId: string): Promise<ChannelInfo | null> {
    const channels = await this.getChannelsForChain(sourceChainId);
    return channels.find(ch => ch.destChainId === destChainId) || null;
  }

  /**
   * Get all active IBC channels for a chain
   */
  async getChannelsForChain(chainId: string): Promise<ChannelInfo[]> {
    // Check cache
    const cached = this.channelCache.get(chainId);
    if (cached && cached.length > 0) {
      // Filter out stale entries
      const fresh = cached.filter(ch => Date.now() - ch.lastVerified < this.cacheTimeout);
      if (fresh.length > 0) {
        return fresh;
      }
    }

    // Query fresh data
    const channels = await this.queryChannelsFromAllSources(chainId);
    this.channelCache.set(chainId, channels);
    return channels;
  }

  /**
   * Verify if a specific IBC channel is active
   */
  async verifyChannel(sourceChainId: string, destChainId: string, channelId: string): Promise<boolean> {
    try {
      const client = await StargateClient.connect(this.getRPCEndpoint(sourceChainId));
      const channel = await client.ibc.channel.channel('transfer', channelId);
      
      return channel.channel?.state === 'STATE_OPEN';
    } catch (error) {
      this.logger.error({ error, sourceChainId, channelId }, 'Failed to verify channel');
      return false;
    }
  }

  /**
   * Query on-chain registry contract
   */
  private async queryOnChainRegistry(chainId: string): Promise<string | null> {
    if (!this.cosmWasmClient || !this.registryContractAddress) {
      return null;
    }

    try {
      const query: RegistryQueryMsg = { GetChain: { chain_id: chainId } };
      const response: ChainInfoResponse = await this.cosmWasmClient.queryContractSmart(
        this.registryContractAddress,
        query
      );

      if (response.chain.active && response.chain.router_contract) {
        return response.chain.router_contract;
      }
    } catch (error) {
      this.logger.debug({ error, chainId }, 'Chain not found in on-chain registry');
    }

    return null;
  }

  /**
   * Query external chain registry API
   */
  private async queryExternalRegistry(chainId: string): Promise<string | null> {
    try {
      // Try chain registry GitHub repo
      const chainName = this.getChainNameFromId(chainId);
      const response = await axios.get(
        `${this.CHAIN_REGISTRY_API}${chainName}/assetlist.json`,
        {
          headers: { Accept: 'application/vnd.github.v3.raw' },
          timeout: 5000
        }
      );

      // Parse response to find router contract info
      // This is a simplified example - actual parsing would be more complex
      const data = response.data;
      if (data && data.contracts && data.contracts.router) {
        return data.contracts.router;
      }
    } catch (error) {
      this.logger.debug({ error, chainId }, 'Failed to query GitHub chain registry');
    }

    // Try Ping.pub API as fallback
    try {
      const response = await axios.get(
        `${this.PING_PUB_API}chains/${chainId}/contracts`,
        { timeout: 5000 }
      );

      if (response.data && response.data.router_address) {
        return response.data.router_address;
      }
    } catch (error) {
      this.logger.debug({ error, chainId }, 'Failed to query Ping.pub API');
    }

    return null;
  }

  /**
   * Query IBC channels from all available sources
   */
  private async queryChannelsFromAllSources(chainId: string): Promise<ChannelInfo[]> {
    const channels: ChannelInfo[] = [];
    const seen = new Set<string>();

    // Try on-chain registry
    if (this.cosmWasmClient && this.registryContractAddress) {
      try {
        const query: RegistryQueryMsg = { GetIBCChannels: { chain_id: chainId } };
        const response = await this.cosmWasmClient.queryContractSmart(
          this.registryContractAddress,
          query
        );

        if (Array.isArray(response)) {
          for (const ch of response) {
            const key = `${ch.source_chain_id}-${ch.dest_chain_id}-${ch.source_channel}`;
            if (!seen.has(key)) {
              seen.add(key);
              channels.push({
                sourceChainId: ch.source_chain_id,
                destChainId: ch.dest_chain_id,
                sourceChannel: ch.source_channel,
                destChannel: ch.dest_channel,
                status: ch.active ? 'active' : 'inactive',
                lastVerified: Date.now()
              });
            }
          }
        }
      } catch (error) {
        this.logger.debug({ error, chainId }, 'Failed to query channels from on-chain registry');
      }
    }

    // Query actual IBC state
    try {
      const client = await StargateClient.connect(this.getRPCEndpoint(chainId));
      const channelResponses = await client.ibc.channel.channels();
      
      for (const ch of channelResponses.channels) {
        if (ch.portId === 'transfer' && ch.state === 'STATE_OPEN') {
          const key = `${chainId}-${ch.counterparty.channelId}-${ch.channelId}`;
          if (!seen.has(key)) {
            seen.add(key);
            
            // We need to determine the counterparty chain ID
            // This would require additional queries or configuration
            const destChainId = await this.resolveCounterpartyChain(chainId, ch.channelId);
            
            if (destChainId) {
              channels.push({
                sourceChainId: chainId,
                destChainId,
                sourceChannel: ch.channelId,
                destChannel: ch.counterparty.channelId,
                status: 'active',
                lastVerified: Date.now()
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error({ error, chainId }, 'Failed to query IBC channels');
    }

    // Add configured channels as fallback
    const configuredChannels = getChainsConfig().ibcChannels;
    for (const key in configuredChannels) {
      const [source, dest] = key.split('-');
      if (source === chainId) {
        const ch = configuredChannels[key];
        const channelKey = `${source}-${dest}-${ch.channel}`;
        if (!seen.has(channelKey)) {
          channels.push({
            sourceChainId: source,
            destChainId: dest,
            sourceChannel: ch.channel,
            destChannel: ch.counterpartyChannel,
            status: 'unknown',
            lastVerified: Date.now()
          });
        }
      }
    }

    return channels;
  }

  /**
   * Refresh all cached data
   */
  private async refreshAllData(): Promise<void> {
    this.logger.info('Refreshing chain registry data');
    
    // Clear old cache entries
    const now = Date.now();
    for (const [chainId, info] of this.routerCache.entries()) {
      if (now - info.lastUpdated > this.cacheTimeout * 2) {
        this.routerCache.delete(chainId);
      }
    }

    // Refresh router addresses for known chains
    const chains = Object.keys(getChainsConfig().routerAddresses);
    for (const chainId of chains) {
      try {
        await this.getRouterAddress(chainId);
      } catch (error) {
        this.logger.warn({ error, chainId }, 'Failed to refresh router address');
      }
    }
  }

  /**
   * Update router cache
   */
  private updateRouterCache(chainId: string, routerAddress: string): void {
    this.routerCache.set(chainId, {
      chainId,
      routerAddress,
      lastUpdated: Date.now()
    });
  }

  /**
   * Get RPC endpoint for a chain
   */
  private getRPCEndpoint(chainId: string): string {
    // This should be configurable per chain
    const endpoints: Record<string, string> = {
      'osmosis-1': 'https://rpc.osmosis.zone',
      'juno-1': 'https://rpc.juno.strange.love',
      'cosmoshub-4': 'https://rpc.cosmos.network',
      'axelar-dojo-1': 'https://rpc.axelar.dev'
    };

    return endpoints[chainId] || 'http://localhost:26657';
  }

  /**
   * Convert chain ID to chain name for registry lookup
   */
  private getChainNameFromId(chainId: string): string {
    const mapping: Record<string, string> = {
      'osmosis-1': 'osmosis',
      'juno-1': 'juno',
      'cosmoshub-4': 'cosmoshub',
      'axelar-dojo-1': 'axelar'
    };

    return mapping[chainId] || chainId.split('-')[0];
  }

  /**
   * Resolve counterparty chain from channel ID
   * This is a simplified implementation - in reality would need more complex logic
   */
  private async resolveCounterpartyChain(chainId: string, channelId: string): Promise<string | null> {
    // This would typically involve querying channel metadata or maintaining a mapping
    // For now, we'll use a simple heuristic based on known channels
    const knownChannels: Record<string, Record<string, string>> = {
      'osmosis-1': {
        'channel-0': 'cosmoshub-4',
        'channel-42': 'juno-1',
        'channel-208': 'axelar-dojo-1'
      },
      'juno-1': {
        'channel-0': 'osmosis-1',
        'channel-1': 'cosmoshub-4'
      },
      'cosmoshub-4': {
        'channel-141': 'osmosis-1',
        'channel-207': 'juno-1'
      }
    };

    return knownChannels[chainId]?.[channelId] || null;
  }
}
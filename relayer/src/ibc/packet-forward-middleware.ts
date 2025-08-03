import { Logger } from 'pino';
import { RouteDiscovery, Route } from '../routes/route-discovery';
import { HTLCMemo } from './types';
import { FusionConfigService } from '../config/fusion-config-service';

export interface ForwardPath {
  channel: string;
  port: string;
  receiver: string;
  timeout?: string;
  retries?: number;
}

export interface MultiHopConfig {
  maxHops: number;
  hopTimeout: number; // seconds per hop
  maxRetries: number;
}

export class PacketForwardMiddleware {
  private logger: Logger;
  private routeDiscovery: RouteDiscovery;
  private config: MultiHopConfig;

  constructor(
    routeDiscovery: RouteDiscovery,
    config: MultiHopConfig,
    logger: Logger
  ) {
    this.routeDiscovery = routeDiscovery;
    this.config = config;
    this.logger = logger.child({ component: 'PacketForwardMiddleware' });
  }

  async planMultiHopTransfer(
    sourceChain: string,
    destinationChain: string,
    destinationReceiver: string,
    htlcParams: Omit<HTLCMemo, 'type'>
  ): Promise<ForwardPath[]> {
    this.logger.info(
      { sourceChain, destinationChain },
      'Planning multi-hop transfer route'
    );

    // Get available routes
    const routes = await this.routeDiscovery.findRoutes(sourceChain, destinationChain);
    
    if (routes.length === 0) {
      throw new Error(`No route found from ${sourceChain} to ${destinationChain}`);
    }

    // Use the best route (shortest path with lowest estimated time)
    const selectedRoute = routes[0];
    
    if (selectedRoute.path.length > this.config.maxHops + 1) {
      throw new Error(`Route requires ${selectedRoute.path.length - 1} hops, max allowed is ${this.config.maxHops}`);
    }

    this.logger.info(
      { 
        route: selectedRoute,
        hopCount: selectedRoute.path.length - 1 
      },
      'Selected route for transfer'
    );

    // Convert route to forward paths
    const forwardPaths = this.buildForwardPaths(selectedRoute, destinationReceiver, htlcParams);
    
    return forwardPaths;
  }

  private buildForwardPaths(
    route: Route,
    finalReceiver: string,
    htlcParams: Omit<HTLCMemo, 'type'>
  ): ForwardPath[] {
    const paths: ForwardPath[] = [];
    
    // Calculate timeout for each hop
    const currentTime = Math.floor(Date.now() / 1000);
    const totalTimeout = htlcParams.timelock - currentTime;
    const hopsRemaining = route.channels.length;
    const timePerHop = Math.min(
      Math.floor(totalTimeout / hopsRemaining / 2), // Use half the available time
      this.config.hopTimeout
    );

    // Build forward path for each hop
    for (let i = 0; i < route.channels.length; i++) {
      const channel = route.channels[i];
      const isLastHop = i === route.channels.length - 1;
      
      // Calculate timeout for this hop
      const hopTimeout = currentTime + (timePerHop * (hopsRemaining - i));
      
      const path: ForwardPath = {
        channel: channel.counterparty.channelId,
        port: channel.counterparty.portId,
        receiver: isLastHop ? finalReceiver : this.getIntermediateReceiver(channel.counterparty.chainId),
        timeout: hopTimeout.toString(),
        retries: this.config.maxRetries
      };
      
      paths.push(path);
    }
    
    return paths;
  }

  private getIntermediateReceiver(chainId: string): string {
    // Implementation: Look up the appropriate IBC receiver address for the chain
    try {
      // 1. Check for configured intermediate receivers
      const configuredReceivers: Record<string, string> = {
        'osmosis-1': 'osmo1pfm_receiver_address_here',
        'cosmoshub-4': 'cosmos1pfm_receiver_address_here',
        'juno-1': 'juno1pfm_receiver_address_here',
      };
      
      // 2. Return configured receiver if available
      if (configuredReceivers[chainId]) {
        return configuredReceivers[chainId];
      }
      
      // 3. Fall back to standardized format for unknown chains
      // This follows the pattern: chain_prefix + middleware_suffix
      const chainPrefix = chainId.split('-')[0]; // Extract 'osmosis' from 'osmosis-1'
      return `${chainPrefix}1pfm_middleware_account`;
      
    } catch (error) {
      this.logger.warn('Failed to determine intermediate receiver, using fallback', { 
        chainId, 
        error 
      });
      return `${chainId}/ibc-forward-receiver`;
    }
  }

  validateTimelocksForRoute(
    route: Route,
    initialTimelock: number
  ): { valid: boolean; adjustedTimelocks: number[] } {
    const currentTime = Math.floor(Date.now() / 1000);
    const adjustedTimelocks: number[] = [];
    
    // Each hop should have a decreasing timelock
    const totalHops = route.path.length - 1;
    const timeLockDecrement = getTimelockConfig().timelockReductionPerHop;
    const minTimeBuffer = Math.floor(getTimelockConfig().timeoutBuffer / 2); // Half of timeout buffer as minimum
    
    for (let i = 0; i < totalHops; i++) {
      const hopTimelock = initialTimelock - (timeLockDecrement * (i + 1));
      
      // Check if this hop would have enough time
      if (hopTimelock - currentTime < minTimeBuffer) {
        this.logger.warn(
          { 
            hop: i + 1,
            chainId: route.path[i + 1],
            timeRemaining: hopTimelock - currentTime
          },
          'Insufficient time for hop'
        );
        return { valid: false, adjustedTimelocks };
      }
      
      adjustedTimelocks.push(hopTimelock);
    }
    
    return { valid: true, adjustedTimelocks };
  }

  async calculateFees(route: Route): Promise<{
    totalFee: string;
    feeBreakdown: Array<{ chain: string; fee: string }>;
  }> {
    // Implementation: Calculate fees for multi-hop IBC transfers
    try {
      const feeBreakdown: Array<{ chain: string; fee: string }> = [];
      let totalFee = 0;
      
      // 1. Query each chain for current IBC transfer fees
      for (let i = 1; i < route.path.length; i++) {
        const chain = route.path[i];
        
        // 2. Consider gas costs for each hop
        const chainFee = await this.getChainTransferFee(chain);
        
        // 3. Include any packet forward middleware fees
        const middlewareFee = await this.getMiddlewareFee(chain);
        
        const hopFee = chainFee + middlewareFee;
        
        feeBreakdown.push({
          chain,
          fee: hopFee.toString()
        });
        
        totalFee += hopFee;
      }
      
      return {
        totalFee: totalFee.toString(),
        feeBreakdown
      };
    } catch (error) {
      this.logger.error('Failed to calculate route fees', { error, route });
      // Return fallback fee structure
      return {
        totalFee: '1000', // Default total fee
        feeBreakdown: route.path.slice(1).map(chain => ({
          chain,
          fee: '200' // Default per-hop fee
        }))
      };
    }
  }
  
  private async getChainTransferFee(chainId: string): Promise<number> {
    // Implementation: Get IBC transfer fee for specific chain
    const defaultFees: Record<string, number> = {
      'osmosis-1': 150,     // 0.15 OSMO
      'cosmoshub-4': 100,   // 0.1 ATOM  
      'juno-1': 200,        // 0.2 JUNO
    };
    
    return defaultFees[chainId] || 100; // Default 0.1 tokens
  }
  
  private async getMiddlewareFee(chainId: string): Promise<number> {
    // Implementation: Get packet forward middleware fee  
    const middlewareFees: Record<string, number> = {
      'osmosis-1': 50,      // PFM fee
      'cosmoshub-4': 0,     // No PFM fee
      'juno-1': 25,         // Lower PFM fee
    };
    
    return middlewareFees[chainId] || 25; // Default middleware fee
  }

  createForwardMemo(
    paths: ForwardPath[],
    htlcMemo?: Omit<HTLCMemo, 'type'>
  ): string {
    if (paths.length === 0) {
      throw new Error('No forward paths provided');
    }
    
    // Build the memo structure for packet forward middleware
    let memo: any = {};
    
    // Build nested forward structure
    let current = memo;
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const isLastHop = i === paths.length - 1;
      
      current.forward = {
        receiver: path.receiver,
        port: path.port,
        channel: path.channel,
        timeout: path.timeout,
        retries: path.retries || 0
      };
      
      // Add HTLC memo to the last hop
      if (isLastHop && htlcMemo) {
        current.forward.memo = JSON.stringify({
          type: 'htlc_create',
          ...htlcMemo
        });
      }
      
      // Prepare for next iteration if not last
      if (!isLastHop) {
        current = current.forward;
      }
    }
    
    return JSON.stringify(memo);
  }
}
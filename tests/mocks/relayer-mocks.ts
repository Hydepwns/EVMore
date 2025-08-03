import { EventEmitter } from 'events';

export interface MockRelayerConfig {
  autoRelay: boolean;
  relayDelay: number;
  failureRate: number;
}

export class MockRelayer extends EventEmitter {
  private pendingRelays: Map<string, any> = new Map();
  private relayHistory: any[] = [];
  private isRunning: boolean = false;
  
  constructor(private config: MockRelayerConfig = {
    autoRelay: true,
    relayDelay: 1000,
    failureRate: 0,
  }) {
    super();
  }
  
  start(): void {
    this.isRunning = true;
    this.emit('started');
    
    if (this.config.autoRelay) {
      this.startAutoRelay();
    }
  }
  
  stop(): void {
    this.isRunning = false;
    this.emit('stopped');
  }
  
  async relaySwap(swapData: {
    sourceChain: string;
    targetChain: string;
    swapId: string;
    secretHash: string;
    amount: string;
    route?: string[];
  }): Promise<string> {
    const relayId = `relay_${Date.now()}_${Math.random()}`;
    
    this.pendingRelays.set(relayId, {
      ...swapData,
      status: 'pending',
      createdAt: Date.now(),
    });
    
    this.emit('relay_initiated', { relayId, swapData });
    
    // Simulate relay delay
    await new Promise(resolve => setTimeout(resolve, this.config.relayDelay));
    
    // Simulate failure based on failure rate
    if (Math.random() < this.config.failureRate) {
      this.updateRelayStatus(relayId, 'failed', 'Simulated failure');
      throw new Error('Relay failed');
    }
    
    // Process relay based on route
    if (swapData.route && swapData.route.length > 2) {
      await this.processMultiHopRelay(relayId, swapData);
    } else {
      await this.processDirectRelay(relayId, swapData);
    }
    
    return relayId;
  }
  
  private async processDirectRelay(relayId: string, swapData: any): Promise<void> {
    // Simulate direct relay
    this.emit('relay_progress', {
      relayId,
      stage: 'initiating_target_swap',
      progress: 0.5,
    });
    
    await new Promise(resolve => setTimeout(resolve, this.config.relayDelay / 2));
    
    this.updateRelayStatus(relayId, 'completed');
    this.emit('relay_completed', { relayId });
  }
  
  private async processMultiHopRelay(relayId: string, swapData: any): Promise<void> {
    const route = swapData.route;
    
    for (let i = 0; i < route.length - 1; i++) {
      const progress = (i + 1) / (route.length - 1);
      
      this.emit('relay_progress', {
        relayId,
        stage: `hop_${i}_${route[i]}_to_${route[i + 1]}`,
        progress,
      });
      
      await new Promise(resolve => setTimeout(resolve, this.config.relayDelay / route.length));
      
      // Simulate potential failure at each hop
      if (Math.random() < this.config.failureRate / 2) {
        this.updateRelayStatus(relayId, 'failed', `Failed at hop ${i}`);
        this.emit('relay_failed', { relayId, hop: i });
        throw new Error(`Relay failed at hop ${i}`);
      }
    }
    
    this.updateRelayStatus(relayId, 'completed');
    this.emit('relay_completed', { relayId });
  }
  
  async relaySecret(
    relayId: string,
    secret: string,
    direction: 'forward' | 'backward'
  ): Promise<void> {
    const relay = this.pendingRelays.get(relayId);
    if (!relay) {
      throw new Error('Relay not found');
    }
    
    this.emit('secret_relay_started', { relayId, direction });
    
    await new Promise(resolve => setTimeout(resolve, this.config.relayDelay / 3));
    
    relay.secret = secret;
    relay.secretRelayedAt = Date.now();
    
    this.emit('secret_relayed', { relayId, direction });
  }
  
  private updateRelayStatus(relayId: string, status: string, error?: string): void {
    const relay = this.pendingRelays.get(relayId);
    if (relay) {
      relay.status = status;
      relay.updatedAt = Date.now();
      if (error) {
        relay.error = error;
      }
      
      if (status === 'completed' || status === 'failed') {
        this.relayHistory.push({ ...relay });
        this.pendingRelays.delete(relayId);
      }
    }
  }
  
  private startAutoRelay(): void {
    setInterval(() => {
      if (!this.isRunning) return;
      
      // Auto-process pending relays
      for (const [relayId, relay] of this.pendingRelays) {
        if (relay.status === 'pending' && Date.now() - relay.createdAt > 5000) {
          // Auto-fail stuck relays
          this.updateRelayStatus(relayId, 'failed', 'Timeout');
          this.emit('relay_timeout', { relayId });
        }
      }
    }, 1000);
  }
  
  getRelayStatus(relayId: string): any {
    return this.pendingRelays.get(relayId) || 
           this.relayHistory.find(r => r.relayId === relayId);
  }
  
  getPendingRelays(): any[] {
    return Array.from(this.pendingRelays.values());
  }
  
  getRelayHistory(): any[] {
    return this.relayHistory;
  }
  
  reset(): void {
    this.pendingRelays.clear();
    this.relayHistory = [];
    this.removeAllListeners();
  }
}

export class MockRouteDiscovery {
  private routes: Map<string, string[][]> = new Map();
  
  constructor() {
    // Pre-configure some routes
    this.routes.set('ethereum->osmosis', [['ethereum', 'osmosis']]);
    this.routes.set('ethereum->juno', [
      ['ethereum', 'osmosis', 'juno'],
      ['ethereum', 'cosmoshub', 'juno'],
    ]);
    this.routes.set('ethereum->secret', [
      ['ethereum', 'osmosis', 'juno', 'secret'],
      ['ethereum', 'osmosis', 'cosmoshub', 'secret'],
    ]);
  }
  
  async findRoutes(
    sourceChain: string,
    targetChain: string,
    constraints?: {
      maxHops?: number;
      excludeChains?: string[];
      preferredChains?: string[];
    }
  ): Promise<string[][]> {
    const key = `${sourceChain}->${targetChain}`;
    let routes = this.routes.get(key) || [];
    
    if (constraints) {
      // Filter by max hops
      if (constraints.maxHops) {
        routes = routes.filter(r => r.length <= constraints.maxHops);
      }
      
      // Filter by excluded chains
      if (constraints.excludeChains) {
        routes = routes.filter(r => 
          !r.some(chain => constraints.excludeChains!.includes(chain))
        );
      }
      
      // Sort by preferred chains
      if (constraints.preferredChains) {
        routes.sort((a, b) => {
          const aScore = a.filter(c => constraints.preferredChains!.includes(c)).length;
          const bScore = b.filter(c => constraints.preferredChains!.includes(c)).length;
          return bScore - aScore;
        });
      }
    }
    
    return routes;
  }
  
  async estimateRouteCost(route: string[], amount: string): Promise<{
    fees: string;
    estimatedTime: number;
    gasRequired: string;
  }> {
    const hops = route.length - 1;
    const feePerHop = 0.001; // 0.1%
    const timePerHop = 30; // 30 seconds
    
    return {
      fees: (parseFloat(amount) * feePerHop * hops).toString(),
      estimatedTime: timePerHop * hops,
      gasRequired: (100000 * hops).toString(),
    };
  }
  
  addRoute(sourceChain: string, targetChain: string, route: string[]): void {
    const key = `${sourceChain}->${targetChain}`;
    const existing = this.routes.get(key) || [];
    existing.push(route);
    this.routes.set(key, existing);
  }
}
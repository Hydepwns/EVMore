import { 
  ChainMonitor, 
  MonitorStatus, 
  HealthStatus,
  EventType,
  EventHandler,
  Unsubscribe,
  HTLCEvent,
  IBCEvent,
  ChainEvent
} from '@evmore/interfaces';

export class MockChainMonitor implements ChainMonitor {
  private eventHandlers = new Map<EventType, Set<EventHandler<any>>>();
  private _status: MonitorStatus = MonitorStatus.STOPPED;
  private _lastBlock: number = 0;
  private _isHealthy: boolean = true;
  
  constructor(public readonly chainId: string) {}
  
  get status(): MonitorStatus {
    return this._status;
  }
  
  async start(): Promise<void> {
    this._status = MonitorStatus.STARTING;
    // Simulate startup delay
    await new Promise(resolve => setTimeout(resolve, 10));
    this._status = MonitorStatus.RUNNING;
  }
  
  async stop(): Promise<void> {
    this._status = MonitorStatus.STOPPING;
    // Simulate shutdown delay
    await new Promise(resolve => setTimeout(resolve, 10));
    this._status = MonitorStatus.STOPPED;
    this.eventHandlers.clear();
  }
  
  onEvent<T extends ChainEvent>(
    eventType: EventType,
    handler: EventHandler<T>
  ): Unsubscribe {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    
    this.eventHandlers.get(eventType)!.add(handler);
    
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }
  
  getHealth(): HealthStatus {
    return {
      healthy: this._isHealthy,
      lastCheck: new Date(),
      details: { 
        mock: true,
        status: this._status,
        lastBlock: this._lastBlock
      }
    };
  }
  
  getLastBlock(): number {
    return this._lastBlock;
  }
  
  // Test helper methods
  async emitEvent(eventType: EventType, event: ChainEvent): Promise<void> {
    const handlers = this.eventHandlers.get(eventType) || new Set();
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`Error in event handler for ${eventType}:`, error);
      }
    }
  }
  
  setHealthy(healthy: boolean): void {
    this._isHealthy = healthy;
  }
  
  setLastBlock(blockNumber: number): void {
    this._lastBlock = blockNumber;
  }
  
  setStatus(status: MonitorStatus): void {
    this._status = status;
  }
  
  getEventHandlerCount(eventType: EventType): number {
    return this.eventHandlers.get(eventType)?.size || 0;
  }
  
  hasEventHandlers(): boolean {
    return this.eventHandlers.size > 0;
  }
  
  // Helper to create test events
  createHTLCEvent(overrides: Partial<HTLCEvent> = {}): HTLCEvent {
    return {
      type: 'htlc_created',
      chainId: this.chainId,
      blockNumber: this._lastBlock + 1,
      timestamp: new Date(),
      data: {},
      orderId: 'test-order-123',
      amount: '1000000000000000000',
      secretHash: '0xa665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
      timelock: Math.floor(Date.now() / 1000) + 3600,
      ...overrides
    };
  }
  
  createIBCEvent(overrides: Partial<IBCEvent> = {}): IBCEvent {
    return {
      type: 'ibc_packet_sent',
      chainId: this.chainId,
      blockNumber: this._lastBlock + 1,
      timestamp: new Date(),
      data: {},
      packetSequence: 1,
      sourceChannel: 'channel-0',
      destChannel: 'channel-1',
      destChainId: 'osmosis-1',
      ...overrides
    };
  }
  
  // Helper to simulate block progression
  async advanceBlocks(count: number = 1): Promise<void> {
    for (let i = 0; i < count; i++) {
      this._lastBlock++;
      
      // Emit a mock chain event
      const chainEvent = {
        type: 'htlc_created' as EventType,
        chainId: this.chainId,
        blockNumber: this._lastBlock,
        timestamp: new Date(),
        data: { blockHash: `0x${this._lastBlock.toString(16).padStart(64, '0')}` }
      };
      
      await this.emitEvent('htlc_created', chainEvent as any);
      
      // Small delay to simulate real block time
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
}
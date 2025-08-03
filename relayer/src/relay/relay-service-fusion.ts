/**
 * RelayService using @evmore/config
 * This is the migrated version using the new configuration system
 */

import { Logger } from 'pino';
import { FusionConfig } from '@evmore/config';
import { LoggerFactory } from '@evmore/utils';
import { ServiceContainer, CORE_TOKENS } from '@evmore/interfaces';
import { HTLCCreatedEvent } from '../monitor/ethereum-monitor';
import { CosmosHTLCEvent } from '../monitor/cosmos-monitor';
import { MultiHopManager } from '../ibc/multi-hop-manager';
import { RouteDiscovery } from '../routes/route-discovery';
import { DexIntegrationService } from '../dex/dex-integration';
import { ErrorRecoveryManager, OperationType, DEFAULT_ERROR_RECOVERY_CONFIG } from '../security/error-recovery';
import { getMetrics } from '../monitoring/prometheus-metrics';
import { getTracer, withSpan, SwapAttributes, addSpanEvent, CrossChainTimer, addTraceContext } from '../tracing/instrumentation';
import { SpanKind } from '@opentelemetry/api';
import { fusionConfigToAppConfig } from '../config/config-adapter';

export interface PendingRelay {
  id: string;
  sourceChain: string;
  targetChain: string;
  htlcId: string;
  amount: string;
  token: string;
  hashlock: string;
  timelock: number;
  sender: string;
  receiver: string;
  status: 'pending' | 'relaying' | 'completed' | 'failed';
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  swapParams?: {
    targetToken: string;
    minOutputAmount: string;
    routes?: any[];
  };
}

export class RelayServiceFusion {
  private config: FusionConfig;
  private logger: Logger;
  private pendingRelays: Map<string, PendingRelay> = new Map();
  private multiHopManager: MultiHopManager;
  private dexIntegration: DexIntegrationService;
  private errorRecovery: ErrorRecoveryManager;
  private tracer = getTracer('relay-service');
  private metrics = {
    totalRelayed: 0,
    successfulRelays: 0,
    failedRelays: 0,
    swapsExecuted: 0,
  };

  constructor(
    config: FusionConfig,
    container?: ServiceContainer
  ) {
    this.config = config;
    
    // Use LoggerFactory from @evmore/utils if available
    if (container && container.has(CORE_TOKENS.Logger)) {
      this.logger = container.get(CORE_TOKENS.Logger);
    } else {
      this.logger = LoggerFactory.getInstance().create('RelayService');
    }
    
    // Initialize components with AppConfig adapter for backward compatibility
    const appConfig = fusionConfigToAppConfig(config);
    
    this.multiHopManager = new MultiHopManager(appConfig, this.logger);
    this.dexIntegration = new DexIntegrationService(appConfig, this.logger);
    this.errorRecovery = new ErrorRecoveryManager(
      DEFAULT_ERROR_RECOVERY_CONFIG,
      this.logger
    );
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing RelayService with FusionConfig...');
    
    await this.multiHopManager.initialize();
    await this.dexIntegration.initialize();
    
    this.logger.info('RelayService initialized successfully');
  }

  /**
   * Handle an HTLC created event from Ethereum
   */
  async handleEthereumHTLC(event: HTLCCreatedEvent): Promise<void> {
    const span = this.tracer.startSpan('handleEthereumHTLC', { kind: SpanKind.CONSUMER });
    const timer = new CrossChainTimer(event.htlcId);
    
    try {
      await withSpan(span, async () => {
        addTraceContext(span, {
          ...SwapAttributes.create(event.htlcId, event.amount, 'ethereum', event.targetChain),
          'htlc.timelock': event.timelock,
          'htlc.hashlock': event.hashlock,
        });
        
        const relayId = `eth-${event.htlcId}`;
        
        // Check if already processing
        if (this.pendingRelays.has(relayId)) {
          this.logger.warn({ relayId }, 'Already processing relay');
          return;
        }
        
        const relay: PendingRelay = {
          id: relayId,
          sourceChain: 'ethereum',
          targetChain: event.targetChain,
          htlcId: event.htlcId,
          amount: event.amount.toString(),
          token: event.token,
          hashlock: event.hashlock,
          timelock: event.timelock,
          sender: event.sender,
          receiver: event.targetAddress,
          status: 'pending',
          attempts: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        
        this.pendingRelays.set(relayId, relay);
        
        // Check timelock buffer
        const currentTime = Math.floor(Date.now() / 1000);
        const timelockBuffer = this.config.services.relayer.timeoutBufferSeconds;
        
        if (relay.timelock - currentTime < timelockBuffer) {
          addSpanEvent(span, 'timelock_too_close');
          this.logger.warn({ relay, currentTime, timelockBuffer }, 'Timelock too close to expiry');
          relay.status = 'failed';
          return;
        }
        
        // Process the relay
        await this.processRelay(relay);
        
        // Update metrics
        this.metrics.totalRelayed++;
        getMetrics().swapCompletionTime.observe(
          { source_chain: 'ethereum', target_chain: event.targetChain },
          timer.elapsed()
        );
      });
    } catch (error) {
      this.logger.error({ error, event }, 'Failed to handle Ethereum HTLC');
      this.metrics.failedRelays++;
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Handle an HTLC created event from Cosmos
   */
  async handleCosmosHTLC(event: CosmosHTLCEvent): Promise<void> {
    const span = this.tracer.startSpan('handleCosmosHTLC', { kind: SpanKind.CONSUMER });
    const timer = new CrossChainTimer(event.htlcId);
    
    try {
      await withSpan(span, async () => {
        addTraceContext(span, {
          ...SwapAttributes.create(event.htlcId, event.amount, event.chainId, event.targetChain),
          'htlc.timelock': event.timelock,
          'htlc.hashlock': event.hashlock,
        });
        
        const relayId = `${event.chainId}-${event.htlcId}`;
        
        // Check if already processing
        if (this.pendingRelays.has(relayId)) {
          this.logger.warn({ relayId }, 'Already processing relay');
          return;
        }
        
        const relay: PendingRelay = {
          id: relayId,
          sourceChain: event.chainId,
          targetChain: event.targetChain,
          htlcId: event.htlcId,
          amount: event.amount.toString(),
          token: event.token,
          hashlock: event.hashlock,
          timelock: event.timelock,
          sender: event.sender,
          receiver: event.receiver,
          status: 'pending',
          attempts: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          swapParams: event.swapParams,
        };
        
        this.pendingRelays.set(relayId, relay);
        
        // Check timelock buffer
        const currentTime = Math.floor(Date.now() / 1000);
        const timelockBuffer = this.config.services.relayer.timeoutBufferSeconds;
        
        if (relay.timelock - currentTime < timelockBuffer) {
          addSpanEvent(span, 'timelock_too_close');
          this.logger.warn({ relay, currentTime, timelockBuffer }, 'Timelock too close to expiry');
          relay.status = 'failed';
          return;
        }
        
        // Process the relay
        await this.processRelay(relay);
        
        // Update metrics
        this.metrics.totalRelayed++;
        getMetrics().swapCompletionTime.observe(
          { source_chain: event.chainId, target_chain: event.targetChain },
          timer.elapsed()
        );
      });
    } catch (error) {
      this.logger.error({ error, event }, 'Failed to handle Cosmos HTLC');
      this.metrics.failedRelays++;
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  private async processRelay(relay: PendingRelay): Promise<void> {
    const span = this.tracer.startSpan('processRelay', { kind: SpanKind.INTERNAL });
    
    try {
      await withSpan(span, async () => {
        addTraceContext(span, {
          'relay.id': relay.id,
          'relay.source': relay.sourceChain,
          'relay.target': relay.targetChain,
        });
        
        relay.status = 'relaying';
        relay.updatedAt = new Date();
        relay.attempts++;
        
        this.logger.info({ relay }, 'Processing relay');
        
        // Execute with error recovery
        await this.errorRecovery.executeWithRecovery(
          async () => {
            if (relay.targetChain === 'ethereum') {
              await this.relayToEthereum(relay);
            } else {
              await this.relayToCosmos(relay);
            }
          },
          OperationType.RELAY,
          relay.id
        );
        
        relay.status = 'completed';
        relay.updatedAt = new Date();
        this.metrics.successfulRelays++;
        
        addSpanEvent(span, 'relay_completed');
        this.logger.info({ relay }, 'Relay completed successfully');
      });
    } catch (error) {
      relay.status = 'failed';
      relay.updatedAt = new Date();
      this.metrics.failedRelays++;
      
      this.logger.error({ error, relay }, 'Failed to process relay');
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  private async relayToEthereum(relay: PendingRelay): Promise<void> {
    // Ethereum relay implementation
    this.logger.info({ relay }, 'Relaying to Ethereum');
    
    // TODO: Implement actual Ethereum relay logic
    // This would involve:
    // 1. Creating corresponding HTLC on Ethereum
    // 2. Waiting for confirmations
    // 3. Storing the secret for later reveal
  }

  private async relayToCosmos(relay: PendingRelay): Promise<void> {
    const span = this.tracer.startSpan('relayToCosmos', { kind: SpanKind.INTERNAL });
    
    try {
      await withSpan(span, async () => {
        this.logger.info({ relay }, 'Relaying to Cosmos');
        
        // Check if this needs multi-hop routing
        const sourceChainInfo = this.config.networks.cosmos.find(c => c.chainId === relay.sourceChain);
        const targetChainInfo = this.config.networks.cosmos.find(c => c.chainId === relay.targetChain);
        
        if (!sourceChainInfo || !targetChainInfo) {
          throw new Error(`Chain configuration not found for ${relay.sourceChain} or ${relay.targetChain}`);
        }
        
        // Check for direct IBC channel
        const directChannel = sourceChainInfo.ibc.channels[relay.targetChain];
        
        if (directChannel) {
          addSpanEvent(span, 'direct_ibc_transfer');
          // Direct IBC transfer
          await this.multiHopManager.executeDirectTransfer(relay);
        } else {
          addSpanEvent(span, 'multi_hop_routing');
          // Multi-hop routing required
          const route = await RouteDiscovery.findRoute(
            relay.sourceChain,
            relay.targetChain,
            relay.amount,
            relay.token
          );
          
          if (!route) {
            throw new Error(`No route found from ${relay.sourceChain} to ${relay.targetChain}`);
          }
          
          await this.multiHopManager.executeMultiHopTransfer(relay, route);
        }
        
        // If swap params are provided, execute the swap
        if (relay.swapParams && relay.targetChain === 'osmosis-1') {
          addSpanEvent(span, 'executing_swap');
          await this.dexIntegration.executeSwap({
            chainId: relay.targetChain,
            inputToken: relay.token,
            outputToken: relay.swapParams.targetToken,
            inputAmount: relay.amount,
            minOutputAmount: relay.swapParams.minOutputAmount,
            routes: relay.swapParams.routes || [],
            recipient: relay.receiver,
          });
          
          this.metrics.swapsExecuted++;
        }
      });
    } finally {
      span.end();
    }
  }

  /**
   * Get current relay statistics
   */
  getMetrics() {
    return {
      ...this.metrics,
      pendingRelays: this.pendingRelays.size,
      relays: Array.from(this.pendingRelays.values()),
    };
  }

  /**
   * Clean up completed or failed relays
   */
  cleanupRelays(): void {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    
    for (const [id, relay] of this.pendingRelays.entries()) {
      if (
        (relay.status === 'completed' || relay.status === 'failed') &&
        relay.updatedAt < cutoffTime
      ) {
        this.pendingRelays.delete(id);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down RelayService...');
    
    // Wait for pending relays to complete (with timeout)
    const timeout = this.config.environment.debug ? 60000 : 30000;
    const pendingRelays = Array.from(this.pendingRelays.values())
      .filter(r => r.status === 'relaying');
    
    if (pendingRelays.length > 0) {
      this.logger.info(`Waiting for ${pendingRelays.length} pending relays to complete...`);
      
      await Promise.race([
        Promise.all(pendingRelays.map(relay => 
          new Promise(resolve => {
            const checkInterval = setInterval(() => {
              if (relay.status !== 'relaying') {
                clearInterval(checkInterval);
                resolve(undefined);
              }
            }, 1000);
          })
        )),
        new Promise(resolve => setTimeout(resolve, timeout))
      ]);
    }
    
    this.logger.info('RelayService shutdown complete');
  }
}
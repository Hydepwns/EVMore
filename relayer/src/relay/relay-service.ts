import { Logger } from 'pino';
import { AppConfig } from '../config/index';
import { HTLCCreatedEvent } from '../monitor/ethereum-monitor';
import { CosmosHTLCEvent } from '../monitor/cosmos-monitor';
import { MultiHopManager } from '../ibc/multi-hop-manager';
import { RouteDiscovery } from '../routes/route-discovery';
import { DexIntegrationService } from '../dex/dex-integration';
// Note: Shared config imports removed - using local defaults
import { ErrorRecoveryManager, OperationType, DEFAULT_ERROR_RECOVERY_CONFIG } from '../security/error-recovery';
import { getMetrics } from '../monitoring/prometheus-metrics';
import { getTracer, withSpan, SwapAttributes, addSpanEvent, CrossChainTimer, addTraceContext } from '../tracing/instrumentation';
import { SpanKind } from '@opentelemetry/api';

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

export class RelayService {
  private config: AppConfig;
  private logger: Logger;
  private pendingRelays: Map<string, PendingRelay> = new Map();
  private multiHopManager: MultiHopManager;
  private dexIntegration: DexIntegrationService;
  private errorRecovery: ErrorRecoveryManager;
  private routeDiscovery: RouteDiscovery;
  private tracer = getTracer('relay-service');
  private metrics = {
    totalRelayed: 0,
    successfulRelays: 0,
    failedRelays: 0,
    swapsExecuted: 0,
  };

  constructor(
    config: AppConfig, 
    logger: Logger,
    routeDiscovery: RouteDiscovery,
    htlcContractAddresses: Record<string, string>
  ) {
    this.config = config;
    this.logger = logger.child({ component: 'RelayService' });
    this.routeDiscovery = routeDiscovery;
    this.multiHopManager = new MultiHopManager(config, routeDiscovery, logger);
    this.dexIntegration = new DexIntegrationService(
      config.cosmos.rpcUrl,
      htlcContractAddresses,
      logger
    );
    this.errorRecovery = new ErrorRecoveryManager(DEFAULT_ERROR_RECOVERY_CONFIG, logger);
  }
  
  async initialize(): Promise<void> {
    await this.errorRecovery.executeWithRecovery(
      () => this.multiHopManager.initialize(),
      OperationType.IBC_TRANSFER,
      'multihop_init'
    );
    
    await this.errorRecovery.executeWithRecovery(
      () => this.dexIntegration.initialize(),
      OperationType.DEX_SWAP,
      'dex_init'
    );
    
    this.logger.info('Relay service initialized');
  }

  async handleEthereumHTLC(event: HTLCCreatedEvent): Promise<void> {
    const timer = new CrossChainTimer();
    
    return withSpan(
      this.tracer,
      'handle_ethereum_htlc',
      {
        [SwapAttributes.SOURCE_CHAIN]: 'ethereum',
        [SwapAttributes.TARGET_CHAIN]: event.targetChain,
        [SwapAttributes.HTLC_ID]: event.htlcId,
        [SwapAttributes.AMOUNT]: event.amount.toString(),
        [SwapAttributes.TOKEN]: event.token,
        [SwapAttributes.SENDER]: event.sender,
        [SwapAttributes.RECEIVER]: event.targetAddress,
        [SwapAttributes.HASHLOCK]: event.hashlock,
        [SwapAttributes.TIMELOCK]: event.timelock,
      },
      async (span) => {
        const tracedLogger = addTraceContext(this.logger);
        tracedLogger.info({ event }, 'Handling Ethereum HTLC event');

        // Check if this HTLC includes swap parameters
        timer.checkpoint('swap_params_check');
        const swapParams = await this.checkForSwapParams(event);
        
        if (swapParams) {
          span.setAttributes({
            'swap.has_dex_params': true,
            'swap.target_token': swapParams.targetToken || '',
            'swap.min_output': swapParams.minOutputAmount || '',
          });
        }

        // Create pending relay
        const pendingRelay: PendingRelay = {
          id: `eth_${event.htlcId}`,
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
          swapParams: swapParams,
        };

        this.pendingRelays.set(pendingRelay.id, pendingRelay);
        addSpanEvent('relay_created', { relay_id: pendingRelay.id });

        // Process relay with enhanced error recovery
        timer.checkpoint('relay_processing_start');
        await this.processRelayWithRecovery(pendingRelay);
        
        span.setAttributes({
          'swap.duration_seconds': timer.getDuration(),
        });
      },
      { kind: SpanKind.SERVER }
    );
  }

  async handleCosmosHTLC(event: CosmosHTLCEvent): Promise<void> {
    this.logger.info({ event }, 'Handling Cosmos HTLC event');

    // For now, we only handle Ethereum -> Cosmos direction
    // In a full implementation, this would handle Cosmos -> Ethereum as well
  }

  private async processRelay(relay: PendingRelay): Promise<void> {
    const startTime = Date.now();
    const metrics = getMetrics();
    const timer = new CrossChainTimer();
    
    return withSpan(
      this.tracer,
      'process_relay',
      {
        [SwapAttributes.SOURCE_CHAIN]: relay.sourceChain,
        [SwapAttributes.TARGET_CHAIN]: relay.targetChain,
        [SwapAttributes.HTLC_ID]: relay.htlcId,
        'relay.id': relay.id,
        'relay.attempt': relay.attempts + 1,
      },
      async (span) => {
        const tracedLogger = addTraceContext(this.logger);
        
        relay.status = 'relaying';
        relay.attempts++;
        relay.updatedAt = new Date();

        // Track HTLC event processing
        metrics.recordHtlcEvent(relay.sourceChain, 'created', 'pending');
        metrics.updateActiveHtlcs(relay.sourceChain, 'processing', 1);
        
        addSpanEvent('relay_status_update', { status: 'relaying' });

        try {
          // Check if this relay includes a DEX swap
          if (relay.swapParams) {
            timer.checkpoint('dex_planning_start');
        // Plan the cross-chain swap
        const swapPlan = await this.dexIntegration.planCrossChainSwap({
          sourceChain: relay.sourceChain,
          sourceToken: relay.token,
          sourceAmount: relay.amount,
          targetChain: relay.targetChain,
          targetToken: relay.swapParams.targetToken,
          minOutputAmount: relay.swapParams.minOutputAmount,
          receiver: relay.receiver,
          deadline: relay.timelock,
        });

            // Update relay with swap routes
            relay.swapParams.routes = swapPlan.swapRoutes;
            
            tracedLogger.info({ swapPlan }, 'DEX swap planned for relay');
            addSpanEvent('dex_swap_planned', { 
              routes_count: swapPlan.swapRoutes.length 
            });
          }

          // Determine if this is a single-hop or multi-hop transfer
          const isDirectTransfer = relay.targetChain === this.config.cosmos.chainId;
          
          timer.checkpoint('transfer_start');
          span.setAttributes({
            'relay.is_direct': isDirectTransfer,
            'relay.target_chain': relay.targetChain,
          });
          
          if (isDirectTransfer) {
            // Direct transfer to the configured Cosmos chain
            addSpanEvent('direct_transfer_start');
            await this.processDirectTransfer(relay);
          } else {
            // Multi-hop transfer through IBC
            addSpanEvent('multi_hop_transfer_start');
            await this.processMultiHopTransfer(relay);
          }

          // If swap params exist, execute the swap after HTLC is created
          if (relay.swapParams && relay.swapParams.routes) {
            timer.checkpoint('dex_swap_start');
            addSpanEvent('dex_swap_execution_start');
            await this.executeSwapForRelay(relay);
            this.metrics.swapsExecuted++;
          }

          // Update relay status and record success metrics
          relay.status = 'completed';
          relay.updatedAt = new Date();
          
          // Calculate swap completion time and hops
          const completionTime = (Date.now() - startTime) / 1000;
          const hops = relay.swapParams?.routes?.length || 1;
          
          // Update span with final attributes
          span.setAttributes({
            [SwapAttributes.STATUS]: 'completed',
            [SwapAttributes.HOPS]: hops,
            'relay.duration_seconds': completionTime,
          });
          
          // Record comprehensive metrics
          metrics.recordSwapCompletion(
            relay.sourceChain,
            relay.targetChain,
            hops,
            completionTime,
            'success',
            parseFloat(relay.amount),
            relay.token
          );
          
          metrics.recordHtlcEvent(relay.sourceChain, 'withdrawn', 'success');
          metrics.updateActiveHtlcs(relay.sourceChain, 'processing', -1);
          
          this.metrics.successfulRelays++;
          this.metrics.totalRelayed++;

          addSpanEvent('relay_completed', {
            completion_time: completionTime,
            hops: hops,
          });
          
          tracedLogger.info({ relay, completionTime, hops }, 'Relay completed successfully');
        } catch (error) {
          tracedLogger.error({ error, relay }, 'Failed to process relay');
          span.recordException(error as Error);

          // Record failure metrics
          const completionTime = (Date.now() - startTime) / 1000;
          const hops = relay.swapParams?.routes?.length || 1;
          
          span.setAttributes({
            [SwapAttributes.STATUS]: 'failed',
            [SwapAttributes.HOPS]: hops,
            'relay.duration_seconds': completionTime,
            'error.type': error instanceof Error ? error.name : 'unknown',
          });
          
          metrics.recordSwapCompletion(
            relay.sourceChain,
            relay.targetChain,
            hops,
            completionTime,
            'failed'
          );
          
          metrics.recordHtlcEvent(relay.sourceChain, 'created', 'failed');
          metrics.updateActiveHtlcs(relay.sourceChain, 'processing', -1);

          relay.status = 'failed';
          relay.updatedAt = new Date();

          // Retry if under max attempts
          if (relay.attempts < this.config.relay.maxRetries) {
            relay.status = 'pending';
            addSpanEvent('relay_retry_scheduled', {
              attempt: relay.attempts,
              max_retries: this.config.relay.maxRetries,
            });
            setTimeout(() => this.processRelay(relay), this.config.relay.retryDelay);
          } else {
            this.metrics.failedRelays++;
            this.metrics.totalRelayed++;
            addSpanEvent('relay_max_retries_exceeded');
          }
        }
      }
    );
  }

  private async processDirectTransfer(relay: PendingRelay): Promise<void> {
    // Direct HTLC creation on the target Cosmos chain
    // This is the simplified case when no IBC hops are needed
    
    const htlcParams = {
      htlcId: relay.htlcId,
      receiver: relay.receiver,
      hashlock: relay.hashlock,
              timelock: relay.timelock - 3600, // Reduce by 1 hour for safety
      targetChain: relay.sourceChain,
      targetAddress: relay.sender,
      sourceChain: relay.sourceChain,
      sourceHTLCId: relay.htlcId
    };

    // For direct transfers, we still use IBC but with no intermediate hops
    const sourceChannel = await this.getSourceChannel(relay.sourceChain, relay.targetChain);
    
    const transferId = await this.multiHopManager.executeMultiHopTransfer(
      relay.sourceChain,
      relay.targetChain,
      sourceChannel,
      relay.amount,
      htlcParams
    );

    this.logger.info({ transferId, relay }, 'Direct transfer initiated');
  }

  private async processMultiHopTransfer(relay: PendingRelay): Promise<void> {
    // Multi-hop transfer through IBC packet forwarding
    
    const htlcParams = {
      htlcId: relay.htlcId,
      receiver: relay.receiver,
      hashlock: relay.hashlock,
      timelock: relay.timelock,
      targetChain: relay.targetChain,
      targetAddress: relay.receiver,
      sourceChain: relay.sourceChain,
      sourceHTLCId: relay.htlcId
    };

    const sourceChannel = await this.getSourceChannel(relay.sourceChain, relay.targetChain);
    
    const transferId = await this.multiHopManager.executeMultiHopTransfer(
      relay.sourceChain,
      relay.targetChain,
      sourceChannel,
      relay.amount,
      htlcParams
    );

    this.logger.info({ transferId, relay }, 'Multi-hop transfer initiated');
  }

  private async getSourceChannel(sourceChain: string, targetChain: string): Promise<string> {
    // Use route discovery to find the appropriate channel
    try {
      const routes = await this.routeDiscovery.findRoutes(sourceChain, targetChain);
      
      if (routes.length === 0) {
        throw new Error(`No route found from ${sourceChain} to ${targetChain}`);
      }
      
      // Use the first available route's channel
      const bestRoute = routes[0];
      if (bestRoute.channels.length > 0) {
        return bestRoute.channels[0].channelId;
      }
    } catch (error) {
      this.logger.error({ error, sourceChain, targetChain }, 'Failed to find channel via route discovery');
    }
    
    // Fall back to configuration for known channels
    if (sourceChain === 'ethereum') {
      return 'channel-0'; // Default Ethereum -> Cosmos Hub channel  
    }
    
    return 'channel-1'; // Default IBC channel
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getPendingCount(): number {
    return Array.from(this.pendingRelays.values()).filter(
      (r) => r.status === 'pending' || r.status === 'relaying'
    ).length;
  }

  getPendingRelays(): PendingRelay[] {
    return Array.from(this.pendingRelays.values());
  }

  private async checkForSwapParams(event: HTLCCreatedEvent): Promise<PendingRelay['swapParams'] | undefined> {
    // Implementation of swap parameter extraction from HTLC event data
    try {
      // In a real implementation, this would:
      // 1. Parse the HTLC creation transaction logs for swap instructions
      // 2. Decode memo fields that contain swap parameters
      // 3. Extract route information from contract call data
      
      // Check if the event contains swap-related data
      // For now, return undefined since HTLCCreatedEvent doesn't have args property
      // In a full implementation, this would parse the event data differently
      return undefined;
      
    } catch (error) {
      this.logger.warn('Failed to extract swap parameters from event', { error, htlcId: event.htlcId });
      return undefined;
    }
  }

  private async executeSwapForRelay(relay: PendingRelay): Promise<void> {
    if (!relay.swapParams || !relay.swapParams.routes) {
      throw new Error('No swap parameters found for relay');
    }

    await this.errorRecovery.executeWithRecovery(async () => {
      this.logger.info({ relay }, 'Executing DEX swap for relay');
      
      // Execute the swap on the target chain with error recovery
      const txHash = await this.errorRecovery.executeWithRecovery(
        () => this.dexIntegration.executeSwapForHTLC(
          relay.htlcId,
          relay.targetChain,
          relay.receiver
        ),
        OperationType.DEX_SWAP,
        `execute_swap_${relay.id}`
      );

      this.logger.info({ txHash, relay }, 'DEX swap executed successfully');
    }, OperationType.DEX_SWAP, `swap_relay_${relay.id}`);
  }

  /**
   * Enhanced relay processing with error recovery
   */
  private async processRelayWithRecovery(relay: PendingRelay): Promise<void> {
    await this.errorRecovery.executeWithRecovery(async () => {
      relay.status = 'relaying';
      relay.attempts++;
      relay.updatedAt = new Date();
      
      // Check if this relay includes a DEX swap
      if (relay.swapParams) {
        // Plan the cross-chain swap with error recovery
        const swapPlan = await this.errorRecovery.executeWithRecovery(
          () => this.dexIntegration.planCrossChainSwap({
            sourceChain: relay.sourceChain,
            sourceToken: relay.token,
            sourceAmount: relay.amount,
            targetChain: relay.targetChain,
            targetToken: relay.swapParams!.targetToken,
            minOutputAmount: relay.swapParams!.minOutputAmount,
            receiver: relay.receiver,
            deadline: relay.timelock
          }),
          OperationType.DEX_SWAP,
          `plan_swap_${relay.id}`
        );
        
        // Update relay with swap routes
        relay.swapParams.routes = swapPlan.swapRoutes;
        this.logger.info({ swapPlan }, 'DEX swap planned for relay');
      }
      
      // Determine if this is a single-hop or multi-hop transfer
      const isDirectTransfer = relay.targetChain === this.config.cosmos.chainId;
      
      if (isDirectTransfer) {
        // Direct transfer to the configured Cosmos chain
        await this.errorRecovery.executeWithRecovery(
          () => this.processDirectTransfer(relay),
          OperationType.HTLC_CREATION,
          `direct_transfer_${relay.id}`
        );
      } else {
        // Multi-hop transfer through IBC
        await this.errorRecovery.executeWithRecovery(
          () => this.processMultiHopTransfer(relay),
          OperationType.IBC_TRANSFER,
          `multihop_${relay.id}`
        );
      }
      
      // If swap params exist, execute the swap after HTLC is created
      if (relay.swapParams && relay.swapParams.routes) {
        await this.executeSwapForRelay(relay);
        this.metrics.swapsExecuted++;
      }
      
      // Update relay status
      relay.status = 'completed';
      relay.updatedAt = new Date();
      this.metrics.successfulRelays++;
      this.metrics.totalRelayed++;
      
      this.logger.info({ relay }, 'Relay completed successfully');
    }, OperationType.HTLC_CREATION, `process_relay_${relay.id}`);
  }

  /**
   * Enhanced getMetrics with system health information
   */
  getEnhancedMetrics() {
    const healthReport = this.errorRecovery.getHealthReport();
    
    return {
      ...this.metrics,
      systemHealth: healthReport,
      errorRecovery: {
        circuitBreakerStatus: healthReport.circuitBreakers,
        emergencyStop: healthReport.emergencyStop,
        openCircuits: this.getOpenCircuits(),
        hasOpenCircuits: this.hasOpenCircuits()
      }
    };
  }

  /**
   * Emergency stop the relay service
   */
  emergencyStop(reason: string): void {
    this.errorRecovery.emergencyStopSystem(reason);
    this.logger.error({ reason }, 'Relay service emergency stop activated');
  }

  /**
   * Resume from emergency stop
   */
  resumeFromEmergencyStop(): void {
    this.errorRecovery.resumeSystem();
    this.logger.info('Relay service resumed from emergency stop');
  }

  /**
   * Check if the relay service is healthy
   */
  isHealthy(): boolean {
    return this.errorRecovery.isSystemHealthy();
  }

  /**
   * Stop the relay service and cleanup
   */
  async stop(): Promise<void> {
    this.errorRecovery.stop();
    this.logger.info('Relay service stopped');
  }

  /**
   * Trip a specific circuit breaker
   */
  tripCircuitBreaker(name: string, reason?: string): void {
    const manager = this.errorRecovery['circuitBreakers'].getManager();
    manager.trip(name, reason);
    this.logger.warn({ name, reason }, 'Circuit breaker tripped manually');
  }

  /**
   * Reset a specific circuit breaker
   */
  resetCircuitBreaker(name: string): void {
    const manager = this.errorRecovery['circuitBreakers'].getManager();
    manager.reset(name);
    this.logger.info({ name }, 'Circuit breaker reset manually');
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    const manager = this.errorRecovery['circuitBreakers'].getManager();
    manager.resetAll();
    this.logger.info('All circuit breakers reset manually');
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats(): Record<string, any> {
    const manager = this.errorRecovery['circuitBreakers'].getManager();
    return manager.getAllStats();
  }

  /**
   * Check if any circuit breakers are open
   */
  hasOpenCircuits(): boolean {
    const manager = this.errorRecovery['circuitBreakers'].getManager();
    return manager.hasOpenCircuits();
  }

  /**
   * Get names of open circuit breakers
   */
  getOpenCircuits(): string[] {
    const manager = this.errorRecovery['circuitBreakers'].getManager();
    return manager.getOpenCircuits();
  }
}

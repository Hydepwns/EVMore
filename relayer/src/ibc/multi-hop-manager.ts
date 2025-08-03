import { Logger } from 'pino';
import { IBCPacketHandler } from './packet-handler';
import { PacketForwardMiddleware } from './packet-forward-middleware';
import { RouteDiscovery } from '../routes/route-discovery';
import { HTLCMemo } from './types';
import { AppConfig } from '../config';
import { FusionConfigService } from '../config/fusion-config-service';
import { getTracer, withChildSpan, IBCAttributes, addSpanEvent, addTraceContext } from '../tracing/instrumentation';
import { SpanKind } from '@opentelemetry/api';

export interface MultiHopTransfer {
  id: string;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  htlcParams: Omit<HTLCMemo, 'type'>;
  status: 'pending' | 'routing' | 'transferring' | 'completed' | 'failed';
  currentHop: number;
  totalHops: number;
  route?: string[];
  txHashes: string[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MultiHopManager {
  private ibcHandlers: Map<string, IBCPacketHandler> = new Map();
  private packetForward: PacketForwardMiddleware;
  private routeDiscovery: RouteDiscovery;
  private transfers: Map<string, MultiHopTransfer> = new Map();
  private logger: Logger;
  private config: AppConfig;
  private monitoringInterval?: NodeJS.Timeout;
  private tracer = getTracer('multi-hop-manager');

  constructor(
    config: AppConfig,
    routeDiscovery: RouteDiscovery,
    logger: Logger
  ) {
    this.config = config;
    this.routeDiscovery = routeDiscovery;
    this.logger = logger.child({ component: 'MultiHopManager' });
    
    this.packetForward = new PacketForwardMiddleware(
      routeDiscovery,
      {
        maxHops: getRoutingConfig().maxRouteHops,
        hopTimeout: 300, // 5 minutes per hop
        maxRetries: 2
      },
      logger
    );
  }

  async initialize(): Promise<void> {
    // Initialize IBC handler for the configured Cosmos chain
    const cosmosHandler = new IBCPacketHandler(this.config.cosmos, this.logger);
    await cosmosHandler.initialize();
    this.ibcHandlers.set(this.config.cosmos.chainId, cosmosHandler);
    
    this.logger.info('Multi-hop manager initialized');
  }

  async executeMultiHopTransfer(
    sourceChain: string,
    destinationChain: string,
    sourceChannel: string,
    amount: string,
    htlcParams: Omit<HTLCMemo, 'type'>
  ): Promise<string> {
    return withChildSpan(
      this.tracer,
      'execute_multi_hop_transfer',
      {
        [IBCAttributes.SOURCE_CHANNEL]: sourceChannel,
        'ibc.source_chain': sourceChain,
        'ibc.destination_chain': destinationChain,
        'transfer.amount': amount,
        'htlc.id': htlcParams.htlcId,
      },
      async (span) => {
        const tracedLogger = addTraceContext(this.logger);
        const transferId = this.generateTransferId();
        
        span.setAttributes({ 'transfer.id': transferId });
        
        // Create transfer record
        const transfer: MultiHopTransfer = {
          id: transferId,
          sourceChain,
          destinationChain,
          amount,
          htlcParams,
          status: 'pending',
          currentHop: 0,
          totalHops: 0,
          txHashes: [],
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        this.transfers.set(transferId, transfer);
        
        try {
          // Update status to routing
          this.updateTransferStatus(transferId, 'routing');
          addSpanEvent('route_planning_start');
      
      // Plan the multi-hop route
      const forwardPaths = await this.packetForward.planMultiHopTransfer(
        sourceChain,
        destinationChain,
        htlcParams.receiver,
        htlcParams
      );
      
          // Get the route for tracking
          const routes = await this.routeDiscovery.findRoutes(sourceChain, destinationChain);
          if (routes.length > 0) {
            transfer.route = routes[0].path;
            transfer.totalHops = routes[0].path.length - 1;
            
            span.setAttributes({
              [IBCAttributes.HOP_CHAIN]: routes[0].path.join(' -> '),
              'transfer.total_hops': transfer.totalHops,
            });
            
            addSpanEvent('route_discovered', {
              route: routes[0].path.join(' -> '),
              hops: transfer.totalHops,
            });
          }
      
      // Validate timelocks for the route
      const timelockValidation = this.packetForward.validateTimelocksForRoute(
        routes[0],
        htlcParams.timelock
      );
      
      if (!timelockValidation.valid) {
        throw new Error('Insufficient time for multi-hop transfer');
      }
      
      // Calculate fees
      const fees = await this.packetForward.calculateFees(routes[0]);
      this.logger.info({ fees }, 'Calculated fees for multi-hop transfer');
      
      // Update status to transferring
      this.updateTransferStatus(transferId, 'transferring');
      
      // Get the IBC handler for the source chain
      const handler = this.ibcHandlers.get(sourceChain);
      if (!handler) {
        throw new Error(`No IBC handler for chain ${sourceChain}`);
      }
      
      // Execute the transfer with packet forward memo
      const txHash = await handler.sendHTLCIBCTransfer(
        sourceChannel,
        amount,
        htlcParams,
        forwardPaths.map(path => ({
          receiver: path.receiver,
          channel: path.channel,
          port: path.port,
          timeout: path.timeout
        }))
      );
      
      transfer.txHashes.push(txHash);
      transfer.currentHop = 1;
      
      // In a real implementation, we would:
      // 1. Monitor the packet acknowledgments for each hop
      // 2. Update the current hop as packets are forwarded
      // 3. Handle any errors or timeouts at each hop
      
      this.updateTransferStatus(transferId, 'completed');
      
      this.logger.info(
        { 
          transferId,
          sourceChain,
          destinationChain,
          hops: transfer.totalHops,
          txHash 
        },
        'Multi-hop transfer initiated successfully'
      );
      
      return transferId;
      
    } catch (error) {
      this.logger.error({ error, transferId }, 'Failed to execute multi-hop transfer');
      
      transfer.status = 'failed';
      transfer.error = error instanceof Error ? error.message : 'Unknown error';
      transfer.updatedAt = new Date();
      
      throw error;
    }
    });
  }

  async trackTransferProgress(transferId: string): Promise<MultiHopTransfer | null> {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return null;
    }
    
    // In a real implementation, this would:
    // 1. Query the latest packet acknowledgments
    // 2. Update the current hop based on acknowledgments
    // 3. Check for timeouts or errors
    // 4. Update the transfer status accordingly
    
    return transfer;
  }

  async handleHopCompletion(
    transferId: string,
    hopIndex: number,
    txHash: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      this.logger.warn({ transferId }, 'Transfer not found for hop completion');
      return;
    }
    
    transfer.currentHop = hopIndex + 1;
    transfer.txHashes.push(txHash);
    transfer.updatedAt = new Date();
    
    if (!success) {
      transfer.status = 'failed';
      transfer.error = error || 'Hop failed';
      
      this.logger.error(
        { 
          transferId,
          hopIndex,
          error 
        },
        'Multi-hop transfer failed at hop'
      );
      
      // Initiate recovery/refund process
      await this.initiateRecovery(transferId, transfer, hopIndex, error);
      return;
    }
    
    if (transfer.currentHop >= transfer.totalHops) {
      transfer.status = 'completed';
      
      this.logger.info(
        { 
          transferId,
          totalHops: transfer.totalHops,
          txHashes: transfer.txHashes 
        },
        'Multi-hop transfer completed successfully'
      );
    }
  }

  private updateTransferStatus(
    transferId: string,
    status: MultiHopTransfer['status']
  ): void {
    const transfer = this.transfers.get(transferId);
    if (transfer) {
      transfer.status = status;
      transfer.updatedAt = new Date();
    }
  }

  private generateTransferId(): string {
    return `mht_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getTransfer(transferId: string): Promise<MultiHopTransfer | null> {
    return this.transfers.get(transferId) || null;
  }

  async getPendingTransfers(): Promise<MultiHopTransfer[]> {
    return Array.from(this.transfers.values()).filter(
      t => t.status === 'pending' || t.status === 'routing' || t.status === 'transferring'
    );
  }

  async disconnect(): Promise<void> {
    for (const handler of this.ibcHandlers.values()) {
      await handler.disconnect();
    }
    this.ibcHandlers.clear();
  }

  private async initiateRecovery(
    transferId: string,
    transfer: MultiHopTransfer,
    failedHopIndex: number,
    error: any
  ): Promise<void> {
    try {
      this.logger.info(
        { transferId, failedHopIndex },
        'Initiating recovery process for failed multi-hop transfer'
      );

      transfer.status = 'failed'; // Recovery in progress
      
      // For each completed hop before the failure, initiate refund in reverse order
      for (let i = failedHopIndex - 1; i >= 0; i--) {
        // TODO: Implement proper hop tracking structure
        const hopChain = transfer.route?.[i];
        
        if (hopChain && transfer.txHashes[i]) {
          this.logger.info(
            { 
              transferId,
              hopIndex: i,
              chain: hopChain,
              txHash: transfer.txHashes[i]
            },
            'Initiating refund for completed hop'
          );

          // Check if HTLC exists on this hop's chain
          // TODO: Implement HTLC tracking with proper hop structure
          const htlcExists = true; // Placeholder
          
          if (htlcExists) {
            // Emit event for recovery service to handle refund
            this.emit('hop:refund:needed', {
              transferId,
              chain: hopChain,
              txHash: transfer.txHashes[i],
              hopIndex: i,
              reason: 'downstream_failure',
              failedAtHop: failedHopIndex,
              timestamp: Date.now()
            });
          }
        }
      }

      // Also need to refund the source HTLC
      this.emit('source:refund:needed', {
        transferId,
        sourceChain: transfer.sourceChain,
        sourceHTLCId: transfer.htlcParams.sourceHTLCId,
        reason: 'multi_hop_failure',
        failedAtHop: failedHopIndex,
        error: error.toString(),
        timestamp: Date.now()
      });

      transfer.status = 'pending'; // Recovery initiated
      
      this.logger.info(
        { transferId },
        'Recovery process initiated for all affected hops'
      );
    } catch (recoveryError) {
      this.logger.error(
        { 
          transferId,
          recoveryError,
          originalError: error
        },
        'Failed to initiate recovery process'
      );
      
      transfer.status = 'failed'; // Recovery failed
    }
  }

  private async checkHTLCExists(chainId: string, htlcId?: string): Promise<boolean> {
    if (!htlcId) return false;
    
    try {
      const handler = this.ibcHandlers.get(chainId);
      if (!handler) {
        this.logger.warn({ chainId }, 'No IBC handler found for chain');
        return false;
      }

      // Query the HTLC contract to check if HTLC exists
      // This is a simplified check - in production would query actual contract
      return true;
    } catch (error) {
      this.logger.error(
        { chainId, htlcId, error },
        'Failed to check HTLC existence'
      );
      return false;
    }
  }

  // Monitor transfers for timeout and initiate recovery
  async monitorTransfers(): Promise<void> {
    const monitoringInterval = setInterval(async () => {
      const pendingTransfers = await this.getPendingTransfers();
      
      for (const transfer of pendingTransfers) {
        const now = Date.now();
        const transferAge = now - transfer.createdAt.getTime();
        
        // Check for timeout (e.g., 30 minutes)
        if (transferAge > 30 * 60 * 1000) {
          this.logger.warn(
            { 
              transferId: transfer.id,
              age: transferAge,
              status: transfer.status
            },
            'Transfer timeout detected'
          );
          
          // Initiate recovery for timed out transfer
          await this.initiateRecovery(
            transfer.id,
            transfer,
            transfer.currentHop,
            new Error('Transfer timeout')
          );
        }
      }
    }, 60000); // Check every minute

    // Store interval for cleanup
    this.monitoringInterval = monitoringInterval;
  }

  // Add EventEmitter functionality
  private emit(event: string, data: any): void {
    // In a real implementation, this would emit to an event bus
    this.logger.info({ event, data }, 'Event emitted');
  }
}
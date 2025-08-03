/**
 * OpenTelemetry Distributed Tracing Example
 * 
 * This example demonstrates how the 1inch Fusion+ Cosmos Extension uses
 * OpenTelemetry for distributed tracing across cross-chain swap flows.
 */

import { initializeTracing, getTracingConfig } from '../../relayer/src/tracing/tracer';
import { getTracer, withSpan, SwapAttributes, IBCAttributes, addSpanEvent } from '../../relayer/src/tracing/instrumentation';
import { createLogger } from '../../relayer/src/utils/logger';
import { context, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

// Simulate a cross-chain swap flow
async function simulateCrossChainSwap() {
  const logger = createLogger({ level: 'info' });
  
  // Initialize tracing
  const tracingConfig = getTracingConfig();
  initializeTracing(tracingConfig, logger);
  
  const tracer = getTracer('example-app');
  
  // Start root span for entire swap flow
  await withSpan(
    tracer,
    'cross_chain_swap_flow',
    {
      [SwapAttributes.SOURCE_CHAIN]: 'ethereum',
      [SwapAttributes.TARGET_CHAIN]: 'osmosis',
      [SwapAttributes.AMOUNT]: '1000.0',
      [SwapAttributes.TOKEN]: 'USDC',
      [SwapAttributes.SENDER]: '0x1234...abcd',
      [SwapAttributes.RECEIVER]: 'osmo1xyz...def',
    },
    async (rootSpan) => {
      logger.info('Starting cross-chain swap flow');
      
      // Phase 1: Ethereum HTLC Creation
      await withSpan(
        tracer,
        'ethereum_htlc_creation',
        {
          'htlc.chain': 'ethereum',
          'htlc.type': 'create',
          'htlc.id': 'htlc_12345',
        },
        async (htlcSpan) => {
          addSpanEvent('htlc_parameters_validated');
          await simulateDelay(500); // Simulate blockchain interaction
          
          htlcSpan.setAttributes({
            'htlc.tx_hash': '0xabc123...',
            'htlc.block_number': 18500000,
          });
          
          addSpanEvent('htlc_created_on_chain');
          logger.info('Ethereum HTLC created');
        },
        { kind: SpanKind.CLIENT }
      );
      
      // Phase 2: Route Discovery
      const route = await withSpan(
        tracer,
        'route_discovery',
        {
          'route.source': 'ethereum',
          'route.destination': 'osmosis',
        },
        async (routeSpan) => {
          addSpanEvent('querying_chain_registry');
          await simulateDelay(200);
          
          const discoveredRoute = ['ethereum', 'cosmoshub', 'osmosis'];
          
          routeSpan.setAttributes({
            'route.path': discoveredRoute.join(' -> '),
            'route.hops': discoveredRoute.length - 1,
            'route.estimated_time': 120, // seconds
          });
          
          addSpanEvent('optimal_route_found', {
            hops: discoveredRoute.length - 1,
          });
          
          return discoveredRoute;
        }
      );
      
      // Phase 3: Multi-hop IBC Transfer
      await withSpan(
        tracer,
        'multi_hop_ibc_transfer',
        {
          [IBCAttributes.SOURCE_CHANNEL]: 'channel-0',
          'ibc.hops': route.length - 1,
        },
        async (ibcSpan) => {
          // Simulate each hop
          for (let i = 0; i < route.length - 1; i++) {
            const hopSpan = tracer.startSpan(`ibc_hop_${i}`, {
              kind: SpanKind.CLIENT,
              attributes: {
                [IBCAttributes.HOP_INDEX]: i,
                [IBCAttributes.HOP_CHAIN]: route[i + 1],
                'hop.source': route[i],
                'hop.destination': route[i + 1],
              },
            });
            
            context.with(trace.setSpan(context.active(), hopSpan), async () => {
              addSpanEvent('packet_sent');
              await simulateDelay(1000); // Simulate IBC relay time
              
              hopSpan.setAttributes({
                [IBCAttributes.PACKET_SEQUENCE]: 1000 + i,
                'hop.tx_hash': `cosmos_tx_${i}`,
              });
              
              addSpanEvent('packet_acknowledged');
            });
            
            hopSpan.end();
          }
          
          ibcSpan.setAttributes({
            'ibc.total_duration': 2.5,
            'ibc.success': true,
          });
        }
      );
      
      // Phase 4: DEX Swap on Osmosis
      await withSpan(
        tracer,
        'osmosis_dex_swap',
        {
          'dex.chain': 'osmosis',
          'dex.pool_id': '1',
          'dex.token_in': 'USDC',
          'dex.token_out': 'OSMO',
        },
        async (dexSpan) => {
          addSpanEvent('estimating_swap_output');
          await simulateDelay(100);
          
          dexSpan.setAttributes({
            'dex.estimated_output': '950.5',
            'dex.price_impact': '0.05%',
            'dex.fee': '0.3%',
          });
          
          addSpanEvent('executing_swap');
          await simulateDelay(500);
          
          dexSpan.setAttributes({
            'dex.actual_output': '951.2',
            'dex.tx_hash': 'osmo_tx_swap_123',
          });
          
          addSpanEvent('swap_completed');
        }
      );
      
      // Phase 5: Settlement and Secret Reveal
      await withSpan(
        tracer,
        'settlement_and_reveal',
        {
          'settlement.chain': 'osmosis',
        },
        async (settlementSpan) => {
          addSpanEvent('revealing_htlc_secret');
          await simulateDelay(300);
          
          settlementSpan.setAttributes({
            'settlement.secret': '0xsecret123...',
            'settlement.revealed_at': new Date().toISOString(),
          });
          
          // Propagate secret back through hops
          for (let i = route.length - 2; i >= 0; i--) {
            addSpanEvent(`secret_propagated_to_${route[i]}`);
            await simulateDelay(500);
          }
          
          addSpanEvent('all_htlcs_unlocked');
        }
      );
      
      // Final status
      rootSpan.setAttributes({
        [SwapAttributes.STATUS]: 'completed',
        'swap.final_amount': '951.2',
        'swap.total_duration': 5.6,
      });
      
      logger.info('Cross-chain swap completed successfully');
    },
    { kind: SpanKind.SERVER }
  );
}

// Example: Error handling with spans
async function simulateFailedSwap() {
  const tracer = getTracer('example-app');
  
  try {
    await withSpan(
      tracer,
      'failed_swap_example',
      {
        [SwapAttributes.SOURCE_CHAIN]: 'ethereum',
        [SwapAttributes.TARGET_CHAIN]: 'juno',
      },
      async (span) => {
        addSpanEvent('swap_initiated');
        
        // Simulate an error during IBC transfer
        await simulateDelay(1000);
        
        throw new Error('IBC channel congested - timeout reached');
      }
    );
  } catch (error) {
    console.error('Swap failed:', error);
    // The span will automatically be marked as error with the exception recorded
  }
}

// Example: Correlating traces across services
async function correlatedServiceCalls() {
  const tracer = getTracer('example-app');
  
  await withSpan(
    tracer,
    'main_service_operation',
    {},
    async (mainSpan) => {
      // Get current trace context
      const currentContext = context.active();
      const spanContext = mainSpan.spanContext();
      
      // Simulate calling another service with trace context
      const headers = {
        'traceparent': `00-${spanContext.traceId}-${spanContext.spanId}-01`,
      };
      
      console.log('Trace context headers:', headers);
      
      // In a real scenario, these headers would be sent to another service
      // The receiving service would extract the context and continue the trace
    }
  );
}

// Example: Custom span processors for enhanced monitoring
function setupCustomProcessing() {
  // In production, you might want to:
  // 1. Add custom span processors for filtering sensitive data
  // 2. Implement sampling strategies based on swap value or chain
  // 3. Add span enrichment with business metrics
  // 4. Set up real-time alerting on specific span patterns
  
  console.log('Custom span processing can be configured in tracer.ts');
}

// Utility function to simulate async delays
function simulateDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Example: Querying traces (would be done in Jaeger/monitoring system)
function exampleTraceQueries() {
  console.log('\nExample Jaeger queries for monitoring:');
  console.log('1. Failed swaps: service="1inch-fusion-relayer" error=true');
  console.log('2. Slow swaps: service="1inch-fusion-relayer" duration>10s');
  console.log('3. Multi-hop routes: service="1inch-fusion-relayer" ibc.hops>2');
  console.log('4. Specific chain issues: service="1inch-fusion-relayer" swap.target_chain="osmosis" error=true');
  console.log('5. High-value swaps: service="1inch-fusion-relayer" swap.amount>10000');
}

// Main execution
async function main() {
  console.log('OpenTelemetry Distributed Tracing Example\n');
  
  console.log('1. Simulating successful cross-chain swap...');
  await simulateCrossChainSwap();
  
  console.log('\n2. Simulating failed swap...');
  await simulateFailedSwap();
  
  console.log('\n3. Demonstrating trace correlation...');
  await correlatedServiceCalls();
  
  console.log('\n4. Custom processing options...');
  setupCustomProcessing();
  
  console.log('\n5. Example trace queries...');
  exampleTraceQueries();
  
  console.log('\nTracing example completed!');
  console.log('View traces at: http://localhost:16686 (Jaeger UI)');
  
  // Shutdown tracing
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

// Run the example
main().catch(error => {
  console.error('Example failed:', error);
  process.exit(1);
});
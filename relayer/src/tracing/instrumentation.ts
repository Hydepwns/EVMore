import { 
  trace, 
  context, 
  SpanStatusCode, 
  Span, 
  SpanKind,
  SpanAttributes,
  Context,
  propagation
} from '@opentelemetry/api';
import { Logger } from 'pino';

// Semantic attribute names for cross-chain operations
export const SwapAttributes = {
  SOURCE_CHAIN: 'swap.source_chain',
  TARGET_CHAIN: 'swap.target_chain',
  HTLC_ID: 'swap.htlc_id',
  AMOUNT: 'swap.amount',
  TOKEN: 'swap.token',
  SENDER: 'swap.sender',
  RECEIVER: 'swap.receiver',
  TIMELOCK: 'swap.timelock',
  HASHLOCK: 'swap.hashlock',
  STATUS: 'swap.status',
  HOPS: 'swap.hops',
  ROUTE: 'swap.route',
} as const;

export const HTLCAttributes = {
  CHAIN: 'htlc.chain',
  TYPE: 'htlc.type',
  ID: 'htlc.id',
  STATE: 'htlc.state',
  SECRET: 'htlc.secret',
  BLOCK_NUMBER: 'htlc.block_number',
  TX_HASH: 'htlc.tx_hash',
} as const;

export const IBCAttributes = {
  SOURCE_CHANNEL: 'ibc.source_channel',
  DEST_CHANNEL: 'ibc.dest_channel',
  PACKET_SEQUENCE: 'ibc.packet_sequence',
  TIMEOUT_HEIGHT: 'ibc.timeout_height',
  TIMEOUT_TIMESTAMP: 'ibc.timeout_timestamp',
  HOP_INDEX: 'ibc.hop_index',
  HOP_CHAIN: 'ibc.hop_chain',
} as const;

export const RecoveryAttributes = {
  OPERATION: 'recovery.operation',
  CHAIN: 'recovery.chain',
  ATTEMPT: 'recovery.attempt',
  ERROR_TYPE: 'recovery.error_type',
  DURATION: 'recovery.duration',
} as const;

/**
 * Get or create a tracer for a component
 */
export function getTracer(name: string, version?: string) {
  return trace.getTracer(name, version || '1.0.0');
}

/**
 * Add trace context to logger
 */
export function addTraceContext(logger: Logger): Logger {
  const span = trace.getActiveSpan();
  if (!span) return logger;

  const spanContext = span.spanContext();
  return logger.child({
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  });
}

/**
 * Create a span with automatic error handling and status setting
 */
export async function withSpan<T>(
  tracer: ReturnType<typeof getTracer>,
  spanName: string,
  attributes: SpanAttributes,
  fn: (span: Span) => Promise<T>,
  options?: {
    kind?: SpanKind;
    parentContext?: Context;
  }
): Promise<T> {
  const span = tracer.startSpan(spanName, {
    kind: options?.kind || SpanKind.INTERNAL,
    attributes,
  }, options?.parentContext);

  try {
    const result = await context.with(
      trace.setSpan(options?.parentContext || context.active(), span),
      () => fn(span)
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Create a child span within the current context
 */
export async function withChildSpan<T>(
  tracer: ReturnType<typeof getTracer>,
  spanName: string,
  attributes: SpanAttributes,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return withSpan(tracer, spanName, attributes, fn, {
    parentContext: context.active(),
  });
}

/**
 * Add event to current span
 */
export function addSpanEvent(name: string, attributes?: SpanAttributes): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Update span attributes
 */
export function updateSpanAttributes(attributes: SpanAttributes): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Extract trace context from HTTP headers
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): Context {
  return propagation.extract(context.active(), headers);
}

/**
 * Inject trace context into HTTP headers
 */
export function injectTraceContext(headers: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), headers);
  return headers;
}

/**
 * Create a span link for cross-chain correlation
 */
export function createSpanLink(traceId: string, spanId: string, attributes?: SpanAttributes) {
  return {
    context: {
      traceId,
      spanId,
      traceFlags: 1,
      isRemote: true,
    },
    attributes: attributes || {},
  };
}

/**
 * Helper to track cross-chain operation timing
 */
export class CrossChainTimer {
  private startTime: number;
  private checkpoints: Map<string, number> = new Map();

  constructor() {
    this.startTime = Date.now();
  }

  checkpoint(name: string): void {
    this.checkpoints.set(name, Date.now());
    addSpanEvent(`checkpoint.${name}`, {
      'checkpoint.elapsed_ms': Date.now() - this.startTime,
    });
  }

  getDuration(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  getCheckpointDuration(name: string): number | null {
    const time = this.checkpoints.get(name);
    if (!time) return null;
    return (time - this.startTime) / 1000;
  }
}
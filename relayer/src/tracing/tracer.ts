import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
// import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http'; // Disabled due to version conflicts
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerPropagator } from '@opentelemetry/propagator-jaeger';
import { B3Propagator, B3InjectEncoding } from '@opentelemetry/propagator-b3';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { CompositePropagator } from '@opentelemetry/core';
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { Logger } from 'pino';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

export interface TracingConfig {
  serviceName: string;
  environment: string;
  version: string;
  jaegerEndpoint?: string;
  otlpEndpoint?: string;
  enableConsoleExporter?: boolean;
  samplingRatio?: number;
}

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry tracing for the relayer service
 */
export function initializeTracing(config: TracingConfig, logger: Logger): NodeSDK {
  // Enable OpenTelemetry diagnostics in development
  if (config.environment === 'development') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  logger.info({ config }, 'Initializing OpenTelemetry tracing');

  // Create resource with service information
  const resourceAttributes = {
    [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: config.version,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment,
    [SemanticResourceAttributes.SERVICE_NAMESPACE]: '1inch-fusion-cosmos',
  };

  // Configure exporters
  const spanProcessors = [];

  // Jaeger exporter (default)
  if (config.jaegerEndpoint) {
    const jaegerExporter = new JaegerExporter({
      endpoint: config.jaegerEndpoint,
    });
    spanProcessors.push(new BatchSpanProcessor(jaegerExporter));
    logger.info({ endpoint: config.jaegerEndpoint }, 'Jaeger exporter configured');
  }

  // OTLP exporter disabled due to version compatibility issues
  if (config.otlpEndpoint) {
    logger.warn({ endpoint: config.otlpEndpoint }, 'OTLP exporter disabled due to version conflicts - using Jaeger instead');
  }

  // Console exporter for development
  if (config.enableConsoleExporter) {
    spanProcessors.push(new BatchSpanProcessor(new ConsoleSpanExporter()));
    logger.info('Console span exporter enabled');
  }

  // Configure propagators for cross-service context propagation
  const propagator = new CompositePropagator({
    propagators: [
      new W3CTraceContextPropagator(),
      new JaegerPropagator(),
      new B3Propagator({ injectEncoding: B3InjectEncoding.MULTI_HEADER }),
    ],
  });

  // Initialize the SDK
  sdk = new NodeSDK({
    resource: resourceAttributes as any, // Use attributes directly
    spanProcessors,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false, // Disable fs instrumentation to reduce noise
        },
        '@opentelemetry/instrumentation-dns': {
          enabled: false, // Disable DNS instrumentation
        },
      }),
    ],
    textMapPropagator: propagator,
  });

  // Start the SDK
  sdk.start();

  logger.info('OpenTelemetry tracing initialized successfully');

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk?.shutdown()
      .then(() => logger.info('Tracing terminated'))
      .catch((error) => logger.error({ error }, 'Error terminating tracing'))
      .finally(() => process.exit(0));
  });

  return sdk;
}

/**
 * Shutdown tracing gracefully
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

/**
 * Get default tracing configuration based on environment
 */
export function getTracingConfig(): TracingConfig {
  const environment = process.env.NODE_ENV || 'development';
  const version = process.env.SERVICE_VERSION || '1.0.0';

  return {
    serviceName: '1inch-fusion-relayer',
    environment,
    version,
    jaegerEndpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    enableConsoleExporter: environment === 'development',
    samplingRatio: environment === 'production' ? 0.1 : 1.0, // 10% sampling in production
  };
}
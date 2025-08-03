/**
 * Relayer entry point using @evmore libraries
 * This is the new entry point that uses the migrated architecture
 */

import 'dotenv/config';
import { createRelayerContainer, initializeServices, shutdownServices } from './container/setup';
import { CORE_TOKENS, ServiceContainer } from '@evmore/interfaces';
import { RELAYER_TOKENS } from './container/service-tokens';
// import { setupMetricsServer } from './monitoring/prometheus-metrics'; // Note: metrics implementation pending
import { initializeTracing } from './tracing/tracer';
import express from 'express';
import { Logger } from 'pino';

let container: ServiceContainer | null = null;
let metricsServer: any = null;
let apiServer: any = null;

// Setup tracing function
async function setupTracing(config: any): Promise<void> {
  // Implementation would go here
  console.log('Tracing setup:', config);
}

// Setup metrics server function
async function setupMetricsServer(port: number): Promise<any> {
  // Implementation would go here
  console.log('Metrics server setup on port:', port);
  return { port };
}

/**
 * Start the relayer service
 */
async function start() {
  try {
    // Create DI container
    container = await createRelayerContainer();
    const logger = container.get<Logger>(CORE_TOKENS.Logger);
    const config = container.get(CORE_TOKENS.Config);
    
    logger.info('Starting 1inch Fusion+ Cosmos Relayer with new architecture...');
    
    // Setup observability
    if (config.monitoring.tracing.enabled) {
      await setupTracing(config.monitoring.tracing);
      logger.info('Tracing initialized');
    }
    
    if (config.monitoring.metrics.enabled) {
      metricsServer = await setupMetricsServer(config.monitoring.metrics.port);
      logger.info(`Metrics server listening on port ${config.monitoring.metrics.port}`);
    }
    
    // Initialize all services
    await initializeServices(container);
    
    // Setup API server
    apiServer = await setupApiServer(container);
    
    // Setup event handlers
    setupEventHandlers(container);
    
    // Setup graceful shutdown
    setupGracefulShutdown();
    
    logger.info('Relayer started successfully');
  } catch (error) {
    console.error('Failed to start relayer:', error);
    process.exit(1);
  }
}

/**
 * Setup API server for admin endpoints
 */
async function setupApiServer(container: ServiceContainer): Promise<any> {
  const logger = container.get<Logger>(CORE_TOKENS.Logger);
  const config = container.get(CORE_TOKENS.Config);
  const relayService = container.get(RELAYER_TOKENS.RelayService);
  
  const app = express();
  app.use(express.json());
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0'
    });
  });
  
  // Metrics endpoint (if metrics not on separate server)
  if (!config.monitoring.metrics.enabled) {
    app.get('/metrics', async (req, res) => {
      const metrics = relayService.getMetrics();
      res.json(metrics);
    });
  }
  
  // Admin endpoints
  app.get('/admin/status', (req, res) => {
    const metrics = relayService.getMetrics();
    res.json({
      status: 'running',
      metrics,
      config: {
        environment: config.environment.name,
        features: config.features
      }
    });
  });
  
  app.post('/admin/cleanup', (req, res) => {
    relayService.cleanupRelays();
    res.json({ message: 'Cleanup initiated' });
  });
  
  // Start server
  const port = process.env.API_PORT || 3000;
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      logger.info(`API server listening on port ${port}`);
      resolve(server);
    });
  });
}

/**
 * Setup event handlers for monitors
 */
function setupEventHandlers(container: ServiceContainer) {
  const logger = container.get<Logger>(CORE_TOKENS.Logger);
  const relayService = container.get(RELAYER_TOKENS.RelayService);
  const ethereumMonitor = container.get(RELAYER_TOKENS.EthereumMonitor);
  const cosmosMonitor = container.get(RELAYER_TOKENS.CosmosMonitor);
  
  // Handle Ethereum HTLC events
  ethereumMonitor.on('htlc:created', async (event) => {
    try {
      await relayService.handleEthereumHTLC(event);
    } catch (error) {
      logger.error({ error, event }, 'Failed to handle Ethereum HTLC event');
    }
  });
  
  // Handle Cosmos HTLC events
  cosmosMonitor.on('htlc:created', async (event) => {
    try {
      await relayService.handleCosmosHTLC(event);
    } catch (error) {
      logger.error({ error, event }, 'Failed to handle Cosmos HTLC event');
    }
  });
  
  // Handle monitor errors
  ethereumMonitor.on('error', (error) => {
    logger.error({ error }, 'Ethereum monitor error');
  });
  
  cosmosMonitor.on('error', (error) => {
    logger.error({ error }, 'Cosmos monitor error');
  });
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown() {
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      await shutdown();
    });
  });
  
  // Handle uncaught errors
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await shutdown(1);
  });
  
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    await shutdown(1);
  });
}

/**
 * Shutdown the relayer gracefully
 */
async function shutdown(exitCode: number = 0) {
  if (!container) {
    process.exit(exitCode);
    return;
  }
  
  const logger = container.get<Logger>(CORE_TOKENS.Logger);
  logger.info('Shutting down relayer...');
  
  try {
    // Shutdown API server
    if (apiServer) {
      await new Promise<void>((resolve) => {
        apiServer.close(() => resolve());
      });
      logger.info('API server shut down');
    }
    
    // Shutdown metrics server
    if (metricsServer) {
      await new Promise<void>((resolve) => {
        metricsServer.close(() => resolve());
      });
      logger.info('Metrics server shut down');
    }
    
    // Shutdown all services
    await shutdownServices(container);
    
    logger.info('Relayer shut down successfully');
    process.exit(exitCode);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start the relayer
start().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
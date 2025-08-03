/**
 * Complete Connection Pool Integration Example
 * Demonstrates production setup with monitoring, health checks, and failover
 */

import { Logger } from 'pino';
import { ConnectionPoolManager } from '../../shared/connection-pool/pool-manager';
import { PooledEthereumMonitor } from '../../relayer/src/monitor/ethereum-monitor-pooled';
import { PooledEthereumHTLCClient } from '../../sdk/src/client/ethereum-htlc-client-pooled';
import { initializeDefaultMetricsCollector, connectionPoolMetrics } from '../../shared/connection-pool/metrics';
import { createPoolConfigFromEnv } from '../../shared/connection-pool/config-examples';
import express from 'express';

async function setupProductionConnectionPools() {
  // Initialize logger
  const logger = Logger({
    level: 'info',
    formatters: {
      level: (label) => {
        return { level: label };
      }
    }
  });

  // Initialize metrics collector
  const metricsCollector = initializeDefaultMetricsCollector(logger, 30000);

  // Create pool configuration from environment
  const poolConfig = createPoolConfigFromEnv();
  
  // Initialize connection pool manager
  const poolManager = new ConnectionPoolManager(poolConfig, logger);

  // Set up event handlers for metrics
  poolManager.on('pool_event', (event) => {
    metricsCollector.handlePoolEvent(event);
  });

  poolManager.on('stats', (stats) => {
    logger.info(stats, 'Connection pool statistics');
    
    // Alert on unhealthy pools
    if (stats.unhealthyPools.length > 0) {
      logger.warn({ unhealthyPools: stats.unhealthyPools }, 'ALERT: Unhealthy connection pools detected');
      // Here you would integrate with your alerting system
    }
    
    if (stats.circuitBreakersPopen.length > 0) {
      logger.error({ circuitBreakers: stats.circuitBreakersPopen }, 'ALERT: Circuit breakers open');
    }
  });

  // Start the pool manager
  await poolManager.start();

  // Start metrics collection
  metricsCollector.startCollection(() => {
    const stats = poolManager.getStats();
    return stats.pools;
  });

  return { poolManager, metricsCollector, logger };
}

async function demonstrateEthereumIntegration(poolManager: ConnectionPoolManager, logger: Logger) {
  logger.info('Setting up Ethereum integration...');

  // Get Ethereum connection pool
  const ethereumPool = poolManager.getEthereumPool('mainnet');
  if (!ethereumPool) {
    throw new Error('Ethereum mainnet pool not found');
  }

  // Initialize HTLC client with connection pool
  const htlcClient = new PooledEthereumHTLCClient(
    ethereumPool,
    {
      htlcContract: '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e', // Example address
      chainId: 1,
      gasPrice: '20', // 20 gwei
      gasLimit: 300000
    },
    {
      retries: 3,
      retryDelay: 1000,
      gasMultiplier: 1.2,
      confirmations: 2
    }
  );

  // Initialize monitor with connection pool
  const monitor = new PooledEthereumMonitor(
    ethereumPool,
    '0x742d35Cc6634C0532925a3b8D91c8c99096ba34e', // HTLC contract address
    logger
  );

  // Set up event handlers
  monitor.onHTLCCreated(async (event) => {
    logger.info({
      htlcId: event.htlcId,
      sender: event.sender,
      targetChain: event.targetChain,
      amount: event.amount.toString()
    }, 'HTLC created event received');

    // Process the event (e.g., initiate cross-chain transfer)
    // This is where you'd integrate with your cross-chain logic
  });

  monitor.onHTLCWithdrawn(async (event) => {
    logger.info({
      htlcId: event.htlcId,
      secret: event.secret
    }, 'HTLC withdrawn event received');
  });

  monitor.onHTLCRefunded(async (event) => {
    logger.info({
      htlcId: event.htlcId
    }, 'HTLC refunded event received');
  });

  // Start monitoring
  await monitor.start();

  return { htlcClient, monitor };
}

async function demonstrateCosmosIntegration(poolManager: ConnectionPoolManager, logger: Logger) {
  logger.info('Setting up Cosmos integration...');

  // Example: Query Osmosis pool information
  try {
    const result = await poolManager.withCosmosQueryClient('osmosis-1', async (client) => {
      const height = await client.getHeight();
      const chainId = await client.getChainId();
      
      return { height, chainId };
    });

    logger.info(result, 'Osmosis chain info');

  } catch (error) {
    logger.error({ error }, 'Failed to query Cosmos chain');
  }

  // Example: Execute transaction with signing client
  // This would require a wallet/mnemonic
  /*
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
    "your mnemonic here",
    { prefix: "osmo" }
  );

  const txResult = await poolManager.withCosmosSigningClient(
    'osmosis-1',
    wallet,
    async (client) => {
      // Execute your transaction here
      return client.sendTokens(sender, recipient, amount, fee);
    }
  );
  */
}

async function setupMetricsEndpoint(metricsCollector: any, logger: Logger) {
  const app = express();

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  });

  // Metrics endpoint for Prometheus
  app.get('/metrics', async (req, res) => {
    try {
      const metrics = await metricsCollector.getMetrics();
      res.set('Content-Type', 'text/plain');
      res.end(metrics);
    } catch (error) {
      logger.error({ error }, 'Error serving metrics');
      res.status(500).json({ error: 'Failed to get metrics' });
    }
  });

  // Pool stats endpoint
  app.get('/pool-stats', (req, res) => {
    // This would need access to pool manager
    res.json({
      message: 'Pool stats would be available here',
      timestamp: new Date().toISOString()
    });
  });

  const port = process.env.METRICS_PORT || 3001;
  const server = app.listen(port, () => {
    logger.info({ port }, 'Metrics server started');
  });

  return server;
}

async function gracefulShutdown(
  poolManager: ConnectionPoolManager,
  metricsCollector: any,
  server: any,
  logger: Logger
) {
  logger.info('Starting graceful shutdown...');

  // Stop accepting new connections
  server.close();

  // Stop metrics collection
  metricsCollector.stopCollection();

  // Stop connection pools
  await poolManager.stop();

  logger.info('Graceful shutdown completed');
  process.exit(0);
}

// Main execution
async function main() {
  try {
    // Setup connection pools
    const { poolManager, metricsCollector, logger } = await setupProductionConnectionPools();

    // Setup Ethereum integration
    const { htlcClient, monitor } = await demonstrateEthereumIntegration(poolManager, logger);

    // Setup Cosmos integration
    await demonstrateCosmosIntegration(poolManager, logger);

    // Setup metrics endpoint
    const server = await setupMetricsEndpoint(metricsCollector, logger);

    // Example usage of the HTLC client
    logger.info('Connection pools are ready for use');

    // Example: Get token information
    try {
      const tokenInfo = await htlcClient.getTokenInfo('0xA0b86a33E6c09c4a69f96CC28dE4c92A8c59e4d5'); // Example USDC
      logger.info(tokenInfo, 'Token information retrieved');
    } catch (error) {
      logger.warn({ error }, 'Could not fetch token info (expected in example)');
    }

    // Example: Check pool stats
    const poolStats = htlcClient.getPoolStats();
    logger.info(poolStats, 'Ethereum pool statistics');

    // Setup graceful shutdown
    process.on('SIGINT', () => gracefulShutdown(poolManager, metricsCollector, server, logger));
    process.on('SIGTERM', () => gracefulShutdown(poolManager, metricsCollector, server, logger));

    logger.info('Application is running. Press Ctrl+C to shutdown gracefully.');

    // Keep the process running
    setInterval(() => {
      const stats = poolManager.getStats();
      logger.debug({
        totalConnections: stats.totalConnections,
        totalRequests: stats.totalRequestsServed,
        avgLatency: stats.averageLatency
      }, 'Pool manager summary');
    }, 60000);

  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Production configuration validation
function validateProductionConfig() {
  const requiredEnvVars = [
    'NODE_ENV',
    'ETHEREUM_RPC_URLS',
    'COSMOS_RPC_URLS'
  ];

  const missing = requiredEnvVars.filter(env => !process.env[env]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (process.env.NODE_ENV === 'production') {
    // Additional production validations
    if (!process.env.METRICS_PORT) {
      console.warn('METRICS_PORT not set, using default 3001');
    }
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  validateProductionConfig();
  main().catch(console.error);
}

export {
  setupProductionConnectionPools,
  demonstrateEthereumIntegration,
  demonstrateCosmosIntegration,
  setupMetricsEndpoint,
  gracefulShutdown
};
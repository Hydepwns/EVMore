/**
 * Enhanced Relayer with Connection Pooling
 * Production-grade initialization with pooled connections
 */

import { config } from 'dotenv';
import express from 'express';
import pino from 'pino';
import { PooledEthereumMonitor } from './monitor/ethereum-monitor-pooled';
import { CosmosMonitor } from './monitor/cosmos-monitor';
import { RelayService } from './relay/relay-service';
import { RouteDiscovery } from './routes/route-discovery';
import { RecoveryService } from './recovery/recovery-service';
import { Config } from './config/index';
import { ChainRegistryClient } from './registry/chain-registry-client';
import { RouterResolutionService } from './registry/router-resolution-service';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { initializeMetrics } from './monitoring/prometheus-metrics';
import { createMetricsServer } from './monitoring/metrics-server';
import { createPersistenceManager } from './persistence/utils';
import { createSecretsManager, createRelayerSecretReferences } from './secrets/utils';
import { DDoSProtectionSystem } from './security/ddos-protection';
import { APIRateLimiter } from './middleware/rate-limiter';
import { SecurityManager } from './security/security-manager';

// Connection Pool imports
import {
  ConnectionPoolManager,
  createPoolConfigFromEnv,
  initializeDefaultMetricsCollector,
  PoolManagerConfig
} from '../../shared/connection-pool';

// Load environment variables
config();

// Initialize logger
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  },
});

/**
 * Create connection pool configuration based on relayer config
 */
function createPoolConfigFromRelayerConfig(relayerConfig: any): PoolManagerConfig {
  // Start with environment-based config
  const baseConfig = createPoolConfigFromEnv();

  // Enhance with relayer-specific settings
  const poolConfig: PoolManagerConfig = {
    ethereum: {},
    cosmos: {},
    monitoring: {
      metricsInterval: 30000,
      healthCheckInterval: 30000,
      logStats: process.env.NODE_ENV !== 'production'
    }
  };

  // Configure Ethereum pools
  const network = relayerConfig.ethereum.chainId === 1 ? 'mainnet' : 
                  relayerConfig.ethereum.chainId === 11155111 ? 'sepolia' : 
                  'localhost';
  
  poolConfig.ethereum![network] = {
    name: `ethereum-${network}`,
    endpoints: [
      {
        url: relayerConfig.ethereum.rpcUrl,
        weight: 1,
        maxConnections: 10,
        timeout: 30000,
        retryAttempts: 3,
        healthCheckInterval: 30000
      }
    ],
    maxConnections: 20,
    minConnections: 3,
    connectionTimeout: 30000,
    idleTimeout: 300000,
    maxRetries: 3,
    healthCheckInterval: 30000,
    retryDelay: 1000,
    circuitBreakerThreshold: 10,
    circuitBreakerTimeout: 120000,
    chainId: relayerConfig.ethereum.chainId,
    throttleLimit: 20,
    throttleSlotInterval: 100
  };

  // Add additional Ethereum endpoints from environment
  if (process.env.ETHEREUM_BACKUP_RPC_URLS) {
    const backupUrls = process.env.ETHEREUM_BACKUP_RPC_URLS.split(',');
    backupUrls.forEach((url, index) => {
      poolConfig.ethereum![network]!.endpoints.push({
        url: url.trim(),
        weight: 1,
        maxConnections: 5,
        timeout: 35000,
        retryAttempts: 3,
        healthCheckInterval: 30000
      });
    });
  }

  // Configure Cosmos pools
  const chainId = relayerConfig.cosmos.chainId;
  poolConfig.cosmos![chainId] = {
    name: `cosmos-${chainId}`,
    endpoints: [
      {
        url: relayerConfig.cosmos.rpcUrl,
        weight: 1,
        maxConnections: 10,
        timeout: 30000,
        retryAttempts: 3,
        healthCheckInterval: 30000
      }
    ],
    maxConnections: 20,
    minConnections: 3,
    connectionTimeout: 30000,
    idleTimeout: 300000,
    maxRetries: 3,
    healthCheckInterval: 30000,
    retryDelay: 1000,
    circuitBreakerThreshold: 10,
    circuitBreakerTimeout: 120000,
    chainId: chainId,
    addressPrefix: relayerConfig.cosmos.addressPrefix,
    gasPrice: relayerConfig.cosmos.gasPrice
  };

  // Add additional Cosmos endpoints from environment
  if (process.env.COSMOS_BACKUP_RPC_URLS) {
    const backupUrls = process.env.COSMOS_BACKUP_RPC_URLS.split(',');
    backupUrls.forEach((url, index) => {
      poolConfig.cosmos![chainId]!.endpoints.push({
        url: url.trim(),
        weight: 1,
        maxConnections: 5,
        timeout: 35000,
        retryAttempts: 3,
        healthCheckInterval: 30000
      });
    });
  }

  return poolConfig;
}

async function main() {
  logger.info('Starting 1inch Fusion+ Cosmos Relayer with Connection Pooling...');

  try {
    // Load configuration
    const config = Config.load();
    logger.info({ config: config.general }, 'Configuration loaded');

    // Initialize connection pool manager
    const poolConfig = createPoolConfigFromRelayerConfig(config);
    const poolManager = new ConnectionPoolManager(poolConfig, logger);
    
    // Initialize connection pool metrics collector
    const poolMetricsCollector = initializeDefaultMetricsCollector(logger, 30000);
    
    // Set up pool event handlers
    poolManager.on('pool_event', (event) => {
      poolMetricsCollector.handlePoolEvent(event);
    });

    poolManager.on('stats', (stats) => {
      logger.debug(stats, 'Connection pool statistics');
      
      // Alert on unhealthy pools
      if (stats.unhealthyPools.length > 0) {
        logger.warn({ unhealthyPools: stats.unhealthyPools }, 'Unhealthy connection pools detected');
      }
      
      if (stats.circuitBreakersPopen.length > 0) {
        logger.error({ circuitBreakers: stats.circuitBreakersPopen }, 'Circuit breakers open');
      }
    });

    // Start connection pools
    await poolManager.start();
    logger.info({
      ethereumPools: Object.keys(poolConfig.ethereum || {}),
      cosmosPools: Object.keys(poolConfig.cosmos || {})
    }, 'Connection pools started');

    // Start pool metrics collection
    poolMetricsCollector.startCollection(() => poolManager.getStats().pools);

    // Initialize secrets manager
    const secretsManager = createSecretsManager(logger);
    await secretsManager.initialize();
    
    // Load and validate required secrets
    const secretReferences = createRelayerSecretReferences();
    const secrets = await secretsManager.getSecrets(secretReferences);
    logger.info({ 
      provider: secretsManager.getHealthStatus().providers,
      secretsLoaded: Object.keys(secrets).length
    }, 'Secrets manager initialized');

    // Initialize Prometheus metrics
    const metrics = initializeMetrics(logger);
    logger.info('Prometheus metrics initialized');

    // Initialize persistence layer
    const persistenceManager = createPersistenceManager(logger);
    await persistenceManager.initialize();
    logger.info({ 
      mode: persistenceManager.getMode(),
      healthy: persistenceManager.isHealthy()
    }, 'Persistence layer initialized');

    // Start metrics server
    const metricsServer = createMetricsServer({
      port: parseInt(process.env.METRICS_PORT || '9090'),
      host: process.env.METRICS_HOST || '0.0.0.0',
      path: '/metrics',
      enableHealthCheck: true,
      authToken: process.env.METRICS_AUTH_TOKEN
    }, logger);
    
    await metricsServer.start();
    logger.info({ address: metricsServer.getAddress() }, 'Metrics server started');

    // Initialize Cosmos wallet for registry queries using secrets
    const cosmosMnemonic = await secretsManager.getCosmosMnemonic();
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(cosmosMnemonic, {
      prefix: config.cosmos.addressPrefix
    });
    const [account] = await wallet.getAccounts();

    // Use pooled Cosmos client for registry
    const chainId = config.cosmos.chainId;
    const cosmWasmClient = await poolManager.withCosmosSigningClient(
      chainId,
      wallet,
      async (client) => client // Just return the client
    );

    // Initialize registry services
    const registryClient = new ChainRegistryClient(config, logger);
    await poolManager.withCosmosSigningClient(
      chainId,
      wallet,
      async (client) => {
        await registryClient.initialize(
          client, 
          process.env.REGISTRY_CONTRACT_ADDRESS
        );
      }
    );
    
    const routerResolver = new RouterResolutionService(
      registryClient,
      {
        enableDynamicLookup: true,
        cacheTimeout: config.chainRegistry.cacheTimeout * 1000,
        retryAttempts: 3,
        retryDelay: 1000
      },
      logger
    );

    // Get Ethereum pool for monitor
    const ethereumNetwork = config.ethereum.chainId === 1 ? 'mainnet' : 
                           config.ethereum.chainId === 11155111 ? 'sepolia' : 
                           'localhost';
    const ethereumPool = poolManager.getEthereumPool(ethereumNetwork);
    if (!ethereumPool) {
      throw new Error(`Ethereum pool not found for network: ${ethereumNetwork}`);
    }

    // Initialize services with pooled connections
    const ethereumMonitor = new PooledEthereumMonitor(
      ethereumPool,
      config.ethereum.htlcContractAddress,
      logger
    );
    
    // TODO: Create pooled version of CosmosMonitor
    const cosmosMonitor = new CosmosMonitor(config.cosmos, logger);
    
    const routeDiscovery = new RouteDiscovery(config.chainRegistry, logger);
    await routeDiscovery.initialize(routerResolver, registryClient);
    
    const relayService = new RelayService(config, logger, routeDiscovery, persistenceManager);
    const recoveryService = new RecoveryService(config, logger);

    // Initialize relay service
    await relayService.initialize();

    // Start monitors
    await ethereumMonitor.start();
    await cosmosMonitor.start();

    // Start recovery service
    await recoveryService.start();
    
    // Connect monitors to relay service
    ethereumMonitor.onHTLCCreated(async (event) => {
      await relayService.handleEthereumHTLC(event);
    });

    ethereumMonitor.onHTLCWithdrawn(async (event) => {
      logger.info({ htlcId: event.htlcId }, 'HTLC withdrawn');
      // Update relay status if needed
    });

    ethereumMonitor.onHTLCRefunded(async (event) => {
      logger.info({ htlcId: event.htlcId }, 'HTLC refunded');
      // Update relay status if needed
    });
    
    cosmosMonitor.onHTLCEvent(async (event) => {
      await relayService.handleCosmosHTLC(event);
    });

    // Initialize security systems
    const ddosProtection = new DDoSProtectionSystem({
      baseRateLimit: 100,
      maxRateLimit: 500,
      rateMultiplier: 1.5,
      adaptationSpeed: 0.1,
      volumeThreshold: 200,
      burstThreshold: 50,
      patternThreshold: 0.8,
      warningLevel: 0.6,
      blockLevel: 0.8,
      emergencyLevel: 0.95,
      analysisWindow: 60000,
      blacklistDuration: 300000, // 5 minutes
      adaptationWindow: 300000
    }, logger);

    const apiRateLimiter = new APIRateLimiter(logger);
    const securityManager = new SecurityManager({
      ddosProtection,
      rateLimiter: apiRateLimiter,
      enableCircuitBreaker: true,
      emergencyThreshold: 0.9
    }, logger);

    // Setup API server for health checks and metrics
    const app = express();
    app.use(express.json({ limit: '1mb' })); // Prevent large payload DoS
    
    // Security middleware
    app.use(async (req, res, next) => {
      const fingerprint = {
        ip: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        headers: req.headers as Record<string, string>,
        bodySize: JSON.stringify(req.body || {}).length,
        timestamp: Date.now()
      };

      try {
        const securityCheck = await securityManager.checkRequest(fingerprint);
        
        if (!securityCheck.allowed) {
          logger.warn({ ip: fingerprint.ip, reason: securityCheck.reason }, 'Request blocked by security');
          return res.status(429).json({
            error: 'Rate limited',
            reason: securityCheck.reason,
            retryAfter: securityCheck.retryAfter
          });
        }
        
        // Add security headers
        res.set({
          'X-RateLimit-Limit': securityCheck.rateLimit?.toString() || '100',
          'X-RateLimit-Remaining': securityCheck.remaining?.toString() || '99',
          'X-RateLimit-Reset': securityCheck.resetTime?.toString() || Date.now().toString()
        });
        
        next();
      } catch (error) {
        logger.error({ error }, 'Security check error');
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      const poolStats = poolManager.getStats();
      const isHealthy = ethereumMonitor.getHealth().running && 
                       cosmosMonitor.getHealth().running &&
                       poolStats.unhealthyPools.length === 0;
      
      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        components: {
          ethereumMonitor: ethereumMonitor.getHealth(),
          cosmosMonitor: cosmosMonitor.getHealth(),
          connectionPools: {
            totalConnections: poolStats.totalConnections,
            unhealthyPools: poolStats.unhealthyPools,
            circuitBreakersOpen: poolStats.circuitBreakersPopen
          },
          persistence: persistenceManager.getHealthStatus(),
          secrets: secretsManager.getHealthStatus(),
          security: securityManager.getStatus()
        }
      });
    });

    // Connection pool stats endpoint
    app.get('/pool-stats', (req, res) => {
      res.json(poolManager.getStats());
    });

    // Start API server
    const port = process.env.API_PORT || 3000;
    app.listen(port, () => {
      logger.info({ port }, 'API server started');
    });

    // Setup graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, starting graceful shutdown...');
      
      try {
        // Stop accepting new requests
        app.removeAllListeners();
        
        // Stop monitors
        await ethereumMonitor.stop();
        await cosmosMonitor.stop();
        
        // Stop recovery service
        await recoveryService.stop();
        
        // Stop security systems
        ddosProtection.stop();
        
        // Stop persistence layer
        await persistenceManager.close();
        
        // Stop secrets manager
        await secretsManager.close();
        
        // Stop pool metrics collection
        poolMetricsCollector.stopCollection();
        
        // Stop connection pools
        await poolManager.stop();
        
        // Stop metrics server
        await metricsServer.stop();
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    });

    // Log successful startup
    logger.info({
      ethereumNetwork,
      cosmosChainId: chainId,
      ethereumContract: config.ethereum.htlcContractAddress,
      cosmosContract: config.cosmos.htlcContract,
      poolsActive: poolManager.getStats().totalConnections,
      metricsPort,
      apiPort: port
    }, '✅ Relayer with connection pooling started successfully');

  } catch (error) {
    logger.error({ error }, 'Failed to start relayer');
    process.exit(1);
  }
}

// Start the relayer
if (require.main === module) {
  main().catch((error) => {
    logger.error({ error }, 'Unhandled error in main');
    process.exit(1);
  });
}

export { main };
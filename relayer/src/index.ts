import { config } from 'dotenv';
import express from 'express';
import pino from 'pino';
import { EthereumMonitor } from './monitor/ethereum-monitor';
import { CosmosMonitor } from './monitor/cosmos-monitor';
import { RelayService } from './relay/relay-service';
import { RouteDiscovery } from './routes/route-discovery';
import { RecoveryService } from './recovery/recovery-service';
import { Config } from './config/index';
import { ChainRegistryClient } from './registry/chain-registry-client';
import { RouterResolutionService } from './registry/router-resolution-service';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { initializeMetrics } from './monitoring/prometheus-metrics';
import { createMetricsServer } from './monitoring/metrics-server';
import { createPersistenceManager } from './persistence/utils';
import { createSecretsManager, createRelayerSecretReferences } from './secrets/utils';
import { DDoSProtectionSystem } from './security/ddos-protection';
import { APIRateLimiter } from './middleware/rate-limiter';
import { SecurityManager } from './security/security-manager';
import { initializeTracing, getTracingConfig } from './tracing/tracer';
import { getTracer, addTraceContext } from './tracing/instrumentation';
import { createValidationMiddleware } from './middleware/input-validation';

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

async function main() {
  logger.info('Starting 1inch Fusion+ Cosmos Relayer...');

  try {
    // Initialize OpenTelemetry tracing first
    const tracingConfig = getTracingConfig();
    initializeTracing(tracingConfig, logger);
    
    // Create tracer for main application
    const tracer = getTracer('relayer-main');
    
    // Start main initialization span
    await tracer.startActiveSpan('relayer_initialization', async (span) => {
      try {
        // Add trace context to logger
        const tracedLogger = addTraceContext(logger);
        
        // Load configuration
        const config = await Config.load();
        tracedLogger.info({ config: config.general }, 'Configuration loaded and validated');
        span.setAttributes({
          'relayer.environment': process.env.NODE_ENV || 'production',
          'relayer.chains': config.cosmos.chainId,
        });

        // Initialize secrets manager
        const secretsManager = createSecretsManager(tracedLogger);
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

    // Initialize Cosmos wallet and client for registry queries using secrets
    const cosmosMnemonic = await secretsManager.getCosmosMnemonic();
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(cosmosMnemonic, {
      prefix: config.cosmos.addressPrefix
    });
    const [account] = await wallet.getAccounts();
    const cosmWasmClient = await SigningCosmWasmClient.connectWithSigner(
      config.cosmos.rpcUrl,
      wallet,
      { gasPrice: config.cosmos.gasPrice }
    );

    // Initialize registry services
    const registryClient = new ChainRegistryClient(config, logger);
    await registryClient.initialize(
      cosmWasmClient, 
      process.env.REGISTRY_CONTRACT_ADDRESS
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

    // Initialize services
    const ethereumMonitor = new EthereumMonitor(config.ethereum, logger);
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
    
    // Create validation middleware
    const validation = createValidationMiddleware(logger);
    
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
        logger.error({ error, ip: fingerprint.ip }, 'Security middleware error');
        next(); // Allow request on security system failure
      }
    });

    app.get('/health', (_req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        monitors: {
          ethereum: ethereumMonitor.getStatus(),
          cosmos: cosmosMonitor.getStatus(),
        },
        recovery: recoveryService.getStatus(),
        persistence: {
          mode: persistenceManager.getMode(),
          healthy: persistenceManager.isHealthy(),
          lastHealthCheck: persistenceManager.getLastHealthCheck(),
        },
        secrets: {
          healthy: secretsManager.isHealthy(),
          providers: Object.keys(secretsManager.getHealthStatus().providers)
        },
        systemHealth: relayService.isHealthy(),
      });
    });

    app.get('/metrics', (_req, res) => {
      res.json({
        relayed: relayService.getMetrics(),
        enhanced: relayService.getEnhancedMetrics(),
        pending: relayService.getPendingCount(),
        routes: routeDiscovery.getCachedRoutesCount(),
        ethereumMonitor: ethereumMonitor.getHealth(),
      });
    });

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      logger.info(`API server listening on port ${port}`);
    });

    // Security monitoring endpoints
    app.get('/security/status', (_req, res) => {
      res.json({
        ddosProtection: ddosProtection.getStats(),
        rateLimiter: apiRateLimiter.getStats(),
        securityManager: securityManager.getStatus(),
        timestamp: new Date().toISOString()
      });
    });

    app.post('/security/emergency-lockdown', validation.validateEmergencyStop, (req, res) => {
      const { reason } = req.body;
      logger.error({ reason }, 'Emergency security lockdown activated');
      
      ddosProtection.emergencyLockdown();
      securityManager.emergencyLockdown(reason || 'Manual emergency lockdown');
      
      res.json({
        status: 'emergency_lockdown_activated',
        reason: reason || 'Manual emergency lockdown',
        timestamp: new Date().toISOString()
      });
    });

    app.post('/security/blacklist/:ip', validation.validateBlacklistAdd, (req, res) => {
      const { ip } = req.params;
      const { reason, duration } = req.body;
      
      try {
        securityManager.blacklistIP(ip, reason || 'Manual blacklist', duration);
        res.json({
          status: 'ip_blacklisted',
          ip,
          reason: reason || 'Manual blacklist',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error, ip }, 'Failed to blacklist IP');
        res.status(500).json({
          error: 'Failed to blacklist IP',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    app.delete('/security/blacklist/:ip', validation.validateBlacklistRemove, (req, res) => {
      const { ip } = req.params;
      
      try {
        securityManager.removeFromBlacklist(ip);
        res.json({
          status: 'ip_removed_from_blacklist',
          ip,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error, ip }, 'Failed to remove IP from blacklist');
        res.status(500).json({
          error: 'Failed to remove IP from blacklist',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Handle shutdown gracefully
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await ethereumMonitor.stop();
      await cosmosMonitor.stop();
      await recoveryService.stop();
      await relayService.stop();
      await persistenceManager.shutdown();
      await secretsManager.destroy();
      await metricsServer.stop();
      ddosProtection.destroy();
      apiRateLimiter.destroy();
      securityManager.destroy();
      process.exit(0);
    });

    // Emergency stop endpoint for admin control
    app.post('/emergency-stop', validation.validateEmergencyStop, (req, res) => {
      const { reason } = req.body;
      const stopReason = reason || 'Manual emergency stop';
      
      logger.error({ reason: stopReason }, 'Emergency stop triggered');
      relayService.emergencyStop(stopReason);
      
      res.json({
        status: 'emergency_stop_activated',
        reason: stopReason,
        timestamp: new Date().toISOString()
      });
    });

    // Resume from emergency stop endpoint
    app.post('/resume', (_req, res) => {
      logger.info('Resuming from emergency stop');
      relayService.resumeFromEmergencyStop();
      
      res.json({
        status: 'resumed',
        timestamp: new Date().toISOString()
      });
    });

    // Circuit breaker management endpoints
    app.get('/circuit-breakers', (_req, res) => {
      const metrics = relayService.getEnhancedMetrics();
      res.json({
        circuitBreakers: metrics.errorRecovery.circuitBreakerStatus,
        systemHealth: metrics.systemHealth
      });
    });

    app.post('/circuit-breakers/:name/trip', validation.validateCircuitBreaker, (req, res) => {
      const { name } = req.params;
      const { reason } = req.body;
      
      logger.warn({ name, reason }, 'Manually tripping circuit breaker');
      
      try {
        if (name === 'system' || name === 'all') {
          relayService.emergencyStop(reason || `Manual circuit trip: ${name}`);
        } else {
          relayService.tripCircuitBreaker(name, reason);
        }
        
        res.json({
          status: 'circuit_breaker_tripped',
          name,
          reason: reason || 'Manual trip',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error, name }, 'Failed to trip circuit breaker');
        res.status(500).json({
          error: 'Failed to trip circuit breaker',
          name,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    app.post('/circuit-breakers/:name/reset', validation.validateCircuitBreaker, (req, res) => {
      const { name } = req.params;
      
      logger.info({ name }, 'Manually resetting circuit breaker');
      
      try {
        if (name === 'system') {
          relayService.resumeFromEmergencyStop();
        } else if (name === 'all') {
          relayService.resetAllCircuitBreakers();
        } else {
          relayService.resetCircuitBreaker(name);
        }
        
        res.json({
          status: 'circuit_breaker_reset',
          name,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error, name }, 'Failed to reset circuit breaker');
        res.status(500).json({
          error: 'Failed to reset circuit breaker',
          name,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // System health check endpoint
    app.get('/health/detailed', (_req, res) => {
      const enhancedMetrics = relayService.getEnhancedMetrics();
      const ethereumHealth = ethereumMonitor.getHealth();
      const cosmosHealth = cosmosMonitor.getStatus();
      const recoveryStatus = recoveryService.getStatus();
      
      res.json({
        overall: {
          healthy: relayService.isHealthy(),
          timestamp: new Date().toISOString()
        },
        monitors: {
          ethereum: ethereumHealth,
          cosmos: cosmosHealth
        },
        services: {
          relay: enhancedMetrics,
          recovery: recoveryStatus
        },
        systemHealth: enhancedMetrics.systemHealth
      });
    });

    // Persistence management endpoints
    app.get('/persistence/stats', async (_req, res) => {
      try {
        const stats = await persistenceManager.getStats();
        res.json({
          mode: persistenceManager.getMode(),
          healthy: persistenceManager.isHealthy(),
          lastHealthCheck: persistenceManager.getLastHealthCheck(),
          stats
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get persistence stats');
        res.status(500).json({
          error: 'Failed to retrieve persistence statistics',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    app.post('/persistence/cleanup', validation.validateCleanup, async (req, res) => {
      try {
        const { retentionPeriod } = req.body;
        const period = retentionPeriod || 604800000; // Default 7 days
        
        logger.info({ retentionPeriod: period }, 'Starting persistence cleanup');
        const recordsRemoved = await persistenceManager.cleanup(period);
        
        res.json({
          status: 'cleanup_completed',
          recordsRemoved,
          retentionPeriod: period,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to cleanup persistence');
        res.status(500).json({
          error: 'Failed to cleanup persistence',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    app.post('/persistence/vacuum', async (_req, res) => {
      try {
        logger.info('Starting database vacuum');
        await persistenceManager.vacuum();
        
        res.json({
          status: 'vacuum_completed',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to vacuum database');
        res.status(500).json({
          error: 'Failed to vacuum database',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    app.get('/persistence/health', async (_req, res) => {
      try {
        const isHealthy = await persistenceManager.forceHealthCheck();
        
        res.json({
          healthy: isHealthy,
          mode: persistenceManager.getMode(),
          lastHealthCheck: persistenceManager.getLastHealthCheck(),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to check persistence health');
        res.status(500).json({
          error: 'Failed to check persistence health',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Secrets management endpoints
    app.get('/secrets/health', async (_req, res) => {
      try {
        const healthStatus = secretsManager.getHealthStatus();
        res.json({
          healthy: healthStatus.healthy,
          providers: healthStatus.providers,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get secrets health');
        res.status(500).json({
          error: 'Failed to get secrets health',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    app.get('/secrets/stats', async (_req, res) => {
      try {
        const stats = secretsManager.getStats();
        res.json({
          providers: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get secrets stats');
        res.status(500).json({
          error: 'Failed to get secrets statistics',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    app.post('/secrets/refresh', async (_req, res) => {
      try {
        await secretsManager.refreshAllSecrets();
        res.json({
          status: 'secrets_refreshed',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to refresh secrets');
        res.status(500).json({
          error: 'Failed to refresh secrets',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    app.get('/secrets/audit', validation.validateSecretsAudit, async (req, res) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        const auditLog = secretsManager.getAuditLog(limit);
        
        // Mask sensitive information in audit log for API response
        const maskedLog = auditLog.map(event => ({
          ...event,
          // Don't include actual secret values in audit log
          secretName: event.secretName,
          operation: event.operation,
          provider: event.provider,
          success: event.success,
          timestamp: event.timestamp,
          error: event.error,
          metadata: event.metadata ? {
            duration: event.metadata.duration,
            requestId: event.metadata.requestId,
            source: event.metadata.source
          } : undefined
        }));
        
        res.json({
          auditLog: maskedLog,
          totalEvents: auditLog.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get secrets audit log');
        res.status(500).json({
          error: 'Failed to get secrets audit log',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 1, message: 'Initialization failed' });
        throw error;
      } finally {
        span.end();
      }
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start relayer');
    process.exit(1);
  }
}

// Start the relayer
main().catch((error) => {
  logger.fatal({ error }, 'Fatal error occurred');
  process.exit(1);
});

import express from 'express';
import { Logger } from 'pino';
import { getMetrics } from './prometheus-metrics';

/**
 * HTTP server for exposing Prometheus metrics
 * 
 * Provides a dedicated endpoint for Prometheus scraping that:
 * - Exposes all relayer metrics in Prometheus format
 * - Includes health check endpoints
 * - Handles basic security for metrics access
 * - Provides operational status information
 */

export interface MetricsServerConfig {
  port: number;
  host: string;
  path: string;
  enableHealthCheck: boolean;
  authToken?: string; // Optional bearer token for metrics access
}

export class MetricsServer {
  private app: express.Application;
  private server: any;
  private logger: Logger;
  private config: MetricsServerConfig;

  constructor(config: MetricsServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Basic security headers
    this.app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      this.logger.debug({
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      }, 'Metrics server request');
      next();
    });

    // Optional authentication
    if (this.config.authToken) {
      this.app.use(this.authenticate.bind(this));
    }

    // JSON parsing for health checks
    this.app.use(express.json({ limit: '1mb' }));
  }

  private authenticate(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const authHeader = req.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    if (token !== this.config.authToken) {
      this.logger.warn({
        ip: req.ip,
        userAgent: req.get('User-Agent')
      }, 'Unauthorized metrics access attempt');
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    next();
  }

  private setupRoutes(): void {
    // Main metrics endpoint for Prometheus scraping
    this.app.get(this.config.path, async (req, res) => {
      try {
        const metrics = await getMetrics().getMetrics();
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(metrics);
      } catch (error) {
        this.logger.error({ error }, 'Failed to generate metrics');
        res.status(500).json({ error: 'Failed to generate metrics' });
      }
    });

    // Health check endpoint
    if (this.config.enableHealthCheck) {
      this.app.get('/health', (req, res) => {
        res.json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: process.env.npm_package_version || 'unknown'
        });
      });

      // Readiness check (more comprehensive)
      this.app.get('/ready', async (req, res) => {
        try {
          // Check if metrics system is working
          await getMetrics().getMetrics();
          
          // Add additional readiness checks here
          // For example: database connectivity, RPC endpoints, etc.
          
          res.json({
            status: 'ready',
            timestamp: new Date().toISOString(),
            checks: {
              metrics: 'ok',
              // Add more checks as needed
            }
          });
        } catch (error) {
          this.logger.error({ error }, 'Readiness check failed');
          res.status(503).json({
            status: 'not ready',
            timestamp: new Date().toISOString(),
            error: 'System not ready'
          });
        }
      });
    }

    // Catch-all for undefined routes
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handling middleware
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error({
        error: err,
        method: req.method,
        url: req.url
      }, 'Metrics server error');
      
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.config.port, this.config.host, () => {
        this.logger.info({
          host: this.config.host,
          port: this.config.port,
          metricsPath: this.config.path,
          healthCheck: this.config.enableHealthCheck
        }, 'Metrics server started');
        resolve();
      });

      this.server.on('error', (error: any) => {
        this.logger.error({ error }, 'Failed to start metrics server');
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('Metrics server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getAddress(): string | null {
    if (this.server && this.server.listening) {
      const address = this.server.address();
      if (typeof address === 'string') {
        return address;
      } else if (address) {
        return `${address.address}:${address.port}`;
      }
    }
    return null;
  }
}

// Factory function for easy initialization
export function createMetricsServer(
  config: Partial<MetricsServerConfig>,
  logger: Logger
): MetricsServer {
  const defaultConfig: MetricsServerConfig = {
    port: parseInt(process.env.METRICS_PORT || '9090'),
    host: process.env.METRICS_HOST || '0.0.0.0',
    path: process.env.METRICS_PATH || '/metrics',
    enableHealthCheck: process.env.ENABLE_HEALTH_CHECK !== 'false',
    authToken: process.env.METRICS_AUTH_TOKEN
  };

  const finalConfig = { ...defaultConfig, ...config };
  return new MetricsServer(finalConfig, logger);
}
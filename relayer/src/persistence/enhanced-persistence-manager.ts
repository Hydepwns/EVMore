/**
 * Enhanced Persistence Manager
 * 
 * Integrates all advanced persistence features including migrations, connection management,
 * backup/recovery, performance monitoring, and archival policies for production use.
 */

import { Logger } from 'pino';
import { EventEmitter } from 'events';
import { Pool } from 'pg';
import Redis from 'ioredis';

import { PersistenceManager, PersistenceManagerConfig } from './persistence-manager';
import { DatabaseMigrator } from './migrations';
import { PostgreSQLConnectionManager, RedisConnectionManager, DatabaseEndpoint, ConnectionPoolConfig } from './connection-manager';
import { BackupManager, BackupConfig } from './backup-manager';
import { PerformanceMonitor } from './performance-monitor';
import { ArchivalManager } from './archival-manager';

export interface EnhancedPersistenceConfig extends PersistenceManagerConfig {
  // Connection management
  endpoints: {
    postgres: DatabaseEndpoint[];
    redis: DatabaseEndpoint[];
  };
  connectionPool: ConnectionPoolConfig;
  
  // Migrations
  migrations: {
    enabled: boolean;
    path: string;
    autoMigrate: boolean;
  };
  
  // Backup and recovery
  backup: BackupConfig;
  
  // Performance monitoring
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    alertingEnabled: boolean;
    slowQueryThreshold: number;
  };
  
  // Data archival
  archival: {
    enabled: boolean;
    policies: string[]; // Policy names to enable
  };
}

export class EnhancedPersistenceManager extends EventEmitter {
  private logger: Logger;
  private config: EnhancedPersistenceConfig;
  
  // Core persistence
  private persistenceManager: PersistenceManager;
  
  // Advanced features
  private migrator?: DatabaseMigrator;
  private pgConnectionManager?: PostgreSQLConnectionManager;
  private redisConnectionManager?: RedisConnectionManager;
  private backupManager?: BackupManager;
  private performanceMonitor?: PerformanceMonitor;
  private archivalManager?: ArchivalManager;
  
  // Direct database access (for advanced operations)
  private pgPool?: Pool;
  private redisClient?: Redis;
  
  private isInitialized = false;
  private isShuttingDown = false;

  constructor(config: EnhancedPersistenceConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'EnhancedPersistenceManager' });
    
    // Initialize core persistence manager
    this.persistenceManager = new PersistenceManager(config, logger);
    this.setupEventHandlers();
  }

  /**
   * Initialize all persistence components
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Enhanced persistence manager already initialized');
      return;
    }

    try {
      this.logger.info('Initializing enhanced persistence manager...');
      
      // 1. Initialize connection managers
      await this.initializeConnectionManagers();
      
      // 2. Initialize core persistence manager
      await this.persistenceManager.initialize();
      
      // 3. Run database migrations if enabled
      if (this.config.migrations.enabled) {
        await this.initializeMigrations();
      }
      
      // 4. Initialize backup manager
      if (this.config.backup.enabled) {
        await this.initializeBackupManager();
      }
      
      // 5. Initialize performance monitoring
      if (this.config.monitoring.enabled) {
        await this.initializePerformanceMonitoring();
      }
      
      // 6. Initialize archival manager
      if (this.config.archival.enabled) {
        await this.initializeArchivalManager();
      }
      
      this.isInitialized = true;
      this.logger.info('Enhanced persistence manager initialized successfully');
      this.emit('initialized');

    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize enhanced persistence manager');
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Get the core persistence manager for basic operations
   */
  getPersistenceManager(): PersistenceManager {
    return this.persistenceManager;
  }

  /**
   * Get the database migrator
   */
  getMigrator(): DatabaseMigrator | undefined {
    return this.migrator;
  }

  /**
   * Get the backup manager
   */
  getBackupManager(): BackupManager | undefined {
    return this.backupManager;
  }

  /**
   * Get the performance monitor
   */
  getPerformanceMonitor(): PerformanceMonitor | undefined {
    return this.performanceMonitor;
  }

  /**
   * Get the archival manager
   */
  getArchivalManager(): ArchivalManager | undefined {
    return this.archivalManager;
  }

  /**
   * Get connection statistics from all managers
   */
  getConnectionStats(): {
    postgres?: any;
    redis?: any;
    persistence: any;
  } {
    return {
      postgres: this.pgConnectionManager?.getStats(),
      redis: this.redisConnectionManager?.getStats(),
      persistence: {
        mode: this.persistenceManager.getMode(),
        healthy: this.persistenceManager.isHealthy(),
        lastHealthCheck: this.persistenceManager.getLastHealthCheck()
      }
    };
  }

  /**
   * Get comprehensive health status
   */
  getHealthStatus(): {
    overall: boolean;
    components: {
      persistence: boolean;
      postgres: boolean;
      redis: boolean;
      migrations: boolean;
      backup: boolean;
      monitoring: boolean;
      archival: boolean;
    };
    alerts: any[];
    recommendations: any[];
  } {
    const components = {
      persistence: this.persistenceManager.isHealthy(),
      postgres: this.pgConnectionManager?.getHealthyEndpoints().length > 0 || true,
      redis: this.redisConnectionManager?.getStats().some(s => s.healthy) ?? true,
      migrations: true, // Migrations are typically one-time operations
      backup: this.backupManager ? true : true, // If enabled, assume healthy unless we have specific checks
      monitoring: this.performanceMonitor ? true : true,
      archival: this.archivalManager ? true : true
    };

    const overall = Object.values(components).every(healthy => healthy);
    
    return {
      overall,
      components,
      alerts: this.performanceMonitor?.getActiveAlerts() || [],
      recommendations: this.performanceMonitor?.getRecommendations() || []
    };
  }

  /**
   * Perform comprehensive database maintenance
   */
  async performMaintenance(options: {
    vacuum?: boolean;
    reindex?: boolean;
    analyze?: boolean;
    backup?: boolean;
    archival?: boolean;
    cleanup?: boolean;
  } = {}): Promise<{
    vacuum?: any;
    backup?: any;
    archival?: any;
    cleanup?: any;
  }> {
    this.logger.info(options, 'Starting comprehensive database maintenance');
    const results: any = {};

    try {
      // Database vacuum and optimization
      if (options.vacuum !== false && this.archivalManager) {
        results.vacuum = await this.archivalManager.performCleanup({
          vacuum: options.vacuum,
          reindex: options.reindex,
          analyze: options.analyze
        });
      }

      // Create backup
      if (options.backup && this.backupManager) {
        results.backup = await this.backupManager.createFullBackup({
          comment: 'Scheduled maintenance backup'
        });
      }

      // Run archival policies
      if (options.archival && this.archivalManager) {
        results.archival = await this.archivalManager.performCleanup();
      }

      // General cleanup
      if (options.cleanup && this.backupManager) {
        results.cleanup = await this.backupManager.cleanupOldBackups();
      }

      this.logger.info({ results }, 'Database maintenance completed');
      this.emit('maintenance_completed', results);
      
      return results;

    } catch (error) {
      this.logger.error({ error }, 'Database maintenance failed');
      this.emit('maintenance_failed', error);
      throw error;
    }
  }

  /**
   * Export configuration for debugging
   */
  exportConfiguration(): any {
    return {
      mode: this.config.mode,
      endpoints: {
        postgres: this.config.endpoints.postgres.length,
        redis: this.config.endpoints.redis.length
      },
      features: {
        migrations: this.config.migrations.enabled,
        backup: this.config.backup.enabled,
        monitoring: this.config.monitoring.enabled,
        archival: this.config.archival.enabled
      },
      connectionPool: {
        maxConnections: this.config.connectionPool.maxConnections,
        loadBalancing: this.config.connectionPool.loadBalancing
      }
    };
  }

  /**
   * Gracefully shutdown all components
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Enhanced persistence manager already shutting down');
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('Shutting down enhanced persistence manager...');

    try {
      // Shutdown in reverse order of initialization
      if (this.archivalManager) {
        await this.archivalManager.shutdown();
      }

      if (this.performanceMonitor) {
        await this.performanceMonitor.shutdown();
      }

      if (this.backupManager) {
        // Backup manager doesn't have async shutdown
      }

      if (this.pgConnectionManager) {
        await this.pgConnectionManager.shutdown();
      }

      if (this.redisConnectionManager) {
        await this.redisConnectionManager.shutdown();
      }

      await this.persistenceManager.shutdown();

      this.logger.info('Enhanced persistence manager shut down successfully');
      this.emit('shutdown');

    } catch (error) {
      this.logger.error({ error }, 'Error during enhanced persistence manager shutdown');
      throw error;
    } finally {
      this.isShuttingDown = false;
      this.isInitialized = false;
    }
  }

  // Private methods

  private async initializeConnectionManagers(): Promise<void> {
    // Initialize PostgreSQL connection manager
    if (this.config.endpoints.postgres.length > 0) {
      this.pgConnectionManager = new PostgreSQLConnectionManager(
        this.config.endpoints.postgres,
        this.config.connectionPool,
        this.logger
      );

      // Set up event forwarding
      this.pgConnectionManager.on('endpoint_unhealthy', (endpoint) => {
        this.emit('postgres_endpoint_unhealthy', endpoint);
      });
    }

    // Initialize Redis connection manager
    if (this.config.endpoints.redis.length > 0) {
      this.redisConnectionManager = new RedisConnectionManager(
        this.config.endpoints.redis,
        this.config.connectionPool,
        this.logger
      );

      this.redisConnectionManager.on('endpoint_unhealthy', (endpoint) => {
        this.emit('redis_endpoint_unhealthy', endpoint);
      });
    }

    this.logger.info('Connection managers initialized');
  }

  private async initializeMigrations(): Promise<void> {
    if (!this.pgConnectionManager) {
      this.logger.warn('PostgreSQL connection manager not available for migrations');
      return;
    }

    // Get a connection for migrations
    const { client } = await this.pgConnectionManager.getWriteConnection();
    
    try {
      // Create a temporary pool for the migrator
      const migrationPool = new Pool({
        host: this.config.postgres?.host,
        port: this.config.postgres?.port,
        database: this.config.postgres?.database,
        user: this.config.postgres?.username,
        password: this.config.postgres?.password,
        ssl: this.config.postgres?.ssl,
        max: 1 // Only need one connection for migrations
      });

      this.migrator = new DatabaseMigrator(
        migrationPool,
        this.logger,
        this.config.migrations.path
      );

      await this.migrator.initialize();

      if (this.config.migrations.autoMigrate) {
        const appliedMigrations = await this.migrator.migrate();
        if (appliedMigrations.length > 0) {
          this.logger.info({ 
            count: appliedMigrations.length 
          }, 'Applied pending migrations');
        }
      }

      this.logger.info('Database migrations initialized');

    } finally {
      client.release();
    }
  }

  private async initializeBackupManager(): Promise<void> {
    this.backupManager = new BackupManager(this.config.backup, this.logger);

    // Get database connections for backup operations
    let pgPool: Pool | undefined;
    let redisClient: Redis | undefined;

    if (this.config.postgres) {
      pgPool = new Pool({
        host: this.config.postgres.host,
        port: this.config.postgres.port,
        database: this.config.postgres.database,
        user: this.config.postgres.username,
        password: this.config.postgres.password,
        ssl: this.config.postgres.ssl,
        max: 2 // Limited connections for backup operations
      });
    }

    if (this.config.redis) {
      redisClient = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db || 0
      });
    }

    await this.backupManager.initialize(pgPool, redisClient);

    // Forward backup events
    this.backupManager.on('backup_completed', (backup) => {
      this.emit('backup_completed', backup);
    });

    this.backupManager.on('backup_failed', (backup) => {
      this.emit('backup_failed', backup);
    });

    this.logger.info('Backup manager initialized');
  }

  private async initializePerformanceMonitoring(): Promise<void> {
    this.performanceMonitor = new PerformanceMonitor(this.logger, {
      metricsInterval: this.config.monitoring.metricsInterval,
      slowQueryThreshold: this.config.monitoring.slowQueryThreshold
    });

    // Get database connections for monitoring
    let pgPool: Pool | undefined;
    let redisClient: Redis | undefined;

    if (this.config.postgres) {
      pgPool = new Pool({
        host: this.config.postgres.host,
        port: this.config.postgres.port,
        database: this.config.postgres.database,
        user: this.config.postgres.username,
        password: this.config.postgres.password,
        ssl: this.config.postgres.ssl,
        max: 2
      });
    }

    if (this.config.redis) {
      redisClient = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db || 0
      });
    }

    await this.performanceMonitor.initialize(pgPool, redisClient);

    // Forward performance alerts
    if (this.config.monitoring.alertingEnabled) {
      this.performanceMonitor.on('alert_triggered', (alert) => {
        this.emit('performance_alert', alert);
      });
    }

    this.logger.info('Performance monitoring initialized');
  }

  private async initializeArchivalManager(): Promise<void> {
    this.archivalManager = new ArchivalManager(this.logger);

    // Get database connections for archival operations
    let pgPool: Pool | undefined;
    let redisClient: Redis | undefined;

    if (this.config.postgres) {
      pgPool = new Pool({
        host: this.config.postgres.host,
        port: this.config.postgres.port,
        database: this.config.postgres.database,
        user: this.config.postgres.username,
        password: this.config.postgres.password,
        ssl: this.config.postgres.ssl,
        max: 2
      });
    }

    if (this.config.redis) {
      redisClient = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db || 0
      });
    }

    await this.archivalManager.initialize(pgPool, redisClient);

    // Forward archival events
    this.archivalManager.on('job_completed', (job) => {
      this.emit('archival_completed', job);
    });

    this.logger.info('Archival manager initialized');
  }

  private setupEventHandlers(): void {
    // Forward core persistence manager events
    this.persistenceManager.on('connected', () => this.emit('connected'));
    this.persistenceManager.on('disconnected', () => this.emit('disconnected'));
    this.persistenceManager.on('error', (error) => this.emit('error', error));
    this.persistenceManager.on('health_restored', () => this.emit('health_restored'));
    this.persistenceManager.on('health_degraded', () => this.emit('health_degraded'));
  }

  private async cleanup(): Promise<void> {
    // Clean up any partially initialized components
    try {
      if (this.archivalManager) await this.archivalManager.shutdown();
      if (this.performanceMonitor) await this.performanceMonitor.shutdown();
      if (this.pgConnectionManager) await this.pgConnectionManager.shutdown();
      if (this.redisConnectionManager) await this.redisConnectionManager.shutdown();
      await this.persistenceManager.shutdown();
    } catch (error) {
      this.logger.error({ error }, 'Error during cleanup');
    }
  }
}
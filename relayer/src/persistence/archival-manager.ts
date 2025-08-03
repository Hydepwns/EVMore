/**
 * Data archival and cleanup manager for the 1inch Fusion+ Cosmos Relayer
 * 
 * Manages automated data archival, retention policies, and cleanup operations
 * to maintain optimal database performance and storage efficiency.
 */

import { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import { Logger } from 'pino';
import { EventEmitter } from 'events';
import { createWriteStream, createReadStream } from 'fs';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';

export interface ArchivalPolicy {
  name: string;
  description: string;
  enabled: boolean;
  
  // Data selection criteria
  table: string;
  conditions: string; // SQL WHERE clause
  dateColumn: string;
  
  // Retention settings
  retentionPeriod: number; // milliseconds
  batchSize: number; // records per batch
  
  // Archival destination
  destination: {
    type: 'delete' | 'archive' | 'compress';
    location?: string; // File path or S3 URL for archives
    format?: 'json' | 'csv' | 'parquet';
    compression?: 'gzip' | 'lz4' | 'none';
  };
  
  // Scheduling
  schedule: string; // Cron expression
  
  // Safety settings
  dryRun: boolean;
  maxRecordsPerRun: number;
  preserveReferences: boolean; // Keep referenced records
}

export interface ArchivalJob {
  id: string;
  policy: ArchivalPolicy;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  recordsProcessed: number;
  recordsArchived: number;
  recordsDeleted: number;
  bytesProcessed: number;
  error?: string;
  metrics: {
    queriesExecuted: number;
    avgBatchTime: number;
    totalDuration: number;
  };
}

export interface CleanupStatistics {
  tablesProcessed: number;
  recordsRemoved: number;
  spaceReclaimed: number; // bytes
  indexesRebuilt: number;
  vacuumOperations: number;
  duration: number; // milliseconds
}

export class ArchivalManager extends EventEmitter {
  private logger: Logger;
  private pgPool?: Pool;
  private redisClient?: Redis;
  
  private policies: Map<string, ArchivalPolicy> = new Map();
  private activeJobs: Map<string, ArchivalJob> = new Map();
  private jobHistory: ArchivalJob[] = [];
  private scheduledJobs: Map<string, NodeJS.Timeout> = new Map();
  
  private config = {
    maxConcurrentJobs: 2,
    jobHistoryLimit: 100,
    defaultBatchSize: 1000,
    queryTimeout: 30000, // 30 seconds
    maxJobDuration: 3600000, // 1 hour
  };

  constructor(logger: Logger, config?: Partial<typeof this.config>) {
    super();
    this.logger = logger.child({ component: 'ArchivalManager' });
    this.config = { ...this.config, ...config };
    
    this.setupDefaultPolicies();
  }

  /**
   * Initialize archival manager
   */
  async initialize(pgPool?: Pool, redisClient?: Redis): Promise<void> {
    this.pgPool = pgPool;
    this.redisClient = redisClient;
    
    // Schedule policy execution
    this.schedulePolicies();
    
    this.logger.info('Archival manager initialized');
  }

  /**
   * Add an archival policy
   */
  addPolicy(policy: ArchivalPolicy): void {
    this.policies.set(policy.name, policy);
    
    if (policy.enabled) {
      this.schedulePolicy(policy);
    }
    
    this.logger.info({ policy: policy.name }, 'Archival policy added');
  }

  /**
   * Remove an archival policy
   */
  removePolicy(name: string): boolean {
    const policy = this.policies.get(name);
    if (!policy) return false;
    
    // Cancel scheduled job
    const scheduledJob = this.scheduledJobs.get(name);
    if (scheduledJob) {
      clearTimeout(scheduledJob);
      this.scheduledJobs.delete(name);
    }
    
    this.policies.delete(name);
    this.logger.info({ policy: name }, 'Archival policy removed');
    return true;
  }

  /**
   * Execute a specific archival policy
   */
  async executePolicy(policyName: string, options: {
    dryRun?: boolean;
    maxRecords?: number;
  } = {}): Promise<ArchivalJob> {
    const policy = this.policies.get(policyName);
    if (!policy) {
      throw new Error(`Archival policy '${policyName}' not found`);
    }

    if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
      throw new Error('Maximum concurrent archival jobs exceeded');
    }

    const jobId = this.generateJobId(policyName);
    const job: ArchivalJob = {
      id: jobId,
      policy: {
        ...policy,
        dryRun: options.dryRun ?? policy.dryRun,
        maxRecordsPerRun: options.maxRecords ?? policy.maxRecordsPerRun
      },
      status: 'pending',
      startTime: new Date(),
      recordsProcessed: 0,
      recordsArchived: 0,
      recordsDeleted: 0,
      bytesProcessed: 0,
      metrics: {
        queriesExecuted: 0,
        avgBatchTime: 0,
        totalDuration: 0
      }
    };

    this.activeJobs.set(jobId, job);
    this.emit('job_started', job);

    try {
      await this.runArchivalJob(job);
      job.status = 'completed';
      job.endTime = new Date();
      job.metrics.totalDuration = job.endTime.getTime() - job.startTime.getTime();
      
      this.logger.info({
        jobId,
        policy: policyName,
        recordsProcessed: job.recordsProcessed,
        recordsArchived: job.recordsArchived,
        recordsDeleted: job.recordsDeleted,
        duration: job.metrics.totalDuration
      }, 'Archival job completed');
      
      this.emit('job_completed', job);

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.endTime = new Date();
      
      this.logger.error({ error, jobId, policy: policyName }, 'Archival job failed');
      this.emit('job_failed', job);
      
      throw error;
    } finally {
      this.activeJobs.delete(jobId);
      this.addToJobHistory(job);
    }

    return job;
  }

  /**
   * Perform comprehensive database cleanup
   */
  async performCleanup(options: {
    vacuum?: boolean;
    reindex?: boolean;
    analyze?: boolean;
    tables?: string[];
  } = {}): Promise<CleanupStatistics> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL connection not available');
    }

    const startTime = Date.now();
    const stats: CleanupStatistics = {
      tablesProcessed: 0,
      recordsRemoved: 0,
      spaceReclaimed: 0,
      indexesRebuilt: 0,
      vacuumOperations: 0,
      duration: 0
    };

    this.logger.info(options, 'Starting database cleanup');
    this.emit('cleanup_started', options);

    try {
      const client = await this.pgPool.connect();
      
      try {
        // Get table list
        const tableQuery = options.tables && options.tables.length > 0
          ? `SELECT tablename FROM pg_tables WHERE tablename = ANY($1)`
          : `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
        
        const tableParams = options.tables && options.tables.length > 0 ? [options.tables] : [];
        const tableResult = await client.query(tableQuery, tableParams);
        const tables = tableResult.rows.map(row => row.tablename);

        // Get initial table sizes
        const initialSizes = await this.getTableSizes(client, tables);

        // Process each table
        for (const table of tables) {
          this.logger.info({ table }, 'Processing table for cleanup');
          
          try {
            // VACUUM if requested
            if (options.vacuum !== false) { // Default to true
              await client.query(`VACUUM ANALYZE ${table}`);
              stats.vacuumOperations++;
              this.logger.debug({ table }, 'Vacuumed table');
            }

            // REINDEX if requested
            if (options.reindex) {
              await client.query(`REINDEX TABLE ${table}`);
              stats.indexesRebuilt++;
              this.logger.debug({ table }, 'Reindexed table');
            }

            // ANALYZE if requested (and not already done with VACUUM ANALYZE)
            if (options.analyze && options.vacuum === false) {
              await client.query(`ANALYZE ${table}`);
              this.logger.debug({ table }, 'Analyzed table');
            }

            stats.tablesProcessed++;

          } catch (error) {
            this.logger.error({ error, table }, 'Failed to process table');
          }
        }

        // Calculate space reclaimed
        const finalSizes = await this.getTableSizes(client, tables);
        for (const table of tables) {
          const initial = initialSizes.get(table) || 0;
          const final = finalSizes.get(table) || 0;
          stats.spaceReclaimed += Math.max(0, initial - final);
        }

      } finally {
        client.release();
      }

      stats.duration = Date.now() - startTime;
      
      this.logger.info({
        tablesProcessed: stats.tablesProcessed,
        spaceReclaimed: stats.spaceReclaimed,
        duration: stats.duration
      }, 'Database cleanup completed');
      
      this.emit('cleanup_completed', stats);
      return stats;

    } catch (error) {
      this.logger.error({ error }, 'Database cleanup failed');
      this.emit('cleanup_failed', error);
      throw error;
    }
  }

  /**
   * Get active archival jobs
   */
  getActiveJobs(): ArchivalJob[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Get archival job history
   */
  getJobHistory(limit?: number): ArchivalJob[] {
    const history = [...this.jobHistory].sort((a, b) => 
      b.startTime.getTime() - a.startTime.getTime()
    );
    
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Cancel an active archival job
   */
  cancelJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }

    job.status = 'cancelled';
    job.endTime = new Date();
    
    this.logger.info({ jobId }, 'Archival job cancelled');
    this.emit('job_cancelled', job);
    
    return true;
  }

  /**
   * Get archival statistics
   */
  getStatistics(): {
    policies: { total: number; enabled: number };
    jobs: { active: number; completed: number; failed: number };
    dataProcessed: { records: number; bytes: number };
  } {
    const policies = Array.from(this.policies.values());
    const jobs = this.jobHistory;

    return {
      policies: {
        total: policies.length,
        enabled: policies.filter(p => p.enabled).length
      },
      jobs: {
        active: this.activeJobs.size,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length
      },
      dataProcessed: {
        records: jobs.reduce((sum, j) => sum + j.recordsProcessed, 0),
        bytes: jobs.reduce((sum, j) => sum + j.bytesProcessed, 0)
      }
    };
  }

  /**
   * Shutdown archival manager
   */
  async shutdown(): Promise<void> {
    // Cancel all scheduled jobs
    for (const [name, timer] of this.scheduledJobs.entries()) {
      clearTimeout(timer);
      this.logger.debug({ policy: name }, 'Cancelled scheduled archival job');
    }
    this.scheduledJobs.clear();

    // Wait for active jobs to complete or cancel them
    if (this.activeJobs.size > 0) {
      this.logger.info({ activeJobs: this.activeJobs.size }, 'Waiting for active archival jobs to complete');
      
      // Cancel all active jobs
      for (const job of this.activeJobs.values()) {
        this.cancelJob(job.id);
      }
    }

    this.logger.info('Archival manager shut down');
  }

  // Private methods

  private setupDefaultPolicies(): void {
    // Policy for completed relays older than 30 days
    this.addPolicy({
      name: 'completed_relays_30d',
      description: 'Archive completed relays older than 30 days',
      enabled: true,
      table: 'pending_relays',
      conditions: "status IN ('completed', 'refunded')",
      dateColumn: 'updated_at',
      retentionPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
      batchSize: 1000,
      destination: {
        type: 'archive',
        format: 'json',
        compression: 'gzip'
      },
      schedule: '0 2 * * 0', // Weekly at 2 AM on Sunday
      dryRun: false,
      maxRecordsPerRun: 10000,
      preserveReferences: true
    });

    // Policy for old relay attempts
    this.addPolicy({
      name: 'relay_attempts_7d',
      description: 'Delete relay attempts older than 7 days',
      enabled: true,
      table: 'relay_attempts',
      conditions: "status IN ('success', 'failed', 'timeout')",
      dateColumn: 'completed_at',
      retentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
      batchSize: 5000,
      destination: {
        type: 'delete'
      },
      schedule: '0 3 * * *', // Daily at 3 AM
      dryRun: false,
      maxRecordsPerRun: 50000,
      preserveReferences: false
    });

    // Policy for old metrics snapshots
    this.addPolicy({
      name: 'metrics_snapshots_90d',
      description: 'Archive metrics snapshots older than 90 days',
      enabled: true,
      table: 'metrics_snapshots',
      conditions: '1=1', // All records
      dateColumn: 'timestamp',
      retentionPeriod: 90 * 24 * 60 * 60 * 1000, // 90 days
      batchSize: 2000,
      destination: {
        type: 'compress',
        format: 'json',
        compression: 'gzip'
      },
      schedule: '0 1 1 * *', // Monthly on 1st at 1 AM
      dryRun: false,
      maxRecordsPerRun: 100000,
      preserveReferences: false
    });
  }

  private schedulePolicies(): void {
    for (const policy of this.policies.values()) {
      if (policy.enabled) {
        this.schedulePolicy(policy);
      }
    }
  }

  private schedulePolicy(policy: ArchivalPolicy): void {
    // This is a simplified scheduler - in production, use a proper cron library
    const scheduleJob = () => {
      this.executePolicy(policy.name).catch(error => {
        this.logger.error({ error, policy: policy.name }, 'Scheduled archival policy failed');
      });
    };

    // Parse basic cron expressions (simplified)
    const cronParts = policy.schedule.split(' ');
    if (cronParts.length === 5) {
      // For demo purposes, just schedule to run every hour
      // In production, use a proper cron parser like node-cron
      const timer = setInterval(scheduleJob, 60 * 60 * 1000); // 1 hour
      this.scheduledJobs.set(policy.name, timer);
      
      this.logger.info({ policy: policy.name, schedule: policy.schedule }, 'Scheduled archival policy');
    }
  }

  private async runArchivalJob(job: ArchivalJob): Promise<void> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL connection not available');
    }

    job.status = 'running';
    const { policy } = job;
    const client = await this.pgPool.connect();

    try {
      // Calculate cutoff date
      const cutoffDate = new Date(Date.now() - policy.retentionPeriod);
      
      // Build query to find records to archive
      const countQuery = `
        SELECT COUNT(*) as count 
        FROM ${policy.table} 
        WHERE ${policy.conditions} 
        AND ${policy.dateColumn} < $1
      `;
      
      const countResult = await client.query(countQuery, [cutoffDate]);
      const totalRecords = parseInt(countResult.rows[0].count);
      
      if (totalRecords === 0) {
        this.logger.info({ policy: policy.name }, 'No records found for archival');
        return;
      }

      const maxRecords = Math.min(totalRecords, policy.maxRecordsPerRun);
      this.logger.info({ 
        policy: policy.name, 
        totalRecords, 
        maxRecords,
        cutoffDate 
      }, 'Starting archival processing');

      // Process in batches
      let offset = 0;
      const batchSize = policy.batchSize;

      while (offset < maxRecords) {
        const batchStartTime = Date.now();
        const currentBatchSize = Math.min(batchSize, maxRecords - offset);

        // Select batch of records
        const selectQuery = `
          SELECT * FROM ${policy.table} 
          WHERE ${policy.conditions} 
          AND ${policy.dateColumn} < $1
          ORDER BY ${policy.dateColumn}
          LIMIT $2 OFFSET $3
        `;

        const batchResult = await client.query(selectQuery, [cutoffDate, currentBatchSize, offset]);
        const records = batchResult.rows;

        if (records.length === 0) break;

        // Process records based on destination type
        switch (policy.destination.type) {
          case 'archive':
            await this.archiveRecords(records, policy);
            job.recordsArchived += records.length;
            break;
            
          case 'compress':
            await this.compressRecords(records, policy);
            job.recordsArchived += records.length;
            break;
            
          case 'delete':
            // Just delete the records
            break;
        }

        // Delete records if not dry run
        if (!policy.dryRun) {
          const recordIds = records.map(r => r.id);
          const deleteQuery = `DELETE FROM ${policy.table} WHERE id = ANY($1)`;
          await client.query(deleteQuery, [recordIds]);
          job.recordsDeleted += records.length;
        }

        job.recordsProcessed += records.length;
        job.metrics.queriesExecuted += 2; // SELECT + DELETE
        
        const batchTime = Date.now() - batchStartTime;
        job.metrics.avgBatchTime = ((job.metrics.avgBatchTime * (offset / batchSize)) + batchTime) / ((offset / batchSize) + 1);

        offset += currentBatchSize;

        // Emit progress event
        this.emit('job_progress', {
          jobId: job.id,
          processed: job.recordsProcessed,
          total: maxRecords,
          percentage: (job.recordsProcessed / maxRecords) * 100
        });

        // Small delay to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } finally {
      client.release();
    }
  }

  private async archiveRecords(records: any[], policy: ArchivalPolicy): Promise<void> {
    if (!policy.destination.location) {
      throw new Error('Archive location not specified');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${policy.name}_${timestamp}.${policy.destination.format}`;
    const filepath = `${policy.destination.location}/${filename}`;

    // Create write stream with optional compression
    let writeStream = createWriteStream(filepath);
    
    if (policy.destination.compression === 'gzip') {
      const gzipStream = createGzip();
      await pipeline(
        this.recordsToStream(records, policy.destination.format!),
        gzipStream,
        writeStream
      );
    } else {
      await pipeline(
        this.recordsToStream(records, policy.destination.format!),
        writeStream
      );
    }

    this.logger.debug({ 
      policy: policy.name, 
      records: records.length, 
      filepath 
    }, 'Records archived to file');
  }

  private async compressRecords(records: any[], policy: ArchivalPolicy): Promise<void> {
    // Similar to archive but compress in place
    this.logger.debug({ 
      policy: policy.name, 
      records: records.length 
    }, 'Records compressed (placeholder implementation)');
  }

  private recordsToStream(records: any[], format: string): NodeJS.ReadableStream {
    // Convert records to specified format
    const { Readable } = require('stream');
    
    return new Readable({
      objectMode: false,
      read() {
        if (records.length === 0) {
          this.push(null);
          return;
        }

        const record = records.shift();
        let data: string;

        switch (format) {
          case 'json':
            data = JSON.stringify(record) + '\n';
            break;
          case 'csv':
            // Simple CSV implementation
            data = Object.values(record).join(',') + '\n';
            break;
          default:
            data = JSON.stringify(record) + '\n';
        }

        this.push(data);
      }
    });
  }

  private async getTableSizes(client: PoolClient, tables: string[]): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    
    for (const table of tables) {
      try {
        const result = await client.query(`
          SELECT pg_total_relation_size($1) as size
        `, [table]);
        
        sizes.set(table, parseInt(result.rows[0].size) || 0);
      } catch (error) {
        this.logger.error({ error, table }, 'Failed to get table size');
        sizes.set(table, 0);
      }
    }
    
    return sizes;
  }

  private generateJobId(policyName: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substr(2, 8);
    return `${policyName}_${timestamp}_${random}`;
  }

  private addToJobHistory(job: ArchivalJob): void {
    this.jobHistory.push(job);
    
    // Trim history if too large
    if (this.jobHistory.length > this.config.jobHistoryLimit) {
      this.jobHistory = this.jobHistory
        .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
        .slice(0, this.config.jobHistoryLimit);
    }
  }
}
/**
 * Database migration system for the 1inch Fusion+ Cosmos Relayer
 * 
 * Handles schema versioning, migrations, and rollbacks with integrity checks
 */

import { Pool, PoolClient } from 'pg';
import { Logger } from 'pino';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

export interface Migration {
  version: number;
  name: string;
  description: string;
  upSql: string;
  downSql: string;
  checksum: string;
  createdAt: Date;
}

export interface MigrationRecord {
  version: number;
  name: string;
  description: string;
  checksum: string;
  applied_at: Date;
  execution_time_ms: number;
}

export class DatabaseMigrator {
  private pool: Pool;
  private logger: Logger;
  private migrationsPath: string;

  constructor(pool: Pool, logger: Logger, migrationsPath: string = './migrations') {
    this.pool = pool;
    this.logger = logger.child({ component: 'DatabaseMigrator' });
    this.migrationsPath = migrationsPath;
  }

  /**
   * Initialize migration system and create schema_migrations table
   */
  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create migrations table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          checksum VARCHAR(64) NOT NULL,
          applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
          execution_time_ms INTEGER NOT NULL DEFAULT 0,
          applied_by VARCHAR(100) DEFAULT current_user
        )
      `);

      // Create migration lock table for concurrent safety
      await client.query(`
        CREATE TABLE IF NOT EXISTS migration_lock (
          id INTEGER PRIMARY KEY DEFAULT 1,
          locked_at TIMESTAMP NOT NULL DEFAULT NOW(),
          locked_by VARCHAR(100) NOT NULL DEFAULT current_user,
          process_id VARCHAR(100),
          
          CONSTRAINT single_lock CHECK (id = 1)
        )
      `);

      await client.query('COMMIT');
      this.logger.info('Migration system initialized');
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error({ error }, 'Failed to initialize migration system');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Run all pending migrations
   */
  async migrate(): Promise<MigrationRecord[]> {
    const lock = await this.acquireLock();
    
    try {
      const migrations = await this.loadMigrations();
      const appliedMigrations = await this.getAppliedMigrations();
      const pendingMigrations = this.getPendingMigrations(migrations, appliedMigrations);

      if (pendingMigrations.length === 0) {
        this.logger.info('No pending migrations');
        return [];
      }

      this.logger.info({ count: pendingMigrations.length }, 'Running pending migrations');
      
      const appliedRecords: MigrationRecord[] = [];

      for (const migration of pendingMigrations) {
        const record = await this.applyMigration(migration);
        appliedRecords.push(record);
      }

      this.logger.info({ count: appliedRecords.length }, 'Successfully applied migrations');
      return appliedRecords;

    } finally {
      await this.releaseLock(lock);
    }
  }

  /**
   * Rollback to a specific migration version
   */
  async rollback(targetVersion: number): Promise<MigrationRecord[]> {
    const lock = await this.acquireLock();
    
    try {
      const migrations = await this.loadMigrations();
      const appliedMigrations = await this.getAppliedMigrations();
      
      // Find migrations to rollback (in reverse order)
      const toRollback = appliedMigrations
        .filter(m => m.version > targetVersion)
        .sort((a, b) => b.version - a.version);

      if (toRollback.length === 0) {
        this.logger.info({ targetVersion }, 'No migrations to rollback');
        return [];
      }

      this.logger.warn({ 
        count: toRollback.length, 
        targetVersion 
      }, 'Rolling back migrations');

      const rolledBackRecords: MigrationRecord[] = [];

      for (const appliedMigration of toRollback) {
        const migration = migrations.find(m => m.version === appliedMigration.version);
        if (!migration) {
          throw new Error(`Migration ${appliedMigration.version} not found for rollback`);
        }

        const record = await this.rollbackMigration(migration, appliedMigration);
        rolledBackRecords.push(record);
      }

      this.logger.warn({ 
        count: rolledBackRecords.length 
      }, 'Successfully rolled back migrations');
      
      return rolledBackRecords;

    } finally {
      await this.releaseLock(lock);
    }
  }

  /**
   * Get current database version
   */
  async getCurrentVersion(): Promise<number> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT COALESCE(MAX(version), 0) as version 
        FROM schema_migrations
      `);
      
      return result.rows[0].version;
    } finally {
      client.release();
    }
  }

  /**
   * Check database health and migration integrity
   */
  async checkIntegrity(): Promise<{
    healthy: boolean;
    currentVersion: number;
    issues: string[];
  }> {
    const client = await this.pool.connect();
    const issues: string[] = [];
    
    try {
      const currentVersion = await this.getCurrentVersion();
      const migrations = await this.loadMigrations();
      const appliedMigrations = await this.getAppliedMigrations();

      // Check for checksum mismatches
      for (const applied of appliedMigrations) {
        const migration = migrations.find(m => m.version === applied.version);
        if (!migration) {
          issues.push(`Applied migration ${applied.version} not found in migration files`);
          continue;
        }

        if (migration.checksum !== applied.checksum) {
          issues.push(`Checksum mismatch for migration ${applied.version}`);
        }
      }

      // Check for missing migrations
      const maxAppliedVersion = Math.max(...appliedMigrations.map(m => m.version), 0);
      const missingMigrations = migrations.filter(m => 
        m.version <= maxAppliedVersion && !appliedMigrations.find(a => a.version === m.version)
      );

      if (missingMigrations.length > 0) {
        issues.push(`Missing applied migrations: ${missingMigrations.map(m => m.version).join(', ')}`);
      }

      return {
        healthy: issues.length === 0,
        currentVersion,
        issues
      };

    } finally {
      client.release();
    }
  }

  /**
   * Generate a new migration file template
   */
  generateMigration(name: string, description: string): string {
    const version = Date.now(); // Use timestamp as version
    const fileName = `${version}_${name.replace(/\s+/g, '_').toLowerCase()}.sql`;
    
    const template = `-- Migration: ${name}
-- Description: ${description}
-- Version: ${version}
-- Created: ${new Date().toISOString()}

-- UP Migration
-- Write your forward migration here
CREATE TABLE IF NOT EXISTS example_table (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- DOWN Migration (Rollback)
-- Write your rollback migration here
-- Separate UP and DOWN sections with: -- ROLLBACK --
-- ROLLBACK --
DROP TABLE IF EXISTS example_table;
`;

    this.logger.info({ fileName, version }, 'Generated migration template');
    return template;
  }

  // Private methods

  private async loadMigrations(): Promise<Migration[]> {
    const migrations: Migration[] = [];
    
    try {
      const files = readdirSync(this.migrationsPath)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const filePath = join(this.migrationsPath, file);
        const content = readFileSync(filePath, 'utf-8');
        const migration = this.parseMigrationFile(file, content);
        migrations.push(migration);
      }

      return migrations.sort((a, b) => a.version - b.version);
      
    } catch (error) {
      this.logger.error({ error, path: this.migrationsPath }, 'Failed to load migrations');
      throw new Error(`Failed to load migrations from ${this.migrationsPath}`);
    }
  }

  private parseMigrationFile(fileName: string, content: string): Migration {
    // Extract metadata from comments
    const versionMatch = content.match(/-- Version: (\d+)/);
    const nameMatch = content.match(/-- Migration: (.+)/);
    const descriptionMatch = content.match(/-- Description: (.+)/);

    if (!versionMatch) {
      throw new Error(`Migration ${fileName} missing version number`);
    }

    const version = parseInt(versionMatch[1]);
    const name = nameMatch?.[1]?.trim() || fileName.replace('.sql', '');
    const description = descriptionMatch?.[1]?.trim() || '';

    // Split into UP and DOWN migrations
    const parts = content.split('-- ROLLBACK --');
    const upSql = parts[0].replace(/^-- .+$/gm, '').trim();
    const downSql = parts[1]?.replace(/^-- .+$/gm, '').trim() || '';

    // Calculate checksum
    const checksum = createHash('sha256').update(upSql + downSql).digest('hex');

    return {
      version,
      name,
      description,
      upSql,
      downSql,
      checksum,
      createdAt: new Date()
    };
  }

  private async getAppliedMigrations(): Promise<MigrationRecord[]> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT version, name, description, checksum, applied_at, execution_time_ms
        FROM schema_migrations 
        ORDER BY version
      `);
      
      return result.rows.map(row => ({
        version: row.version,
        name: row.name,
        description: row.description,
        checksum: row.checksum,
        applied_at: row.applied_at,
        execution_time_ms: row.execution_time_ms
      }));
    } finally {
      client.release();
    }
  }

  private getPendingMigrations(
    allMigrations: Migration[], 
    appliedMigrations: MigrationRecord[]
  ): Migration[] {
    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    return allMigrations.filter(m => !appliedVersions.has(m.version));
  }

  private async applyMigration(migration: Migration): Promise<MigrationRecord> {
    const client = await this.pool.connect();
    const startTime = Date.now();
    
    try {
      await client.query('BEGIN');
      
      this.logger.info({
        version: migration.version,
        name: migration.name
      }, 'Applying migration');

      // Execute the migration SQL
      await client.query(migration.upSql);
      
      // Record the migration
      const executionTime = Date.now() - startTime;
      await client.query(`
        INSERT INTO schema_migrations (version, name, description, checksum, execution_time_ms)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        migration.version,
        migration.name,
        migration.description,
        migration.checksum,
        executionTime
      ]);

      await client.query('COMMIT');
      
      this.logger.info({
        version: migration.version,
        name: migration.name,
        executionTime
      }, 'Migration applied successfully');

      return {
        version: migration.version,
        name: migration.name,
        description: migration.description,
        checksum: migration.checksum,
        applied_at: new Date(),
        execution_time_ms: executionTime
      };

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error({
        error,
        version: migration.version,
        name: migration.name
      }, 'Migration failed');
      throw error;
    } finally {
      client.release();
    }
  }

  private async rollbackMigration(
    migration: Migration, 
    appliedMigration: MigrationRecord
  ): Promise<MigrationRecord> {
    const client = await this.pool.connect();
    const startTime = Date.now();
    
    try {
      await client.query('BEGIN');
      
      this.logger.warn({
        version: migration.version,
        name: migration.name
      }, 'Rolling back migration');

      if (!migration.downSql) {
        throw new Error(`No rollback SQL provided for migration ${migration.version}`);
      }

      // Execute the rollback SQL
      await client.query(migration.downSql);
      
      // Remove from migrations table
      await client.query(`
        DELETE FROM schema_migrations WHERE version = $1
      `, [migration.version]);

      await client.query('COMMIT');
      
      const executionTime = Date.now() - startTime;
      
      this.logger.warn({
        version: migration.version,
        name: migration.name,
        executionTime
      }, 'Migration rolled back successfully');

      return {
        ...appliedMigration,
        execution_time_ms: executionTime
      };

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error({
        error,
        version: migration.version,
        name: migration.name
      }, 'Migration rollback failed');
      throw error;
    } finally {
      client.release();
    }
  }

  private async acquireLock(): Promise<string> {
    const client = await this.pool.connect();
    const lockId = `migration_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Try to acquire lock with timeout
      const result = await client.query(`
        INSERT INTO migration_lock (locked_at, locked_by, process_id)
        VALUES (NOW(), current_user, $1)
        ON CONFLICT (id) DO NOTHING
        RETURNING process_id
      `, [lockId]);

      if (result.rows.length === 0) {
        // Lock is already held, check age
        const lockResult = await client.query(`
          SELECT locked_at, locked_by, process_id,
                 EXTRACT(EPOCH FROM (NOW() - locked_at)) as age_seconds
          FROM migration_lock WHERE id = 1
        `);

        if (lockResult.rows.length > 0) {
          const lock = lockResult.rows[0];
          
          // If lock is older than 10 minutes, force release
          if (lock.age_seconds > 600) {
            this.logger.warn({
              age: lock.age_seconds,
              lockedBy: lock.locked_by
            }, 'Forcing release of stale migration lock');
            
            await client.query('DELETE FROM migration_lock WHERE id = 1');
            return this.acquireLock(); // Retry
          }
          
          throw new Error(`Migration lock held by ${lock.locked_by} (${lock.age_seconds}s ago)`);
        }
      }

      this.logger.debug({ lockId }, 'Acquired migration lock');
      return lockId;

    } finally {
      client.release();
    }
  }

  private async releaseLock(lockId: string): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query(`
        DELETE FROM migration_lock 
        WHERE id = 1 AND process_id = $1
      `, [lockId]);
      
      this.logger.debug({ lockId }, 'Released migration lock');
    } finally {
      client.release();
    }
  }
}

/**
 * Migration CLI utility
 */
export class MigrationCLI {
  private migrator: DatabaseMigrator;
  private logger: Logger;

  constructor(migrator: DatabaseMigrator, logger: Logger) {
    this.migrator = migrator;
    this.logger = logger;
  }

  async run(command: string, args: string[]): Promise<void> {
    try {
      await this.migrator.initialize();

      switch (command) {
        case 'migrate':
          await this.runMigrations();
          break;
          
        case 'rollback':
          const version = parseInt(args[0]);
          if (isNaN(version)) {
            throw new Error('Rollback requires a valid version number');
          }
          await this.runRollback(version);
          break;
          
        case 'status':
          await this.showStatus();
          break;
          
        case 'check':
          await this.checkIntegrity();
          break;
          
        case 'generate':
          const name = args[0];
          const description = args.slice(1).join(' ');
          if (!name) {
            throw new Error('Generate requires a migration name');
          }
          this.generateMigration(name, description);
          break;
          
        default:
          this.showHelp();
      }
    } catch (error) {
      this.logger.error({ error }, `Migration command failed: ${command}`);
      process.exit(1);
    }
  }

  private async runMigrations(): Promise<void> {
    const applied = await this.migrator.migrate();
    if (applied.length === 0) {
      console.log('✅ Database is up to date');
    } else {
      console.log(`✅ Applied ${applied.length} migrations:`);
      applied.forEach(m => {
        console.log(`  - ${m.version}: ${m.name} (${m.execution_time_ms}ms)`);
      });
    }
  }

  private async runRollback(version: number): Promise<void> {
    const rolledBack = await this.migrator.rollback(version);
    if (rolledBack.length === 0) {
      console.log(`✅ Already at version ${version}`);
    } else {
      console.log(`⚠️  Rolled back ${rolledBack.length} migrations to version ${version}:`);
      rolledBack.forEach(m => {
        console.log(`  - ${m.version}: ${m.name}`);
      });
    }
  }

  private async showStatus(): Promise<void> {
    const currentVersion = await this.migrator.getCurrentVersion();
    console.log(`📊 Current database version: ${currentVersion}`);
  }

  private async checkIntegrity(): Promise<void> {
    const result = await this.migrator.checkIntegrity();
    
    if (result.healthy) {
      console.log(`✅ Database integrity OK (version ${result.currentVersion})`);
    } else {
      console.log(`❌ Database integrity issues found:`);
      result.issues.forEach(issue => {
        console.log(`  - ${issue}`);
      });
    }
  }

  private generateMigration(name: string, description: string): void {
    const template = this.migrator.generateMigration(name, description);
    console.log('📝 Migration template:');
    console.log('');
    console.log(template);
  }

  private showHelp(): void {
    console.log(`
Database Migration CLI

Commands:
  migrate              Run all pending migrations
  rollback <version>   Rollback to specific version
  status               Show current database version
  check                Check migration integrity
  generate <name>      Generate new migration template
  
Examples:
  npm run migrate
  npm run migrate rollback 20250801000000
  npm run migrate status
  npm run migrate check
  npm run migrate generate "add_user_table" "Add user authentication table"
`);
  }
}
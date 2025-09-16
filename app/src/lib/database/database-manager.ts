import { DatabaseAdapter, DatabaseConfig, DatabaseResult, DatabaseRow } from './types';
import { logger } from '../request-context';
import path from 'path';

/**
 * Database Manager that switches between SQLite (dev) and MySQL (prod)
 * Provides a unified interface for all database operations
 */
// Global variable to persist across Next.js hot reloads
declare global {
  var __databaseManager: DatabaseManager | undefined;
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private adapter: DatabaseAdapter;
  private hasMySqlCredentials: boolean;
  private schemaInitialized: boolean = false;
  private schemaInitializing: Promise<void> | null = null;

  private constructor() {
    // Check for MySQL via DATABASE_URL or individual MySQL env vars
    const hasDatabaseUrl = process.env.DATABASE_URL?.startsWith('mysql://');
    const hasIndividualMysqlVars = !!process.env.MYSQL_DB_USERNAME && !!process.env.MYSQL_DB_PASSWORD &&
      !!process.env.MYSQL_DB_PATH && !!process.env.MYSQL_DB_PORT && !!process.env.MYSQL_DB_NAME;
    
    this.hasMySqlCredentials = hasDatabaseUrl || hasIndividualMysqlVars;

    logger.info('db_manager_init', '🔍 DatabaseManager initialization', {
      data: {
        hasDatabaseUrl,
        hasIndividualMysqlVars,
        willUseMysql: this.hasMySqlCredentials,
        databaseUrl: process.env.DATABASE_URL ? 'set' : 'unset'
      }
    });

    this.adapter = this.createAdapter();
    // Don't initialize schema in constructor - do it lazily on first use
  }

  public static getInstance(): DatabaseManager {
    // Use global variable to persist across Next.js hot reloads in development
    if (process.env.NODE_ENV === 'development') {
      if (!global.__databaseManager) {
        global.__databaseManager = new DatabaseManager();
      }
      return global.__databaseManager;
    }

    // Use standard singleton in production
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private createAdapter(): DatabaseAdapter {
    if (this.hasMySqlCredentials) {
      // Parse MySQL configuration from DATABASE_URL or individual env vars
      let config: DatabaseConfig;
      
      if (process.env.DATABASE_URL?.startsWith('mysql://')) {
        // Parse DATABASE_URL format: mysql://user:password@host:port/database
        const url = new URL(process.env.DATABASE_URL);
        config = {
          type: 'mysql',
          host: url.hostname,
          port: parseInt(url.port) || 3306,
          user: url.username,
          password: url.password,
          database: url.pathname.slice(1) // Remove leading slash
        };
        logger.info('db_mysql_connection', `🔌 Connecting to MySQL via DATABASE_URL: ${config.host}:${config.port}/${config.database}`);
      } else {
        // Use individual MySQL env vars (legacy)
        config = {
          type: 'mysql',
          host: process.env.MYSQL_DB_PATH || 'placeholder-rds-host.region.rds.amazonaws.com',
          port: parseInt(process.env.MYSQL_DB_PORT || '3306'),
          user: process.env.MYSQL_DB_USERNAME,
          password: process.env.MYSQL_DB_PASSWORD,
          database: process.env.MYSQL_DB_NAME || 'airo_builder'
        };
        logger.info('db_mysql_connection', `🔌 Connecting to MySQL via individual env vars: ${config.host}`);
      }

      if (!config.user || !config.password) {
        throw new Error('MySQL user and password must be provided via DATABASE_URL or MYSQL_DB_* env vars');
      }

      // Dynamic import - only load MySQL adapter in production
      const { MySQLAdapter } = require('./mysql-adapter');
      return new MySQLAdapter(config);
    } else {
      // Development: Use SQLite - Only load SQLite adapter
      const config: DatabaseConfig = {
        type: 'sqlite',
        path: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'airo-builder-platform.db')
      };

      // SQLite connection - configuration logged at startup

      // Dynamic import - only load SQLite adapter in development
      const { SQLiteAdapter } = require('./sqlite-adapter');
      return new SQLiteAdapter(config);
    }
  }

  /**
   * Ensure schema is initialized before any database operation
   */
  private async ensureSchemaInitialized(): Promise<void> {
    if (this.schemaInitialized) {
      return;
    }

    if (this.schemaInitializing) {
      logger.info('db_schema_init', '🔄 Schema initialization already in progress, waiting...');
      await this.schemaInitializing;
      return;
    }

    logger.info('db_schema_init', '🚀 Starting database schema initialization...');
    this.schemaInitializing = this.initializeSchema();
    await this.schemaInitializing;
    this.schemaInitialized = true;
    this.schemaInitializing = null;
    logger.info('db_schema_init', '✅ Database schema initialization completed');
  }

  private async initializeSchema(): Promise<void> {
    try {
      // Use the same logic as adapter creation to determine which schema to use
      if (this.hasMySqlCredentials) {
        await this.initializeMySQLSchema();
      } else {
        await this.initializeSQLiteSchema();
      }

      logger.info('db_schema_init', '✅ Database schema initialized successfully');
    } catch (error) {
      logger.error('db_schema_init', '❌ Error initializing database schema', { error: error as Error });
      throw error;
    }
  }

  private async initializeMySQLSchema(): Promise<void> {
    logger.info('db_mysql_schema', '🔧 Initializing MySQL schema in production...');

    // Check if tables already exist (e.g., from Prisma migrations)
    try {
      const result = await this.adapter.get<{count: number}>(
        "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'accounts'"
      );
      if (result && result.count > 0) {
        logger.info('db_mysql_schema', '✅ Database tables already exist (likely from Prisma), skipping custom initialization');
        return;
      }
    } catch (error) {
      logger.warn('db_mysql_schema', '⚠️ Could not check existing tables, proceeding with initialization', { error: error as Error });
    }

    // MySQL-specific schema initialization
    const plansTableSQL = `
      CREATE TABLE IF NOT EXISTS plans (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        site_limit INT DEFAULT 10,
        price DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `;

    const accountsTableSQL = `
      CREATE TABLE IF NOT EXISTS accounts (
        id VARCHAR(36) PRIMARY KEY,
        shopper_id VARCHAR(50) UNIQUE NOT NULL,
        customer_id VARCHAR(50) UNIQUE NOT NULL,
        plan_id VARCHAR(36),
        status ENUM('active', 'suspended', 'closed') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `;

    const sitesTableSQL = `
      CREATE TABLE IF NOT EXISTS sites (
        id VARCHAR(36) PRIMARY KEY,
        account_id VARCHAR(36) NOT NULL,
        title VARCHAR(255),
        initial_prompt TEXT,
        domain VARCHAR(255),
        agent_url TEXT,
        backend_url TEXT,
        preview_url TEXT,
        ceph_mount_id TEXT,
        ceph_dir_number TEXT,
        status ENUM('init', 'creating', 'created', 'running', 'stopped', 'error', 'failed') DEFAULT 'init',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
    `;

    const sitesIndexSQL = `CREATE INDEX IF NOT EXISTS idx_sites_account_id ON sites(account_id);`;
    const sitesCephIndexSQL = `CREATE INDEX IF NOT EXISTS idx_sites_ceph ON sites(ceph_mount_id, ceph_dir_number);`;

    const defaultPlansSQL = `
      INSERT IGNORE INTO plans (id, name, site_limit, price) VALUES
      ('550e8400-e29b-41d4-a716-446655440001', 'Free', 10, 5.00),
      ('550e8400-e29b-41d4-a716-446655440002', 'Starter', 30, 20.00),
      ('550e8400-e29b-41d4-a716-446655440003', 'Pro', 100, 50.00);
    `;

    logger.info('db_mysql_schema', '📋 Creating plans table...');
    await this.adapter.exec(plansTableSQL);

    logger.info('db_mysql_schema', '👤 Creating accounts table...');
    await this.adapter.exec(accountsTableSQL);

    logger.info('db_mysql_schema', '🌐 Creating sites table...');
    await this.adapter.exec(sitesTableSQL);

    logger.info('db_mysql_schema', '📊 Creating indexes...');
    await this.adapter.exec(sitesIndexSQL);
    await this.adapter.exec(sitesCephIndexSQL);

    logger.info('db_mysql_schema', '🗂️ Inserting default plans...');
    await this.adapter.exec(defaultPlansSQL);

    logger.info('db_mysql_schema', '✅ MySQL schema initialization completed successfully');
  }

  private async initializeSQLiteSchema(): Promise<void> {
    logger.info('db_sqlite_schema', '🔧 Initializing SQLite schema in development...');

    // Check if tables already exist (e.g., from Prisma migrations)
    try {
      const result = await this.adapter.get<{count: number}>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='accounts'"
      );
      if (result && result.count > 0) {
        logger.info('db_sqlite_schema', '✅ Database tables already exist (likely from Prisma), skipping custom initialization');
        return;
      }
    } catch (error) {
      logger.warn('db_sqlite_schema', '⚠️ Could not check existing tables, proceeding with initialization', { error: error as Error });
    }

    // Keep the original SQLite schema initialization logic
    const plansTableSQL = `
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        site_limit INTEGER DEFAULT 10,
        price DECIMAL(10,2) DEFAULT 0.00,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const accountsTableSQL = `
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        shopper_id VARCHAR(50) UNIQUE NOT NULL,
        customer_id VARCHAR(50) UNIQUE NOT NULL,
        plan_id TEXT,
        status TEXT CHECK(status IN ('active', 'suspended', 'closed')) DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const sitesTableSQL = `
      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        title VARCHAR(255),
        initial_prompt TEXT,
        domain VARCHAR(255),
        agent_url TEXT,
        backend_url TEXT,
        preview_url TEXT,
        ceph_mount_id TEXT,
        ceph_dir_number TEXT,
        status TEXT CHECK(status IN ('creating', 'created', 'running', 'stopped', 'error', 'failed')) DEFAULT 'stopped',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
    `;

    // SQLite triggers for updated_at
    const accountsTriggerSQL = `
      CREATE TRIGGER IF NOT EXISTS update_accounts_updated_at
      AFTER UPDATE ON accounts
      FOR EACH ROW
      BEGIN
        UPDATE accounts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `;

    const plansTriggerSQL = `
      CREATE TRIGGER IF NOT EXISTS update_plans_updated_at
      AFTER UPDATE ON plans
      FOR EACH ROW
      BEGIN
        UPDATE plans SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `;

    const sitesTriggerSQL = `
      CREATE TRIGGER IF NOT EXISTS update_sites_updated_at
      AFTER UPDATE ON sites
      FOR EACH ROW
      BEGIN
        UPDATE sites SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `;

    const sitesIndexSQL = `CREATE INDEX IF NOT EXISTS idx_sites_account_id ON sites(account_id);`;
    const sitesCephIndexSQL = `CREATE INDEX IF NOT EXISTS idx_sites_ceph ON sites(ceph_mount_id, ceph_dir_number);`;

    const defaultPlansSQL = `
      INSERT OR IGNORE INTO plans (id, name, site_limit, price) VALUES
      ('550e8400-e29b-41d4-a716-446655440001', 'Free', 10, 5.00),
      ('550e8400-e29b-41d4-a716-446655440002', 'Starter', 30, 20.00),
      ('550e8400-e29b-41d4-a716-446655440003', 'Pro', 100, 50.00);
    `;

    logger.info('db_sqlite_schema', '📋 Creating plans table...');
    await this.adapter.exec(plansTableSQL);

    logger.info('db_sqlite_schema', '👤 Creating accounts table...');
    await this.adapter.exec(accountsTableSQL);

    logger.info('db_sqlite_schema', '🌐 Creating sites table...');
    await this.adapter.exec(sitesTableSQL);

    logger.info('db_sqlite_schema', '⚡ Creating triggers...');
    await this.adapter.exec(accountsTriggerSQL);
    await this.adapter.exec(plansTriggerSQL);
    await this.adapter.exec(sitesTriggerSQL);

    logger.info('db_sqlite_schema', '📊 Creating indexes...');
    await this.adapter.exec(sitesIndexSQL);
    await this.adapter.exec(sitesCephIndexSQL);

    logger.info('db_sqlite_schema', '🗂️ Inserting default plans...');
    await this.adapter.exec(defaultPlansSQL);

    logger.info('db_sqlite_schema', '✅ SQLite schema initialization completed successfully');
  }

  // Helper methods that handle both sync and async responses
  public async run(sql: string, params: unknown[] = []): Promise<DatabaseResult> {
    await this.ensureSchemaInitialized();
    const result = this.adapter.run(sql, params);
    return result instanceof Promise ? await result : result;
  }

  public async get<T = DatabaseRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    await this.ensureSchemaInitialized();
    const result = this.adapter.get<T>(sql, params);
    return result instanceof Promise ? await result : result;
  }

  public async all<T = DatabaseRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ensureSchemaInitialized();
    const result = this.adapter.all<T>(sql, params);
    return result instanceof Promise ? await result : result;
  }

  public async exec(sql: string): Promise<void> {
    await this.ensureSchemaInitialized();
    const result = this.adapter.exec(sql);
    if (result instanceof Promise) {
      await result;
    }
  }

  public async close(): Promise<void> {
    const result = this.adapter.close();
    if (result instanceof Promise) {
      await result;
    }
  }

  // Legacy compatibility methods (for backward compatibility with existing code)
  public getDb(): DatabaseAdapter {
    return this.adapter;
  }

  /**
   * Run essential database migrations
   * This method is environment-aware and only runs SQLite-specific migrations in development
   */
  private async runMigrations(): Promise<void> {
    if (this.hasMySqlCredentials) {
      // MySQL: No legacy migrations needed for new production databases
      logger.info('db_migration', '🔍 MySQL production database - no legacy migrations needed');
      return;
    }

    // SQLite: Run existing migrations for development
    try {
      const tableInfo = this.adapter.pragma?.('table_info(sites)') || [];

      if (tableInfo.length === 0) {
        logger.info('db_migration', '🔍 Fresh database - schema will be created by CREATE TABLE IF NOT EXISTS');
        return;
      }

      logger.info('db_migration', '🔍 Existing database detected - checking for required migrations...');
      const columns = tableInfo.map((col: any) => col.name);
      let migrationsRun = 0;

      // Add missing columns that are required for this branch
      const requiredColumns = [
        { name: 'initial_prompt', type: 'TEXT' },
        { name: 'preview_url', type: 'TEXT' },
        { name: 'backend_url', type: 'TEXT' },
        { name: 'ceph_mount_id', type: 'TEXT' },
        { name: 'ceph_dir_number', type: 'TEXT' }
      ];

      // Migration: Status constraint migration is now handled by Prisma
      // This old migration logic is deprecated and replaced by Prisma migrations
      logger.info('db_migration', '🔄 Legacy status constraint migration skipped - now handled by Prisma');

      for (const col of requiredColumns) {
        if (!columns.includes(col.name)) {
          logger.info('db_migration', `🔄 Adding missing column: ${col.name}`);
          await this.adapter.exec(`ALTER TABLE sites ADD COLUMN ${col.name} ${col.type};`);
          migrationsRun++;
        }
      }

      if (migrationsRun > 0) {
        logger.info('db_migration', `✅ Database migration completed successfully (${migrationsRun} operations)`);
      } else {
        logger.info('db_migration', '✅ Database is up to date - no migrations needed');
      }

    } catch (error) {
      logger.error('db_migration', '❌ Database migration failed', { error: error as Error });
      logger.info('db_migration', '🔄 Attempting to continue with existing schema...');
    }
  }
}

export default DatabaseManager;

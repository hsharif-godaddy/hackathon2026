import { DatabaseAdapter, DatabaseConfig, DatabaseResult, DatabaseRow } from './types';
import { logger } from '../request-context';

/**
 * Database Manager for MySQL in production
 * Provides a unified interface for all database operations
 */
// Global variable to persist across Next.js hot reloads
declare global {
  // eslint-disable-next-line no-var
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
    if (!this.hasMySqlCredentials) {
      throw new Error('MySQL configuration is required. Please set DATABASE_URL or MYSQL_DB_* environment variables.');
    }

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

    // Load MySQL adapter
    const { MySQLAdapter } = require('./mysql-adapter');
    return new MySQLAdapter(config);
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
      await this.initializeMySQLSchema();
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
   * MySQL migrations are handled by Prisma
   */
  private async runMigrations(): Promise<void> {
    // MySQL: No legacy migrations needed for new production databases
    logger.info('db_migration', '🔍 MySQL database - migrations handled by Prisma');
    return;
  }
}

export default DatabaseManager;

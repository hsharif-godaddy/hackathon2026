import { readFileSync, existsSync } from 'fs';
import { Readable } from 'stream';
import { logger } from '../logging/index.js';
import mysql, { type ResultSetHeader } from 'mysql2/promise';
import { join } from 'path';
import { getNomadAllocConfig } from './nomad-config.js';

/**
 * Database credentials interface
 */
export interface DatabaseCredentials {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * App interface for credential loading
 */
export interface App {
  id: string;
  path: string;
  [key: string]: any;
}

/**
 * Table schema column information
 */
export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  default: any;
  extra: string;
}

/**
 * Table data result with pagination
 */
export interface TableDataResult {
  rows: any[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Query building result
 */
export interface QueryResult {
  query: string;
  values: any[];
  columns?: string[];
}

/**
 * List of system tables that should not be accessible via the API
 */
export const SYSTEM_TABLES = ['__drizzle_migrations'] as const;

/**
 * Check if a table name is a protected system table
 *
 * @param tableName - Name of the table to check
 * @returns True if the table is a system table
 */
export function isSystemTable(tableName: string): boolean {
  return SYSTEM_TABLES.includes(tableName as any);
}

/**
 * Centralized MySQL utilities class for all database interactions
 * Handles connection management, credentials loading, query building, and CRUD operations
 */
export class MySQLUtils {
  /**
   * Cache of connection pools by credential key
   */
  private pools: Map<string, mysql.Pool> = new Map();

  /**
   * Generate a unique key for caching connection pools
   *
   * @param credentials - Database credentials
   * @returns Unique key string
   */
  private getPoolKey(credentials: DatabaseCredentials): string {
    return `${credentials.host}:${credentials.port}:${credentials.database}:${credentials.user}`;
  }

  /**
   * Get or create a connection pool for the given credentials
   *
   * @param credentials - Database credentials
   * @returns MySQL connection pool
   */
  private getPool(credentials: DatabaseCredentials): mysql.Pool {
    const key = this.getPoolKey(credentials);

    if (!this.pools.has(key)) {
      logger.info('MySQL: Creating new connection pool', {
        component: 'MySQLUtils',
        database: credentials.database,
        host: credentials.host,
        port: credentials.port,
      });

      const pool = mysql.createPool({
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password,
        database: credentials.database,
        ssl: {
          rejectUnauthorized: false,
        },
        connectionLimit: 10,
        waitForConnections: true,
        queueLimit: 0,
      });

      this.pools.set(key, pool);
    }

    return this.pools.get(key)!;
  }

  /**
   * Load MySQL credentials from an app's config.json file.
   * Production: uses getNomadAllocConfig() (memoized).
   * Local dev: reads from APPS_BASE_DIR/{appId}/local/preview/config.json.
   */
  async loadCredentialsFromApp(app: App): Promise<DatabaseCredentials> {
    // Production: reuse cached Nomad alloc config
    const allocConfig = getNomadAllocConfig();
    if (allocConfig) {
      return this.extractCredentials(allocConfig, app.id);
    }

    // Local development: read from task-local path
    const appsBaseDir = process.env.APPS_BASE_DIR || '/tmp/airo-app-builder';
    // nosemgrep: path-traversal — app.id is loaded from internal SQLite DB (not user input);
    // guard below rejects any path-traversal sequences as defense-in-depth.
    if (/[/\\]|\.\./.test(app.id)) {
      throw new Error(`Invalid app ID: ${app.id}`);
    }
    const configPath = join(appsBaseDir, app.id, 'local', 'preview', 'config.json');

    if (!existsSync(configPath)) {
      throw new Error(`No config.json file found for application at ${configPath}`);
    }

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      return this.extractCredentials(config, app.id);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse ${configPath}: Invalid JSON format`);
      }
      throw error;
    }
  }

  /**
   * Extract DatabaseCredentials from a parsed config object (DATABASE.VALUE).
   */
  private extractCredentials(config: Record<string, any>, appId: string): DatabaseCredentials {
    const dbValue = config.DATABASE?.VALUE;
    if (!dbValue || !dbValue.NAME || !dbValue.USERNAME || !dbValue.PASSWORD) {
      throw new Error('Invalid config: DATABASE credentials (NAME, USERNAME, PASSWORD) not found');
    }

    const isLocal = dbValue.VARIANT === 'local';
    return {
      host: isLocal ? 'localhost' : (dbValue.HOST ?? 'localhost'),
      port: dbValue.PORT ?? 3306,
      database: dbValue.NAME,
      user: dbValue.USERNAME,
      password: dbValue.PASSWORD,
    };
  }

  /**
   * Validate that credentials contain all required fields
   *
   * @param credentials - Database credentials to validate
   * @returns True if all required fields are present
   */
  validateCredentials(credentials: DatabaseCredentials): boolean {
    return !!(
      credentials.database &&
      credentials.user &&
      credentials.password
    );
  }

  /**
   * Get a MySQL connection from the pool
   *
   * @param credentials - Database credentials
   * @returns MySQL connection from pool
   * @throws Error if connection fails
   */
  async createConnection(credentials: DatabaseCredentials): Promise<mysql.PoolConnection> {
    try {
      const pool = this.getPool(credentials);
      const connection = await pool.getConnection();

      logger.debug('MySQL: Connection obtained from pool', {
        component: 'MySQLUtils',
        database: credentials.database,
        host: credentials.host,
        port: credentials.port,
      });

      return connection;
    } catch (error: any) {
      logger.error('MySQL: Connection failed', {
        component: 'MySQLUtils',
        error: error.message || String(error),
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
      });

      throw this.handleMySQLError(error, credentials, 'connect to MySQL');
    }
  }

  /**
   * Execute an operation with automatic connection management
   * Handles connection creation, operation execution, error handling, and cleanup
   *
   * @param credentials - Database credentials
   * @param operation - Async function to execute with the connection
   * @param operationName - Name of the operation for error messages
   * @returns Result from the operation
   */
  async withConnection<T>(
    credentials: DatabaseCredentials,
    operation: (connection: mysql.PoolConnection) => Promise<T>,
    operationName: string
  ): Promise<T> {
    let connection;
    try {
      connection = await this.createConnection(credentials);
      return await operation(connection);
    } catch (error: any) {
      logger.error(`MySQL: Failed to ${operationName}`, {
        component: 'MySQLUtils',
        database: credentials.database,
        error: error.message || String(error),
        code: error.code,
      });
      throw this.handleMySQLError(error, credentials, operationName);
    } finally {
      if (connection) {
        try {
          connection.release();
          logger.debug('MySQL: Connection released to pool', {
            component: 'MySQLUtils',
            database: credentials.database,
          });
        } catch (releaseError) {
          logger.warn('MySQL: Failed to release connection', {
            component: 'MySQLUtils',
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
          });
        }
      }
    }
  }

  /**
   * List all tables in a database
   *
   * @param credentials - Database credentials
   * @returns Array of table names (excludes system tables like __drizzle_migrations)
   */
  async listTables(credentials: DatabaseCredentials): Promise<string[]> {
    const startTime = Date.now();

    logger.info('MySQL: Listing tables', {
      component: 'MySQLUtils',
      database: credentials.database,
    });

    return this.withConnection(credentials, async (connection) => {
      const [rows] = await connection.execute('SHOW TABLES');

      // Transform results - MySQL returns tables with key "Tables_in_<database_name>"
      const tableKey = `Tables_in_${credentials.database}`;
      const allTables: string[] = Array.isArray(rows)
        ? rows.map((row: any) => row[tableKey] as string)
        : [];

      // Filter out system tables
      const tables = allTables.filter(tableName => !isSystemTable(tableName));

      const executionTime = Date.now() - startTime;
      logger.info('MySQL: Successfully listed tables', {
        component: 'MySQLUtils',
        database: credentials.database,
        tableCount: tables.length,
        filteredCount: allTables.length - tables.length,
        executionTime,
      });

      return tables;
    }, 'list tables');
  }

  /**
   * Get table schema information
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @returns Array of column information
   */
  async getTableSchema(credentials: DatabaseCredentials, tableName: string): Promise<TableColumn[]> {
    logger.info('MySQL: Getting table schema', {
      component: 'MySQLUtils',
      database: credentials.database,
      table: tableName,
    });

    return this.withConnection(credentials, async (connection) => {
      const escapedTableName = this.escapeIdentifier(tableName);
      const [rows] = await connection.execute(`DESCRIBE ${escapedTableName}`);

      const columns: TableColumn[] = Array.isArray(rows) ? rows.map((row: any) => ({
        name: row.Field,
        type: row.Type,
        nullable: row.Null === 'YES',
        key: row.Key,
        default: row.Default,
        extra: row.Extra,
      })) : [];

      logger.info('MySQL: Successfully retrieved table schema', {
        component: 'MySQLUtils',
        database: credentials.database,
        table: tableName,
        columnCount: columns.length,
      });

      return columns;
    }, 'get table schema');
  }

  /**
   * Get table data with pagination
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @param page - Page number (1-indexed)
   * @param limit - Number of rows per page
   * @returns Paginated table data
   */
  async getTableData(
    credentials: DatabaseCredentials,
    tableName: string,
    page: number = 1,
    limit: number = 25
  ): Promise<TableDataResult> {
    logger.info('MySQL: Getting table data', {
      component: 'MySQLUtils',
      database: credentials.database,
      table: tableName,
      page,
      limit,
    });

    return this.withConnection(credentials, async (connection) => {
      const escapedTableName = this.escapeIdentifier(tableName);

      // Get total count
      const [countResult] = await connection.execute(
        `SELECT COUNT(*) as total FROM ${escapedTableName}`
      );
      const total = Array.isArray(countResult) && countResult.length > 0
        ? (countResult[0] as any).total
        : 0;

      // Get paginated data
      const validLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit))));
      const validOffset = Math.max(0, Math.floor(Number((page - 1) * limit)));

      // Ensure values are actually integers
      if (!Number.isInteger(validLimit) || !Number.isInteger(validOffset)) {
        throw new Error('Invalid pagination parameters');
      }

      const [rows] = await connection.execute(
        `SELECT * FROM ${escapedTableName} LIMIT ${validLimit} OFFSET ${validOffset}`
      );

      const hasMore = validOffset + validLimit < total;

      logger.info('MySQL: Successfully retrieved table data', {
        component: 'MySQLUtils',
        database: credentials.database,
        table: tableName,
        total,
        rowCount: Array.isArray(rows) ? rows.length : 0,
      });

      return {
        rows: Array.isArray(rows) ? rows : [],
        total,
        page,
        limit,
        hasMore,
      };
    }, 'get table data');
  }

  /**
   * Insert a new row into a table
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @param data - Column-value pairs for the new row
   */
  async insertRow(
    credentials: DatabaseCredentials,
    tableName: string,
    data: Record<string, any>
  ): Promise<void> {
    logger.info('MySQL: Inserting row', {
      component: 'MySQLUtils',
      database: credentials.database,
      table: tableName,
      columnCount: Object.keys(data).length,
    });

    return this.withConnection(credentials, async (connection) => {
      const { query, values } = this.buildInsertQuery(tableName, data);
      await connection.execute(query, values);

      logger.info('MySQL: Successfully inserted row', {
        component: 'MySQLUtils',
        database: credentials.database,
        table: tableName,
      });
    }, 'insert row');
  }

  /**
   * Update an existing row in a table
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @param primaryKey - Primary key column-value pairs for WHERE clause
   * @param data - Column-value pairs to update
   */
  async updateRow(
    credentials: DatabaseCredentials,
    tableName: string,
    primaryKey: Record<string, any>,
    data: Record<string, any>
  ): Promise<void> {
    logger.info('MySQL: Updating row', {
      component: 'MySQLUtils',
      database: credentials.database,
      table: tableName,
      columnCount: Object.keys(data).length,
    });

    return this.withConnection(credentials, async (connection) => {
      const { query, values } = this.buildUpdateQuery(tableName, data, primaryKey);
      const [result] = await connection.execute<ResultSetHeader>(query, values);

      if (result.affectedRows === 0) {
        throw new Error('No rows matched the primary key - row may not exist');
      }
      if (result.affectedRows > 1) {
        throw new Error(`Multiple rows (${result.affectedRows}) matched - not a valid primary key`);
      }

      logger.info('MySQL: Successfully updated row', {
        component: 'MySQLUtils',
        database: credentials.database,
        table: tableName,
        affectedRows: result.affectedRows,
      });
    }, 'update row');
  }

  /**
   * Delete a row from a table
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @param primaryKey - Primary key column-value pairs for WHERE clause
   */
  async deleteRow(
    credentials: DatabaseCredentials,
    tableName: string,
    primaryKey: Record<string, any>
  ): Promise<void> {
    logger.info('MySQL: Deleting row', {
      component: 'MySQLUtils',
      database: credentials.database,
      table: tableName,
    });

    return this.withConnection(credentials, async (connection) => {
      const { query, values } = this.buildDeleteQuery(tableName, primaryKey);
      const [result] = await connection.execute<ResultSetHeader>(query, values);

      if (result.affectedRows === 0) {
        throw new Error('No rows matched the primary key - row may not exist');
      }
      if (result.affectedRows > 1) {
        throw new Error(`Multiple rows (${result.affectedRows}) matched - not a valid primary key`);
      }

      logger.info('MySQL: Successfully deleted row', {
        component: 'MySQLUtils',
        database: credentials.database,
        table: tableName,
        affectedRows: result.affectedRows,
      });
    }, 'delete row');
  }

  /**
   * Build INSERT query with proper escaping
   *
   * @param tableName - Table name
   * @param data - Column-value pairs
   * @returns Query string, values array, and column names
   */
  buildInsertQuery(
    tableName: string,
    data: Record<string, any>
  ): QueryResult {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map(() => '?').join(', ');

    const escapedTableName = this.escapeIdentifier(tableName);
    const escapedColumns = columns.map(c => this.escapeIdentifier(c)).join(', ');
    const query = `INSERT INTO ${escapedTableName} (${escapedColumns}) VALUES (${placeholders})`;

    return { query, values, columns };
  }

  /**
   * Build UPDATE query with proper escaping
   *
   * @param tableName - Table name
   * @param data - Column-value pairs to update
   * @param primaryKey - Primary key column-value pairs for WHERE clause
   * @returns Query string and values array
   */
  buildUpdateQuery(
    tableName: string,
    data: Record<string, any>,
    primaryKey: Record<string, any>
  ): QueryResult {
    const escapedTableName = this.escapeIdentifier(tableName);
    const setClause = Object.keys(data).map(key => `${this.escapeIdentifier(key)} = ?`).join(', ');
    const whereClause = Object.keys(primaryKey).map(key => `${this.escapeIdentifier(key)} = ?`).join(' AND ');

    const query = `UPDATE ${escapedTableName} SET ${setClause} WHERE ${whereClause}`;
    const values = [...Object.values(data), ...Object.values(primaryKey)];

    return { query, values };
  }

  /**
   * Build DELETE query with proper escaping
   *
   * @param tableName - Table name
   * @param primaryKey - Primary key column-value pairs for WHERE clause
   * @returns Query string and values array
   */
  buildDeleteQuery(
    tableName: string,
    primaryKey: Record<string, any>
  ): QueryResult {
    const escapedTableName = this.escapeIdentifier(tableName);
    const whereClause = Object.keys(primaryKey).map(key => `${this.escapeIdentifier(key)} = ?`).join(' AND ');
    const query = `DELETE FROM ${escapedTableName} WHERE ${whereClause}`;
    const values = Object.values(primaryKey);

    return { query, values };
  }

  /**
   * Escape MySQL identifier (table names, column names)
   *
   * @param identifier - Identifier to escape
   * @returns Escaped identifier wrapped in backticks
   */
  escapeIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  /**
   * Stream all rows from a table using mysql2's cursor-based streaming.
   * Returns an object-mode Readable stream and the pool connection.
   *
   * The caller MUST release the connection when done (on stream end, error, or client disconnect).
   * Recommended pattern: listen to stream 'close' event to release the connection.
   */
  async streamTableData(
    credentials: DatabaseCredentials,
    tableName: string,
    highWaterMark: number = 500
  ): Promise<{ stream: Readable; connection: mysql.PoolConnection }> {
    const poolConnection = await this.createConnection(credentials);

    try {
      // mysql2/promise PoolConnection wraps a non-promise Connection internally.
      // Streaming requires the non-promise connection's .query() which returns a Query
      // object with a .stream() method. This is a stable mysql2 pattern but not part
      // of the typed promise API, hence the cast.
      const rawConnection = (poolConnection as any).connection;
      const escapedTableName = this.escapeIdentifier(tableName);
      const query = rawConnection.query(`SELECT * FROM ${escapedTableName}`); // nosemgrep: node-mysql-sqli — table name is an identifier escaped via escapeIdentifier() (backtick-wrapping), not user input in a parameter position
      const stream = query.stream({ highWaterMark });

      return { stream, connection: poolConnection };
    } catch (error) {
      // Release the connection if streaming setup fails to prevent pool leak
      poolConnection.release();
      throw error;
    }
  }

  /**
   * Handle MySQL errors and convert to user-friendly error messages
   *
   * @param error - MySQL error object
   * @param credentials - Database credentials for context
   * @param operation - Operation name for error message
   * @returns Error with user-friendly message
   */
  handleMySQLError(error: any, credentials: DatabaseCredentials, operation: string): Error {
    const { host, port, user, database } = credentials;

    if (error.code === 'ECONNREFUSED') {
      return new Error(`MySQL server is not running on ${host}:${port}. Please start MySQL server.`);
    } else if (error.code === 'ENOTFOUND') {
      return new Error(`MySQL host '${host}' not found. Please check the hostname.`);
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      return new Error(`Access denied for user '${user}'${database ? ` to database '${database}'` : `@'${host}'`}. Please check MySQL credentials.`);
    } else if (error.code === 'ER_DBACCESS_DENIED_ERROR') {
      return new Error(`User '${user}' does not have permission to access database '${database}'`);
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      return new Error(`Database '${database}' does not exist`);
    } else {
      return new Error(`Failed to ${operation}: ${error.message || String(error)}`);
    }
  }
}

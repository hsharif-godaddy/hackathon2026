import mysql from 'mysql2/promise';
import { randomBytes } from 'crypto';
import { logger } from '../logging/index.js';

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
 * Centralized MySQL utilities class for all database interactions
 * Handles connection management, credentials loading, query building, and CRUD operations
 */
export class MySQLUtils {
  /**
   * Load MySQL credentials from an app's .env file
   *
   * @param app - The app object containing the path to .env
   * @returns Database credentials extracted from .env file
   * @throws Error if .env file not found or credentials are incomplete
   */
  async loadCredentialsFromApp(app: App): Promise<DatabaseCredentials> {
    const { EnvManager } = await import('../tools/env-manager.js');
    const { join } = await import('path');

    const envManager = new EnvManager({
      envFilePath: join(app.path, '.env'),
    });

    // Check if .env file exists
    const envExists = await envManager.exists();
    if (!envExists) {
      throw new Error(`No .env file found for application at ${app.path}`);
    }

    // Read environment variables
    const envVars = await envManager.readEnvFile();

    // Extract MySQL credentials
    // Prefer *_EXTERNAL vars for host machine access (agents service runs on host)
    // Fall back to regular vars for backwards compatibility
    const credentials: DatabaseCredentials = {
      host: envVars.MYSQL_HOST_EXTERNAL || envVars.MYSQL_HOST || 'localhost',
      port: parseInt(envVars.MYSQL_PORT_EXTERNAL || envVars.MYSQL_PORT || '3306', 10),
      database: envVars.MYSQL_DATABASE || '',
      user: envVars.MYSQL_USER || '',
      password: envVars.MYSQL_PASSWORD || '',
    };

    // Validate credentials
    if (!this.validateCredentials(credentials)) {
      throw new Error(
        'MySQL credentials incomplete in .env file (MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD required)'
      );
    }

    logger.debug('MySQL: Loaded credentials from app', {
      component: 'MySQLUtils',
      appId: app.id,
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      hasExternalVars: !!(envVars.MYSQL_HOST_EXTERNAL && envVars.MYSQL_PORT_EXTERNAL),
    });

    return credentials;
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
   * Create a MySQL connection with provided credentials
   *
   * @param credentials - Database credentials
   * @returns MySQL connection
   * @throws Error if connection fails
   */
  async createConnection(credentials: DatabaseCredentials): Promise<mysql.Connection> {
    try {
      const connection = await mysql.createConnection({
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password,
        database: credentials.database,
      });

      await connection.ping();

      logger.debug('MySQL: Connection established', {
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
    operation: (connection: mysql.Connection) => Promise<T>,
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
          await connection.end();
          logger.debug('MySQL: Connection closed', {
            component: 'MySQLUtils',
            database: credentials.database,
          });
        } catch (closeError) {
          logger.warn('MySQL: Failed to close connection', {
            component: 'MySQLUtils',
            error: closeError instanceof Error ? closeError.message : String(closeError),
          });
        }
      }
    }
  }

  /**
   * List all tables in a database
   *
   * @param credentials - Database credentials
   * @returns Array of table names
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
      const tables: string[] = Array.isArray(rows)
        ? rows.map((row: any) => row[tableKey] as string)
        : [];

      const executionTime = Date.now() - startTime;
      logger.info('MySQL: Successfully listed tables', {
        component: 'MySQLUtils',
        database: credentials.database,
        tableCount: tables.length,
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
      const offset = (page - 1) * limit;
      const validLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit))));
      const validOffset = Math.max(0, Math.floor(Number(offset)));

      // Ensure values are actually integers
      if (!Number.isInteger(validLimit) || !Number.isInteger(validOffset)) {
        throw new Error('Invalid pagination parameters');
      }

      const [rows] = await connection.execute(
        `SELECT * FROM ${escapedTableName} LIMIT ${validLimit} OFFSET ${validOffset}`
      );

      const hasMore = offset + limit < total;

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
      await connection.execute(query, values);

      logger.info('MySQL: Successfully updated row', {
        component: 'MySQLUtils',
        database: credentials.database,
        table: tableName,
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
      await connection.execute(query, values);

      logger.info('MySQL: Successfully deleted row', {
        component: 'MySQLUtils',
        database: credentials.database,
        table: tableName,
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
   * Sanitize appId for use in database names
   * Replaces hyphens with underscores to comply with MySQL identifier rules
   *
   * @param appId - Application ID (typically a UUID)
   * @returns Sanitized appId safe for database names
   */
  sanitizeAppId(appId: string): string {
    return appId.toLowerCase().replace(/-/g, '_');
  }

  /**
   * Create app-scoped database name: airo_{sanitizedAppId}
   *
   * @param appId - Application ID
   * @returns Database name in format airo_{appId}
   */
  createAppDatabaseName(appId: string): string {
    const sanitizedAppId = this.sanitizeAppId(appId);
    return `airo_${sanitizedAppId}`;
  }

  /**
   * Generate a username based on appId
   * Format: user_airo_{sanitizedAppId} (truncated to 32 chars if needed)
   *
   * @param appId - Application ID
   * @returns MySQL username
   */
  generateAppUsername(appId: string): string {
    const sanitizedAppId = this.sanitizeAppId(appId);
    const username = `user_airo_${sanitizedAppId}`;

    // MySQL username limit is 32 chars
    if (username.length > 32) {
      return username.substring(0, 32);
    }

    return username;
  }

  /**
   * Generate a secure random password
   *
   * @param length - Password length (default: 16)
   * @returns Randomly generated password
   */
  generateSecurePassword(length: number = 16): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';

    for (let i = 0; i < length; i++) {
      const randomByte = randomBytes(1)[0];
      if (randomByte === undefined) throw new Error('Failed to generate random byte');
      const randomIndex = randomByte % charset.length;
      password += charset[randomIndex];
    }

    return password;
  }

  /**
   * Validate database name
   *
   * @param databaseName - Database name to validate
   * @returns True if valid
   */
  validateDatabaseName(databaseName: string): boolean {
    const nameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return nameRegex.test(databaseName) && databaseName.length <= 64;
  }

  /**
   * Validate username
   *
   * @param username - Username to validate
   * @returns True if valid
   */
  validateUsername(username: string): boolean {
    const usernameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return usernameRegex.test(username) && username.length <= 32;
  }

  /**
   * Check if a MySQL database exists
   *
   * @param connection - MySQL connection
   * @param databaseName - Database name to check
   * @returns True if database exists
   */
  async databaseExists(connection: mysql.Connection, databaseName: string): Promise<boolean> {
    const [rows] = await connection.execute(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [databaseName]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * Check if a MySQL user exists
   *
   * @param connection - MySQL connection
   * @param username - Username to check
   * @param host - Host pattern (default: '%')
   * @returns True if user exists
   */
  async userExists(connection: mysql.Connection, username: string, host: string = '%'): Promise<boolean> {
    const [rows] = await connection.execute(
      'SELECT User FROM mysql.user WHERE User = ? AND Host = ?',
      [username, host]
    );
    return Array.isArray(rows) && rows.length > 0;
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

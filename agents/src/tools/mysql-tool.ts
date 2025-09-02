import mysql from 'mysql2/promise';
import { randomBytes } from 'crypto';
import { logger } from '../logging/index.js';
import { toolMySqlEvents } from '../logging/events/index.js';

export interface MySQLToolOptions {
  operation: 'enable_database' | 'test_connection' | 'list_databases';
  databaseName?: string;
  username?: string;
  userId?: string; // User identifier for database scoping
  host?: string;
  port?: number;
  rootUser?: string;
  rootPassword?: string;
}

export interface MySQLToolResult {
  success: boolean;
  message: string;
  data?: {
    databaseName?: string;
    originalDatabaseName?: string;
    userId?: string;
    username?: string;
    password?: string;
    tables?: string[];
    deletedTables?: string[];
    wasRenamed?: boolean;
    databases?: Array<{
      databaseName: string;
      userId?: string | null;
      username?: string;
    }>;
  };
  error?: string;
}

export class MySQLTool {
  /**
   * Execute MySQL operations
   */
  async execute(options: MySQLToolOptions): Promise<MySQLToolResult> {
    const startTime = Date.now();
    
    // Build logging data
    const logData = {
      toolName: 'mysql',
      operation: options.operation,
      connectionInfo: {
        host: options.host || process.env.MYSQL_ROOT_HOST || 'localhost',
        port: options.port || parseInt(process.env.MYSQL_ROOT_PORT || '3306', 10),
        user: options.rootUser || process.env.MYSQL_ROOT_USER || 'root'
      },
      databaseInfo: {
        ...(options.databaseName && { databaseName: options.databaseName }),
        ...(options.username && { username: options.username }),
        ...(options.userId && { userId: options.userId })
      }
    };
    
    // Log operation begin
    toolMySqlEvents.begin(logger, logData);
    
    try {
      let result: MySQLToolResult;
      
      switch (options.operation) {
        case 'enable_database':
          result = await this.createDatabaseWithUser(options);
          break;
        case 'test_connection':
          result = await this.testConnection(options);
          break;
        case 'list_databases':
          result = await this.listDatabases(options);
          break;
        default:
          result = {
            success: false,
            message: `Unknown operation: ${options.operation}`,
            error: 'INVALID_OPERATION',
          };
      }
      
      const executionTime = Date.now() - startTime;
      
      // Log success or failure
      if (result.success) {
        toolMySqlEvents.success(logger, {
          ...logData,
          resultStats: {
            success: true,
            databaseCreated: options.operation === 'enable_database' && result.success,
            userCreated: options.operation === 'enable_database' && result.success,
            ...(result.data?.databases?.length !== undefined && { databasesFound: result.data.databases.length }),
            connectionTested: options.operation === 'test_connection' && result.success,
            executionTime
          }
        });
      } else {
        toolMySqlEvents.failure(logger, new Error(result.error || 'MySQL operation failed'), logData);
      }
      
      return result;
    } catch (error) {
      toolMySqlEvents.failure(logger, error as Error, logData);
      
      return {
        success: false,
        message: `MySQL operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: 'MYSQL_ERROR',
      };
    }
  }

  /**
   * Create a new MySQL database with dedicated user and tables
   */
  private async createDatabaseWithUser(options: MySQLToolOptions): Promise<MySQLToolResult> {
    const { databaseName, username: requestedUsername, userId } = options;

    if (!databaseName) {
      return {
        success: false,
        message: 'Database name is required',
        error: 'MISSING_DATABASE_NAME',
      };
    }

    if (!userId) {
      return {
        success: false,
        message: 'User ID is required for database scoping',
        error: 'MISSING_USER_ID',
      };
    }

    // Create scoped database name: userId_databaseName
    const scopedDatabaseName = this.createScopedDatabaseName(userId, databaseName);

    // Validate base database name
    if (!this.validateDatabaseName(databaseName)) {
      return {
        success: false,
        message: 'Invalid database name. Must be alphanumeric with underscores, max 64 characters.',
        error: 'INVALID_DATABASE_NAME',
      };
    }

    // Validate user ID
    if (!this.validateUserId(userId)) {
      return {
        success: false,
        message: 'Invalid user ID. Must be alphanumeric with underscores, max 16 characters.',
        error: 'INVALID_USER_ID',
      };
    }

    // Validate scoped database name doesn't exceed MySQL limits
    if (!this.validateDatabaseName(scopedDatabaseName)) {
      return {
        success: false,
        message: `Scoped database name '${scopedDatabaseName}' is too long. Try a shorter database name or user ID.`,
        error: 'SCOPED_DATABASE_TOO_LONG',
      };
    }

    // Generate or validate username (scoped to user)
    const username = requestedUsername || this.generateScopedUsername(userId, databaseName);
    if (!this.validateUsername(username)) {
      return {
        success: false,
        message: 'Invalid username. Must be alphanumeric with underscores, max 32 characters.',
        error: 'INVALID_USERNAME',
      };
    }

    let connection;
    try {
      // Connect to MySQL as root
      connection = await this.createConnection(options);

      // Always generate unique database name with random 4-digit suffix for guaranteed uniqueness
      const randomSuffix = Math.floor(1000 + Math.random() * 9000); // 4-digit random number
      let finalDatabaseName = `${scopedDatabaseName}_${randomSuffix}`;
      
      // Double-check uniqueness (should be extremely rare to conflict with random suffix)
      if (await this.databaseExists(connection, finalDatabaseName)) {
        // Extremely rare case - try one more time with different suffix
        const secondRandomSuffix = Math.floor(1000 + Math.random() * 9000);
        const secondFinalDatabaseName = `${scopedDatabaseName}_${secondRandomSuffix}`;
        
        if (await this.databaseExists(connection, secondFinalDatabaseName)) {
          return {
            success: false,
            message: `Extremely rare: Unable to generate unique database name even with random suffixes. Please try again.`,
            error: 'DATABASE_GENERATION_FAILED',
          };
        }
        
        // Use the second attempt
        finalDatabaseName = secondFinalDatabaseName;
      }

      // Check if user already exists
      if (await this.userExists(connection, username)) {
        return {
          success: false,
          message: `User ${username} already exists`,
          error: 'USER_EXISTS',
        };
      }

      // Step 1: Generate secure password
      const password = this.generateSecurePassword();
      
      // Step 2: Create the user first (neither username nor password can be parameterized in CREATE USER)
      await connection.execute(`CREATE USER ${this.escapeIdentifier(username)}@'%' IDENTIFIED BY '${password.replace(/'/g, "\\'")}'`);

      // Step 3: Create the database
      await connection.execute(`CREATE DATABASE ${this.escapeIdentifier(finalDatabaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

      // Step 4: Grant all privileges on the new database to the user
      await connection.execute(`GRANT ALL PRIVILEGES ON ${this.escapeIdentifier(finalDatabaseName)}.* TO ${this.escapeIdentifier(username)}@'%'`);

      // Flush privileges to ensure changes take effect
      await connection.execute('FLUSH PRIVILEGES');

      // Step 5: Use the new database (ready for agent-specific table creation)
      await connection.changeUser({ database: finalDatabaseName });
      
      // Database is now ready for agents to create their own tables as needed
      // No predefined schema - agents decide what tables they require
      logger.info('Empty MySQL database created and ready for custom table creation', {
        component: 'MySQLTool',
        databaseName: finalDatabaseName,
        username,
        userId
      });

      const createdTables: string[] = []; // Empty database, no predefined tables
      const wasRenamed = true; // Always true since we always add random suffix
      
      return {
        success: true,
        message: `Successfully created database ${finalDatabaseName} with user ${username} for user ${userId} (auto-generated with unique suffix)`,
        data: {
          databaseName: finalDatabaseName, // Final database name used (always has random suffix)
          originalDatabaseName: databaseName, // Original requested name
          userId,
          username,
          password,
          tables: createdTables,
          wasRenamed,
        },
      };

    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  /**
   * Test connection to MySQL
   */
  private async testConnection(options: MySQLToolOptions): Promise<MySQLToolResult> {
    let connection;
    try {
      connection = await this.createConnection(options);
      await connection.ping();
      
      return {
        success: true,
        message: 'Successfully connected to MySQL',
      };
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }



  /**
   * List databases (optionally filtered by user)
   */
  private async listDatabases(options: MySQLToolOptions): Promise<MySQLToolResult> {
    const { userId } = options;
    
    let connection;
    try {
      connection = await this.createConnection(options);
      
      let query = 'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME NOT IN (?, ?, ?, ?)';
      const params: string[] = ['information_schema', 'performance_schema', 'mysql', 'sys'];
      
      // If userId is provided, filter for user's databases
      if (userId) {
        const userPrefix = userId.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_';
        query += ' AND SCHEMA_NAME LIKE ?';
        params.push(userPrefix + '%');
      }
      
      const [rows] = await connection.execute(query, params);

      const databases = Array.isArray(rows) ? rows.map((row: any) => {
        const fullDatabaseName = row.SCHEMA_NAME;
        
        // Parse scoped database name back to user and database components
        if (userId) {
          const userPrefix = userId.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_';
          const baseDatabaseName = fullDatabaseName.startsWith(userPrefix) 
            ? fullDatabaseName.substring(userPrefix.length)
            : fullDatabaseName;
          
          return {
            databaseName: baseDatabaseName,
            userId: userId,
          };
        } else {
          // For unfiltered results, try to parse scope if it looks scoped
          const parts = fullDatabaseName.split('_', 2);
          if (parts.length >= 2) {
            return {
              databaseName: parts.slice(1).join('_'),
              userId: parts[0],
            };
          } else {
            // Legacy or unscoped database
            return {
              databaseName: fullDatabaseName,
              userId: null,
            };
          }
        }
      }) : [];

      const message = userId 
        ? `Found ${databases.length} databases for user ${userId}`
        : `Found ${databases.length} databases`;

      return {
        success: true,
        message,
        data: { databases },
      };

    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  /**
   * Create MySQL connection
   */
  private async createConnection(options: MySQLToolOptions): Promise<mysql.Connection> {
    const config = {
      host: options.host || process.env.MYSQL_ROOT_HOST || 'localhost',
      port: options.port || parseInt(process.env.MYSQL_ROOT_PORT || '3306', 10),
      user: options.rootUser || process.env.MYSQL_ROOT_USER || 'root',
      password: options.rootPassword || process.env.MYSQL_ROOT_PASS || 'airo',
    };

    logger.debug('MySQL connection configuration', {
      component: 'MySQLTool',
      host: config.host,
      port: config.port,
      user: config.user,
      passwordSet: !!config.password
    });

    try {
      const connection = await mysql.createConnection(config);
      await connection.ping(); // Test the connection
      logger.debug('MySQL connection successful', {
        component: 'MySQLTool',
        host: config.host,
        port: config.port
      });
      return connection;
    } catch (error: any) {
      logger.error('MySQL connection failed', {
        error: error.message || String(error),
        host: config.host,
        port: config.port,
        user: config.user
      });
      
      // Provide helpful error messages
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`MySQL server is not running on ${config.host}:${config.port}. Please start MySQL server.`);
      } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
        throw new Error(`Access denied for user '${config.user}'@'${config.host}'. Please check MySQL credentials.`);
      } else if (error.code === 'ENOTFOUND') {
        throw new Error(`MySQL host '${config.host}' not found. Please check the hostname.`);
      } else {
        throw new Error(`MySQL connection error: ${error.message}`);
      }
    }
  }

  /**
   * Generate a secure random password
   */
  private generateSecurePassword(length: number = 16): string {
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
   * Generate a unique username based on database name (legacy method)
   */
  private generateUsername(databaseName: string): string {
    const baseName = databaseName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const randomSuffix = randomBytes(4).toString('hex'); // 8 chars
    
    // MySQL username limit is 32 chars. Format: user_{baseName}_{suffix}
    // Reserve: 5 (user_) + 1 (_) + 8 (suffix) = 14 chars
    // Remaining for baseName: 32 - 14 = 18 chars
    const maxBaseLength = 18;
    const truncatedBase = baseName.length > maxBaseLength ? baseName.substring(0, maxBaseLength) : baseName;
    
    return `user_${truncatedBase}_${randomSuffix}`;
  }

  /**
   * Generate a scoped username based on user ID and database name
   */
  private generateScopedUsername(userId: string, databaseName: string): string {
    const userBase = userId.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const databaseBase = databaseName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const randomSuffix = randomBytes(3).toString('hex'); // 6 chars
    
    // MySQL username limit is 32 chars. Format: {userBase}_{databaseBase}_{suffix}
    // Reserve: 1 (_) + 1 (_) + 6 (suffix) = 8 chars
    // Remaining for userBase + databaseBase: 32 - 8 = 24 chars
    const maxCombinedLength = 24;
    const combined = `${userBase}_${databaseBase}`;
    const truncatedCombined = combined.length > maxCombinedLength ? combined.substring(0, maxCombinedLength) : combined;
    
    return `${truncatedCombined}_${randomSuffix}`;
  }

  /**
   * Create scoped database name: userId_databaseName
   */
  private createScopedDatabaseName(userId: string, databaseName: string): string {
    const userBase = userId.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const databaseBase = databaseName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `${userBase}_${databaseBase}`;
  }

  /**
   * Validate user ID
   */
  private validateUserId(userId: string): boolean {
    const userIdRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return userIdRegex.test(userId) && userId.length <= 16;
  }

  /**
   * Validate database name
   */
  private validateDatabaseName(databaseName: string): boolean {
    const nameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return nameRegex.test(databaseName) && databaseName.length <= 64;
  }

  /**
   * Validate username
   */
  private validateUsername(username: string): boolean {
    const usernameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return usernameRegex.test(username) && username.length <= 32;
  }

  /**
   * Escape MySQL identifier
   */
  private escapeIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  /**
   * Check if a MySQL database exists
   */
  private async databaseExists(connection: mysql.Connection, databaseName: string): Promise<boolean> {
    const [rows] = await connection.execute(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [databaseName]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * Check if a MySQL user exists
   */
  private async userExists(connection: mysql.Connection, username: string, host: string = '%'): Promise<boolean> {
    const [rows] = await connection.execute(
      'SELECT User FROM mysql.user WHERE User = ? AND Host = ?',
      [username, host]
    );
    return Array.isArray(rows) && rows.length > 0;
  }
}

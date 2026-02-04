import mysql from 'mysql2/promise';

import { DatabaseAdapter, DatabaseConfig, DatabaseResult, DatabaseRow, DatabaseStatement } from './types';
import { logger } from '../request-context';

export class MySQLAdapter implements DatabaseAdapter {
  private connection: mysql.Connection | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    if (config.type !== 'mysql') {
      throw new Error('MySQLAdapter can only handle MySQL configurations');
    }
    this.config = config;
  }

  private async getConnection(): Promise<mysql.Connection> {
    if (!this.connection) {
      try {
        this.connection = await mysql.createConnection({
          host: this.config.host,
          port: this.config.port || 3306,
          user: this.config.user,
          password: this.config.password,
          database: this.config.database,
          ssl: {
            rejectUnauthorized: false
          },
          dateStrings: true, // Return dates as strings to match SQLite behavior
          timezone: '+00:00' // Use proper timezone format for MySQL
        });
        logger.info('Connected to MySQL database:', this.config.host);
      } catch (err) {
        logger.error('Error connecting to MySQL database:', err);
        throw err;
      }
    }
    return this.connection;
  }

  async run(sql: string, params: unknown[] = []): Promise<DatabaseResult> {
    try {
      const connection = await this.getConnection();

      // Convert SQLite SQL syntax to MySQL syntax
      const mysqlSql = this.convertSQLiteToMySQL(sql);

      const [result] = await connection.execute(mysqlSql, params);

      if (Array.isArray(result)) {
        return { changes: 0 };
      }

      const mysqlResult = result as mysql.ResultSetHeader;
      return {
        changes: mysqlResult.affectedRows || 0,
        lastInsertRowid: mysqlResult.insertId
      };
    } catch (error: any) {
      // Ignore "Duplicate key name" errors for CREATE INDEX operations
      if (error.code === 'ER_DUP_KEYNAME' && sql.toLowerCase().includes('create index')) {
        logger.info(`Index already exists, skipping: ${sql}`);
        return { changes: 0 };
      }
      logger.error('mysql_adapter', 'MySQL Error running SQL', { error: error as Error, data: { sql, params } });
      throw error;
    }
  }

  async get<T = DatabaseRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    try {
      const connection = await this.getConnection();

      // Convert SQLite SQL syntax to MySQL syntax
      const mysqlSql = this.convertSQLiteToMySQL(sql);

      const [rows] = await connection.execute(mysqlSql, params);

      if (Array.isArray(rows) && rows.length > 0) {
        return rows[0] as T;
      }
      return undefined;
    } catch (error) {
      logger.error('mysql_adapter', 'MySQL Error getting row', { error: error as Error, data: { sql, params } });
      throw error;
    }
  }

  async all<T = DatabaseRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      const connection = await this.getConnection();

      // Convert SQLite SQL syntax to MySQL syntax
      const mysqlSql = this.convertSQLiteToMySQL(sql);

      const [rows] = await connection.execute(mysqlSql, params);

      return (Array.isArray(rows) ? rows : []) as T[];
    } catch (error) {
      logger.error('mysql_adapter', 'MySQL Error getting all rows', { error: error as Error, data: { sql, params } });
      throw error;
    }
  }

  async exec(sql: string): Promise<void> {
    try {
      const connection = await this.getConnection();

      // Split multiple statements and execute them one by one
      const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);

      for (const statement of statements) {
        const mysqlSql = this.convertSQLiteToMySQL(statement.trim());
        if (mysqlSql) {
          try {
            await connection.execute(mysqlSql);
          } catch (error: any) {
            // Ignore "Duplicate key name" errors for CREATE INDEX operations
            if (error.code === 'ER_DUP_KEYNAME' && mysqlSql.toLowerCase().includes('create index')) {
              logger.info(`Index already exists, skipping: ${mysqlSql}`);
              continue;
            }
            throw error;
          }
        }
      }
    } catch (error) {
      logger.error('mysql_adapter', 'MySQL Error executing SQL', { error: error as Error, data: { sql } });
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.connection) {
        await this.connection.end();
        this.connection = null;
        logger.info('MySQL database connection closed');
      }
    } catch (error) {
      logger.error('Error closing MySQL database:', error);
      throw error;
    }
  }

  // MySQL doesn't have PRAGMA, this is a no-op for compatibility
  pragma(): unknown[] {
    logger.warn('PRAGMA queries are not supported in MySQL, returning empty array');
    return [];
  }

  prepare(sql: string): DatabaseStatement {
    const mysqlSql = this.convertSQLiteToMySQL(sql);
    return {
      run: (...params: unknown[]) => {
        return this.run(mysqlSql, params);
      },
      get: <T = DatabaseRow>(...params: unknown[]): Promise<T | undefined> => {
        return this.get<T>(mysqlSql, params);
      },
      all: <T = DatabaseRow>(...params: unknown[]): Promise<T[]> => {
        return this.all<T>(mysqlSql, params);
      }
    };
  }

  /**
   * Convert SQLite-specific SQL syntax to MySQL-compatible syntax
   */
  private convertSQLiteToMySQL(sql: string): string {
    let mysqlSql = sql;

    // Replace SQLite-specific data types and syntax
    mysqlSql = mysqlSql
      // Replace TEXT with VARCHAR(255) for smaller text fields, TEXT for larger ones
      .replace(/VARCHAR\(\d+\)/gi, match => match) // Keep existing VARCHAR definitions
      .replace(/\bTEXT\b/gi, 'TEXT')

      // Replace DATETIME DEFAULT CURRENT_TIMESTAMP
      .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')

      // // Replace INTEGER with INT
      // .replace(/\bINTEGER\b/gi, 'INT')

      // Replace CAST(...AS INTEGER) with CAST(...AS SIGNED) for MySQL
      .replace(/CAST\s*\([^)]+\s+AS\s+INTEGER\)/gi, (match) => {
        return match.replace(/INTEGER/gi, 'SIGNED');
      })

      // Replace DECIMAL format (MySQL uses same format)
      .replace(/DECIMAL\((\d+),(\d+)\)/gi, 'DECIMAL($1,$2)')

      // Handle CHECK constraints (MySQL 8.0+ supports them, but we'll remove for compatibility)
      .replace(/CHECK\s*\([^)]+\)/gi, '')

      // Replace AUTOINCREMENT with AUTO_INCREMENT
      .replace(/\bAUTOINCREMENT\b/gi, 'AUTO_INCREMENT')

      // Replace IF NOT EXISTS for CREATE TABLE
      .replace(/CREATE TABLE IF NOT EXISTS/gi, 'CREATE TABLE IF NOT EXISTS')

      // Replace IF NOT EXISTS for CREATE INDEX (not supported in MySQL < 8.0.23)
      .replace(/CREATE INDEX IF NOT EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/gi,
        'CREATE INDEX $1 ON $2($3)')

      // Replace triggers (MySQL has different syntax, we'll handle this separately)
      .replace(/CREATE TRIGGER IF NOT EXISTS[\s\S]*?END;/gi, '')

      // Replace INSERT OR IGNORE with INSERT IGNORE
      .replace(/INSERT OR IGNORE/gi, 'INSERT IGNORE')

      // Replace sqlite_master with information_schema equivalent
      .replace(/sqlite_master/gi, 'information_schema.tables')
      .replace(/SELECT sql FROM information_schema\.tables WHERE type='table'/gi,
               "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()")

      // Handle FOREIGN KEY syntax (MySQL might need adjustments)
      .replace(/FOREIGN KEY \(([^)]+)\) REFERENCES ([^(]+)\(([^)]+)\) ON DELETE CASCADE/gi,
               'FOREIGN KEY ($1) REFERENCES $2($3) ON DELETE CASCADE');

    return mysqlSql;
  }
}

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DatabaseAdapter, DatabaseResult, DatabaseRow, DatabaseStatement, DatabaseConfig } from './types';
import { logger } from '../request-context';

export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database;

  constructor(config: DatabaseConfig) {
    if (config.type !== 'sqlite') {
      throw new Error('SQLiteAdapter can only handle SQLite configurations');
    }

    const dbPath = config.path || path.join(process.cwd(), 'data', 'airo-builder-platform.db');
    
    // Ensure data directory exists
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    try {
      this.db = new Database(dbPath);
      // Database connection - configuration logged at startup
    } catch (err) {
      logger.error('Error opening SQLite database:', err);
      throw err;
    }
  }

  run(sql: string, params: unknown[] = []): DatabaseResult {
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid
      };
    } catch (error) {
      logger.error('sqlite_adapter', 'SQLite Error running SQL', { error: error as Error, data: { sql, params } });
      throw error;
    }
  }

  get<T = DatabaseRow>(sql: string, params: unknown[] = []): T | undefined {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(...params) as T | undefined;
    } catch (error) {
      logger.error('sqlite_adapter', 'SQLite Error getting row', { error: error as Error, data: { sql, params } });
      throw error;
    }
  }

  all<T = DatabaseRow>(sql: string, params: unknown[] = []): T[] {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params) as T[];
    } catch (error) {
      logger.error('sqlite_adapter', 'SQLite Error getting all rows', { error: error as Error, data: { sql, params } });
      throw error;
    }
  }

  exec(sql: string): void {
    try {
      this.db.exec(sql);
    } catch (error) {
      logger.error('sqlite_adapter', 'SQLite Error executing SQL', { error: error as Error, data: { sql } });
      throw error;
    }
  }

  close(): void {
    try {
      this.db.close();
      logger.info('SQLite database connection closed');
    } catch (error) {
      logger.error('Error closing SQLite database:', error);
      throw error;
    }
  }

  pragma(query: string): unknown[] {
    try {
      return this.db.pragma(query) as unknown[];
    } catch (error) {
      logger.error('sqlite_adapter', 'SQLite Error executing pragma', { error: error as Error, data: { query } });
      throw error;
    }
  }

  prepare(sql: string): DatabaseStatement {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        const result = stmt.run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid
        };
      },
      get: <T = DatabaseRow>(...params: unknown[]): T | undefined => {
        return stmt.get(...params) as T | undefined;
      },
      all: <T = DatabaseRow>(...params: unknown[]): T[] => {
        return stmt.all(...params) as T[];
      }
    };
  }
}

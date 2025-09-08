import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DatabaseAdapter, DatabaseResult, DatabaseRow, DatabaseStatement, DatabaseConfig } from './types';

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
      console.error('Error opening SQLite database:', err);
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
      console.error('SQLite Error running SQL:', sql, params, error);
      throw error;
    }
  }

  get<T = DatabaseRow>(sql: string, params: unknown[] = []): T | undefined {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(...params) as T | undefined;
    } catch (error) {
      console.error('SQLite Error getting row:', sql, params, error);
      throw error;
    }
  }

  all<T = DatabaseRow>(sql: string, params: unknown[] = []): T[] {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params) as T[];
    } catch (error) {
      console.error('SQLite Error getting all rows:', sql, params, error);
      throw error;
    }
  }

  exec(sql: string): void {
    try {
      this.db.exec(sql);
    } catch (error) {
      console.error('SQLite Error executing SQL:', sql, error);
      throw error;
    }
  }

  close(): void {
    try {
      this.db.close();
      console.log('SQLite database connection closed');
    } catch (error) {
      console.error('Error closing SQLite database:', error);
      throw error;
    }
  }

  pragma(query: string): unknown[] {
    try {
      return this.db.pragma(query) as unknown[];
    } catch (error) {
      console.error('SQLite Error executing pragma:', query, error);
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

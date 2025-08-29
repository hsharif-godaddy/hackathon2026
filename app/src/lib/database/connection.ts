import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Database path - will be created in the project root
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'airo-builder-platform.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private db: Database.Database;

  private constructor() {
    try {
      this.db = new Database(DB_PATH);
      console.log('Connected to SQLite database:', DB_PATH);
      this.initializeSchema();
    } catch (err) {
      console.error('Error opening database:', err);
      throw err;
    }
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private initializeSchema(): void {
    try {
      // Create plans table (referenced by accounts)
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

      // Create accounts table
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

      // Create triggers to update updated_at timestamp
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

      // Insert default plans with UUIDs
      const defaultPlansSQL = `
        INSERT OR IGNORE INTO plans (id, name, site_limit, price) VALUES
        ('550e8400-e29b-41d4-a716-446655440001', 'Free', 10, 5.00),
        ('550e8400-e29b-41d4-a716-446655440002', 'Starter', 30, 20.00),
        ('550e8400-e29b-41d4-a716-446655440003', 'Pro', 100, 50.00);
      `;

      this.db.exec(plansTableSQL);
      this.db.exec(accountsTableSQL);
      this.db.exec(accountsTriggerSQL);
      this.db.exec(plansTriggerSQL);
      this.db.exec(defaultPlansSQL);

      console.log('Database schema initialized successfully');
    } catch (error) {
      console.error('Error initializing database schema:', error);
      throw error;
    }
  }

  public getDb(): Database.Database {
    return this.db;
  }

  public close(): void {
    try {
      this.db.close();
      console.log('Database connection closed');
    } catch (error) {
      console.error('Error closing database:', error);
      throw error;
    }
  }

  // Helper method to run queries
  public run(sql: string, params: any[] = []): Database.RunResult {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.run(...params);
    } catch (error) {
      console.error('Error running SQL:', sql, params, error);
      throw error;
    }
  }

  // Helper method to get single row
  public get<T = any>(sql: string, params: any[] = []): T | undefined {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(...params) as T | undefined;
    } catch (error) {
      console.error('Error getting row:', sql, params, error);
      throw error;
    }
  }

  // Helper method to get all rows
  public all<T = any>(sql: string, params: any[] = []): T[] {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params) as T[];
    } catch (error) {
      console.error('Error getting all rows:', sql, params, error);
      throw error;
    }
  }
}

export default DatabaseManager;

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MigrationRecord {
  id: number;
  filename: string;
  executed_at: Date;
}

/**
 * Database Migration Runner
 * Manages database schema migrations for applications built with the V3 template
 */
export class MigrationRunner {
  private connection: mysql.Connection | null = null;

  async connect() {
    const config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    };

    if (!config.user || !config.password || !config.database) {
      throw new Error('Missing database configuration. Check DB_USER, DB_PASS, DB_NAME in .env file');
    }

    this.connection = await mysql.createConnection(config);
    console.log(`✅ Connected to database: ${config.database}`);
  }

  async disconnect() {
    if (this.connection) {
      await this.connection.end();
      console.log('✅ Database connection closed');
    }
  }

  async createMigrationsTable() {
    if (!this.connection) throw new Error('Not connected to database');

    await this.connection.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_filename (filename),
        INDEX idx_executed_at (executed_at)
      )
    `);
    console.log('✅ Migrations table ready');
  }

  async getExecutedMigrations(): Promise<string[]> {
    if (!this.connection) throw new Error('Not connected to database');

    const [rows] = await this.connection.execute(
      'SELECT filename FROM migrations ORDER BY id'
    );
    return (rows as MigrationRecord[]).map(row => row.filename);
  }

  async recordMigration(filename: string) {
    if (!this.connection) throw new Error('Not connected to database');

    await this.connection.execute(
      'INSERT INTO migrations (filename) VALUES (?)',
      [filename]
    );
  }

  async runMigrations(migrationsDir?: string) {
    try {
      await this.connect();
      await this.createMigrationsTable();

      // Default to migrations directory relative to this script
      const defaultMigrationsDir = path.join(__dirname, '../migrations');
      const targetDir = migrationsDir || defaultMigrationsDir;

      if (!fs.existsSync(targetDir)) {
        console.log(`📁 Creating migrations directory: ${targetDir}`);
        fs.mkdirSync(targetDir, { recursive: true });
        console.log('✅ No migrations to run (directory is empty)');
        return;
      }

      // Get all migration files
      const migrationFiles = fs.readdirSync(targetDir)
        .filter(file => file.endsWith('.sql'))
        .sort();

      if (migrationFiles.length === 0) {
        console.log('✅ No migration files found');
        return;
      }

      // Get already executed migrations
      const executedMigrations = await this.getExecutedMigrations();

      // Run only new migrations
      const pendingMigrations = migrationFiles.filter(
        file => !executedMigrations.includes(file)
      );

      if (pendingMigrations.length === 0) {
        console.log('✅ No pending migrations');
        return;
      }

      console.log(`📋 Found ${pendingMigrations.length} pending migrations`);

      for (const file of pendingMigrations) {
        console.log(`⚡ Running migration: ${file}`);
        
        const migrationPath = path.join(targetDir, file);
        const sql = fs.readFileSync(migrationPath, 'utf8');
        
        // Execute migration in transaction
        await this.connection!.beginTransaction();
        
        try {
          // Split by semicolon and execute each statement
          const statements = sql.split(';').filter(stmt => stmt.trim());
          
          for (const statement of statements) {
            if (statement.trim()) {
              await this.connection!.execute(statement);
            }
          }
          
          // Record successful migration
          await this.recordMigration(file);
          await this.connection!.commit();
          
          console.log(`✅ Migration ${file} completed`);
        } catch (error) {
          await this.connection!.rollback();
          throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      console.log('🎉 All migrations completed successfully!');
    } finally {
      await this.disconnect();
    }
  }
}

/**
 * CLI function to run migrations
 */
async function runMigrations() {
  const runner = new MigrationRunner();
  
  try {
    await runner.runMigrations();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}

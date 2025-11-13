import { existsSync, readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

/**
 * Load database configuration from JSON config file
 * Reads from /alloc/config.json (container) or ./config.json (host)
 *
 * @returns Database connection configuration
 * @throws Error if config file not found or invalid
 */
function getDatabaseConfig() {
  const configPath = '/alloc/config.json';

  if (!existsSync(configPath)) {
    throw new Error(
      `Database configuration file not found. Expected ${configPath}`
    );
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    if (!config.DATABASE?.VALUE) {
      throw new Error('Invalid config.json structure: DATABASE.VALUE not found');
    }

    const db = config.DATABASE.VALUE;

    if (!db.HOST || !db.PORT || !db.USERNAME || !db.PASSWORD || !db.NAME) {
      throw new Error('Invalid config.json: Missing required database credentials');
    }

    return {
      host: db.HOST,
      port: db.PORT,
      user: db.USERNAME,
      password: db.PASSWORD,
      database: db.NAME,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse ${configPath}: Invalid JSON format`);
    }
    throw error;
  }
}

/**
 * Database connection setup using Drizzle ORM with MySQL2
 *
 * Configuration source:
 * - Reads from /alloc/config.json (in container) or ./config.json (on host)
 * - Throws error if config file not found or invalid
 */

// Get database configuration
const dbConfig = getDatabaseConfig();

// Create MySQL connection pool with SSL enabled
const poolConnection = mysql.createPool({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  ssl: {
    rejectUnauthorized: false,
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Create Drizzle instance
export const db = drizzle(poolConnection, { schema, mode: 'default' });

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const connection = await poolConnection.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch {
    return false;
  }
}

/**
 * Close database connection pool
 */
export async function closeConnection(): Promise<void> {
  await poolConnection.end();
}

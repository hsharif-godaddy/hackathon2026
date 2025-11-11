import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

/**
 * Database connection setup using Drizzle ORM with MySQL2
 *
 * Environment variables (automatically injected by Docker container):
 * - DATABASE_URL: Full MySQL connection string
 * - MYSQL_HOST: MySQL server hostname
 * - MYSQL_PORT: MySQL server port
 * - MYSQL_DATABASE: Database name
 * - MYSQL_USER: Database user
 * - MYSQL_PASSWORD: User password
 * - MYSQL_ROOT_PASSWORD: Root password (for migrations)
 */

// Create MySQL connection pool
const poolConnection = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'appuser',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'appdb',
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
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

/**
 * Close database connection pool
 */
export async function closeConnection(): Promise<void> {
  await poolConnection.end();
}

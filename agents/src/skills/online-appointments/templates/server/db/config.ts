/**
 * Database configuration loader
 *
 * This module provides centralized access to database configuration
 * from environment variables.
 */

export interface DatabaseConfig {
  url: string;
  connectionLimit?: number;
  enableKeepAlive?: boolean;
  keepAliveInitialDelay?: number;
}

/**
 * Get database configuration from environment
 * @throws {Error} If DATABASE_URL is not set
 */
export function getDatabaseConfig(): DatabaseConfig {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  return {
    url,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    enableKeepAlive: process.env.DB_KEEP_ALIVE !== "false",
    keepAliveInitialDelay: Number(process.env.DB_KEEP_ALIVE_DELAY) || 10000,
  };
}

import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

/**
 * Load database configuration from JSON config file
 * Reads from /alloc/config.json (container) or ./config.json (host)
 *
 * @returns MySQL connection URL
 * @throws Error if config file not found or invalid
 */
function getDatabaseUrl(): string {
  // Try container path first (when running in Docker)
  const containerConfigPath = '/alloc/config.json';
  // Fall back to host path (when running drizzle-kit from host)
  const hostConfigPath = './config.json';

  const configPath = existsSync(containerConfigPath) ? containerConfigPath : hostConfigPath;

  if (!existsSync(configPath)) {
    throw new Error(
      `Database configuration file not found. Expected ${containerConfigPath} or ${hostConfigPath}`
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

    return `mysql://${db.USERNAME}:${db.PASSWORD}@${db.HOST}:${db.PORT}/${db.NAME}`;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse ${configPath}: Invalid JSON format`);
    }
    throw error;
  }
}

/**
 * Drizzle Kit configuration for database migrations
 *
 * Usage:
 * - Generate migrations: npx drizzle-kit generate
 * - Push schema to database: npx drizzle-kit push
 * - Open Drizzle Studio: npx drizzle-kit studio
 *
 * Configuration source:
 * - Reads from /alloc/config.json (in container) or ./config.json (on host)
 * - Throws error if config file not found or invalid
 */
export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    url: getDatabaseUrl(),
  },
});

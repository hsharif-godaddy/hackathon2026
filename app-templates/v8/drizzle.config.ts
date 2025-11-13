import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

/**
 * Database credentials interface
 */
interface DatabaseCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Load database configuration from JSON config file
 * Reads from /alloc/config.json
 *
 * @returns MySQL connection credentials
 * @throws Error if config file not found or invalid
 */
function getDatabaseCredentials(): DatabaseCredentials {
  const configPath = '/alloc/config.json';

  if (!existsSync(configPath)) {
    throw new Error(
      `Database configuration file not found at ${configPath}`
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
      port: parseInt(String(db.PORT), 10),
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
 * Drizzle Kit configuration for database migrations
 *
 * Usage:
 * - Generate migrations: npx drizzle-kit generate
 * - Push schema to database: npx drizzle-kit push
 *
 * Configuration source:
 * - Reads from /alloc/config.json
 * - Throws error if config file not found or invalid
 */
const credentials = getDatabaseCredentials();

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    password: credentials.password,
    database: credentials.database,
    ssl: {
      rejectUnauthorized: false,
    }
  },
});

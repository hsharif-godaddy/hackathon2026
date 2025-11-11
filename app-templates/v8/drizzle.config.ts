import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration for database migrations
 *
 * Usage:
 * - Generate migrations: npx drizzle-kit generate
 * - Push schema to database: npx drizzle-kit push
 * - Open Drizzle Studio: npx drizzle-kit studio
 *
 * Environment variables:
 * - DATABASE_URL: Full MySQL connection string (automatically injected in Docker)
 */
export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    // Use DATABASE_URL if available, otherwise construct from individual env vars
    url:
      process.env.DATABASE_URL ||
      `mysql://${process.env.MYSQL_USER || 'appuser'}:${process.env.MYSQL_PASSWORD || ''}@${process.env.MYSQL_HOST || 'localhost'}:${process.env.MYSQL_PORT || '3306'}/${process.env.MYSQL_DATABASE || 'appdb'}`,
  },
});

/**
 * Database client configuration
 *
 * **DEV_MODE=true**: reads DATABASE_URL environment variable
 * **Default (production)**: reads DATABASE secret from $NOMAD_TASK_DIR/config.json
 *   Secret format: { "HOST"|"host", "PORT"|"port", "USERNAME"|"user", "PASSWORD"|"password", "NAME"|"database" }
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";

interface DatabaseCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface RawSecret {
  VALUE?: {
    HOST?: string;
    host?: string;
    PORT?: number;
    port?: number;
    USERNAME?: string;
    user?: string;
    PASSWORD?: string;
    password?: string;
    NAME?: string;
    database?: string;
  };
}

interface RawConfig {
  DATABASE?: RawSecret;
}

function readDatabaseSecret(): DatabaseCredentials | null {
  try {
    const configPath = join(process.env.NOMAD_TASK_DIR ?? "/local", "config.json");
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const config = JSON.parse(readFileSync(configPath, "utf8")) as RawConfig;
    const entry = config["DATABASE"];
    if (!entry?.VALUE) return null;
    const v = entry.VALUE;
    return {
      host: v.HOST ?? v.host ?? "",
      port: v.PORT ?? v.port ?? 3306,
      user: v.USERNAME ?? v.user ?? "",
      password: v.PASSWORD ?? v.password ?? "",
      database: v.NAME ?? v.database ?? "",
    };
  } catch {
    return null;
  }
}

function getDatabaseConfig(): mysql.PoolOptions {
  if (process.env.DEV_MODE === "true") {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required when DEV_MODE=true");
    }
    return {
      uri: DATABASE_URL,
      waitForConnections: true,
      connectionLimit: 10,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    };
  }

  const creds = readDatabaseSecret();
  if (!creds?.host || !creds.user || !creds.password || !creds.database) {
    throw new Error(
      "DATABASE secret not found or missing required fields (host, user, password, database)",
    );
  }

  return {
    host: creds.host,
    port: creds.port,
    user: creds.user,
    password: creds.password,
    database: creds.database,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    ssl: {
      rejectUnauthorized: false,
    },
  };
}

const pool = mysql.createPool(getDatabaseConfig());

export const db = drizzle(pool, { schema, mode: "default" });

export async function testConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch {
    return false;
  }
}

export async function closeConnection(): Promise<void> {
  await pool.end();
}

/**
 * Database configuration loader
 *
 * Reads from $NOMAD_TASK_DIR/config.json (defaults to /local/config.json)
 * or DATABASE_URL when DEV_MODE=true.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DatabaseCredentials {
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

export function getDatabaseCredentials(): DatabaseCredentials {
  if (process.env.DEV_MODE === "true") {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required when DEV_MODE=true");
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 3306,
      user: parsed.username,
      password: parsed.password,
      database: parsed.pathname.replace(/^\//, ""),
    };
  }

  try {
    const configPath = join(process.env.NOMAD_TASK_DIR ?? "/local", "config.json");
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const config = JSON.parse(readFileSync(configPath, "utf8")) as RawConfig;
    const entry = config["DATABASE"];
    if (!entry?.VALUE) throw new Error("DATABASE.VALUE missing in config.json");
    const v = entry.VALUE;
    return {
      host: v.HOST ?? v.host ?? "",
      port: v.PORT ?? v.port ?? 3306,
      user: v.USERNAME ?? v.user ?? "",
      password: v.PASSWORD ?? v.password ?? "",
      database: v.NAME ?? v.database ?? "",
    };
  } catch (e) {
    throw new Error(`Database configuration file not found at /local/config.json: ${String(e)}`);
  }
}

// Legacy alias
export interface DatabaseConfig {
  url: string;
  connectionLimit?: number;
}

export function getDatabaseConfig(): DatabaseConfig {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is not set");
  return { url, connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10 };
}

export interface DatabaseResult {
  changes: number;
  lastInsertRowid?: number | bigint | string;
}

export interface DatabaseRow {
  [key: string]: unknown;
}

export interface DatabaseAdapter {
  // Core CRUD operations
  run(sql: string, params?: unknown[]): DatabaseResult | Promise<DatabaseResult>;
  get<T = DatabaseRow>(sql: string, params?: unknown[]): T | undefined | Promise<T | undefined>;
  all<T = DatabaseRow>(sql: string, params?: unknown[]): T[] | Promise<T[]>;

  // Connection management
  close(): void | Promise<void>;

  // Schema management
  exec(sql: string): void | Promise<void>;

  // Database-specific utilities
  pragma?(query: string): unknown[];
  prepare?(sql: string): DatabaseStatement;
}

export interface DatabaseStatement {
  run(...params: unknown[]): DatabaseResult | Promise<DatabaseResult>;
  get<T = DatabaseRow>(...params: unknown[]): T | undefined | Promise<T | undefined>;
  all<T = DatabaseRow>(...params: unknown[]): T[] | Promise<T[]>;
}

export interface DatabaseConfig {
  type: 'mysql';

  // MySQL specific
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export interface Plan {
  id: string;
  name: string;
  site_limit: number;
  price: number;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  shopper_id: string;
  customer_id: string;
  plan_id: string | null;
  status: 'active' | 'suspended' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface Site {
  id: string;
  account_id: string;
  title: string | null;
  initial_prompt: string | null;
  domain: string | null;
  agent_url: string | null;
  backend_url: string | null;
  preview_url: string | null;
  published_url: string | null;
  ceph_mount_id: string | null;
  ceph_dir_number: string | null;
  status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error';
  created_at: string;
  updated_at: string;
}

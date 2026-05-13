import type { LogEntry } from './diagnostics.js';
import type { ProcessSnapshot } from './runtime.js';

export interface PrepareOptions {
  commitHash?: string;
}

export interface PrepareResult {
  artifactId: string;
  kind: 'build-bundle';
  commitHash: string;
  size: number;
  sha256: string;
}

export interface DeployOptions {
  artifactId: string;
  waitForHealthy?: boolean;
  healthTimeoutSeconds?: number;
}

export interface DeployResult {
  status: 'success' | 'error';
  version: string;
  activatedAt: Date;
  healthStatus?: 'healthy' | 'unhealthy' | 'timeout';
  healthCheckDurationMs?: number;
  error?: string;
  logs?: LogEntry[];
  exitCode?: number;
}

export interface DeploymentStatus {
  version: string | null;
  activatedAt?: Date;
  health: {
    status: 'healthy' | 'unhealthy' | 'stopped' | 'unknown';
    message: string;
  };
  process: ProcessSnapshot;
  logs?: LogEntry[];
  warnings?: string[];
}

export interface StatusOptions {
  includeLogs?: boolean;
  logLines?: number;
}

export interface WorkspaceDeployments {
  prepare(options?: PrepareOptions): Promise<PrepareResult>;
  activate(options: DeployOptions): Promise<DeployResult>;
  status(options?: StatusOptions): Promise<DeploymentStatus>;
  unpublish(): Promise<{ status: 'success' | 'not_published' }>;
}

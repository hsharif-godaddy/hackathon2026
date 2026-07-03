export type ProcessState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

interface HealthCheckConfigBase {
  intervalSeconds: number;
  timeoutSeconds: number;
  failureThreshold: number;
  successThreshold?: number;
  startPeriodSeconds?: number;
}

export type HealthCheckConfig =
  | ({ type: 'http'; url: string } & HealthCheckConfigBase)
  | ({ type: 'command'; command: string } & HealthCheckConfigBase)
  | ({ type: 'tcp'; address: string } & HealthCheckConfigBase);

export interface RestartPolicy {
  enabled: boolean;
  maxRestarts: number;
  windowSeconds: number;
  backoffMultiplier?: number;
  maxBackoffSeconds?: number;
  initialDelaySeconds?: number;
}

/**
 * A snapshot of the managed process. Reused by `DeploymentStatus.process` so
 * that interface does not silently break when `RuntimeStatus` drops a field.
 */
export interface ProcessSnapshot {
  state: ProcessState;
  pid?: number;
  startedAt?: Date;
  exitCode?: number;
  lastError?: string;
}

export interface RuntimeStatus extends ProcessSnapshot {
  health: {
    status: 'healthy' | 'unhealthy' | 'starting' | 'disabled';
    message: string;
    /** Absent when `status` is `'disabled'` or `'starting'` and no check has run yet. */
    lastCheckedAt?: Date;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
  };
  restarts: {
    total: number;
    recent: number;
    windowSeconds: number;
    maxRestarts: number;
  };
}

/** Health + restart stats without the process/PID snapshot; counterpart to status(). */
export type HealthSnapshot = Pick<RuntimeStatus, 'health' | 'restarts'>;

export interface HealthConfigUpdate {
  healthCheck?: HealthCheckConfig;
  restartPolicy?: RestartPolicy;
}

export interface StopOptions {
  signal?: string;
  timeoutSeconds?: number;
}

export interface RestartOptions {
  graceful?: boolean;
}

export interface StartOptions {
  /** Passed verbatim to dev-supervisor; caller owns sh -c wrapping/escaping. */
  command: string;
  workingDir?: string;
  env?: Record<string, string>;
}

export interface WorkspaceRuntime {
  status(): Promise<RuntimeStatus>;
  start(options: StartOptions): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
  restart(options?: RestartOptions): Promise<void>;
  check(): Promise<HealthSnapshot>;
  configureHealth(update: HealthConfigUpdate): Promise<void>;
}

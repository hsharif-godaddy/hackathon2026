import http from 'http';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { validateHostPort } from '../utils/network-validation.js';
import { buildCurlCommand } from '../utils/command-builder.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const RESTART_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Structured error from the dev-supervisor HTTP API.
 * The dev-supervisor returns JSON `{error: "code", message: "detail"}` on all
 * non-2xx responses. This class preserves that structure so callers can switch
 * on `.code` instead of string-matching `.message`.
 */
export class DevSupervisorError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'DevSupervisorError';
  }
}

export interface ExecOptions {
  /** The command to execute */
  command: string;
  /** Working directory (optional) */
  working_dir?: string;
  /** Timeout in seconds (default: 30) */
  timeout?: number;
  /** Capture output (default: true) */
  capture_output?: boolean;
  /** Per-command environment variable overrides (merged with base env, no global mutation) */
  env?: Record<string, string>;
}

export interface TaskSubmitOptions {
  /** The command to execute */
  command: string;
  /** Working directory (optional) */
  working_dir?: string;
  /** Hard execution timeout in seconds (default: 30, max: 3600) */
  timeout?: number;
  /** Per-command environment variable overrides */
  env?: Record<string, string>;
  /** How long to block the HTTP response waiting for completion (seconds). 0 = return immediately. */
  wait_seconds?: number;
}

export type TaskState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'timed_out';

export interface TaskCompletedResult {
  kind: 'completed';
  task_id: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  execution_time_ms: number;
  timed_out: boolean;
  command_id: number;
}

export interface TaskAcceptedResult {
  kind: 'accepted';
  task_id: string;
  state: TaskState;
}

export type TaskSubmitResult = TaskCompletedResult | TaskAcceptedResult;

export interface TaskStatusResult {
  task_id: string;
  state: TaskState;
  command: string;
  exit_code: number;
  error?: string;
  timed_out: boolean;
  started_at?: string;
  finished_at?: string;
  execution_time_ms: number;
  command_id: number;
}

export interface TaskOutputResult {
  stdout: string;
  stderr: string;
  next_offset: number;
  next_stderr_offset: number;
  complete: boolean;
}

export interface TaskCancelResult {
  state: 'canceled' | 'already_finished';
}

export interface ExecResult {
  /** The command that was executed */
  command: string;
  /** Exit code */
  exit_code: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Execution time in milliseconds */
  execution_time: number;
  /** Whether the command succeeded */
  success: boolean;
  /** Whether the command timed out */
  timed_out?: boolean;
  /** Error message from dev-supervisor */
  error?: string;
}

export interface ProcessStartOptions {
  /** The command to start */
  command: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  working_dir?: string;
}

export interface ProcessInfo {
  /** Process ID */
  pid: number;
  /** Command being executed */
  command: string;
  /** Process state */
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  /** Start time */
  start_time: string;
  /** Exit code if stopped */
  exit_code?: number;
  /** Error message if failed */
  error?: string;
}

export interface ProcessStopOptions {
  /** Signal to send (default: SIGTERM) */
  signal?: string;
  /** Timeout in seconds (default: 30) */
  timeout?: number;
}

export interface ProcessRestartOptions {
  /** Graceful restart (default: true) */
  graceful?: boolean;
}

export interface RestartResult {
  /** Whether the restart succeeded */
  success: boolean;
  /** Error message if restart failed */
  error?: string;
}

export interface LogOptions {
  /** Source filter (stdout, stderr, exec, health_monitor, ...) */
  source?: string;
  /** Number of lines to retrieve */
  lines?: number;
  /** Since timestamp (ISO 8601) */
  since?: string;
  /**
   * Restrict results to entries produced by a single /exec invocation.
   * Combine with `source: 'exec'` to scope to one command's output.
   */
  commandId?: number;
}

export interface LogEntry {
  /** Timestamp */
  timestamp: string;
  /** Source (stdout, stderr, exec, health_monitor, ...) */
  source: string;
  /** Log level */
  level?: string;
  /** Log message */
  message: string;
  /**
   * Non-zero for entries produced by /exec; correlates lines emitted by
   * the same command and matches the `command_id` returned on the /exec
   * response body.
   */
  command_id?: number;
}

export interface HealthCheckConfig {
  /** Health check type */
  type: 'command' | 'http' | 'tcp';
  /** Command to execute (for command type) */
  command?: string;
  /** URL to check (for http type) */
  url?: string;
  /** Address to check (for tcp type) */
  address?: string;
  /** Check interval */
  interval: string;
  /** Check timeout */
  timeout: string;  
  /** Number of retries before failure */
  retries?: number;
  /** Failure threshold */
  failure_threshold: number;
  /** Success threshold */
  success_threshold?: number;
  /** Start period */
  start_period?: string;
}

export interface RestartPolicy {
  /** Enable restart policy */
  enabled: boolean;
  /** Maximum restarts in window */
  max_restarts: number;
  /** Restart window duration */
  restart_window: string;
  /** Backoff multiplier */
  backoff_multiplier?: number;
  /** Maximum backoff duration */
  max_backoff?: string;
  /** Initial delay */
  initial_delay?: string;
}

export interface HealthStatus {
  /** Health status */
  status: 'healthy' | 'unhealthy' | 'starting' | 'disabled';
  /** Status message */
  message: string;
  /** Last check time */
  last_check: string;
  /** Check duration */
  duration: number;
  /** Consecutive failures */
  consecutive_failures: number;
  /** Consecutive successes */
  consecutive_successes: number;
}

export interface RestartStats {
  /** Total restarts */
  total_restarts: number;
  /** Recent restarts in window */
  recent_restarts: number;
  /** Restart window */
  restart_window: string;
  /** Maximum restarts */
  max_restarts: number;
  /** Manual restarts */
  manual_restarts?: number;
}

export interface ProxyConfig {
  /** Proxy enabled */
  enabled: boolean;
  /** Listen port */
  listen_port: number;
  /** Target host */
  target_host: string;
  /** Target port */
  target_port: number;
  /** TLS certificate path */
  tls_cert_path: string;
  /** TLS key path */
  tls_key_path: string;
}

export interface ProxyStatus {
  /** Proxy enabled */
  enabled: boolean;
  /** Proxy running */
  running: boolean;
  /** Listen address */
  listen_addr?: string;
  /** Target URL */
  target_url?: string;
  /** Uptime */
  uptime?: string;
}

/**
 * Request to publish a new version
 */
export interface PublishRequest {
  /** Commit hash to publish */
  commitHash: string;
  /** Force publish even if version exists (optional) */
  force?: boolean;
  /** Wait for app to be healthy before returning (optional, default: false) */
  waitForHealthy?: boolean;
  /** Timeout in seconds for health check (optional, default: 60) */
  healthTimeoutSeconds?: number;
}

/**
 * Log entry from publish status
 */
export interface PublishLogEntry {
  timestamp: string;
  source: 'stdout' | 'stderr' | 'system';
  message: string;
}

/**
 * Success response from publish endpoint
 */
export interface PublishSuccessResponse {
  /** Status of the publish operation */
  status: 'success';
  /** Version that was published (commit hash) */
  version: string;
  /** Startup time of the new version */
  startupTime?: string;
  /** Health status after publish (only if waitForHealthy was true) */
  healthStatus?: 'healthy' | 'unhealthy' | 'timeout';
  /** Duration of health check (only if waitForHealthy was true) */
  healthCheckDuration?: string;
}

/**
 * Error response from publish endpoint
 */
export interface PublishErrorResponse {
  /** Status of the publish operation */
  status: 'error';
  /** Error message */
  error: string;
  /** Detailed error logs (optional) */
  logs?: PublishLogEntry[];
  /** Exit code if applicable */
  exitCode?: number;
  /** Health status if health check failed */
  healthStatus?: 'unhealthy' | 'timeout';
  /** Duration of health check */
  healthCheckDuration?: string;
  /** Version that was being published */
  version?: string;
  /** Startup time before health check failed */
  startupTime?: string;
}

/**
 * Combined publish response type
 */
export type PublishResponse = PublishSuccessResponse | PublishErrorResponse;

/**
 * Response from POST /unpublish endpoint
 *
 * Errors are returned as non-2xx responses and handled by makeRequest,
 * so this type describes only successful (2xx) payloads.
 */
export interface UnpublishResponse {
  /** Status of the unpublish operation */
  status: 'success' | 'not_published';
}

/**
 * Response from /publish/status endpoint
 */
export interface PublishStatusResponse {
  /** Current version (commit hash) being served, null if no version published yet */
  version: string | null;
  /** Health status of the app (active health check result) */
  health: {
    status: 'healthy' | 'unhealthy' | 'stopped' | 'unknown';
    message: string;
  };
  /** Process state */
  process: {
    state: 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
    pid: number;
    uptime: string;
  };
  /** Recent logs (if includeLogs=true) */
  logs?: PublishLogEntry[];
  /** Warnings about the publish state */
  warnings?: string[];
}

/**
 * Response from /setup/status endpoint
 */
export interface SetupStatus {
  /** Whether a setup script is configured */
  setup_configured: boolean;
  /** Whether setup is still deferred/pending (configured but not yet executed) */
  setup_deferred: boolean;
  /** Whether setup has been executed successfully */
  setup_executed: boolean;
  /** Whether setup is currently running */
  setup_running: boolean;
  /** Error message if setup failed */
  setup_error: string | null;
}

/**
 * Response from /setup/execute endpoint
 */
export interface SetupExecuteResponse {
  /** Status of the setup execution attempt. Failures throw (HTTP 500) rather than resolving. */
  status: 'executed' | 'already_executed' | 'not_configured';
}

/**
 * Client for communicating with dev-supervisor over Unix domain socket or TCP
 */
export class DevSupervisorClient {
  private connectionPath: string;
  private useTcp: boolean;
  private logger: Logger;

  constructor(connectionPath: string) {
    if (!connectionPath) {
      throw new Error('DevSupervisorClient requires an explicit connection path - no default allowed');
    }
    this.connectionPath = connectionPath;
    this.useTcp = connectionPath.startsWith('tcp://');
    this.logger = Logger.create({ component: 'dev-supervisor-client' });
  }

  /**
   * Check if dev-supervisor is available
   */
  isAvailable(): boolean {
    if (this.useTcp) {
      return this.isTcpPortOpen();
    } else {
      return existsSync(this.connectionPath);
    }
  }

  /**
   * Check if TCP port is open
   */
  private isTcpPortOpen(): boolean {
    try {
      const url = new URL(this.connectionPath);
      const port = parseInt(url.port) || 8080;
      const host = url.hostname || 'localhost';
      
      // Simple TCP connection test using sync method
      return testTcpConnectionSync(host, port);
    } catch (error) {
      return false;
    }
  }


  /**
   * Execute a command via dev-supervisor
   */
  async exec(options: ExecOptions): Promise<ExecResult> {
    this.logger.info('dev_supervisor.exec.begin', {
      command: options.command,
      working_dir: options.working_dir,
      timeout: options.timeout
    });

    try {
      const execTimeoutSec = options.timeout || 30;
      const response = await this.makeRequest('POST', '/exec', {
        command: options.command,
        working_dir: options.working_dir,
        timeout: execTimeoutSec,
        capture_output: options.capture_output !== false,
        env: options.env,
      }, (execTimeoutSec + 5) * 1000);

      // Log timeout separately from success for better observability
      if (response.timed_out) {
        this.logger.warn('dev_supervisor.exec.timeout', {
          command: options.command,
          timeout_seconds: options.timeout || 30,
          execution_time: response.execution_time,
          error: response.error,
        });
      } else {
        this.logger.info('dev_supervisor.exec.success', {
          command: options.command,
          exit_code: response.exit_code,
          execution_time: response.execution_time
        });
      }

      // Ensure success field is properly set based on exit code
      const result: ExecResult = {
        command: response.command || options.command,
        exit_code: response.exit_code || 0,
        stdout: response.stdout || '',
        stderr: response.stderr || '',
        execution_time: response.execution_time || 0,
        success: response.success ?? (response.exit_code === 0),
        timed_out: response.timed_out,
        error: response.error,
      };

      return result;
    } catch (error) {
      this.logger.error('dev_supervisor.exec.failure', {
        command: options.command,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Start a process via dev-supervisor
   */
  async startProcess(options: ProcessStartOptions): Promise<ProcessInfo> {
    this.logger.info('dev_supervisor.process.start.begin', {
      command: options.command,
      working_dir: options.working_dir
    });

    try {
      await this.makeRequest('POST', '/process/start', {
        command: options.command,
        env: options.env,
        working_dir: options.working_dir
      });

      // Get the process status after starting
      const status = await this.getProcessStatus();
      
      this.logger.info('dev_supervisor.process.start.success', {
        command: options.command,
        pid: status.pid,
        state: status.state
      });

      return status;
    } catch (error) {
      this.logger.error('dev_supervisor.process.start.failure', {
        command: options.command,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Stop the current process
   */
  async stopProcess(options: ProcessStopOptions = {}): Promise<boolean> {
    this.logger.info('dev_supervisor.process.stop.begin', {
      signal: options.signal,
      timeout: options.timeout
    });

    try {
      await this.makeRequest('POST', '/process/stop', {
        signal: options.signal || 'SIGTERM',
        timeout: options.timeout || 30
      });

      this.logger.info('dev_supervisor.process.stop.success', {});
      return true;
    } catch (error) {
      this.logger.error('dev_supervisor.process.stop.failure', {
        error: getErrorMessage(error)
      });
      return false;
    }
  }

  /**
   * Restart the current process
   */
  async restartProcess(options: ProcessRestartOptions = {}): Promise<RestartResult> {
    this.logger.info('dev_supervisor.process.restart.begin', {
      graceful: options.graceful
    });

    try {
      await this.makeRequest('POST', '/process/restart', {
        graceful: options.graceful !== false
      }, RESTART_REQUEST_TIMEOUT_MS);

      this.logger.info('dev_supervisor.process.restart.success', {});
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('dev_supervisor.process.restart.failure', {
        error: errorMessage
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get current process status
   */
  async getProcessStatus(): Promise<ProcessInfo> {
    try {
      const response = await this.makeRequest('GET', '/process/status');
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.process.status.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Get logs from dev-supervisor
   */
  async getLogs(options: LogOptions = {}): Promise<LogEntry[]> {
    try {
      const params = new URLSearchParams();
      if (options.source) params.set('source', options.source);
      if (options.lines) params.set('lines', options.lines.toString());
      if (options.since) params.set('since', options.since);
      if (options.commandId) params.set('command_id', options.commandId.toString());

      const url = `/logs${params.toString() ? '?' + params.toString() : ''}`;
      const response = await this.makeRequest('GET', url);
      
      return response.logs || [];
    } catch (error) {
      this.logger.error('dev_supervisor.logs.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Configure health monitoring
   */
  async configureHealthCheck(healthCheck?: HealthCheckConfig, restartPolicy?: RestartPolicy): Promise<void> {
    this.logger.info('dev_supervisor.health.configure.begin', {
      health_check_type: healthCheck?.type,
      restart_policy_enabled: restartPolicy?.enabled
    });

    try {
      await this.makeRequest('PUT', '/health-config', {
        health_check: healthCheck,
        restart_policy: restartPolicy
      });

      this.logger.info('dev_supervisor.health.configure.success', {});
    } catch (error) {
      this.logger.error('dev_supervisor.health.configure.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<HealthStatus> {
    try {
      const response = await this.makeRequest('GET', '/health-config/status');
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.health.status.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Get restart statistics
   */
  async getRestartStats(): Promise<RestartStats> {
    try {
      const response = await this.makeRequest('GET', '/health-config/restart-stats');
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.health.restart_stats.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Get system information
   */
  async getInfo(): Promise<any> {
    try {
      const response = await this.makeRequest('GET', '/info');
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.info.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Health check for dev-supervisor itself
   */
  async healthCheck(): Promise<{ status: string; version: string; uptime: string }> {
    try {
      const response = await this.makeRequest('GET', '/health');
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.health_check.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Get HTTP proxy configuration
   *
   * @returns Proxy configuration settings
   */
  async getProxyConfig(): Promise<ProxyConfig> {
    try {
      const response = await this.makeRequest('GET', '/proxy/config');
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.proxy.config.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Get HTTP proxy status
   *
   * @returns Current proxy status and health information
   */
  async getProxyStatus(): Promise<ProxyStatus> {
    try {
      const response = await this.makeRequest('GET', '/proxy/status');
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.proxy.status.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Publish a new version
   * 
   * Tells the publish supervisor to switch to serving a new version from dist/
   * This is used in V4 unified job architecture where the publish task runs continuously
   * and switches versions on demand without redeploying the job.
   * 
   * @param request - Publish request with commitHash, optional force flag, and health check options
   * @returns Publish response with status and version info
   * @throws Error if publish fails
   */
  async publish(request: PublishRequest): Promise<PublishResponse> {
    this.logger.info('dev_supervisor.publish.begin', {
      commitHash: request.commitHash,
      force: request.force,
      waitForHealthy: request.waitForHealthy,
      healthTimeoutSeconds: request.healthTimeoutSeconds
    });

    try {
      const healthTimeoutSec = request.healthTimeoutSeconds || 60;
      const response = await this.makeRequest('POST', '/publish', {
        commitHash: request.commitHash,
        force: request.force || false,
        waitForHealthy: request.waitForHealthy || false,
        healthTimeoutSeconds: healthTimeoutSec
      }, request.waitForHealthy ? (healthTimeoutSec + 30) * 1000 : undefined);

      this.logger.info('dev_supervisor.publish.success', {
        commitHash: request.commitHash,
        status: response.status,
        version: response.version,
        healthStatus: response.healthStatus
      });

      return response as PublishResponse;
    } catch (error) {
      this.logger.error('dev_supervisor.publish.failure', {
        commitHash: request.commitHash,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Unpublish the current version
   *
   * Removes the `current` symlink and restarts the process so the app
   * reverts to serving the Coming Soon page.
   *
   * @returns Unpublish response with status
   * @throws Error if unpublish fails
   */
  async unpublish(): Promise<UnpublishResponse> {
    this.logger.info('dev_supervisor.unpublish.begin', {});

    try {
      const response = await this.makeRequest('POST', '/unpublish');

      this.logger.info('dev_supervisor.unpublish.success', {
        status: response.status
      });

      return response as UnpublishResponse;
    } catch (error) {
      this.logger.error('dev_supervisor.unpublish.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Get publish status
   *
   * Returns the current version being served, health status, process state, and logs.
   * Useful for diagnosing production issues when users report problems.
   *
   * @param options - Options for the status request
   * @returns Publish status response with version, health, process, and logs
   */
  async getPublishStatus(options?: { lines?: number; includeLogs?: boolean }): Promise<PublishStatusResponse> {
    const lines = options?.lines ?? 200;
    const includeLogs = options?.includeLogs ?? true;

    this.logger.info('dev_supervisor.publish_status.begin', {
      lines,
      includeLogs
    });

    try {
      const queryParams = new URLSearchParams();
      queryParams.set('lines', lines.toString());
      queryParams.set('includeLogs', includeLogs.toString());

      const response = await this.makeRequest('GET', `/publish/status?${queryParams.toString()}`);

      this.logger.info('dev_supervisor.publish_status.success', {
        version: response.version,
        healthStatus: response.health?.status,
        processState: response.process?.state
      });

      return response as PublishStatusResponse;
    } catch (error) {
      this.logger.error('dev_supervisor.publish_status.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Get setup script status (deferred setup tracking)
   */
  async getSetupStatus(): Promise<SetupStatus> {
    try {
      const response = await this.makeRequest('GET', '/setup/status');
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.setup_status.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Trigger deferred setup execution (runs nomad_setup.sh).
   * Idempotent: returns 'already_executed' if setup already ran.
   * If setup is not configured, resolves with status 'not_configured' (HTTP 200)
   * — callers must inspect the status field, not just check for thrown errors.
   * Best-effort side effect: starts the preview process if stopped.
   * Process start failures do not affect the response status.
   * Setup failures throw (HTTP 500) rather than resolving.
   */
  async executeSetup(): Promise<SetupExecuteResponse> {
    this.logger.info('dev_supervisor.setup_execute.begin');
    try {
      const response = await this.makeRequest('POST', '/setup/execute', undefined, 5 * 60 * 1000);
      this.logger.info('dev_supervisor.setup_execute.success', {
        status: response.status
      });
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.setup_execute.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async submitTask(options: TaskSubmitOptions): Promise<TaskSubmitResult> {
    const waitSeconds = options.wait_seconds ?? 0;
    const timeoutSec = options.timeout ?? 30;
    const httpTimeout = (Math.max(timeoutSec, waitSeconds) + 5) * 1000;

    this.logger.info('dev_supervisor.task.submit.begin', {
      command: options.command,
      working_dir: options.working_dir,
      timeout: timeoutSec,
      wait_seconds: waitSeconds,
    });

    try {
      const response = await this.makeRequest('POST', '/tasks', {
        command: options.command,
        working_dir: options.working_dir,
        timeout: timeoutSec,
        env: options.env,
        wait_seconds: waitSeconds,
      }, httpTimeout);

      const result = response as TaskSubmitResult;
      this.logger.info('dev_supervisor.task.submit.success', {
        task_id: result.task_id,
        kind: result.kind,
      });
      return result;
    } catch (error) {
      this.logger.error('dev_supervisor.task.submit.failure', {
        command: options.command,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async getTask(taskId: string): Promise<TaskStatusResult> {
    try {
      const response = await this.makeRequest('GET', `/tasks/${taskId}`);
      return response as TaskStatusResult;
    } catch (error) {
      this.logger.error('dev_supervisor.task.get.failure', {
        task_id: taskId,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async getTaskOutput(taskId: string, since?: number, max?: number): Promise<TaskOutputResult> {
    const params = new URLSearchParams();
    if (since !== undefined) params.set('since', since.toString());
    if (max !== undefined) params.set('max', max.toString());

    const query = params.toString();
    const path = `/tasks/${taskId}/output${query ? '?' + query : ''}`;

    try {
      const response = await this.makeRequest('GET', path);
      return response as TaskOutputResult;
    } catch (error) {
      this.logger.error('dev_supervisor.task.output.failure', {
        task_id: taskId,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async cancelTask(taskId: string): Promise<TaskCancelResult> {
    this.logger.info('dev_supervisor.task.cancel.begin', { task_id: taskId });

    try {
      const response = await this.makeRequest('POST', `/tasks/${taskId}/cancel`);
      const result = response as TaskCancelResult;
      this.logger.info('dev_supervisor.task.cancel.success', {
        task_id: taskId,
        state: result.state,
      });
      return result;
    } catch (error) {
      this.logger.error('dev_supervisor.task.cancel.failure', {
        task_id: taskId,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Make HTTP request to dev-supervisor over Unix socket or TCP
   */
  private makeRequest(
    method: string,
    path: string,
    data?: any,
    timeoutMs?: number,
    rawBody?: Buffer | Uint8Array,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const contentType = rawBody ? 'application/octet-stream' : 'application/json';
      const headers: Record<string, string | number> = { 'Content-Type': contentType };
      if (rawBody) {
        headers['Content-Length'] = rawBody.length;
      }

      let options: http.RequestOptions;

      if (this.useTcp) {
        const url = new URL(this.connectionPath);
        options = {
          hostname: url.hostname || 'localhost',
          port: parseInt(url.port) || 8080,
          method,
          path,
          headers,
        };
      } else {
        options = {
          socketPath: this.connectionPath,
          method,
          path,
          headers,
        };
      }

      const req = http.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          clearTimeout(timer);
          try {
            const response = body ? JSON.parse(body) : {};

            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(response);
            } else {
              const code = response.error || 'unknown';
              const detail = response.message || 'Request failed';
              reject(new DevSupervisorError(code, res.statusCode ?? 500, detail));
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      });

      req.on('error', (error) => {
        clearTimeout(timer);
        if ((error as any).code === 'ENOENT') {
          reject(new Error(`dev-supervisor not available at ${this.connectionPath}`));
        } else if ((error as any).code === 'ECONNREFUSED') {
          reject(new Error(`dev-supervisor TCP connection refused at ${this.connectionPath}`));
        } else {
          reject(error);
        }
      });

      const timeout = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        req.destroy(new Error(`Request timeout after ${timeout}ms: ${method} ${path}`));
      }, timeout);

      if (rawBody) {
        req.write(rawBody);
      } else if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  /**
   * Generic POST to a supervisor endpoint. Used by workspace adapters for
   * the /workspace/* API surface.
   */
  post(path: string, body: unknown): Promise<unknown> {
    return this.makeRequest('POST', path, body);
  }

  /**
   * Raw PUT with binary body. Used for binary uploads to workspace.
   */
  putRaw(path: string, data: Buffer | Uint8Array): Promise<unknown> {
    return this.makeRequest('PUT', path, undefined, undefined, data);
  }

  /**
   * Low-level streaming request. Returns the response stream directly for callers
   * that want to pipe or process incrementally. Non-2xx responses are rejected
   * with the error body consumed and parsed.
   */
  private requestStream(
    method: string,
    requestPath: string,
    headers?: Record<string, string>,
  ): Promise<{ stream: http.IncomingMessage; contentType: string; contentLength: number }> {
    return new Promise((resolve, reject) => {
      const reqHeaders: Record<string, string> = { ...headers };

      let options: http.RequestOptions;

      if (this.useTcp) {
        const url = new URL(this.connectionPath);
        options = {
          hostname: url.hostname || 'localhost',
          port: parseInt(url.port) || 8080,
          method,
          path: requestPath,
          headers: reqHeaders,
        };
      } else {
        options = {
          socketPath: this.connectionPath,
          method,
          path: requestPath,
          headers: reqHeaders,
        };
      }

      const req = http.request(options, (res) => {
        clearTimeout(timer);

        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          const contentType = res.headers['content-type'] || 'application/octet-stream';
          const contentLength = parseInt(res.headers['content-length'] || '0', 10);
          resolve({ stream: res, contentType, contentLength });
        } else {
          // Consume error body and reject
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', (err: Error) => reject(err));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            try {
              const response = JSON.parse(body);
              const code = response.error || 'unknown';
              const detail = response.message || 'Request failed';
              reject(new DevSupervisorError(code, res.statusCode ?? 500, detail));
            } catch {
              reject(new DevSupervisorError('unknown', res.statusCode ?? 500, body));
            }
          });
        }
      });

      req.on('error', (error) => {
        clearTimeout(timer);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`dev-supervisor not available at ${this.connectionPath}`));
        } else if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          reject(new Error(`dev-supervisor TCP connection refused at ${this.connectionPath}`));
        } else {
          reject(error);
        }
      });

      const timeout = DEFAULT_REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        req.destroy(new Error(`Request timeout after ${timeout}ms: ${method} ${requestPath}`));
      }, timeout);

      req.end();
    });
  }

  /**
   * Raw GET returning response body as a Buffer. For callers that need the full
   * binary content in memory (e.g. image classification). For streaming to an
   * HTTP response, use requestStream() directly.
   */
  async getRaw(path: string): Promise<{ data: Buffer; contentType: string }> {
    const { stream, contentType } = await this.requestStream('GET', path, {
      Accept: 'application/octet-stream',
    });

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve({ data: Buffer.concat(chunks), contentType }));
      stream.on('error', reject);
    });
  }
}

/**
 * Check if dev-supervisor is available in the current environment
 */
export function isDevSupervisorAvailable(connectionPath: string): boolean {
  if (!connectionPath) {
    throw new Error('isDevSupervisorAvailable requires an explicit connection path - no default allowed');
  }
  
  if (connectionPath.startsWith('tcp://')) {
    try {
      const url = new URL(connectionPath);
      const port = parseInt(url.port) || 8080;
      const host = url.hostname || 'localhost';
      
      // Use same TCP test method as the client
      return testTcpConnectionSync(host, port);
    } catch (error) {
      return false;
    }
  } else {
    return existsSync(connectionPath);
  }
}

/**
 * Test TCP connection synchronously using execSync with a simple curl command
 */
function testTcpConnectionSync(host: string, port: number): boolean {
  try {
    // Validate host and port parameters to prevent command injection
    const [safeHost, safePort] = validateHostPort(host, port);
    
    // Build the curl command using the secure command builder
    const url = `http://${safeHost}:${safePort}/health`;
    const command = buildCurlCommand(url, {
      connectTimeout: 1,
      maxTime: 1,
      failOnError: true
    });
    
    execSync(command, { 
      timeout: 2000,
      stdio: 'ignore'
    });
    
    return true;
  } catch (error) {
    // If curl fails (connection refused, timeout, etc.) or validation fails, return false
    return false;
  }
}

/**
 * Create a DevSupervisorClient instance if available
 */
export function createDevSupervisorClient(connectionPath: string): DevSupervisorClient | null {
  if (!connectionPath) {
    throw new Error('createDevSupervisorClient requires an explicit connection path - no default allowed');
  }
  if (isDevSupervisorAvailable(connectionPath)) {
    return new DevSupervisorClient(connectionPath);
  }
  return null;
}

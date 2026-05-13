import type {
  DevSupervisorClient,
  HealthCheckConfig as HealthCheckConfigWire,
  RestartPolicy as RestartPolicyWire,
} from '../../services/DevSupervisorClient.js';
import type {
  WorkspaceRuntime,
  RuntimeStatus,
  StopOptions,
  RestartOptions,
  HealthConfigUpdate,
  HealthCheckConfig,
  RestartPolicy,
} from '../runtime.js';
import { WorkspaceNotImplementedError } from '../errors.js';
import { parseDurationToSeconds } from './duration.js';
import { safeDate } from './wire.js';

function toHealthCheckWire(config: HealthCheckConfig): HealthCheckConfigWire {
  const wire: HealthCheckConfigWire = {
    type: config.type,
    interval: `${config.intervalSeconds}s`,
    timeout: `${config.timeoutSeconds}s`,
    failure_threshold: config.failureThreshold,
  };
  switch (config.type) {
    case 'command':
      wire.command = config.command;
      break;
    case 'http':
      wire.url = config.url;
      break;
    case 'tcp':
      wire.address = config.address;
      break;
  }
  if (config.successThreshold !== undefined) wire.success_threshold = config.successThreshold;
  if (config.startPeriodSeconds !== undefined) wire.start_period = `${config.startPeriodSeconds}s`;
  return wire;
}

function toRestartPolicyWire(policy: RestartPolicy): RestartPolicyWire {
  const wire: RestartPolicyWire = {
    enabled: policy.enabled,
    max_restarts: policy.maxRestarts,
    restart_window: `${policy.windowSeconds}s`,
  };
  if (policy.backoffMultiplier !== undefined) wire.backoff_multiplier = policy.backoffMultiplier;
  if (policy.maxBackoffSeconds !== undefined) wire.max_backoff = `${policy.maxBackoffSeconds}s`;
  if (policy.initialDelaySeconds !== undefined) wire.initial_delay = `${policy.initialDelaySeconds}s`;
  return wire;
}

export class HttpRuntime implements WorkspaceRuntime {
  constructor(private readonly client: DevSupervisorClient) {}

  async status(): Promise<RuntimeStatus> {
    const [proc, health, restart] = await Promise.all([
      this.client.getProcessStatus(),
      this.client.getHealthStatus(),
      this.client.getRestartStats(),
    ]);

    return {
      state: proc.state,
      pid: proc.pid,
      startedAt: safeDate(proc.start_time),
      exitCode: proc.exit_code,
      lastError: proc.error,
      health: {
        status: health.status,
        message: health.message,
        lastCheckedAt: safeDate(health.last_check),
        consecutiveFailures: health.consecutive_failures,
        consecutiveSuccesses: health.consecutive_successes,
      },
      restarts: {
        total: restart.total_restarts,
        recent: restart.recent_restarts,
        windowSeconds: parseDurationToSeconds(restart.restart_window),
        maxRestarts: restart.max_restarts,
      },
    };
  }

  async start(): Promise<void> {
    throw new WorkspaceNotImplementedError('runtime.start');
  }

  async stop(options?: StopOptions): Promise<void> {
    const ok = await this.client.stopProcess({
      signal: options?.signal ?? 'SIGTERM',
      timeout: options?.timeoutSeconds ?? 30,
    });
    if (!ok) {
      throw new Error('runtime.stop failed');
    }
  }

  async restart(options?: RestartOptions): Promise<void> {
    const result = await this.client.restartProcess({
      graceful: options?.graceful !== false,
    });
    if (!result.success) {
      throw new Error(`runtime.restart failed: ${result.error ?? 'unknown error'}`);
    }
  }

  async check(): Promise<RuntimeStatus['health']> {
    throw new WorkspaceNotImplementedError('runtime.check');
  }

  async configureHealth(update: HealthConfigUpdate): Promise<void> {
    const hc = update.healthCheck ? toHealthCheckWire(update.healthCheck) : undefined;
    const rp = update.restartPolicy ? toRestartPolicyWire(update.restartPolicy) : undefined;
    await this.client.configureHealthCheck(hc, rp);
  }
}

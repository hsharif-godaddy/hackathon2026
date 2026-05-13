import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DevSupervisorClient } from '../../../services/DevSupervisorClient.js';
import { HttpRuntime } from '../http-runtime.js';
import { WorkspaceNotImplementedError } from '../../errors.js';

function makeClient() {
  return {
    getProcessStatus: vi.fn(),
    getHealthStatus: vi.fn(),
    getRestartStats: vi.fn(),
    startProcess: vi.fn(),
    stopProcess: vi.fn(),
    restartProcess: vi.fn(),
    configureHealthCheck: vi.fn(),
  } as unknown as DevSupervisorClient;
}

describe('HttpRuntime', () => {
  let client: DevSupervisorClient;
  let runtime: HttpRuntime;

  beforeEach(() => {
    client = makeClient();
    runtime = new HttpRuntime(client);
  });

  it.each([
    ['300s', 300],
    ['5m', 300],
    ['5m0s', 300],
    ['1h30m', 5400],
    ['1h30m45s', 5445],
    ['90m', 5400],
    ['1.5s', 1.5],
    ['250ms', 0.25],
    ['42', 42],
    ['', 0],
    ['garbage', 0],
  ])('status() parses restart_window %s as %d seconds', async (wire, expected) => {
    (client.getProcessStatus as any).mockResolvedValue({
      pid: 1,
      command: '',
      state: 'running',
      start_time: '2026-05-08T10:00:00Z',
    });
    (client.getHealthStatus as any).mockResolvedValue({
      status: 'healthy',
      message: 'ok',
      last_check: '2026-05-08T10:00:00Z',
      duration: 0,
      consecutive_failures: 0,
      consecutive_successes: 0,
    });
    (client.getRestartStats as any).mockResolvedValue({
      total_restarts: 0,
      recent_restarts: 0,
      restart_window: wire,
      max_restarts: 0,
    });
    const result = await runtime.status();
    expect(result.restarts.windowSeconds).toBeCloseTo(expected, 6);
  });

  it('status() composes process, health, and restart-stats', async () => {
    (client.getProcessStatus as any).mockResolvedValue({
      pid: 42,
      command: 'pnpm run dev',
      state: 'running',
      start_time: '2026-05-08T10:00:00Z',
    });
    (client.getHealthStatus as any).mockResolvedValue({
      status: 'healthy',
      message: 'ok',
      last_check: '2026-05-08T10:01:00Z',
      duration: 12,
      consecutive_failures: 0,
      consecutive_successes: 3,
    });
    (client.getRestartStats as any).mockResolvedValue({
      total_restarts: 1,
      recent_restarts: 0,
      restart_window: '300s',
      max_restarts: 5,
    });

    const result = await runtime.status();

    expect(result.state).toBe('running');
    expect(result.pid).toBe(42);
    expect(result.health.status).toBe('healthy');
    expect(result.health.consecutiveSuccesses).toBe(3);
    expect(result.restarts.total).toBe(1);
    expect(result.restarts.windowSeconds).toBe(300);
    expect(result.restarts.maxRestarts).toBe(5);
  });

  it('status() leaves health.lastCheckedAt undefined when last_check is absent', async () => {
    (client.getProcessStatus as any).mockResolvedValue({
      pid: 1,
      command: '',
      state: 'starting',
      start_time: '2026-05-08T10:00:00Z',
    });
    (client.getHealthStatus as any).mockResolvedValue({
      status: 'starting',
      message: 'awaiting first probe',
      last_check: '',
      duration: 0,
      consecutive_failures: 0,
      consecutive_successes: 0,
    });
    (client.getRestartStats as any).mockResolvedValue({
      total_restarts: 0,
      recent_restarts: 0,
      restart_window: '300s',
      max_restarts: 5,
    });
    const result = await runtime.status();
    expect(result.health.status).toBe('starting');
    expect(result.health.lastCheckedAt).toBeUndefined();
  });

  it('start() throws WorkspaceNotImplementedError', async () => {
    await expect(runtime.start()).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
  });

  it('check() throws WorkspaceNotImplementedError', async () => {
    await expect(runtime.check()).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
  });

  it('restart() forwards graceful flag', async () => {
    (client.restartProcess as any).mockResolvedValue({ success: true });
    await runtime.restart({ graceful: false });
    expect(client.restartProcess).toHaveBeenCalledWith({ graceful: false });
  });

  it('restart() throws when underlying call reports failure', async () => {
    (client.restartProcess as any).mockResolvedValue({ success: false, error: 'boom' });
    await expect(runtime.restart()).rejects.toThrow(/boom/);
  });

  it('stop() forwards signal and timeout', async () => {
    (client.stopProcess as any).mockResolvedValue(true);
    await runtime.stop({ signal: 'SIGINT', timeoutSeconds: 10 });
    expect(client.stopProcess).toHaveBeenCalledWith({ signal: 'SIGINT', timeout: 10 });
  });

  it('stop() throws when stopProcess returns false', async () => {
    (client.stopProcess as any).mockResolvedValue(false);
    await expect(runtime.stop()).rejects.toThrow(/runtime\.stop/);
  });

  it('configureHealth() forwards both pieces', async () => {
    (client.configureHealthCheck as any).mockResolvedValue(undefined);
    const healthCheck = {
      type: 'http' as const,
      url: 'http://localhost/health',
      intervalSeconds: 10,
      timeoutSeconds: 2,
      failureThreshold: 3,
    };
    const restartPolicy = {
      enabled: true,
      maxRestarts: 5,
      windowSeconds: 300,
    };
    await runtime.configureHealth({ healthCheck, restartPolicy });
    expect(client.configureHealthCheck).toHaveBeenCalledTimes(1);
  });

  it('configureHealth() emits a command-type wire payload', async () => {
    (client.configureHealthCheck as any).mockResolvedValue(undefined);
    await runtime.configureHealth({
      healthCheck: {
        type: 'command',
        command: 'curl -fsS http://localhost/healthz',
        intervalSeconds: 5,
        timeoutSeconds: 1,
        failureThreshold: 2,
      },
    });
    const [hc, rp] = (client.configureHealthCheck as any).mock.calls[0];
    expect(hc).toMatchObject({
      type: 'command',
      command: 'curl -fsS http://localhost/healthz',
      interval: '5s',
      timeout: '1s',
      failure_threshold: 2,
    });
    expect(rp).toBeUndefined();
  });

  it('configureHealth() emits a tcp-type wire payload with optional fields', async () => {
    (client.configureHealthCheck as any).mockResolvedValue(undefined);
    await runtime.configureHealth({
      healthCheck: {
        type: 'tcp',
        address: '127.0.0.1:5432',
        intervalSeconds: 10,
        timeoutSeconds: 2,
        failureThreshold: 3,
        successThreshold: 1,
        startPeriodSeconds: 30,
      },
    });
    const [hc] = (client.configureHealthCheck as any).mock.calls[0];
    expect(hc).toMatchObject({
      type: 'tcp',
      address: '127.0.0.1:5432',
      success_threshold: 1,
      start_period: '30s',
    });
  });

  it('configureHealth() forwards a restartPolicy-only payload', async () => {
    (client.configureHealthCheck as any).mockResolvedValue(undefined);
    await runtime.configureHealth({
      restartPolicy: {
        enabled: true,
        maxRestarts: 3,
        windowSeconds: 600,
        backoffMultiplier: 2,
        maxBackoffSeconds: 60,
        initialDelaySeconds: 1,
      },
    });
    const [hc, rp] = (client.configureHealthCheck as any).mock.calls[0];
    expect(hc).toBeUndefined();
    expect(rp).toMatchObject({
      enabled: true,
      max_restarts: 3,
      restart_window: '600s',
      backoff_multiplier: 2,
      max_backoff: '60s',
      initial_delay: '1s',
    });
  });

  it('status() drops the Go zero-value timestamp on health.lastCheckedAt', async () => {
    (client.getProcessStatus as any).mockResolvedValue({
      pid: 1,
      command: '',
      state: 'running',
      start_time: '2026-05-08T10:00:00Z',
    });
    (client.getHealthStatus as any).mockResolvedValue({
      status: 'disabled',
      message: 'no probe configured',
      last_check: '0001-01-01T00:00:00Z',
      duration: 0,
      consecutive_failures: 0,
      consecutive_successes: 0,
    });
    (client.getRestartStats as any).mockResolvedValue({
      total_restarts: 0,
      recent_restarts: 0,
      restart_window: '0s',
      max_restarts: 0,
    });
    const result = await runtime.status();
    expect(result.health.lastCheckedAt).toBeUndefined();
  });
});

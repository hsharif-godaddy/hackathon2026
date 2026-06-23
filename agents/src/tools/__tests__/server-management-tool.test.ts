/**
 * ServerManagementTool Unit Tests
 *
 * Tests for server restart and status checking functionality.
 * Focus: AIROBUILD-178 - Prevent ERR_SERVER_ALREADY_LISTEN errors during restarts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServerManagementTool, HEALTH_POLL_INTERVAL_MS, HEALTH_POLL_MAX_ATTEMPTS } from '../server-management-tool.js';
import { createForWorkspace } from '../../workspace/index.js';
import { AppRepository } from '../../database/index.js';

// The tool now drives the workspace runtime API; mock the factory that binds it.
vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

// When createForWorkspace returns null, checkServerStatus consults the app
// record to tell "app absent" (not_found) from "app exists, no bindable
// supervisor" (benign stopped) — mock the repository it uses. `vi.hoisted`
// keeps the spy reachable inside the hoisted mock factory.
const { mockFindById } = vi.hoisted(() => ({ mockFindById: vi.fn() }));
vi.mock('../../database/index.js', () => ({
  // `function` (not arrow) so the tool's `new AppRepository()` can construct it.
  AppRepository: vi.fn(function () {
    return { findById: mockFindById };
  }),
}));

// A complete RuntimeStatus snapshot — the real adapter always populates
// `health` and `restarts`, so stubs must too (checkServerStatus reads them).
const runtimeStatus = (over: Record<string, unknown> = {}) => ({
  state: 'running',
  pid: 12345,
  health: { status: 'healthy', message: 'ok', consecutiveFailures: 0, consecutiveSuccesses: 1 },
  restarts: { total: 0, recent: 0, windowSeconds: 60, maxRestarts: 5 },
  ...over,
});

describe('ServerManagementTool Unit Tests', () => {
  let serverTool: ServerManagementTool;
  let mockRuntime: { restart: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock the workspace runtime surface the tool uses.
    mockRuntime = {
      restart: vi.fn(),
      status: vi.fn(),
    };

    vi.mocked(createForWorkspace).mockReturnValue({ runtime: mockRuntime } as any);

    // Default: the app record exists (only the null-bind tests vary this).
    mockFindById.mockReturnValue({ id: 'test-app' });

    serverTool = new ServerManagementTool();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('AIROBUILD-178: Process state mapping during restarts', () => {
    it('should map "starting" state to "running" to prevent restart interference', async () => {
      // Simulate process in 'starting' state during restart
      mockRuntime.status.mockResolvedValue(runtimeStatus({ state: 'starting' }));

      const result = await serverTool.checkServerStatus('test-app');

      // CRITICAL: Must return 'running', NOT 'stopped'
      // If we return 'stopped', the agent thinks the server crashed and tries to start it again,
      // causing ERR_SERVER_ALREADY_LISTEN (same Node.js process gets two start commands)
      expect(result.success).toBe(true);
      expect(result.status).toBe('running');
      expect(result.message).toContain('starting');
    });

    it('should map "stopping" state to "running" to prevent restart interference', async () => {
      // Simulate process in 'stopping' state during shutdown
      mockRuntime.status.mockResolvedValue(runtimeStatus({ state: 'stopping' }));

      const result = await serverTool.checkServerStatus('test-app');

      // CRITICAL: Must return 'running', NOT 'stopped'
      // If we return 'stopped' while the process is still shutting down,
      // the agent might try to start a new process before the old one releases the port
      expect(result.success).toBe(true);
      expect(result.status).toBe('running');
      expect(result.message).toContain('stopping');
    });

    it('should map "running" state to "running"', async () => {
      mockRuntime.status.mockResolvedValue(runtimeStatus({ state: 'running' }));

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.status).toBe('running');
    });

    it('should map "stopped" state to "stopped"', async () => {
      mockRuntime.status.mockResolvedValue(runtimeStatus({ state: 'stopped', pid: 0 }));

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.status).toBe('stopped');
    });

    it('should map "error" state to "error"', async () => {
      mockRuntime.status.mockResolvedValue(runtimeStatus({ state: 'error', pid: 0, lastError: 'Failed to start' }));

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.status).toBe('error');
    });
  });

  describe('checkServerStatus', () => {
    it('should return success when dev-supervisor is available and process is running', async () => {
      mockRuntime.status.mockResolvedValue(runtimeStatus({ state: 'running' }));

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.appId).toBe('test-app');
      expect(result.status).toBe('running');
      expect(result.message).toContain('Process state: running');
      expect(result.message).toContain('PID: 12345');
    });

    it('should return not_found when the app record is absent', async () => {
      vi.mocked(createForWorkspace).mockReturnValue(null);
      mockFindById.mockReturnValue(null);

      const result = await serverTool.checkServerStatus('nonexistent-app');

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
      expect(result.error).toContain('App with ID nonexistent-app not found');
    });

    it('should return stopped when the app exists but has no bindable supervisor', async () => {
      // Regression guard: a cold-start preview (app record present, no socket
      // registered yet) must surface as a benign STOPPED, not a thrown not_found.
      vi.mocked(createForWorkspace).mockReturnValue(null);
      mockFindById.mockReturnValue({ id: 'cold-app' });

      const result = await serverTool.checkServerStatus('cold-app');

      expect(result.success).toBe(true);
      expect(result.status).toBe('stopped');
      expect(result.message).toBe('Dev supervisor not available for this app');
    });

    it('should handle dev-supervisor communication errors', async () => {
      mockRuntime.status.mockRejectedValue(new Error('Connection refused'));

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.status).toBe('error');
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('restartServer', () => {
    it('should successfully restart the server when process reaches running state', async () => {
      mockRuntime.restart.mockResolvedValue(undefined);
      mockRuntime.status.mockResolvedValue({ state: 'running', pid: 12345 });

      // First poll is immediate (no sleep), so no timer advance needed
      const result = await serverTool.restartServer({ reason: 'API changes' }, 'test-app');

      expect(result.success).toBe(true);
      expect(result.appId).toBe('test-app');
      expect(result.message).toContain('Server restarted successfully');
      expect(mockRuntime.restart).toHaveBeenCalledWith({ graceful: true });
      expect(mockRuntime.status).toHaveBeenCalled();
    });

    it('should handle restart failures with detailed error', async () => {
      // runtime.restart rejects on failure (vs. the old success:false result shape).
      mockRuntime.restart.mockRejectedValue(
        new Error('HTTP 400: restart_failed: port 3000 still in use'),
      );

      const result = await serverTool.restartServer({ reason: 'Testing' }, 'test-app');

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 400: restart_failed: port 3000 still in use');
    });

    it('should return not_found when the workspace cannot be bound', async () => {
      vi.mocked(createForWorkspace).mockReturnValue(null);

      const result = await serverTool.restartServer({ reason: 'Testing' }, 'nonexistent-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('App with ID nonexistent-app not found');
    });

    it('should handle dev-supervisor communication errors during restart', async () => {
      mockRuntime.restart.mockRejectedValue(new Error('Socket connection failed'));

      const result = await serverTool.restartServer({ reason: 'Testing' }, 'test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Socket connection failed');
    });

    it('should wait for process to reach running state after polling through starting state', async () => {
      mockRuntime.restart.mockResolvedValue(undefined);
      // First poll (immediate): starting, second poll (after sleep): running
      mockRuntime.status
        .mockResolvedValueOnce({ state: 'starting', pid: 0 })
        .mockResolvedValueOnce({ state: 'running', pid: 99999 });

      const promise = serverTool.restartServer({ reason: 'Testing' }, 'test-app');
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS); // second poll after sleep
      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockRuntime.status).toHaveBeenCalledTimes(2);
    });

    it('should return failure if process enters error state after restart', async () => {
      mockRuntime.restart.mockResolvedValue(undefined);
      mockRuntime.status.mockResolvedValue({
        state: 'error',
        pid: 0,
        lastError: 'EADDRINUSE: port 3000 already in use',
      });

      // First poll is immediate - returns error state right away
      const result = await serverTool.restartServer({ reason: 'Testing' }, 'test-app');

      expect(result.success).toBe(false);
      expect(result.error).toBe('EADDRINUSE: port 3000 already in use');
      expect(result.message).toContain('failed to become healthy');
    });

    it('should return failure if health verification times out', async () => {
      mockRuntime.restart.mockResolvedValue(undefined);
      // Always return 'starting' - never reaches 'running'
      mockRuntime.status.mockResolvedValue({ state: 'starting', pid: 0 });

      const promise = serverTool.restartServer({ reason: 'Testing' }, 'test-app');
      // First poll is immediate, remaining (HEALTH_POLL_MAX_ATTEMPTS - 1) polls need timer advances
      for (let i = 1; i < HEALTH_POLL_MAX_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS);
      }
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout waiting for process to reach running state');
    });

    it('should tolerate transient poll errors and continue polling', async () => {
      mockRuntime.restart.mockResolvedValue(undefined);
      // First poll (immediate): transient error, second poll (after sleep): running
      mockRuntime.status
        .mockRejectedValueOnce(new Error('Temporary connection error'))
        .mockResolvedValueOnce({ state: 'running', pid: 12345 });

      const promise = serverTool.restartServer({ reason: 'Testing' }, 'test-app');
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS); // second poll after sleep
      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockRuntime.status).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * ServerManagementTool Unit Tests
 *
 * Tests for server restart and status checking functionality.
 * Focus: AIROBUILD-178 - Prevent ERR_SERVER_ALREADY_LISTEN errors during restarts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServerManagementTool } from '../server-management-tool.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import type { DevSupervisorClient } from '../../services/DevSupervisorClient.js';

// Mock the dependencies
vi.mock('../../utils/dev-supervisor-client-factory.js');

describe('ServerManagementTool Unit Tests', () => {
  let serverTool: ServerManagementTool;
  let mockDevSupervisor: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock DevSupervisorClient
    mockDevSupervisor = {
      getProcessStatus: vi.fn(),
      restartProcess: vi.fn(),
    };

    vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor as unknown as DevSupervisorClient);
    vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
      socketPath: '/tmp/test-app/dev-supervisor.sock',
      port: 3000,
      path: '/tmp/apps/test-app'
    });

    serverTool = new ServerManagementTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AIROBUILD-178: Process state mapping during restarts', () => {
    it('should map "starting" state to "running" to prevent restart interference', async () => {
      // Simulate process in 'starting' state during restart
      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        pid: 12345,
        command: 'npm start',
        state: 'starting',
        start_time: new Date().toISOString(),
      });

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
      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        pid: 12345,
        command: 'npm start',
        state: 'stopping',
        start_time: new Date().toISOString(),
      });

      const result = await serverTool.checkServerStatus('test-app');

      // CRITICAL: Must return 'running', NOT 'stopped'
      // If we return 'stopped' while the process is still shutting down,
      // the agent might try to start a new process before the old one releases the port
      expect(result.success).toBe(true);
      expect(result.status).toBe('running');
      expect(result.message).toContain('stopping');
    });

    it('should map "running" state to "running"', async () => {
      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        pid: 12345,
        command: 'npm start',
        state: 'running',
        start_time: new Date().toISOString(),
      });

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.status).toBe('running');
    });

    it('should map "stopped" state to "stopped"', async () => {
      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        pid: 0,
        command: '',
        state: 'stopped',
        start_time: '',
      });

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.status).toBe('stopped');
    });

    it('should map "error" state to "error"', async () => {
      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        pid: 0,
        command: 'npm start',
        state: 'error',
        start_time: new Date().toISOString(),
        error: 'Failed to start',
      });

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.status).toBe('error');
    });
  });

  describe('checkServerStatus', () => {
    it('should return success when dev-supervisor is available and process is running', async () => {
      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        pid: 12345,
        command: 'npm start',
        state: 'running',
        start_time: new Date().toISOString(),
      });

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.appId).toBe('test-app');
      expect(result.status).toBe('running');
      expect(result.message).toContain('Process state: running');
      expect(result.message).toContain('PID: 12345');
    });

    it('should return not_found when app info is not available', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue(null);

      const result = await serverTool.checkServerStatus('nonexistent-app');

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
      expect(result.error).toContain('App with ID nonexistent-app not found');
    });

    it('should handle dev-supervisor communication errors', async () => {
      mockDevSupervisor.getProcessStatus.mockRejectedValue(new Error('Connection refused'));

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.status).toBe('error');
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('restartServer', () => {
    it('should successfully restart the server', async () => {
      mockDevSupervisor.restartProcess.mockResolvedValue(true);

      const result = await serverTool.restartServer({ reason: 'API changes' }, 'test-app');

      expect(result.success).toBe(true);
      expect(result.appId).toBe('test-app');
      expect(result.message).toContain('Server restarted successfully');
      expect(mockDevSupervisor.restartProcess).toHaveBeenCalledWith({ graceful: true });
    });

    it('should handle restart failures', async () => {
      mockDevSupervisor.restartProcess.mockResolvedValue(false);

      const result = await serverTool.restartServer({ reason: 'Testing' }, 'test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server restart operation failed');
    });

    it('should return not_found when app info is not available', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue(null);

      const result = await serverTool.restartServer({ reason: 'Testing' }, 'nonexistent-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('App with ID nonexistent-app not found');
    });

    it('should handle dev-supervisor communication errors during restart', async () => {
      mockDevSupervisor.restartProcess.mockRejectedValue(new Error('Socket connection failed'));

      const result = await serverTool.restartServer({ reason: 'Testing' }, 'test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Socket connection failed');
    });
  });
});

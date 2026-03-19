/**
 * Server Status Unit Tests
 *
 * These tests focus on the server status logic without requiring a full dev environment.
 * They help identify specific issues with the server status implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServerManagementTool } from '../server-management-tool.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';

// Mock the dependencies
vi.mock('../../utils/dev-supervisor-client-factory.js');

describe('Server Status Unit Tests', () => {
  let serverTool: ServerManagementTool;
  let mockDevSupervisor: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock DevSupervisorClient instance
    mockDevSupervisor = {
      getProcessStatus: vi.fn(),
      restartProcess: vi.fn()
    };

    serverTool = new ServerManagementTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkServerStatus', () => {
    it('should return not_found when app does not exist', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue(null);

      const result = await serverTool.checkServerStatus('nonexistent-app');

      expect(result).toEqual({
        success: false,
        appId: 'nonexistent-app',
        status: 'not_found',
        error: 'App with ID nonexistent-app not found'
      });

      expect(DevSupervisorClientFactory.getAppInfo).toHaveBeenCalledWith('nonexistent-app');
    });

    it('should return stopped when dev supervisor is not available', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '/tmp/test.sock',
        port: 3000,
        path: '/tmp/test-app'
      });
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(null);

      const result = await serverTool.checkServerStatus('test-app');

      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'stopped',
        message: 'Dev supervisor not available for this app'
      });
    });

    it('should return running when dev process is running', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '/tmp/test.sock',
        port: 3000,
        path: '/tmp/test-app'
      });
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor);

      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        state: 'running',
        pid: 1234
      });

      const result = await serverTool.checkServerStatus('test-app');

      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'running',
        message: 'Process state: running (PID: 1234)'
      });
    });

    it('should return stopped when process is stopped', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '/tmp/test.sock',
        port: 3000,
        path: '/tmp/test-app'
      });
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor);

      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        state: 'stopped'
      });

      const result = await serverTool.checkServerStatus('test-app');

      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'stopped',
        message: 'Process state: stopped'
      });
    });

    it('should return error when dev supervisor communication fails', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '/tmp/test.sock',
        port: 3000,
        path: '/tmp/test-app'
      });
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor);

      mockDevSupervisor.getProcessStatus.mockRejectedValue(new Error('Connection refused'));

      const result = await serverTool.checkServerStatus('test-app');

      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'error',
        message: 'Cannot communicate with dev supervisor',
        error: 'Connection refused'
      });
    });

    it('should return error status when process is in error state', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '/tmp/test.sock',
        port: 3000,
        path: '/tmp/test-app'
      });
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor);

      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        state: 'error'
      });

      const result = await serverTool.checkServerStatus('test-app');

      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'error',
        message: 'Process state: error'
      });
    });

    it('should treat starting state as running', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '/tmp/test.sock',
        port: 3000,
        path: '/tmp/test-app'
      });
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor);

      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        state: 'starting',
        pid: 5678
      });

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.status).toBe('running');
      expect(result.message).toContain('starting');
    });

    it('should treat stopping state as running', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '/tmp/test.sock',
        port: 3000,
        path: '/tmp/test-app'
      });
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor);

      mockDevSupervisor.getProcessStatus.mockResolvedValue({
        state: 'stopping',
        pid: 9012
      });

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.status).toBe('running');
      expect(result.message).toContain('stopping');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined app properties gracefully', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '',
        port: 0,
        path: ''
      });
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(null);

      const result = await serverTool.checkServerStatus('test-app');

      expect(result.success).toBe(true);
      expect(result.appId).toBe('test-app');
      expect(result.status).toBe('stopped');
    });

    it('should handle very long app IDs', async () => {
      const longAppId = 'a'.repeat(1000);
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue(null);

      const result = await serverTool.checkServerStatus(longAppId);

      expect(result.success).toBe(false);
      expect(result.appId).toBe(longAppId);
      expect(result.status).toBe('not_found');
    });
  });
});

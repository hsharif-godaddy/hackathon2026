/**
 * Server Status Unit Tests
 * 
 * These tests focus on the server status logic without requiring a full dev environment.
 * They help identify specific issues with the server status implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServerManagementTool } from '../server-management-tool.js';
import { AppRepository } from '../../database/index.js';
import { DevSupervisorClient } from '../../services/DevSupervisorClient.js';
import { existsSync } from 'fs';

// Mock the dependencies
vi.mock('../../database/index.js');
vi.mock('../../services/DevSupervisorClient.js');
vi.mock('fs', () => ({
  existsSync: vi.fn()
}));

describe('Server Status Unit Tests', () => {
  let serverTool: ServerManagementTool;
  let mockAppRepo: any;
  let mockDevSupervisor: any;
  let mockExistsSync: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Mock AppRepository
    mockAppRepo = {
      findById: vi.fn()
    };
    vi.mocked(AppRepository).mockImplementation(() => mockAppRepo);
    
    // Mock DevSupervisorClient
    mockDevSupervisor = {
      exec: vi.fn()
    };
    vi.mocked(DevSupervisorClient).mockImplementation(() => mockDevSupervisor);
    
    // Mock fs.existsSync
    mockExistsSync = vi.mocked(existsSync);
    
    serverTool = new ServerManagementTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkServerStatus', () => {
    it('should return not_found when app does not exist', async () => {
      mockAppRepo.findById.mockReturnValue(null);
      
      const result = await serverTool.checkServerStatus('nonexistent-app');
      
      expect(result).toEqual({
        success: false,
        appId: 'nonexistent-app',
        status: 'not_found',
        error: 'App with ID nonexistent-app not found'
      });
      
      expect(mockAppRepo.findById).toHaveBeenCalledWith('nonexistent-app');
    });

    it('should return stopped when app has no socket path', async () => {
      const mockApp = {
        id: 'test-app',
        name: 'Test App',
        path: '/tmp/test-app',
        // No socketPath
      };
      
      mockAppRepo.findById.mockReturnValue(mockApp);
      
      const result = await serverTool.checkServerStatus('test-app');
      
      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'stopped',
        message: 'Dev supervisor not available for this app'
      });
    });

    it('should return stopped when socket path does not exist', async () => {
      const mockApp = {
        id: 'test-app',
        name: 'Test App',
        path: '/tmp/test-app',
        socketPath: '/tmp/test.sock'
      };
      
      mockAppRepo.findById.mockReturnValue(mockApp);
      mockExistsSync.mockReturnValue(false);
      
      const result = await serverTool.checkServerStatus('test-app');
      
      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'stopped',
        message: 'Dev supervisor not available for this app'
      });
      
      expect(mockExistsSync).toHaveBeenCalledWith('/tmp/test.sock');
    });

    it('should return running when dev process is detected', async () => {
      const mockApp = {
        id: 'test-app',
        name: 'Test App',
        path: '/tmp/test-app',
        socketPath: '/tmp/test.sock'
      };
      
      mockAppRepo.findById.mockReturnValue(mockApp);
      mockExistsSync.mockReturnValue(true);
      
      // Mock successful exec that finds a dev process
      mockDevSupervisor.exec.mockResolvedValue({
        exit_code: 0,
        stdout: 'user 1234 npm run dev\nuser 5678 next dev',
        stderr: '',
        execution_time: 100,
        success: true,
        command: 'ps aux | grep -E "(npm run dev|next dev|vite)" | grep -v grep || echo "NO_DEV_PROCESS"'
      });
      
      const result = await serverTool.checkServerStatus('test-app');
      
      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'running',
        message: 'Dev server process detected'
      });
      
      expect(mockDevSupervisor.exec).toHaveBeenCalledWith({
        command: 'ps aux | grep -E "(npm run dev|next dev|vite)" | grep -v grep || echo "NO_DEV_PROCESS"',
        working_dir: '/tmp/test-app',
        timeout: 5,
        capture_output: true
      });
    });

    it('should return stopped when no dev process is found', async () => {
      const mockApp = {
        id: 'test-app',
        name: 'Test App',
        path: '/tmp/test-app',
        socketPath: '/tmp/test.sock'
      };
      
      mockAppRepo.findById.mockReturnValue(mockApp);
      mockExistsSync.mockReturnValue(true);
      
      // Mock exec that finds no dev process
      mockDevSupervisor.exec.mockResolvedValue({
        exit_code: 0,
        stdout: 'NO_DEV_PROCESS',
        stderr: '',
        execution_time: 100,
        success: true,
        command: 'ps aux | grep -E "(npm run dev|next dev|vite)" | grep -v grep || echo "NO_DEV_PROCESS"'
      });
      
      const result = await serverTool.checkServerStatus('test-app');
      
      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'stopped',
        message: 'No dev server process found'
      });
    });

    it('should return error when dev supervisor communication fails', async () => {
      const mockApp = {
        id: 'test-app',
        name: 'Test App',
        path: '/tmp/test-app',
        socketPath: '/tmp/test.sock'
      };
      
      mockAppRepo.findById.mockReturnValue(mockApp);
      mockExistsSync.mockReturnValue(true);
      
      // Mock exec that throws an error
      const mockError = new Error('Connection refused');
      mockDevSupervisor.exec.mockRejectedValue(mockError);
      
      const result = await serverTool.checkServerStatus('test-app');
      
      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'error',
        message: 'Cannot communicate with dev supervisor',
        error: 'Connection refused'
      });
    });

    it('should handle non-zero exit codes from process check', async () => {
      const mockApp = {
        id: 'test-app',
        name: 'Test App',
        path: '/tmp/test-app',
        socketPath: '/tmp/test.sock'
      };
      
      mockAppRepo.findById.mockReturnValue(mockApp);
      mockExistsSync.mockReturnValue(true);
      
      // Mock exec with non-zero exit code
      mockDevSupervisor.exec.mockResolvedValue({
        exit_code: 1,
        stdout: '',
        stderr: 'Command failed',
        execution_time: 100,
        success: false,
        command: 'ps aux | grep -E "(npm run dev|next dev|vite)" | grep -v grep || echo "NO_DEV_PROCESS"'
      });
      
      const result = await serverTool.checkServerStatus('test-app');
      
      expect(result).toEqual({
        success: true,
        appId: 'test-app',
        status: 'stopped',
        message: 'No dev server process found'
      });
    });

    it('should detect various dev server commands', async () => {
      const mockApp = {
        id: 'test-app',
        name: 'Test App',
        path: '/tmp/test-app',
        socketPath: '/tmp/test.sock'
      };
      
      mockAppRepo.findById.mockReturnValue(mockApp);
      mockExistsSync.mockReturnValue(true);
      
      // Test different dev server outputs
      const testCases = [
        'user 1234 npm run dev',
        'user 5678 next dev',
        'user 9012 vite --host',
        'user 3456 node_modules/.bin/next dev'
      ];
      
      for (const stdout of testCases) {
        mockDevSupervisor.exec.mockResolvedValue({
          exit_code: 0,
          stdout,
          stderr: '',
          execution_time: 100,
          success: true,
          command: 'ps aux | grep -E "(npm run dev|next dev|vite)" | grep -v grep || echo "NO_DEV_PROCESS"'
        });
        
        const result = await serverTool.checkServerStatus('test-app');
        
        expect(result.status).toBe('running');
        expect(result.message).toBe('Dev server process detected');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined app properties gracefully', async () => {
      const mockApp = {
        id: 'test-app',
        // Missing other properties
      };
      
      mockAppRepo.findById.mockReturnValue(mockApp);
      
      const result = await serverTool.checkServerStatus('test-app');
      
      expect(result.success).toBe(true);
      expect(result.appId).toBe('test-app');
      expect(result.status).toBe('stopped');
    });

    it('should handle empty stdout from process check', async () => {
      const mockApp = {
        id: 'test-app',
        name: 'Test App',
        path: '/tmp/test-app',
        socketPath: '/tmp/test.sock'
      };
      
      mockAppRepo.findById.mockReturnValue(mockApp);
      mockExistsSync.mockReturnValue(true);
      
      mockDevSupervisor.exec.mockResolvedValue({
        exit_code: 0,
        stdout: '',
        stderr: '',
        execution_time: 100,
        success: true,
        command: 'ps aux | grep -E "(npm run dev|next dev|vite)" | grep -v grep || echo "NO_DEV_PROCESS"'
      });
      
      const result = await serverTool.checkServerStatus('test-app');
      
      expect(result.status).toBe('stopped');
    });

    it('should handle very long app IDs', async () => {
      const longAppId = 'a'.repeat(1000);
      mockAppRepo.findById.mockReturnValue(null);
      
      const result = await serverTool.checkServerStatus(longAppId);
      
      expect(result.success).toBe(false);
      expect(result.appId).toBe(longAppId);
      expect(result.status).toBe('not_found');
    });
  });
});

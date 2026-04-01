/**
 * ViewLogsTool Unit Tests
 *
 * These tests focus on the ViewLogsTool logic without requiring a full dev environment.
 * They help identify specific issues with the high-level log tool implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ViewLogsTool } from '../view-logs-tool.js';
import { DevSupervisorLogClient } from '../dev-supervisor-log-client.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';

// Mock the dependencies
vi.mock('../dev-supervisor-log-client.js');
vi.mock('../../utils/dev-supervisor-client-factory.js');
vi.mock('../../database/repositories/AppRepository.js');

describe('ViewLogsTool Unit Tests', () => {
  let viewLogsTool: ViewLogsTool;
  let mockLogClient: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock DevSupervisorLogClient
    mockLogClient = {
      isAvailable: vi.fn(),
      readLogs: vi.fn(),
      getLogSummary: vi.fn(),
      formatLogSummary: vi.fn()
    };
    vi.mocked(DevSupervisorLogClient).mockImplementation(() => mockLogClient);

    // Mock DevSupervisorClientFactory.getAppInfo to return app info with socketPath
    vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
      socketPath: '/tmp/dev-supervisor-test-app/dev-supervisor.sock',
      port: 0,
      path: '/tmp/test-app'
    });

    viewLogsTool = new ViewLogsTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should create tool successfully', () => {
      expect(viewLogsTool).toBeDefined();
    });

    it('should initialize with app context', async () => {
      mockLogClient.isAvailable.mockReturnValue(true);
      mockLogClient.readLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0,
        formatted: 'No logs'
      });

      const result = await viewLogsTool.readLogs('test-app');

      expect(DevSupervisorClientFactory.getAppInfo).toHaveBeenCalledWith('test-app');
      expect(DevSupervisorLogClient).toHaveBeenCalledWith('/tmp/dev-supervisor-test-app/dev-supervisor.sock');
      expect(mockLogClient.isAvailable).toHaveBeenCalled();
    });

    it('should handle missing socket path', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue(null);

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Preview supervisor not available');
      expect(result.output).toContain('Preview logs not available');
    });
  });

  describe('Basic Log Reading', () => {
    beforeEach(() => {
      mockLogClient.isAvailable.mockReturnValue(true);
    });

    it('should read logs successfully', async () => {
      const mockLogs = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          source: 'stdout',
          message: 'Test log message',
          level: 'info'
        }
      ];

      mockLogClient.readLogs.mockResolvedValue({
        success: true,
        logs: mockLogs,
        totalEntries: 1,
        formatted: '📋 Test formatted logs'
      });

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(true);
      expect(result.output).toBe('📋 Test formatted logs');
      expect(result.totalLogs).toBe(1);
      expect(mockLogClient.readLogs).toHaveBeenCalledWith({
        lines: 50,
        format: true
      });
    });

    it('should handle log reading failure', async () => {
      mockLogClient.readLogs.mockResolvedValue({
        success: false,
        error: 'Connection failed',
        logs: [],
        totalEntries: 0
      });

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection failed');
      expect(result.output).toContain('Failed to read logs');
    });

    it('should handle unavailable dev supervisor', async () => {
      mockLogClient.isAvailable.mockReturnValue(false);

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Preview supervisor not available');
      expect(result.output).toContain('Preview logs not available');
    });
  });

  describe('Options Handling', () => {
    beforeEach(() => {
      mockLogClient.isAvailable.mockReturnValue(true);
      mockLogClient.readLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0,
        formatted: 'No logs'
      });
    });

    it('should pass line limit correctly', async () => {
      await viewLogsTool.readLogs('test-app', { lines: 100 });

      expect(mockLogClient.readLogs).toHaveBeenCalledWith({
        lines: 100,
        format: true
      });
    });

    it('should enforce maximum line limit', async () => {
      await viewLogsTool.readLogs('test-app', { lines: 2000 });

      expect(mockLogClient.readLogs).toHaveBeenCalledWith({
        lines: 1000, // Should be capped at 1000
        format: true
      });
    });

    it('should pass source filter correctly', async () => {
      await viewLogsTool.readLogs('test-app', { source: 'stderr' });

      expect(mockLogClient.readLogs).toHaveBeenCalledWith({
        lines: 50,
        source: 'stderr',
        format: true
      });
    });

    it('should pass since timestamp correctly', async () => {
      const timestamp = '2024-01-01T10:00:00Z';
      await viewLogsTool.readLogs('test-app', { since: timestamp });

      expect(mockLogClient.readLogs).toHaveBeenCalledWith({
        lines: 50,
        since: timestamp,
        format: true
      });
    });
  });

  describe('Log Summary', () => {
    beforeEach(() => {
      mockLogClient.isAvailable.mockReturnValue(true);
    });

    it('should get log summary successfully', async () => {
      const mockSummary = {
        totalLogs: 100,
        sources: { stdout: 60, stderr: 40 },
        levels: { info: 50, error: 30, warn: 20 }
      };

      mockLogClient.getLogSummary.mockResolvedValue({
        success: true,
        summary: mockSummary
      });

      mockLogClient.formatLogSummary.mockReturnValue('📊 Formatted summary');

      const result = await viewLogsTool.readLogs('test-app', { summary: true });

      expect(result.success).toBe(true);
      expect(result.output).toBe('📊 Formatted summary');
      expect(mockLogClient.getLogSummary).toHaveBeenCalled();
      expect(mockLogClient.formatLogSummary).toHaveBeenCalledWith(mockSummary);
    });

    it('should handle summary failure', async () => {
      mockLogClient.getLogSummary.mockResolvedValue({
        success: false,
        error: 'Summary failed'
      });

      const result = await viewLogsTool.readLogs('test-app', { summary: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Summary failed');
      expect(result.output).toContain('Failed to get log summary');
    });

    it('should handle empty summary', async () => {
      mockLogClient.getLogSummary.mockResolvedValue({
        success: true,
        summary: null
      });

      const result = await viewLogsTool.readLogs('test-app', { summary: true });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No logs found');
    });
  });

  describe('Error Handling', () => {
    it('should handle initialization errors', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockImplementation(() => {
        throw new Error('Initialization failed');
      });

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Preview supervisor not available');
    });

    it('should handle log client exceptions', async () => {
      mockLogClient.isAvailable.mockReturnValue(true);
      mockLogClient.readLogs.mockRejectedValue(new Error('Network error'));

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.output).toContain('Unexpected error reading logs');
    });

    it('should handle non-Error exceptions', async () => {
      mockLogClient.isAvailable.mockReturnValue(true);
      mockLogClient.readLogs.mockRejectedValue('String error');

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      mockLogClient.isAvailable.mockReturnValue(true);
      mockLogClient.readLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0,
        formatted: 'No logs'
      });
    });

    it('should handle missing app ID', async () => {
      const result = await viewLogsTool.readLogs('');

      // Empty app ID still tries to initialize, so it succeeds if mocked properly
      expect(result.success).toBe(true);
    });

    it('should handle null/undefined options', async () => {
      const result = await viewLogsTool.readLogs('test-app', undefined);

      expect(result.success).toBe(true);
      expect(mockLogClient.readLogs).toHaveBeenCalledWith({
        lines: 50,
        format: true
      });
    });

    it('should handle zero line limit', async () => {
      await viewLogsTool.readLogs('test-app', { lines: 0 });

      expect(mockLogClient.readLogs).toHaveBeenCalledWith({
        lines: 50, // 0 is falsy, so defaults to 50
        format: true
      });
    });

    it('should handle negative line limit', async () => {
      await viewLogsTool.readLogs('test-app', { lines: -10 });

      expect(mockLogClient.readLogs).toHaveBeenCalledWith({
        lines: -10, // ViewLogsTool passes through the value
        format: true
      });
    });
  });

  describe('Environment Integration', () => {
    it('should use socket path from factory', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '/tmp/dev-supervisor-test-app/dev-supervisor.sock',
        port: 0,
        path: '/tmp/test-app'
      });
      mockLogClient.isAvailable.mockReturnValue(true);
      mockLogClient.readLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0,
        formatted: 'No logs'
      });

      await viewLogsTool.readLogs('test-app');

      expect(DevSupervisorLogClient).toHaveBeenCalledWith('/tmp/dev-supervisor-test-app/dev-supervisor.sock');
    });

    it('should use custom socket path from factory', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '/custom/path/socket.sock',
        port: 0,
        path: '/tmp/test-app'
      });
      mockLogClient.isAvailable.mockReturnValue(true);
      mockLogClient.readLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0,
        formatted: 'No logs'
      });

      await viewLogsTool.readLogs('test-app');

      expect(DevSupervisorLogClient).toHaveBeenCalledWith('/custom/path/socket.sock');
    });

    it('should handle empty socket path', async () => {
      vi.mocked(DevSupervisorClientFactory.getAppInfo).mockReturnValue({
        socketPath: '',
        port: 0,
        path: ''
      });

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Preview supervisor not available');
    });
  });

  describe('Publish Target', () => {
    let mockAppRepository: any;

    beforeEach(() => {
      mockLogClient.isAvailable.mockReturnValue(true);
      mockLogClient.readLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0,
        formatted: 'No logs'
      });

      // Mock AppRepository.findById for publish path
      mockAppRepository = {
        findById: vi.fn().mockReturnValue({
          publishSupervisorPath: '/tmp/publish-supervisor.sock'
        })
      };
      vi.mocked(AppRepository).mockImplementation(() => mockAppRepository);

      // Re-create tool so it picks up the mocked AppRepository
      viewLogsTool = new ViewLogsTool();
    });

    it('should read publish logs using publishSupervisorPath', async () => {
      const result = await viewLogsTool.readLogs('test-app', { target: 'publish' });

      expect(result.success).toBe(true);
      expect(mockAppRepository.findById).toHaveBeenCalledWith('test-app');
      expect(DevSupervisorLogClient).toHaveBeenCalledWith('/tmp/publish-supervisor.sock');
    });

    it('should fail when app has no publishSupervisorPath', async () => {
      mockAppRepository.findById.mockReturnValue({ publishSupervisorPath: null });

      const result = await viewLogsTool.readLogs('test-app', { target: 'publish' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Publish supervisor not available');
      expect(result.output).toContain('Publish logs not available');
    });

    it('should fail when app is not found', async () => {
      mockAppRepository.findById.mockReturnValue(null);

      const result = await viewLogsTool.readLogs('test-app', { target: 'publish' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Publish supervisor not available');
    });

    it('should default to preview when no target specified', async () => {
      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(true);
      expect(DevSupervisorClientFactory.getAppInfo).toHaveBeenCalledWith('test-app');
      expect(mockAppRepository.findById).not.toHaveBeenCalled();
    });

    it('should use preview path when target is explicitly preview', async () => {
      const result = await viewLogsTool.readLogs('test-app', { target: 'preview' });

      expect(result.success).toBe(true);
      expect(DevSupervisorClientFactory.getAppInfo).toHaveBeenCalledWith('test-app');
      expect(mockAppRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe('Performance and Logging', () => {
    beforeEach(() => {
      mockLogClient.isAvailable.mockReturnValue(true);
      mockLogClient.readLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0,
        formatted: 'No logs'
      });
    });

    it('should complete operations in reasonable time', async () => {
      const startTime = Date.now();

      await viewLogsTool.readLogs('test-app');

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // Should complete quickly in unit tests
    });

    it('should handle multiple concurrent requests', async () => {
      const promises = [
        viewLogsTool.readLogs('test-app-1'),
        viewLogsTool.readLogs('test-app-2'),
        viewLogsTool.readLogs('test-app-3')
      ];

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      expect(DevSupervisorLogClient).toHaveBeenCalledTimes(3);
    });
  });
});

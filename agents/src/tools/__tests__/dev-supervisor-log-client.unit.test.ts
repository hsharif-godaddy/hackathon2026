/**
 * LogReaderTool Unit Tests
 * 
 * These tests focus on the LogReaderTool logic without requiring a full dev environment.
 * They help identify specific issues with the log reading implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DevSupervisorLogClient } from '../dev-supervisor-log-client.js';
import { DevSupervisorClient } from '../../services/DevSupervisorClient.js';

// Mock the dependencies
vi.mock('../../services/DevSupervisorClient.js', () => ({
  DevSupervisorClient: vi.fn(),
  createDevSupervisorClient: vi.fn()
}));

describe('DevSupervisorLogClient Unit Tests', () => {
  let logClient: DevSupervisorLogClient;
  let mockDevSupervisor: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Mock DevSupervisorClient
    mockDevSupervisor = {
      isAvailable: vi.fn(),
      getLogs: vi.fn()
    };
    
    // Mock the createDevSupervisorClient function to return our mock
    vi.mocked(createDevSupervisorClient).mockReturnValue(mockDevSupervisor);
    
    // Create tool with mock socket path
    logClient = new DevSupervisorLogClient('/tmp/test.sock');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should create tool with socket path', () => {
      const tool = new DevSupervisorLogClient('/tmp/test.sock');
      expect(tool).toBeDefined();
      expect(tool.isAvailable()).toBe(false); // Will be false until dev supervisor is available
    });

    it('should create tool without socket path', () => {
      const tool = new DevSupervisorLogClient();
      expect(tool).toBeDefined();
      expect(tool.isAvailable()).toBe(false);
    });

    it('should report availability correctly', () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      expect(logClient.isAvailable()).toBe(true);
      
      mockDevSupervisor.isAvailable.mockReturnValue(false);
      expect(logClient.isAvailable()).toBe(false);
    });
  });

  describe('Basic Log Reading', () => {
    it('should read logs successfully', async () => {
      const mockLogs = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          source: 'stdout',
          message: 'Test log message',
          level: 'info'
        },
        {
          timestamp: '2024-01-01T10:01:00Z',
          source: 'stderr',
          message: 'Test error message',
          level: 'error'
        }
      ];

      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: true,
        logs: mockLogs,
        totalEntries: 2
      });

      const result = await logClient.readLogs();

      expect(result.success).toBe(true);
      expect(result.logs).toEqual(mockLogs);
      expect(result.totalEntries).toBe(2);
      expect(result.formatted).toBeDefined();
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 100,
        format: true
      });
    });

    it('should handle unavailable dev supervisor', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(false);

      const result = await logClient.readLogs();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
      expect(result.logs).toHaveLength(0);
      expect(result.totalEntries).toBe(0);
    });

    it('should handle dev supervisor errors', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockRejectedValue(new Error('Connection failed'));

      const result = await logClient.readLogs();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection failed');
      expect(result.logs).toHaveLength(0);
      expect(result.totalEntries).toBe(0);
    });
  });

  describe('Options Handling', () => {
    beforeEach(() => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0
      });
    });

    it('should pass line limit correctly', async () => {
      await logClient.readLogs({ lines: 50 });

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 50,
        format: true
      });
    });

    it('should enforce maximum line limit', async () => {
      await logClient.readLogs({ lines: 2000 });

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 1000, // Should be capped at 1000
        format: true
      });
    });

    it('should pass source filter correctly', async () => {
      await logClient.readLogs({ source: 'stderr' });

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 100,
        source: 'stderr',
        format: true
      });
    });

    it('should pass since timestamp correctly', async () => {
      const timestamp = '2024-01-01T10:00:00Z';
      await logClient.readLogs({ since: timestamp });

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 100,
        since: timestamp,
        format: true
      });
    });

    it('should handle invalid timestamp format', async () => {
      const result = await logClient.readLogs({ since: 'invalid-timestamp' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid since timestamp format');
    });

    it('should disable formatting when requested', async () => {
      await logClient.readLogs({ format: false });

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 100,
        format: false
      });
    });
  });

  describe('Convenience Methods', () => {
    beforeEach(() => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0
      });
    });

    it('should read recent logs with default count', async () => {
      await logClient.readRecentLogs();

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 50,
        format: true
      });
    });

    it('should read recent logs with custom count', async () => {
      await logClient.readRecentLogs(25);

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 25,
        format: true
      });
    });

    it('should read recent logs with source filter', async () => {
      await logClient.readRecentLogs(10, 'stdout');

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 10,
        source: 'stdout',
        format: true
      });
    });

    it('should read logs since timestamp', async () => {
      const timestamp = '2024-01-01T10:00:00Z';
      await logClient.readLogsSince(timestamp);

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 1000,
        since: timestamp,
        format: true
      });
    });

    it('should read error logs only', async () => {
      await logClient.readErrorLogs(25);

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 25,
        source: 'stderr',
        format: true
      });
    });

    it('should read output logs only', async () => {
      await logClient.readOutputLogs(25);

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 25,
        source: 'stdout',
        format: true
      });
    });
  });

  describe('Log Summary', () => {
    it('should get log summary successfully', async () => {
      const mockSummary = {
        totalLogs: 100,
        sources: { stdout: 60, stderr: 40 },
        levels: { info: 50, error: 30, warn: 20 },
        oldestEntry: '2024-01-01T09:00:00Z',
        newestEntry: '2024-01-01T10:00:00Z'
      };

      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0,
        summary: mockSummary
      });

      const result = await logClient.getLogSummary();

      expect(result.success).toBe(true);
      expect(result.summary).toEqual(mockSummary);
    });

    it('should handle unavailable dev supervisor for summary', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(false);

      const result = await logClient.getLogSummary();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
      expect(result.summary).toBeUndefined();
    });

    it('should format log summary correctly', () => {
      const summary = {
        totalLogs: 100,
        sources: { stdout: 60, stderr: 40 },
        levels: { info: 50, error: 30, warn: 20 },
        oldestEntry: '2024-01-01T09:00:00Z',
        newestEntry: '2024-01-01T10:00:00Z'
      };

      const formatted = logClient.formatLogSummary(summary);

      expect(formatted).toContain('Log Summary');
      expect(formatted).toContain('Total Logs:** 100');
      expect(formatted).toContain('Sources:');
      expect(formatted).toContain('stdout: 60');
      expect(formatted).toContain('stderr: 40');
      expect(formatted).toContain('Time Range:');
      expect(formatted).toContain('2024-01-01T09:00:00Z');
      expect(formatted).toContain('2024-01-01T10:00:00Z');
    });

    it('should format empty log summary correctly', () => {
      const summary = {
        totalLogs: 0,
        sources: {},
        levels: {}
      };

      const formatted = logClient.formatLogSummary(summary);

      expect(formatted).toContain('Log Summary');
      expect(formatted).toContain('Total Logs:** 0');
      expect(formatted).toContain('No logs available');
    });
  });

  describe('Log Formatting Integration', () => {
    it('should include formatted output when format=true', async () => {
      const mockLogs = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          source: 'stdout',
          message: 'Test message',
          level: 'info'
        }
      ];

      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: true,
        logs: mockLogs,
        totalEntries: 1
      });

      const result = await logClient.readLogs({ format: true });

      expect(result.success).toBe(true);
      expect(result.formatted).toBeDefined();
      expect(typeof result.formatted).toBe('string');
    });

    it('should not include formatted output when format=false', async () => {
      const mockLogs = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          source: 'stdout',
          message: 'Test message',
          level: 'info'
        }
      ];

      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: true,
        logs: mockLogs,
        totalEntries: 1
      });

      const result = await logClient.readLogs({ format: false });

      expect(result.success).toBe(true);
      expect(result.formatted).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined options', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0
      });

      const result = await logClient.readLogs(undefined);

      expect(result.success).toBe(true);
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 100,
        format: true
      });
    });

    it('should handle zero line limit', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0
      });

      const result = await logClient.readLogs({ lines: 0 });

      expect(result.success).toBe(true);
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({}); // No lines option when 0 is provided
    });

    it('should handle negative line limit', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: true,
        logs: [],
        totalEntries: 0
      });

      const result = await logClient.readLogs({ lines: -10 });

      expect(result.success).toBe(true);
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 1, // Should be at least 1
        format: true
      });
    });

    it('should handle empty string timestamp', async () => {
      const result = await logClient.readLogs({ since: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid since timestamp format');
    });

    it('should handle whitespace-only timestamp', async () => {
      const result = await logClient.readLogs({ since: '   ' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid since timestamp format');
    });
  });

  describe('Error Handling', () => {
    it('should handle dev supervisor getLogs returning error', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue({
        success: false,
        error: 'Failed to read logs',
        logs: [],
        totalEntries: 0
      });

      const result = await logClient.readLogs();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to read logs');
    });

    it('should handle dev supervisor throwing exception', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockRejectedValue(new Error('Network error'));

      const result = await logClient.readLogs();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle non-Error exceptions', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockRejectedValue('String error');

      const result = await logClient.readLogs();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown error');
    });
  });
});

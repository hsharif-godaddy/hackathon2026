/**
 * LogReaderTool Unit Tests
 *
 * These tests focus on the LogReaderTool logic without requiring a full dev environment.
 * They help identify specific issues with the log reading implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DevSupervisorLogClient } from '../dev-supervisor-log-client.js';
import { DevSupervisorClient, createDevSupervisorClient } from '../../services/DevSupervisorClient.js';

// Mock the dependencies
vi.mock('../../services/DevSupervisorClient.js', () => ({
  DevSupervisorClient: vi.fn(),
  createDevSupervisorClient: vi.fn()
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}));

vi.mock('../../logging/events/index.js', () => ({
  toolLogReaderEvents: {
    readBegin: vi.fn(),
    readSuccess: vi.fn(),
    readFailure: vi.fn(),
    summaryBegin: vi.fn(),
    summarySuccess: vi.fn(),
    summaryFailure: vi.fn()
  }
}));

vi.mock('../../utils/error.js', () => ({
  getErrorMessage: vi.fn((err: any) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return String(err);
  })
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
      mockDevSupervisor.getLogs.mockResolvedValue(mockLogs);

      const result = await logClient.readLogs();

      expect(result.success).toBe(true);
      expect(result.logs).toEqual(mockLogs);
      expect(result.totalEntries).toBe(2);
      expect(result.formatted).toBeDefined();
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({});
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
      mockDevSupervisor.getLogs.mockResolvedValue([]);
    });

    it('should pass line limit correctly', async () => {
      await logClient.readLogs({ lines: 50 });

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 50
      });
    });

    it('should enforce maximum line limit', async () => {
      await logClient.readLogs({ lines: 2000 });

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 1000 // Should be capped at 1000
      });
    });

    it('should pass source filter correctly', async () => {
      await logClient.readLogs({ source: 'stderr' });

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        source: 'stderr'
      });
    });

    it('should pass since timestamp correctly', async () => {
      const timestamp = '2024-01-01T10:00:00Z';
      await logClient.readLogs({ since: timestamp });

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        since: timestamp
      });
    });

    it('should handle invalid timestamp format', async () => {
      const result = await logClient.readLogs({ since: 'invalid-timestamp' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid since timestamp format');
    });

    it('should disable formatting when requested', async () => {
      await logClient.readLogs({ format: false });

      // format is not passed to getLogs - it's handled locally
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({});
    });
  });

  describe('Convenience Methods', () => {
    beforeEach(() => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue([]);
    });

    it('should read recent logs with default count', async () => {
      await logClient.readRecentLogs();

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 50
      });
    });

    it('should read recent logs with custom count', async () => {
      await logClient.readRecentLogs(25);

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 25
      });
    });

    it('should read recent logs with source filter', async () => {
      await logClient.readRecentLogs(10, 'stdout');

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 10,
        source: 'stdout'
      });
    });

    it('should read logs since timestamp', async () => {
      const timestamp = '2024-01-01T10:00:00Z';
      await logClient.readLogsSince(timestamp);

      // readLogsSince doesn't pass lines (no lines option set)
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        since: timestamp
      });
    });

    it('should read error logs only', async () => {
      await logClient.readErrorLogs(25);

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 25,
        source: 'stderr'
      });
    });

    it('should read output logs only', async () => {
      await logClient.readOutputLogs(25);

      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({
        lines: 25,
        source: 'stdout'
      });
    });
  });

  describe('Log Summary', () => {
    it('should get log summary successfully', async () => {
      const mockLogs = [
        { timestamp: '2024-01-01T09:00:00Z', source: 'stdout', message: 'msg1', level: 'info' },
        { timestamp: '2024-01-01T09:30:00Z', source: 'stdout', message: 'msg2', level: 'info' },
        { timestamp: '2024-01-01T10:00:00Z', source: 'stderr', message: 'msg3', level: 'error' }
      ];

      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue(mockLogs);

      const result = await logClient.getLogSummary();

      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary!.totalLogs).toBe(3);
      expect(result.summary!.sources).toEqual({ stdout: 2, stderr: 1 });
      expect(result.summary!.levels).toEqual({ info: 2, error: 1 });
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
      mockDevSupervisor.getLogs.mockResolvedValue(mockLogs);

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
      mockDevSupervisor.getLogs.mockResolvedValue(mockLogs);

      const result = await logClient.readLogs({ format: false });

      expect(result.success).toBe(true);
      expect(result.formatted).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined options', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue([]);

      const result = await logClient.readLogs(undefined);

      expect(result.success).toBe(true);
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({});
    });

    it('should handle zero line limit', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue([]);

      const result = await logClient.readLogs({ lines: 0 });

      expect(result.success).toBe(true);
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({});
    });

    it('should handle negative line limit', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue([]);

      const result = await logClient.readLogs({ lines: -10 });

      expect(result.success).toBe(true);
      // Negative lines: options.lines is -10, truthy, but options.lines > 0 is false, so lines not added
      expect(mockDevSupervisor.getLogs).toHaveBeenCalledWith({});
    });

    it('should handle empty string timestamp', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      mockDevSupervisor.getLogs.mockResolvedValue([]);
      const result = await logClient.readLogs({ since: '' });

      // Empty string is falsy, so since branch not entered; getLogs called with {}
      expect(result.success).toBe(true);
    });

    it('should handle whitespace-only timestamp', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(true);
      // Whitespace-only string is truthy, so it enters the since branch
      // new Date('   ') creates Invalid Date -> isNaN returns true
      const result = await logClient.readLogs({ since: '   ' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid since timestamp format');
    });
  });

  describe('Error Handling', () => {
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
      expect(result.error).toContain('String error');
    });
  });
});

/**
 * ViewLogsTool Unit Tests
 *
 * Exercises the high-level log tool against the workspace `diagnostics.logs`
 * API. The real log-formatting helpers run (not mocked), so these also cover
 * tool → formatter integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ViewLogsTool } from '../view-logs-tool.js';
import { createForWorkspace } from '../../workspace/index.js';
import { toolLogReaderEvents } from '../../logging/events/index.js';
import type { LogEntry } from '../../workspace/diagnostics.js';

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

const logEntry = (over: Partial<LogEntry> = {}): LogEntry => ({
  timestamp: new Date('2024-01-01T10:00:00.000Z'),
  source: 'stdout',
  message: 'Test log message',
  level: 'info',
  ...over,
});

describe('ViewLogsTool Unit Tests', () => {
  let viewLogsTool: ViewLogsTool;
  let mockDiagnostics: { logs: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiagnostics = { logs: vi.fn().mockResolvedValue([]) };
    vi.mocked(createForWorkspace).mockReturnValue({ diagnostics: mockDiagnostics } as any);
    viewLogsTool = new ViewLogsTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization & binding', () => {
    it('binds the preview workspace by default and reads logs', async () => {
      await viewLogsTool.readLogs('test-app');

      expect(createForWorkspace).toHaveBeenCalledWith('test-app', 'preview');
      expect(mockDiagnostics.logs).toHaveBeenCalledWith({ lines: 50 });
    });

    it('returns a friendly failure when the workspace cannot be bound', async () => {
      vi.mocked(createForWorkspace).mockReturnValue(null);

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Preview supervisor not available');
      expect(result.output).toContain('Preview logs not available');
    });
  });

  describe('Basic log reading', () => {
    it('formats returned logs and reports the count', async () => {
      mockDiagnostics.logs.mockResolvedValue([
        logEntry({ source: 'stdout', level: 'info', message: 'hello world' }),
      ]);

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(true);
      expect(result.totalLogs).toBe(1);
      expect(result.output).toContain('**Total Entries:** 1');
      expect(result.output).toContain('hello world');
    });

    it('returns a no-logs message with a tip when empty', async () => {
      mockDiagnostics.logs.mockResolvedValue([]);

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(true);
      expect(result.totalLogs).toBe(0);
      expect(result.output).toContain('No recent logs found');
      expect(result.output).toContain('**Tip**');
    });
  });

  describe('Query options', () => {
    it('passes the line limit through', async () => {
      await viewLogsTool.readLogs('test-app', { lines: 100 });
      expect(mockDiagnostics.logs).toHaveBeenCalledWith({ lines: 100 });
    });

    it('caps the line limit at 1000', async () => {
      await viewLogsTool.readLogs('test-app', { lines: 2000 });
      expect(mockDiagnostics.logs).toHaveBeenCalledWith({ lines: 1000 });
    });

    it('defaults a falsy line limit to 50 but passes a negative value through', async () => {
      await viewLogsTool.readLogs('test-app', { lines: 0 });
      expect(mockDiagnostics.logs).toHaveBeenCalledWith({ lines: 50 });
      await viewLogsTool.readLogs('test-app', { lines: -10 });
      expect(mockDiagnostics.logs).toHaveBeenCalledWith({ lines: -10 });
    });

    it('forwards the source filter', async () => {
      await viewLogsTool.readLogs('test-app', { source: 'stderr' });
      expect(mockDiagnostics.logs).toHaveBeenCalledWith({ lines: 50, source: 'stderr' });
    });

    it('converts an ISO since string to a Date', async () => {
      await viewLogsTool.readLogs('test-app', { since: '2024-01-01T10:00:00Z' });
      expect(mockDiagnostics.logs).toHaveBeenCalledWith({
        lines: 50,
        since: new Date('2024-01-01T10:00:00Z'),
      });
    });

    it('rejects an invalid since timestamp before calling the workspace', async () => {
      const result = await viewLogsTool.readLogs('test-app', { since: 'not-a-date' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid since timestamp');
      expect(mockDiagnostics.logs).not.toHaveBeenCalled();
    });
  });

  describe('Summary mode', () => {
    it('aggregates and formats a summary', async () => {
      mockDiagnostics.logs.mockResolvedValue([
        logEntry({ source: 'stdout', level: 'info' }),
        logEntry({ source: 'stderr', level: 'error' }),
      ]);

      const result = await viewLogsTool.readLogs('test-app', { summary: true });

      expect(result.success).toBe(true);
      expect(result.totalLogs).toBe(2);
      expect(result.output).toContain('**Log Summary**');
      expect(result.output).toContain('**Total Logs:** 2');
      // Summary pulls the full log set, not a line-limited slice.
      expect(mockDiagnostics.logs).toHaveBeenCalledWith({});
    });

    it('returns a no-logs message when the summary is empty', async () => {
      mockDiagnostics.logs.mockResolvedValue([]);

      const result = await viewLogsTool.readLogs('test-app', { summary: true });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No logs found');
    });

    it('re-emits the dedicated log-reader summary telemetry on success', async () => {
      const begin = vi.spyOn(toolLogReaderEvents, 'summaryBegin');
      const success = vi.spyOn(toolLogReaderEvents, 'summarySuccess');
      mockDiagnostics.logs.mockResolvedValue([logEntry({ source: 'stdout', level: 'info' })]);

      await viewLogsTool.readLogs('test-app', { summary: true });

      expect(begin).toHaveBeenCalledWith(expect.anything(), { toolName: 'log-reader', appId: 'test-app' });
      expect(success).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toolName: 'log-reader', operation: 'summary' }),
      );
    });

    it('emits summaryFailure (not readFailure) when the summary read throws', async () => {
      const summaryFailure = vi.spyOn(toolLogReaderEvents, 'summaryFailure');
      const readFailure = vi.spyOn(toolLogReaderEvents, 'readFailure');
      mockDiagnostics.logs.mockRejectedValue(new Error('Network error'));

      const result = await viewLogsTool.readLogs('test-app', { summary: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(summaryFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Error),
        { toolName: 'log-reader', appId: 'test-app', operation: 'summary' },
      );
      expect(readFailure).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('returns a structured failure when the read throws', async () => {
      mockDiagnostics.logs.mockRejectedValue(new Error('Network error'));

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.output).toContain('Unexpected error reading logs');
    });

    it('handles non-Error throws', async () => {
      mockDiagnostics.logs.mockRejectedValue('String error');

      const result = await viewLogsTool.readLogs('test-app');

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });
  });

  describe('Publish target', () => {
    it('binds the publish variant for target=publish', async () => {
      await viewLogsTool.readLogs('test-app', { target: 'publish' });
      expect(createForWorkspace).toHaveBeenCalledWith('test-app', 'publish');
    });

    it('reports publish-specific messaging when the publish workspace is unavailable', async () => {
      vi.mocked(createForWorkspace).mockReturnValue(null);

      const result = await viewLogsTool.readLogs('test-app', { target: 'publish' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Publish supervisor not available');
      expect(result.output).toContain('Publish logs not available');
    });

    it('binds the preview variant when target is explicitly preview', async () => {
      await viewLogsTool.readLogs('test-app', { target: 'preview' });
      expect(createForWorkspace).toHaveBeenCalledWith('test-app', 'preview');
    });
  });

  describe('Edge cases', () => {
    it('treats undefined options as defaults', async () => {
      const result = await viewLogsTool.readLogs('test-app', undefined);
      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalledWith({ lines: 50 });
    });

    it('binds a separate workspace per concurrent request', async () => {
      await Promise.all([
        viewLogsTool.readLogs('app-1'),
        viewLogsTool.readLogs('app-2'),
        viewLogsTool.readLogs('app-3'),
      ]);
      expect(createForWorkspace).toHaveBeenCalledTimes(3);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomerLogsService } from '../customer-logs-service.js';
import { LogSanitizer } from '../log-sanitizer.js';
import type { AppRepository } from '../../database/repositories/AppRepository.js';
import type { App } from '../../database/schema.js';
import type { DevSupervisorClient, LogEntry } from '../DevSupervisorClient.js';

// Mock DevSupervisorClient
vi.mock('../DevSupervisorClient.js', () => ({
  DevSupervisorClient: vi.fn(),
  createDevSupervisorClient: vi.fn()
}));

describe('CustomerLogsService', () => {
  let service: CustomerLogsService;
  let mockAppRepository: Partial<AppRepository>;
  let mockDevSupervisorClient: Partial<DevSupervisorClient>;
  let logSanitizer: LogSanitizer;

  const mockApp: App = {
    id: 'test-app-123',
    name: 'Test App',
    path: '/tmp/apps/test-app-123',
    port: 3000,
    socketPath: 'tcp://localhost:8080',
    publishSupervisorPath: 'tcp://localhost:8081',
    status: 'created',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockLogs: LogEntry[] = [
    { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Build started', level: 'info' },
    { timestamp: '2025-01-22T10:01:00Z', source: 'stdout', message: 'Dependencies installed', level: 'info' },
    { timestamp: '2025-01-22T10:02:00Z', source: 'stderr', message: 'Warning: deprecated API', level: 'warn' }
  ];

  // Default required params for tests
  const defaultParams = {
    appId: 'test-app-123',
    target: 'preview' as const
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDevSupervisorClient = {
      isAvailable: vi.fn().mockReturnValue(true),
      // Mirror the real supervisor's server-side source filter so callers
      // that request `source: 'stdout'` only get stdout entries — matters
      // now that CustomerLogsService defaults to filtered-per-source
      // requests instead of one unfiltered call.
      getLogs: vi.fn().mockImplementation(function (opts: { source?: string } = {}) { return Promise.resolve(opts.source ? mockLogs.filter((l) => l.source === opts.source) : mockLogs); }
      )
    };

    mockAppRepository = {
      findById: vi.fn().mockReturnValue(mockApp)
    };

    logSanitizer = new LogSanitizer();

    service = new CustomerLogsService(
      mockAppRepository as AppRepository,
      logSanitizer,
      // Factory function to create mock DevSupervisorClient
      (_socketPath: string) => mockDevSupervisorClient as DevSupervisorClient
    );
  });

  describe('getLogs', () => {
    it('should fetch logs from preview supervisor', async () => {
      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
      expect(mockAppRepository.findById).toHaveBeenCalledWith('test-app-123');
    });

    it('should fetch logs from publish supervisor when target is publish', async () => {
      const result = await service.getLogs({ ...defaultParams, target: 'publish' });

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
    });

    it('should return error if app not found', async () => {
      mockAppRepository.findById = vi.fn().mockReturnValue(null);

      const result = await service.getLogs({ ...defaultParams, appId: 'non-existent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.logs).toEqual([]);
    });

    it('should return error if socketPath not configured for preview', async () => {
      const appWithoutSocket = { ...mockApp, socketPath: undefined };
      mockAppRepository.findById = vi.fn().mockReturnValue(appWithoutSocket);

      const result = await service.getLogs({ ...defaultParams, target: 'preview' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should return error if publishSupervisorPath not configured for publish', async () => {
      const appWithoutPublish = { ...mockApp, publishSupervisorPath: undefined };
      mockAppRepository.findById = vi.fn().mockReturnValue(appWithoutPublish);

      const result = await service.getLogs({ ...defaultParams, target: 'publish' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should return error if supervisor unavailable', async () => {
      mockDevSupervisorClient.isAvailable = vi.fn().mockReturnValue(false);

      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(false);
      expect(result.error).toContain('unavailable');
    });

    it('should apply log sanitization', async () => {
      const logsWithSecrets: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Using OPENAI_API_KEY=sk-secret123', level: 'info' }
      ];
      mockDevSupervisorClient.getLogs = vi.fn().mockResolvedValue(logsWithSecrets);

      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(result.logs[0].message).not.toContain('sk-secret123');
      expect(result.logs[0].message).toContain('[REDACTED]');
    });

    it('should respect line limit with max 500', async () => {
      const result = await service.getLogs({ ...defaultParams, lines: 50 });

      expect(result.success).toBe(true);
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({ lines: 50 })
      );
    });

    it('should cap lines at 500 if higher value provided', async () => {
      const result = await service.getLogs({ ...defaultParams, lines: 1000 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum');
      expect(result.code).toBe('INVALID_LINES');
    });

    it('defaults to stdout+stderr and never forwards source="exec" or an unfiltered request', async () => {
      // Leak guard: when no `sources` is provided, CustomerLogsService must
      // restrict the upstream request to managed-process streams so /exec
      // orchestration output (Source="exec" in the supervisor ring buffer)
      // doesn't reach customer-facing surfaces or the agent LLM tool.
      const getLogsSpy = vi.fn().mockResolvedValue([]);
      mockDevSupervisorClient.getLogs = getLogsSpy;

      await service.getLogs({ ...defaultParams });

      const sources = getLogsSpy.mock.calls.map(([opts]) => opts.source);
      // Every upstream call must specify a source — never an unfiltered
      // (empty/undefined) request.
      expect(sources.every((s) => s === 'stdout' || s === 'stderr')).toBe(true);
      // And the set of sources covers both managed-process streams.
      expect(new Set(sources)).toEqual(new Set(['stdout', 'stderr']));
      // Specifically, "exec" must not appear.
      expect(sources).not.toContain('exec');
    });

    it('should filter by sources array (stdout)', async () => {
      const result = await service.getLogs({ ...defaultParams, sources: ['stdout'] });

      expect(result.success).toBe(true);
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'stdout' })
      );
    });

    it('should filter by sources array (stderr)', async () => {
      const result = await service.getLogs({ ...defaultParams, sources: ['stderr'] });

      expect(result.success).toBe(true);
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'stderr' })
      );
    });

    it('should filter by since timestamp when provided', async () => {
      const since = '2025-01-22T10:00:00Z';
      const result = await service.getLogs({ ...defaultParams, since });

      expect(result.success).toBe(true);
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({ since })
      );
    });

    it('should work without since timestamp (fetch latest logs)', async () => {
      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalled();
    });

    it('should return error for invalid since timestamp', async () => {
      const result = await service.getLogs({ ...defaultParams, since: 'invalid-date' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timestamp');
    });

    it('should handle supervisor getLogs errors gracefully', async () => {
      mockDevSupervisorClient.getLogs = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.logs).toEqual([]);
    });

    it('should return total count of logs', async () => {
      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(result.total).toBe(3);
    });

    it('should filter out DEBUG level logs', async () => {
      const logsWithDebug: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Info log', level: 'info' },
        { timestamp: '2025-01-22T10:01:00Z', source: 'stdout', message: 'Debug log', level: 'debug' }
      ];
      mockDevSupervisorClient.getLogs = vi.fn().mockImplementation(function (opts: { source?: string } = {}) { return Promise.resolve(opts.source ? logsWithDebug.filter((l) => l.source === opts.source) : logsWithDebug); }
      );

      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].message).toBe('Info log');
    });

    it('should support multiple sources via sources array', async () => {
      const stdoutLogs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'stdout log', level: 'info' }
      ];
      const stderrLogs: LogEntry[] = [
        { timestamp: '2025-01-22T10:01:00Z', source: 'stderr', message: 'stderr log', level: 'error' }
      ];
      mockDevSupervisorClient.getLogs = vi.fn()
        .mockResolvedValueOnce(stdoutLogs)
        .mockResolvedValueOnce(stderrLogs);

      const result = await service.getLogs({ ...defaultParams, sources: ['stdout', 'stderr'] });

      expect(result.success).toBe(true);
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalledTimes(2);
      expect(result.logs).toHaveLength(2);
    });

    it('should sort merged logs by timestamp when using multiple sources', async () => {
      const stdoutLogs: LogEntry[] = [
        { timestamp: '2025-01-22T10:02:00Z', source: 'stdout', message: 'later stdout', level: 'info' }
      ];
      const stderrLogs: LogEntry[] = [
        { timestamp: '2025-01-22T10:01:00Z', source: 'stderr', message: 'earlier stderr', level: 'error' }
      ];
      mockDevSupervisorClient.getLogs = vi.fn()
        .mockResolvedValueOnce(stdoutLogs)
        .mockResolvedValueOnce(stderrLogs);

      const result = await service.getLogs({ ...defaultParams, sources: ['stdout', 'stderr'] });

      expect(result.success).toBe(true);
      // Should be sorted by timestamp
      expect(result.logs[0].message).toContain('earlier stderr');
      expect(result.logs[1].message).toContain('later stdout');
    });

    it('returns the newest N sanitized entries, not the oldest, when total exceeds lines', async () => {
      // Regression: fan-out across sources means each per-source call
      // returns up to `lines` entries, and naive slice(0, lines) on the
      // merged array discards the newest entries — where failure signals
      // (build errors, stack traces, exit messages) actually live.
      //
      // Construct two sources whose merged timeline has 5 entries, request
      // lines=2, and assert we get the last two (newest) — not the first two.
      const stdoutLogs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'oldest-stdout', level: 'info' },
        { timestamp: '2025-01-22T10:02:00Z', source: 'stdout', message: 'middle-stdout', level: 'info' },
        { timestamp: '2025-01-22T10:04:00Z', source: 'stdout', message: 'newest-stdout', level: 'info' }
      ];
      const stderrLogs: LogEntry[] = [
        { timestamp: '2025-01-22T10:01:00Z', source: 'stderr', message: 'oldest-stderr', level: 'error' },
        { timestamp: '2025-01-22T10:03:00Z', source: 'stderr', message: 'newest-stderr', level: 'error' }
      ];
      mockDevSupervisorClient.getLogs = vi.fn().mockImplementation(function (opts: { source?: string } = {}) { return Promise.resolve(opts.source === 'stderr' ? stderrLogs : stdoutLogs); }
      );

      const result = await service.getLogs({ ...defaultParams, lines: 2, sources: ['stdout', 'stderr'] });

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(2);
      expect(result.logs.map(l => l.message)).toEqual(['newest-stderr', 'newest-stdout']);
    });

    it('should use single source when sources array has one element', async () => {
      const result = await service.getLogs({ ...defaultParams, sources: ['stdout'] });

      expect(result.success).toBe(true);
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'stdout' })
      );
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalledTimes(1);
    });

    it('should return error when target is missing', async () => {
      const result = await service.getLogs({ appId: 'test-app-123' } as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('target is required');
      expect(result.code).toBe('MISSING_TARGET');
    });

    // NOTE: the former test "should return all sources when sources is not
    // provided" was removed — it documented the leak we're now fixing. The
    // new behavior is covered by the "defaults to stdout+stderr" test above.
  });

  describe('getPreviewLogs', () => {
    it('should fetch logs from preview supervisor', async () => {
      const result = await service.getPreviewLogs('test-app-123', {});

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
    });

    it('should pass options to getLogs', async () => {
      const result = await service.getPreviewLogs('test-app-123', { lines: 50, sources: ['stderr'], since: '2025-01-22T00:00:00Z' });

      expect(result.success).toBe(true);
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({ lines: 50, source: 'stderr' })
      );
    });
  });

  describe('getPublishLogs', () => {
    it('should fetch logs from publish supervisor', async () => {
      const result = await service.getPublishLogs('test-app-123', {});

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
    });

    it('should pass options to getLogs', async () => {
      const result = await service.getPublishLogs('test-app-123', { lines: 100, sources: ['stdout'], since: '2025-01-22T00:00:00Z' });

      expect(result.success).toBe(true);
      expect(mockDevSupervisorClient.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({ lines: 100 })
      );
    });
  });

  describe('validation', () => {
    it('should validate appId is provided', async () => {
      const result = await service.getLogs({ ...defaultParams, appId: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('appId');
    });

    it('should validate target is valid value', async () => {
      const result = await service.getLogs({ ...defaultParams, target: 'invalid' as any });

      expect(result.success).toBe(false);
      expect(result.error).toContain('target');
    });

    it('should validate sources array contains valid values', async () => {
      const result = await service.getLogs({ ...defaultParams, sources: ['invalid' as any] });

      expect(result.success).toBe(false);
      expect(result.error).toContain('source');
    });

    it('should validate lines is positive number', async () => {
      const result = await service.getLogs({ ...defaultParams, lines: -10 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('lines');
    });

    it('should validate lines does not exceed maximum', async () => {
      const result = await service.getLogs({ ...defaultParams, lines: 1000 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum');
      expect(result.code).toBe('INVALID_LINES');
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomerLogsService } from '../customer-logs-service.js';
import { LogSanitizer } from '../log-sanitizer.js';
import type { AppRepository } from '../../database/repositories/AppRepository.js';
import type { App } from '../../database/schema.js';
import type { WorkspaceClient, CreateForWorkspace } from '../../workspace/index.js';
import type { LogEntry as WorkspaceLogEntry } from '../../workspace/diagnostics.js';

describe('CustomerLogsService', () => {
  let service: CustomerLogsService;
  let mockAppRepository: Partial<AppRepository>;
  let mockDiagnostics: { logs: ReturnType<typeof vi.fn> };
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

  const mockLogs: WorkspaceLogEntry[] = [
    { timestamp: new Date('2025-01-22T10:00:00Z'), source: 'stdout', message: 'Build started', level: 'info' },
    { timestamp: new Date('2025-01-22T10:01:00Z'), source: 'stdout', message: 'Dependencies installed', level: 'info' },
    { timestamp: new Date('2025-01-22T10:02:00Z'), source: 'stderr', message: 'Warning: deprecated API', level: 'warn' }
  ];

  const defaultParams = {
    appId: 'test-app-123',
    target: 'preview' as const
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiagnostics = {
      logs: vi.fn().mockImplementation(function (opts: { source?: string } = {}) {
        return Promise.resolve(
          opts.source ? mockLogs.filter((l) => l.source === opts.source) : mockLogs
        );
      })
    };

    mockAppRepository = {
      findById: vi.fn().mockReturnValue(mockApp)
    };

    logSanitizer = new LogSanitizer();

    const mockWorkspaceFactory: CreateForWorkspace = () => ({
      diagnostics: mockDiagnostics,
    }) as unknown as WorkspaceClient;

    service = new CustomerLogsService(
      mockAppRepository as AppRepository,
      logSanitizer,
      mockWorkspaceFactory
    );
  });

  describe('getLogs', () => {
    it('should fetch logs from preview workspace', async () => {
      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
      expect(mockAppRepository.findById).toHaveBeenCalledWith('test-app-123');
    });

    it('should fetch logs from publish workspace when target is publish', async () => {
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

    it('should return error if workspace not configured', async () => {
      const nullFactory: CreateForWorkspace = () => null;
      const svc = new CustomerLogsService(
        mockAppRepository as AppRepository,
        logSanitizer,
        nullFactory
      );

      const result = await svc.getLogs({ ...defaultParams, target: 'preview' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should return error if publish workspace not configured', async () => {
      const nullFactory: CreateForWorkspace = () => null;
      const svc = new CustomerLogsService(
        mockAppRepository as AppRepository,
        logSanitizer,
        nullFactory
      );

      const result = await svc.getLogs({ ...defaultParams, target: 'publish' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should apply log sanitization', async () => {
      const logsWithSecrets: WorkspaceLogEntry[] = [
        { timestamp: new Date('2025-01-22T10:00:00Z'), source: 'stdout', message: 'Using OPENAI_API_KEY=sk-secret123', level: 'info' }
      ];
      mockDiagnostics.logs.mockResolvedValue(logsWithSecrets);

      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(result.logs[0].message).not.toContain('sk-secret123');
      expect(result.logs[0].message).toContain('[REDACTED]');
    });

    it('should respect line limit with max 500', async () => {
      const result = await service.getLogs({ ...defaultParams, lines: 50 });

      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalledWith(
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
      const logsSpy = vi.fn().mockResolvedValue([]);
      mockDiagnostics.logs = logsSpy;

      await service.getLogs({ ...defaultParams });

      const sources = logsSpy.mock.calls.map(([opts]) => opts.source);
      expect(sources.every((s: string) => s === 'stdout' || s === 'stderr')).toBe(true);
      expect(new Set(sources)).toEqual(new Set(['stdout', 'stderr']));
      expect(sources).not.toContain('exec');
    });

    it('should filter by sources array (stdout)', async () => {
      const result = await service.getLogs({ ...defaultParams, sources: ['stdout'] });

      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'stdout' })
      );
    });

    it('should filter by sources array (stderr)', async () => {
      const result = await service.getLogs({ ...defaultParams, sources: ['stderr'] });

      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'stderr' })
      );
    });

    it('should filter by since timestamp when provided', async () => {
      const since = '2025-01-22T10:00:00Z';
      const result = await service.getLogs({ ...defaultParams, since });

      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalledWith(
        expect.objectContaining({ since: new Date(since) })
      );
    });

    it('should work without since timestamp (fetch latest logs)', async () => {
      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalled();
    });

    it('should return error for invalid since timestamp', async () => {
      const result = await service.getLogs({ ...defaultParams, since: 'invalid-date' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timestamp');
    });

    it('should return SUPERVISOR_UNAVAILABLE on connection errors', async () => {
      const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), { code: 'ECONNREFUSED' });
      mockDiagnostics.logs = vi.fn().mockRejectedValue(connErr);

      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(false);
      expect(result.code).toBe('SUPERVISOR_UNAVAILABLE');
      expect(result.error).toContain('unavailable');
      expect(result.logs).toEqual([]);
    });

    it('should return SUPERVISOR_UNAVAILABLE when socket not found', async () => {
      const socketErr = Object.assign(new Error('dev-supervisor not available at /tmp/test.sock'), { code: 'ENOENT' });
      mockDiagnostics.logs = vi.fn().mockRejectedValue(socketErr);

      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(false);
      expect(result.code).toBe('SUPERVISOR_UNAVAILABLE');
    });

    it('should return FETCH_ERROR on non-connection errors', async () => {
      mockDiagnostics.logs = vi.fn().mockRejectedValue(new Error('Unexpected JSON parse failure'));

      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(false);
      expect(result.code).toBe('FETCH_ERROR');
      expect(result.logs).toEqual([]);
    });

    it('should return total count of logs', async () => {
      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(result.total).toBe(3);
    });

    it('should filter out DEBUG level logs', async () => {
      const logsWithDebug: WorkspaceLogEntry[] = [
        { timestamp: new Date('2025-01-22T10:00:00Z'), source: 'stdout', message: 'Info log', level: 'info' },
        { timestamp: new Date('2025-01-22T10:01:00Z'), source: 'stdout', message: 'Debug log', level: 'debug' }
      ];
      mockDiagnostics.logs.mockImplementation(function (opts: { source?: string } = {}) {
        return Promise.resolve(
          opts.source ? logsWithDebug.filter((l) => l.source === opts.source) : logsWithDebug
        );
      });

      const result = await service.getLogs({ ...defaultParams });

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].message).toBe('Info log');
    });

    it('should support multiple sources via sources array', async () => {
      const stdoutLogs: WorkspaceLogEntry[] = [
        { timestamp: new Date('2025-01-22T10:00:00Z'), source: 'stdout', message: 'stdout log', level: 'info' }
      ];
      const stderrLogs: WorkspaceLogEntry[] = [
        { timestamp: new Date('2025-01-22T10:01:00Z'), source: 'stderr', message: 'stderr log', level: 'error' }
      ];
      mockDiagnostics.logs = vi.fn()
        .mockResolvedValueOnce(stdoutLogs)
        .mockResolvedValueOnce(stderrLogs);

      const result = await service.getLogs({ ...defaultParams, sources: ['stdout', 'stderr'] });

      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalledTimes(2);
      expect(result.logs).toHaveLength(2);
    });

    it('should sort merged logs by timestamp when using multiple sources', async () => {
      const stdoutLogs: WorkspaceLogEntry[] = [
        { timestamp: new Date('2025-01-22T10:02:00Z'), source: 'stdout', message: 'later stdout', level: 'info' }
      ];
      const stderrLogs: WorkspaceLogEntry[] = [
        { timestamp: new Date('2025-01-22T10:01:00Z'), source: 'stderr', message: 'earlier stderr', level: 'error' }
      ];
      mockDiagnostics.logs = vi.fn()
        .mockResolvedValueOnce(stdoutLogs)
        .mockResolvedValueOnce(stderrLogs);

      const result = await service.getLogs({ ...defaultParams, sources: ['stdout', 'stderr'] });

      expect(result.success).toBe(true);
      expect(result.logs[0].message).toContain('earlier stderr');
      expect(result.logs[1].message).toContain('later stdout');
    });

    it('returns the newest N sanitized entries, not the oldest, when total exceeds lines', async () => {
      const stdoutLogs: WorkspaceLogEntry[] = [
        { timestamp: new Date('2025-01-22T10:00:00Z'), source: 'stdout', message: 'oldest-stdout', level: 'info' },
        { timestamp: new Date('2025-01-22T10:02:00Z'), source: 'stdout', message: 'middle-stdout', level: 'info' },
        { timestamp: new Date('2025-01-22T10:04:00Z'), source: 'stdout', message: 'newest-stdout', level: 'info' }
      ];
      const stderrLogs: WorkspaceLogEntry[] = [
        { timestamp: new Date('2025-01-22T10:01:00Z'), source: 'stderr', message: 'oldest-stderr', level: 'error' },
        { timestamp: new Date('2025-01-22T10:03:00Z'), source: 'stderr', message: 'newest-stderr', level: 'error' }
      ];
      mockDiagnostics.logs.mockImplementation(function (opts: { source?: string } = {}) {
        return Promise.resolve(opts.source === 'stderr' ? stderrLogs : stdoutLogs);
      });

      const result = await service.getLogs({ ...defaultParams, lines: 2, sources: ['stdout', 'stderr'] });

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(2);
      expect(result.logs.map(l => l.message)).toEqual(['newest-stderr', 'newest-stdout']);
    });

    it('should use single source when sources array has one element', async () => {
      const result = await service.getLogs({ ...defaultParams, sources: ['stdout'] });

      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'stdout' })
      );
      expect(mockDiagnostics.logs).toHaveBeenCalledTimes(1);
    });

    it('should return error when target is missing', async () => {
      const result = await service.getLogs({ appId: 'test-app-123' } as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('target is required');
      expect(result.code).toBe('MISSING_TARGET');
    });
  });

  describe('getPreviewLogs', () => {
    it('should fetch logs from preview workspace', async () => {
      const result = await service.getPreviewLogs('test-app-123', {});

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
    });

    it('should pass options to getLogs', async () => {
      const result = await service.getPreviewLogs('test-app-123', { lines: 50, sources: ['stderr'], since: '2025-01-22T00:00:00Z' });

      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalledWith(
        expect.objectContaining({ lines: 50, source: 'stderr' })
      );
    });
  });

  describe('getPublishLogs', () => {
    it('should fetch logs from publish workspace', async () => {
      const result = await service.getPublishLogs('test-app-123', {});

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
    });

    it('should pass options to getLogs', async () => {
      const result = await service.getPublishLogs('test-app-123', { lines: 100, sources: ['stdout'], since: '2025-01-22T00:00:00Z' });

      expect(result.success).toBe(true);
      expect(mockDiagnostics.logs).toHaveBeenCalledWith(
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

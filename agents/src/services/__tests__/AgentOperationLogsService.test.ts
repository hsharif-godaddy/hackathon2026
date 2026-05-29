import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentOperationLogsService,
  shouldUseAgentImportLogs,
} from '../AgentOperationLogsService.js';
import { LogSanitizer } from '../log-sanitizer.js';
import type { ImportJobRepository } from '../../database/repositories/ImportJobRepository.js';
import { ImportJobStatus } from '../../types/import.js';
import type { ImportJob } from '../../types/import.js';

describe('AgentOperationLogsService', () => {
  let mockImportJobRepo: Pick<ImportJobRepository, 'findRecentFailedByAppId'>;
  let service: AgentOperationLogsService;

  const baseJob: ImportJob = {
    id: 'job-1',
    appId: 'app-123',
    status: ImportJobStatus.FAILED,
    sourceType: 'zip',
    errorMessage: 'Project validation failed',
    errorStage: ImportJobStatus.VALIDATING,
    validationErrors: JSON.stringify([
      { key: 'PACKAGE_JSON_NOT_FOUND', message: 'package.json not found in project root' },
    ]),
    installOutput: undefined,
    buildOutput: undefined,
    completedAt: new Date('2026-04-20T12:00:00Z'),
    createdAt: new Date('2026-04-20T11:00:00Z'),
    updatedAt: new Date('2026-04-20T12:00:00Z'),
  };

  beforeEach(() => {
    mockImportJobRepo = {
      findRecentFailedByAppId: vi.fn(),
    };
    service = new AgentOperationLogsService(
      mockImportJobRepo as ImportJobRepository,
      new LogSanitizer()
    );
  });

  it('returns sanitized log lines from a recent failed import job', async () => {
    vi.mocked(mockImportJobRepo.findRecentFailedByAppId).mockResolvedValue(baseJob);

    const result = await service.getFailureLogs({
      appId: 'app-123',
      since: '2026-04-20T09:00:00Z',
    });

    expect(result.source).toBe('import_job');
    expect(result.importSource).toBe('zip');
    expect(result.errorStage).toBe('validating');
    expect(result.total).toBeGreaterThan(0);
    expect(result.logs.some((l) => l.message.includes('[agent/import:validation] PACKAGE_JSON_NOT_FOUND'))).toBe(
      true
    );
    expect(mockImportJobRepo.findRecentFailedByAppId).toHaveBeenCalledWith(
      'app-123',
      new Date('2026-04-20T09:00:00Z')
    );
  });

  it('returns empty when no failed import job exists', async () => {
    vi.mocked(mockImportJobRepo.findRecentFailedByAppId).mockResolvedValue(null);

    const result = await service.getFailureLogs({
      appId: 'app-123',
      since: '2026-04-20T09:00:00Z',
    });

    expect(result).toEqual({ logs: [], total: 0, source: 'none' });
  });

  it('returns empty when since timestamp is invalid', async () => {
    const result = await service.getFailureLogs({
      appId: 'app-123',
      since: 'not-a-date',
    });

    expect(result).toEqual({ logs: [], total: 0, source: 'none' });
    expect(mockImportJobRepo.findRecentFailedByAppId).not.toHaveBeenCalled();
  });

  it('caps output to max lines (tail)', async () => {
    const manyLines = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n');
    vi.mocked(mockImportJobRepo.findRecentFailedByAppId).mockResolvedValue({
      ...baseJob,
      errorStage: ImportJobStatus.INSTALLING,
      installOutput: manyLines,
    });

    const result = await service.getFailureLogs({
      appId: 'app-123',
      since: '2026-04-20T09:00:00Z',
      lines: 10,
    });

    expect(result.total).toBe(10);
    expect(result.logs[0]!.message).toContain('line 590');
  });
});

describe('shouldUseAgentImportLogs', () => {
  it('uses agent logs for validation failures', () => {
    expect(
      shouldUseAgentImportLogs({
        logs: [{ timestamp: 't', source: 'stderr', message: '[agent/import:validation] err', level: 'error' }],
        total: 1,
        source: 'import_job',
        errorStage: 'validating',
      })
    ).toBe(true);
  });

  it('uses agent logs for install and build failures', () => {
    expect(
      shouldUseAgentImportLogs({
        logs: [{ timestamp: 't', source: 'stderr', message: 'build err', level: 'error' }],
        total: 1,
        source: 'import_job',
        errorStage: 'building',
      })
    ).toBe(true);
    expect(
      shouldUseAgentImportLogs({
        logs: [{ timestamp: 't', source: 'stderr', message: 'install err', level: 'error' }],
        total: 1,
        source: 'import_job',
        errorStage: 'installing',
      })
    ).toBe(true);
  });

  it('uses customer logs for runtime (restarting) failures', () => {
    expect(
      shouldUseAgentImportLogs({
        logs: [{ timestamp: 't', source: 'stderr', message: '[agent/import] restart failed', level: 'error' }],
        total: 1,
        source: 'import_job',
        errorStage: 'restarting',
      })
    ).toBe(false);
  });

  it('returns false when there is no import job failure', () => {
    expect(
      shouldUseAgentImportLogs({
        logs: [],
        total: 0,
        source: 'none',
      })
    ).toBe(false);
  });
});

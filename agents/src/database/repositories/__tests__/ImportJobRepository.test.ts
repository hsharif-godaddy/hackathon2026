import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ImportJobRepository } from '../ImportJobRepository.js';
import { ImportJobStatus } from '../../../types/import.js';

vi.mock('../../connection.js');

describe('ImportJobRepository', () => {
  let repository: ImportJobRepository;
  let mockDb: { prepare: ReturnType<typeof vi.fn> };
  let mockStatement: { get: ReturnType<typeof vi.fn> };

  const testAppId = 'app-abc123';
  const testJobId = 'job-xyz789';

  const mockFailedRow = {
    id: testJobId,
    app_id: testAppId,
    status: 'failed',
    source_type: 'zip',
    zip_file_name: 'app.zip',
    zip_file_size: 1024,
    git_url: null,
    git_branch: null,
    git_commit_hash: null,
    extracted_path: null,
    detected_package_manager: 'npm',
    has_build_script: 1,
    has_dev_script: 1,
    validation_errors: null,
    install_output: 'npm ERR! missing script',
    build_output: null,
    error_message: 'npm install failed',
    error_stage: 'installing',
    started_at: '2026-04-20T10:00:00.000Z',
    completed_at: '2026-04-20T10:05:00.000Z',
    created_at: '2026-04-20T10:00:00.000Z',
    updated_at: '2026-04-20T10:05:00.000Z',
  };

  const mockCompletedRow = {
    ...mockFailedRow,
    id: 'job-completed',
    status: 'completed',
    error_message: null,
    error_stage: null,
    install_output: null,
    completed_at: '2026-04-20T11:00:00.000Z',
    created_at: '2026-04-20T10:30:00.000Z',
    updated_at: '2026-04-20T11:00:00.000Z',
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockStatement = {
      get: vi.fn(),
    };

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStatement),
    };

    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(mockDb as never);

    repository = new ImportJobRepository();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('findRecentFailedByAppId', () => {
    it('returns the latest import job when that attempt failed within the since window', async () => {
      mockStatement.get.mockReturnValue(mockFailedRow);
      const since = new Date('2026-04-20T09:00:00.000Z');

      const result = await repository.findRecentFailedByAppId(testAppId, since);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(testJobId);
      expect(result!.status).toBe(ImportJobStatus.FAILED);
      expect(result!.errorMessage).toBe('npm install failed');
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC')
      );
      expect(mockStatement.get).toHaveBeenCalledWith(testAppId);
    });

    it('returns null when the latest import attempt completed successfully', async () => {
      mockStatement.get.mockReturnValue(mockCompletedRow);

      const result = await repository.findRecentFailedByAppId(
        testAppId,
        new Date('2026-04-20T09:00:00.000Z')
      );

      expect(result).toBeNull();
    });

    it('returns null when the latest failed import is older than since', async () => {
      mockStatement.get.mockReturnValue(mockFailedRow);

      const result = await repository.findRecentFailedByAppId(
        testAppId,
        new Date('2026-04-20T11:00:00.000Z')
      );

      expect(result).toBeNull();
    });

    it('returns null when the app has no import jobs', async () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = await repository.findRecentFailedByAppId(
        testAppId,
        new Date('2026-04-20T09:00:00.000Z')
      );

      expect(result).toBeNull();
    });
  });
});

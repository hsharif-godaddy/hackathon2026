/**
 * DbImportJobRepository Test Suite
 *
 * Tests for the DbImportJobRepository class covering:
 * - CRUD operations for database import jobs
 * - Progress tracking with throttling
 * - Concurrency guard (findActiveByAppId)
 * - Pagination (listByAppId)
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DbImportJobRepository } from '../DbImportJobRepository.js';
import { DbImportJobStatus } from '../../../types/db-import.js';

// Mock database connection
vi.mock('../../connection.js');
vi.mock('nanoid');

describe('DbImportJobRepository', () => {
  let repository: DbImportJobRepository;
  let mockDb: any;
  let mockStatement: any;

  const testAppId = 'app-abc123';
  const testJobId = 'job-xyz789';

  const mockDbRow = {
    id: testJobId,
    app_id: testAppId,
    status: 'pending',
    file_name: 'dump.sql',
    file_size: 15728640,
    tables_dropped: null,
    tables_imported: null,
    statements_executed: 0,
    statements_total: 12000,
    bytes_processed: 0,
    progress_updated_at: null,
    error_message: null,
    error_stage: null,
    error_code: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-03-17T10:00:00.000Z',
    updated_at: '2026-03-17T10:00:00.000Z',
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockStatement = {
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    };

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStatement),
    };

    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(mockDb);

    const { nanoid } = await import('nanoid');
    vi.mocked(nanoid).mockReturnValue(testJobId);

    repository = new DbImportJobRepository();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('create', () => {
    it('should create a new import job and return it', async () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = await repository.create({
        appId: testAppId,
        fileName: 'dump.sql',
        fileSize: 15728640,
        statementsTotal: 12000,
      });

      expect(result.id).toBe(testJobId);
      expect(result.appId).toBe(testAppId);
      expect(result.status).toBe(DbImportJobStatus.PENDING);
      expect(result.fileName).toBe('dump.sql');
      expect(result.fileSize).toBe(15728640);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO db_import_jobs'),
      );
      expect(mockStatement.run).toHaveBeenCalledWith(
        testJobId,
        testAppId,
        'dump.sql',
        15728640,
        12000,
      );
    });

    it('should handle create with minimal params', async () => {
      mockStatement.get.mockReturnValue({
        ...mockDbRow,
        file_name: null,
        file_size: null,
        statements_total: null,
      });

      const result = await repository.create({ appId: testAppId });

      expect(result.id).toBe(testJobId);
      expect(result.appId).toBe(testAppId);
      expect(result.fileName).toBeUndefined();
      expect(result.fileSize).toBeUndefined();
    });

    it('should throw if job cannot be retrieved after creation', async () => {
      mockStatement.get.mockReturnValue(undefined);

      await expect(
        repository.create({ appId: testAppId }),
      ).rejects.toThrow('Failed to retrieve created db import job');
    });
  });

  describe('findById', () => {
    it('should return job when found', async () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = await repository.findById(testJobId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(testJobId);
      expect(result!.appId).toBe(testAppId);
      expect(mockStatement.get).toHaveBeenCalledWith(testJobId);
    });

    it('should return null when not found', async () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });

    it('should correctly map all optional fields', async () => {
      const fullRow = {
        ...mockDbRow,
        status: 'importing',
        tables_dropped: 5,
        tables_imported: 8,
        statements_executed: 4500,
        bytes_processed: 8500000,
        progress_updated_at: '2026-03-17T10:01:00.000Z',
        error_message: null,
        error_stage: null,
        error_code: null,
        started_at: '2026-03-17T10:00:30.000Z',
        completed_at: null,
      };

      mockStatement.get.mockReturnValue(fullRow);

      const result = await repository.findById(testJobId);

      expect(result!.tablesDropped).toBe(5);
      expect(result!.tablesImported).toBe(8);
      expect(result!.statementsExecuted).toBe(4500);
      expect(result!.bytesProcessed).toBe(8500000);
      expect(result!.progressUpdatedAt).toEqual(new Date('2026-03-17T10:01:00.000Z'));
      expect(result!.startedAt).toEqual(new Date('2026-03-17T10:00:30.000Z'));
      expect(result!.completedAt).toBeUndefined();
    });
  });

  describe('findByAppId', () => {
    it('should return most recent job for app', async () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = await repository.findByAppId(testAppId);

      expect(result).not.toBeNull();
      expect(result!.appId).toBe(testAppId);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
      );
    });

    it('should return null when no jobs exist for app', async () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = await repository.findByAppId(testAppId);

      expect(result).toBeNull();
    });
  });

  describe('findActiveByAppId', () => {
    it('should return active job when one exists', async () => {
      mockStatement.get.mockReturnValue({
        ...mockDbRow,
        status: 'importing',
      });

      const result = await repository.findActiveByAppId(testAppId);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(DbImportJobStatus.IMPORTING);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("status NOT IN ('completed', 'failed')"),
      );
    });

    it('should return null when no active jobs', async () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = await repository.findActiveByAppId(testAppId);

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update specified fields', async () => {
      mockStatement.get.mockReturnValue({
        ...mockDbRow,
        status: 'validating',
        started_at: '2026-03-17T10:00:30.000Z',
      });

      const result = await repository.update(testJobId, {
        status: DbImportJobStatus.VALIDATING,
        startedAt: new Date('2026-03-17T10:00:30.000Z'),
      });

      expect(result.status).toBe(DbImportJobStatus.VALIDATING);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE db_import_jobs'),
      );
    });

    it('should skip update when no fields provided', async () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = await repository.update(testJobId, {});

      expect(result.id).toBe(testJobId);
      // Should call prepare for findById, not for update
      expect(mockDb.prepare).toHaveBeenCalledTimes(1);
    });

    it('should throw if job not found after update', async () => {
      mockStatement.get.mockReturnValue(undefined);

      await expect(
        repository.update(testJobId, { status: DbImportJobStatus.VALIDATING }),
      ).rejects.toThrow('DB import job not found after update');
    });
  });

  describe('updateProgress', () => {
    it('should write when statement count hits interval', async () => {
      const lastWriteTime = Date.now() - 1000;

      const result = await repository.updateProgress(
        testJobId,
        500, // multiple of 500
        5000000,
        lastWriteTime,
      );

      expect(result.written).toBe(true);
      expect(result.writeTime).toBeGreaterThan(lastWriteTime);
      expect(mockStatement.run).toHaveBeenCalled();
    });

    it('should write when time interval exceeded', async () => {
      const lastWriteTime = Date.now() - 6000; // >5s ago

      const result = await repository.updateProgress(
        testJobId,
        123, // not a multiple of 500
        1000000,
        lastWriteTime,
      );

      expect(result.written).toBe(true);
    });

    it('should skip write when neither condition met', async () => {
      const lastWriteTime = Date.now() - 1000; // <5s ago

      const result = await repository.updateProgress(
        testJobId,
        123, // not a multiple of 500
        1000000,
        lastWriteTime,
      );

      expect(result.written).toBe(false);
      expect(result.writeTime).toBe(lastWriteTime);
      expect(mockStatement.run).not.toHaveBeenCalled();
    });
  });

  describe('markFailed', () => {
    it('should update status to failed with error details', async () => {
      mockStatement.get.mockReturnValue({
        ...mockDbRow,
        status: 'failed',
        error_message: 'Connection lost',
        error_stage: 'importing',
        error_code: 'CONNECTION_LOST',
        completed_at: '2026-03-17T10:01:00.000Z',
      });

      const result = await repository.markFailed(
        testJobId,
        'Connection lost',
        'importing',
        'CONNECTION_LOST',
      );

      expect(result.status).toBe(DbImportJobStatus.FAILED);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE db_import_jobs'),
      );
    });

    it('should work without error code', async () => {
      mockStatement.get.mockReturnValue({
        ...mockDbRow,
        status: 'failed',
        error_message: 'Unknown error',
        error_stage: 'validating',
        completed_at: '2026-03-17T10:01:00.000Z',
      });

      const result = await repository.markFailed(
        testJobId,
        'Unknown error',
        'validating',
      );

      expect(result.status).toBe(DbImportJobStatus.FAILED);
    });
  });

  describe('markCompleted', () => {
    it('should update status to completed with tables count', async () => {
      mockStatement.get.mockReturnValue({
        ...mockDbRow,
        status: 'completed',
        tables_imported: 12,
        completed_at: '2026-03-17T10:02:00.000Z',
      });

      const result = await repository.markCompleted(testJobId, 12);

      expect(result.status).toBe(DbImportJobStatus.COMPLETED);
      expect(result.tablesImported).toBe(12);
    });

    it('should work without tables count', async () => {
      mockStatement.get.mockReturnValue({
        ...mockDbRow,
        status: 'completed',
        completed_at: '2026-03-17T10:02:00.000Z',
      });

      const result = await repository.markCompleted(testJobId);

      expect(result.status).toBe(DbImportJobStatus.COMPLETED);
    });
  });

  describe('listByAppId', () => {
    it('should return paginated results', async () => {
      mockStatement.get.mockReturnValue({ total: 25 });
      mockStatement.all.mockReturnValue([mockDbRow]);

      const result = await repository.listByAppId(testAppId, 1, 10);

      expect(result.total).toBe(25);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe(testJobId);
    });

    it('should calculate correct offset for page 2', async () => {
      mockStatement.get.mockReturnValue({ total: 25 });
      mockStatement.all.mockReturnValue([]);

      await repository.listByAppId(testAppId, 2, 10);

      // Second prepare call is for the data query
      expect(mockStatement.all).toHaveBeenCalledWith(testAppId, 10, 10);
    });

    it('should return empty results when no jobs', async () => {
      mockStatement.get.mockReturnValue({ total: 0 });
      mockStatement.all.mockReturnValue([]);

      const result = await repository.listByAppId(testAppId);

      expect(result.total).toBe(0);
      expect(result.jobs).toHaveLength(0);
    });
  });
});

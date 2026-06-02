/**
 * DatabaseImportService Test Suite
 *
 * Tests for the database import orchestration service covering:
 * - Each pipeline stage (validate, drop, import, complete)
 * - Connection failures
 * - SQL execution errors
 * - Timeout handling
 * - Concurrency guard
 * - Progress tracking
 * - Temp file cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseImportService } from '../DatabaseImportService.js';
import { DbImportJobStatus, DbImportErrorCode } from '../../types/db-import.js';

// Mock external modules
vi.mock('node:fs', () => ({
  createReadStream: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));
vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('mysql2/promise');
vi.mock('../SqlStatementSplitter.js');

describe('DatabaseImportService', () => {
  let service: DatabaseImportService;
  let mockDbImportJobRepo: any;
  let mockAppRepo: any;
  let mockMysqlUtils: any;
  let mockConnection: any;

  const testAppId = 'app-abc123';
  const testJobId = 'job-xyz789';
  const testFilePath = '/tmp/airo-db-imports/app-abc123/test.sql';
  const testFileName = 'dump.sql';
  const testFileSize = 15728640;

  const mockJob = {
    id: testJobId,
    appId: testAppId,
    status: DbImportJobStatus.PENDING,
    fileName: testFileName,
    fileSize: testFileSize,
    statementsExecuted: 0,
    bytesProcessed: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockApp = {
    id: testAppId,
    name: 'test-app',
    path: '/tmp/test',
    port: 5000,
    status: 'created',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCredentials = {
    host: 'localhost',
    port: 3306,
    database: 'testdb',
    user: 'testuser',
    password: 'testpass',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Mock DbImportJobRepository
    mockDbImportJobRepo = {
      create: vi.fn().mockResolvedValue(mockJob),
      createIfNoActiveJob: vi.fn().mockReturnValue(mockJob),
      findById: vi.fn().mockResolvedValue(mockJob),
      findActiveByAppId: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(mockJob),
      updateProgress: vi.fn().mockResolvedValue({ written: false, writeTime: Date.now() }),
      markFailed: vi.fn().mockResolvedValue({ ...mockJob, status: DbImportJobStatus.FAILED }),
      markCompleted: vi.fn().mockResolvedValue({ ...mockJob, status: DbImportJobStatus.COMPLETED }),
    };

    // Mock AppRepository
    mockAppRepo = {
      findById: vi.fn().mockReturnValue(mockApp),
    };

    // Mock MySQL connection
    mockConnection = {
      query: vi.fn().mockResolvedValue([[], []]),
      release: vi.fn(),
      destroy: vi.fn(),
    };

    // Mock MySQLUtils
    mockMysqlUtils = {
      loadCredentialsFromApp: vi.fn().mockResolvedValue(mockCredentials),
      createConnection: vi.fn().mockResolvedValue(mockConnection),
    };


    // Mock SqlStatementSplitter
    const { SqlStatementSplitter } = await import('../SqlStatementSplitter.js');
    vi.mocked(SqlStatementSplitter.estimateStatementCount).mockResolvedValue(100);
    vi.mocked(SqlStatementSplitter).mockImplementation(function () { return ({
      splitStatements: vi.fn().mockReturnValue([]),
      flush: vi.fn().mockReturnValue([]),
      reset: vi.fn(),
    }) as any; });

    // Mock createReadStream to return an async iterable
    const { createReadStream } = await import('node:fs');
    vi.mocked(createReadStream).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield 'SELECT 1;';
      },
    } as any);

    service = new DatabaseImportService(mockDbImportJobRepo, mockAppRepo, mockMysqlUtils);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  describe('startImport', () => {
    it('should create a job and return it immediately', async () => {
      const result = await service.startImport(
        testAppId, testFilePath, testFileName, testFileSize,
      );

      expect(result.id).toBe(testJobId);
      expect(result.status).toBe(DbImportJobStatus.PENDING);
      expect(mockDbImportJobRepo.createIfNoActiveJob).toHaveBeenCalledWith({
        appId: testAppId,
        fileName: testFileName,
        fileSize: testFileSize,
        statementsTotal: 100,
      });
    });

    it('should estimate statement count', async () => {
      const { SqlStatementSplitter } = await import('../SqlStatementSplitter.js');

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);

      expect(SqlStatementSplitter.estimateStatementCount).toHaveBeenCalledWith(testFilePath);
    });

    it('should proceed even if statement estimation fails', async () => {
      const { SqlStatementSplitter } = await import('../SqlStatementSplitter.js');
      vi.mocked(SqlStatementSplitter.estimateStatementCount).mockRejectedValue(new Error('fail'));

      const result = await service.startImport(
        testAppId, testFilePath, testFileName, testFileSize,
      );

      expect(result.id).toBe(testJobId);
      expect(mockDbImportJobRepo.createIfNoActiveJob).toHaveBeenCalledWith(
        expect.objectContaining({ statementsTotal: undefined }),
      );
    });
  });

  describe('processImport — validation stage', () => {
    it('should fail if app not found', async () => {
      mockAppRepo.findById.mockReturnValue(null);

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);

      // Wait for background processing
      await vi.advanceTimersByTimeAsync(100);

      expect(mockDbImportJobRepo.markFailed).toHaveBeenCalledWith(
        testJobId,
        'App not found',
        'validating',
        DbImportErrorCode.DB_CREDENTIALS_NOT_FOUND,
      );
    });

    it('should fail if credentials cannot be loaded', async () => {
      mockMysqlUtils.loadCredentialsFromApp.mockRejectedValue(
        new Error('No config.json found'),
      );

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);
      await vi.advanceTimersByTimeAsync(100);

      expect(mockDbImportJobRepo.markFailed).toHaveBeenCalledWith(
        testJobId,
        'No config.json found',
        'validating',
        DbImportErrorCode.DB_CREDENTIALS_NOT_FOUND,
      );
    });

    it('should fail if MySQL connection fails', async () => {
      mockMysqlUtils.createConnection.mockRejectedValue(
        new Error('ECONNREFUSED'),
      );

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);
      await vi.advanceTimersByTimeAsync(100);

      expect(mockDbImportJobRepo.markFailed).toHaveBeenCalledWith(
        testJobId,
        'ECONNREFUSED',
        'validating',
        DbImportErrorCode.DB_CONNECTION_FAILED,
      );
    });
  });

  describe('processImport — drop tables stage', () => {
    it('should drop user tables and skip system tables', async () => {
      // SHOW TABLES returns mix of user and system tables
      mockConnection.query.mockImplementation(async function (sql: any) {
        const query = typeof sql === 'string' ? sql : sql.sql;
        if (query === 'SHOW TABLES') {
          return [[
            { 'Tables_in_testdb': 'users' },
            { 'Tables_in_testdb': 'posts' },
            { 'Tables_in_testdb': '__drizzle_migrations' },
          ], []];
        }
        return [[], []];
      });

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);
      await vi.advanceTimersByTimeAsync(100);

      // Should have called DROP for users and posts, not __drizzle_migrations
      const dropCalls = mockConnection.query.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].startsWith('DROP TABLE'),
      );
      expect(dropCalls).toHaveLength(2);
    });

    it('should fail with DROP_TABLES_FAILED on error', async () => {
      mockConnection.query.mockImplementation(async function (sql: any) {
        const query = typeof sql === 'string' ? sql : sql.sql;
        if (query === 'SHOW TABLES') {
          return [[{ 'Tables_in_testdb': 'users' }], []];
        }
        if (typeof query === 'string' && query.includes('DROP TABLE')) {
          throw new Error('Permission denied');
        }
        return [[], []];
      });

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);
      await vi.advanceTimersByTimeAsync(100);

      expect(mockDbImportJobRepo.markFailed).toHaveBeenCalledWith(
        testJobId,
        'Permission denied',
        'dropping_tables',
        DbImportErrorCode.DROP_TABLES_FAILED,
      );
    });
  });

  describe('processImport — importing stage', () => {
    beforeEach(() => {
      // Default: SHOW TABLES returns empty (no tables to drop)
      mockConnection.query.mockResolvedValue([[], []]);
    });

    it('should complete successfully with no errors', async () => {
      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);
      await vi.advanceTimersByTimeAsync(100);

      expect(mockDbImportJobRepo.markCompleted).toHaveBeenCalledWith(
        testJobId,
        expect.any(Number),
      );
    });

    it('should classify connection lost errors', async () => {
      const { SqlStatementSplitter } = await import('../SqlStatementSplitter.js');
      vi.mocked(SqlStatementSplitter).mockImplementation(function () { return ({
        splitStatements: vi.fn().mockReturnValue(['SELECT 1']),
        flush: vi.fn().mockReturnValue([]),
        reset: vi.fn(),
      }) as any; });

      mockConnection.query.mockImplementation(async function (sql: any) {
        const query = typeof sql === 'string' ? sql : sql.sql;
        if (query === 'SELECT 1') {
          throw new Error('Connection lost: The server closed the connection.');
        }
        return [[], []];
      });

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);
      await vi.advanceTimersByTimeAsync(100);

      expect(mockDbImportJobRepo.markFailed).toHaveBeenCalledWith(
        testJobId,
        expect.stringContaining('Connection lost'),
        'importing',
        DbImportErrorCode.CONNECTION_LOST,
      );
    });
  });

  describe('cleanup', () => {
    it('should delete temp file after successful import', async () => {
      vi.useRealTimers();
      mockConnection.query.mockResolvedValue([[], []]);

      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValue(true);

      const { rm } = await import('node:fs/promises');

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);

      // Poll until the mock is called (background processing)
      await vi.waitFor(() => {
        expect(rm).toHaveBeenCalledWith(testFilePath, { force: true });
      }, { timeout: 2000, interval: 50 });
    });

    it('should delete temp file after failed import', async () => {
      vi.useRealTimers();
      mockAppRepo.findById.mockReturnValue(null);

      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValue(true);

      const { rm } = await import('node:fs/promises');

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);

      await vi.waitFor(() => {
        expect(rm).toHaveBeenCalledWith(testFilePath, { force: true });
      }, { timeout: 2000, interval: 50 });
    });

    it('should close MySQL connection after import', async () => {
      vi.useRealTimers();
      mockConnection.query.mockResolvedValue([[], []]);

      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValue(true);

      await service.startImport(testAppId, testFilePath, testFileName, testFileSize);

      await vi.waitFor(() => {
        expect(mockConnection.release).toHaveBeenCalled();
      }, { timeout: 2000, interval: 50 });
    });
  });

  describe('ensureTempDir', () => {
    it('should create temp directory', async () => {
      const { mkdir } = await import('node:fs/promises');

      await DatabaseImportService.ensureTempDir();

      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining('airo-db-imports'),
        { recursive: true },
      );
    });
  });
});

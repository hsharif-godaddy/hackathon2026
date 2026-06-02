/**
 * Database Import Routes Test Suite
 *
 * Tests for the db-import route handlers covering:
 * - Upload validation (no file, wrong extension, too large, empty)
 * - 202 response on success
 * - 409 conflict for concurrent imports
 * - 404 app not found
 * - 403 feature disabled
 * - GET status (found, not found)
 * - GET list (pagination)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Use vi.hoisted so mock fns are available in vi.mock() factories
const {
  mockFindById,
  mockFindActiveByAppId,
  mockDbImportFindById,
  mockListByAppId,
  mockStartImport,
} = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockFindActiveByAppId: vi.fn(),
  mockDbImportFindById: vi.fn(),
  mockListByAppId: vi.fn(),
  mockStartImport: vi.fn(),
}));

// Mock app-ownership middleware
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn(function (_req: any, _res: any, next: any) { return next(); }),
}));

// Mock repositories
vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: mockFindById,
  }; }),
}));

vi.mock('../../../database/repositories/DbImportJobRepository.js', () => ({
  DbImportJobRepository: vi.fn().mockImplementation(function () { return {
    findActiveByAppId: mockFindActiveByAppId,
    findById: mockDbImportFindById,
    listByAppId: mockListByAppId,
  }; }),
}));

// Mock DatabaseImportService
vi.mock('../../../services/DatabaseImportService.js', () => ({
  DatabaseImportService: vi.fn().mockImplementation(function () { return {
    startImport: mockStartImport,
  }; }),
}));

vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
}));

// Ensure the temp upload dir exists for multer disk storage
import { mkdirSync, existsSync } from 'node:fs';
const TEMP_DIR = '/tmp/airo-db-imports';
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

// Import after mocks
import dbImportRouter from '../db-import.js';
import { DbImportJobStatus, DbImportConflictError } from '../../../types/db-import.js';

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(dbImportRouter);
  return app;
};

const mockApp = {
  id: 'test-app-id',
  name: 'test-app',
  path: '/tmp/test',
  port: 5000,
  status: 'created',
};

const mockJob = {
  id: 'job-123',
  appId: 'test-app-id',
  status: DbImportJobStatus.PENDING,
  fileName: 'dump.sql',
  fileSize: 1024,
  statementsExecuted: 0,
  bytesProcessed: 0,
  createdAt: new Date('2026-03-17T10:00:00.000Z'),
  updatedAt: new Date('2026-03-17T10:00:00.000Z'),
};

describe('db-import routes', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockReturnValue(mockApp);
    app = createTestApp();
  });

  describe('POST /apps/:id/database/import', () => {
    it('should return 404 when app not found', async () => {
      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/database/import')
        .attach('sqlFile', Buffer.from('SELECT 1;'), 'dump.sql');

      expect(response.status).toBe(404);
    });

    it('should return 409 when import already in progress', async () => {
      mockStartImport.mockRejectedValue(new DbImportConflictError('job-123'));

      const response = await request(app)
        .post('/apps/test-app-id/database/import')
        .attach('sqlFile', Buffer.from('SELECT 1;'), 'dump.sql');

      expect(response.status).toBe(409);
      expect(response.body.existingJobId).toBe('job-123');
    });

    it('should return 400 when no file provided', async () => {
      const response = await request(app)
        .post('/apps/test-app-id/database/import');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('No file');
    });

    it('should return 400 for non-.sql files', async () => {
      const response = await request(app)
        .post('/apps/test-app-id/database/import')
        .attach('sqlFile', Buffer.from('data'), 'dump.txt');

      // multer rejects via fileFilter
      expect(response.status).toBe(400);
    });

    it('should return 400 for empty files', async () => {
      const response = await request(app)
        .post('/apps/test-app-id/database/import')
        .attach('sqlFile', Buffer.from(''), 'dump.sql');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('empty');
    });

    it('should return 202 on successful upload', async () => {
      mockStartImport.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/apps/test-app-id/database/import')
        .attach('sqlFile', Buffer.from('SELECT 1;'), 'dump.sql');

      expect(response.status).toBe(202);
      expect(response.body.success).toBe(true);
      expect(response.body.jobId).toBe('job-123');
      expect(response.body.status).toBe('pending');
    });
  });

  describe('GET /apps/:id/database/import/:jobId', () => {
    it('should return job status when found', async () => {
      mockDbImportFindById.mockResolvedValue(mockJob);

      const response = await request(app)
        .get('/apps/test-app-id/database/import/job-123');

      expect(response.status).toBe(200);
      expect(response.body.jobId).toBe('job-123');
      expect(response.body.status).toBe('pending');
      expect(response.body.progress).toBeDefined();
      expect(response.body.progress.stage).toBe('pending');
    });

    it('should return 404 when job not found', async () => {
      mockDbImportFindById.mockResolvedValue(null);

      const response = await request(app)
        .get('/apps/test-app-id/database/import/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should return 404 when job belongs to different app', async () => {
      mockDbImportFindById.mockResolvedValue({
        ...mockJob,
        appId: 'other-app-id',
      });

      const response = await request(app)
        .get('/apps/test-app-id/database/import/job-123');

      expect(response.status).toBe(404);
    });

    it('should include progress details for importing stage', async () => {
      mockDbImportFindById.mockResolvedValue({
        ...mockJob,
        status: DbImportJobStatus.IMPORTING,
        statementsExecuted: 4500,
        statementsTotal: 12000,
        bytesProcessed: 8500000,
        fileSize: 15728640,
      });

      const response = await request(app)
        .get('/apps/test-app-id/database/import/job-123');

      expect(response.status).toBe(200);
      expect(response.body.progress.statementsExecuted).toBe(4500);
      expect(response.body.progress.statementsTotal).toBe(12000);
      expect(response.body.progress.bytesProcessed).toBe(8500000);
      expect(response.body.progress.bytesTotal).toBe(15728640);
    });

    it('should include error details for failed jobs', async () => {
      mockDbImportFindById.mockResolvedValue({
        ...mockJob,
        status: DbImportJobStatus.FAILED,
        errorStage: 'importing',
        errorCode: 'SQL_EXECUTION_FAILED',
        completedAt: new Date('2026-03-17T10:01:00.000Z'),
      });

      const response = await request(app)
        .get('/apps/test-app-id/database/import/job-123');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('failed');
      expect(response.body.errorStage).toBe('importing');
      expect(response.body.errorCode).toBe('SQL_EXECUTION_FAILED');
    });
  });

  describe('GET /apps/:id/database/import', () => {
    it('should return paginated list of jobs', async () => {
      mockListByAppId.mockResolvedValue({
        jobs: [mockJob],
        total: 5,
      });

      const response = await request(app)
        .get('/apps/test-app-id/database/import?page=1&limit=10');

      expect(response.status).toBe(200);
      expect(response.body.jobs).toHaveLength(1);
      expect(response.body.total).toBe(5);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(10);
    });

    it('should use default pagination values', async () => {
      mockListByAppId.mockResolvedValue({
        jobs: [],
        total: 0,
      });

      const response = await request(app)
        .get('/apps/test-app-id/database/import');

      expect(response.status).toBe(200);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(10);
    });

    it('should cap limit at 100', async () => {
      mockListByAppId.mockResolvedValue({
        jobs: [],
        total: 0,
      });

      await request(app)
        .get('/apps/test-app-id/database/import?limit=500');

      expect(mockListByAppId).toHaveBeenCalledWith('test-app-id', 1, 100);
    });
  });
});

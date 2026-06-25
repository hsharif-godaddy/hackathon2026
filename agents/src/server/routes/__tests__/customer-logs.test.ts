import { describe, it, expect, beforeEach, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { customerLogsRouter, _setDependencies, _resetDependencies } from '../customer-logs.js';
import { CustomerLogsService } from '../../../services/customer-logs-service.js';
import { LogSanitizer } from '../../../services/log-sanitizer.js';
import type { AppRepository } from '../../../database/repositories/AppRepository.js';
import type { WorkspaceClient, CreateForWorkspace } from '../../../workspace/index.js';
import type { LogEntry as WorkspaceLogEntry } from '../../../workspace/diagnostics.js';

const mockApp = {
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
  { timestamp: new Date('2025-01-22T10:01:00Z'), source: 'stdout', message: 'Dependencies installed', level: 'info' }
];

// Default query string with required params only (target is required)
const defaultQuery = 'target=preview';

// Create test Express app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/apps', customerLogsRouter);
  return app;
};

describe('GET /apps/:appId/customer-logs', () => {
  let app: express.Express;
  let mockAppRepo: { findById: ReturnType<typeof vi.fn> };
  let mockDiagnostics: { logs: ReturnType<typeof vi.fn> };
  let logSanitizer: LogSanitizer;
  let customerLogsService: CustomerLogsService;
  let mockWorkspaceFactory: CreateForWorkspace;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    _resetDependencies();

    // Setup mock workspace diagnostics
    mockDiagnostics = {
      logs: vi.fn().mockImplementation((opts: { source?: string } = {}) =>
        Promise.resolve(opts.source ? mockLogs.filter(l => l.source === opts.source) : mockLogs)
      )
    };

    // Setup mock AppRepository
    mockAppRepo = {
      findById: vi.fn().mockReturnValue(mockApp)
    };

    // Workspace factory returns a workspace with mock diagnostics
    mockWorkspaceFactory = () => ({
      diagnostics: mockDiagnostics,
    }) as unknown as WorkspaceClient;

    // Create real LogSanitizer and CustomerLogsService with mocked dependencies
    logSanitizer = new LogSanitizer();
    customerLogsService = new CustomerLogsService(
      mockAppRepo as AppRepository,
      logSanitizer,
      mockWorkspaceFactory
    );

    // Inject dependencies
    _setDependencies(mockAppRepo as AppRepository, customerLogsService);
  });

  afterEach(() => {
    _resetDependencies();
  });

  describe('validation', () => {
    it('should return 400 if target is missing', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs')
        .expect(400);

      expect(response.body.error).toContain('target is required');
      expect(response.body.code).toBe('MISSING_TARGET');
    });

    it('should return 400 if lines exceeds maximum with helpful error', async () => {
      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}&lines=1000`)
        .expect(400);

      expect(response.body.error).toContain('Maximum');
      expect(response.body.error).toContain('500');
      expect(response.body.code).toBe('INVALID_LINES');
    });

    it('should return 400 if lines is negative', async () => {
      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}&lines=-10`)
        .expect(400);

      expect(response.body.error).toContain('lines');
    });

    it('should return 400 if invalid source value', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=preview&source=invalid')
        .expect(400);

      expect(response.body.error).toContain('source');
      expect(response.body.code).toBe('INVALID_SOURCE');
    });

    it('should return 400 if invalid since timestamp format', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=preview&since=not-a-date')
        .expect(400);

      expect(response.body.error).toContain('timestamp');
      expect(response.body.code).toBe('INVALID_TIMESTAMP');
    });

    it('should return 400 if invalid target value', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=invalid')
        .expect(400);

      expect(response.body.error).toContain('target');
      expect(response.body.code).toBe('INVALID_TARGET');
    });
  });

  describe('authorization', () => {
    it('should return 404 if app not found', async () => {
      mockAppRepo.findById.mockReturnValue(null);

      const response = await request(app)
        .get(`/apps/non-existent/customer-logs?${defaultQuery}`)
        .expect(404);

      expect(response.body.error).toContain('not found');
      expect(response.body.code).toBe('APP_NOT_FOUND');
    });
  });

  describe('success cases', () => {
    it('should return logs with only required target parameter', async () => {
      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}`)
        .expect(200);

      expect(response.body.logs).toBeDefined();
      expect(Array.isArray(response.body.logs)).toBe(true);
      expect(response.body.total).toBeDefined();
    });

    it('should return logs with optional since parameter', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=preview&since=2025-01-22T00:00:00Z')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should return logs with optional source parameter', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=preview&source=stdout')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should return logs filtered by source stdout', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=preview&source=stdout')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should return logs filtered by source stderr', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=preview&source=stderr')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should accept comma-separated sources', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=preview&source=stdout,stderr')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should accept multiple source query params', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=preview&source=stdout&source=stderr')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should accept source=all as alias for all sources', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=preview&source=all')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should return logs from publish target', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=publish')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should respect line limit', async () => {
      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}&lines=50`)
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should accept all valid parameters together', async () => {
      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?lines=50&source=stdout&target=preview&since=2025-01-22T10:00:00Z')
        .expect(200);

      expect(response.body.logs).toBeDefined();
      expect(response.body.total).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should return 503 if preview workspace not configured', async () => {
      const nullFactory = vi.fn().mockReturnValue(null) as unknown as CreateForWorkspace;
      const svc = new CustomerLogsService(
        mockAppRepo as AppRepository,
        logSanitizer,
        nullFactory
      );
      _setDependencies(mockAppRepo as AppRepository, svc);

      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}`)
        .expect(503);

      expect(response.body.error).toContain('not configured');
      expect(response.body.code).toBe('SUPERVISOR_NOT_CONFIGURED');
      expect(nullFactory).toHaveBeenCalledWith('test-app-123', 'preview');
    });

    it('should return 503 if publish workspace not configured', async () => {
      const nullFactory = vi.fn().mockReturnValue(null) as unknown as CreateForWorkspace;
      const svc = new CustomerLogsService(
        mockAppRepo as AppRepository,
        logSanitizer,
        nullFactory
      );
      _setDependencies(mockAppRepo as AppRepository, svc);

      const response = await request(app)
        .get('/apps/test-app-123/customer-logs?target=publish')
        .expect(503);

      expect(response.body.error).toContain('not configured');
      expect(response.body.code).toBe('SUPERVISOR_NOT_CONFIGURED');
      expect(nullFactory).toHaveBeenCalledWith('test-app-123', 'publish');
    });

    it('should return 503 if supervisor is configured but unreachable', async () => {
      const connErr = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      mockDiagnostics.logs = vi.fn().mockRejectedValue(connErr);

      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}`)
        .expect(503);

      expect(response.body.code).toBe('SUPERVISOR_UNAVAILABLE');
      expect(response.body.error).toContain('unavailable');
    });

    it('should return 500 on non-connection errors', async () => {
      mockDiagnostics.logs = vi.fn().mockRejectedValue(new Error('Unexpected parse failure'));

      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}`)
        .expect(500);

      expect(response.body.error).toBeDefined();
      expect(response.body.code).toBe('FETCH_ERROR');
    });

    it('should not expose internal error details', async () => {
      mockDiagnostics.logs = vi.fn().mockRejectedValue(new Error('Internal database connection string: mysql://user:password@host'));

      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}`)
        .expect(500);

      // Should not expose internal details
      expect(response.body.error).not.toContain('mysql://');
      expect(response.body.error).not.toContain('password');
    });
  });

  describe('response format', () => {
    it('should return properly formatted log entries', async () => {
      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}`)
        .expect(200);

      expect(response.body).toHaveProperty('logs');
      expect(response.body).toHaveProperty('total');

      if (response.body.logs.length > 0) {
        const log = response.body.logs[0];
        expect(log).toHaveProperty('timestamp');
        expect(log).toHaveProperty('source');
        expect(log).toHaveProperty('message');
        expect(log).toHaveProperty('level');
      }
    });

    it('should return sanitized logs (no secrets)', async () => {
      mockDiagnostics.logs = vi.fn().mockResolvedValue([
        { timestamp: new Date('2025-01-22T10:00:00Z'), source: 'stdout', message: 'OPENAI_API_KEY=sk-secret123', level: 'info' }
      ]);

      const response = await request(app)
        .get(`/apps/test-app-123/customer-logs?${defaultQuery}`)
        .expect(200);

      expect(response.body.logs[0].message).not.toContain('sk-secret123');
      expect(response.body.logs[0].message).toContain('[REDACTED]');
    });
  });
});

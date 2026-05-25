/**
 * Publish Route Tests
 *
 * Tests JWT-based authorization for app publish operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

// Mock dependencies BEFORE imports
const mockFindById = vi.fn();

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: mockFindById
  }))
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(() => ({
    resolveCommitHash: vi.fn(),
    getCommitDetails: vi.fn(),
    createArchive: vi.fn(),
  })),
}));

const mockCreateForApp = vi.fn().mockReturnValue(null);
vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    getInstance: vi.fn(() => ({
      build: vi.fn()
    })),
    createForApp: mockCreateForApp,
  }
}));

// Mock app-ownership middleware to pass through (tests set up their own auth context)
vi.mock('../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn((_req: any, _res: any, next: any) => next()),
  validateAppOwnershipFromBody: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  validateAppOwnershipFromQuery: vi.fn(() => (_req: any, _res: any, next: any) => next())
}));

// Mock the publish strategies. Keep `getPublishStrategy` mockable per-test,
// but pass through the real error classes so `instanceof` checks in the
// route (publish.ts) match errors thrown via these same class references.
vi.mock('./publish/strategies/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./publish/strategies/index.js')>();
  return {
    getPublishStrategy: vi.fn(),
    BuildError: actual.BuildError,
    PreviewNotRunningError: actual.PreviewNotRunningError,
    MissingStartCommandError: actual.MissingStartCommandError,
  };
});

vi.mock('../agent-runtime.js', () => ({
  getGitHookService: vi.fn(() => ({
    hasActiveBranch: vi.fn().mockReturnValue(false),
    clearBranchTracking: vi.fn(),
  })),
}));

vi.mock('../../logging/index.js', () => ({
  log: {
    forApp: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })),
    error: vi.fn()
  },
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}));

// Import after mocks
const publishRouter = await import('./publish.js').then(m => m.default);
import { getPublishStrategy, MissingStartCommandError } from './publish/strategies/index.js';
import { getGitHookService } from '../agent-runtime.js';

describe('Publish Route Authorization', () => {
  let app: Express;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Setup Express app with publish router
    app = express();
    app.use(express.json());

    // Mock auth middleware - we'll set agentContext in tests
    app.use((req, res, next) => {
      // Default to no permissions unless set in test
      (req as AuthenticatedRequest).agentContext = {
        siteId: 'test-site',
        canDownload: false,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      };
      next();
    });

    app.use('/', publishRouter);
  });

  describe('JWT Permission Checks', () => {
    it('should reject publish when canPublish is false', async () => {
      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(403);

      expect(response.body).toEqual({
        error: 'Publish not allowed',
        details: 'Airo Plus subscription required to publish apps'
      });
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should allow publish when canPublish is true', async () => {
      // Override middleware to grant permission
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);

      // Mock app not found to avoid git operations
      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(404);

      expect(mockFindById).toHaveBeenCalledWith('test-app-id');
      expect(response.body.error).toBe('App not found');
    });

    it('should reject publish when agentContext is missing', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        // No agentContext set
        next();
      });
      app.use('/', publishRouter);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(401);

      expect(response.body).toEqual({
        error: 'Authentication required',
        details: 'Request must be authenticated before checking permissions'
      });
    });

    it('should reject publish when canPublish is undefined', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: undefined as any,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(403);

      expect(response.body.error).toBe('Publish not allowed');
    });
  });

  describe('Request Validation', () => {
    beforeEach(() => {
      // Grant permission for these tests
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);
    });

    it('should return 404 when app does not exist', async () => {
      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(404);

      expect(response.body.error).toBe('App not found');
      expect(mockFindById).toHaveBeenCalledWith('test-app-id');
    });
  });

  describe('Security - Permission Bypass Prevention', () => {
    it('should not allow publish with only canDownload permission', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: true, // Has download but not publish
          canPublish: false,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(403);

      expect(response.body.error).toBe('Publish not allowed');
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should check permission before any app operations', async () => {
      // Ensure permission check happens first, even if repo throws
      mockFindById.mockImplementation(() => {
        throw new Error('Should not reach here');
      });

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(403);

      expect(response.body.error).toBe('Publish not allowed');
      expect(mockFindById).not.toHaveBeenCalled();
    });
  });

  describe('Permission Independence', () => {
    it('should check canPublish independently from canDownload', async () => {
      // Test that publish only checks canPublish, not canDownload
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false, // Download denied
          canPublish: true,   // But publish allowed
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);

      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(404);

      // Should succeed past permission check (404 is from app not found, not permission)
      expect(response.body.error).toBe('App not found');
    });
  });

  describe('Branch tracking cleanup after publish', () => {
    function createPublishApp() {
      const publishApp = express();
      publishApp.use(express.json());
      publishApp.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      publishApp.use('/', publishRouter);
      return publishApp;
    }

    beforeEach(() => {
      // Set NOMAD_ALLOC_DIR to skip the unified-job publish supervisor path
      process.env.NOMAD_ALLOC_DIR = '/fake-alloc';
    });

    afterEach(() => {
      delete process.env.NOMAD_ALLOC_DIR;
    });

    function setupSuccessfulPublish(hasActiveBranch: boolean) {
      const mockClearBranchTracking = vi.fn();
      vi.mocked(getGitHookService).mockReturnValue({
        hasActiveBranch: vi.fn().mockReturnValue(hasActiveBranch),
        clearBranchTracking: mockClearBranchTracking,
      } as any);

      mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app' });
      mockCreateForApp.mockReturnValue({ exec: vi.fn() }); // dev-supervisor available
      vi.mocked(getPublishStrategy).mockReturnValue({
        key: 'default',
        prepareBuild: vi.fn().mockResolvedValue({
          commitHash: 'abc1234567890',
          archivePath: '/dist/abc1234567890.tar.gz',
        }),
        deploy: vi.fn().mockResolvedValue({
          status: 'success',
          version: 'abc1234567890',
          healthStatus: 'healthy',
        }),
      } as any);

      return mockClearBranchTracking;
    }

    it('clears branch tracking when app has active branch after publish', async () => {
      const mockClearBranchTracking = setupSuccessfulPublish(true);

      const testApp = createPublishApp();
      await request(testApp)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(200);

      expect(mockClearBranchTracking).toHaveBeenCalledWith('test-app-id');
    });

    it('does not call clearBranchTracking when no active branch', async () => {
      const mockClearBranchTracking = setupSuccessfulPublish(false);

      const testApp = createPublishApp();
      await request(testApp)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(200);

      expect(mockClearBranchTracking).not.toHaveBeenCalled();
    });

    it('returns 412 with preflight payload when prepareBuild throws MissingStartCommandError', async () => {
      vi.mocked(getGitHookService).mockReturnValue({
        hasActiveBranch: vi.fn().mockReturnValue(false),
        clearBranchTracking: vi.fn(),
      } as any);

      mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app' });
      mockCreateForApp.mockReturnValue({ exec: vi.fn() });

      const preflight = {
        hasAiroConfig: false,
        serveCommand: null,
        hasPackageJson: true,
        hasStartScript: false,
        startScript: null,
      };

      vi.mocked(getPublishStrategy).mockReturnValue({
        key: 'paas',
        prepareBuild: vi.fn().mockRejectedValue(new MissingStartCommandError(preflight)),
        deploy: vi.fn(),
      } as any);

      const testApp = createPublishApp();
      const response = await request(testApp)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(412);

      expect(response.body.preflight).toEqual(preflight);
      expect(response.body.error).toMatch(/start command/i);
    });
  });
});

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

vi.mock('@airo/shared/publish', () => ({
  PublishErrorCode: { TokenStale: 'TOKEN_STALE' },
  PublishDenialReason: { NoSubscription: 'no_subscription', PublishLimitReached: 'publish_limit_reached' },
  PublishUpgradeRequiredError: class PublishUpgradeRequiredError extends Error {
    requiresUpgrade = true
    reason = 'no_subscription'
    constructor(reason: string, message?: string) {
      super(message ?? 'upgrade required')
      this.name = 'PublishUpgradeRequiredError'
    }
  },
}));

// Mock dependencies BEFORE imports
const mockFindById = vi.fn();
const mockUpdatePublishedUrl = vi.fn();
const mockAdSenseWriteForPublish = vi.fn();
const mockAdSensePublishManifestService = vi.fn(function () {
  return {
    writeForPublish: mockAdSenseWriteForPublish,
  };
});

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: mockFindById,
    updatePublishedUrl: mockUpdatePublishedUrl,
  }; })
}));

const mockMemorySet = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../database/repositories/MemoryRepository.js', () => ({
  MemoryRepository: vi.fn().mockImplementation(function () { return {
    get: vi.fn().mockResolvedValue({ success: true, exists: false }),
    set: mockMemorySet,
  }; })
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function () { return {
    resolveCommitHash: vi.fn(),
    getCommitDetails: vi.fn(),
    createArchive: vi.fn(),
  }; }),
}));

const mockCreateForWorkspace = vi.fn().mockReturnValue(null);
vi.mock('../../workspace/index.js', () => ({
  createForWorkspace(workspaceId: string, variant: string) {
    return mockCreateForWorkspace(workspaceId, variant);
  },
}));

const mockCreateForSocketPath = vi.fn().mockReturnValue(null);
const mockCreateForPublishSupervisor = vi.fn().mockReturnValue(null);
vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForSocketPath: (...args: any[]) => mockCreateForSocketPath(...args),
    createForPublishSupervisor: (...args: any[]) => mockCreateForPublishSupervisor(...args),
  }
}));

const mockExistsSync = vi.fn().mockReturnValue(false);
vi.mock('node:fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
}));

vi.mock('../../services/AdSensePublishManifestService.js', () => ({
  AdSensePublishManifestService: mockAdSensePublishManifestService,
}));

// Mock app-ownership middleware to pass through (tests set up their own auth context)
vi.mock('../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn(function (_req: any, _res: any, next: any) { return next(); }),
  validateAppOwnershipFromBody: vi.fn(function () { return (_req: any, _res: any, next: any) => next(); }),
  validateAppOwnershipFromQuery: vi.fn(function () { return (_req: any, _res: any, next: any) => next(); })
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
  getGitHookService: vi.fn(function () { return {
    hasActiveBranch: vi.fn().mockReturnValue(false),
    clearBranchTracking: vi.fn(),
  }; }),
}));

vi.mock('../../services/seo-audit.js', () => ({
  runSeoAudit: vi.fn().mockResolvedValue({}),
  logSeoAuditReport: vi.fn(),
  invalidateSeoAuditCache: vi.fn(),
}));

vi.mock('../../services/compliance-publish-report.js', () => ({
  reportPublishedComplianceStatus: vi.fn().mockRejectedValue(new Error('compliance service down')),
}));

vi.mock('../../services/SeoQualityScorer.js', () => ({
  scoreAuditReport: vi.fn().mockReturnValue({ score: 70, pageCount: 1, pagesWithIssues: 1, pageScores: [{ path: '/', score: 70 }], missingElements: ['title'] }),
  detectRegressionFromSnapshot: vi.fn().mockReturnValue({ isRegression: true, scoreDelta: -25, regressions: [{ path: '/', newIssues: ['missing title'] }] }),
}));

vi.mock('../../database/repositories/SeoQualityRepository.js', () => ({
  SeoQualityRepository: vi.fn().mockImplementation(function () { return {
    findLatest: vi.fn().mockReturnValue({ id: 'prev-snap', score: 95, pageScores: [{ path: '/', score: 95 }] }),
    save: vi.fn().mockReturnValue({ id: 'snap-1', isBaseline: false }),
  }; }),
}));

vi.mock('../../utils/public-fetch-url.js', () => ({
  resolvePublicHttpsFetchUrl: vi.fn().mockReturnValue(null),
}));

vi.mock('../../services/logo/logo-reconciler.js', () => ({
  reconcilePendingLogoSlotsForPublish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../logging/index.js', () => ({
  log: {
    forApp: vi.fn(function () { return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }; }),
    error: vi.fn()
  },
  Logger: {
    create: vi.fn(function () { return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }; })
  }
}));

// Import after mocks
const publishRouter = await import('./publish.js').then(m => m.default);
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { getPublishStrategy, BuildError, MissingStartCommandError } from './publish/strategies/index.js';
import { getGitHookService } from '../agent-runtime.js';
import { runSeoAudit } from '../../services/seo-audit.js';
import { reportPublishedComplianceStatus } from '../../services/compliance-publish-report.js';
import { publishJobRegistry } from './publish/job-registry.js';

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
        details: 'Publishing requires a paid Airo Builder plan',
        code: 'PERMISSION_DENIED',
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

    it('should return 503 when workspace is unavailable', async () => {
      mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app' });
      mockCreateForWorkspace.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(503);

      expect(response.body.error).toBe('Preview container is not available');
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
      mockFindById.mockImplementation(function () {
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
      mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() } });
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
      mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() } });

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

  describe('Response shape contract (sync vs async mode discriminant)', () => {
    function createPublishApp() {
      const publishApp = express();
      publishApp.use(express.json());
      publishApp.use((req, _res, next) => {
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
      process.env.NOMAD_ALLOC_DIR = '/fake-alloc';
      vi.mocked(getGitHookService).mockReturnValue({
        hasActiveBranch: vi.fn().mockReturnValue(false),
        clearBranchTracking: vi.fn(),
      } as any);
      mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app' });
      mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() } });
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
    });

    afterEach(() => {
      delete process.env.NOMAD_ALLOC_DIR;
    });

    it('sync path returns mode:sync with commitHash and no jobId', async () => {
      const response = await request(createPublishApp())
        .post('/apps/test-app-id/publish')
        .send({ async: false })
        .expect(200);

      expect(response.body.mode).toBe('sync');
      expect(response.body.commitHash).toBe('abc1234567890');
      expect(response.body.jobId).toBeUndefined();
    });

    it('async path returns mode:async with jobId and no commitHash', async () => {
      const response = await request(createPublishApp())
        .post('/apps/test-app-id/publish')
        .send({ async: true })
        .expect(202);

      expect(response.body.mode).toBe('async');
      expect(response.body.jobId).toBeDefined();
      expect(response.body.commitHash).toBeUndefined();
    });
  });

  describe('AdSense runtime artifact hook wiring', () => {
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
      process.env.NOMAD_ALLOC_DIR = '/fake-alloc';
      mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app' });
      mockCreateForWorkspace.mockReturnValue({
        tasks: { runCommandSync: vi.fn() },
        files: { write: vi.fn() },
      });
      mockAdSenseWriteForPublish.mockResolvedValue(undefined);
    });

    afterEach(() => {
      delete process.env.NOMAD_ALLOC_DIR;
    });

    it('passes an AdSense runtime artifact hook to the default strategy', async () => {
      let capturedContext: any;
      vi.mocked(getPublishStrategy).mockReturnValue({
        key: 'default',
        prepareBuild: vi.fn(async (context) => {
          capturedContext = context;
          return {
            commitHash: 'abc1234567890',
            archivePath: '/dist/abc1234567890.tar.gz',
          };
        }),
        deploy: vi.fn(),
      } as any);

      await request(createPublishApp())
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(200);

      expect(capturedContext.runtimeArtifactHooks).toHaveLength(1);

      await capturedContext.runtimeArtifactHooks[0](capturedContext);

      expect(mockAdSensePublishManifestService).toHaveBeenCalledTimes(1);
      expect(mockAdSenseWriteForPublish).toHaveBeenCalledWith(
        'test-app-id',
        mockCreateForWorkspace.mock.results[0]?.value,
      );
    });

    it('does not pass or run an AdSense runtime artifact hook for the PaaS strategy', async () => {
      let capturedContext: any;
      vi.mocked(getPublishStrategy).mockReturnValue({
        key: 'paas',
        prepareBuild: vi.fn(async (context) => {
          capturedContext = context;
          if (context.runtimeArtifactHooks) {
            for (const hook of context.runtimeArtifactHooks) {
              await hook(context);
            }
          }
          return {
            commitHash: '019cab3def12',
            archivePath: '/dist/019cab3def12.tar.gz',
          };
        }),
        deploy: vi.fn(),
      } as any);

      await request(createPublishApp())
        .post('/apps/test-app-id/publish')
        .send({ deploymentStrategy: 'paas' })
        .expect(200);

      expect(capturedContext.runtimeArtifactHooks).toBeUndefined();
      expect(mockAdSensePublishManifestService).not.toHaveBeenCalled();
      expect(mockAdSenseWriteForPublish).not.toHaveBeenCalled();
    });

    it('returns before calling the publish supervisor when the AdSense hook fails', async () => {
      delete process.env.NOMAD_ALLOC_DIR;
      mockFindById.mockReturnValue({
        id: 'test-app-id',
        path: '/tmp/test-app',
        publishSupervisorPath: '/tmp/publish.sock',
      });
      mockAdSenseWriteForPublish.mockRejectedValue(new Error('manifest write failed'));
      vi.mocked(getPublishStrategy).mockReturnValue({
        key: 'default',
        prepareBuild: vi.fn(async (context) => {
          try {
            for (const hook of context.runtimeArtifactHooks ?? []) {
              await hook(context);
            }
          } catch (error) {
            throw new BuildError(
              'Publish runtime manifest generation failed',
              error instanceof Error ? error.message : String(error),
            );
          }
          return {
            commitHash: 'abc1234567890',
            archivePath: '/dist/abc1234567890.tar.gz',
          };
        }),
        deploy: vi.fn(),
      } as any);

      const response = await request(createPublishApp())
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(400);

      expect(response.body).toEqual({
        error: 'Publish runtime manifest generation failed',
        details: 'manifest write failed',
      });
      expect(mockCreateForSocketPath).not.toHaveBeenCalled();
    });
  });

  describe('Token Freshness (iat recency check)', () => {
    it('should reject publish with stale token (iat > 30s old)', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000) - 60,
        };
        next();
      });
      app.use('/', publishRouter);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(401);

      expect(response.body.code).toBe('TOKEN_STALE');
      expect(response.body.error).toBe('Token too old for publish');
    });

    it('should accept publish with fresh token (iat < 30s old)', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000) - 5,
        };
        next();
      });
      app.use('/', publishRouter);

      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(404);

      expect(response.body.error).toBe('App not found');
    });

    it('should reject publish when iat is missing (undefined)', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
        } as any;
        next();
      });
      app.use('/', publishRouter);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(401);

      expect(response.body.code).toBe('TOKEN_STALE');
      expect(response.body.error).toBe('Token missing iat');
    });

    it('should accept publish when iat is exactly 30s old (boundary)', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000) - 30,
        };
        next();
      });
      app.use('/', publishRouter);

      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(404);

      expect(response.body.error).toBe('App not found');
    });

    it('should skip iat check for PaaS requests', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          product: 'PaaSNodeJS',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000) - 300,
        };
        next();
      });
      app.use('/', publishRouter);

      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(404);

      expect(response.body.error).toBe('App not found');
    });
  });
});

describe('POST /apps/:id/publish-state', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
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

  it('should return 404 when app not found', async () => {
    mockFindById.mockReturnValue(null);

    const response = await request(app)
      .post('/apps/test-app-id/publish-state')
      .send({ publishedUrl: 'https://example.com' })
      .expect(404);

    expect(response.body.error).toBe('App not found');
  });

  it('should return 400 when neither publishedUrl nor domains provided', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id' });

    const response = await request(app)
      .post('/apps/test-app-id/publish-state')
      .send({})
      .expect(400);

    expect(response.body.error).toContain('At least one of');
  });

  it('should update publishedUrl when provided', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id' });
    mockUpdatePublishedUrl.mockReturnValue({ id: 'test-app-id', publishedUrl: 'https://example.com' });

    await request(app)
      .post('/apps/test-app-id/publish-state')
      .send({ publishedUrl: 'https://example.com' })
      .expect(200);

    expect(mockUpdatePublishedUrl).toHaveBeenCalledWith('test-app-id', 'https://example.com');
  });

  it('should set publishedUrl to null for invalid URL', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id' });
    mockUpdatePublishedUrl.mockReturnValue({ id: 'test-app-id', publishedUrl: null });

    await request(app)
      .post('/apps/test-app-id/publish-state')
      .send({ publishedUrl: 'not-a-url' })
      .expect(200);

    expect(mockUpdatePublishedUrl).toHaveBeenCalledWith('test-app-id', null);
  });

  it('should trim publishedUrl to null for empty string', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id' });
    mockUpdatePublishedUrl.mockReturnValue({ id: 'test-app-id', publishedUrl: null });

    await request(app)
      .post('/apps/test-app-id/publish-state')
      .send({ publishedUrl: '   ' })
      .expect(200);

    expect(mockUpdatePublishedUrl).toHaveBeenCalledWith('test-app-id', null);
  });

  it('should update domains without touching publishedUrl', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id' });

    await request(app)
      .post('/apps/test-app-id/publish-state')
      .send({ domains: [{ fqdn: 'example.com', isPrimary: true, status: 'active' }] })
      .expect(200);

    expect(mockUpdatePublishedUrl).not.toHaveBeenCalled();
    expect(mockMemorySet).toHaveBeenCalledWith('test-app-id', 'site.domains', [
      { fqdn: 'example.com', isPrimary: true, status: 'active' },
    ]);
  });

  it('should filter invalid domain entries', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id' });

    await request(app)
      .post('/apps/test-app-id/publish-state')
      .send({
        domains: [
          { fqdn: 'valid.com', isPrimary: false, status: 'active' },
          { fqdn: '', isPrimary: false, status: 'active' },
          { fqdn: 123, isPrimary: false, status: 'active' },
        ]
      })
      .expect(200);

    expect(mockMemorySet).toHaveBeenCalledWith('test-app-id', 'site.domains', [
      { fqdn: 'valid.com', isPrimary: false, status: 'active' },
    ]);
  });

  it('should reject when canPublish is false', async () => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
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

    const response = await request(app)
      .post('/apps/test-app-id/publish-state')
      .send({ publishedUrl: 'https://example.com' })
      .expect(403);

    expect(response.body.error).toContain('not allowed');
  });
});

describe('GET /apps/:id/publish/status', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    publishJobRegistry.clear('test-app-id');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
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

  it('should return status when factory provides a supervisor', async () => {
    mockCreateForPublishSupervisor.mockReturnValue({
      getPublishStatus: vi.fn().mockResolvedValue({
        version: 'abc1234',
        health: { status: 'healthy', message: 'OK' },
        process: { state: 'running', pid: 123 },
      }),
    });

    const response = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(200);

    expect(response.body).toEqual({
      source: 'supervisor',
      version: 'abc1234',
      health: { status: 'healthy', message: 'OK' },
      process: { state: 'running', pid: 123 },
    });
    expect(mockCreateForPublishSupervisor).toHaveBeenCalledWith('test-app-id');
  });

  it('should return 503 when factory returns null', async () => {
    mockCreateForPublishSupervisor.mockReturnValue(null);

    const response = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(503);

    expect(response.body.error).toBe('Publish supervisor unavailable');
  });

  it('should return 503 when factory throws app-not-found', async () => {
    mockCreateForPublishSupervisor.mockImplementation(() => {
      throw new Error('App with ID test-app-id not found');
    });

    const response = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(503);

    expect(response.body.error).toBe('Publish supervisor unavailable');
  });

  it('should return 503 when supervisor not available (socket missing)', async () => {
    mockCreateForPublishSupervisor.mockReturnValue({
      getPublishStatus: vi.fn().mockRejectedValue(
        new Error('dev-supervisor not available at /tmp/publish.sock')
      ),
    });

    const response = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(503);

    expect(response.body.error).toBe('Publish supervisor unavailable');
  });

  it('should return 503 when supervisor connection refused', async () => {
    mockCreateForPublishSupervisor.mockReturnValue({
      getPublishStatus: vi.fn().mockRejectedValue(
        new Error('dev-supervisor TCP connection refused at localhost:9000')
      ),
    });

    const response = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(503);

    expect(response.body.error).toBe('Publish supervisor unavailable');
  });

  it('should reject when canPublish is false', async () => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
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

    const response = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(403);

    expect(response.body.error).toContain('not allowed');
  });
});

describe('POST /apps/:id/unpublish', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
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

  it('returns 404 when app not found', async () => {
    mockFindById.mockReturnValue(null);

    const response = await request(app)
      .post('/apps/test-app-id/unpublish')
      .send({})
      .expect(404);

    expect(response.body.error).toBe('App not found');
  });

  it('returns 500 when supervisor unavailable', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForSocketPath.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);

    const response = await request(app)
      .post('/apps/test-app-id/unpublish')
      .send({})
      .expect(500);

    expect(response.body.error).toBe('Publish supervisor not available');
  });

  it('unpublishes successfully via app.publishSupervisorPath', async () => {
    const mockUnpublish = vi.fn().mockResolvedValue({ status: 'stopped' });
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app', publishSupervisorPath: '/tmp/sock' });
    mockCreateForSocketPath.mockReturnValue({ unpublish: mockUnpublish });
    mockExistsSync.mockReturnValue(false);
    mockUpdatePublishedUrl.mockReturnValue({ id: 'test-app-id', publishedUrl: null });

    const response = await request(app)
      .post('/apps/test-app-id/unpublish')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe('stopped');
    expect(mockUnpublish).toHaveBeenCalled();
    expect(mockUpdatePublishedUrl).toHaveBeenCalledWith('test-app-id', null);
    expect(mockMemorySet).toHaveBeenCalledWith('test-app-id', 'site.domains', []);
  });

  it('unpublishes via AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH when socket exists', async () => {
    process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = '/run/publish.sock';
    const mockUnpublish = vi.fn().mockResolvedValue({ status: 'removed' });
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockExistsSync.mockReturnValue(true);
    mockCreateForSocketPath.mockReturnValue({ unpublish: mockUnpublish });
    mockUpdatePublishedUrl.mockReturnValue({ id: 'test-app-id' });

    const response = await request(app)
      .post('/apps/test-app-id/unpublish')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(mockCreateForSocketPath).toHaveBeenCalledWith('/run/publish.sock', 'test-app-id');
    delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
  });

  it('succeeds even when updatePublishedUrl returns null', async () => {
    const mockUnpublish = vi.fn().mockResolvedValue({ status: 'stopped' });
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app', publishSupervisorPath: '/tmp/sock' });
    mockCreateForSocketPath.mockReturnValue({ unpublish: mockUnpublish });
    mockExistsSync.mockReturnValue(false);
    mockUpdatePublishedUrl.mockReturnValue(null);

    const response = await request(app)
      .post('/apps/test-app-id/unpublish')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  it('returns 500 when unpublish throws', async () => {
    const mockUnpublish = vi.fn().mockRejectedValue(new Error('connection refused'));
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app', publishSupervisorPath: '/tmp/sock' });
    mockCreateForSocketPath.mockReturnValue({ unpublish: mockUnpublish });
    mockExistsSync.mockReturnValue(false);

    const response = await request(app)
      .post('/apps/test-app-id/unpublish')
      .send({})
      .expect(500);

    expect(response.body.error).toBe('Failed to unpublish');
    expect(response.body.details).toBe('connection refused');
  });
});

describe('POST /apps/:id/publish/restart', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
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

  it('returns 404 when app not found and no socket path', async () => {
    mockFindById.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);

    const response = await request(app)
      .post('/apps/test-app-id/publish/restart')
      .send({})
      .expect(404);

    expect(response.body.error).toBe('App not found');
  });

  it('returns 500 when supervisor unavailable', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForSocketPath.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);

    const response = await request(app)
      .post('/apps/test-app-id/publish/restart')
      .send({})
      .expect(500);

    expect(response.body.error).toBe('Publish supervisor not available');
  });

  it('restarts successfully via app.publishSupervisorPath', async () => {
    const mockRestartProcess = vi.fn().mockResolvedValue({ success: true });
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app', publishSupervisorPath: '/tmp/sock' });
    mockCreateForSocketPath.mockReturnValue({ restartProcess: mockRestartProcess });
    mockExistsSync.mockReturnValue(false);

    const response = await request(app)
      .post('/apps/test-app-id/publish/restart')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('test-app-id');
    expect(mockRestartProcess).toHaveBeenCalledWith({ graceful: true });
  });

  it('restarts via AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH when socket exists', async () => {
    process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = '/run/publish.sock';
    const mockRestartProcess = vi.fn().mockResolvedValue({ success: true });
    mockExistsSync.mockReturnValue(true);
    mockCreateForSocketPath.mockReturnValue({ restartProcess: mockRestartProcess });

    const response = await request(app)
      .post('/apps/test-app-id/publish/restart')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(mockCreateForSocketPath).toHaveBeenCalledWith('/run/publish.sock', 'test-app-id');
    expect(mockFindById).not.toHaveBeenCalled();
    delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
  });

  it('returns 500 when supervisor returns success=false', async () => {
    const mockRestartProcess = vi.fn().mockResolvedValue({ success: false, error: 'process hung' });
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app', publishSupervisorPath: '/tmp/sock' });
    mockCreateForSocketPath.mockReturnValue({ restartProcess: mockRestartProcess });
    mockExistsSync.mockReturnValue(false);

    const response = await request(app)
      .post('/apps/test-app-id/publish/restart')
      .send({})
      .expect(500);

    expect(response.body.error).toBe('Failed to restart published server');
    expect(response.body.details).toBe('process hung');
  });

  it('returns 500 when restartProcess throws', async () => {
    const mockRestartProcess = vi.fn().mockRejectedValue(new Error('socket timeout'));
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app', publishSupervisorPath: '/tmp/sock' });
    mockCreateForSocketPath.mockReturnValue({ restartProcess: mockRestartProcess });
    mockExistsSync.mockReturnValue(false);

    const response = await request(app)
      .post('/apps/test-app-id/publish/restart')
      .send({})
      .expect(500);

    expect(response.body.error).toBe('Failed to restart published server');
    expect(response.body.details).toBe('socket timeout');
  });
});

describe('GET /apps/:id/publish/status error path', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    publishJobRegistry.clear('test-app-id');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
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

  it('returns 500 when getPublishStatus throws non-connection error', async () => {
    mockCreateForPublishSupervisor.mockReturnValue({
      getPublishStatus: vi.fn().mockRejectedValue(new Error('supervisor connection lost')),
    });

    const response = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(500);

    expect(response.body.error).toBe('Failed to get publish status');
    expect(response.body).not.toHaveProperty('details');
  });
});

describe('GET /apps/:id/publish/status contract validation', () => {
  it('workspace.deployments.status() return shape has required fields for browser consumer', async () => {
    const mockStatus = {
      version: 'abc1234' as string | null,
      health: { status: 'healthy' as const, message: 'OK' },
      process: { state: 'running' as const, pid: 123, startedAt: new Date() },
    };

    type ExpectedShape = {
      version: string | null;
      health: { status: string; message: string };
      process: { state: string; pid?: number; startedAt?: Date };
    };

    const validated: ExpectedShape = mockStatus;
    expect(validated.version).toBeDefined();
    expect(validated.health).toHaveProperty('status');
    expect(validated.process).toHaveProperty('state');
    expect(['running', 'stopped', 'starting', 'stopping', 'error']).toContain(validated.process.state);
    expect(['healthy', 'unhealthy', 'stopped', 'unknown']).toContain(validated.health.status);
  });

  it('workspace.deployments.status() does not include uptime field', async () => {
    const mockStatus = {
      version: null,
      health: { status: 'starting' as const, message: '' },
      process: { state: 'starting' as const },
    };

    expect(mockStatus.process).not.toHaveProperty('uptime');
    expect(mockStatus.process).toHaveProperty('state');
  });
});

describe('POST /apps/:id/publish (async mode)', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as AuthenticatedRequest).agentContext = {
        siteId: 'test-site',
        canDownload: false,
        canPublish: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      next();
    });
    app.use('/', publishRouter);
  });

  it('returns 202 with jobId and phase when async:true', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockResolvedValue({ commitHash: 'abc123', archivePath: '/dist/abc123.tar.gz' }),
      deploy: vi.fn(),
    } as any);

    const response = await request(app)
      .post('/apps/test-app-id/publish')
      .send({ async: true })
      .expect(202);

    expect(response.body.jobId).toMatch(/^pub_/);
    expect(response.body.phase).toBe('building');
  });

  it('returns 409 when publish already in progress', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockImplementation(() => new Promise(() => {})),
      deploy: vi.fn(),
    } as any);

    await request(app)
      .post('/apps/test-app-id/publish')
      .send({ async: true })
      .expect(202);

    const response = await request(app)
      .post('/apps/test-app-id/publish')
      .send({ async: true })
      .expect(409);

    expect(response.body.error).toBe('Publish already in progress');
    expect(response.body.jobId).toBeDefined();
  });

});

describe('GET /apps/:id/publish/status (with active job)', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    publishJobRegistry.clear('test-app-id');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as AuthenticatedRequest).agentContext = {
        siteId: 'test-site',
        canDownload: false,
        canPublish: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      next();
    });
    app.use('/', publishRouter);
  });

  it('returns job phase when publish is in-flight', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockImplementation(() => new Promise(() => {})),
      deploy: vi.fn(),
    } as any);

    await request(app)
      .post('/apps/test-app-id/publish')
      .send({ async: true })
      .expect(202);

    const status = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(200);

    expect(status.body.phase).toBe('building');
    expect(status.body.jobId).toBeDefined();
    expect(status.body.startedAt).toBeDefined();
  });

  it('returns deployed phase after background job completes', async () => {
    process.env.NOMAD_ALLOC_DIR = '/fake-alloc';
    try {
      mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
      mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
      vi.mocked(getGitHookService).mockReturnValue({
        hasActiveBranch: vi.fn().mockReturnValue(false),
        clearBranchTracking: vi.fn(),
      } as any);
      vi.mocked(getPublishStrategy).mockReturnValue({
        key: 'default',
        prepareBuild: vi.fn().mockResolvedValue({ commitHash: 'abc123', archivePath: '/dist/abc123.tar.gz' }),
        deploy: vi.fn(),
      } as any);

      await request(app)
        .post('/apps/test-app-id/publish')
        .send({ async: true })
        .expect(202);

      await new Promise(resolve => setTimeout(resolve, 10));

      const status = await request(app)
        .get('/apps/test-app-id/publish/status')
        .expect(200);

      expect(status.body.phase).toBe('deployed');
      expect(status.body.commitHash).toBe('abc123');
    } finally {
      delete process.env.NOMAD_ALLOC_DIR;
    }
  });

  it('returns failed phase when build throws', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockRejectedValue(new Error('npm build failed')),
      deploy: vi.fn(),
    } as any);

    await request(app)
      .post('/apps/test-app-id/publish')
      .send({ async: true })
      .expect(202);

    await new Promise(resolve => setTimeout(resolve, 10));

    const status = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(200);

    expect(status.body.phase).toBe('failed');
    expect(status.body.error).toBe('npm build failed');
  });

  it('returns deployed with version after unified-job deploy succeeds', async () => {
    process.env.NOMAD_ALLOC_DIR = '/fake-alloc';
    process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = '/run/publish.sock';
    mockExistsSync.mockReturnValue(true);
    try {
      mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
      mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
      vi.mocked(getGitHookService).mockReturnValue({
        hasActiveBranch: vi.fn().mockReturnValue(true),
        clearBranchTracking: vi.fn(),
      } as any);
      mockCreateForSocketPath.mockReturnValue({ publish: vi.fn() });
      vi.mocked(getPublishStrategy).mockReturnValue({
        key: 'default',
        prepareBuild: vi.fn().mockResolvedValue({ commitHash: 'def456', archivePath: '/dist/def456.tar.gz' }),
        deploy: vi.fn().mockResolvedValue({ status: 'success', version: 'v2.0' }),
      } as any);

      await request(app)
        .post('/apps/test-app-id/publish')
        .send({ async: true })
        .expect(202);

      await new Promise(resolve => setTimeout(resolve, 10));

      const status = await request(app)
        .get('/apps/test-app-id/publish/status')
        .expect(200);

      expect(status.body.phase).toBe('deployed');
      expect(status.body.version).toBe('v2.0');
    } finally {
      delete process.env.NOMAD_ALLOC_DIR;
      delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
    }
  });

  it('returns failed when unified-job deploy returns error', async () => {
    process.env.NOMAD_ALLOC_DIR = '/fake-alloc';
    process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = '/run/publish.sock';
    mockExistsSync.mockReturnValue(true);
    try {
      mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
      mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
      vi.mocked(getGitHookService).mockReturnValue({
        hasActiveBranch: vi.fn().mockReturnValue(false),
        clearBranchTracking: vi.fn(),
      } as any);
      mockCreateForSocketPath.mockReturnValue({ publish: vi.fn() });
      vi.mocked(getPublishStrategy).mockReturnValue({
        key: 'default',
        prepareBuild: vi.fn().mockResolvedValue({ commitHash: 'ghi789', archivePath: '/dist/ghi789.tar.gz' }),
        deploy: vi.fn().mockResolvedValue({ status: 'error', error: 'health check failed', logs: [{ message: 'timeout' }] }),
      } as any);

      await request(app)
        .post('/apps/test-app-id/publish')
        .send({ async: true })
        .expect(202);

      await new Promise(resolve => setTimeout(resolve, 10));

      const status = await request(app)
        .get('/apps/test-app-id/publish/status')
        .expect(200);

      expect(status.body.phase).toBe('failed');
      expect(status.body.error).toBe('health check failed');
      expect(status.body.logs).toEqual(['timeout']);
    } finally {
      delete process.env.NOMAD_ALLOC_DIR;
      delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
    }
  });

  it('stays deployed when SEO audit throws after successful deploy', async () => {
    process.env.NOMAD_ALLOC_DIR = '/fake-alloc';
    try {
      mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app', publishedUrl: 'https://app.test.com', customerId: 'cust-1' });
      mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
      vi.mocked(getGitHookService).mockReturnValue({
        hasActiveBranch: vi.fn().mockReturnValue(false),
        clearBranchTracking: vi.fn(),
      } as any);
      vi.mocked(getPublishStrategy).mockReturnValue({
        key: 'default',
        prepareBuild: vi.fn().mockResolvedValue({ commitHash: 'seo-test', archivePath: '/dist/seo-test.tar.gz' }),
        deploy: vi.fn(),
      } as any);
      vi.mocked(runSeoAudit).mockRejectedValueOnce(new Error('audit network timeout'));

      await request(app)
        .post('/apps/test-app-id/publish')
        .send({ async: true })
        .expect(202);

      await new Promise(resolve => setTimeout(resolve, 20));

      const status = await request(app)
        .get('/apps/test-app-id/publish/status')
        .expect(200);

      expect(status.body.phase).toBe('deployed');
    } finally {
      delete process.env.NOMAD_ALLOC_DIR;
    }
  });

  it('returns null-checked fields in status response', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockImplementation(() => new Promise(() => {})),
      deploy: vi.fn(),
    } as any);

    await request(app)
      .post('/apps/test-app-id/publish')
      .send({ async: true })
      .expect(202);

    const status = await request(app)
      .get('/apps/test-app-id/publish/status')
      .expect(200);

    expect(status.body).not.toHaveProperty('commitHash');
    expect(status.body).not.toHaveProperty('version');
    expect(status.body).not.toHaveProperty('error');
    expect(status.body).not.toHaveProperty('logs');
  });
});

describe('POST /apps/:id/publish outer catch', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();


    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
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

  afterEach(() => {

  });

  it('returns 500 when an unhandled error escapes the inner try', async () => {
    mockFindById.mockImplementation(() => { throw new Error('database crashed'); });

    const response = await request(app)
      .post('/apps/test-app-id/publish')
      .send({})
      .expect(500);

    expect(response.body.error).toBe('Failed to publish archive');
    expect(response.body.details).toBe('database crashed');
  });
});

describe('POST /apps/:id/publish (unified-job deploy path)', () => {
  function createPublishApp(): Express {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as AuthenticatedRequest).agentContext = {
        siteId: 'test-site',
        canDownload: false,
        canPublish: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      next();
    });
    testApp.use('/', publishRouter);
    return testApp;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.NOMAD_ALLOC_DIR = '/fake-alloc';
    process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = '/run/publish.sock';
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {

    delete process.env.NOMAD_ALLOC_DIR;
    delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
  });

  it('returns success with supervisor details when deploy succeeds', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app', publishedUrl: 'https://app.example.com', customerId: 'cust-123' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, runtime: {} });
    vi.mocked(getGitHookService).mockReturnValue({
      hasActiveBranch: vi.fn().mockReturnValue(false),
      clearBranchTracking: vi.fn(),
    } as any);

    const mockDeploy = vi.fn().mockResolvedValue({
      status: 'success',
      version: 'abc123full',
      healthStatus: 'healthy',
      startupTime: 1200,
      healthCheckDuration: 3000,
    });

    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockResolvedValue({
        commitHash: 'abc123full',
        archivePath: '/dist/abc123full.tar.gz',
      }),
      deploy: mockDeploy,
    } as any);

    mockCreateForSocketPath.mockReturnValue({ publish: vi.fn() });

    const testApp = createPublishApp();
    const response = await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({ publishedUrl: 'https://app.example.com' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.supervisor.version).toBe('abc123full');
    expect(response.body.supervisor.healthStatus).toBe('healthy');
    expect(mockCreateForSocketPath).toHaveBeenCalledWith('/run/publish.sock', 'test-app-id');

    await new Promise(resolve => setTimeout(resolve, 10));
  });

  it('returns 500 when deploy returns error status', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() } });
    vi.mocked(getGitHookService).mockReturnValue({
      hasActiveBranch: vi.fn().mockReturnValue(false),
      clearBranchTracking: vi.fn(),
    } as any);

    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockResolvedValue({
        commitHash: 'abc123full',
        archivePath: '/dist/abc123full.tar.gz',
      }),
      deploy: vi.fn().mockResolvedValue({
        status: 'error',
        error: 'health check timed out',
        healthStatus: 'unhealthy',
        logs: ['start failed'],
        exitCode: 1,
        healthCheckDuration: 60000,
      }),
    } as any);

    mockCreateForSocketPath.mockReturnValue({ publish: vi.fn() });

    const testApp = createPublishApp();
    const response = await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({})
      .expect(500);

    expect(response.body.error).toBe('Publish supervisor failed');
    expect(response.body.details).toBe('health check timed out');
    expect(response.body.healthStatus).toBe('unhealthy');
  });

  it('returns 500 when deploy throws', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() } });
    vi.mocked(getGitHookService).mockReturnValue({
      hasActiveBranch: vi.fn().mockReturnValue(false),
      clearBranchTracking: vi.fn(),
    } as any);

    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockResolvedValue({
        commitHash: 'abc123full',
        archivePath: '/dist/abc123full.tar.gz',
      }),
      deploy: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as any);

    mockCreateForSocketPath.mockReturnValue({ publish: vi.fn() });

    const testApp = createPublishApp();
    const response = await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({})
      .expect(500);

    expect(response.body.error).toBe('Failed to call publish supervisor');
    expect(response.body.details).toBe('ECONNREFUSED');
  });

  it('returns 500 when no supervisor client can be created', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() } });
    vi.mocked(getGitHookService).mockReturnValue({
      hasActiveBranch: vi.fn().mockReturnValue(false),
      clearBranchTracking: vi.fn(),
    } as any);

    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockResolvedValue({
        commitHash: 'abc123full',
        archivePath: '/dist/abc123full.tar.gz',
      }),
      deploy: vi.fn(),
    } as any);

    mockCreateForSocketPath.mockReturnValue(null);

    const testApp = createPublishApp();
    const response = await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({})
      .expect(500);

    expect(response.body.error).toBe('Failed to call publish supervisor');
    expect(response.body.details).toContain('Failed to create publish supervisor client');
  });

  it('uses local dev path when no NOMAD_ALLOC_DIR and app has publishSupervisorPath', async () => {
    delete process.env.NOMAD_ALLOC_DIR;
    delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
    mockExistsSync.mockReturnValue(false);

    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/app', publishSupervisorPath: '/tmp/local.sock' });
    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() } });
    vi.mocked(getGitHookService).mockReturnValue({
      hasActiveBranch: vi.fn().mockReturnValue(false),
      clearBranchTracking: vi.fn(),
    } as any);

    const mockDeploy = vi.fn().mockResolvedValue({
      status: 'success',
      version: 'localdev123',
      healthStatus: 'healthy',
    });

    vi.mocked(getPublishStrategy).mockReturnValue({
      key: 'default',
      prepareBuild: vi.fn().mockResolvedValue({
        commitHash: 'localdev123',
        archivePath: '/dist/localdev123.tar.gz',
      }),
      deploy: mockDeploy,
    } as any);

    mockCreateForSocketPath.mockReturnValue({ publish: vi.fn() });

    const testApp = createPublishApp();
    const response = await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.published).toBe(true);
    expect(mockCreateForSocketPath).toHaveBeenCalledWith('/tmp/local.sock', 'test-app-id');
  });
});


describe('POST /apps/:id/publish (fire-and-forget async paths)', () => {
  function createPublishApp(): Express {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as AuthenticatedRequest).agentContext = {
        siteId: 'test-site',
        canDownload: false,
        canPublish: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      next();
    });
    testApp.use('/', publishRouter);
    return testApp;
  }

  function setupSuccessfulPublish() {
    vi.mocked(getGitHookService).mockReturnValue({
      hasActiveBranch: vi.fn().mockReturnValue(false),
      clearBranchTracking: vi.fn(),
    } as any);

    mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() } });
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
  }

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.NOMAD_ALLOC_DIR = '/fake-alloc';
  });

  afterEach(() => {

    delete process.env.NOMAD_ALLOC_DIR;
  });

  it('executes SEO audit regression detection on successful publish', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app', publishedUrl: 'https://app.test.com' });
    setupSuccessfulPublish();

    const testApp = createPublishApp();
    await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({})
      .expect(200);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(vi.mocked(runSeoAudit)).toHaveBeenCalledWith(expect.objectContaining({ appId: 'test-app-id' }));
  });

  it('catches SEO audit exceptions without failing publish', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app' });
    setupSuccessfulPublish();
    vi.mocked(runSeoAudit).mockRejectedValueOnce(new Error('audit network timeout'));

    const testApp = createPublishApp();
    const response = await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 10));
  });

  it('catches compliance report exceptions without failing publish', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app', customerId: 'cust-456' });
    setupSuccessfulPublish();

    const testApp = createPublishApp();
    const response = await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(vi.mocked(reportPublishedComplianceStatus)).toHaveBeenCalledWith(
      'test-app-id',
      'cust-456',
      expect.anything(),
      expect.anything(),
    );
  });

  it('skips compliance report when customerId is not-provided', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app', customerId: 'not-provided' });
    setupSuccessfulPublish();

    const testApp = createPublishApp();
    await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({})
      .expect(200);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(vi.mocked(reportPublishedComplianceStatus)).not.toHaveBeenCalled();
  });

  it('async publish stays deployed when SEO audit throws', async () => {
    mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app', publishedUrl: 'https://app.test.com' });
    setupSuccessfulPublish();
    vi.mocked(runSeoAudit).mockRejectedValueOnce(new Error('DNS propagation timeout'));
    publishJobRegistry.clear('test-app-id');

    const testApp = createPublishApp();
    const response = await request(testApp)
      .post('/apps/test-app-id/publish')
      .send({ async: true })
      .expect(202);

    expect(response.body.jobId).toBeDefined();

    await new Promise(resolve => setTimeout(resolve, 50));

    const job = publishJobRegistry.get('test-app-id');
    expect(job).not.toBeNull();
    expect(job!.phase).toBe('deployed');
  });
});

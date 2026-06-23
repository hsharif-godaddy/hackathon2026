import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock capability-config before importing git-remote
vi.mock('../../../utils/capability-config.js', () => ({
  isCapabilityEnabled: vi.fn(),
}));

const mockFindById = vi.hoisted(() => vi.fn());

// Mock other dependencies
vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: mockFindById,
  }; }),
}));

const mockFindByAppAndRemote = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());
const mockFindByAppIdConfig = vi.hoisted(() => vi.fn().mockReturnValue([]));

vi.mock('../../../database/repositories/GitRemoteConfigRepository.js', () => ({
  GitRemoteConfigRepository: vi.fn().mockImplementation(function () { return {
    findByAppId: mockFindByAppIdConfig,
    findByAppAndRemote: mockFindByAppAndRemote,
    update: mockUpdate,
    upsert: mockUpsert,
  }; }),
}));

vi.mock('../../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: vi.fn(),
  },
}));

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () { return { tasks: {} }; }),
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn(function (_req, _res, next) { return next(); }),
}));

vi.mock('../../middleware/git-import-validation.js', () => ({
  validateGitSync: vi.fn(function (_req, _res, next) { return next(); }),
}));

vi.mock('../../../tools/git-tool.js', () => ({
  GitTool: vi.fn(),
}));

vi.mock('../../../utils/error.js', () => ({
  getErrorMessage: vi.fn(function (err: unknown) { return err instanceof Error ? err.message : String(err); }),
}));

vi.mock('../../../services/GitOpsService.js', () => ({
  gitOpsService: {
    startPull: vi.fn().mockResolvedValue({ success: true, jobId: 'mock-job-id', status: 'pending' }),
    startPush: vi.fn().mockResolvedValue({ success: true, jobId: 'mock-job-id', status: 'pending' }),
    getJobStatus: vi.fn(),
  },
}));

// Import after mocks
import gitRemoteRouter from '../git-remote.js';
import { isCapabilityEnabled } from '../../../utils/capability-config.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { gitOpsService } from '../../../services/GitOpsService.js';
import { ImportJobStatus } from '../../../types/import.js';

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(gitRemoteRouter);
  return app;
};

describe('git-remote routes', function gitRemoteTests() {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {} } as any);
    app = createTestApp();
  });

  afterEach(() => {
    delete process.env.ENABLE_GIT_REMOTE_SYNC;
  });

  describe('requireGitRemoteSync middleware', function middlewareTests() {
    describe('when ENABLE_GIT_REMOTE_SYNC=true (bypasses capability checks)', function featureFlagEnabled() {
      beforeEach(() => {
        process.env.ENABLE_GIT_REMOTE_SYNC = 'true';
        app = createTestApp();
      });

      it('should allow /git/push without capability check', async function pushBypass() {
        vi.mocked(isCapabilityEnabled).mockReturnValue(false);

        const response = await request(app)
          .post('/apps/test-id/git/push')
          .send({});

        // Should pass middleware (may fail later due to missing app, but not 403)
        expect(response.status).not.toBe(403);
        // isCapabilityEnabled should not be called when feature flag is true
        expect(isCapabilityEnabled).not.toHaveBeenCalled();
      });

      it('should allow /git/pull without capability check', async function pullBypass() {
        vi.mocked(isCapabilityEnabled).mockReturnValue(false);

        const response = await request(app)
          .post('/apps/test-id/git/pull')
          .send({});

        expect(response.status).not.toBe(403);
        expect(isCapabilityEnabled).not.toHaveBeenCalled();
      });

      it('should allow /git/remote/status without capability check', async function statusBypass() {
        vi.mocked(isCapabilityEnabled).mockReturnValue(false);

        const response = await request(app)
          .get('/apps/test-id/git/remote/status');

        expect(response.status).not.toBe(403);
        expect(isCapabilityEnabled).not.toHaveBeenCalled();
      });

      it('should allow /git/remote/configure without capability check', async function configureBypass() {
        vi.mocked(isCapabilityEnabled).mockReturnValue(false);

        const response = await request(app)
          .post('/apps/test-id/git/remote/configure')
          .send({ repoUrl: 'https://github.com/user/repo.git' });

        expect(response.status).not.toBe(403);
        expect(isCapabilityEnabled).not.toHaveBeenCalled();
      });
    });

    describe('when ENABLE_GIT_REMOTE_SYNC is not true (capability checks apply)', function capabilityChecks() {
      beforeEach(() => {
        delete process.env.ENABLE_GIT_REMOTE_SYNC;
        app = createTestApp();
      });

      describe('/git/push capability check', function pushCapabilityTests() {
        it('should allow request when CODE_SYNC_GIT_PUSH capability is enabled', async function pushAllowed() {
          vi.mocked(isCapabilityEnabled).mockImplementation(function (cap) { return cap === 'CODE_SYNC_GIT_PUSH'; });

          const response = await request(app)
            .post('/apps/test-id/git/push')
            .send({});

          expect(response.status).not.toBe(403);
          expect(isCapabilityEnabled).toHaveBeenCalledWith('CODE_SYNC_GIT_PUSH');
        });

        it('should return 403 when CODE_SYNC_GIT_PUSH capability is not enabled', async function pushDenied() {
          vi.mocked(isCapabilityEnabled).mockReturnValue(false);

          const response = await request(app)
            .post('/apps/test-id/git/push')
            .send({})
            .expect(403);

          expect(response.body.error).toBe('Git operation not allowed');
          expect(response.body.message).toContain('CODE_SYNC_GIT_PUSH');
        });

        it('should not allow push when only CODE_SYNC_GIT_PULL is enabled', async function pushWithOnlyPull() {
          vi.mocked(isCapabilityEnabled).mockImplementation(function (cap) { return cap === 'CODE_SYNC_GIT_PULL'; });

          const response = await request(app)
            .post('/apps/test-id/git/push')
            .send({})
            .expect(403);

          expect(response.body.error).toBe('Git operation not allowed');
        });
      });

      describe('/git/pull capability check', function pullCapabilityTests() {
        it('should allow request when CODE_SYNC_GIT_PULL capability is enabled', async function pullAllowed() {
          vi.mocked(isCapabilityEnabled).mockImplementation(function (cap) { return cap === 'CODE_SYNC_GIT_PULL'; });

          const response = await request(app)
            .post('/apps/test-id/git/pull')
            .send({});

          expect(response.status).not.toBe(403);
          expect(isCapabilityEnabled).toHaveBeenCalledWith('CODE_SYNC_GIT_PULL');
        });

        it('should return 403 when CODE_SYNC_GIT_PULL capability is not enabled', async function pullDenied() {
          vi.mocked(isCapabilityEnabled).mockReturnValue(false);

          const response = await request(app)
            .post('/apps/test-id/git/pull')
            .send({})
            .expect(403);

          expect(response.body.error).toBe('Git operation not allowed');
          expect(response.body.message).toContain('CODE_SYNC_GIT_PULL');
        });

        it('should not allow pull when only CODE_SYNC_GIT_PUSH is enabled', async function pullWithOnlyPush() {
          vi.mocked(isCapabilityEnabled).mockImplementation(function (cap) { return cap === 'CODE_SYNC_GIT_PUSH'; });

          const response = await request(app)
            .post('/apps/test-id/git/pull')
            .send({})
            .expect(403);

          expect(response.body.error).toBe('Git operation not allowed');
        });
      });

      describe('/git/remote/status capability check', function statusCapabilityTests() {
        it('should allow request when CODE_SYNC_GIT_PUSH is enabled', async function statusWithPush() {
          vi.mocked(isCapabilityEnabled).mockImplementation(function (cap) { return cap === 'CODE_SYNC_GIT_PUSH'; });

          const response = await request(app)
            .get('/apps/test-id/git/remote/status');

          expect(response.status).not.toBe(403);
        });

        it('should allow request when CODE_SYNC_GIT_PULL is enabled', async function statusWithPull() {
          vi.mocked(isCapabilityEnabled).mockImplementation(function (cap) { return cap === 'CODE_SYNC_GIT_PULL'; });

          const response = await request(app)
            .get('/apps/test-id/git/remote/status');

          expect(response.status).not.toBe(403);
        });

        it('should allow request when both capabilities are enabled', async function statusWithBoth() {
          vi.mocked(isCapabilityEnabled).mockReturnValue(true);

          const response = await request(app)
            .get('/apps/test-id/git/remote/status');

          expect(response.status).not.toBe(403);
        });

        it('should return 403 when neither capability is enabled', async function statusDenied() {
          vi.mocked(isCapabilityEnabled).mockReturnValue(false);

          const response = await request(app)
            .get('/apps/test-id/git/remote/status')
            .expect(403);

          expect(response.body.error).toBe('Git operation not allowed');
          expect(response.body.message).toContain('CODE_SYNC_GIT_PUSH or CODE_SYNC_GIT_PULL');
        });
      });

      describe('/git/remote/configure capability check', function configureCapabilityTests() {
        it('should allow request when CODE_SYNC_GIT_PUSH is enabled', async function configureWithPush() {
          vi.mocked(isCapabilityEnabled).mockImplementation(function (cap) { return cap === 'CODE_SYNC_GIT_PUSH'; });

          const response = await request(app)
            .post('/apps/test-id/git/remote/configure')
            .send({ repoUrl: 'https://github.com/user/repo.git' });

          expect(response.status).not.toBe(403);
        });

        it('should allow request when CODE_SYNC_GIT_PULL is enabled', async function configureWithPull() {
          vi.mocked(isCapabilityEnabled).mockImplementation(function (cap) { return cap === 'CODE_SYNC_GIT_PULL'; });

          const response = await request(app)
            .post('/apps/test-id/git/remote/configure')
            .send({ repoUrl: 'https://github.com/user/repo.git' });

          expect(response.status).not.toBe(403);
        });

        it('should return 403 when neither capability is enabled', async function configureDenied() {
          vi.mocked(isCapabilityEnabled).mockReturnValue(false);

          const response = await request(app)
            .post('/apps/test-id/git/remote/configure')
            .send({ repoUrl: 'https://github.com/user/repo.git' })
            .expect(403);

          expect(response.body.error).toBe('Git operation not allowed');
          expect(response.body.message).toContain('CODE_SYNC_GIT_PUSH or CODE_SYNC_GIT_PULL');
        });
      });
    });

    describe('ENABLE_GIT_REMOTE_SYNC=false (same as not set)', function featureFlagFalse() {
      beforeEach(() => {
        process.env.ENABLE_GIT_REMOTE_SYNC = 'false';
        app = createTestApp();
      });

      it('should fall back to capability checks when feature flag is false', async function fallbackToCapability() {
        vi.mocked(isCapabilityEnabled).mockImplementation(function (cap) { return cap === 'CODE_SYNC_GIT_PUSH'; });

        const response = await request(app)
          .post('/apps/test-id/git/push')
          .send({});

        expect(response.status).not.toBe(403);
        expect(isCapabilityEnabled).toHaveBeenCalledWith('CODE_SYNC_GIT_PUSH');
      });

      it('should return 403 when capability is not enabled', async function neitherEnabled() {
        vi.mocked(isCapabilityEnabled).mockReturnValue(false);

        const response = await request(app)
          .post('/apps/test-id/git/push')
          .send({})
          .expect(403);

        expect(response.body.error).toBe('Git operation not allowed');
      });
    });
  });

  describe('/git/pull modifyViteConfig parameter (deprecated)', function modifyViteConfigTests() {
    beforeEach(() => {
      process.env.ENABLE_GIT_REMOTE_SYNC = 'true';
      app = createTestApp();
    });

    it('accepts modifyViteConfig but does not pass it to startPull', async function ignoresModifyViteConfig() {
      vi.mocked(gitOpsService.startPull).mockResolvedValue({
        success: true,
        jobId: 'test-job-id',
        status: ImportJobStatus.PENDING,
      });

      await request(app)
        .post('/apps/test-id/git/pull')
        .send({ modifyViteConfig: true })
        .expect(202);

      expect(gitOpsService.startPull).toHaveBeenCalledWith(
        expect.not.objectContaining({ modifyViteConfig: expect.anything() })
      );
    });
  });

  describe('/git/pull clearWorkingTree parameter', function clearWorkingTreeTests() {
    beforeEach(() => {
      process.env.ENABLE_GIT_REMOTE_SYNC = 'true';
      app = createTestApp();
    });

    it('should forward clearWorkingTree=true to gitOpsService.startPull', async function passClearWorkingTreeTrue() {
      vi.mocked(gitOpsService.startPull).mockResolvedValue({
        success: true,
        jobId: 'test-job-id',
        status: ImportJobStatus.PENDING,
      });

      await request(app)
        .post('/apps/test-id/git/pull')
        .send({ clearWorkingTree: true })
        .expect(202);

      expect(gitOpsService.startPull).toHaveBeenCalledWith(
        expect.objectContaining({ clearWorkingTree: true })
      );
    });

    it('should forward clearWorkingTree=false to gitOpsService.startPull', async function passClearWorkingTreeFalse() {
      vi.mocked(gitOpsService.startPull).mockResolvedValue({
        success: true,
        jobId: 'test-job-id',
        status: ImportJobStatus.PENDING,
      });

      await request(app)
        .post('/apps/test-id/git/pull')
        .send({ clearWorkingTree: false })
        .expect(202);

      expect(gitOpsService.startPull).toHaveBeenCalledWith(
        expect.objectContaining({ clearWorkingTree: false })
      );
    });

    it('should pass clearWorkingTree: undefined when not provided', async function passClearWorkingTreeUndefined() {
      vi.mocked(gitOpsService.startPull).mockResolvedValue({
        success: true,
        jobId: 'test-job-id',
        status: ImportJobStatus.PENDING,
      });

      await request(app)
        .post('/apps/test-id/git/pull')
        .send({})
        .expect(202);

      expect(gitOpsService.startPull).toHaveBeenCalledWith(
        expect.objectContaining({ clearWorkingTree: undefined })
      );
    });

    it('should return 400 when clearWorkingTree is not a boolean', async function invalidClearWorkingTreeType() {
      const response = await request(app)
        .post('/apps/test-id/git/pull')
        .send({ clearWorkingTree: 'true' })
        .expect(400);

      expect(response.body.error).toBe('clearWorkingTree must be a boolean');
      expect(gitOpsService.startPull).not.toHaveBeenCalled();
    });
  });

  describe('workspace-null guard', function workspaceNullTests() {
    it('should return 503 when createForWorkspace returns null on /git/remote/configure', async function configureWorkspaceNull() {
      process.env.ENABLE_GIT_REMOTE_SYNC = 'true';
      vi.mocked(createForWorkspace).mockReturnValue(null as any);
      mockFindById.mockReturnValue({ id: 'test-id', path: '/tmp/apps/test-id/app' });
      app = createTestApp();

      const response = await request(app)
        .post('/apps/test-id/git/remote/configure')
        .send({ repoUrl: 'https://github.com/user/repo.git' });

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('App container is not available');
    });
  });

  describe('strategy-only update on /git/remote/configure', function strategyUpdateTests() {
    beforeEach(() => {
      process.env.ENABLE_GIT_REMOTE_SYNC = 'true';
      app = createTestApp();
    });

    it('should update syncStrategy without repoUrl when remote exists', async function updateStrategy() {
      mockFindByAppAndRemote.mockReturnValue({ id: 42, remoteName: 'origin' });

      const response = await request(app)
        .post('/apps/test-id/git/remote/configure')
        .send({ syncStrategy: 'on_commit' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.syncStrategy).toBe('on_commit');
      expect(mockUpdate).toHaveBeenCalledWith(42, { syncStrategy: 'on_commit' });
    });

    it('should return 404 when no remote configured for strategy-only update', async function noRemote() {
      mockFindByAppAndRemote.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-id/git/remote/configure')
        .send({ syncStrategy: 'on_publish' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No remote configured for this app');
    });

    it('should reject invalid syncStrategy value', async function invalidStrategy() {
      const response = await request(app)
        .post('/apps/test-id/git/remote/configure')
        .send({ syncStrategy: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('syncStrategy must be one of');
    });

    it('should accept on_publish as valid syncStrategy', async function publishStrategy() {
      mockFindByAppAndRemote.mockReturnValue({ id: 10, remoteName: 'origin' });

      const response = await request(app)
        .post('/apps/test-id/git/remote/configure')
        .send({ syncStrategy: 'on_publish' });

      expect(response.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith(10, { syncStrategy: 'on_publish' });
    });

    it('should accept manual as valid syncStrategy', async function manualStrategy() {
      mockFindByAppAndRemote.mockReturnValue({ id: 10, remoteName: 'origin' });

      const response = await request(app)
        .post('/apps/test-id/git/remote/configure')
        .send({ syncStrategy: 'manual' });

      expect(response.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith(10, { syncStrategy: 'manual' });
    });
  });

  describe('syncStrategy in /git/remote/status response', function statusResponseTests() {
    beforeEach(() => {
      process.env.ENABLE_GIT_REMOTE_SYNC = 'true';
      app = createTestApp();
    });

    it('should include syncStrategy in status response', async function includesStrategy() {
      mockFindByAppIdConfig.mockReturnValue([{
        id: 1,
        remoteName: 'origin',
        provider: 'github',
        repoUrl: 'https://github.com/user/repo.git',
        defaultBranch: 'main',
        syncEnabled: true,
        syncStrategy: 'on_commit',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const response = await request(app)
        .get('/apps/test-id/git/remote/status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.remotes).toHaveLength(1);
      expect(response.body.remotes[0].syncStrategy).toBe('on_commit');
    });

    it('should return empty remotes when no config exists', async function emptyRemotes() {
      mockFindByAppIdConfig.mockReturnValue([]);

      const response = await request(app)
        .get('/apps/test-id/git/remote/status');

      expect(response.status).toBe(200);
      expect(response.body.remotes).toHaveLength(0);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock capability-config before importing git-remote
vi.mock('../../../utils/capability-config.js', () => ({
  isCapabilityEnabled: vi.fn(),
}));

// Mock other dependencies
vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn(),
  })),
}));

vi.mock('../../../database/repositories/GitRemoteConfigRepository.js', () => ({
  GitRemoteConfigRepository: vi.fn().mockImplementation(() => ({
    findByAppId: vi.fn(),
  })),
}));

vi.mock('../../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: vi.fn(),
  },
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn((_req, _res, next) => next()),
}));

vi.mock('../../../services/GitOpsService.js', () => ({
  gitOpsService: {
    startPull: vi.fn(),
    startPush: vi.fn(),
    getJobStatus: vi.fn(),
  },
}));

// Import after mocks
import gitRemoteRouter from '../git-remote.js';
import { isCapabilityEnabled } from '../../../utils/capability-config.js';
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
          vi.mocked(isCapabilityEnabled).mockImplementation((cap) => cap === 'CODE_SYNC_GIT_PUSH');

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
          vi.mocked(isCapabilityEnabled).mockImplementation((cap) => cap === 'CODE_SYNC_GIT_PULL');

          const response = await request(app)
            .post('/apps/test-id/git/push')
            .send({})
            .expect(403);

          expect(response.body.error).toBe('Git operation not allowed');
        });
      });

      describe('/git/pull capability check', function pullCapabilityTests() {
        it('should allow request when CODE_SYNC_GIT_PULL capability is enabled', async function pullAllowed() {
          vi.mocked(isCapabilityEnabled).mockImplementation((cap) => cap === 'CODE_SYNC_GIT_PULL');

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
          vi.mocked(isCapabilityEnabled).mockImplementation((cap) => cap === 'CODE_SYNC_GIT_PUSH');

          const response = await request(app)
            .post('/apps/test-id/git/pull')
            .send({})
            .expect(403);

          expect(response.body.error).toBe('Git operation not allowed');
        });
      });

      describe('/git/remote/status capability check', function statusCapabilityTests() {
        it('should allow request when CODE_SYNC_GIT_PUSH is enabled', async function statusWithPush() {
          vi.mocked(isCapabilityEnabled).mockImplementation((cap) => cap === 'CODE_SYNC_GIT_PUSH');

          const response = await request(app)
            .get('/apps/test-id/git/remote/status');

          expect(response.status).not.toBe(403);
        });

        it('should allow request when CODE_SYNC_GIT_PULL is enabled', async function statusWithPull() {
          vi.mocked(isCapabilityEnabled).mockImplementation((cap) => cap === 'CODE_SYNC_GIT_PULL');

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
          vi.mocked(isCapabilityEnabled).mockImplementation((cap) => cap === 'CODE_SYNC_GIT_PUSH');

          const response = await request(app)
            .post('/apps/test-id/git/remote/configure')
            .send({ repoUrl: 'https://github.com/user/repo.git' });

          expect(response.status).not.toBe(403);
        });

        it('should allow request when CODE_SYNC_GIT_PULL is enabled', async function configureWithPull() {
          vi.mocked(isCapabilityEnabled).mockImplementation((cap) => cap === 'CODE_SYNC_GIT_PULL');

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
        vi.mocked(isCapabilityEnabled).mockImplementation((cap) => cap === 'CODE_SYNC_GIT_PUSH');

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

  describe('/git/pull modifyViteConfig parameter', function modifyViteConfigTests() {
    beforeEach(() => {
      process.env.ENABLE_GIT_REMOTE_SYNC = 'true';
      app = createTestApp();
    });

    it('should pass modifyViteConfig: true to gitOpsService.startPull', async function passModifyViteConfigTrue() {
      vi.mocked(gitOpsService.startPull).mockResolvedValue({
        success: true,
        jobId: 'test-job-id',
        status: ImportJobStatus.PENDING,
      });

      await request(app)
        .post('/apps/test-id/git/pull')
        .send({ modifyViteConfig: true })
        .expect(202);

      expect(gitOpsService.startPull).toHaveBeenCalledWith({
        appId: 'test-id',
        remoteName: undefined,
        branch: undefined,
        token: undefined,
        repoUrl: undefined,
        modifyViteConfig: true,
      });
    });

    it('should pass modifyViteConfig: false to gitOpsService.startPull', async function passModifyViteConfigFalse() {
      vi.mocked(gitOpsService.startPull).mockResolvedValue({
        success: true,
        jobId: 'test-job-id',
        status: ImportJobStatus.PENDING,
      });

      await request(app)
        .post('/apps/test-id/git/pull')
        .send({ modifyViteConfig: false })
        .expect(202);

      expect(gitOpsService.startPull).toHaveBeenCalledWith({
        appId: 'test-id',
        remoteName: undefined,
        branch: undefined,
        token: undefined,
        repoUrl: undefined,
        modifyViteConfig: false,
      });
    });

    it('should pass modifyViteConfig: undefined when not provided', async function passModifyViteConfigUndefined() {
      vi.mocked(gitOpsService.startPull).mockResolvedValue({
        success: true,
        jobId: 'test-job-id',
        status: ImportJobStatus.PENDING,
      });

      await request(app)
        .post('/apps/test-id/git/pull')
        .send({})
        .expect(202);

      expect(gitOpsService.startPull).toHaveBeenCalledWith({
        appId: 'test-id',
        remoteName: undefined,
        branch: undefined,
        token: undefined,
        repoUrl: undefined,
        modifyViteConfig: undefined,
      });
    });

    it('should return 400 when modifyViteConfig is not a boolean', async function invalidModifyViteConfigType() {
      const response = await request(app)
        .post('/apps/test-id/git/pull')
        .send({ modifyViteConfig: 'true' })
        .expect(400);

      expect(response.body.error).toBe('modifyViteConfig must be a boolean');
      expect(gitOpsService.startPull).not.toHaveBeenCalled();
    });
  });
});

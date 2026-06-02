import { writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const originalEnv = { ...process.env };

vi.mock('../../../database/repositories/AppRepository.js', () => {
  const mockFindById = vi.fn();
  return {
    AppRepository: vi.fn().mockImplementation(function () { return {
      findById: mockFindById,
    }; }),
  };
});

vi.mock('../../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: vi.fn().mockReturnValue(null),
    createForSocketPath: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function () { return {}; }),
}));

import publishRouter from '../publish.js';
import { AppRepository } from '../../../database/repositories/AppRepository.js';
import { DevSupervisorClientFactory } from '../../../utils/dev-supervisor-client-factory.js';

describe('Publish restart route', () => {
  let app: express.Application;
  let mockFindById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NOMAD_ALLOC_DIR = '/alloc';
    delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
    vi.clearAllMocks();

    mockFindById = vi.mocked(new AppRepository()).findById;
    mockFindById.mockReturnValue({
      id: 'test-app-id',
      path: '/tmp/test-app',
      publishSupervisorPath: 'tcp://localhost:8878',
    });

    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function mountWithAuth(options: { canPublish?: boolean; siteId?: string } = {}) {
    app.use((req: any, _res: any, next: any) => {
      req.agentContext = {
        siteId: options.siteId ?? 'test-app-id',
        canPublish: options.canPublish ?? true,
      };
      next();
    });
    app.use('/', publishRouter);
  }

  describe('#permission enforcement', () => {
    it('rejects requests without canPublish permission', async function reject() {
      mountWithAuth({ canPublish: false });

      const res = await request(app)
        .post('/apps/test-app-id/publish/restart')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Publish not allowed');
    });
  });

  describe('#ownership isolation', () => {
    it('rejects requests where siteId does not match app ID', async function ownership() {
      mountWithAuth({ siteId: 'different-site-id' });

      const res = await request(app)
        .post('/apps/test-app-id/publish/restart')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });
  });

  describe('#app not found', () => {
    it('returns 404 when app does not exist and no env publish socket', async function notFound() {
      mockFindById.mockReturnValue(null);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/publish/restart')
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('App not found');
    });
  });

  describe('#supervisor unavailable', () => {
    it('returns 500 when no publish supervisor can be created', async function unavailable() {
      mockFindById.mockReturnValue({
        id: 'test-app-id',
        path: '/tmp/test-app',
        publishSupervisorPath: null,
      });
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue(null as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/publish/restart')
        .send();

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Publish supervisor not available');
      expect(res.body.details).toBe(
        'Unable to restart - publish supervisor connection not established'
      );
    });
  });

  describe('#supervisor reported failure', () => {
    it('returns 500 with details when supervisor returns success false', async function supervisorFalse() {
      const mockRestart = vi.fn().mockResolvedValue({
        success: false,
        error: 'restart blocked',
      });
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
        restartProcess: mockRestart,
      } as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/publish/restart')
        .send();

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to restart published server');
      expect(res.body.details).toBe('restart blocked');
      expect(mockRestart).toHaveBeenCalledWith({ graceful: true });
    });

    it('returns 500 with default details when supervisor returns success false without error', async function noMsg() {
      const mockRestart = vi.fn().mockResolvedValue({ success: false });
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
        restartProcess: mockRestart,
      } as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/publish/restart')
        .send();

      expect(res.status).toBe(500);
      expect(res.body.details).toBe('supervisor returned success=false with no error message');
    });
  });

  describe('#successful restart', () => {
    it('returns success when supervisor reports success', async function success() {
      const mockRestart = vi.fn().mockResolvedValue({ success: true });
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
        restartProcess: mockRestart,
      } as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/publish/restart')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockRestart).toHaveBeenCalledWith({ graceful: true });
    });
  });

  describe('#supervisor failure', () => {
    it('returns 500 when supervisor throws', async function failure() {
      const mockRestart = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
        restartProcess: mockRestart,
      } as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/publish/restart')
        .send();

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to restart published server');
      expect(res.body.details).toBe('Connection refused');
    });
  });

  describe('#production socket path', () => {
    it('uses AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH when socket file exists', async function prodSocket() {
      const socketPath = path.join(os.tmpdir(), `publish-restart-test-${Date.now()}.sock`);
      writeFileSync(socketPath, '');

      try {
        process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = socketPath;
        const mockRestart = vi.fn().mockResolvedValue({ success: true });
        vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
          restartProcess: mockRestart,
        } as any);
        mountWithAuth();

        const res = await request(app)
          .post('/apps/test-app-id/publish/restart')
          .send();

        expect(res.status).toBe(200);
        expect(vi.mocked(DevSupervisorClientFactory.createForSocketPath)).toHaveBeenCalledWith(
          socketPath,
          'test-app-id'
        );
        expect(mockFindById).not.toHaveBeenCalled();
      } finally {
        unlinkSync(socketPath);
      }
    });

    it('falls back to app.publishSupervisorPath when socket file does not exist', async function fallback() {
      process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = '/nonexistent/publish.sock';
      const mockRestart = vi.fn().mockResolvedValue({ success: true });
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
        restartProcess: mockRestart,
      } as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/publish/restart')
        .send();

      expect(res.status).toBe(200);
      expect(vi.mocked(DevSupervisorClientFactory.createForSocketPath)).toHaveBeenCalledWith(
        'tcp://localhost:8878',
        'test-app-id'
      );
    });
  });
});

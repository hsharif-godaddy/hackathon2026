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

describe('Unpublish Route', () => {
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
        .post('/apps/test-app-id/unpublish')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Publish not allowed');
    });
  });

  describe('#ownership isolation', () => {
    it('rejects requests where siteId does not match app ID', async function ownership() {
      mountWithAuth({ siteId: 'different-site-id' });

      const res = await request(app)
        .post('/apps/test-app-id/unpublish')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });
  });

  describe('#app not found', () => {
    it('returns 404 when app does not exist', async function notFound() {
      mockFindById.mockReturnValue(null);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/unpublish')
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
        .post('/apps/test-app-id/unpublish')
        .send();

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Publish supervisor not available');
    });
  });

  describe('#successful unpublish', () => {
    it('returns success when supervisor reports success', async function success() {
      const mockUnpublish = vi.fn().mockResolvedValue({ status: 'success' });
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
        unpublish: mockUnpublish,
      } as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/unpublish')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('success');
      expect(mockUnpublish).toHaveBeenCalled();
    });

    it('returns success with not_published when already unpublished', async function idempotent() {
      const mockUnpublish = vi.fn().mockResolvedValue({ status: 'not_published' });
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
        unpublish: mockUnpublish,
      } as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/unpublish')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('not_published');
    });
  });

  describe('#supervisor failure', () => {
    it('returns 500 when supervisor throws', async function failure() {
      const mockUnpublish = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
        unpublish: mockUnpublish,
      } as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/unpublish')
        .send();

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to unpublish');
      expect(res.body.details).toBe('Connection refused');
    });
  });

  describe('#production socket path', () => {
    it('uses AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH when socket file exists', async function prodSocket() {
      const socketPath = path.join(os.tmpdir(), `unpublish-test-${Date.now()}.sock`);
      writeFileSync(socketPath, '');

      try {
        process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = socketPath;
        const mockUnpublish = vi.fn().mockResolvedValue({ status: 'success' });
        vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
          unpublish: mockUnpublish,
        } as any);
        mountWithAuth();

        const res = await request(app)
          .post('/apps/test-app-id/unpublish')
          .send();

        expect(res.status).toBe(200);
        expect(vi.mocked(DevSupervisorClientFactory.createForSocketPath)).toHaveBeenCalledWith(
          socketPath,
          'test-app-id'
        );
      } finally {
        unlinkSync(socketPath);
      }
    });

    it('falls back to app.publishSupervisorPath when socket file does not exist', async function fallback() {
      process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = '/nonexistent/publish.sock';
      const mockUnpublish = vi.fn().mockResolvedValue({ status: 'success' });
      vi.mocked(DevSupervisorClientFactory.createForSocketPath).mockReturnValue({
        unpublish: mockUnpublish,
      } as any);
      mountWithAuth();

      const res = await request(app)
        .post('/apps/test-app-id/unpublish')
        .send();

      expect(res.status).toBe(200);
      expect(vi.mocked(DevSupervisorClientFactory.createForSocketPath)).toHaveBeenCalledWith(
        'tcp://localhost:8878',
        'test-app-id'
      );
    });
  });
});

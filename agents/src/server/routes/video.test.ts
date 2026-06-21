/**
 * Video Route Tests
 *
 * Tests for GET /:id/video (stream) and DELETE /:id/video (clear cache) endpoints.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

const mockFindById = vi.fn();
const mockReadFile = vi.fn();
const mockAccess = vi.fn();
const mockUnlink = vi.fn();
const mockCreateReadStream = vi.fn();

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: mockFindById
  }; })
}));

const mockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

vi.mock('../../logging/index.js', () => ({
  Logger: { create: vi.fn(mockLogger) },
  log: {
    forApp: vi.fn(mockLogger),
    forAgent: vi.fn(mockLogger),
    error: vi.fn(),
  },
  logger: mockLogger(),
  errorToLogError: vi.fn(function (e: Error) { return { message: e.message }; }),
}));

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

vi.mock('node:fs', () => ({
  createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
}));

vi.mock('../../tools/video-generation-tool.js', () => ({
  VideoGenerationTool: vi.fn()
}));

vi.mock('../agent-runtime.js', () => ({
  getEventChannel: vi.fn(function () { return null; }),
}));

vi.mock('../../services/features.js', () => ({
  BYPASS_SITE_IDS: [] as string[],
}));

vi.mock('../../database/repositories/ConversationRepository.js', () => ({
  ConversationRepository: vi.fn()
}));

const videoRouter = await import('./video.js').then(m => m.default);

const appId = 'abcdefghij';
const appPath = `/tmp/apps/${appId}`;

function createApp(agentContext?: Record<string, unknown>): Express {
  const testApp = express();
  testApp.use(express.json());
  testApp.use((req, _res, next) => {
    if (agentContext) {
      (req as AuthenticatedRequest).agentContext = agentContext as any;
    }
    next();
  });
  testApp.use('/', videoRouter);
  return testApp;
}

function permittedContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    siteId: appId,
    canPublish: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe('video-routes', function videoTests() {
  describe('cross-tenant access', function crossTenantTests() {
    it('should reject GET when siteId does not match requested app id', async function rejectGetCrossTenant() {
      const app = createApp(permittedContext({ siteId: 'other-site' }));
      const response = await request(app).get(`/${appId}/video`).expect(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject DELETE when siteId does not match requested app id', async function rejectDeleteCrossTenant() {
      const app = createApp(permittedContext({ siteId: 'other-site' }));
      const response = await request(app).delete(`/${appId}/video`).expect(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject POST generate-video when siteId does not match requested app id', async function rejectPostCrossTenant() {
      const app = createApp(permittedContext({ siteId: 'other-site' }));
      const response = await request(app).post(`/${appId}/generate-video`).expect(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });
  });

  describe('GET /:id/video', function getTests() {
    let app: Express;

    beforeEach(() => {
      vi.clearAllMocks();
      app = createApp(permittedContext());
      mockFindById.mockReturnValue({ id: appId, path: appPath });
    });

    it('should return 401 when agentContext is missing', async function noAuth() {
      app = createApp();
      const response = await request(app).get(`/${appId}/video`).expect(401);
      expect(response.body).toHaveProperty('error', 'Authentication required');
    });

    it('should return 403 when canPublish is false', async function noPermission() {
      app = createApp(permittedContext({ canPublish: false }));
      const response = await request(app).get(`/${appId}/video`).expect(403);
      expect(response.body).toHaveProperty('error', 'Publish not allowed');
    });

    it('should return 404 when app is not found', async function appNotFound() {
      mockFindById.mockReturnValue(null);
      const response = await request(app).get(`/${appId}/video`).expect(404);
      expect(response.body).toHaveProperty('error', 'App not found');
    });

    it('should return 404 when video.json does not exist', async function metadataMissing() {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const response = await request(app).get(`/${appId}/video`).expect(404);
      expect(response.body).toHaveProperty('error', 'Video not found');
    });

    it('should return 404 when video status is not completed', async function notReady() {
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'pending' }));
      const response = await request(app).get(`/${appId}/video`).expect(404);
      expect(response.body).toHaveProperty('error', 'Video not ready');
    });

    it('should return 404 when video url is missing from metadata', async function noUrl() {
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'completed' }));
      const response = await request(app).get(`/${appId}/video`).expect(404);
      expect(response.body).toHaveProperty('error', 'Video not ready');
    });

    it('should return 400 when metadata.url escapes app.path (path traversal)', async function pathTraversal() {
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'completed', url: '../../etc/passwd' }));
      const response = await request(app).get(`/${appId}/video`).expect(400);
      expect(response.body).toHaveProperty('error', 'Invalid video path');
    });

    it('should return 404 when video file does not exist on disk', async function fileMissing() {
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'completed', url: 'output/video.mp4' }));
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const response = await request(app).get(`/${appId}/video`).expect(404);
      expect(response.body).toHaveProperty('error', 'Video file not found');
    });

    it('should stream video with correct headers on success', async function streamSuccess() {
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'completed', url: 'output/video.mp4' }));
      mockAccess.mockResolvedValue(undefined);

      const stream = new PassThrough();
      mockCreateReadStream.mockReturnValue(stream);
      process.nextTick(() => {
        stream.end(Buffer.from('fake-video-data'));
      });

      const response = await request(app).get(`/${appId}/video`).buffer(true);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('video/mp4');
      expect(response.headers['content-disposition']).toBe('attachment; filename="launch-video.mp4"');
      expect(mockCreateReadStream).toHaveBeenCalledWith(
        path.join(appPath, 'output/video.mp4')
      );
    });

    it('should destroy response when stream errors after headers are sent', async function streamError() {
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'completed', url: 'output/video.mp4' }));
      mockAccess.mockResolvedValue(undefined);

      const stream = Object.assign(new EventEmitter(), {
        pipe: vi.fn(function (dest: { destroy: () => void }) {
          process.nextTick(() => stream.emit('error', new Error('disk read failure')));
          return dest;
        }),
      });
      mockCreateReadStream.mockReturnValue(stream);

      // Does not throw — response is destroyed gracefully
      await request(app).get(`/${appId}/video`).buffer(true);
    });
  });

  describe('DELETE /:id/video', function deleteTests() {
    let app: Express;

    beforeEach(() => {
      vi.clearAllMocks();
      app = createApp(permittedContext());
      mockFindById.mockReturnValue({ id: appId, path: appPath });
      mockUnlink.mockResolvedValue(undefined);
    });

    it('should return 401 when agentContext is missing', async function noAuth() {
      app = createApp();
      const response = await request(app).delete(`/${appId}/video`).expect(401);
      expect(response.body).toHaveProperty('error', 'Authentication required');
    });

    it('should return 403 when canPublish is false', async function noPermission() {
      app = createApp(permittedContext({ canPublish: false }));
      const response = await request(app).delete(`/${appId}/video`).expect(403);
      expect(response.body).toHaveProperty('error', 'Publish not allowed');
    });

    it('should return 404 when app is not found', async function appNotFound() {
      mockFindById.mockReturnValue(null);
      const response = await request(app).delete(`/${appId}/video`).expect(404);
      expect(response.body).toHaveProperty('error', 'App not found');
    });

    it('should return 204 when video.json does not exist (idempotent)', async function metadataMissing() {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      await request(app).delete(`/${appId}/video`).expect(204);
    });

    it('should return 204 and delete both files when video exists', async function deleteSuccess() {
      const videoRelPath = 'output/video.mp4';
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'completed', url: videoRelPath }));

      await request(app).delete(`/${appId}/video`).expect(204);

      expect(mockUnlink).toHaveBeenCalledWith(path.join(appPath, videoRelPath));
      expect(mockUnlink).toHaveBeenCalledWith(path.join(appPath, '.airo', 'video.json'));
    });

    it('should skip video file deletion when metadata.url escapes app.path (path traversal)', async function pathTraversal() {
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'completed', url: '../../etc/passwd' }));

      await request(app).delete(`/${appId}/video`).expect(204);

      // Only video.json unlink should be called, not the traversed path
      expect(mockUnlink).not.toHaveBeenCalledWith(expect.stringContaining('etc/passwd'));
      expect(mockUnlink).toHaveBeenCalledWith(path.join(appPath, '.airo', 'video.json'));
    });

    it('should return 204 when metadata has no url field', async function noUrl() {
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'pending' }));
      await request(app).delete(`/${appId}/video`).expect(204);
      expect(mockUnlink).toHaveBeenCalledWith(path.join(appPath, '.airo', 'video.json'));
    });

    it('should return 204 even when video file unlink fails', async function videoFileMissing() {
      mockReadFile.mockResolvedValue(JSON.stringify({ status: 'completed', url: 'output/video.mp4' }));
      mockUnlink
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        .mockResolvedValueOnce(undefined);

      await request(app).delete(`/${appId}/video`).expect(204);
    });
  });
});

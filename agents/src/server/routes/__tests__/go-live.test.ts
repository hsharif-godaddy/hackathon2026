import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';

const { mockView, mockWrite, mockCreateForWorkspace } = vi.hoisted(() => ({
  mockView: vi.fn(),
  mockWrite: vi.fn(),
  mockCreateForWorkspace: vi.fn(),
}));

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
}));

const { MockDevSupervisorError } = vi.hoisted(() => {
  class DevSupervisorError extends Error {
    constructor(public readonly code: string, public readonly statusCode: number, message: string) {
      super(message);
      this.name = 'DevSupervisorError';
    }
  }
  return { MockDevSupervisorError: DevSupervisorError };
});

vi.mock('../../../services/DevSupervisorClient.js', () => ({
  DevSupervisorError: MockDevSupervisorError,
}));

import goLiveRouter from '../go-live.js';

function createTestApp(canPublish = true): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { agentContext?: unknown }, _res: Response, next: NextFunction) => {
    (req as Request & { agentContext: unknown }).agentContext = {
      siteId: 'test-app-id',
      canPublish,
    };
    next();
  });
  app.use('/', goLiveRouter);
  return app;
}

describe('go-live routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateForWorkspace.mockReturnValue({ files: { view: mockView, write: mockWrite } });
  });

  describe('GET /apps/:id/go-live-status', () => {
    it('returns the persisted status when live.json exists', async () => {
      mockView.mockResolvedValue({
        content: JSON.stringify({ hasGoneLive: true, wentLiveAt: '2026-01-01T00:00:00.000Z' }),
      });

      const res = await request(createTestApp()).get('/apps/test-app-id/go-live-status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasGoneLive: true, wentLiveAt: '2026-01-01T00:00:00.000Z' });
      expect(mockView).toHaveBeenCalledWith({ path: '.airo/live.json' });
    });

    it('returns default status when live.json does not exist', async () => {
      mockView.mockRejectedValue(
        new MockDevSupervisorError('not_found', 404, '.airo/live.json: no such file or directory'),
      );

      const res = await request(createTestApp()).get('/apps/test-app-id/go-live-status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasGoneLive: false, wentLiveAt: null });
    });

    it('returns default status when live.json is corrupted JSON', async () => {
      mockView.mockResolvedValue({ content: '{not-valid-json' });

      const res = await request(createTestApp()).get('/apps/test-app-id/go-live-status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasGoneLive: false, wentLiveAt: null });
    });

    it('returns 404 when no workspace exists for the app', async () => {
      mockCreateForWorkspace.mockReturnValue(null);

      const res = await request(createTestApp()).get('/apps/test-app-id/go-live-status');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'App not found' });
    });

    it('returns 500 on a non-not-found supervisor error', async () => {
      // Pins the catch narrow: permission_denied / 5xx / network errors must
      // not be confused with a missing file.
      mockView.mockRejectedValue(
        new MockDevSupervisorError('permission_denied', 403, '.airo/live.json: permission denied'),
      );

      const res = await request(createTestApp()).get('/apps/test-app-id/go-live-status');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to read go-live status');
      expect(res.body.details).toContain('permission denied');
    });
  });

  describe('POST /apps/:id/mark-gone-live', () => {
    it('writes live.json and returns the new status on success', async () => {
      mockWrite.mockResolvedValue({ bytesWritten: 64 });

      const res = await request(createTestApp()).post('/apps/test-app-id/mark-gone-live');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.hasGoneLive).toBe(true);
      expect(typeof res.body.wentLiveAt).toBe('string');
      expect(mockWrite).toHaveBeenCalledTimes(1);
      const writeCall = mockWrite.mock.calls[0]![0];
      expect(writeCall.path).toBe('.airo/live.json');
      const parsed = JSON.parse(writeCall.content);
      expect(parsed.hasGoneLive).toBe(true);
      expect(parsed.wentLiveAt).toBe(res.body.wentLiveAt);
    });

    it('returns 403 when canPublish is false', async () => {
      const res = await request(createTestApp(false)).post('/apps/test-app-id/mark-gone-live');

      expect(res.status).toBe(403);
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('returns 404 when no workspace exists for the app', async () => {
      mockCreateForWorkspace.mockReturnValue(null);

      const res = await request(createTestApp()).post('/apps/test-app-id/mark-gone-live');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'App not found' });
    });

    it('returns 500 when the supervisor write fails', async () => {
      mockWrite.mockRejectedValue(
        new MockDevSupervisorError('permission_denied', 403, '.airo/live.json: permission denied'),
      );

      const res = await request(createTestApp()).post('/apps/test-app-id/mark-gone-live');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to mark app as gone live');
      expect(res.body.details).toContain('permission denied');
    });
  });
});

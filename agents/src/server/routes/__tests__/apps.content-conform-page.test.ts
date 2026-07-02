/**
 * Route tests for POST /apps/:id/content/conform-page.
 *
 * Mirrors apps.content-mutate.test.ts structure. The route delegates to
 * `conformPageToContentLayer`; we mock that function and verify the HTTP
 * contract (validation, 404, 200) without running the real conform logic
 * (which has its own deep test suite).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mkdir, rm } from 'node:fs/promises';
import { appsRouter } from '../apps.js';
import { AppRepository } from '../../../database/index.js';

// Mock the workspace module (required by the route's import of conformPageToContentLayer,
// which in turn calls createForWorkspace; stub it so tests don't need a real workspace).
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

// Mock the conform service — we test HTTP contract here, not conform logic.
vi.mock('../../../services/content-conform.js', () => ({
  conformPageToContentLayer: vi.fn(),
}));

vi.mock('../../../utils/git.js', () => {
  function GitUtils() {}
  GitUtils.prototype.commitFilesIfChanged = vi.fn();
  GitUtils.prototype.getCurrentCommit = vi.fn();
  return { GitUtils };
});

import { conformPageToContentLayer } from '../../../services/content-conform.js';

const createTestApp = (siteId = 'local-dev-site'): express.Express => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.agentContext = { siteId };
    next();
  });
  app.use('/apps', appsRouter);
  return app;
};

describe('POST /apps/:id/content/conform-page', () => {
  let app: express.Express;
  let appRepo: AppRepository;
  let testAppId: string;
  let testAppPath: string;

  beforeAll(() => {
    app = createTestApp();
    appRepo = new AppRepository();
  });

  beforeEach(async () => {
    testAppPath = `/tmp/test-conform-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await mkdir(testAppPath, { recursive: true });

    const result = await appRepo.registerOrUpdateApp({
      siteId: 'local-dev-site',
      name: 'Test Conform App',
      appPath: testAppPath,
      initialPrompt: 'Test app for conform-page',
    });
    testAppId = result.app.id;
    appRepo.update(testAppId, { path: testAppPath });

    vi.mocked(conformPageToContentLayer).mockResolvedValue({ note: 'Conformed.', source: null });
  });

  afterEach(async () => {
    if (testAppId) {
      try { await appRepo.delete(testAppId); } catch { /* best-effort */ }
    }
    try { await rm(testAppPath, { recursive: true, force: true }); } catch { /* best-effort */ }
    vi.clearAllMocks();
  });

  it('valid page returns 200 { ok: true, applied: true } when conform applied', async () => {
    vi.mocked(conformPageToContentLayer).mockResolvedValueOnce({ note: 'Conformed.', source: null });

    const response = await request(app)
      .post(`/apps/${testAppId}/content/conform-page`)
      .send({ page: 'src/pages/index.tsx' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, applied: true });
    expect(vi.mocked(conformPageToContentLayer)).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: testAppId,
        trigger: 'heal',
        command: 'str_replace',
        isPageCreate: false,
      }),
    );
  });

  it('valid page + well-formed conformId returns 200 and forwards conformId', async () => {
    vi.mocked(conformPageToContentLayer).mockResolvedValueOnce({ note: 'Conformed.', source: null });

    const response = await request(app)
      .post(`/apps/${testAppId}/content/conform-page`)
      .send({ page: 'src/pages/services.tsx', conformId: 'L2C8' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, applied: true });
    expect(vi.mocked(conformPageToContentLayer)).toHaveBeenCalledWith(
      expect.objectContaining({ conformId: 'L2C8', trigger: 'heal' }),
    );
  });

  it('malformed conformId returns 400 invalid-value', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/conform-page`)
      .send({ page: 'src/pages/services.tsx', conformId: 'bad' });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('invalid-value');
    expect(vi.mocked(conformPageToContentLayer)).not.toHaveBeenCalled();
  });

  it('non-string conformId returns 400 invalid-value', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/conform-page`)
      .send({ page: 'src/pages/services.tsx', conformId: 42 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-value');
    expect(vi.mocked(conformPageToContentLayer)).not.toHaveBeenCalled();
  });

  it('valid page returns 200 { ok: true, applied: false } when nothing to conform', async () => {
    vi.mocked(conformPageToContentLayer).mockResolvedValueOnce({ note: null, source: 'const x = 1;' });

    const response = await request(app)
      .post(`/apps/${testAppId}/content/conform-page`)
      .send({ page: 'src/pages/about.tsx' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, applied: false });
  });

  it('missing page returns 400 invalid-value', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/conform-page`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('invalid-value');
  });

  it('page without src/pages/ prefix returns 400 invalid-value', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/conform-page`)
      .send({ page: 'pages/index.tsx' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-value');
  });

  it('page with nested path (subdirectory) returns 400 invalid-value', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/conform-page`)
      .send({ page: 'src/pages/sub/index.tsx' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-value');
  });

  it('unknown app returns 404', async () => {
    const response = await request(app)
      .post('/apps/unknownappid/content/conform-page')
      .send({ page: 'src/pages/index.tsx' });

    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('app-not-found');
  });
});

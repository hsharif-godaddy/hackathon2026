import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { appsRouter } from '../apps.js';
import { AppRepository } from '../../../database/index.js';
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js';

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () { return { files: createStubWorkspaceFiles({ readText: vi.fn().mockResolvedValue('') }) }; }),
}));

vi.mock('../../../utils/git.js', () => {
  function GitUtils() {}
  GitUtils.prototype.commitFilesIfChanged = vi.fn();
  GitUtils.prototype.getCurrentCommit = vi.fn();
  return { GitUtils };
});

import { createForWorkspace } from '../../../workspace/index.js';
import { GitUtils } from '../../../utils/git.js';

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

async function seedContent(appPath: string): Promise<void> {
  const contentDir = join(appPath, 'src', 'content');
  await mkdir(join(contentDir, 'pages'), { recursive: true });
  await mkdir(join(contentDir, 'data'), { recursive: true });
  await writeFile(
    join(contentDir, 'site.json'),
    JSON.stringify({ brand: 'Acme', tagline: 'Old tagline' }, null, 2) + '\n',
  );
  await writeFile(
    join(contentDir, 'pages', 'home.json'),
    JSON.stringify({ hero: { title: 'Welcome', subtitle: 'Sub' } }, null, 2) + '\n',
  );
  await writeFile(
    join(contentDir, 'data', 'products.json'),
    JSON.stringify(
      [
        { id: 'aa111111', name: 'Alpha' },
        { id: 'bb222222', name: 'Beta' },
      ],
      null,
      2,
    ) + '\n',
  );
}

describe('POST /apps/:id/content/mutate', () => {
  let app: express.Express;
  let appRepo: AppRepository;
  let testAppId: string;
  let testAppPath: string;

  beforeAll(async () => {
    app = createTestApp();
    appRepo = new AppRepository();
  });

  beforeEach(async () => {
    testAppPath = `/tmp/test-content-mutate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await mkdir(testAppPath, { recursive: true });
    await seedContent(testAppPath);

    const result = await appRepo.registerOrUpdateApp({
      siteId: 'local-dev-site',
      name: 'Test Mutate App',
      appPath: testAppPath,
      initialPrompt: 'Test app for content mutation',
    });
    testAppId = result.app.id;
    appRepo.update(testAppId, { path: testAppPath });
  });

  afterEach(async () => {
    if (testAppId) {
      try { await appRepo.delete(testAppId); } catch { /* best-effort cleanup */ }
    }
    try { await rm(testAppPath, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  it('insert returns ok, file, id, and writes 3 items to disk', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ op: 'insert', collectionKey: 'products', item: { name: 'Gamma' } });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(typeof response.body.file).toBe('string');
    expect(response.body.file).toContain('products.json');
    expect(typeof response.body.id).toBe('string');
    expect(response.body.id.length).toBeGreaterThan(0);

    const content = JSON.parse(
      await readFile(join(testAppPath, 'src', 'content', 'data', 'products.json'), 'utf8'),
    ) as Array<{ id: string; name: string }>;
    expect(content).toHaveLength(3);
    expect(content[2].name).toBe('Gamma');
    expect(typeof content[2].id).toBe('string');
  });

  it('remove drops the item from the array', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ op: 'remove', collectionKey: 'products', itemId: 'aa111111' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    const content = JSON.parse(
      await readFile(join(testAppPath, 'src', 'content', 'data', 'products.json'), 'utf8'),
    ) as Array<{ id: string; name: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].id).toBe('bb222222');
  });

  it('reorder writes the new order to disk', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ op: 'reorder', collectionKey: 'products', order: ['bb222222', 'aa111111'] });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    const content = JSON.parse(
      await readFile(join(testAppPath, 'src', 'content', 'data', 'products.json'), 'utf8'),
    ) as Array<{ id: string; name: string }>;
    expect(content[0].id).toBe('bb222222');
    expect(content[1].id).toBe('aa111111');
  });

  it('returns 400 with invalid-value when op is missing', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ collectionKey: 'products', item: { name: 'X' } });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'invalid-value' } });
  });

  it('returns 400 with invalid-value when op is unknown', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ op: 'upsert', collectionKey: 'products', item: { name: 'X' } });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'invalid-value' } });
  });

  it('returns 400 with invalid-value when collectionKey is missing', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ op: 'insert', item: { name: 'X' } });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'invalid-value' } });
  });

  it('returns 400 when collectionKey resolves to a non-array (site.brand)', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ op: 'insert', collectionKey: 'site.brand', item: { name: 'X' } });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('not-an-array');
  });

  it('returns 404 when the app does not exist', async () => {
    const response = await request(app)
      .post('/apps/nonexistent1/content/mutate')
      .send({ op: 'insert', collectionKey: 'products', item: { name: 'X' } });

    expect(response.status).toBe(404);
  });

  it('rejects cross-tenant access with non-bypass siteId', async () => {
    const ownerSiteId = 'cccccccccc';
    const attackerSiteId = 'dddddddddd';

    await appRepo.registerOrUpdateApp({
      siteId: ownerSiteId,
      name: 'Owned App',
      appPath: testAppPath,
      initialPrompt: 'test',
    });

    const attackerApp = createTestApp(attackerSiteId);
    const response = await request(attackerApp)
      .post(`/apps/${ownerSiteId}/content/mutate`)
      .send({ op: 'insert', collectionKey: 'products', item: { name: 'Hacked' } });

    expect(response.status).toBe(403);

    const content = JSON.parse(
      await readFile(join(testAppPath, 'src', 'content', 'data', 'products.json'), 'utf8'),
    ) as Array<{ id: string; name: string }>;
    expect(content).toHaveLength(2);

    await appRepo.delete(ownerSiteId);
  });
});

describe('POST /apps/:id/content/mutate — git commit', () => {
  let app: express.Express;
  let appRepo: AppRepository;
  let testAppId: string;
  let testAppPath: string;

  beforeAll(() => {
    app = createTestApp();
    appRepo = new AppRepository();
  });

  beforeEach(async () => {
    testAppPath = `/tmp/test-content-mutate-git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await mkdir(testAppPath, { recursive: true });
    await seedContent(testAppPath);

    const result = await appRepo.registerOrUpdateApp({
      siteId: 'local-dev-site',
      name: 'Test Mutate Git App',
      appPath: testAppPath,
      initialPrompt: 'Test app for mutation git commit',
    });
    testAppId = result.app.id;
    appRepo.update(testAppId, { path: testAppPath });

    vi.mocked(GitUtils.prototype.commitFilesIfChanged).mockResolvedValue(true);
    vi.mocked(GitUtils.prototype.getCurrentCommit).mockResolvedValue('def5678');
    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {} } as any);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testAppId) {
      try { await appRepo.delete(testAppId); } catch { /* best-effort cleanup */ }
    }
    try { await rm(testAppPath, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  it('insert returns commitHash from GitUtils.getCurrentCommit', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ op: 'insert', collectionKey: 'products', item: { name: 'Delta' } });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.commitHash).toBe('def5678');
    expect(vi.mocked(GitUtils.prototype.commitFilesIfChanged)).toHaveBeenCalledWith(
      testAppPath,
      expect.stringContaining('products'),
      expect.arrayContaining([expect.stringContaining('products.json')]),
    );
  });

  it('lockfile is committed alongside the JSON when present', async () => {
    // Write a lockfile so commitContentFile finds it and stages it too
    const contentDir = join(testAppPath, 'src', 'content');
    await writeFile(
      join(contentDir, '.user-edits.json'),
      JSON.stringify({ version: 1, locks: [] }, null, 2) + '\n',
    );

    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ op: 'insert', collectionKey: 'products', item: { name: 'Echo' } });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    expect(vi.mocked(GitUtils.prototype.commitFilesIfChanged)).toHaveBeenCalledWith(
      testAppPath,
      expect.any(String),
      expect.arrayContaining([
        expect.stringContaining('products.json'),
        expect.stringContaining('.user-edits.json'),
      ]),
    );
  });

  it('returns 200 even when commitFilesIfChanged throws (commit is non-fatal)', async () => {
    vi.mocked(GitUtils.prototype.commitFilesIfChanged).mockRejectedValue(new Error('git error'));

    const response = await request(app)
      .post(`/apps/${testAppId}/content/mutate`)
      .send({ op: 'insert', collectionKey: 'products', item: { name: 'Foxtrot' } });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.commitHash).toBeUndefined();
  });
});

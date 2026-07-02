import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { appsRouter } from '../apps.js';
import { AppRepository } from '../../../database/index.js';

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () { return { files: { readText: vi.fn().mockResolvedValue('') } }; }),
}));

vi.mock('../../../utils/git.js', () => {
  function GitUtils() {}
  GitUtils.prototype.commitFilesIfChanged = vi.fn();
  GitUtils.prototype.getCurrentCommit = vi.fn();
  return { GitUtils };
});

import { createForWorkspace } from '../../../workspace/index.js';
import { GitUtils } from '../../../utils/git.js';

const createTestApp = (siteId = 'local-dev-site') => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.agentContext = { siteId };
    next();
  });
  app.use('/apps', appsRouter);
  return app;
};

async function seedContent(appPath: string) {
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
    JSON.stringify([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], null, 2) + '\n',
  );
}

describe('POST /apps/:id/content/edit', () => {
  let app: express.Express;
  let appRepo: AppRepository;
  let testAppId: string;
  let testAppPath: string;

  beforeAll(async () => {
    app = createTestApp();
    appRepo = new AppRepository();
  });

  beforeEach(async () => {
    testAppPath = `/tmp/test-content-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await mkdir(testAppPath, { recursive: true });
    await seedContent(testAppPath);

    const result = await appRepo.registerOrUpdateApp({
      siteId: 'local-dev-site',
      name: 'Test CMS App',
      appPath: testAppPath,
      initialPrompt: 'Test app for content editing',
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

  it('edits a page field and writes it to the file', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'home.hero.title', kind: 'copy', value: 'New Title' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.file).toContain('pages/home.json');

    const content = JSON.parse(await readFile(join(testAppPath, 'src', 'content', 'pages', 'home.json'), 'utf8'));
    expect(content.hero.title).toBe('New Title');
    expect(content.hero.subtitle).toBe('Sub');
  });

  it('edits a list item', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'products[1].name', kind: 'copy', value: 'New B' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    const content = JSON.parse(await readFile(join(testAppPath, 'src', 'content', 'data', 'products.json'), 'utf8'));
    expect(content[1].name).toBe('New B');
    expect(content[0].name).toBe('A');
  });

  it('coerces a numeric string to a number for a numeric collection field', async () => {
    const productsPath = join(testAppPath, 'src', 'content', 'data', 'products.json');
    await writeFile(
      productsPath,
      JSON.stringify([{ id: 'p1', name: 'Widget', price: 19.99 }], null, 2) + '\n',
    );

    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'products[0].price', kind: 'copy', value: '29.95' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    const content = JSON.parse(await readFile(productsPath, 'utf8'));
    expect(typeof content[0].price).toBe('number');
    expect(content[0].price).toBe(29.95);
  });

  it('rejects a non-string expectedCurrent with 400 invalid-value', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'home.hero.title', kind: 'copy', value: 'Hi', expectedCurrent: 123 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'invalid-value' } });
  });

  it('rejects a non-numeric string for a numeric collection field with invalid-value', async () => {
    const productsPath = join(testAppPath, 'src', 'content', 'data', 'products.json');
    await writeFile(
      productsPath,
      JSON.stringify([{ id: 'p1', name: 'Widget', price: 19.99 }], null, 2) + '\n',
    );

    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'products[0].price', kind: 'copy', value: 'abc' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'invalid-value' } });

    // File must be unchanged
    const content = JSON.parse(await readFile(productsPath, 'utf8'));
    expect(content[0].price).toBe(19.99);
  });

  it('rejects a boolean field with 400 type-unsupported, file unchanged', async () => {
    const productsPath = join(testAppPath, 'src', 'content', 'data', 'products.json');
    await writeFile(
      productsPath,
      JSON.stringify([{ id: 'p1', name: 'Widget', featured: true }], null, 2) + '\n',
    );

    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'products[0].featured', kind: 'copy', value: 'false' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'type-unsupported' } });

    const content = JSON.parse(await readFile(productsPath, 'utf8'));
    expect(content[0].featured).toBe(true);
  });

  it('returns 400 with structured error when the path is missing', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'home.hero.nonexistent', kind: 'copy', value: 'x' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'missing-path' } });
  });

  it('returns 400 when the root is unknown', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'unknown.field', kind: 'copy', value: 'x' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'unknown-root' } });
  });

  it('returns 400 on invalid body shape', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'site.brand', kind: 'weird', value: 'x' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'invalid-value' } });
  });

  it('returns 404 when the app does not exist', async () => {
    const response = await request(app)
      .post('/apps/nonexistent1/content/edit')
      .send({ contentKey: 'site.brand', kind: 'copy', value: 'x' });

    expect(response.status).toBe(404);
  });

  it('is covered by validateAppOwnership middleware (routes under /:id/...)', async () => {
    // Ownership middleware is applied via router.use('/:id(...)', validateAppOwnership)
    // and is exhaustively tested in middleware/__tests__/app-ownership.test.ts.
    // This smoke check only confirms the route matches the guarded pattern by
    // verifying that an unknown short-id path goes through the handler layer
    // (returns 404 from appRepo.findById, not a 400 from validation).
    const response = await request(app)
      .post('/apps/abcdefghij/content/edit')
      .send({ contentKey: 'site.brand', kind: 'copy', value: 'x' });
    expect(response.status).toBe(404);
  });

  it('returns 400 derived-mismatch when expectedCurrent does not match the stored value', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'home.hero.title', kind: 'copy', value: 'New Title', expectedCurrent: 'Stale Value' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'derived-mismatch' } });

    const content = JSON.parse(await readFile(join(testAppPath, 'src', 'content', 'pages', 'home.json'), 'utf8'));
    expect(content.hero.title).toBe('Welcome');
  });

  it('rejects cross-tenant access with non-bypass siteId', async () => {
    // App IDs must match the middleware regex ([a-z0-9]{10} or UUID) for
    // validateAppOwnership to fire. registerOrUpdateApp uses siteId as the
    // app ID, so we need 10-char lowercase-alphanumeric siteIds.
    const ownerSiteId = 'aaaaaaaaaa';
    const attackerSiteId = 'bbbbbbbbbb';

    const ownerApp = createTestApp(ownerSiteId);
    const result = await appRepo.registerOrUpdateApp({
      siteId: ownerSiteId,
      name: 'Owned App',
      appPath: testAppPath,
      initialPrompt: 'test',
    });
    appRepo.update(ownerSiteId, { path: testAppPath });

    // Attacker has a different siteId — middleware rejects
    const attackerApp = createTestApp(attackerSiteId);
    const response = await request(attackerApp)
      .post(`/apps/${ownerSiteId}/content/edit`)
      .send({ contentKey: 'site.brand', kind: 'copy', value: 'hacked' });

    expect(response.status).toBe(403);

    // Verify file was NOT modified
    const content = JSON.parse(
      await readFile(join(testAppPath, 'src', 'content', 'site.json'), 'utf8'),
    );
    expect(content.brand).toBe('Acme');

    await appRepo.delete(ownerSiteId);
  });
});

describe('POST /apps/:id/content/edit — git commit', () => {
  let app: express.Express;
  let appRepo: AppRepository;
  let testAppId: string;
  let testAppPath: string;
  beforeAll(() => {
    app = createTestApp();
    appRepo = new AppRepository();
  });

  beforeEach(async () => {
    testAppPath = `/tmp/test-content-git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await mkdir(testAppPath, { recursive: true });
    await seedContent(testAppPath);

    const result = await appRepo.registerOrUpdateApp({
      siteId: 'local-dev-site',
      name: 'Test Git Commit App',
      appPath: testAppPath,
      initialPrompt: 'Test app for git commit',
    });
    testAppId = result.app.id;
    appRepo.update(testAppId, { path: testAppPath });

    // Reset prototype spies to happy-path defaults
    vi.mocked(GitUtils.prototype.commitFilesIfChanged).mockResolvedValue(true);
    vi.mocked(GitUtils.prototype.getCurrentCommit).mockResolvedValue('abc1234');
    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {} } as any);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testAppId) {
      try { await appRepo.delete(testAppId); } catch { /* best-effort cleanup */ }
    }
    try { await rm(testAppPath, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  it('calls commitFilesIfChanged with app.path and the relative content file path on success', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'home.hero.title', kind: 'copy', value: 'Committed Title' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(vi.mocked(GitUtils.prototype.commitFilesIfChanged)).toHaveBeenCalledWith(
      testAppPath,
      'Update content: home.hero.title',
      expect.arrayContaining([expect.stringContaining('src/content/pages/home.json')]),
    );
    expect(response.body.commitHash).toBe('abc1234');
  });

  it('includes the user-edit lock file in the same commit when present', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'home.hero.title', kind: 'copy', value: 'Locked Title' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    // The successful edit records .user-edits.json on disk, so commitContentFile
    // stages + commits it alongside the content file in a single commit.
    const expectedFiles = [
      expect.stringContaining('src/content/pages/home.json'),
      expect.stringContaining('src/content/.user-edits.json'),
    ];
    expect(vi.mocked(GitUtils.prototype.commitFilesIfChanged)).toHaveBeenCalledWith(
      testAppPath,
      'Update content: home.hero.title',
      expect.arrayContaining(expectedFiles),
    );
  });

  it('returns 200 even when commitFilesIfChanged throws (commit is non-fatal)', async () => {
    vi.mocked(GitUtils.prototype.commitFilesIfChanged).mockRejectedValue(new Error('git error'));

    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'site.brand', kind: 'copy', value: 'Still Saved' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.commitHash).toBeUndefined();
  });

  it('treats a no-op commit (nothing to commit) as success and returns the current SHA', async () => {
    // commitFilesIfChanged returns false when the serialized value already
    // matches disk (e.g. focus/blur with no real change), detected structurally
    // via `git status --porcelain`. The edit succeeded — the value on disk is
    // correct — so we must NOT signal failure (undefined commitHash) and must
    // NOT emit commit-failed.
    vi.mocked(GitUtils.prototype.commitFilesIfChanged).mockResolvedValue(false);
    vi.mocked(GitUtils.prototype.getCurrentCommit).mockResolvedValue('noop5678');

    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'site.brand', kind: 'copy', value: 'Same Value' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.commitHash).toBe('noop5678');
  });

  it('returns 200 when createForWorkspace returns null (no workspace — commit skipped)', async () => {
    vi.mocked(createForWorkspace).mockReturnValue(null as any);

    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'site.brand', kind: 'copy', value: 'No Workspace' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.commitHash).toBeUndefined();
  });

  it('returns 400 with parse-failed when the backing file contains malformed JSON', async () => {
    const { join } = await import('path');
    const { writeFile } = await import('fs/promises');
    await writeFile(join(testAppPath, 'src', 'content', 'site.json'), '{ bad json', 'utf8');

    const response = await request(app)
      .post(`/apps/${testAppId}/content/edit`)
      .send({ contentKey: 'site.brand', kind: 'copy', value: 'x' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: { code: 'parse-failed' } });
  });
});

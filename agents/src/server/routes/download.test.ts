/**
 * Download Route Tests
 *
 * Tests JWT-based authorization and archive error handling for app download operations
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

// Mock dependencies BEFORE imports
const mockFindById = vi.fn();
const mockArchiverFn = vi.fn();
const mockCreateForWorkspace = vi.fn();

vi.mock('../../database/index.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: mockFindById
  }; })
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
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
}));

vi.mock('../../config/app-download.js', () => ({
  ALLOWED_DIRECTORIES: ['src', 'public'],
  ALLOWED_CONFIG_FILES: ['package.json', '.env.example']
}));

vi.mock('archiver', () => ({
  default: mockArchiverFn,
}));

// Import after mocks
const downloadRouter = await import('./download.js').then(m => m.default);
const { BYPASS_SITE_IDS } = await import('../../services/features.js');

describe('Download Route Authorization', () => {
  let app: Express;
  const appId = 'abcdefghij';

  function createApp(agentContext?: Record<string, unknown>): Express {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, res, next) => {
      if (agentContext) {
        (req as AuthenticatedRequest).agentContext = agentContext as any;
      }
      next();
    });
    testApp.use('/', downloadRouter);
    return testApp;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    app = createApp({
      siteId: appId,
      canDownload: false,
      canPublish: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    });
  });

  describe('App Ownership Validation', () => {
    it('should reject cross-tenant download attempts', async function rejectCrossTenant() {
      app = createApp({
        siteId: 'aaaaaaaaaa',
        canDownload: true,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      const response = await request(app)
        .get(`/apps/bbbbbbbbbb/zip`)
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Access denied');
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should allow same-tenant download when ownership matches', async function allowSameTenant() {
      app = createApp({
        siteId: appId,
        canDownload: true,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .get(`/apps/${appId}/zip`)
        .expect(404);

      expect(response.body).toEqual({ error: 'App not found' });
      expect(mockFindById).toHaveBeenCalledWith(appId);
    });

    it('should reject when agentContext is missing', async function rejectNoContext() {
      app = createApp();

      const response = await request(app)
        .get(`/apps/${appId}/zip`)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication required');
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should check ownership before permission', async function ownershipFirst() {
      app = createApp({
        siteId: 'aaaaaaaaaa',
        canDownload: true,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      mockFindById.mockImplementation(function () {
        throw new Error('Should not reach here');
      });

      const response = await request(app)
        .get(`/apps/bbbbbbbbbb/zip`)
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Access denied');
      expect(mockFindById).not.toHaveBeenCalled();
    });
  });

  describe('BYPASS_SITE_IDS', () => {
    BYPASS_SITE_IDS.forEach(function iterate(bypassSite) {
      it(`should allow ${bypassSite} to download any app`, async function allowBypass() {
        app = createApp({
          siteId: bypassSite,
          canDownload: true,
          canPublish: false,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        });

        mockFindById.mockReturnValue(null);

        const response = await request(app)
          .get('/apps/any-other-app-123/zip')
          .expect(404);

        expect(response.body).toEqual({ error: 'App not found' });
        expect(mockFindById).toHaveBeenCalledWith('any-other-app-123');
      });
    });

    it('should still require canDownload permission for bypass sites', async function bypassNeedsPermission() {
      app = createApp({
        siteId: BYPASS_SITE_IDS[0],
        canDownload: false,
        canPublish: false,
        isE2S: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      const response = await request(app)
        .get('/apps/any-other-app-123/zip')
        .expect(403);

      expect(response.body.error).toBe('Download not allowed');
      expect(mockFindById).not.toHaveBeenCalled();
    });
  });

  describe('JWT Permission Checks', () => {
    it('should reject download when canDownload is false', async function rejectNoPermission() {
      const response = await request(app)
        .get(`/apps/${appId}/zip`)
        .expect(403);

      expect(response.body).toEqual({
        error: 'Download not allowed',
        details: 'Downloading requires a paid Airo Builder plan'
      });
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should reject download when canDownload is undefined', async function rejectUndefined() {
      app = createApp({
        siteId: appId,
        canDownload: undefined,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      const response = await request(app)
        .get(`/apps/${appId}/zip`)
        .expect(403);

      expect(response.body.error).toBe('Download not allowed');
    });

    it('should not allow download with only canPublish permission', async function rejectPublishOnly() {
      app = createApp({
        siteId: appId,
        canDownload: false,
        canPublish: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      const response = await request(app)
        .get(`/apps/${appId}/zip`)
        .expect(403);

      expect(response.body.error).toBe('Download not allowed');
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it.skip('should allow download when canDownload is true', async function allowWithPermission() {
      // Skip reason: requires filesystem mocking for archiver
      app = createApp({
        siteId: appId,
        canDownload: true,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .get(`/apps/${appId}/zip`)
        .expect(404);

      expect(mockFindById).toHaveBeenCalledWith(appId);
      expect(response.body).toEqual({ error: 'App not found' });
    });
  });

  describe('App Validation', () => {
    beforeEach(() => {
      app = createApp({
        siteId: appId,
        canDownload: true,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });
    });

    it('should return 404 when app ID segment is empty (Express routing)', async function rejectEmptyId() {
      await request(app)
        .get('/apps//zip')
        .expect(404);

      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should return 404 when app does not exist', async function rejectNotFound() {
      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .get(`/apps/${appId}/zip`)
        .expect(404);

      expect(response.body).toEqual({ error: 'App not found' });
      expect(mockFindById).toHaveBeenCalledWith(appId);
    });

    it.skip('should return 400 when app has no path', async function rejectNoPath() {
      // Skip reason: requires filesystem mocking
      mockFindById.mockReturnValue({
        id: appId,
        name: 'Test App',
        path: null
      });

      const response = await request(app)
        .get(`/apps/${appId}/zip`)
        .expect(400);

      expect(response.body).toEqual({
        error: 'App download is not available',
        details: 'This app does not have local files. Only local development apps can be downloaded.'
      });
    });
  });

  describe('Security - Middleware Ordering', () => {
    it('should check permission before any app operations', async function permissionBeforeDb() {
      mockFindById.mockImplementation(function () {
        throw new Error('Should not reach here');
      });

      const response = await request(app)
        .get(`/apps/${appId}/zip`)
        .expect(403);

      expect(response.body.error).toBe('Download not allowed');
      expect(mockFindById).not.toHaveBeenCalled();
    });
  });
});

describe('Archive Workspace Integration', () => {
  let app: Express;
  let mockArchive: EventEmitter & Record<string, any>;
  const appId = 'klmnopqrst';

  function createPermittedApp(): Express {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as AuthenticatedRequest).agentContext = {
        siteId: appId,
        canDownload: true,
        canPublish: false,
        isE2S: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      };
      next();
    });
    testApp.use('/', downloadRouter);
    return testApp;
  }

  function makeArchive() {
    const archive: any = Object.assign(new EventEmitter(), {
      pipe: vi.fn(function pipeImpl(this: PassThrough, target: any) {
        // Default: emit a tiny payload and end the response stream so
        // supertest sees a finished response.
        process.nextTick(() => {
          target.write(Buffer.from('zip'));
          target.end();
        });
      }),
      append: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      pointer: vi.fn(function () { return 1234; }),
    });
    return archive;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockArchive = makeArchive();
    mockArchiverFn.mockReturnValue(mockArchive);

    mockFindById.mockReturnValue({
      id: appId,
      name: 'Test App',
      path: `/tmp/apps/${appId}/app`,
    });

    app = createPermittedApp();
  });

  it('returns 503 when workspace is unavailable', async () => {
    mockCreateForWorkspace.mockReturnValue(null);

    const response = await request(app)
      .get(`/apps/${appId}/zip`)
      .expect(503);

    expect(response.body.error).toBe('App workspace is not available');
  });

  /**
   * Build a strict, Map-keyed workspace mock so unknown paths reject. Encodes
   * dev-supervisor's contract: tree returns workspace-rooted entries (the
   * request `path` is already joined in); download paths are workspace-root
   * relative. Both flow through unchanged.
   */
  function strictWorkspace(opts: {
    tree?: Record<string, Array<{ path: string; kind: 'file' | 'directory' }>>;
    files?: Record<string, Buffer | Error>;
  }) {
    const treeMap = new Map(Object.entries(opts.tree ?? {}));
    const fileMap = new Map(Object.entries(opts.files ?? {}));

    const tree = vi.fn(async function ({ path }: { path: string }) {
      const entries = treeMap.get(path);
      if (!entries) {
        const err: any = new (await import('../../services/DevSupervisorClient.js')).DevSupervisorError('not_found', 404, `${path}: not found`);
        throw err;
      }
      return { entries: entries.map((e) => ({ ...e, size: 1, modifiedAt: '' })), truncated: false };
    });

    const download = vi.fn(async function ({ path }: { path: string }) {
      const data = fileMap.get(path);
      if (data instanceof Error) throw data;
      if (!data) {
        const err: any = new (await import('../../services/DevSupervisorClient.js')).DevSupervisorError('not_found', 404, `${path}: not found`);
        throw err;
      }
      return { data, contentType: 'application/octet-stream' };
    });

    return { tree, download };
  }

  it('streams a zip archive built from workspace files', async () => {
    const ws = strictWorkspace({
      tree: {
        src: [
          { path: 'src/index.ts', kind: 'file' },
          { path: 'src/components/Foo.tsx', kind: 'file' },
        ],
        public: [{ path: 'public/logo.png', kind: 'file' }],
      },
      files: {
        'src/index.ts': Buffer.from('export {}'),
        'src/components/Foo.tsx': Buffer.from('export const Foo = () => null'),
        'public/logo.png': Buffer.from('PNG'),
        'package.json': Buffer.from('{}'),
      },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    const response = await request(app)
      .get(`/apps/${appId}/zip?nameStyle=appId`)
      .buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(ws.tree).toHaveBeenCalledWith({ path: 'src', recursive: true });
    expect(ws.tree).toHaveBeenCalledWith({ path: 'public', recursive: true });

    // Tree entries flow straight through to download with no transformation.
    const downloadedPaths = ws.download.mock.calls.map((c) => c[0].path);
    expect(downloadedPaths).toEqual(
      expect.arrayContaining([
        'src/index.ts',
        'src/components/Foo.tsx',
        'public/logo.png',
        'package.json',
      ]),
    );
    // Pin the bug shape directly: a re-added `${dir}/` re-prefix would emit
    // the bare entry path alongside the workspace-rooted one. arrayContaining
    // wouldn't catch that, so assert the bare forms never reach download.
    expect(downloadedPaths).not.toContain('index.ts');
    expect(downloadedPaths).not.toContain('components/Foo.tsx');
    expect(downloadedPaths).not.toContain('logo.png');

    // Filename + in-zip folder share `appId_<id>_<friendlyName>` so unzipping
    // in ~/Downloads creates a single labeled folder rather than dumping files.
    const baseName = `appId_${appId}_Test_App`;
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${baseName}.zip"`,
    );
    const archiveEntryNames = mockArchive.append.mock.calls.map((c: any) => c[1].name);
    expect(archiveEntryNames).toEqual(
      expect.arrayContaining([
        `${baseName}/src/index.ts`,
        `${baseName}/src/components/Foo.tsx`,
        `${baseName}/public/logo.png`,
        `${baseName}/package.json`,
      ]),
    );
    // Pin the regression: any entry without the prefix would dump that file
    // to the unzip target directory.
    expect(archiveEntryNames).not.toContain('src/index.ts');
    expect(archiveEntryNames).not.toContain('package.json');

    expect(mockArchive.finalize).toHaveBeenCalled();
  });

  describe('nameStyle=appId (debug-console / internal)', () => {
    it('falls back to `appId_<id>` when app.name is missing', async () => {
      mockFindById.mockReturnValue({
        id: appId,
        name: '',
        path: `/tmp/apps/${appId}/app`,
      });
      const ws = strictWorkspace({
        tree: { src: [], public: [] },
        files: { 'package.json': Buffer.from('{}') },
      });
      mockCreateForWorkspace.mockReturnValue({ files: ws });

      const response = await request(app)
        .get(`/apps/${appId}/zip?nameStyle=appId`)
        .buffer(true);

      expect(response.status).toBe(200);
      const baseName = `appId_${appId}`;
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="${baseName}.zip"`,
      );
      const archiveEntryNames = mockArchive.append.mock.calls.map((c: any) => c[1].name);
      expect(archiveEntryNames).toContain(`${baseName}/package.json`);
    });

    it('sanitizes punctuation and whitespace in app.name into `_`', async () => {
      mockFindById.mockReturnValue({
        id: appId,
        name: "  My App: v2.0!  ",
        path: `/tmp/apps/${appId}/app`,
      });
      const ws = strictWorkspace({
        tree: { src: [], public: [] },
        files: { 'package.json': Buffer.from('{}') },
      });
      mockCreateForWorkspace.mockReturnValue({ files: ws });

      const response = await request(app)
        .get(`/apps/${appId}/zip?nameStyle=appId`)
        .buffer(true);

      expect(response.status).toBe(200);
      // Runs of non-alphanumeric chars collapse to a single `_`; leading/trailing
      // underscores are trimmed. ":" between "App" and "v2" becomes one `_`.
      const baseName = `appId_${appId}_My_App_v2_0`;
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="${baseName}.zip"`,
      );
      const archiveEntryNames = mockArchive.append.mock.calls.map((c: any) => c[1].name);
      expect(archiveEntryNames).toContain(`${baseName}/package.json`);
    });
  });

  describe('nameStyle=name (default; customer-facing)', () => {
    // Default style omits the internal `appId_<id>_` prefix so customers see
    // a download named after their app, not its internal id.
    it('uses the sanitized friendly name with no appId prefix', async () => {
      const ws = strictWorkspace({
        tree: { src: [], public: [] },
        files: { 'package.json': Buffer.from('{}') },
      });
      mockCreateForWorkspace.mockReturnValue({ files: ws });

      const response = await request(app).get(`/apps/${appId}/zip`).buffer(true);

      expect(response.status).toBe(200);
      const baseName = 'Test_App';
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="${baseName}.zip"`,
      );
      const archiveEntryNames = mockArchive.append.mock.calls.map((c: any) => c[1].name);
      expect(archiveEntryNames).toContain(`${baseName}/package.json`);
    });

    it('falls back to `app-<id>` when app.name is missing', async () => {
      mockFindById.mockReturnValue({
        id: appId,
        name: '',
        path: `/tmp/apps/${appId}/app`,
      });
      const ws = strictWorkspace({
        tree: { src: [], public: [] },
        files: { 'package.json': Buffer.from('{}') },
      });
      mockCreateForWorkspace.mockReturnValue({ files: ws });

      const response = await request(app).get(`/apps/${appId}/zip`).buffer(true);

      expect(response.status).toBe(200);
      const baseName = `app-${appId}`;
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="${baseName}.zip"`,
      );
      const archiveEntryNames = mockArchive.append.mock.calls.map((c: any) => c[1].name);
      expect(archiveEntryNames).toContain(`${baseName}/package.json`);
    });

    it('treats unrecognized nameStyle values as default', async () => {
      const ws = strictWorkspace({
        tree: { src: [], public: [] },
        files: { 'package.json': Buffer.from('{}') },
      });
      mockCreateForWorkspace.mockReturnValue({ files: ws });

      const response = await request(app)
        .get(`/apps/${appId}/zip?nameStyle=bogus`)
        .buffer(true);

      expect(response.status).toBe(200);
      // 'bogus' is not 'appId', so we fall back to the default `name` style.
      // This is the safe failure mode: a typo in a caller's query never leaks
      // the internal id-prefixed name to a customer-facing client.
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="Test_App.zip"',
      );
    });
  });

  it('returns 500 when workspace.tree throws unexpectedly', async () => {
    const treeMock = vi.fn().mockRejectedValue(new Error('upstream boom'));
    const downloadMock = vi.fn();
    mockCreateForWorkspace.mockReturnValue({
      files: { tree: treeMock, download: downloadMock },
    });

    const response = await request(app)
      .get(`/apps/${appId}/zip`)
      .expect(500);

    expect(response.body.error).toBe('Failed to create zip archive');
  });

  it('skips a single failing file and completes the archive instead of destroying the response', async () => {
    // The previous incarnation of this test pinned the OLD behavior — that a
    // single download failure caused res.destroy() and a corrupt zip on the
    // client. That fragility was a real prod bug (one bad file = client gets
    // a structurally invalid zip with no central directory). The fix logs the
    // failure and lets the archive finalize cleanly, so the user gets a
    // valid zip with the surviving files. See download.archive.test.ts for
    // the real-archiver counterpart that asserts the resulting zip parses.
    const ws = strictWorkspace({
      tree: {
        src: [
          { path: 'src/index.ts', kind: 'file' },
          { path: 'src/broken.ts', kind: 'file' },
        ],
        public: [],
      },
      files: {
        'src/index.ts': Buffer.from('export {}'),
        'src/broken.ts': new Error('disk read failure'),
        'package.json': Buffer.from('{}'),
      },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    let destroyedWith: Error | undefined;
    mockArchive.pipe.mockImplementation(function pipeImpl(target: any) {
      const origDestroy = target.destroy?.bind(target);
      target.destroy = (err?: Error) => {
        if (err) destroyedWith = err;
        if (origDestroy) origDestroy(err);
      };
      process.nextTick(() => {
        target.write(Buffer.from('zip'));
        target.end();
      });
    });

    const response = await request(app).get(`/apps/${appId}/zip`).buffer(true);

    expect(response.status).toBe(200);
    expect(destroyedWith).toBeUndefined();
    expect(mockArchive.finalize).toHaveBeenCalled();

    const archiveEntryNames = mockArchive.append.mock.calls.map((c: any) => c[1].name);
    expect(archiveEntryNames).toContain('Test_App/src/index.ts');
    expect(archiveEntryNames).toContain('Test_App/package.json');
    expect(archiveEntryNames).not.toContain('Test_App/src/broken.ts');
  });

  it('rethrows archive errors after finalize so success is not logged on a poisoned archive', async () => {
    const ws = strictWorkspace({
      tree: { src: [], public: [] },
      files: { 'package.json': Buffer.from('{}') },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    let destroyedWith: Error | undefined;
    mockArchive.pipe.mockImplementation(function pipeImpl(target: any) {
      const origDestroy = target.destroy?.bind(target);
      target.destroy = (err?: Error) => {
        if (err) destroyedWith = err;
        if (origDestroy) origDestroy(err);
      };
      target.write(Buffer.from('zip-header'));
    });

    mockArchive.finalize.mockImplementation(async function () {
      mockArchive.emit('error', new Error('zip corruption'));
    });

    await request(app).get(`/apps/${appId}/zip`).buffer(true).catch(() => undefined);

    expect(destroyedWith).toBeInstanceOf(Error);
    expect(destroyedWith?.message).toBe('zip corruption');
  });
});

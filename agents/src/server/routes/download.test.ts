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
        details: 'Airo Plus subscription required to download app files'
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
      .get(`/apps/${appId}/zip`)
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

    expect(mockArchive.append).toHaveBeenCalled();
    expect(mockArchive.finalize).toHaveBeenCalled();
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

  it('destroys the response when a file download fails mid-stream after pipe', async () => {
    const ws = strictWorkspace({
      tree: { src: [{ path: 'src/index.ts', kind: 'file' }], public: [] },
      files: { 'src/index.ts': new Error('disk read failure') },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    // pipe writes some bytes (so headersSent === true) but doesn't end —
    // route's catch path must call res.destroy(err).
    let destroyedWith: Error | undefined;
    mockArchive.pipe.mockImplementation(function pipeImpl(target: any) {
      const origDestroy = target.destroy?.bind(target);
      target.destroy = (err?: Error) => {
        if (err) destroyedWith = err;
        if (origDestroy) origDestroy(err);
      };
      target.write(Buffer.from('zip-header'));
    });

    // res.destroy(err) surfaces to supertest as a socket hang-up — that's
    // exactly what the production client sees, and the absence of a clean
    // 200+body is the signal we care about.
    await request(app).get(`/apps/${appId}/zip`).buffer(true).catch(() => undefined);

    expect(destroyedWith).toBeInstanceOf(Error);
    expect(destroyedWith?.message).toBe('disk read failure');
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

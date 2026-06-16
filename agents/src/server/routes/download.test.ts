/**
 * Download Route Tests
 *
 * Tests JWT-based authorization and archive error handling for app download operations
 */

import { Readable } from 'node:stream';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

// Mock dependencies BEFORE imports
const mockFindById = vi.fn();
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
        iat: Math.floor(Date.now() / 1000),
      } as any;
      next();
    });
    testApp.use('/', downloadRouter);
    return testApp;
  }

  // A workspace whose archive() returns a Readable of the given bytes. Captures
  // the options it was called with for assertions.
  function streamingWorkspace(zipBytes: Buffer) {
    const calls: Array<Record<string, unknown>> = [];
    const archive = vi.fn(async (options: Record<string, unknown>) => {
      calls.push(options);
      return { stream: Readable.from([zipBytes]), contentType: 'application/zip' };
    });
    return { files: { archive }, calls };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockReturnValue({
      id: appId,
      name: 'Test App',
      path: `/tmp/apps/${appId}/app`,
    });
    app = createPermittedApp();
  });

  it('returns 503 when workspace is unavailable', async () => {
    mockCreateForWorkspace.mockReturnValue(null);

    const response = await request(app).get(`/apps/${appId}/zip`).expect(503);
    expect(response.body.error).toBe('App workspace is not available');
  });

  it('pipes the archive stream through with zip headers and the allowlist', async () => {
    const ws = streamingWorkspace(Buffer.from('PK\x03\x04 fake-zip-bytes'));
    mockCreateForWorkspace.mockReturnValue(ws);

    const response = await request(app)
      .get(`/apps/${appId}/zip?nameStyle=appId`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="appId_klmnopqrst_Test_App.zip"',
    );
    // Bytes arrive intact (proxy is byte-faithful).
    expect((response.body as Buffer).toString()).toBe('PK\x03\x04 fake-zip-bytes');
    // The route passes the allowlist + baseName prefix straight through.
    expect(ws.calls[0]).toEqual({
      dirs: ['src', 'public'],
      files: ['package.json', '.env.example'],
      prefix: 'appId_klmnopqrst_Test_App',
    });
  });

  it('uses the customer-facing name (no appId prefix) by default', async () => {
    const ws = streamingWorkspace(Buffer.from('PK'));
    mockCreateForWorkspace.mockReturnValue(ws);

    const response = await request(app).get(`/apps/${appId}/zip`).buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="Test_App.zip"',
    );
    expect(ws.calls[0].prefix).toBe('Test_App');
  });

  it('falls back to app-<id> when name is empty (default style)', async () => {
    mockFindById.mockReturnValue({ id: appId, name: '', path: `/tmp/apps/${appId}/app` });
    const ws = streamingWorkspace(Buffer.from('PK'));
    mockCreateForWorkspace.mockReturnValue(ws);

    const response = await request(app).get(`/apps/${appId}/zip`).buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="app-${appId}.zip"`,
    );
  });

  it('returns 500 when archive() rejects before streaming', async () => {
    const archive = vi.fn().mockRejectedValue(new Error('supervisor down'));
    mockCreateForWorkspace.mockReturnValue({ files: { archive } });

    const response = await request(app).get(`/apps/${appId}/zip`).expect(500);
    expect(response.body.error).toBe('Failed to create zip archive');
  });
});


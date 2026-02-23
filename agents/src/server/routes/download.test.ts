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
const mockExistsSync = vi.fn(() => true);
const mockCreateWriteStream = vi.fn();
const mockCreateReadStream = vi.fn();
const mockUnlinkSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockArchiverFn = vi.fn();

vi.mock('../../database/index.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: mockFindById
  }))
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

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  createWriteStream: mockCreateWriteStream,
  createReadStream: mockCreateReadStream,
  unlinkSync: mockUnlinkSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('archiver', () => ({
  default: mockArchiverFn,
}));

// Import after mocks
const downloadRouter = await import('./download.js').then(m => m.default);
const { BYPASS_SITE_IDS } = await import('../../services/features.js');

describe('Download Route Authorization', () => {
  let app: Express;
  const appId = 'test-app-id';

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
        siteId: 'site-a',
        canDownload: true,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      const response = await request(app)
        .get(`/apps/site-b/zip`)
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
        siteId: 'site-a',
        canDownload: true,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      mockFindById.mockImplementation(() => {
        throw new Error('Should not reach here');
      });

      const response = await request(app)
        .get(`/apps/site-b/zip`)
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
      mockFindById.mockImplementation(() => {
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

describe('Archive Error Handling', () => {
  let app: Express;
  let mockArchive: EventEmitter & Record<string, any>;
  let mockOutput: EventEmitter & Record<string, any>;
  const appId = 'test-app';

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

  beforeEach(() => {
    vi.clearAllMocks();

    mockArchive = Object.assign(new EventEmitter(), {
      pipe: vi.fn(),
      directory: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn(),
      pointer: vi.fn(() => 1234),
    });

    mockOutput = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
    });

    mockFindById.mockReturnValue({
      id: appId,
      name: 'Test App',
      path: `/tmp/apps/${appId}/app`
    });

    mockExistsSync.mockReturnValue(true);
    mockCreateWriteStream.mockReturnValue(mockOutput);
    mockArchiverFn.mockReturnValue(mockArchive);

    app = createPermittedApp();
  });

  it('should return 500 when archive emits error instead of crashing', async function archiveError() {
    mockArchive.finalize.mockImplementation(() => {
      process.nextTick(() => {
        mockArchive.emit('error', new Error('disk corruption'));
      });
    });

    const response = await request(app)
      .get(`/apps/${appId}/zip`)
      .expect(500);

    expect(response.body.error).toBe('Failed to create zip archive');
    expect(response.body.details).toBe('disk corruption');
    expect(mockOutput.destroy).toHaveBeenCalled();
  });

  it('should return 500 when archive emits non-ENOENT warning instead of crashing', async function nonEnoentWarning() {
    mockArchive.finalize.mockImplementation(() => {
      process.nextTick(() => {
        mockArchive.emit('warning', Object.assign(new Error('permission denied'), { code: 'EPERM' }));
      });
    });

    const response = await request(app)
      .get(`/apps/${appId}/zip`)
      .expect(500);

    expect(response.body.error).toBe('Failed to create zip archive');
    expect(response.body.details).toBe('permission denied');
    expect(mockOutput.destroy).toHaveBeenCalled();
  });

  it('should return 500 when output stream emits error instead of crashing', async function outputError() {
    mockArchive.finalize.mockImplementation(() => {
      process.nextTick(() => {
        mockOutput.emit('error', new Error('disk full'));
      });
    });

    const response = await request(app)
      .get(`/apps/${appId}/zip`)
      .expect(500);

    expect(response.body.error).toBe('Failed to create zip archive');
    expect(response.body.details).toBe('disk full');
    expect(mockOutput.destroy).toHaveBeenCalled();
  });

  it('should continue successfully when archive emits ENOENT warning', async function enoentWarning() {
    mockCreateReadStream.mockImplementation(() => {
      const stream = new PassThrough();
      process.nextTick(() => stream.end(Buffer.from('fake-zip-data')));
      return stream;
    });

    mockArchive.finalize.mockImplementation(() => {
      process.nextTick(() => {
        mockArchive.emit('warning', Object.assign(new Error('file not found'), { code: 'ENOENT' }));
        process.nextTick(() => mockOutput.emit('close'));
      });
    });

    const response = await request(app)
      .get(`/apps/${appId}/zip`)
      .buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
  });
});

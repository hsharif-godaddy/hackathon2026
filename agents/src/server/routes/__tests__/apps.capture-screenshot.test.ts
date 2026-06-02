import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/** Generate a random 10-char lowercase alphanumeric ID matching APP_ID_RE. */
function randomAppId(): string {
  return randomBytes(5).toString('hex').slice(0, 10);
}

/** Let the fire-and-forget capture promise settle before asserting side-effects. */
const flushBackgroundWork = () => new Promise(resolve => setTimeout(resolve, 50));

const mockFetchScreenshotBuffer = vi.hoisted(() => vi.fn());

vi.mock('../../../tools/ai-lib-tools/drivers/website-scraper-driver.js', () => ({
  WebsiteScraperDriver: vi.fn().mockImplementation(function () { return {
    fetchScreenshotBuffer: mockFetchScreenshotBuffer,
  }; }),
}));

vi.mock('../../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function () { return {
    getCurrentCommit: vi.fn().mockResolvedValue(''),
  }; }),
}));

import { captureScreenshotRouter, recentCaptures } from '../capture-screenshot.js';
import { appsRouter } from '../apps.js';

// Stub heavy transitive deps that apps.ts pulls in but capture-screenshot doesn't need
vi.mock('../../../services/name-suggestion.js', () => ({
  getNameSuggestionService: () => ({ suggestName: vi.fn() }),
}));
vi.mock('../../../tools/ast-style-editor.js', () => ({
  ASTStyleEditor: vi.fn().mockImplementation(function () { return {}; }),
}));
vi.mock('../../../tools/ast-text-editor.js', () => ({
  ASTTextEditor: vi.fn().mockImplementation(function () { return {}; }),
}));
vi.mock('../../../tools/ast-image-editor.js', () => ({
  astImageEditor: {},
}));
vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {},
}));
vi.mock('../../../utils/code-search.js', () => ({
  searchCode: vi.fn(),
}));
vi.mock('../../../tools/server-management-tool.js', () => ({
  ServerManagementTool: vi.fn().mockImplementation(function () { return {}; }),
}));

import { AppRepository } from '../../../database/index.js';
import { getDatabase } from '../../../database/connection.js';

const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92,
  0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

function createTestApp(siteId: string) {
  const app = express();
  app.use((req, _res, next) => {
    const authReq = req as express.Request & {
      agentContext?: { siteId: string; product: string };
    };
    authReq.agentContext = { siteId, product: 'PaaSNodeJS' };
    next();
  });
  app.use(express.json());
  app.use('/apps', captureScreenshotRouter);
  // Mount appsRouter too so GET /apps/:id/screenshot works for the integration test
  app.use('/apps', appsRouter);
  return app;
}

function setAppPath(appId: string, path: string | null) {
  const db = getDatabase();
  db.prepare('UPDATE apps SET path = ? WHERE id = ?').run(path, appId);
}

describe('POST /apps/:id/capture-screenshot', () => {
  let app: express.Express;
  let appRepo: AppRepository;
  let originalEnv: NodeJS.ProcessEnv;
  let testAppId: string;
  let baseDir: string;
  let previewDir: string;

  beforeAll(() => {
    appRepo = new AppRepository();
  });

  beforeEach(async () => {
    originalEnv = { ...process.env };
    testAppId = randomAppId();
    app = createTestApp(testAppId);

    baseDir = await mkdtemp(join(tmpdir(), 'capture-screenshot-test-'));
    previewDir = join(baseDir, 'preview');
    await mkdir(previewDir, { recursive: true });

    await appRepo.registerOrUpdateApp({
      siteId: testAppId,
      name: 'Capture Screenshot Test App',
      appPath: previewDir,
    });

    mockFetchScreenshotBuffer.mockResolvedValue({
      buffer: PNG_BUFFER,
      contentType: 'image/png',
    });

    recentCaptures.clear();
  });

  afterEach(async () => {
    process.env = originalEnv;
    vi.clearAllMocks();

    try {
      await appRepo.delete(testAppId);
    } catch (err) {
      console.warn('Test cleanup: failed to delete app', testAppId, err);
    }

    await rm(baseDir, { recursive: true, force: true });
  });

  it('returns 400 when url is not provided', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({})
      .expect(400);

    expect(response.body.error).toBe('url is required');
  });

  it('returns 400 when url is empty string', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: '' })
      .expect(400);

    expect(response.body.error).toBe('url is required');
  });

  it('returns 400 when url is whitespace-only', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: '   ' })
      .expect(400);

    expect(response.body.error).toBe('url is required');
  });

  it('uses url from request body', async () => {
    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://paas-app.example.com/' })
      .expect(202);

    await flushBackgroundWork();
    expect(mockFetchScreenshotBuffer).toHaveBeenCalledWith(
      'https://paas-app.example.com/',
      expect.any(Object)
    );
  });

  it('validates url for https protocol', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'http://insecure.example.com/' })
      .expect(422);

    expect(response.body.error).toBe('url must use https protocol');
  });

  it('validates url is a valid URL', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'not-a-url' })
      .expect(422);

    expect(response.body.error).toBe('url is not a valid URL');
  });

  it('returns 403 when app does not belong to caller', async () => {
    const unknownId = randomAppId();

    const response = await request(app)
      .post(`/apps/${unknownId}/capture-screenshot`)
      .send({})
      .expect(403);

    expect(response.body.error).toContain('denied');
  });

  it('returns 403 for non-PaaS callers', async () => {
    const aabApp = express();
    aabApp.use((req, _res, next) => {
      const authReq = req as express.Request & {
        agentContext?: { siteId: string; product: string };
      };
      authReq.agentContext = { siteId: testAppId, product: 'AiroAppBuilder' };
      next();
    });
    aabApp.use(express.json());
    aabApp.use('/apps', captureScreenshotRouter);

    const response = await request(aabApp)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(403);

    expect(response.body.error).toContain('PaaS');
  });

  it('captures screenshot and saves to disk', async () => {
    delete process.env.SCREENSHOT_DIR;

    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);

    expect(response.body.status).toBe('capturing');

    await flushBackgroundWork();

    // Verify the file was saved (resolve path the same way the route does)
    const agentDir = join(baseDir, 'agent');
    const expectedPath = join(agentDir, `${testAppId}-screenshot.png`);
    expect(existsSync(expectedPath)).toBe(true);

    const saved = await readFile(expectedPath);
    expect(saved.equals(PNG_BUFFER)).toBe(true);
  });

  it('passes url and dimensions to web-scraper', async () => {
    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/', width: 800, height: 600 })
      .expect(202);

    await flushBackgroundWork();
    expect(mockFetchScreenshotBuffer).toHaveBeenCalledWith(
      'https://my-app.example.com/',
      { width: '800', height: '600' }
    );
  });

  it('uses default dimensions when not provided', async () => {
    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);

    await flushBackgroundWork();
    expect(mockFetchScreenshotBuffer).toHaveBeenCalledWith(
      'https://my-app.example.com/',
      { width: '400', height: '300' }
    );
  });

  it('returns 400 for invalid width', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/', width: 0 })
      .expect(400);

    expect(response.body.error).toContain('width and height');
  });

  it('returns 400 for width exceeding max', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/', width: 9999 })
      .expect(400);

    expect(response.body.error).toContain('1920');
  });

  it('returns 400 for non-integer height', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/', height: 3.5 })
      .expect(400);

    expect(response.body.error).toContain('width and height');
  });

  it('returns 202 even when web-scraper returns unexpected content type', async () => {
    mockFetchScreenshotBuffer.mockResolvedValue({
      buffer: Buffer.from('<html>error</html>'),
      contentType: 'text/html',
    });

    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);
  });

  it('returns 202 even when web-scraper throws (error handled in background)', async () => {
    mockFetchScreenshotBuffer.mockRejectedValue(new Error('Connection refused'));

    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);
  });

  it('uses SCREENSHOT_DIR when configured', async () => {
    const overrideDir = join(baseDir, 'override');
    await mkdir(overrideDir, { recursive: true });
    process.env.SCREENSHOT_DIR = overrideDir;

    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);

    await flushBackgroundWork();
    const expectedPath = join(overrideDir, `${testAppId}-screenshot.png`);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('screenshot is retrievable via GET after capture', async () => {
    delete process.env.SCREENSHOT_DIR;

    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);

    await flushBackgroundWork();

    const getResponse = await request(app)
      .get(`/apps/${testAppId}/screenshot`)
      .expect(200);

    expect(getResponse.headers['content-type']).toContain('image/png');
    expect(Buffer.from(getResponse.body).equals(PNG_BUFFER)).toBe(true);
  });

  it('returns 202 when web-scraper returns zero-length buffer (error handled in background)', async () => {
    mockFetchScreenshotBuffer.mockResolvedValue({
      buffer: Buffer.alloc(0),
      contentType: 'image/png',
    });

    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);
  });

  it('returns 404 when app was deleted after ownership check', async () => {
    await appRepo.delete(testAppId);

    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(404);

    expect(response.body.error).toBe('App not found');
  });

  it('returns 500 when app.path is empty', async () => {
    setAppPath(testAppId, '');

    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(500);

    expect(response.body.error).toBe('App has no filesystem path configured');
  });

  it('returns 202 even on disk write failure (error handled in background)', async () => {
    process.env.SCREENSHOT_DIR = '/nonexistent/readonly/path';

    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);
  });

  it('saves screenshot in app path directly when not a preview directory', async () => {
    delete process.env.SCREENSHOT_DIR;
    const nonPreviewDir = join(baseDir, 'my-app');
    await mkdir(nonPreviewDir, { recursive: true });
    setAppPath(testAppId, nonPreviewDir);

    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);

    await flushBackgroundWork();
    const expectedPath = join(nonPreviewDir, `${testAppId}-screenshot.png`);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('handles content-type with charset parameter', async () => {
    mockFetchScreenshotBuffer.mockResolvedValue({
      buffer: PNG_BUFFER,
      contentType: 'image/png; charset=utf-8',
    });

    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/' })
      .expect(202);

    await flushBackgroundWork();
    // Verify file was saved (charset doesn't prevent successful capture)
    const agentDir = join(baseDir, 'agent');
    const expectedPath = join(agentDir, `${testAppId}-screenshot.png`);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('accepts width at exactly MAX_DIMENSION (1920)', async () => {
    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/', width: 1920 })
      .expect(202);

    await flushBackgroundWork();
    expect(mockFetchScreenshotBuffer).toHaveBeenCalledWith(
      'https://my-app.example.com/',
      { width: '1920', height: '300' }
    );
  });

  it('returns 400 for width one above MAX_DIMENSION (1921)', async () => {
    const response = await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/', width: 1921 })
      .expect(400);

    expect(response.body.error).toContain('1920');
  });

  it('accepts width at minimum value (1)', async () => {
    await request(app)
      .post(`/apps/${testAppId}/capture-screenshot`)
      .send({ url: 'https://my-app.example.com/', width: 1, height: 1 })
      .expect(202);

    await flushBackgroundWork();
    expect(mockFetchScreenshotBuffer).toHaveBeenCalledWith(
      'https://my-app.example.com/',
      { width: '1', height: '1' }
    );
  });

  // app.path cannot be NULL in SQLite (NOT NULL constraint), so the only
  // reachable falsy case is empty string — already tested above as
  // 'returns 500 when app.path is empty'.

  describe('SSRF protection', () => {
    it('rejects localhost', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://localhost/secret' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('rejects loopback IP', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://127.0.0.1/' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('rejects link-local metadata endpoint', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://169.254.169.254/latest/meta-data/' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('rejects RFC1918 10.x.x.x', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://10.0.0.1/' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('rejects RFC1918 172.16.x.x', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://172.16.0.1/' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('rejects RFC1918 192.168.x.x', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://192.168.1.1/' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('rejects .local hostnames', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://internal-service.local/' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('rejects .internal hostnames', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://api.mgmt.internal/' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('rejects raw IPv4 addresses', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://8.8.8.8/' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('rejects raw IPv6 addresses', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://[::1]/' })
        .expect(422);

      expect(response.body.error).toBe('URL hostname is not allowed');
    });

    it('allows valid public domain', async () => {
      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.airoapp.ai/' })
        .expect(202);
    });
  });

  describe('route ID regex', () => {
    it('returns 404 for path-traversal ID', async () => {
      await request(app)
        .post('/apps/../../etc/passwd/capture-screenshot')
        .send({ url: 'https://example.com/' })
        .expect(404);
    });

    it('returns 404 for 9-character alphanumeric ID', async () => {
      await request(app)
        .post('/apps/abcdefgh9/capture-screenshot')
        .send({ url: 'https://example.com/' })
        .expect(404);
    });

    it('rejects uppercase UUID via ownership check', async () => {
      const uppercaseId = randomAppId().toUpperCase();
      const response = await request(app)
        .post(`/apps/${uppercaseId}/capture-screenshot`)
        .send({ url: 'https://example.com/' });

      // Ownership middleware rejects non-lowercase IDs with 400 (invalid shape).
      expect([400, 403, 404]).toContain(response.status);
    });

    it('rejects uppercase 10-char ID via ownership check', async () => {
      const response = await request(app)
        .post('/apps/AAAAAAAAAA/capture-screenshot')
        .send({ url: 'https://example.com/' });

      // Ownership middleware rejects non-lowercase IDs with 400 (invalid shape).
      expect([400, 403, 404]).toContain(response.status);
    });
  });

  describe('recentCaptures deduplication', () => {
    it('does not call scraper when capture is already in flight for same app', async () => {
      recentCaptures.set(testAppId, { url: 'https://my-app.example.com/', commitHash: '', requestedAt: Date.now(), inFlight: true, lastSucceeded: false });

      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      await flushBackgroundWork();
      expect(mockFetchScreenshotBuffer).not.toHaveBeenCalled();
    });

    it('allows capture for different app even if another is in flight', async () => {
      recentCaptures.set('other-app-id', { url: 'https://other.example.com/', commitHash: '', requestedAt: Date.now(), inFlight: true, lastSucceeded: false });

      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      await flushBackgroundWork();
      expect(mockFetchScreenshotBuffer).toHaveBeenCalled();
    });

    it('marks inFlight false after scraper error', async () => {
      vi.useFakeTimers();
      mockFetchScreenshotBuffer.mockRejectedValue(new Error('scraper down'));

      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      // Advance through all 3 retry delays
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.runAllTimersAsync();

      const record = recentCaptures.get(testAppId);
      expect(record).toBeDefined();
      expect(record!.inFlight).toBe(false);
      vi.useRealTimers();
    });

    it('marks inFlight false after successful capture', async () => {
      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      await flushBackgroundWork();
      const record = recentCaptures.get(testAppId);
      expect(record).toBeDefined();
      expect(record!.inFlight).toBe(false);
    });

    it('sets lastSucceeded true after successful capture', async () => {
      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      await flushBackgroundWork();
      const record = recentCaptures.get(testAppId);
      expect(record).toBeDefined();
      expect(record!.lastSucceeded).toBe(true);
    });

    it('allows retry when previous capture failed (lastSucceeded false)', async () => {
      recentCaptures.set(testAppId, { url: 'https://my-app.example.com/', commitHash: '', requestedAt: Date.now(), inFlight: false, lastSucceeded: false });

      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      await flushBackgroundWork();
      expect(mockFetchScreenshotBuffer).toHaveBeenCalled();
    });

    it('deduplicates when same URL and commit within 15min window', async () => {
      recentCaptures.set(testAppId, { url: 'https://my-app.example.com/', commitHash: '', requestedAt: Date.now(), inFlight: false, lastSucceeded: true });

      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      await flushBackgroundWork();
      expect(mockFetchScreenshotBuffer).not.toHaveBeenCalled();
    });

    it('allows capture when URL differs from recent capture', async () => {
      recentCaptures.set(testAppId, { url: 'https://old-url.example.com/', commitHash: '', requestedAt: Date.now(), inFlight: false, lastSucceeded: true });

      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://new-url.example.com/' })
        .expect(202);

      await flushBackgroundWork();
      expect(mockFetchScreenshotBuffer).toHaveBeenCalled();
    });

    it('allows capture when 15min window has expired', async () => {
      recentCaptures.set(testAppId, { url: 'https://my-app.example.com/', commitHash: '', requestedAt: Date.now() - 16 * 60 * 1_000, inFlight: false, lastSucceeded: true });

      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      await flushBackgroundWork();
      expect(mockFetchScreenshotBuffer).toHaveBeenCalled();
    });
  });

  describe('path-traversal guard', () => {
    it('writes screenshot to expected SCREENSHOT_DIR location', async () => {
      const screenshotDir = join(baseDir, 'safe-dir');
      await mkdir(screenshotDir, { recursive: true });
      process.env.SCREENSHOT_DIR = screenshotDir;
      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      await flushBackgroundWork();
      const expectedPath = join(screenshotDir, `${testAppId}-screenshot.png`);
      expect(existsSync(expectedPath)).toBe(true);
    });
  });

  describe('retry behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries 3 times on scraper failure before giving up', async () => {
      mockFetchScreenshotBuffer.mockRejectedValue(new Error('scraper timeout'));

      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      // First attempt runs immediately; 2 retry delays (5s each) follow
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockFetchScreenshotBuffer).toHaveBeenCalledTimes(3);
    });

    it('succeeds on second attempt after first failure', async () => {
      mockFetchScreenshotBuffer
        .mockRejectedValueOnce(new Error('transient error'))
        .mockResolvedValueOnce({ buffer: PNG_BUFFER, contentType: 'image/png' });

      await request(app)
        .post(`/apps/${testAppId}/capture-screenshot`)
        .send({ url: 'https://my-app.example.com/' })
        .expect(202);

      // Advance through the retry delay after first failure
      await vi.advanceTimersByTimeAsync(5_000);
      // Let the file write, .catch(), and .finally() settle via microtask queue
      await vi.advanceTimersByTimeAsync(500);
      await vi.runAllTimersAsync();

      expect(mockFetchScreenshotBuffer).toHaveBeenCalledTimes(2);
    });
  });
});

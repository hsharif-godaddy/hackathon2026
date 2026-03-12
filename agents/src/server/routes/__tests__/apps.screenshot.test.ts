import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { appsRouter } from '../apps.js';
import { AppRepository } from '../../../database/index.js';

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

const createTestApp = (siteId: string) => {
  const app = express();
  app.use((req, _res, next) => {
    const authReq = req as express.Request & {
      agentContext?: { siteId: string }
    };
    authReq.agentContext = { siteId };
    next();
  });
  app.use(express.json());
  app.use('/apps', appsRouter);
  return app;
};

describe('Apps Screenshot Routes', () => {
  let app: express.Express;
  let appRepo: AppRepository;
  let originalEnv: NodeJS.ProcessEnv;
  let testAppId: string;
  let testAppIds: string[];
  let baseDir: string;
  let previewDir: string;
  let agentDir: string;

  beforeAll(() => {
    appRepo = new AppRepository();
  });

  beforeEach(async () => {
    originalEnv = { ...process.env };
    testAppId = randomUUID();
    testAppIds = [testAppId];
    app = createTestApp(testAppId);

    baseDir = await mkdtemp(join(tmpdir(), 'apps-screenshot-test-'));
    previewDir = join(baseDir, 'preview');
    agentDir = join(baseDir, 'agent');

    await mkdir(previewDir, { recursive: true });

    await appRepo.registerOrUpdateApp({
      siteId: testAppId,
      name: 'Screenshot Test App',
      appPath: previewDir,
    });
  });

  afterEach(async () => {
    process.env = originalEnv;

    for (const appId of testAppIds) {
      try {
        await appRepo.delete(appId);
      } catch {
        // ignore cleanup failures for missing rows
      }
    }

    await rm(baseDir, { recursive: true, force: true });
  });

  it('stores uploaded screenshots in the local agent directory when SCREENSHOT_DIR is unset', async () => {
    delete process.env.SCREENSHOT_DIR;

    const response = await request(app)
      .post(`/apps/${testAppId}/screenshot`)
      .attach('screenshot', PNG_BUFFER, {
        filename: 'screenshot.png',
        contentType: 'image/png',
      })
      .expect(200);

    const expectedPath = join(agentDir, `${testAppId}-screenshot.png`);

    expect(response.body).toEqual({
      success: true,
      path: expectedPath,
    });
    expect(existsSync(expectedPath)).toBe(true);

    const writtenFile = await readFile(expectedPath);
    expect(writtenFile.equals(PNG_BUFFER)).toBe(true);
  });

  it('serves screenshots from the local agent directory when SCREENSHOT_DIR is unset', async () => {
    delete process.env.SCREENSHOT_DIR;

    await mkdir(agentDir, { recursive: true });
    const expectedPath = join(agentDir, `${testAppId}-screenshot.png`);
    await writeFile(expectedPath, PNG_BUFFER);

    const response = await request(app)
      .get(`/apps/${testAppId}/screenshot`)
      .expect(200);

    expect(response.headers['content-type']).toContain('image/png');
  });

  it('falls back to the app directory when the app path is not a preview workspace', async () => {
    delete process.env.SCREENSHOT_DIR;

    const customAppId = randomUUID();
    const appDir = join(baseDir, 'custom-app');
    await mkdir(appDir, { recursive: true });
    testAppIds.push(customAppId);
    app = createTestApp(customAppId);

    await appRepo.registerOrUpdateApp({
      siteId: customAppId,
      name: 'Screenshot Custom Path App',
      appPath: appDir,
    });

    const response = await request(app)
      .post(`/apps/${customAppId}/screenshot`)
      .attach('screenshot', PNG_BUFFER, {
        filename: 'screenshot.png',
        contentType: 'image/png',
      })
      .expect(200);

    const expectedPath = join(appDir, `${customAppId}-screenshot.png`);

    expect(response.body.path).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('uses SCREENSHOT_DIR when it is explicitly configured', async () => {
    const overrideDir = join(baseDir, 'override-screenshots');
    await mkdir(overrideDir, { recursive: true });
    process.env.SCREENSHOT_DIR = overrideDir;

    const response = await request(app)
      .post(`/apps/${testAppId}/screenshot`)
      .attach('screenshot', PNG_BUFFER, {
        filename: 'screenshot.png',
        contentType: 'image/png',
      })
      .expect(200);

    const expectedPath = join(overrideDir, `${testAppId}-screenshot.png`);

    expect(response.body.path).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
  });
});

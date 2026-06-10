import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { initializeTestDatabase } from '../../../database/schema.js';
import * as connection from '../../../database/connection.js';
import { AppMetadataRepository } from '../../../database/index.js';

vi.mock('../../../database/connection.js');
vi.mock('../../../logging/index.js', () => ({
  Logger: { create: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() }) },
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const APP_ID = 'abcde12345';

// The router instantiates `new AppMetadataRepository()` at module load, which
// calls getDatabase() in the constructor. So the router must be imported AFTER
// the in-memory db is wired into the mock — hence dynamic import per test app.
async function makeApp(siteId: string) {
  const app = express();
  app.use(express.json());
  // Stub auth: inject agentContext like jwtAuthMiddleware would.
  app.use((req, _res, next) => {
    (req as any).agentContext = { siteId };
    next();
  });
  const { appMetadataRouter } = await import('../app-metadata.js');
  app.use('/apps', appMetadataRouter); // mount under /apps to match production
  return app;
}

describe('app-metadata routes', () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.resetModules(); // so the router re-imports against the fresh mock/db
    db = new Database(':memory:');
    initializeTestDatabase(db);
    vi.mocked(connection.getDatabase).mockReturnValue(db);
  });
  afterEach(() => { db.close(); vi.clearAllMocks(); });

  it('GET returns {} for an app with no metadata', async () => {
    const res = await request(await makeApp(APP_ID)).get(`/apps/${APP_ID}/metadata`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ metadata: {} });
  });

  it('PATCH merges and persists, GET reflects it', async () => {
    const app = await makeApp(APP_ID);
    const patch = { tag: 'alpha', ref: { id: 'one' } };
    const patchRes = await request(app).patch(`/apps/${APP_ID}/metadata`).send(patch);
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.metadata).toEqual(patch);

    const getRes = await request(app).get(`/apps/${APP_ID}/metadata`);
    expect(getRes.body.metadata).toEqual(patch);
  });

  it('rejects cross-tenant access (siteId !== :id) with 403', async () => {
    const res = await request(await makeApp('other99999')).get(`/apps/${APP_ID}/metadata`);
    expect(res.status).toBe(403);
  });

  it('PATCH with an array body returns 400', async () => {
    // express.json() parses a JSON array into an array, which the handler rejects.
    const res = await request(await makeApp(APP_ID))
      .patch(`/apps/${APP_ID}/metadata`)
      .send([1, 2, 3]);
    expect(res.status).toBe(400);
  });

  it('PATCH returns 413 and does not persist when body would push stored blob over the size limit', async () => {
    const app = await makeApp(APP_ID);
    // A 70KB string value alone exceeds the 64KB stored-blob cap.
    const oversizeRes = await request(app)
      .patch(`/apps/${APP_ID}/metadata`)
      .send({ blob: 'x'.repeat(70 * 1024) });
    expect(oversizeRes.status).toBe(413);
    expect(oversizeRes.body.error).toBe('Metadata exceeds maximum size');

    // Confirm the write was rejected — stored metadata is still empty.
    const getRes = await request(app).get(`/apps/${APP_ID}/metadata`);
    expect(getRes.body.metadata).toEqual({});
  });

  it('PATCH accepts a body comfortably under the size limit', async () => {
    const app = await makeApp(APP_ID);
    const smallPatch = { tag: 'hello', count: 42 };
    const res = await request(app).patch(`/apps/${APP_ID}/metadata`).send(smallPatch);
    expect(res.status).toBe(200);
    expect(res.body.metadata).toEqual(smallPatch);
  });

  it('GET returns 500 when the repository throws', async () => {
    // resetModules means the dynamic import in makeApp gets a fresh class — the top-level
    // AppMetadataRepository import is a different identity. Import the repo class from the
    // fresh registry first, spy on it, then import the router (which will reuse the cached module).
    const { AppMetadataRepository: FreshRepo } = await import('../../../database/index.js');
    vi.spyOn(FreshRepo.prototype, 'get').mockImplementation(() => { throw new Error('db down'); });
    const app = await makeApp(APP_ID); // loads the router, creating its logger

    // All Logger.create calls return the same mock object, so results[0].value.error
    // is the spy the handler uses. Fail hard if nothing was captured, so the
    // assertion below can't pass vacuously against a missing spy.
    const { Logger } = await import('../../../logging/index.js');
    const loggerResults = vi.mocked(Logger.create).mock.results;
    expect(loggerResults.length).toBeGreaterThan(0);
    const errorSpy = loggerResults[0]!.value.error;

    const res = await request(app).get(`/apps/${APP_ID}/metadata`);
    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith('app.metadata.get.failed', expect.objectContaining({ appId: APP_ID }));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import express, { type Express } from 'express';
import request from 'supertest';

import { initializeTestDatabase } from '../../../database/schema.js';
import * as connection from '../../../database/connection.js';

vi.mock('../../../database/connection.js');
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    }),
  },
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Arbitrary, obviously-synthetic fixtures — the route is generic for any app.
const OLD_ID = 'sourceapp1';
const NEW_ID = 'targetapp2';

async function makeApp(siteId = NEW_ID): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).agentContext = { siteId };
    next();
  });

  const { default: router } = await import('../rewrite-app-identity.js');
  app.use('/', router);
  return app;
}

function insertApp(db: Database.Database, appId: string): void {
  db.prepare(`
    INSERT INTO apps (id, name, path, port, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(appId, 'Test App', `/tmp/${appId}`, 3000, 'created');
}

describe('rewrite-app-identity route', () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    db = new Database(':memory:');
    initializeTestDatabase(db);
    vi.mocked(connection.getDatabase).mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it('rewrites the identity and returns the report on success', async () => {
    insertApp(db, OLD_ID);

    const res = await request(await makeApp())
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldAppId: OLD_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.report.oldAppId).toBe(OLD_ID);
    expect(res.body.report.newAppId).toBe(NEW_ID);
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(NEW_ID)).toEqual({ n: 1 });
  });

  it('returns 400 when the body is missing oldAppId', async () => {
    insertApp(db, OLD_ID);

    const res = await request(await makeApp())
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldCell: 'c1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid request body/);
  });

  it('returns 404 when the source app is not present in the DB', async () => {
    // No insertApp — ownership passes (siteId === :id) but preflight finds no source row.
    const res = await request(await makeApp())
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldAppId: OLD_ID });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('source_missing');
  });

  it('takes over a pre-existing target stub and rewrites all old-id references', async () => {
    // The agent re-registers its own SITE_ID as a stub between restore and rewrite, so the
    // target id is present alongside the source. The rewrite must still succeed: discard the
    // stub, rename the source onto the target id.
    insertApp(db, OLD_ID);
    insertApp(db, NEW_ID);

    const res = await request(await makeApp())
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldAppId: OLD_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(NEW_ID)).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(OLD_ID)).toEqual({ n: 0 });
  });

  it('returns 403 when the JWT siteId does not match the path app ID', async () => {
    insertApp(db, OLD_ID);

    const res = await request(await makeApp('zzzzz00000'))
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldAppId: OLD_ID });

    expect(res.status).toBe(403);
  });

  it('404s on a malformed app ID (constrained route never reaches the handler)', async () => {
    const res = await request(await makeApp('bad'))
      .post('/apps/bad/rewrite-identity')
      .send({ oldAppId: OLD_ID });

    expect(res.status).toBe(404);
  });

  it('threads oldCell/newCell from the body through to the domain', async () => {
    insertApp(db, OLD_ID);

    const res = await request(await makeApp())
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldAppId: OLD_ID, oldCell: 'c1', newCell: 'c2' });

    expect(res.status).toBe(200);
    expect(res.body.report.oldCell).toBe('c1');
    expect(res.body.report.newCell).toBe('c2');
  });

  it('takes newAppId from the path, not the body (locks the flipped contract)', async () => {
    insertApp(db, OLD_ID);

    // A decoy newAppId in the body must be ignored; the target is the path :id.
    const res = await request(await makeApp())
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldAppId: OLD_ID, newAppId: 'decoyapp00' });

    expect(res.status).toBe(200);
    expect(res.body.report.newAppId).toBe(NEW_ID);
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(NEW_ID)).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get('decoyapp00')).toEqual({ n: 0 });
  });

  it('maps invalid_app_id (bad body oldAppId shape) to 400', async () => {
    const res = await request(await makeApp())
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldAppId: 'BADID' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_app_id');
  });

  it('maps same_app_id (body oldAppId equals path :id) to 400', async () => {
    insertApp(db, NEW_ID);

    const res = await request(await makeApp())
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldAppId: NEW_ID });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('same_app_id');
  });

  it('maps cell_incomplete (only one cell supplied) to 400', async () => {
    insertApp(db, OLD_ID);

    const res = await request(await makeApp())
      .post(`/apps/${NEW_ID}/rewrite-identity`)
      .send({ oldAppId: OLD_ID, oldCell: 'c1' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('cell_incomplete');
  });
});

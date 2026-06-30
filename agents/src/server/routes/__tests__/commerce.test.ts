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

const APP_ID = 'abcde12345';

async function makeApp(siteId = APP_ID): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).agentContext = { siteId };
    next();
  });

  const { default: commerceRouter } = await import('../commerce.js');
  app.use('/', commerceRouter);
  return app;
}

function insertApp(db: Database.Database, appId = APP_ID): void {
  db.prepare(`
    INSERT INTO apps (id, name, path, port, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(appId, 'Test App', `/tmp/${appId}`, 3000, 'created');
}

describe('commerce binding routes', () => {
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

  it('returns configured false when no Commerce binding exists', async () => {
    const res = await request(await makeApp()).get(`/apps/${APP_ID}/commerce/binding`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, binding: null });
  });

  it('creates a store-bound binding from the management API', async () => {
    insertApp(db);

    const res = await request(await makeApp())
      .patch(`/apps/${APP_ID}/commerce/binding`)
      .send({
        businessId: 'business-1',
        businessName: 'Haven & Co.',
        storeId: 'store-1',
        storeName: 'Haven Store',
        currencyCode: 'eur',
        reason: 'merchant selected store',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      commerceSetupReady: false,
      binding: {
        appId: APP_ID,
        businessId: 'business-1',
        businessName: 'Haven & Co.',
        storeId: 'store-1',
        storeName: 'Haven Store',
        currencyCode: 'EUR',
        channelId: null,
        status: 'store_bound',
        source: 'user_selected',
      },
    });
  });

  it('clears stale channel state when switching stores', async () => {
    insertApp(db);
    const app = await makeApp();

    await request(app)
      .patch(`/apps/${APP_ID}/commerce/binding`)
      .send({
        businessId: 'business-1',
        storeId: 'store-1',
        channelId: 'channel-1',
      });

    const res = await request(app)
      .patch(`/apps/${APP_ID}/commerce/binding`)
      .send({
        businessId: 'business-2',
        storeId: 'store-2',
      });

    expect(res.status).toBe(200);
    expect(res.body.binding).toMatchObject({
      businessId: 'business-2',
      storeId: 'store-2',
      channelId: null,
      status: 'store_bound',
    });
  });

  it('rejects channel-only binding without an existing store', async () => {
    insertApp(db);

    const res = await request(await makeApp())
      .patch(`/apps/${APP_ID}/commerce/binding`)
      .send({ channelId: 'channel-1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('channelId requires');
  });

  it('clears an existing binding', async () => {
    insertApp(db);
    const app = await makeApp();

    await request(app)
      .patch(`/apps/${APP_ID}/commerce/binding`)
      .send({ businessId: 'business-1', storeId: 'store-1' });

    const deleteRes = await request(app)
      .delete(`/apps/${APP_ID}/commerce/binding`)
      .send({ reason: 'merchant disconnected commerce' });

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toMatchObject({
      configured: false,
      binding: null,
      cleared: true,
    });

    const getRes = await request(app).get(`/apps/${APP_ID}/commerce/binding`);
    expect(getRes.body).toEqual({ configured: false, binding: null });
  });

  it('rejects cross-tenant access', async () => {
    const res = await request(await makeApp('other99999')).get(`/apps/${APP_ID}/commerce/binding`);
    expect(res.status).toBe(403);
  });
});

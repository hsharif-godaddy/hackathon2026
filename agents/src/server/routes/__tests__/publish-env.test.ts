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
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(() => null),
}));

const APP_ID = 'abcde12345';

async function makeApp(siteId = APP_ID): Promise<Express> {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).agentContext = { siteId };
    next();
  });

  const { default: publishEnvRouter } = await import('../publish-env.js');
  app.use('/apps', publishEnvRouter);
  return app;
}

function insertApp(db: Database.Database, appId = APP_ID): void {
  db.prepare(`
    INSERT INTO apps (id, name, path, port, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(appId, 'Test App', `/tmp/${appId}`, 3000, 'created');
}

function insertCommerceBinding(db: Database.Database, appId = APP_ID): void {
  db.prepare(`
    INSERT INTO app_commerce_bindings (
      app_id,
      store_id,
      channel_id,
      currency_code,
      status,
      source
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(appId, 'store-1', 'channel-1', 'USD', 'channel_ready', 'tool_channel_ensure');
}

describe('publish env routes', () => {
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

  it('returns publishable env vars for the authenticated app', async () => {
    insertApp(db);
    insertCommerceBinding(db);

    const res = await request(await makeApp()).get(`/apps/${APP_ID}/publish-env`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      vars: {
        GODADDY_STORE_ID: 'store-1',
        GODADDY_CHANNEL_ID: 'channel-1',
        GODADDY_CURRENCY_CODE: 'USD',
      },
    });
  });

  it('rejects cross-tenant access', async () => {
    const res = await request(await makeApp('other99999')).get(`/apps/${APP_ID}/publish-env`);
    expect(res.status).toBe(403);
  });
});

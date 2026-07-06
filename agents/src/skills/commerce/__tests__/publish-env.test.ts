import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { initializeTestDatabase } from '../../../database/schema.js';
import * as connection from '../../../database/connection.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { AppCommerceBindingRepository } from '../../../database/repositories/AppCommerceBindingRepository.js';
import { getCommercePublishEnv } from '../publish-env.js';
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js';

vi.mock('../../../database/connection.js');
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));
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

function insertApp(db: Database.Database, appId = APP_ID): void {
  db.prepare(`
    INSERT INTO apps (id, name, path, port, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(appId, 'Test App', `/tmp/${appId}`, 3000, 'created');
}

describe('getCommercePublishEnv', () => {
  let db: Database.Database;
  let repository: AppCommerceBindingRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(':memory:');
    initializeTestDatabase(db);
    vi.mocked(connection.getDatabase).mockReturnValue(db);
    vi.mocked(createForWorkspace).mockReturnValue(null);
    repository = new AppCommerceBindingRepository();
  });

  afterEach(() => {
    db.close();
  });

  it('projects publishable Commerce env from the durable binding without apiBaseUrl', async () => {
    insertApp(db);
    repository.upsert({
      appId: APP_ID,
      storeId: 'store-old',
      channelId: 'channel-old',
      currencyCode: 'USD',
      status: 'channel_ready',
      source: 'tool_channel_ensure',
    });
    repository.upsert({
      appId: APP_ID,
      storeId: 'store-new',
      channelId: null,
      status: 'store_bound',
      source: 'user_selected',
      eventType: 'selected_store',
    });
    repository.upsert({
      appId: APP_ID,
      channelId: 'channel-new',
      status: 'channel_ready',
      source: 'tool_channel_ensure',
      eventType: 'ensured_channel',
    });
    repository.upsert({
      appId: APP_ID,
      currencyCode: 'eur',
      status: 'channel_ready',
      source: 'tool_channel_ensure',
      eventType: 'verified',
    });

    const result = await getCommercePublishEnv(APP_ID);

    expect(result.vars).toEqual({
      GODADDY_STORE_ID: 'store-new',
      VITE_GODADDY_STORE_ID: 'store-new',
      GODADDY_CHANNEL_ID: 'channel-new',
      VITE_GODADDY_CHANNEL_ID: 'channel-new',
      GODADDY_CURRENCY_CODE: 'EUR',
      VITE_GODADDY_CURRENCY_CODE: 'EUR',
    });
    expect(result.vars).not.toHaveProperty('GODADDY_API_BASE_URL');
    expect(result.updateIfCurrentValueIn).toMatchObject({
      GODADDY_STORE_ID: ['store-old'],
      VITE_GODADDY_STORE_ID: ['store-old'],
      GODADDY_CHANNEL_ID: ['channel-old'],
      VITE_GODADDY_CHANNEL_ID: ['channel-old'],
      GODADDY_CURRENCY_CODE: ['USD'],
      VITE_GODADDY_CURRENCY_CODE: ['USD'],
    });
  });

  it('returns empty vars when no binding or fallback env exists', async () => {
    await expect(getCommercePublishEnv(APP_ID)).resolves.toEqual({ vars: {} });
  });

  it('reconstructs a binding from preview .env as a one-time fallback', async () => {
    insertApp(db);
    vi.mocked(createForWorkspace).mockReturnValue({
      files: createStubWorkspaceFiles({
        readText: vi.fn().mockResolvedValue(
          [
            'GODADDY_STORE_ID=store-env',
            'GODADDY_CHANNEL_ID=channel-env',
            'GODADDY_API_BASE_URL=https://api.dev-godaddy.com',
          ].join('\n'),
        ),
      }),
    } as any);

    const result = await getCommercePublishEnv(APP_ID);

    expect(result.vars).toMatchObject({
      GODADDY_STORE_ID: 'store-env',
      GODADDY_CHANNEL_ID: 'channel-env',
      GODADDY_CURRENCY_CODE: 'USD',
    });
    expect(result.vars).not.toHaveProperty('GODADDY_API_BASE_URL');
    expect(repository.findByAppId(APP_ID)).toMatchObject({
      storeId: 'store-env',
      channelId: 'channel-env',
      currencyCode: 'USD',
      source: 'env_fallback',
      status: 'channel_ready',
    });
  });
});

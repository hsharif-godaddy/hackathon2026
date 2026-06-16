import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { closeDatabase, getDatabase } from '../../connection.js';
import type { AppCommerceBindingRepository } from '../AppCommerceBindingRepository.js';

let testDb: Database.Database;
let tempDir: string;
let repository: AppCommerceBindingRepository;

function insertApp(appId = 'app-123456'): void {
  testDb
    .prepare(`
      INSERT INTO apps (id, name, path, port, status)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(appId, 'Test App', `/tmp/${appId}`, 3000, 'created');
}

describe('AppCommerceBindingRepository', () => {
  beforeEach(async () => {
    closeDatabase();
    tempDir = mkdtempSync(path.join(tmpdir(), 'app-commerce-binding-repo-'));
    process.env.DB_PATH = path.join(tempDir, 'apps.db');
    testDb = getDatabase();

    const module = await import('../AppCommerceBindingRepository.js');
    repository = new module.AppCommerceBindingRepository();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.DB_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when an app has no commerce binding row', () => {
    expect(repository.findByAppId('app-123456')).toBeNull();
  });

  it('creates a store-bound binding and event', () => {
    insertApp();

    const binding = repository.upsert({
      appId: 'app-123456',
      businessId: 'business-1',
      businessName: 'Haven & Co.',
      storeId: 'store-1',
      storeName: 'Haven Store',
      status: 'store_bound',
      source: 'tool_setup',
      eventType: 'selected_store',
      actorType: 'agent',
      reason: 'Commerce setup resolved an existing store',
    });

    expect(binding).toMatchObject({
      appId: 'app-123456',
      businessId: 'business-1',
      storeId: 'store-1',
      status: 'store_bound',
      source: 'tool_setup',
    });

    const events = repository.listEventsByAppId('app-123456');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'selected_store',
      nextBusinessId: 'business-1',
      nextStoreId: 'store-1',
      actorType: 'agent',
    });
  });

  it('preserves existing business and store fields when channel ensure returns only channel data', () => {
    insertApp();
    repository.upsert({
      appId: 'app-123456',
      businessId: 'business-1',
      businessName: 'Haven & Co.',
      storeId: 'store-1',
      storeName: 'Haven Store',
      status: 'store_bound',
      source: 'tool_setup',
    });

    const binding = repository.upsert({
      appId: 'app-123456',
      channelId: 'channel-1',
      channelName: 'Airo App Builder',
      status: 'channel_ready',
      source: 'tool_channel_ensure',
      eventType: 'ensured_channel',
      metadata: { tool: 'commerce_store_channel_ensure' },
    });

    expect(binding).toMatchObject({
      businessId: 'business-1',
      businessName: 'Haven & Co.',
      storeId: 'store-1',
      storeName: 'Haven Store',
      channelId: 'channel-1',
      status: 'channel_ready',
    });

    const events = repository.listEventsByAppId('app-123456');
    expect(events[0]).toMatchObject({
      eventType: 'ensured_channel',
      previousStoreId: 'store-1',
      nextStoreId: 'store-1',
      nextChannelId: 'channel-1',
      metadata: { tool: 'commerce_store_channel_ensure' },
    });
  });

  it('switches stores and clears stale channel fields when explicitly set to null', () => {
    insertApp();
    repository.upsert({
      appId: 'app-123456',
      businessId: 'business-1',
      storeId: 'store-1',
      channelId: 'channel-1',
      status: 'channel_ready',
      source: 'tool_channel_ensure',
    });

    const binding = repository.upsert({
      appId: 'app-123456',
      businessId: 'business-2',
      storeId: 'store-2',
      channelId: null,
      channelName: null,
      status: 'store_bound',
      source: 'user_selected',
      eventType: 'selected_store',
      actorType: 'user',
      reason: 'Merchant switched stores in settings',
    });

    expect(binding).toMatchObject({
      businessId: 'business-2',
      storeId: 'store-2',
      channelId: null,
      status: 'store_bound',
      source: 'user_selected',
    });

    const events = repository.listEventsByAppId('app-123456');
    expect(events[0]).toMatchObject({
      previousBusinessId: 'business-1',
      previousStoreId: 'store-1',
      previousChannelId: 'channel-1',
      nextBusinessId: 'business-2',
      nextStoreId: 'store-2',
      nextChannelId: null,
      actorType: 'user',
    });
  });

  it('rolls back the binding update when event recording fails during upsert', () => {
    insertApp();
    repository.upsert({
      appId: 'app-123456',
      businessId: 'business-1',
      storeId: 'store-1',
      status: 'store_bound',
      source: 'tool_setup',
    });

    testDb
      .prepare(`
        CREATE TEMP TRIGGER fail_app_commerce_binding_event_insert
        BEFORE INSERT ON app_commerce_binding_events
        BEGIN
          SELECT RAISE(ABORT, 'forced event insert failure');
        END
      `)
      .run();

    try {
      expect(() => repository.upsert({
        appId: 'app-123456',
        businessId: 'business-2',
        storeId: 'store-2',
        status: 'store_bound',
        source: 'tool_setup',
        eventType: 'selected_store',
      })).toThrow(/forced event insert failure/);
    } finally {
      testDb.prepare(`DROP TRIGGER fail_app_commerce_binding_event_insert`).run();
    }

    expect(repository.findByAppId('app-123456')).toMatchObject({
      businessId: 'business-1',
      storeId: 'store-1',
      status: 'store_bound',
    });
    expect(repository.listEventsByAppId('app-123456')).toHaveLength(0);
  });

  it('throws on upsert merge-base read failure without clearing existing fields', () => {
    insertApp();
    repository.upsert({
      appId: 'app-123456',
      businessId: 'business-1',
      storeId: 'store-1',
      channelId: 'channel-1',
      status: 'channel_ready',
      source: 'tool_channel_ensure',
    });

    const originalPrepare = testDb.prepare.bind(testDb);
    let failNextBindingRead = true;
    const prepareSpy = vi.spyOn(testDb, 'prepare').mockImplementation((source: string) => {
      if (
        failNextBindingRead
        && source.includes('SELECT * FROM app_commerce_bindings WHERE app_id = ?')
      ) {
        failNextBindingRead = false;
        throw new Error('forced previous binding read failure');
      }

      return originalPrepare(source);
    });

    try {
      expect(() => repository.upsert({
        appId: 'app-123456',
        verificationError: 'could not verify commerce binding',
        status: 'invalid',
        source: 'tool_channel_ensure',
        eventType: 'verification_failed',
      })).toThrow(/forced previous binding read failure/);
    } finally {
      prepareSpy.mockRestore();
    }

    expect(repository.findByAppId('app-123456')).toMatchObject({
      businessId: 'business-1',
      storeId: 'store-1',
      channelId: 'channel-1',
      status: 'channel_ready',
    });
    expect(repository.listEventsByAppId('app-123456')).toHaveLength(0);
  });

  it('enforces channel_ready requires store and channel ids', () => {
    insertApp();

    expect(() => repository.upsert({
      appId: 'app-123456',
      status: 'channel_ready',
      source: 'tool_channel_ensure',
    })).toThrow();
  });
});

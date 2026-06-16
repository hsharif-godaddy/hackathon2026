import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeTestDatabase } from '../../schema.js';

describe('dkim_onboarding schema', () => {
  let db: Database.Database;

  afterEach(() => {
    try { db?.close(); } catch { /* ignore */ }
  });

  it('creates the dkim_onboarding table', () => {
    db = new Database(':memory:');
    initializeTestDatabase(db);
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dkim_onboarding'`)
      .get();
    expect(row).toBeTruthy();
  });

  it('enforces UNIQUE(app_id, domain) constraint', () => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    db.prepare(
      `INSERT INTO apps (id, name, path, port, status) VALUES ('aaaaaaaaaa', 'x', '/x', 5000, 'created')`
    ).run();

    db.prepare(
      `INSERT INTO dkim_onboarding (id, app_id, domain, status) VALUES ('dkim0000001', 'aaaaaaaaaa', 'example.com', 'pending')`
    ).run();

    expect(() =>
      db.prepare(
        `INSERT INTO dkim_onboarding (id, app_id, domain, status) VALUES ('dkim0000002', 'aaaaaaaaaa', 'example.com', 'pending')`
      ).run()
    ).toThrow();
  });
});

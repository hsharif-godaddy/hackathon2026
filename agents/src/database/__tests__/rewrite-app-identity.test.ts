import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { rewriteAppIdentity, RewriteAppIdentityError } from '../rewrite-app-identity.js';

/** Capture warn events without pulling in the real logger. */
function makeLogger() {
  const warns: Array<{ event: string; meta?: Record<string, unknown> }> = [];
  return {
    logger: { info: () => {}, warn: (event: string, meta?: Record<string, unknown>) => warns.push({ event, meta }) },
    warns,
  };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof RewriteAppIdentityError) return e.code;
    throw e;
  }
  throw new Error('expected RewriteAppIdentityError, but no error was thrown');
}

// Arbitrary, obviously-synthetic fixtures — the code is generic for any app/cell.
const OLD_ID = 'sourceapp1';
const NEW_ID = 'targetapp2';
const OLD_CELL = 'c1';
const NEW_CELL = 'c2';

/**
 * Minimal schema that mirrors the shapes we care about:
 * - apps: PK is the app ID
 * - conversations: FK to apps(id) + a JSON/URL-bearing text column
 * - app_metadata: JSON blob with embedded id and URL
 * - oauth_tokens: FK to apps(id) + an EXCLUDED encrypted column
 */
function buildSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      published_url TEXT
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      content TEXT,
      FOREIGN KEY (app_id) REFERENCES apps(id)
    );
    CREATE TABLE app_metadata (
      app_id TEXT NOT NULL,
      metadata TEXT,
      FOREIGN KEY (app_id) REFERENCES apps(id)
    );
    CREATE TABLE oauth_tokens (
      app_id TEXT NOT NULL,
      access_token_encrypted TEXT,
      FOREIGN KEY (app_id) REFERENCES apps(id)
    );
  `);
}

function seed(db: Database.Database): void {
  // Publish URL uses the "<app>.<cell>.<domain>" shape.
  db.prepare('INSERT INTO apps (id, published_url) VALUES (?, ?)').run(
    OLD_ID,
    `https://${OLD_ID}.${OLD_CELL}.airoapp.ai`
  );
  // Conversation content carries the real preview + agent URL shapes (with the
  // ".preview."/".agent." infix) plus a test-domain host — the exact cases the
  // hardcoded ".<cell>.airoapp.ai" anchor used to miss.
  db.prepare('INSERT INTO conversations (id, app_id, content) VALUES (?, ?, ?)').run(
    'conv1',
    OLD_ID,
    JSON.stringify({
      ref: `/api/apps/${OLD_ID}/chat`,
      preview: `https://${OLD_ID}.preview.${OLD_CELL}.airoapp.ai/x`,
      agent: `https://${OLD_ID}.agent.${OLD_CELL}.airoapp.ai`,
      test: `https://${OLD_ID}.${OLD_CELL}.test-airoapp.ai`,
    })
  );
  db.prepare('INSERT INTO app_metadata (app_id, metadata) VALUES (?, ?)').run(
    OLD_ID,
    JSON.stringify({ appId: OLD_ID, preview: `${OLD_ID}.preview.${OLD_CELL}.airoapp.ai` })
  );
  // Encrypted ciphertext that happens to contain the old id substring — must be left untouched.
  db.prepare('INSERT INTO oauth_tokens (app_id, access_token_encrypted) VALUES (?, ?)').run(
    OLD_ID,
    `cipher-${OLD_ID}-blob`
  );
}

describe('rewriteAppIdentity', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    buildSchema(db);
    seed(db);
  });

  afterEach(() => {
    db.close();
  });

  it('rewrites the app ID across PK, FK columns, and embedded JSON/URL blobs', () => {
    const report = rewriteAppIdentity(db, {
      oldAppId: OLD_ID,
      newAppId: NEW_ID,
      oldCell: OLD_CELL,
      newCell: NEW_CELL,
    });

    // PK rewritten
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(NEW_ID)).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(OLD_ID)).toEqual({ n: 0 });

    // FK columns rewritten
    expect(db.prepare('SELECT app_id FROM conversations WHERE id = ?').get('conv1')).toEqual({
      app_id: NEW_ID,
    });

    // Embedded JSON/URL rewritten (id + cell) across every URL shape and domain:
    // preview (".preview." infix), agent (".agent." infix), and the .test-airoapp.ai domain.
    const conv = db.prepare('SELECT content FROM conversations WHERE id = ?').get('conv1') as { content: string };
    expect(conv.content).toContain(`/api/apps/${NEW_ID}/chat`);
    expect(conv.content).toContain(`https://${NEW_ID}.preview.${NEW_CELL}.airoapp.ai/x`);
    expect(conv.content).toContain(`https://${NEW_ID}.agent.${NEW_CELL}.airoapp.ai`);
    expect(conv.content).toContain(`https://${NEW_ID}.${NEW_CELL}.test-airoapp.ai`);
    expect(conv.content).not.toContain(OLD_ID);
    expect(conv.content).not.toContain(`.${OLD_CELL}.airoapp.ai`);
    expect(conv.content).not.toContain(`.${OLD_CELL}.test-airoapp.ai`);

    const meta = db.prepare('SELECT metadata FROM app_metadata WHERE app_id = ?').get(NEW_ID) as { metadata: string };
    expect(meta.metadata).toContain(`"appId":"${NEW_ID}"`);
    expect(meta.metadata).toContain(`${NEW_ID}.preview.${NEW_CELL}.airoapp.ai`);

    // published_url got both id and cell rewritten
    const app = db.prepare('SELECT published_url FROM apps WHERE id = ?').get(NEW_ID) as { published_url: string };
    expect(app.published_url).toBe(`https://${NEW_ID}.${NEW_CELL}.airoapp.ai`);

    expect(report.appIdReplacements).toBeGreaterThan(0);
    expect(report.cellReplacements).toBeGreaterThan(0);
    expect(report.tablesTouched).toEqual(expect.arrayContaining(['apps', 'conversations', 'app_metadata']));
  });

  it('does NOT modify encrypted token columns', () => {
    rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: NEW_ID });
    const row = db
      .prepare('SELECT access_token_encrypted FROM oauth_tokens WHERE app_id = ?')
      .get(NEW_ID) as { access_token_encrypted: string };
    // FK column (app_id) was rewritten, but the ciphertext blob is left as-is.
    expect(row.access_token_encrypted).toBe(`cipher-${OLD_ID}-blob`);
  });

  it('only rewrites the cell inside the .<cell>.airoapp.ai anchor, not bare cell tokens', () => {
    // A row whose content contains the bare cell token but not the URL anchor.
    db.prepare('INSERT INTO conversations (id, app_id, content) VALUES (?, ?, ?)').run(
      'conv2',
      OLD_ID,
      `note about ${OLD_CELL} pricing tier and ${OLD_ID}`
    );

    rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: NEW_ID, oldCell: OLD_CELL, newCell: NEW_CELL });

    const conv2 = db.prepare('SELECT content FROM conversations WHERE id = ?').get('conv2') as { content: string };
    // app id rewritten, but the bare cell token is left alone (not a host anchor)
    expect(conv2.content).toBe(`note about ${OLD_CELL} pricing tier and ${NEW_ID}`);
  });

  it('works with app-ID-only rewrite (no cell provided)', () => {
    const report = rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: NEW_ID });
    expect(report.cellReplacements).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(NEW_ID)).toEqual({ n: 1 });
    // Cell anchor untouched since no cell was requested
    const app = db.prepare('SELECT published_url FROM apps WHERE id = ?').get(NEW_ID) as { published_url: string };
    expect(app.published_url).toBe(`https://${NEW_ID}.${OLD_CELL}.airoapp.ai`);
  });

  it('rolls back and throws fk_violation when a referencing column is missed by the text sweep', () => {
    // widgets.app_id has INTEGER affinity, so it is NOT a text column the sweep
    // touches. After the PK rewrite, its stored old id becomes a dangling FK,
    // which foreign_key_check must catch — forcing a full rollback.
    db.exec(`CREATE TABLE widgets (id TEXT PRIMARY KEY, app_id INT REFERENCES apps(id));`);
    db.prepare('INSERT INTO widgets (id, app_id) VALUES (?, ?)').run('w1', OLD_ID);

    expect(() => rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: NEW_ID })).toThrow(
      RewriteAppIdentityError
    );

    // Rollback: everything is exactly as before.
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(OLD_ID)).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(NEW_ID)).toEqual({ n: 0 });
    expect(db.prepare('SELECT app_id FROM conversations WHERE id = ?').get('conv1')).toEqual({
      app_id: OLD_ID,
    });
  });

  it('throws source_missing when the old app ID is not present', () => {
    expect(() => rewriteAppIdentity(db, { oldAppId: 'zzzzz00000', newAppId: NEW_ID })).toThrowError(
      /nothing to rewrite/
    );
  });

  it('removes all old-id references even when the target id is already present', () => {
    // Simulate the agent's boot self-register re-creating the target id as a bare stub
    // (the clone collision: both source and target present when the rewrite runs). The
    // rewrite must still sweep every old-id reference rather than aborting.
    db.prepare('INSERT INTO apps (id, published_url) VALUES (?, ?)').run(NEW_ID, null);

    const report = rewriteAppIdentity(db, {
      oldAppId: OLD_ID,
      newAppId: NEW_ID,
      oldCell: OLD_CELL,
      newCell: NEW_CELL,
    });

    // Stub gone, source renamed onto the target id, exactly one target row remains.
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(NEW_ID)).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(OLD_ID)).toEqual({ n: 0 });
    expect(report.appIdReplacements).toBeGreaterThan(0);
    // No old references left behind (the verification pass would have thrown otherwise).
    expect(db.prepare('SELECT app_id FROM conversations WHERE id = ?').get('conv1')).toEqual({
      app_id: NEW_ID,
    });
  });

  it('takes over a target stub that has a child row whose FK lacks ON DELETE CASCADE', () => {
    // Stub present WITH a child conversation. The test schema's FK has no ON DELETE CASCADE, so
    // an FK-on delete of the stub would be rejected — the takeover must delete it with FK off
    // (inside the transaction), and the pre-commit foreign_key_check still guarantees integrity.
    db.prepare('INSERT INTO apps (id, published_url) VALUES (?, ?)').run(NEW_ID, null);
    db.prepare('INSERT INTO conversations (id, app_id, content) VALUES (?, ?, ?)').run('stub-conv', NEW_ID, '{}');

    const report = rewriteAppIdentity(db, {
      oldAppId: OLD_ID,
      newAppId: NEW_ID,
      oldCell: OLD_CELL,
      newCell: NEW_CELL,
    });

    expect(report.appIdReplacements).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(NEW_ID)).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(OLD_ID)).toEqual({ n: 0 });
  });

  it('clears app_id-keyed child rows on the target stub so the rename does not collide on PK', () => {
    // A child table keyed by app_id as its PRIMARY KEY (like app_metadata / app_commerce_bindings).
    db.exec(`CREATE TABLE app_settings (app_id TEXT PRIMARY KEY, value TEXT, FOREIGN KEY (app_id) REFERENCES apps(id));`);
    db.prepare('INSERT INTO app_settings (app_id, value) VALUES (?, ?)').run(OLD_ID, `src-${OLD_ID}`);

    // Target stub present WITH its own app_settings row (PK app_id = NEW_ID). Renaming the source
    // row onto NEW_ID would violate the app_settings PK unless the stub's row is cleared first.
    db.prepare('INSERT INTO apps (id, published_url) VALUES (?, ?)').run(NEW_ID, null);
    db.prepare('INSERT INTO app_settings (app_id, value) VALUES (?, ?)').run(NEW_ID, 'stub-value');

    const report = rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: NEW_ID });

    expect(report.appIdReplacements).toBeGreaterThan(0);
    // Exactly one row remains for the target — the source's (renamed), not the discarded stub's.
    const rows = db.prepare('SELECT value FROM app_settings WHERE app_id = ?').all(NEW_ID) as Array<{ value: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(`src-${NEW_ID}`);
  });

  it('excludes *_encrypted/_iv/_tag columns by suffix, not just the original hardcoded names', () => {
    // A NEW table with encrypted-shaped columns that were NOT in the old hardcoded list. Suffix
    // matching must still exclude them from the sweep while rewriting the app_id FK.
    db.exec(`CREATE TABLE sessions (app_id TEXT NOT NULL, session_iv TEXT, payload_tag TEXT, secret_encrypted TEXT, FOREIGN KEY (app_id) REFERENCES apps(id));`);
    db.prepare('INSERT INTO sessions (app_id, session_iv, payload_tag, secret_encrypted) VALUES (?, ?, ?, ?)').run(
      OLD_ID,
      `iv-${OLD_ID}-blob`,
      `tag-${OLD_ID}-blob`,
      `enc-${OLD_ID}-blob`
    );

    rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: NEW_ID });

    const row = db
      .prepare('SELECT app_id, session_iv, payload_tag, secret_encrypted FROM sessions')
      .get() as { app_id: string; session_iv: string; payload_tag: string; secret_encrypted: string };
    // FK column rewritten…
    expect(row.app_id).toBe(NEW_ID);
    // …but the opaque crypto blobs are left untouched (excluded by _iv / _tag / _encrypted suffix).
    expect(row.session_iv).toBe(`iv-${OLD_ID}-blob`);
    expect(row.payload_tag).toBe(`tag-${OLD_ID}-blob`);
    expect(row.secret_encrypted).toBe(`enc-${OLD_ID}-blob`);
  });

  it('returns alreadyConsistent (no-op) when source is gone and target is present with no old refs', () => {
    // Simulate a re-run after a rewrite already succeeded: only the NEW id remains and nothing
    // references the OLD id anywhere. Must not fail with source_missing — the clone continues.
    db.exec('DELETE FROM conversations');
    db.exec('DELETE FROM app_metadata');
    db.exec('DELETE FROM oauth_tokens');
    db.exec('DELETE FROM apps');
    db.prepare('INSERT INTO apps (id, published_url) VALUES (?, ?)').run(
      NEW_ID,
      `https://${NEW_ID}.${NEW_CELL}.airoapp.ai`
    );

    const report = rewriteAppIdentity(db, {
      oldAppId: OLD_ID,
      newAppId: NEW_ID,
      oldCell: OLD_CELL,
      newCell: NEW_CELL,
    });

    expect(report.alreadyConsistent).toBe(true);
    expect(report.appIdReplacements).toBe(0);
    expect(report.cellReplacements).toBe(0);
  });

  it('rejects invalid app IDs and cell tokens with the right error codes', () => {
    expect(codeOf(() => rewriteAppIdentity(db, { oldAppId: 'BAD', newAppId: NEW_ID }))).toBe('invalid_app_id');
    expect(codeOf(() => rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: OLD_ID }))).toBe('same_app_id');
    expect(
      codeOf(() => rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: NEW_ID, oldCell: OLD_CELL }))
    ).toBe('cell_incomplete');
    // Uppercase fails CELL_RE (/^[a-z0-9]{1,16}$/) → invalid_cell, distinct from cell_incomplete.
    expect(
      codeOf(() => rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: NEW_ID, oldCell: 'C1', newCell: NEW_CELL }))
    ).toBe('invalid_cell');
    expect(
      codeOf(() => rewriteAppIdentity(db, { oldAppId: OLD_ID, newAppId: NEW_ID, oldCell: OLD_CELL, newCell: 'toolongcelltoken0' }))
    ).toBe('invalid_cell');
  });

  it('warns on a cell no-op: cell tokens supplied but nothing matched a host anchor', () => {
    // Fresh app with NO cell-bearing URL anywhere, only an app-id reference.
    db.exec('DELETE FROM conversations; DELETE FROM app_metadata; DELETE FROM oauth_tokens;');
    db.prepare('UPDATE apps SET published_url = ? WHERE id = ?').run(`/local/${OLD_ID}`, OLD_ID);

    const { logger, warns } = makeLogger();
    const report = rewriteAppIdentity(
      db,
      { oldAppId: OLD_ID, newAppId: NEW_ID, oldCell: OLD_CELL, newCell: NEW_CELL },
      logger
    );

    expect(report.cellReplacements).toBe(0);
    expect(report.appIdReplacements).toBeGreaterThan(0);
    expect(warns.some((w) => w.event === 'rewrite_app_identity.cell_no_op')).toBe(true);
  });
});

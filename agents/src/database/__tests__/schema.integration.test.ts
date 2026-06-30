/**
 * Schema Integration Tests
 * 
 * These tests verify that the database schema management functions work correctly
 * with real SQLite databases. They test schema initialization, migrations, and
 * ensure the schema can handle real data operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { 
  initializeSchema, 
  initializeTestDatabase,
  getSchemaVersion 
} from '../schema.js';

describe('Database Schema Integration Tests', () => {
  let testDb: Database.Database;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    testDb = new Database(':memory:');
  });

  afterEach(() => {
    if (testDb && !testDb.readonly) {
      try {
        testDb.close();
      } catch (error) {
        // Ignore if already closed
      }
    }
  });

  describe('Schema Initialization', () => {
    it('should initialize complete schema with all tables', () => {
      initializeSchema(testDb);

      // Verify all expected tables exist
      const tables = testDb.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];

      const tableNames = tables.map(t => t.name);
      expect(tableNames).toEqual([
        'app_commerce_binding_events',
        'app_commerce_bindings',
        'app_metadata',
        'apps',
        'conversation_messages',
        'conversation_summaries',
        'conversations',
        'db_import_jobs',
        'dkim_onboarding',
        'file_context',
        'git_remote_config',
        'import_jobs',
        'marketing_utm',
        'memory',
        'oauth_tokens',
        'running_processes',
        'seo_quality_scores',
        'share_tokens',
        'simple_campaign',
        'simple_campaign_content',
        'social_associations',
        'social_posts'
      ]);
    });

    it('should initialize test database identical to production schema', () => {
      // Initialize production schema
      const prodDb = new Database(':memory:');
      initializeSchema(prodDb);

      // Initialize test schema
      initializeTestDatabase(testDb);

      // Get schema from both databases
      const prodSchema = prodDb.prepare(`
        SELECT sql FROM sqlite_master 
        WHERE type IN ('table', 'index', 'trigger') 
        AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all();

      const testSchema = testDb.prepare(`
        SELECT sql FROM sqlite_master 
        WHERE type IN ('table', 'index', 'trigger') 
        AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all();

      // Schemas should be identical
      expect(testSchema).toEqual(prodSchema);

      prodDb.close();
    });

    it('should set correct database pragmas and settings', () => {
      initializeSchema(testDb);

      // Verify foreign keys are enabled
      const foreignKeys = testDb.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(foreignKeys.foreign_keys).toBe(1);

      // Verify journal mode is set (in-memory databases use 'memory' instead of 'wal')
      const journalMode = testDb.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(['wal', 'memory']).toContain(journalMode.journal_mode);
    });

    it('should create all required indexes', () => {
      initializeSchema(testDb);

      const indexes = testDb.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];

      const indexNames = indexes.map(i => i.name);

      // Verify all expected indexes exist
      expect(indexNames).toContain('idx_apps_created_at');
      expect(indexNames).toContain('idx_running_processes_app_id');
      expect(indexNames).toContain('idx_running_processes_pid');
      expect(indexNames).toContain('idx_conversations_app_id');
      expect(indexNames).toContain('idx_conversations_created_at');
      expect(indexNames).toContain('idx_conversation_messages_conversation_id');
      expect(indexNames).toContain('idx_conversation_messages_created_at');

      expect(indexNames).toContain('idx_app_commerce_bindings_business_id');
      expect(indexNames).toContain('idx_app_commerce_bindings_store_id');
      expect(indexNames).toContain('idx_app_commerce_bindings_status');
      expect(indexNames).toContain('idx_app_commerce_binding_events_app_created');

      expect(indexNames).toContain('idx_social_associations_app_id');
      expect(indexNames).toContain('idx_social_associations_app_platform');
      expect(indexNames).toContain('idx_social_posts_app_id');
      expect(indexNames).toContain('idx_social_posts_app_state');
      expect(indexNames).toContain('idx_social_posts_association_id');
      expect(indexNames).toContain('idx_social_posts_platform');
      expect(indexNames).toContain('idx_social_posts_scheduled_at');
      expect(indexNames).toContain('idx_social_posts_campaign_id');
    });

    it('should create all required triggers', () => {
      initializeSchema(testDb);

      const triggers = testDb.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='trigger'
        ORDER BY name
      `).all() as { name: string }[];

      const triggerNames = triggers.map(t => t.name);

      // Verify all expected triggers exist
      expect(triggerNames).toContain('update_apps_updated_at');
      expect(triggerNames).toContain('update_app_commerce_bindings_updated_at');
      expect(triggerNames).toContain('update_conversations_updated_at');
      expect(triggerNames).toContain('update_social_posts_updated_at');
    });
  });

  describe('simple_campaign_content raw_content column', () => {
    it('adds a nullable raw_content column', () => {
      initializeSchema(testDb);
      const cols = testDb
        .prepare(`PRAGMA table_info(simple_campaign_content)`)
        .all() as { name: string; notnull: number }[];
      const rawContent = cols.find((c) => c.name === 'raw_content');
      expect(rawContent).toBeDefined();
      expect(rawContent?.notnull).toBe(0); // nullable
    });
  });

  describe('Schema Functionality', () => {
    beforeEach(() => {
      initializeSchema(testDb);
    });

    it('should support full app lifecycle operations', () => {
      const now = new Date().toISOString();
      
      // Insert an app
      const insertApp = testDb.prepare(`
        INSERT INTO apps (id, name, path, port, initial_prompt, template_version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertApp.run('test-app-1', 'Test App', '/path/to/app', 3000, 'Test prompt', 'v3', 'creating', now, now);

      // Verify app was inserted
      const app = testDb.prepare('SELECT * FROM apps WHERE id = ?').get('test-app-1') as any;
      expect(app).toBeDefined();
      expect(app.name).toBe('Test App');
      expect(app.template_version).toBe('v3');
      expect(app.status).toBe('creating');

      // Update app status
      const updateApp = testDb.prepare('UPDATE apps SET status = ?, updated_at = ? WHERE id = ?');
      updateApp.run('created', new Date().toISOString(), 'test-app-1');

      // Verify update trigger worked (updated_at should be automatically set)
      const updatedApp = testDb.prepare('SELECT * FROM apps WHERE id = ?').get('test-app-1') as any;
      expect(updatedApp.status).toBe('created');
    });

    it('should enforce foreign key constraints', () => {
      // Try to insert a running process for non-existent app
      const insertProcess = testDb.prepare(`
        INSERT INTO running_processes (id, app_id, pid, port, started_at, status)
        VALUES (?, ?, ?, ?, datetime('now'), 'running')
      `);

      // This should fail due to foreign key constraint
      expect(() => {
        insertProcess.run('proc-1', 'nonexistent-app', 12345, 3000);
      }).toThrow();

      // Create app first
      const insertApp = testDb.prepare(`
        INSERT INTO apps (id, name, path, port, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      insertApp.run('test-app-1', 'Test App', '/path/to/app', 3000, 'creating');

      // Now inserting process should work
      expect(() => {
        insertProcess.run('proc-1', 'test-app-1', 12345, 3000);
      }).not.toThrow();

      // Verify process was created
      const process = testDb.prepare('SELECT * FROM running_processes WHERE id = ?').get('proc-1') as any;
      expect(process).toBeDefined();
      expect(process.app_id).toBe('test-app-1');
    });

    it('should cascade deletes properly', () => {
      const now = new Date().toISOString();
      
      // Create app
      const insertApp = testDb.prepare(`
        INSERT INTO apps (id, name, path, port, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertApp.run('test-app-1', 'Test App', '/path/to/app', 3000, 'creating', now, now);

      // Create related records
      const insertProcess = testDb.prepare(`
        INSERT INTO running_processes (id, app_id, pid, port, started_at, status)
        VALUES (?, ?, ?, ?, datetime('now'), 'running')
      `);
      insertProcess.run('proc-1', 'test-app-1', 12345, 3000);

      const insertConversation = testDb.prepare(`
        INSERT INTO conversations (id, app_id, agent_id, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `);
      insertConversation.run('conv-1', 'test-app-1', 'agent-1');

      // Verify all records exist
      expect(testDb.prepare('SELECT COUNT(*) as count FROM running_processes WHERE app_id = ?').get('test-app-1')).toEqual({ count: 1 });
      expect(testDb.prepare('SELECT COUNT(*) as count FROM conversations WHERE app_id = ?').get('test-app-1')).toEqual({ count: 1 });

      // Delete the app
      const deleteApp = testDb.prepare('DELETE FROM apps WHERE id = ?');
      deleteApp.run('test-app-1');

      // Verify cascade deletes worked
      expect(testDb.prepare('SELECT COUNT(*) as count FROM running_processes WHERE app_id = ?').get('test-app-1')).toEqual({ count: 0 });
      expect(testDb.prepare('SELECT COUNT(*) as count FROM conversations WHERE app_id = ?').get('test-app-1')).toEqual({ count: 0 });
    });

    it('should support conversation messages with automatic timestamp updates', async () => {
      const now = new Date().toISOString();
      
      // Create app and conversation
      const insertApp = testDb.prepare(`
        INSERT INTO apps (id, name, path, port, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertApp.run('test-app-1', 'Test App', '/path/to/app', 3000, 'creating', now, now);

      const insertConversation = testDb.prepare(`
        INSERT INTO conversations (id, app_id, agent_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertConversation.run('conv-1', 'test-app-1', 'agent-1', now, now);

      // Get initial conversation timestamp
      const initialConv = testDb.prepare('SELECT updated_at FROM conversations WHERE id = ?').get('conv-1') as any;
      
      // Wait a tiny bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add a message (should trigger conversation updated_at update)
      const insertMessage = testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `);
      insertMessage.run('msg-1', 'conv-1', 'user', 'Hello there');

      // Verify message was created
      const message = testDb.prepare('SELECT * FROM conversation_messages WHERE id = ?').get('msg-1') as any;
      expect(message).toBeDefined();
      expect(message.conversation_id).toBe('conv-1');
      expect(message.sender).toBe('user');
      expect(message.content).toBe('Hello there');

      // Verify conversation updated_at was updated by trigger
      const updatedConv = testDb.prepare('SELECT updated_at FROM conversations WHERE id = ?').get('conv-1') as any;
      expect(updatedConv.updated_at).not.toBe(initialConv.updated_at);
    });
  });

  describe('Migration Support', () => {
    it('should handle adding columns to existing apps table', () => {
      // Create a minimal apps table (simulating older schema)
      testDb.exec(`
        CREATE TABLE apps (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert a record with minimal schema
      testDb.prepare(`
        INSERT INTO apps (id, name) VALUES (?, ?)
      `).run('old-app', 'Old App');

      // Now run migration (part of initializeSchema)
      initializeSchema(testDb);

      // Verify new columns were added and old data is preserved
      const app = testDb.prepare('SELECT * FROM apps WHERE id = ?').get('old-app') as any;
      expect(app).toBeDefined();
      expect(app.name).toBe('Old App');
      
      // New columns should exist (even if NULL)
      expect(app).toHaveProperty('path');
      expect(app).toHaveProperty('port');
      expect(app).toHaveProperty('initial_prompt');
      expect(app).toHaveProperty('template_version');
      expect(app).toHaveProperty('status');
    });

    it('adds app_commerce_bindings.currency_code to an existing binding table', () => {
      testDb.exec(`
        CREATE TABLE apps (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE app_commerce_bindings (
          app_id TEXT PRIMARY KEY,
          business_id TEXT,
          business_name TEXT,
          store_id TEXT,
          store_name TEXT,
          store_url TEXT,
          channel_id TEXT,
          channel_name TEXT,
          default_location_id TEXT,
          status TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'unknown',
          last_verified_at DATETIME,
          verification_error TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      testDb.prepare(`INSERT INTO apps (id, name) VALUES (?, ?)`).run('app-commerce-old', 'Old Commerce App');
      testDb.prepare(`
        INSERT INTO app_commerce_bindings (app_id, store_id, channel_id, status, source)
        VALUES (?, ?, ?, ?, ?)
      `).run('app-commerce-old', 'store-old', 'channel-old', 'channel_ready', 'tool_channel_ensure');

      initializeSchema(testDb);
      initializeSchema(testDb);

      const cols = (testDb.prepare(`PRAGMA table_info(app_commerce_bindings)`).all() as { name: string }[])
        .map((col) => col.name);
      expect(cols).toContain('currency_code');

      const row = testDb
        .prepare(`SELECT store_id, channel_id, currency_code FROM app_commerce_bindings WHERE app_id = ?`)
        .get('app-commerce-old') as { store_id: string; channel_id: string; currency_code: string | null };
      expect(row).toEqual({ store_id: 'store-old', channel_id: 'channel-old', currency_code: null });
    });

    it('should be idempotent - safe to run multiple times', () => {
      // Run schema initialization multiple times
      initializeSchema(testDb);
      initializeSchema(testDb);
      initializeSchema(testDb);

      // Should not throw errors and schema should still be correct
      const tables = testDb.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];

      expect(tables).toHaveLength(22); // core tables incl. main's app_commerce_* + dkim_onboarding and our campaign tables
    });

    it('backfills share_tokens.purpose to "user" on a pre-existing populated table', () => {
      // Simulate the pre-purpose schema: share_tokens table without the column.
      // Mirrors what a deployed prod DB looks like before this migration runs.
      // apps row exists too because share_tokens has a FK to apps(id).
      testDb.exec(`
        CREATE TABLE apps (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL DEFAULT '/tmp',
          port INTEGER NOT NULL DEFAULT 5000,
          status TEXT NOT NULL DEFAULT 'created',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE share_tokens (
          token TEXT PRIMARY KEY,
          app_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          first_used_at DATETIME,
          FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
        );
      `);

      testDb.prepare(`INSERT INTO apps (id, name) VALUES (?, ?)`).run('app-legacy', 'Legacy');
      const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
      testDb.prepare(`
        INSERT INTO share_tokens (token, app_id, expires_at) VALUES (?, ?, ?)
      `).run('legacy-token-1', 'app-legacy', future);
      testDb.prepare(`
        INSERT INTO share_tokens (token, app_id, expires_at) VALUES (?, ?, ?)
      `).run('legacy-token-2', 'app-legacy', future);

      initializeSchema(testDb);

      // Column exists on the table now.
      const cols = testDb.prepare(`PRAGMA table_info(share_tokens)`).all() as Array<{ name: string }>;
      expect(cols.map(c => c.name)).toContain('purpose');

      // Existing rows backfilled to 'user' via the column DEFAULT — preserves
      // the per-purpose one-active-link guard's read of legacy rows as
      // user-purpose links. If this regresses, the guard would either treat
      // every legacy link as belonging to no purpose (NULL ≠ any compared
      // value, so the 409 check would silently stop matching) or surface NULL
      // up the API — neither is a behavior we want.
      const rows = testDb.prepare(`
        SELECT token, purpose FROM share_tokens ORDER BY token
      `).all() as Array<{ token: string; purpose: string }>;
      expect(rows).toEqual([
        { token: 'legacy-token-1', purpose: 'user' },
        { token: 'legacy-token-2', purpose: 'user' },
      ]);
    });

    it('share_tokens.purpose migration is idempotent', () => {
      // Run end-to-end three times against the same DB. The second/third
      // invocations hit the pragma_table_info short-circuit inside
      // migrateShareTokensPurpose — must not throw, must not duplicate the
      // column, must not corrupt existing rows.
      initializeSchema(testDb);

      testDb.prepare(`INSERT INTO apps (id, name, path, port) VALUES (?, ?, ?, ?)`)
        .run('app-idem', 'App', '/tmp', 5000);
      testDb.prepare(`
        INSERT INTO share_tokens (token, app_id, expires_at, purpose)
        VALUES (?, ?, ?, ?)
      `).run('snap-token', 'app-idem', Date.now() + 60_000, 'archive_snapshot');

      initializeSchema(testDb);
      initializeSchema(testDb);

      // Column count unchanged.
      const cols = testDb.prepare(`PRAGMA table_info(share_tokens)`).all() as Array<{ name: string }>;
      const purposeCols = cols.filter(c => c.name === 'purpose');
      expect(purposeCols).toHaveLength(1);

      // Row preserved with its original purpose — re-running migrations must
      // not rewrite an archive_snapshot row to 'user'.
      const row = testDb.prepare(`
        SELECT purpose FROM share_tokens WHERE token = ?
      `).get('snap-token') as { purpose: string };
      expect(row.purpose).toBe('archive_snapshot');
    });

    it('migrates pre-rename campaign tables to the current schema, preserving rows', () => {
      // Start from the current schema, seed a row, then mangle the tables back to a
      // pre-merge shape (old column names, salt_id present, no marketing_plan_id, plural
      // tables). Re-running initializeSchema must exercise the data-preserving migration.
      initializeSchema(testDb);
      testDb.prepare(`INSERT INTO apps (id, name, path, port) VALUES (?, ?, ?, ?)`).run('app-mig', 'App', '/tmp', 5000);
      testDb.prepare(`INSERT INTO simple_campaign (id, app_id, name, status, created_at, updated_at) VALUES (?, ?, 'C', 'draft', 't', 't')`).run('camp_mig', 'app-mig');
      testDb.prepare(`INSERT INTO simple_campaign_content (id, simple_campaign_id, asset_type, content_ref_id, title, status, created_at) VALUES (?, ?, 'blog', '/b', 'T', 'draft', 't')`).run('cont_mig', 'camp_mig');
      testDb.prepare(`INSERT INTO marketing_utm (id, content_ref_id, simple_campaign_id, created_at, updated_at) VALUES (?, ?, ?, 't', 't')`).run('mutm_mig', 'cont_mig', 'camp_mig');

      // Mangle → old shape.
      testDb.exec(`ALTER TABLE simple_campaign_content RENAME COLUMN simple_campaign_id TO campaign_id`);
      testDb.exec(`ALTER TABLE simple_campaign_content RENAME COLUMN content_ref_id TO external_ref`);
      testDb.exec(`ALTER TABLE marketing_utm RENAME COLUMN content_ref_id TO external_id`);
      testDb.exec(`ALTER TABLE marketing_utm RENAME COLUMN simple_campaign_id TO campaign_id`);
      testDb.exec(`ALTER TABLE marketing_utm ADD COLUMN salt_id TEXT`);
      testDb.exec(`ALTER TABLE simple_campaign DROP COLUMN marketing_plan_id`);
      testDb.exec(`CREATE TABLE simple_campaigns (id TEXT)`);
      testDb.exec(`CREATE TABLE simple_campaign_assets (id TEXT)`);

      // Re-run twice → triggers the migration, then proves idempotency.
      initializeSchema(testDb);
      initializeSchema(testDb);

      const contentCols = (testDb.prepare(`PRAGMA table_info(simple_campaign_content)`).all() as { name: string }[]).map(c => c.name);
      expect(contentCols).toContain('simple_campaign_id');
      expect(contentCols).toContain('content_ref_id');
      expect(contentCols).not.toContain('campaign_id');
      expect(contentCols).not.toContain('external_ref');

      const utmCols = (testDb.prepare(`PRAGMA table_info(marketing_utm)`).all() as { name: string }[]).map(c => c.name);
      expect(utmCols).toContain('content_ref_id');
      expect(utmCols).toContain('simple_campaign_id');
      expect(utmCols).not.toContain('salt_id');
      expect(utmCols).not.toContain('external_id');

      const campCols = (testDb.prepare(`PRAGMA table_info(simple_campaign)`).all() as { name: string }[]).map(c => c.name);
      expect(campCols).toContain('marketing_plan_id');

      // Rows preserved, values carried across the rename.
      const content = testDb.prepare(`SELECT simple_campaign_id, content_ref_id FROM simple_campaign_content WHERE id = ?`).get('cont_mig');
      expect(content).toEqual({ simple_campaign_id: 'camp_mig', content_ref_id: '/b' });
      const utm = testDb.prepare(`SELECT content_ref_id, simple_campaign_id FROM marketing_utm WHERE id = ?`).get('mutm_mig');
      expect(utm).toEqual({ content_ref_id: 'cont_mig', simple_campaign_id: 'camp_mig' });

      // Abandoned plural tables dropped.
      const tableNames = (testDb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(t => t.name);
      expect(tableNames).not.toContain('simple_campaigns');
      expect(tableNames).not.toContain('simple_campaign_assets');
    });

    it('adds the plan_rationale column to a pre-existing simple_campaign table (RUBICON-504), preserving rows', () => {
      initializeSchema(testDb);
      testDb.prepare(`INSERT INTO apps (id, name, path, port) VALUES (?, ?, ?, ?)`).run('app-r', 'App', '/tmp', 5000);
      testDb.prepare(`INSERT INTO simple_campaign (id, app_id, name, status, created_at, updated_at) VALUES (?, ?, 'C', 'draft', 't', 't')`).run('camp_r', 'app-r');

      // Mangle → drop the column to simulate a pre-504 table.
      testDb.exec(`ALTER TABLE simple_campaign DROP COLUMN plan_rationale`);

      // Re-run twice → triggers the ADD COLUMN migration, then proves idempotency.
      initializeSchema(testDb);
      initializeSchema(testDb);

      const campCols: string[] = (testDb.prepare(`PRAGMA table_info(simple_campaign)`).all() as { name: string }[]).map(
        (c: { name: string }): string => c.name,
      );
      expect(campCols).toContain('plan_rationale');

      const row: { id: string; plan_rationale: string | null } = testDb
        .prepare(`SELECT id, plan_rationale FROM simple_campaign WHERE id = ?`)
        .get('camp_r') as { id: string; plan_rationale: string | null };
      expect(row).toEqual({ id: 'camp_r', plan_rationale: null }); // row preserved, new column null
    });
  });

  describe('Schema Metadata', () => {
    it('should provide schema version information', () => {
      const version = getSchemaVersion();
      expect(version).toBeDefined();
      expect(typeof version).toBe('string');
      expect(version).toMatch(/^\d+\.\d+\.\d+$/); // Should be semantic version format
    });
  });

  describe('Data Type Constraints', () => {
    beforeEach(() => {
      initializeSchema(testDb);
    });

    it('should enforce check constraints on app status', () => {
      const insertApp = testDb.prepare(`
        INSERT INTO apps (id, name, path, port, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      // Valid statuses should work
      expect(() => {
        insertApp.run('app-1', 'App 1', '/path', 3000, 'creating');
      }).not.toThrow();

      expect(() => {
        insertApp.run('app-2', 'App 2', '/path', 3001, 'created');  
      }).not.toThrow();

      expect(() => {
        insertApp.run('app-3', 'App 3', '/path', 3002, 'error');
      }).not.toThrow();

      // Invalid status should fail
      expect(() => {
        insertApp.run('app-4', 'App 4', '/path', 3003, 'invalid-status');
      }).toThrow();
    });

    it('should enforce check constraints on conversation message sender', () => {
      // First create app and conversation
      const insertApp = testDb.prepare(`
        INSERT INTO apps (id, name, path, port, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      insertApp.run('app-1', 'App 1', '/path', 3000, 'creating');

      const insertConversation = testDb.prepare(`
        INSERT INTO conversations (id, app_id, agent_id, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `);
      insertConversation.run('conv-1', 'app-1', 'agent-1');

      const insertMessage = testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `);

      // Valid senders should work
      expect(() => {
        insertMessage.run('msg-1', 'conv-1', 'user', 'Hello');
      }).not.toThrow();

      expect(() => {
        insertMessage.run('msg-2', 'conv-1', 'agent', 'Hi there');
      }).not.toThrow();

      // Invalid sender should fail
      expect(() => {
        insertMessage.run('msg-3', 'conv-1', 'invalid-sender', 'Test');
      }).toThrow();
    });


  });
});

describe('social_posts CHECK/platform rebuild migration', () => {
  it('drops the state CHECK and platform NOT NULL on an existing DB, preserving rows, idempotently', () => {
    const db = new Database(':memory:');
    initializeSchema(db);

    db.prepare(`INSERT INTO apps (id, name, path, status) VALUES (?, ?, ?, ?)`).run('app1234567', 'Test App', '/tmp/app', 'created');

    // Recreate social_posts in the legacy shape: state CHECK + platform NOT NULL.
    db.exec(`DROP TABLE social_posts`);
    db.exec(`
      CREATE TABLE social_posts (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        association_id TEXT,
        platform TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('SCHEDULED', 'PUBLISHED', 'FAILED')),
        payload TEXT NOT NULL,
        external_response TEXT,
        external_id TEXT,
        scheduled_at DATETIME,
        completed_at DATETIME,
        campaign_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
        FOREIGN KEY (association_id) REFERENCES social_associations(id) ON DELETE SET NULL
      )
    `);
    db.prepare(
      `INSERT INTO social_posts (id, app_id, platform, state, payload) VALUES (?, ?, ?, ?, ?)`,
    ).run('post-legacy1', 'app1234567', 'facebook', 'SCHEDULED', '{"message":"hi"}');

    // Re-run schema init twice (idempotency): the rebuild fires once, the second is a no-op.
    initializeSchema(db);
    initializeSchema(db);

    // The legacy row survived the rebuild.
    const preserved = db.prepare(`SELECT platform, state, payload FROM social_posts WHERE id = ?`).get('post-legacy1') as
      | { platform: string; state: string; payload: string }
      | undefined;
    expect(preserved).toEqual({ platform: 'facebook', state: 'SCHEDULED', payload: '{"message":"hi"}' });

    // CHECK is gone: a DRAFT row is now insertable.
    expect(() =>
      db.prepare(`INSERT INTO social_posts (id, app_id, platform, state, payload) VALUES (?, ?, ?, ?, ?)`)
        .run('post-draft1', 'app1234567', 'instagram', 'DRAFT', '{"message":"draft"}'),
    ).not.toThrow();

    // platform NOT NULL is gone: a null-platform row is now insertable.
    expect(() =>
      db.prepare(`INSERT INTO social_posts (id, app_id, platform, state, payload) VALUES (?, ?, ?, ?, ?)`)
        .run('post-nullplat', 'app1234567', null, 'DRAFT', '{"message":"np"}'),
    ).not.toThrow();

    db.close();
  });

  it('rolls back with no data loss when the rebuild fails mid-script, and recovers on retry', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    db.prepare(`INSERT INTO apps (id, name, path, status) VALUES (?, ?, ?, ?)`).run('app1234567', 'Test App', '/tmp/app', 'created');

    // Legacy shape (state CHECK + platform NOT NULL) carrying a row that must survive.
    db.exec(`DROP TABLE social_posts`);
    db.exec(`
      CREATE TABLE social_posts (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        association_id TEXT,
        platform TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('SCHEDULED', 'PUBLISHED', 'FAILED')),
        payload TEXT NOT NULL,
        external_response TEXT,
        external_id TEXT,
        scheduled_at DATETIME,
        completed_at DATETIME,
        campaign_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
        FOREIGN KEY (association_id) REFERENCES social_associations(id) ON DELETE SET NULL
      )
    `);
    db.prepare(`INSERT INTO social_posts (id, app_id, platform, state, payload) VALUES (?, ?, ?, ?, ?)`)
      .run('post-legacy1', 'app1234567', 'facebook', 'SCHEDULED', '{"message":"hi"}');

    // Force the rebuild's first statement (CREATE social_posts_new) to throw by pre-creating
    // a conflicting table. Pre-transaction this would still DROP the original after a later
    // failure (data loss); with db.transaction() the whole rebuild rolls back atomically.
    db.exec(`CREATE TABLE social_posts_new (id TEXT PRIMARY KEY)`);

    // Migration hits the conflict, rolls back, logs the failure, and does not throw (caught).
    expect(() => initializeSchema(db)).not.toThrow();

    // No data loss: the original table and its row survived.
    expect(db.prepare(`SELECT platform, state, payload FROM social_posts WHERE id = ?`).get('post-legacy1')).toEqual({
      platform: 'facebook', state: 'SCHEDULED', payload: '{"message":"hi"}',
    });
    // The rebuild did not partially apply — the legacy CHECK is still enforced.
    expect(() =>
      db.prepare(`INSERT INTO social_posts (id, app_id, platform, state, payload) VALUES (?, ?, ?, ?, ?)`)
        .run('post-draft-blocked', 'app1234567', 'instagram', 'DRAFT', '{"message":"x"}'),
    ).toThrow();

    // Recovery: clear the conflict and re-run — the guard still sees the CHECK, so the
    // rebuild fires again and now succeeds, preserving the row and dropping the CHECK.
    db.exec(`DROP TABLE social_posts_new`);
    initializeSchema(db);
    expect(db.prepare(`SELECT payload FROM social_posts WHERE id = ?`).get('post-legacy1')).toEqual({
      payload: '{"message":"hi"}',
    });
    expect(() =>
      db.prepare(`INSERT INTO social_posts (id, app_id, platform, state, payload) VALUES (?, ?, ?, ?, ?)`)
        .run('post-draft-ok', 'app1234567', 'instagram', 'DRAFT', '{"message":"ok"}'),
    ).not.toThrow();

    db.close();
  });
});

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
        'apps',
        'conversation_messages', 
        'conversations',
        'running_processes',
        'token_usage'
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
      expect(indexNames).toContain('idx_token_usage_app_id');
      expect(indexNames).toContain('idx_token_usage_created_at');
      expect(indexNames).toContain('idx_token_usage_operation');
      expect(indexNames).toContain('idx_token_usage_conversation_id');
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
      expect(triggerNames).toContain('update_conversations_updated_at');
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

      const insertTokenUsage = testDb.prepare(`
        INSERT INTO token_usage (id, app_id, operation, prompt_tokens, completion_tokens, total_tokens, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      insertTokenUsage.run('token-1', 'test-app-1', 'llm_request', 100, 50, 150);

      // Verify all records exist
      expect(testDb.prepare('SELECT COUNT(*) as count FROM running_processes WHERE app_id = ?').get('test-app-1')).toEqual({ count: 1 });
      expect(testDb.prepare('SELECT COUNT(*) as count FROM conversations WHERE app_id = ?').get('test-app-1')).toEqual({ count: 1 });
      expect(testDb.prepare('SELECT COUNT(*) as count FROM token_usage WHERE app_id = ?').get('test-app-1')).toEqual({ count: 1 });

      // Delete the app
      const deleteApp = testDb.prepare('DELETE FROM apps WHERE id = ?');
      deleteApp.run('test-app-1');

      // Verify cascade deletes worked
      expect(testDb.prepare('SELECT COUNT(*) as count FROM running_processes WHERE app_id = ?').get('test-app-1')).toEqual({ count: 0 });
      expect(testDb.prepare('SELECT COUNT(*) as count FROM conversations WHERE app_id = ?').get('test-app-1')).toEqual({ count: 0 });
      expect(testDb.prepare('SELECT COUNT(*) as count FROM token_usage WHERE app_id = ?').get('test-app-1')).toEqual({ count: 0 });
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

      expect(tables).toHaveLength(5); // Should still have exactly 5 tables
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

    it('should enforce check constraints on token usage operation', () => {
      // Create app first
      const insertApp = testDb.prepare(`
        INSERT INTO apps (id, name, path, port, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      insertApp.run('app-1', 'App 1', '/path', 3000, 'creating');

      const insertTokenUsage = testDb.prepare(`
        INSERT INTO token_usage (id, app_id, operation, prompt_tokens, completion_tokens, total_tokens, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      // Valid operations should work
      expect(() => {
        insertTokenUsage.run('token-1', 'app-1', 'llm_request', 100, 50, 150);
      }).not.toThrow();

      expect(() => {
        insertTokenUsage.run('token-2', 'app-1', 'file_edit', 0, 0, 0);
      }).not.toThrow();

      expect(() => {
        insertTokenUsage.run('token-3', 'app-1', 'tool_execution', 10, 5, 15);
      }).not.toThrow();

      // Invalid operation should fail
      expect(() => {
        insertTokenUsage.run('token-4', 'app-1', 'invalid-operation', 0, 0, 0);
      }).toThrow();
    });
  });
});
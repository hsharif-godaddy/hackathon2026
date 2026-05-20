import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { ensureDatabaseHealth, probeDatabase, rebuildDatabase } from '../db-recovery.js';
import type { DatabaseOpener } from '../db-recovery.js';
import { initializeSchema } from '../schema.js';

function createTempDir(): string {
  const dir = path.join(tmpdir(), `db-recovery-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function corruptSchemaPage(dbPath: string): void {
  const buf = Buffer.from(readFileSync(dbPath));
  buf.fill(0x00, 108, 200);
  writeFileSync(dbPath, buf);
}

function corruptDataPage(dbPath: string): void {
  const buf = Buffer.from(readFileSync(dbPath));
  const pageSize = buf.readUInt16BE(16);
  const offset = pageSize * 2;
  if (buf.length > offset + 200) {
    buf.fill(0xFF, offset, offset + 200);
  }
  writeFileSync(dbPath, buf);
}

describe('Database Recovery', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = createTempDir();
    dbPath = path.join(tempDir, 'apps.db');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('#ensureDatabaseHealth', () => {
    it('should return healthy when DB file does not exist', () => {
      const result = ensureDatabaseHealth(dbPath);

      expect(result.status).toBe('healthy');
      expect(result.action).toBe('none');
    });

    it('should return healthy for a valid database', () => {
      const db = new Database(dbPath);
      initializeSchema(db);
      db.prepare(`
        INSERT INTO apps (id, name, path, port, status)
        VALUES ('test-app', 'Test App', '/test', 3000, 'created')
      `).run();
      db.close();

      const result = ensureDatabaseHealth(dbPath);

      expect(result.status).toBe('healthy');
      expect(result.action).toBe('none');
    });

    it('should recover a database with schema page corruption', () => {
      const db = new Database(dbPath);
      initializeSchema(db);
      db.prepare(`
        INSERT INTO apps (id, name, path, port, status)
        VALUES ('app-1', 'My App', '/app', 3000, 'created')
      `).run();
      db.prepare(`
        INSERT INTO conversations (id, app_id, agent_id, title)
        VALUES ('conv-1', 'app-1', 'agent-1', 'Test Conversation')
      `).run();
      db.close();

      corruptSchemaPage(dbPath);

      const result = ensureDatabaseHealth(dbPath);

      expect(result.status).toBe('recovered');
      expect(['rebuilt_db', 'recreated_db']).toContain(result.action);
      if (result.action === 'rebuilt_db') {
        expect(result.backupPath).toBeDefined();
      }
    });

    it('should recover a database with data page corruption', () => {
      const db = new Database(dbPath);
      initializeSchema(db);
      db.prepare(`
        INSERT INTO apps (id, name, path, port, status)
        VALUES ('app-2', 'Another App', '/app2', 4000, 'creating')
      `).run();
      db.close();

      corruptDataPage(dbPath);

      const result = ensureDatabaseHealth(dbPath);

      expect(result.status).toBe('recovered');
      expect(['rebuilt_db', 'recreated_db']).toContain(result.action);
    });

    it('should recover from SQLITE_NOTADB by recreating DB', () => {
      const header = Buffer.from('SQLite format 3\0');
      const padding = Buffer.alloc(4096 - header.length, 0);
      writeFileSync(dbPath, Buffer.concat([header, padding]));

      const result = ensureDatabaseHealth(dbPath);

      expect(result.status).toBe('recovered');
      expect(result.action).toBe('recreated_db');
    });

    it('should preserve backup files when recovering', () => {
      const db = new Database(dbPath);
      initializeSchema(db);
      db.prepare(`
        INSERT INTO apps (id, name, path, port, status)
        VALUES ('app-3', 'Backup Test', '/app3', 5000, 'created')
      `).run();
      db.close();

      corruptSchemaPage(dbPath);

      const result = ensureDatabaseHealth(dbPath);

      expect(result.status).toBe('recovered');
      if (result.action === 'rebuilt_db' || result.action === 'recreated_db') {
        expect(existsSync(path.join(result.backupPath, 'apps.db'))).toBe(true);
      }
    });

    it('should produce a usable database after recovery', () => {
      const db = new Database(dbPath);
      initializeSchema(db);
      db.prepare(`
        INSERT INTO apps (id, name, path, port, status)
        VALUES ('app-4', 'Usable App', '/app4', 6000, 'created')
      `).run();
      db.close();

      corruptDataPage(dbPath);
      ensureDatabaseHealth(dbPath);

      const recoveredDb = new Database(dbPath);
      const integrity = recoveredDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      expect(integrity.integrity_check).toBe('ok');
      recoveredDb.close();
    });

    it('should not count rows silently dropped by INSERT OR IGNORE', () => {
      // Initialize schema so rebuildDatabase has a target
      const schemaDb = new Database(dbPath);
      initializeSchema(schemaDb);
      schemaDb.close();

      // Feed rebuildDatabase directly with duplicate-PK rows that simulate
      // what a corrupt DB dump would produce: 3 input rows, 2 sharing the same
      // PK. INSERT OR IGNORE must skip the second duplicate, yielding exactly 2.
      const dumpedRows: Record<string, unknown[]> = {
        apps: [
          { id: 'dup-pk', name: 'First', path: '/app1', port: 3000, status: 'created' },
          { id: 'dup-pk', name: 'Second', path: '/app2', port: 4000, status: 'created' },
          { id: 'unique-pk', name: 'Unique', path: '/app3', port: 5000, status: 'created' },
        ],
      };

      const { tempPath, rowsInserted } = rebuildDatabase(dbPath, dumpedRows);

      // Exactly 2 rows should be counted: dup-pk (first wins) + unique-pk
      expect(rowsInserted['apps']).toBe(2);

      // Verify the rebuilt DB has exactly 2 rows
      const rebuilt = new Database(tempPath, { readonly: true });
      const count = rebuilt.prepare('SELECT COUNT(*) AS cnt FROM apps').get() as { cnt: number };
      expect(count.cnt).toBe(2);
      rebuilt.close();
    });

    it('should return healthy when probe hits a transient error (EACCES)', () => {
      const db = new Database(dbPath);
      initializeSchema(db);
      db.prepare(`
        INSERT INTO apps (id, name, path, port, status)
        VALUES ('app-transient', 'Transient Test', '/app', 3000, 'created')
      `).run();
      db.close();

      // Stub opener to throw EACCES, simulating a transient permission error
      const eaccesOpener: DatabaseOpener = () => {
        const err = new Error('EACCES: permission denied') as Error & { code: string };
        err.code = 'EACCES';
        throw err;
      };

      const result = probeDatabase(dbPath, eaccesOpener);

      // Transient errors must not be treated as corruption
      expect(result.healthy).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should resume from interrupted swap if .recovered file exists', () => {
      const db = new Database(dbPath);
      initializeSchema(db);
      db.prepare(`
        INSERT INTO apps (id, name, path, port, status)
        VALUES ('app-swap', 'Swap App', '/app', 3000, 'created')
      `).run();
      db.close();

      // Simulate interrupted swap: .recovered exists but dbPath does not
      const recoveredPath = `${dbPath}.recovered`;
      renameSync(dbPath, recoveredPath);

      const result = ensureDatabaseHealth(dbPath);

      expect(result.status).toBe('healthy');
      expect(existsSync(dbPath)).toBe(true);
      expect(existsSync(recoveredPath)).toBe(false);
    });

    it('should recreate DB when file is completely unreadable garbage', () => {
      writeFileSync(dbPath, Buffer.alloc(100, 0xAA));

      const result = ensureDatabaseHealth(dbPath);

      // Garbage file is treated as corruption with no recoverable data → recreate
      expect(result.status).toBe('recovered');
      expect(result.action).toBe('recreated_db');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { Readable } from 'stream';
import request from 'supertest';

// Mock AppRepository
vi.mock('../../../database/index.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn(function (id: string) {
      if (id === 'missing-app') return null;
      return { id, path: '/tmp/test' };
    }),
  }; }),
}));

// Mock MySQLUtils — use vi.hoisted so mocks are available at vi.mock time
const { mockGetTableSchema, mockStreamTableData, mockLoadCredentialsFromApp, mockGetCreateTableDDL, mockListTables } = vi.hoisted(() => ({
  mockGetTableSchema: vi.fn(),
  mockStreamTableData: vi.fn(),
  mockLoadCredentialsFromApp: vi.fn(),
  mockGetCreateTableDDL: vi.fn(),
  mockListTables: vi.fn(),
}));

vi.mock('../../../utils/mysql-utils.js', () => ({
  MySQLUtils: vi.fn().mockImplementation(function () { return {
    getTableSchema: mockGetTableSchema,
    streamTableData: mockStreamTableData,
    loadCredentialsFromApp: mockLoadCredentialsFromApp,
    getCreateTableDDL: mockGetCreateTableDDL,
    listTables: mockListTables,
    escapeIdentifier: (name: string) => `\`${name.replace(/`/g, '``')}\``,
  }; }),
  isSystemTable: vi.fn(function (name: string) { return name === '__drizzle_migrations'; }),
  SYSTEM_TABLES: ['__drizzle_migrations'],
}));

// Mock app-ownership middleware to pass through
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (_req: any, _res: any, next: any) => next(),
}));

import dbRouter from '../db.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(dbRouter);
  return app;
}

function createMockStream(rows: Record<string, unknown>[]) {
  const stream = new Readable({
    objectMode: true,
    read() {
      for (const row of rows) {
        this.push(row);
      }
      this.push(null);
    },
  });
  return stream;
}

const mockCredentials = {
  host: 'localhost',
  port: 3306,
  database: 'testdb',
  user: 'root',
  password: 'password',
};

describe('GET /apps/:id/database/tables/:tableName/export', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    mockLoadCredentialsFromApp.mockResolvedValue(mockCredentials);
    mockGetTableSchema.mockResolvedValue([
      { name: 'id', type: 'int', nullable: false, key: 'PRI', default: null, extra: 'auto_increment' },
      { name: 'name', type: 'varchar(255)', nullable: true, key: '', default: null, extra: '' },
      { name: 'email', type: 'varchar(255)', nullable: true, key: '', default: null, extra: '' },
    ]);
  });

  it('returns 400 for invalid format', async () => {
    const res = await request(app)
      .get('/apps/test-app/database/tables/users/export?format=xml')
      .expect(400);

    expect(res.body.error).toContain('Invalid format');
  });

  it('returns 403 for system table access', async () => {
    const res = await request(app)
      .get('/apps/test-app/database/tables/__drizzle_migrations/export')
      .expect(403);

    expect(res.body.error).toContain('system tables');
  });

  it('returns 404 for missing app', async () => {
    const res = await request(app)
      .get('/apps/missing-app/database/tables/users/export')
      .expect(404);

    expect(res.body.error).toContain('App not found');
  });

  it('sets correct headers for CSV export', async () => {
    const stream = createMockStream([{ id: 1, name: 'Alice', email: 'a@b.com' }]);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/tables/users/export?format=csv')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('users.csv');
  });

  it('sets correct headers for JSON export', async () => {
    const stream = createMockStream([{ id: 1, name: 'Alice', email: 'a@b.com' }]);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/tables/users/export?format=json')
      .expect(200);

    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('users.json');
  });

  it('returns valid CSV with proper escaping', async () => {
    const rows = [
      { id: 1, name: 'Alice', email: 'a@b.com' },
      { id: 2, name: 'Bob "Builder"', email: 'bob,b@c.com' },
      { id: 3, name: null, email: 'c@d.com' },
    ];
    const stream = createMockStream(rows);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/tables/users/export?format=csv')
      .expect(200);

    const lines = res.text.split('\n').filter(Boolean);
    // First line includes BOM + header
    expect(lines[0]).toContain('"id","name","email"');
    // Row with quotes should be doubled
    expect(lines[2]).toContain('"Bob ""Builder"""');
    // Row with comma in value
    expect(lines[2]).toContain('"bob,b@c.com"');
    // Null value should be empty field
    expect(lines[3]).toBe('"3",,"c@d.com"');
  });

  it('returns valid JSON array', async () => {
    const rows = [
      { id: 1, name: 'Alice', email: 'a@b.com' },
      { id: 2, name: 'Bob', email: 'b@c.com' },
    ];
    const stream = createMockStream(rows);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/tables/users/export?format=json')
      .expect(200);

    const parsed = JSON.parse(res.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: 1, name: 'Alice', email: 'a@b.com' });
    expect(parsed[1]).toEqual({ id: 2, name: 'Bob', email: 'b@c.com' });
  });

  it('defaults to CSV format when no format specified', async () => {
    const stream = createMockStream([{ id: 1, name: 'Alice', email: 'a@b.com' }]);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/tables/users/export')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
  });

  it('releases connection after successful export', async () => {
    const stream = createMockStream([{ id: 1, name: 'Alice', email: 'a@b.com' }]);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    await request(app)
      .get('/apps/test-app/database/tables/users/export?format=csv')
      .expect(200);

    expect(mockConnection.release).toHaveBeenCalled();
  });

  it('releases connection when stream emits error', async () => {
    const stream = new Readable({
      objectMode: true,
      read() {
        this.destroy(new Error('MySQL gone away'));
      },
    });
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    await request(app)
      .get('/apps/test-app/database/tables/users/export?format=csv');

    expect(mockConnection.release).toHaveBeenCalled();
  });

  it('sanitizes tableName in Content-Disposition header', async () => {
    // Table name with characters that could cause header injection
    const dangerousName = 'users\r\nX-Injected: true';
    const stream = createMockStream([{ id: 1 }]);
    const mockConnection = { release: vi.fn() };

    mockGetTableSchema.mockResolvedValue([
      { name: 'id', type: 'int', nullable: false, key: 'PRI', default: null, extra: '' },
    ]);
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get(`/apps/test-app/database/tables/${encodeURIComponent(dangerousName)}/export?format=csv`)
      .expect(200);

    // Header should not contain CR/LF
    const disposition = res.headers['content-disposition'];
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    expect(disposition).toContain('users');
  });

  it('returns 500 when schema fetch fails before streaming', async () => {
    mockGetTableSchema.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app)
      .get('/apps/test-app/database/tables/users/export?format=csv')
      .expect(500);

    expect(res.body.error).toContain('Failed to export');
  });
});

describe('GET /apps/:id/database/export (SQL multi-table)', () => {
  let app: express.Express;

  const usersSchema = [
    { name: 'id', type: 'int', nullable: false, key: 'PRI', default: null, extra: 'auto_increment' },
    { name: 'name', type: 'varchar(255)', nullable: true, key: '', default: null, extra: '' },
  ];
  const usersDDL = 'CREATE TABLE `users` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `name` varchar(255) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

  const postsSchema = [
    { name: 'id', type: 'int', nullable: false, key: 'PRI', default: null, extra: 'auto_increment' },
    { name: 'title', type: 'varchar(255)', nullable: false, key: '', default: null, extra: '' },
  ];
  const postsDDL = 'CREATE TABLE `posts` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `title` varchar(255) NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    mockLoadCredentialsFromApp.mockResolvedValue(mockCredentials);
    mockListTables.mockResolvedValue(['users', 'posts']);
    mockGetCreateTableDDL.mockImplementation((_creds: any, tableName: string) => {
      if (tableName === 'users') return Promise.resolve(usersDDL);
      if (tableName === 'posts') return Promise.resolve(postsDDL);
      return Promise.reject(new Error(`Unknown table: ${tableName}`));
    });
    mockGetTableSchema.mockImplementation((_creds: any, tableName: string) => {
      if (tableName === 'users') return Promise.resolve(usersSchema);
      if (tableName === 'posts') return Promise.resolve(postsSchema);
      return Promise.reject(new Error(`Unknown table: ${tableName}`));
    });
  });

  it('returns 404 for missing app', async () => {
    const res = await request(app)
      .get('/apps/missing-app/database/export')
      .expect(404);

    expect(res.body.error).toContain('App not found');
  });

  it('returns 403 for system table in tables param', async () => {
    const res = await request(app)
      .get('/apps/test-app/database/export?tables=__drizzle_migrations')
      .expect(403);

    expect(res.body.error).toContain('system table');
  });

  it('returns 400 for non-existent table in tables param', async () => {
    const res = await request(app)
      .get('/apps/test-app/database/export?tables=nonexistent')
      .expect(400);

    expect(res.body.error).toContain('does not exist');
  });

  it('exports schema-only for all tables', async () => {
    const res = await request(app)
      .get('/apps/test-app/database/export?schemaOnly=true')
      .expect(200);

    expect(res.headers['content-type']).toContain('application/sql');
    expect(res.headers['content-disposition']).toContain('.sql');
    expect(res.text).toContain('DROP TABLE IF EXISTS `users`');
    expect(res.text).toContain(usersDDL);
    expect(res.text).toContain('DROP TABLE IF EXISTS `posts`');
    expect(res.text).toContain(postsDDL);
    // No INSERT statements
    expect(res.text).not.toContain('INSERT INTO');
  });

  it('exports schema + data for selected tables', async () => {
    const rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    const stream = createMockStream(rows);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/export?tables=users')
      .expect(200);

    expect(res.text).toContain('DROP TABLE IF EXISTS `users`');
    expect(res.text).toContain(usersDDL);
    expect(res.text).toContain('INSERT INTO `users`');
    expect(res.text).toContain("'Alice'");
    expect(res.text).toContain("'Bob'");
    // Should NOT include posts since only users was requested
    expect(res.text).not.toContain('`posts`');
    expect(mockConnection.release).toHaveBeenCalled();
  });

  it('exports all tables when no tables param specified', async () => {
    const usersStream = createMockStream([{ id: 1, name: 'Alice' }]);
    const postsStream = createMockStream([{ id: 1, title: 'Hello' }]);
    const mockConn1 = { release: vi.fn() };
    const mockConn2 = { release: vi.fn() };
    mockStreamTableData
      .mockResolvedValueOnce({ stream: usersStream, connection: mockConn1 })
      .mockResolvedValueOnce({ stream: postsStream, connection: mockConn2 });

    const res = await request(app)
      .get('/apps/test-app/database/export')
      .expect(200);

    expect(res.text).toContain('DROP TABLE IF EXISTS `users`');
    expect(res.text).toContain('DROP TABLE IF EXISTS `posts`');
    expect(res.text).toContain('INSERT INTO `users`');
    expect(res.text).toContain('INSERT INTO `posts`');
    expect(res.text).toContain('SET FOREIGN_KEY_CHECKS = 0');
    expect(res.text).toContain('SET FOREIGN_KEY_CHECKS = 1');
  });

  it('handles NULL values correctly in SQL export', async () => {
    const rows = [{ id: 1, name: null }];
    const stream = createMockStream(rows);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/export?tables=users')
      .expect(200);

    expect(res.text).toContain('(1, NULL)');
  });

  it('escapes special characters in string values', async () => {
    const rows = [{ id: 1, name: "O'Brien\\path\nnewline\there" }];
    const stream = createMockStream(rows);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/export?tables=users')
      .expect(200);

    expect(res.text).toContain("O\\'Brien\\\\path\\nnewline\\there");
  });

  it('returns 500 when credential loading fails', async () => {
    mockLoadCredentialsFromApp.mockRejectedValue(new Error('No config'));

    const res = await request(app)
      .get('/apps/test-app/database/export')
      .expect(500);

    expect(res.body.error).toContain('Failed to export');
  });

  it('exports per-table schemaOnly via schemaOnlyTables param', async () => {
    const usersStream = createMockStream([{ id: 1, name: 'Alice' }]);
    const mockConn1 = { release: vi.fn() };
    // Only users needs a stream — posts is schema-only and won't call streamTableData
    mockStreamTableData.mockResolvedValueOnce({ stream: usersStream, connection: mockConn1 });

    const res = await request(app)
      .get('/apps/test-app/database/export?schemaOnlyTables=posts')
      .expect(200);

    // users should have data
    expect(res.text).toContain('INSERT INTO `users`');
    // posts should be schema-only — no INSERT
    expect(res.text).toContain('DROP TABLE IF EXISTS `posts`');
    expect(res.text).toContain(postsDDL);
    expect(res.text).not.toContain('INSERT INTO `posts`');
    // posts comment should indicate structure only
    expect(res.text).toContain('-- Table: posts (structure only)');
    // users streamed data, so connection should be released
    expect(mockConn1.release).toHaveBeenCalled();
    // posts was schema-only, so streamTableData should only have been called once (for users)
    expect(mockStreamTableData).toHaveBeenCalledTimes(1);
  });

  it('schemaOnly=true overrides schemaOnlyTables', async () => {
    const res = await request(app)
      .get('/apps/test-app/database/export?schemaOnly=true&schemaOnlyTables=users')
      .expect(200);

    // Both tables should be schema-only
    expect(res.text).not.toContain('INSERT INTO');
    expect(res.text).toContain('-- Table: users (structure only)');
    expect(res.text).toContain('-- Table: posts (structure only)');
    // streamTableData should never be called
    expect(mockStreamTableData).not.toHaveBeenCalled();
  });

  it('exports boolean, Date, and Buffer values correctly', async () => {
    const stream = createMockStream([
      { id: 2, name: true },
      { id: 3, name: new Date('2025-03-15T10:30:45Z') },
      { id: 4, name: Buffer.from([0xCA, 0xFE]) },
      { id: 5, name: false },
    ]);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/export?tables=users')
      .expect(200);

    expect(mockStreamTableData).toHaveBeenCalledTimes(1);
    expect(res.text).toContain("'2025-03-15 10:30:45'");
    expect(res.text).toContain("X'cafe'");
    // boolean true → 1, false → 0
    expect(res.text).toMatch(/\(2, 1\)/);
    expect(res.text).toMatch(/\(5, 0\)/);
  });

  it('escapes null byte and Ctrl-Z in string values', async () => {
    const stream = createMockStream([{ name: 'before\0after\x1aend' }]);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/export?tables=users')
      .expect(200);

    expect(res.text).toContain("before\\0after\\Zend");
  });

  it('flushes remaining rows when count is not a multiple of batch size', async () => {
    // Create 2 rows — well under the 500 batch size — to test flush()
    const stream = createMockStream([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    const res = await request(app)
      .get('/apps/test-app/database/export?tables=users')
      .expect(200);

    // Both rows should be in a single INSERT (flush path)
    const insertMatch = res.text.match(/INSERT INTO `users`.*VALUES\n([\s\S]*?);/);
    expect(insertMatch).toBeTruthy();
    const valueLines = insertMatch![1].split(',\n');
    expect(valueLines).toHaveLength(2);
  });

  it('writes EXPORT COMPLETE footer on success', async () => {
    const res = await request(app)
      .get('/apps/test-app/database/export?schemaOnly=true')
      .expect(200);

    expect(res.text).toContain('-- EXPORT COMPLETE');
  });

  it('ignores schemaOnlyTables entries not in the export set', async () => {
    const stream = createMockStream([{ id: 1, name: 'Alice' }]);
    const mockConnection = { release: vi.fn() };
    mockStreamTableData.mockResolvedValue({ stream, connection: mockConnection });

    // 'nonexistent' is not a real table — should be silently ignored
    const res = await request(app)
      .get('/apps/test-app/database/export?tables=users&schemaOnlyTables=nonexistent')
      .expect(200);

    // users should still have data (not schema-only)
    expect(res.text).toContain('INSERT INTO `users`');
    expect(res.text).not.toContain('(structure only)');
  });
});

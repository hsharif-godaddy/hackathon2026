import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { Readable } from 'stream';
import request from 'supertest';

// Mock AppRepository
vi.mock('../../../database/index.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn((id: string) => {
      if (id === 'missing-app') {return null;}
      return { id, path: '/tmp/test' };
    }),
  })),
}));

// Mock MySQLUtils — use vi.hoisted so mocks are available at vi.mock time
const { mockGetTableSchema, mockStreamTableData, mockLoadCredentialsFromApp } = vi.hoisted(() => ({
  mockGetTableSchema: vi.fn(),
  mockStreamTableData: vi.fn(),
  mockLoadCredentialsFromApp: vi.fn(),
}));

vi.mock('../../../utils/mysql-utils.js', () => ({
  MySQLUtils: vi.fn().mockImplementation(() => ({
    getTableSchema: mockGetTableSchema,
    streamTableData: mockStreamTableData,
    loadCredentialsFromApp: mockLoadCredentialsFromApp,
  })),
  isSystemTable: vi.fn((name: string) => name === '__drizzle_migrations'),
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

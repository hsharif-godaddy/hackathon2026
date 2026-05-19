import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockExistsSync, mockMkdirSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockMkdirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
  };
});

const mockPragma = vi.fn();
const mockClose = vi.fn();
const mockDatabaseCtor = vi.fn();

vi.mock('better-sqlite3', () => {
  function FakeDatabase(...args: any[]) {
    return mockDatabaseCtor(...args);
  }
  return { default: FakeDatabase };
});

vi.mock('../schema.js', () => ({
  initializeSchema: vi.fn(),
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

function makeMockDb() {
  return { pragma: mockPragma, close: mockClose };
}

describe('database connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadModule() {
    return import('../connection.js');
  }

  describe('getDatabase', () => {
    it('opens database on first call and returns same instance on subsequent calls', async () => {
      const fakeDb = makeMockDb();
      mockDatabaseCtor.mockReturnValue(fakeDb);

      const { getDatabase } = await loadModule();

      const db1 = getDatabase();
      const db2 = getDatabase();

      expect(db1).toBe(db2);
      expect(mockDatabaseCtor).toHaveBeenCalledTimes(1);
    });

    it('removes stale SHM file before opening', async () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('-shm'));
      mockDatabaseCtor.mockReturnValue(makeMockDb());

      const { getDatabase } = await loadModule();
      getDatabase();

      expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining('-shm'));
    });

    it('throws when SHM unlink fails with EACCES', async () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('-shm'));
      mockUnlinkSync.mockImplementation(() => {
        const err = new Error('permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      });

      const { getDatabase } = await loadModule();

      expect(() => getDatabase()).toThrow('permission denied');
      expect(mockDatabaseCtor).not.toHaveBeenCalled();
    });
  });

  describe('closeDatabase', () => {
    it('runs wal_checkpoint(TRUNCATE) before closing', async () => {
      mockDatabaseCtor.mockReturnValue(makeMockDb());

      const { getDatabase, closeDatabase } = await loadModule();
      getDatabase();
      closeDatabase();

      expect(mockPragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
      expect(mockClose).toHaveBeenCalled();
    });

    it('still closes database when checkpoint fails', async () => {
      mockPragma.mockImplementation(() => { throw new Error('db locked'); });
      mockDatabaseCtor.mockReturnValue(makeMockDb());

      const { getDatabase, closeDatabase } = await loadModule();
      getDatabase();
      closeDatabase();

      expect(mockClose).toHaveBeenCalled();
    });

    it('is a no-op when database was never opened', async () => {
      const { closeDatabase } = await loadModule();
      closeDatabase();

      expect(mockClose).not.toHaveBeenCalled();
    });
  });
});

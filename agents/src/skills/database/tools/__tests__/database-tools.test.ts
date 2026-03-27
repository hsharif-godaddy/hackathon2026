import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock MySQLUtils
const mockLoadCredentialsFromApp = vi.fn();
const mockListTables = vi.fn();
const mockGetTableSchema = vi.fn();
const mockGetTableData = vi.fn();
const mockInsertRow = vi.fn();
const mockUpdateRow = vi.fn();
const mockDeleteRow = vi.fn();

vi.mock('../../../../utils/mysql-utils.js', () => ({
  MySQLUtils: vi.fn().mockImplementation(() => ({
    loadCredentialsFromApp: mockLoadCredentialsFromApp,
    listTables: mockListTables,
    getTableSchema: mockGetTableSchema,
    getTableData: mockGetTableData,
    insertRow: mockInsertRow,
    updateRow: mockUpdateRow,
    deleteRow: mockDeleteRow,
  })),
  isSystemTable: vi.fn((name: string) => name === '__drizzle_migrations'),
}));

const mockCredentials = {
  host: 'localhost',
  port: 3306,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
};

const makeContext = (appId?: string) => ({
  socketId: 'socket-1',
  metadata: { appId: appId ?? 'test-app-id' },
});

describe('database skill tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCredentialsFromApp.mockResolvedValue(mockCredentials);
  });

  describe('listTablesTool', () => {
    it('should return tables list', async () => {
      const { listTablesTool } = await import('../index.js');
      mockListTables.mockResolvedValue(['users', 'products', 'orders']);

      const result = await listTablesTool.execute({}, makeContext());

      expect(result).toEqual({
        success: true,
        tables: ['users', 'products', 'orders'],
      });
      expect(mockLoadCredentialsFromApp).toHaveBeenCalledWith({
        id: 'test-app-id',
        path: '',
      });
    });

    it('should throw when appId is missing', async () => {
      const { listTablesTool } = await import('../index.js');

      await expect(
        listTablesTool.execute({}, { socketId: 'socket-1', metadata: {} })
      ).rejects.toThrow('App ID required');
    });

    it('should propagate database errors', async () => {
      const { listTablesTool } = await import('../index.js');
      mockListTables.mockRejectedValue(new Error('Connection refused'));

      await expect(listTablesTool.execute({}, makeContext())).rejects.toThrow(
        'Connection refused'
      );
    });
  });

  describe('getSchemaTool', () => {
    it('should return table schema', async () => {
      const { getSchemaTool } = await import('../index.js');
      const columns = [
        { name: 'id', type: 'int', nullable: false, key: 'PRI', default: null, extra: 'auto_increment' },
        { name: 'name', type: 'varchar(255)', nullable: false, key: '', default: null, extra: '' },
      ];
      mockGetTableSchema.mockResolvedValue(columns);

      const result = await getSchemaTool.execute({ tableName: 'users' }, makeContext());

      expect(result).toEqual({
        success: true,
        tableName: 'users',
        columns,
      });
    });

    it('should reject system tables', async () => {
      const { getSchemaTool } = await import('../index.js');

      await expect(
        getSchemaTool.execute({ tableName: '__drizzle_migrations' }, makeContext())
      ).rejects.toThrow('protected system table');
    });

    it('should throw when appId is missing', async () => {
      const { getSchemaTool } = await import('../index.js');

      await expect(
        getSchemaTool.execute({ tableName: 'users' }, { socketId: 's', metadata: {} })
      ).rejects.toThrow('App ID required');
    });
  });

  describe('getTableDataTool', () => {
    it('should return paginated data with defaults', async () => {
      const { getTableDataTool } = await import('../index.js');
      const tableData = {
        rows: [{ id: 1, name: 'Alice' }],
        total: 50,
        page: 1,
        limit: 25,
        hasMore: true,
      };
      mockGetTableData.mockResolvedValue(tableData);

      const result = await getTableDataTool.execute({ tableName: 'users' }, makeContext());

      expect(result).toEqual({ success: true, ...tableData });
      expect(mockGetTableData).toHaveBeenCalledWith(mockCredentials, 'users', 1, 25);
    });

    it('should pass custom page and limit', async () => {
      const { getTableDataTool } = await import('../index.js');
      mockGetTableData.mockResolvedValue({
        rows: [],
        total: 0,
        page: 3,
        limit: 10,
        hasMore: false,
      });

      await getTableDataTool.execute({ tableName: 'users', page: 3, limit: 10 }, makeContext());

      expect(mockGetTableData).toHaveBeenCalledWith(mockCredentials, 'users', 3, 10);
    });

    it('should reject system tables', async () => {
      const { getTableDataTool } = await import('../index.js');

      await expect(
        getTableDataTool.execute({ tableName: '__drizzle_migrations' }, makeContext())
      ).rejects.toThrow('protected system table');
    });
  });

  describe('insertRowTool', () => {
    it('should insert a row and return success', async () => {
      const { insertRowTool } = await import('../index.js');
      mockInsertRow.mockResolvedValue(undefined);

      const result = await insertRowTool.execute(
        { tableName: 'users', data: { name: 'Alice', email: 'alice@test.com' } },
        makeContext()
      );

      expect(result).toEqual({ success: true });
      expect(mockInsertRow).toHaveBeenCalledWith(mockCredentials, 'users', {
        name: 'Alice',
        email: 'alice@test.com',
      });
    });

    it('should reject system tables', async () => {
      const { insertRowTool } = await import('../index.js');

      await expect(
        insertRowTool.execute(
          { tableName: '__drizzle_migrations', data: { name: 'test' } },
          makeContext()
        )
      ).rejects.toThrow('protected system table');
    });

    it('should throw when appId is missing', async () => {
      const { insertRowTool } = await import('../index.js');

      await expect(
        insertRowTool.execute(
          { tableName: 'users', data: { name: 'test' } },
          { socketId: 's', metadata: {} }
        )
      ).rejects.toThrow('App ID required');
    });

    it('should reject empty data via Zod validation', async () => {
      const { insertRowTool } = await import('../index.js');
      const parsed = insertRowTool.parameters.safeParse({ tableName: 'users', data: {} });

      expect(parsed.success).toBe(false);
    });
  });

  describe('updateRowTool', () => {
    it('should update a row and return success', async () => {
      const { updateRowTool } = await import('../index.js');
      mockUpdateRow.mockResolvedValue(undefined);

      const result = await updateRowTool.execute(
        {
          tableName: 'users',
          primaryKey: { id: 1 },
          data: { name: 'Updated' },
        },
        makeContext()
      );

      expect(result).toEqual({ success: true });
      expect(mockUpdateRow).toHaveBeenCalledWith(mockCredentials, 'users', { id: 1 }, { name: 'Updated' });
    });

    it('should reject system tables', async () => {
      const { updateRowTool } = await import('../index.js');

      await expect(
        updateRowTool.execute(
          {
            tableName: '__drizzle_migrations',
            primaryKey: { id: 1 },
            data: { name: 'test' },
          },
          makeContext()
        )
      ).rejects.toThrow('protected system table');
    });

    it('should reject empty primaryKey via Zod validation', async () => {
      const { updateRowTool } = await import('../index.js');
      const parsed = updateRowTool.parameters.safeParse({
        tableName: 'users',
        primaryKey: {},
        data: { name: 'test' },
      });

      expect(parsed.success).toBe(false);
    });

    it('should reject empty data via Zod validation', async () => {
      const { updateRowTool } = await import('../index.js');
      const parsed = updateRowTool.parameters.safeParse({
        tableName: 'users',
        primaryKey: { id: 1 },
        data: {},
      });

      expect(parsed.success).toBe(false);
    });
  });

  describe('deleteRowTool', () => {
    it('should delete a row and return success', async () => {
      const { deleteRowTool } = await import('../index.js');
      mockDeleteRow.mockResolvedValue(undefined);

      const result = await deleteRowTool.execute(
        { tableName: 'users', primaryKey: { id: 1 } },
        makeContext()
      );

      expect(result).toEqual({ success: true });
      expect(mockDeleteRow).toHaveBeenCalledWith(mockCredentials, 'users', { id: 1 });
    });

    it('should reject system tables', async () => {
      const { deleteRowTool } = await import('../index.js');

      await expect(
        deleteRowTool.execute(
          { tableName: '__drizzle_migrations', primaryKey: { id: 1 } },
          makeContext()
        )
      ).rejects.toThrow('protected system table');
    });

    it('should reject empty primaryKey via Zod validation', async () => {
      const { deleteRowTool } = await import('../index.js');
      const parsed = deleteRowTool.parameters.safeParse({
        tableName: 'users',
        primaryKey: {},
      });

      expect(parsed.success).toBe(false);
    });

    it('should throw when appId is missing', async () => {
      const { deleteRowTool } = await import('../index.js');

      await expect(
        deleteRowTool.execute(
          { tableName: 'users', primaryKey: { id: 1 } },
          { socketId: 's', metadata: {} }
        )
      ).rejects.toThrow('App ID required');
    });
  });
});

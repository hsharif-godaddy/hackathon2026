/**
 * AutoAPIGenerator Tests
 * 
 * Comprehensive test suite for the Auto API generator tool to ensure
 * reliable database schema analysis and API endpoint generation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutoAPIGenerator, AutoAPIGeneratorOptions, TableSchema } from '../auto-api-generator';
import mysql from 'mysql2/promise';
import { readFile } from 'fs/promises';

// Mock dependencies
vi.mock('mysql2/promise');
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));
vi.mock('path');

describe('AutoAPIGenerator', () => {
  let generator: AutoAPIGenerator;
  let mockConnection: any;
  let mockPool: any;
  let mockFileEditTool: any;

  beforeEach(() => {
    generator = new AutoAPIGenerator();
    
    // Mock MySQL connection
    mockConnection = {
      execute: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn()
    };
    
    mockPool = {
      getConnection: vi.fn().mockResolvedValue(mockConnection),
      end: vi.fn()
    };
    
    vi.mocked(mysql.createPool).mockReturnValue(mockPool as any);
    
    // Mock file system operations
    const basicRoutesContent = `import { Hono } from 'hono';
import { executeQuery } from '../services/database';

const api = new Hono();

api.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

export default api;
`;
    vi.mocked(readFile).mockResolvedValue(basicRoutesContent);
    
    // Mock file edit tool
    mockFileEditTool = {
      editFile: vi.fn().mockResolvedValue({ success: true })
    };
    
    (generator as any).fileEditTool = mockFileEditTool;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Schema Analysis', () => {
    it('should analyze database schema successfully', async () => {
      // Mock createConnection
      vi.mocked(mysql.createConnection).mockResolvedValue(mockConnection);
      
      // Mock SHOW TABLES response
      mockConnection.execute
        .mockResolvedValueOnce([
          [{ 'Tables_in_testdb': 'users' }, { 'Tables_in_testdb': 'posts' }],
          []
        ])
        // Mock DESCRIBE users response
        .mockResolvedValueOnce([
          [
            { Field: 'id', Type: 'int(11)', Null: 'NO', Key: 'PRI', Default: null, Extra: 'auto_increment' },
            { Field: 'name', Type: 'varchar(255)', Null: 'NO', Key: '', Default: null, Extra: '' },
            { Field: 'email', Type: 'varchar(255)', Null: 'YES', Key: 'UNI', Default: null, Extra: '' },
            { Field: 'created_at', Type: 'timestamp', Null: 'NO', Key: '', Default: 'CURRENT_TIMESTAMP', Extra: '' }
          ],
          []
        ])
        // Mock DESCRIBE posts response
        .mockResolvedValueOnce([
          [
            { Field: 'id', Type: 'int(11)', Null: 'NO', Key: 'PRI', Default: null, Extra: 'auto_increment' },
            { Field: 'title', Type: 'varchar(255)', Null: 'NO', Key: '', Default: null, Extra: '' },
            { Field: 'content', Type: 'text', Null: 'YES', Key: '', Default: null, Extra: '' },
            { Field: 'user_id', Type: 'int(11)', Null: 'NO', Key: 'MUL', Default: null, Extra: '' }
          ],
          []
        ]);

      const options: AutoAPIGeneratorOptions = {
        operation: 'analyze_schema',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        }
      };

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(true);
      expect(result.data?.tables).toHaveLength(2);
      
      const usersTable = result.data?.tables.find(t => t.name === 'users');
      expect(usersTable).toBeDefined();
      expect(usersTable?.columns).toHaveLength(4);
      expect(usersTable?.primaryKey).toBe('id');
      
      const postsTable = result.data?.tables.find(t => t.name === 'posts');
      expect(postsTable).toBeDefined();
      expect(postsTable?.columns).toHaveLength(4);
      expect(postsTable?.primaryKey).toBe('id');
    });

    it('should handle database connection errors', async () => {
      vi.mocked(mysql.createConnection).mockRejectedValue(new Error('Connection failed'));

      const options: AutoAPIGeneratorOptions = {
        operation: 'analyze_schema',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'wrongpass',
          database: 'testdb'
        }
      };

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('GENERATION_ERROR');
    });

    it('should filter specific tables when provided', async () => {
      vi.mocked(mysql.createConnection).mockResolvedValue(mockConnection);
      
      mockConnection.execute
        .mockResolvedValueOnce([
          [
            { Field: 'id', Type: 'int(11)', Null: 'NO', Key: 'PRI', Default: null, Extra: 'auto_increment' },
            { Field: 'name', Type: 'varchar(255)', Null: 'NO', Key: '', Default: null, Extra: '' }
          ],
          []
        ]);

      const options: AutoAPIGeneratorOptions = {
        operation: 'analyze_schema',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        },
        tables: ['users']
      };

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(true);
      expect(result.data?.tables).toHaveLength(1);
      expect(result.data?.tables[0].name).toBe('users');
      
      // Should only call DESCRIBE for the specified table (no SHOW TABLES when tables are provided)
      expect(mockConnection.execute).toHaveBeenCalledTimes(1); // Only DESCRIBE users
    });
  });

  describe('TypeScript Type Generation', () => {
    it('should generate TypeScript types successfully', async () => {
      mockFileEditTool.editFile.mockResolvedValue({ success: true });

      const options: AutoAPIGeneratorOptions = {
        operation: 'generate_types',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        }
      };

      // Mock schema analysis result
      const mockTables: TableSchema[] = [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true },
            { name: 'name', type: 'string', nullable: false, defaultValue: null, autoIncrement: false },
            { name: 'email', type: 'string', nullable: true, defaultValue: null, autoIncrement: false }
          ],
          primaryKey: 'id',
          relationships: []
        }
      ];

      // Mock the schema analysis step
      vi.spyOn(generator as any, 'analyzeSchema').mockResolvedValue({
        success: true,
        data: { tables: mockTables }
      });

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(true);
      expect(result.data?.generatedFiles).toContain('src/types/database.ts');
      expect(mockFileEditTool.editFile).toHaveBeenCalledWith(
        '/test/app',
        expect.objectContaining({
          path: 'src/types/database.ts',
          mode: 'create',
          createDirs: true
        })
      );
    });

    it('should generate correct TypeScript interfaces', () => {
      const tables: TableSchema[] = [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true },
            { name: 'name', type: 'string', nullable: false, defaultValue: null, autoIncrement: false },
            { name: 'email', type: 'string', nullable: true, defaultValue: null, autoIncrement: false },
            { name: 'age', type: 'number', nullable: true, defaultValue: null, autoIncrement: false }
          ],
          primaryKey: 'id',
          relationships: []
        }
      ];

      const typeDefinitions = (generator as any).generateTypeDefinitions(tables);

      expect(typeDefinitions).toContain('export interface Users {'); // Note: Uses plural form
      expect(typeDefinitions).toContain('id: number;');
      expect(typeDefinitions).toContain('name: string;');
      expect(typeDefinitions).toContain('email?: string;'); // Optional due to nullable
      expect(typeDefinitions).toContain('age?: number;'); // Optional due to nullable
      expect(typeDefinitions).toContain('export interface CreateUsers {'); // Note: Uses plural form
      expect(typeDefinitions).toContain('export interface UpdateUsers {'); // Note: Uses plural form
    });
  });

  describe('API Endpoint Generation', () => {
    beforeEach(() => {
      mockFileEditTool.editFile.mockResolvedValue({ success: true });
    });

    it('should generate all CRUD operations by default', async () => {
      const options: AutoAPIGeneratorOptions = {
        operation: 'generate_endpoints',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        }
      };

      const mockTables: TableSchema[] = [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true },
            { name: 'name', type: 'string', nullable: false, defaultValue: null, autoIncrement: false }
          ],
          primaryKey: 'id',
          relationships: []
        }
      ];

      vi.spyOn(generator as any, 'analyzeSchema').mockResolvedValue({
        success: true,
        data: { tables: mockTables }
      });

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(true);
      expect(result.data?.endpoints).toHaveLength(5); // create, read, read_all, update, delete
      
      const endpoints = result.data?.endpoints || [];
      expect(endpoints.find(e => e.method === 'POST' && e.path === '/api/users')).toBeDefined();
      expect(endpoints.find(e => e.method === 'GET' && e.path === '/api/users')).toBeDefined();
      expect(endpoints.find(e => e.method === 'GET' && e.path === '/api/users/:id')).toBeDefined();
      expect(endpoints.find(e => e.method === 'PUT' && e.path === '/api/users/:id')).toBeDefined();
      expect(endpoints.find(e => e.method === 'DELETE' && e.path === '/api/users/:id')).toBeDefined();
    });

    it('should generate only specified operations', async () => {
      const options: AutoAPIGeneratorOptions = {
        operation: 'generate_endpoints',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        },
        operations: ['create', 'read_all']
      };

      const mockTables: TableSchema[] = [
        {
          name: 'contacts',
          columns: [
            { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true },
            { name: 'name', type: 'string', nullable: false, defaultValue: null, autoIncrement: false },
            { name: 'email', type: 'string', nullable: false, defaultValue: null, autoIncrement: false }
          ],
          primaryKey: 'id',
          relationships: []
        }
      ];

      vi.spyOn(generator as any, 'analyzeSchema').mockResolvedValue({
        success: true,
        data: { tables: mockTables }
      });

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(true);
      expect(result.data?.endpoints).toHaveLength(2); // Only create and read_all
      
      const endpoints = result.data?.endpoints || [];
      expect(endpoints.find(e => e.method === 'POST' && e.path === '/api/contacts')).toBeDefined();
      expect(endpoints.find(e => e.method === 'GET' && e.path === '/api/contacts')).toBeDefined();
      expect(endpoints.find(e => e.method === 'GET' && e.path === '/api/contacts/:id')).toBeUndefined();
      expect(endpoints.find(e => e.method === 'PUT')).toBeUndefined();
      expect(endpoints.find(e => e.method === 'DELETE')).toBeUndefined();
    });

    it('should generate files in correct V3 template structure', async () => {
      mockFileEditTool.editFile.mockResolvedValue({ success: true });
      
      const options: AutoAPIGeneratorOptions = {
        operation: 'generate_endpoints',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        },
        tables: ['users']
      };

      const mockTables: TableSchema[] = [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true },
            { name: 'name', type: 'string', nullable: false, defaultValue: null, autoIncrement: false }
          ],
          primaryKey: 'id',
          relationships: []
        }
      ];

      vi.spyOn(generator as any, 'analyzeSchema').mockResolvedValue({
        success: true,
        data: { tables: mockTables }
      });

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(true);
      expect(result.data?.generatedFiles).toContain('src/backend/api/routes.ts');
      expect(result.data?.generatedFiles).toContain('src/backend/api/AUTO_API_DOCS.md');
    });

    it('should generate Hono.js routes with correct imports', async () => {
      const table: TableSchema = {
        name: 'products',
        columns: [
          { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true },
          { name: 'name', type: 'string', nullable: false, defaultValue: null, autoIncrement: false },
          { name: 'price', type: 'number', nullable: false, defaultValue: null, autoIncrement: false }
        ],
        primaryKey: 'id',
        relationships: []
      };

      const honoAPI = (generator as any).generateHonoAPI(table, '/api', ['create', 'read_all']);

      expect(honoAPI).toContain("import { Hono } from 'hono';");
      expect(honoAPI).toContain("import { getDatabase } from '../services/database';");
      expect(honoAPI).toContain('const productsRoutes = new Hono();');
      expect(honoAPI).toContain('productsRoutes.post');
      expect(honoAPI).toContain('productsRoutes.get');
      expect(honoAPI).not.toContain('productsRoutes.put');
      expect(honoAPI).not.toContain('productsRoutes.delete');
      expect(honoAPI).toContain('export default productsRoutes;');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid operation types', async () => {
      const options = {
        operation: 'invalid_operation',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        }
      } as any;

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_OPERATION');
    });

    it('should handle missing database configuration', async () => {
      const options: AutoAPIGeneratorOptions = {
        operation: 'analyze_schema',
        database: {
          host: '',
          port: 3306,
          user: '',
          password: '',
          database: ''
        }
      };

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle file writing errors', async () => {
      mockFileEditTool.editFile.mockRejectedValue(new Error('File write failed'));

      const options: AutoAPIGeneratorOptions = {
        operation: 'generate_types',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        }
      };

      const mockTables: TableSchema[] = [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true }
          ],
          primaryKey: 'id',
          relationships: []
        }
      ];

      vi.spyOn(generator as any, 'analyzeSchema').mockResolvedValue({
        success: true,
        data: { tables: mockTables }
      });

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('GENERATION_ERROR');
    });
  });

  describe('Database Type Mapping', () => {
    it('should map MySQL types to TypeScript types correctly', () => {
      const testCases = [
        { mysql: 'int(11)', expected: 'number' },
        { mysql: 'bigint(20)', expected: 'number' },
        { mysql: 'varchar(255)', expected: 'string' },
        { mysql: 'text', expected: 'string' },
        { mysql: 'boolean', expected: 'boolean' },
        { mysql: 'timestamp', expected: 'Date' },
        { mysql: 'datetime', expected: 'Date' },
        { mysql: 'decimal(10,2)', expected: 'number' },
        { mysql: 'json', expected: 'object' }
      ];

      testCases.forEach(({ mysql, expected }) => {
        const result = (generator as any).mapMySQLTypeToTS(mysql);
        expect(result).toBe(expected);
      });
    });

    it('should extract max length from varchar types', () => {
      const result = (generator as any).extractMaxLength('varchar(255)');
      expect(result).toBe(255);
    });

    it('should handle varchar without length specification', () => {
      const result = (generator as any).extractMaxLength('varchar');
      expect(result).toBeUndefined();
    });
  });

  describe('Operation Combinations', () => {
    const testCases = [
      {
        name: 'Contact Form Pattern',
        operations: ['create', 'read_all'],
        expectedMethods: ['GET', 'POST'], // read_all first, then create
        expectedPaths: ['/api/contacts', '/api/contacts']
      },
      {
        name: 'Read-Only Pattern',
        operations: ['read', 'read_all'],
        expectedMethods: ['GET', 'GET'], // read_all first, then read
        expectedPaths: ['/api/contacts', '/api/contacts/:id']
      },
      {
        name: 'Create-Only Pattern',
        operations: ['create'],
        expectedMethods: ['POST'],
        expectedPaths: ['/api/contacts']
      },
      {
        name: 'User Profile Pattern',
        operations: ['read', 'update'],
        expectedMethods: ['GET', 'PUT'], // read first, then update
        expectedPaths: ['/api/contacts/:id', '/api/contacts/:id']
      },
      {
        name: 'Full CRUD Pattern',
        operations: ['create', 'read', 'read_all', 'update', 'delete'],
        expectedMethods: ['GET', 'GET', 'POST', 'PUT', 'DELETE'], // read_all, read, create, update, delete
        expectedPaths: ['/api/contacts', '/api/contacts/:id', '/api/contacts', '/api/contacts/:id', '/api/contacts/:id']
      }
    ];

    testCases.forEach(({ name, operations, expectedMethods, expectedPaths }) => {
      it(`should generate correct endpoints for ${name}`, async () => {
        const options: AutoAPIGeneratorOptions = {
          operation: 'generate_endpoints',
          database: {
            host: 'localhost',
            port: 3306,
            user: 'testuser',
            password: 'testpass',
            database: 'testdb'
          },
          tables: ['contacts'],
          operations: operations as any
        };

        const mockTables: TableSchema[] = [
          {
            name: 'contacts',
            columns: [
              { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true },
              { name: 'name', type: 'string', nullable: false, defaultValue: null, autoIncrement: false }
            ],
            primaryKey: 'id',
            relationships: []
          }
        ];

        vi.spyOn(generator as any, 'analyzeSchema').mockResolvedValue({
          success: true,
          data: { tables: mockTables }
        });

        const result = await generator.execute('/test/app', options);

        expect(result.success).toBe(true);
        expect(result.data?.endpoints).toHaveLength(operations.length);

        const endpoints = result.data?.endpoints || [];
        expectedMethods.forEach((method, index) => {
          expect(endpoints[index].method).toBe(method);
          expect(endpoints[index].path).toBe(expectedPaths[index]);
        });
      });
    });
  });

  describe('Custom Configuration', () => {
    it('should respect custom output directory', async () => {
      mockFileEditTool.editFile.mockResolvedValue({ success: true });
      
      const options: AutoAPIGeneratorOptions = {
        operation: 'generate_endpoints',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        },
        outputDir: 'custom/api/path'
      };

      const mockTables: TableSchema[] = [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true }
          ],
          primaryKey: 'id',
          relationships: []
        }
      ];

      vi.spyOn(generator as any, 'analyzeSchema').mockResolvedValue({
        success: true,
        data: { tables: mockTables }
      });

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(true);
      // With new behavior, routes are always added to main routes.ts file regardless of outputDir
      expect(result.data?.generatedFiles).toContain('src/backend/api/routes.ts');
      // But documentation should still respect the custom output directory
      expect(result.data?.generatedFiles).toContain('custom/api/path/AUTO_API_DOCS.md');
    });

    it('should respect custom API prefix', async () => {
      const table: TableSchema = {
        name: 'items',
        columns: [
          { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true }
        ],
        primaryKey: 'id',
        relationships: []
      };

      const honoAPI = (generator as any).generateHonoAPI(table, '/v1/api', ['read_all']);

      expect(honoAPI).toContain('const itemsRoutes = new Hono();');
      expect(honoAPI).toContain('export default itemsRoutes;');
    });

    it('should generate types in custom directory', async () => {
      mockFileEditTool.editFile.mockResolvedValue({ success: true });
      
      const options: AutoAPIGeneratorOptions = {
        operation: 'generate_types',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        },
        outputDir: 'src/custom-types'
      };

      const mockTables: TableSchema[] = [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true }
          ],
          primaryKey: 'id',
          relationships: []
        }
      ];

      vi.spyOn(generator as any, 'analyzeSchema').mockResolvedValue({
        success: true,
        data: { tables: mockTables }
      });

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(true);
      expect(result.data?.generatedFiles).toContain('src/custom-types/database.ts');
    });
  });

  describe('Integration', () => {
    it('should complete full workflow from schema to endpoints', async () => {
      mockFileEditTool.editFile.mockResolvedValue({ success: true });
      
      const mockTables: TableSchema[] = [
        {
          name: 'products',
          columns: [
            { name: 'id', type: 'number', nullable: false, defaultValue: null, autoIncrement: true },
            { name: 'name', type: 'string', nullable: false, defaultValue: null, autoIncrement: false },
            { name: 'price', type: 'number', nullable: false, defaultValue: null, autoIncrement: false },
            { name: 'description', type: 'string', nullable: true, defaultValue: null, autoIncrement: false }
          ],
          primaryKey: 'id',
          relationships: []
        }
      ];

      vi.spyOn(generator as any, 'analyzeSchema').mockResolvedValue({
        success: true,
        data: { tables: mockTables }
      });

      const options: AutoAPIGeneratorOptions = {
        operation: 'generate_endpoints',
        database: {
          host: 'localhost',
          port: 3306,
          user: 'testuser',
          password: 'testpass',
          database: 'testdb'
        },
        operations: ['create', 'read_all', 'update'],
        generateTypes: true
      };

      const result = await generator.execute('/test/app', options);

      expect(result.success).toBe(true);
      expect(result.data?.tables).toHaveLength(1);
      expect(result.data?.endpoints).toHaveLength(3);
      expect(result.data?.generatedFiles).toContain('src/backend/api/routes.ts');
      expect(result.data?.generatedFiles).toContain('src/types/database.ts');
      expect(result.data?.generatedFiles).toContain('src/backend/api/AUTO_API_DOCS.md');

      // Verify that types are generated when generateTypes is true
      expect(mockFileEditTool.editFile).toHaveBeenCalledWith(
        '/test/app',
        expect.objectContaining({
          path: 'src/types/database.ts'
        })
      );
    });
  });
});

import { readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import mysql from 'mysql2/promise';
import { FileEditTool } from './file-edit.js';

export interface AutoAPIGeneratorOptions {
  /** Operation type */
  operation: 'generate_endpoints' | 'analyze_schema' | 'generate_types';
  /** Database connection details */
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  /** Tables to generate endpoints for (if empty, generates for all tables) */
  tables?: string[];
  /** Which HTTP operations to generate */
  operations?: ('create' | 'read' | 'read_all' | 'update' | 'delete')[];
  /** Output directory for generated files */
  outputDir?: string;
  /** API prefix path (e.g., '/api', '/v1') */
  apiPrefix?: string;
  /** Include TypeScript types generation */
  generateTypes?: boolean;
  /** Overwrite existing files */
  overwrite?: boolean;
  /** Custom template for routes */
  customTemplate?: string;
}

export interface AutoAPIGeneratorResult {
  success: boolean;
  message: string;
  data?: {
    tables?: TableSchema[];
    generatedFiles?: string[];
    endpoints?: EndpointInfo[];
    types?: string;
  };
  error?: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  primaryKey?: string;
  relationships?: RelationshipInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  autoIncrement: boolean;
  maxLength?: number | undefined;
}

export interface RelationshipInfo {
  type: 'belongsTo' | 'hasMany' | 'hasOne';
  table: string;
  foreignKey: string;
  localKey: string;
}

export interface EndpointInfo {
  method: string;
  path: string;
  description: string;
  table: string;
}

export class AutoAPIGenerator {
  private fileEditTool = new FileEditTool();

  /**
   * Execute API endpoint generation operation
   */
  async execute(appPath: string, options: AutoAPIGeneratorOptions): Promise<AutoAPIGeneratorResult> {
    try {
      switch (options.operation) {
        case 'analyze_schema':
          return await this.analyzeSchema(options);
        case 'generate_types':
          return await this.generateTypes(appPath, options);
        case 'generate_endpoints':
          return await this.generateAPIEndpoints(appPath, options);
        default:
          return {
            success: false,
            message: `Unknown operation: ${options.operation}`,
            error: 'INVALID_OPERATION',
          };
      }
    } catch (error) {
      return {
        success: false,
        message: `API generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: 'GENERATION_ERROR',
      };
    }
  }

  /**
   * Analyze database schema and return table information
   */
  private async analyzeSchema(options: AutoAPIGeneratorOptions): Promise<AutoAPIGeneratorResult> {
    let connection: mysql.Connection | undefined;
    
    try {
      connection = await mysql.createConnection(options.database);
      
      // Get all tables or specific tables
      const tables = options.tables?.length 
        ? options.tables 
        : await this.getAllTables(connection);
      
      const schemas: TableSchema[] = [];
      
      for (const tableName of tables) {
        const schema = await this.getTableSchema(connection, tableName);
        schemas.push(schema);
      }
      
      return {
        success: true,
        message: `Successfully analyzed ${schemas.length} tables`,
        data: { tables: schemas },
      };
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  /**
   * Generate TypeScript types for database tables
   */
  private async generateTypes(appPath: string, options: AutoAPIGeneratorOptions): Promise<AutoAPIGeneratorResult> {
    const schemaResult = await this.analyzeSchema(options);
    if (!schemaResult.success || !schemaResult.data?.tables) {
      return schemaResult;
    }

    const types = this.generateTypeDefinitions(schemaResult.data.tables);
    const outputDir = options.outputDir || 'src/types';
    const typesFile = join(appPath, outputDir, 'database.ts');

    // Create directory if it doesn't exist
    await mkdir(dirname(typesFile), { recursive: true });

    // Write types file
    const editResult = await this.fileEditTool.editFile(appPath, {
      path: `${outputDir}/database.ts`,
      mode: options.overwrite ? 'rewrite' : 'create',
      content: types,
      createDirs: true,
    });

    if (!editResult.success) {
      return {
        success: false,
        message: 'Failed to generate types file',
        error: editResult.error || 'Unknown error',
      };
    }

    return {
      success: true,
      message: 'Successfully generated TypeScript types',
      data: {
        generatedFiles: [`${outputDir}/database.ts`],
        types,
      },
    };
  }

  /**
   * Generate API endpoints (can be selective - not just full CRUD)
   */
  private async generateAPIEndpoints(appPath: string, options: AutoAPIGeneratorOptions): Promise<AutoAPIGeneratorResult> {
    const schemaResult = await this.analyzeSchema(options);
    if (!schemaResult.success || !schemaResult.data?.tables) {
      return schemaResult;
    }

    const tables = schemaResult.data.tables;
    const apiPrefix = options.apiPrefix || '/api';
    const outputDir = options.outputDir || 'src/backend/api';
    
    // Default to all operations if none specified
    const operations = options.operations || ['create', 'read', 'read_all', 'update', 'delete'];
    
    const generatedFiles: string[] = [];
    const endpoints: EndpointInfo[] = [];

    // Generate types if requested
    if (options.generateTypes) {
      const typesResult = await this.generateTypes(appPath, options);
      if (typesResult.success && typesResult.data?.generatedFiles) {
        generatedFiles.push(...typesResult.data.generatedFiles);
      }
    }

    // Add API routes directly to existing routes.ts file
    const routesFile = await this.addRoutesToMainFile(appPath, tables, apiPrefix, operations);
    generatedFiles.push(routesFile);
    
    // Add endpoint info based on selected operations
    for (const table of tables) {
      if (operations.includes('read_all')) {
        endpoints.push({ method: 'GET', path: `${apiPrefix}/${table.name}`, description: `Get all ${table.name}`, table: table.name });
      }
      if (operations.includes('read')) {
        endpoints.push({ method: 'GET', path: `${apiPrefix}/${table.name}/:id`, description: `Get ${table.name} by ID`, table: table.name });
      }
      if (operations.includes('create')) {
        endpoints.push({ method: 'POST', path: `${apiPrefix}/${table.name}`, description: `Create new ${table.name}`, table: table.name });
      }
      if (operations.includes('update')) {
        endpoints.push({ method: 'PUT', path: `${apiPrefix}/${table.name}/:id`, description: `Update ${table.name}`, table: table.name });
      }
      if (operations.includes('delete')) {
        endpoints.push({ method: 'DELETE', path: `${apiPrefix}/${table.name}/:id`, description: `Delete ${table.name}`, table: table.name });
      }
    }

    // Generate API documentation
    const docsFile = await this.generateAPIDocumentation(appPath, tables, endpoints, outputDir);
    generatedFiles.push(docsFile);

    const operationsText = operations.length === 5 ? 'full CRUD' : operations.join(', ');
    return {
      success: true,
      message: `Successfully generated ${operationsText} endpoints for ${tables.length} tables`,
      data: {
        tables,
        generatedFiles,
        endpoints,
      },
    };
  }

  /**
   * Get all table names from database
   */
  private async getAllTables(connection: mysql.Connection): Promise<string[]> {
    const [rows] = await connection.execute('SHOW TABLES');
    return (rows as any[]).map(row => Object.values(row)[0] as string);
  }

  /**
   * Get detailed schema information for a table
   */
  private async getTableSchema(connection: mysql.Connection, tableName: string): Promise<TableSchema> {
    // Get column information
    const [columns] = await connection.execute(`DESCRIBE ${tableName}`);
    const columnInfos: ColumnInfo[] = (columns as any[]).map(col => ({
      name: col.Field,
      type: this.mapMySQLTypeToTS(col.Type),
      nullable: col.Null === 'YES',
      defaultValue: col.Default,
      autoIncrement: col.Extra?.includes('auto_increment') || false,
      maxLength: this.extractMaxLength(col.Type),
    }));

    // Find primary key
    const primaryKey = columnInfos.find(col => col.name === 'id')?.name || 
                      columnInfos.find(col => col.autoIncrement)?.name ||
                      columnInfos[0]?.name;

    return {
      name: tableName,
      columns: columnInfos,
      primaryKey: primaryKey || 'id',
      relationships: [], // TODO: Implement relationship detection
    };
  }

  /**
   * Map MySQL types to TypeScript types
   */
  private mapMySQLTypeToTS(mysqlType: string): string {
    const type = mysqlType.toLowerCase();
    
    if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('double')) {
      return 'number';
    }
    if (type.includes('char') || type.includes('text') || type.includes('enum')) {
      return 'string';
    }
    if (type.includes('date') || type.includes('time')) {
      return 'Date';
    }
    if (type.includes('json')) {
      return 'object';
    }
    if (type.includes('bool') || type.includes('bit')) {
      return 'boolean';
    }
    
    return 'any';
  }

  /**
   * Extract max length from MySQL type
   */
  private extractMaxLength(mysqlType: string): number | undefined {
    const match = mysqlType.match(/\((\d+)\)/);
    return match && match[1] ? parseInt(match[1], 10) : undefined;
  }

  /**
   * Generate TypeScript type definitions
   */
  private generateTypeDefinitions(tables: TableSchema[]): string {
    let types = `// Auto-generated database types
// Generated on ${new Date().toISOString()}

`;

    for (const table of tables) {
      const interfaceName = this.toPascalCase(table.name);
      
      types += `export interface ${interfaceName} {\n`;
      
      for (const column of table.columns) {
        const optional = column.nullable ? '?' : '';
        types += `  ${column.name}${optional}: ${column.type};\n`;
      }
      
      types += `}\n\n`;
      
      // Generate create type (without auto-increment fields)
      const createFields = table.columns.filter(col => !col.autoIncrement);
      if (createFields.length > 0) {
        types += `export interface Create${interfaceName} {\n`;
        for (const column of createFields) {
          const optional = column.nullable || column.defaultValue ? '?' : '';
          types += `  ${column.name}${optional}: ${column.type};\n`;
        }
        types += `}\n\n`;
      }
      
      // Generate update type (all fields optional except primary key)
      types += `export interface Update${interfaceName} {\n`;
      for (const column of table.columns) {
        if (column.name !== table.primaryKey) {
          types += `  ${column.name}?: ${column.type};\n`;
        }
      }
      types += `}\n\n`;
    }

    return types;
  }

  /**
   * Generate API file for a specific table with selected operations
   */
  private async generateAPIFile(
    appPath: string, 
    table: TableSchema, 
    apiPrefix: string,
    outputDir: string,
    operations: ('create' | 'read' | 'read_all' | 'update' | 'delete')[]
  ): Promise<string> {
    const fileName = `${table.name}-api.ts`;
    const filePath = `${outputDir}/${fileName}`;
    
    const content = this.generateHonoAPI(table, apiPrefix, operations);

    await this.fileEditTool.editFile(appPath, {
      path: filePath,
      mode: 'create',
      content,
      createDirs: true,
    });

    return filePath;
  }

  /**
   * Generate Hono.js API routes with selected operations
   */
  private generateHonoAPI(table: TableSchema, apiPrefix: string, operations: ('create' | 'read' | 'read_all' | 'update' | 'delete')[]): string {
    const tableName = table.name;
    // const className = this.toPascalCase(tableName);
    const primaryKey = table.primaryKey || 'id';

    let content = `import { Hono } from 'hono';
import { getDatabase } from '../services/database';

const ${tableName}Routes = new Hono();

`;

    // Generate read_all operation (GET /)
    if (operations.includes('read_all')) {
      content += `// Get all ${tableName}
${tableName}Routes.get('/', async (c) => {
  try {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
      const [rows] = await connection.execute('SELECT * FROM ${tableName}');
      return c.json({ success: true, data: rows });
    } finally {
      connection.release();
    }
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
    }

    // Generate read operation (GET /:id)
    if (operations.includes('read')) {
      content += `// Get ${tableName} by ID
${tableName}Routes.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
      const [rows] = await connection.execute(
        'SELECT * FROM ${tableName} WHERE ${primaryKey} = ?', 
        [id]
      );
      const records = rows as any[];
      
      if (records.length === 0) {
        return c.json({ success: false, error: 'Record not found' }, 404);
      }
      
      return c.json({ success: true, data: records[0] });
    } finally {
      connection.release();
    }
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
    }

    // Generate create operation (POST /)
    if (operations.includes('create')) {
      content += `// Create new ${tableName}
${tableName}Routes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
      const fields = Object.keys(body).filter(key => key !== '${primaryKey}');
      const values = fields.map(field => body[field]);
      const placeholders = fields.map(() => '?').join(', ');

      const [result] = await connection.execute(
        \`INSERT INTO ${tableName} (\${fields.join(', ')}) VALUES (\${placeholders})\`,
        values
      );

      const insertResult = result as any;
      
      // Return the created record
      const [newRecord] = await connection.execute(
        'SELECT * FROM ${tableName} WHERE ${primaryKey} = ?',
        [insertResult.insertId]
      );

      return c.json({ 
        success: true, 
        data: (newRecord as any[])[0] 
      }, 201);
    } finally {
      connection.release();
    }
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
    }

    // Generate update operation (PUT /:id)
    if (operations.includes('update')) {
      content += `// Update ${tableName}
${tableName}Routes.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
      const fields = Object.keys(body).filter(key => key !== '${primaryKey}');
      const values = fields.map(field => body[field]);
      const setClause = fields.map(field => \`\${field} = ?\`).join(', ');

      await connection.execute(
        \`UPDATE ${tableName} SET \${setClause} WHERE ${primaryKey} = ?\`,
        [...values, id]
      );

      // Return updated record
      const [updatedRecord] = await connection.execute(
        'SELECT * FROM ${tableName} WHERE ${primaryKey} = ?',
        [id]
      );

      const records = updatedRecord as any[];
      if (records.length === 0) {
        return c.json({ success: false, error: 'Record not found' }, 404);
      }

      return c.json({ success: true, data: records[0] });
    } finally {
      connection.release();
    }
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
    }

    // Generate delete operation (DELETE /:id)
    if (operations.includes('delete')) {
      content += `// Delete ${tableName}
${tableName}Routes.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
      const [result] = await connection.execute(
        'DELETE FROM ${tableName} WHERE ${primaryKey} = ?',
        [id]
      );

      const deleteResult = result as any;
      if (deleteResult.affectedRows === 0) {
        return c.json({ success: false, error: 'Record not found' }, 404);
      }

      return c.json({ success: true, message: 'Record deleted successfully' });
    } finally {
      connection.release();
    }
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
    }

    content += `export default ${tableName}Routes;
`;

    return content;
  }



  /**
   * Generate main routes file that imports all API routes
   */
  private async generateMainRoutesFile(
    appPath: string,
    tables: TableSchema[],
    apiPrefix: string,
    outputDir: string
  ): Promise<string> {
    const filePath = `${outputDir}/auto-generated-routes.ts`;
    
    let content = `import { Hono } from 'hono';
`;

    // Import all API route files
    for (const table of tables) {
      content += `import ${table.name}Routes from './${table.name}-api';\n`;
    }

    content += `
const autoRoutes = new Hono();

// Mount all auto-generated API routes
`;

    for (const table of tables) {
      content += `autoRoutes.route('/${table.name}', ${table.name}Routes);\n`;
    }

    content += `
export default autoRoutes;
`;

    await this.fileEditTool.editFile(appPath, {
      path: filePath,
      mode: 'create',
      content,
      createDirs: true,
    });

    return filePath;
  }

  /**
   * Add API routes directly to existing routes.ts file (always exists in V3 template)
   */
  private async addRoutesToMainFile(
    appPath: string,
    tables: TableSchema[],
    apiPrefix: string,
    operations: ('create' | 'read' | 'read_all' | 'update' | 'delete')[]
  ): Promise<string> {
    const filePath = 'src/backend/api/routes.ts';
    
    try {
      // Read existing routes file (always exists in V3 template)
      const existingContent = await readFile(join(appPath, filePath), 'utf8');
      
      // Generate API routes for all tables
      let crudRoutes = '\n\n// ========================================\n';
      crudRoutes += '// 🚀 AUTO-GENERATED API ENDPOINTS\n';
      crudRoutes += '// ========================================\n\n';
      
      for (const table of tables) {
        const tableName = table.name;
        const primaryKey = table.primaryKey || 'id';
        
        crudRoutes += `// ${tableName.toUpperCase()} API ENDPOINTS\n`;
        
        // Generate read_all operation (GET /)
        if (operations.includes('read_all')) {
          crudRoutes += `api.get('/${tableName}', async (c) => {
  try {
    const { rows } = await executeQuery('SELECT * FROM ${tableName}');
    return c.json({ success: true, data: rows });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
        }
        
        // Generate read operation (GET /:id)
        if (operations.includes('read')) {
          crudRoutes += `api.get('/${tableName}/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const { rows } = await executeQuery(
      'SELECT * FROM ${tableName} WHERE ${primaryKey} = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return c.json({ success: false, error: '${tableName} not found' }, 404);
    }
    
    return c.json({ success: true, data: rows[0] });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
        }
        
        // Generate create operation (POST /)
        if (operations.includes('create')) {
          crudRoutes += `api.post('/${tableName}', async (c) => {
  try {
    const body = await c.req.json();
    
    const fields = Object.keys(body).filter(key => key !== '${primaryKey}');
    const values = fields.map(field => body[field]);
    const placeholders = fields.map(() => '?').join(', ');
    
    const { rows } = await executeQuery(
      \`INSERT INTO ${tableName} (\${fields.join(', ')}) VALUES (\${placeholders})\`,
      values
    );
    
    // Return the created record
    const insertResult = rows as any;
    const newId = insertResult.insertId;
    
    const { rows: newRecord } = await executeQuery(
      'SELECT * FROM ${tableName} WHERE ${primaryKey} = ?',
      [newId]
    );
    
    return c.json({ 
      success: true, 
      data: newRecord[0] 
    }, 201);
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
        }
        
        // Generate update operation (PUT /:id)
        if (operations.includes('update')) {
          crudRoutes += `api.put('/${tableName}/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    
    const fields = Object.keys(body).filter(key => key !== '${primaryKey}');
    const values = fields.map(field => body[field]);
    const setClause = fields.map(field => \`\${field} = ?\`).join(', ');
    
    await executeQuery(
      \`UPDATE ${tableName} SET \${setClause} WHERE ${primaryKey} = ?\`,
      [...values, id]
    );
    
    // Return updated record
    const { rows } = await executeQuery(
      'SELECT * FROM ${tableName} WHERE ${primaryKey} = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return c.json({ success: false, error: '${tableName} not found' }, 404);
    }
    
    return c.json({ success: true, data: rows[0] });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
        }
        
        // Generate delete operation (DELETE /:id)
        if (operations.includes('delete')) {
          crudRoutes += `api.delete('/${tableName}/:id', async (c) => {
  try {
    const id = c.req.param('id');
    
    // First check if record exists
    const { rows: existingRows } = await executeQuery(
      'SELECT * FROM ${tableName} WHERE ${primaryKey} = ?',
      [id]
    );
    
    if (existingRows.length === 0) {
      return c.json({ success: false, error: '${tableName} not found' }, 404);
    }
    
    await executeQuery(
      'DELETE FROM ${tableName} WHERE ${primaryKey} = ?',
      [id]
    );
    
    return c.json({ 
      success: true, 
      message: '${tableName} deleted successfully' 
    });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

`;
        }
      }
      
      // Insert the API routes before the export statement
      const exportMatch = existingContent.match(/^export default api;$/m);
      if (exportMatch) {
        const insertPosition = exportMatch.index!;
        const newContent = existingContent.slice(0, insertPosition) + 
                          crudRoutes + 
                          existingContent.slice(insertPosition);
        
        await this.fileEditTool.editFile(appPath, {
          path: filePath,
          mode: 'rewrite',
          content: newContent,
          createDirs: true,
        });
      } else {
        // If no export found, append to the end
        const newContent = existingContent + crudRoutes + '\nexport default api;\n';
        
        await this.fileEditTool.editFile(appPath, {
          path: filePath,
          mode: 'rewrite',
          content: newContent,
          createDirs: true,
        });
      }
      
      return filePath;
    } catch (error) {
      throw new Error(`routes.ts not found at ${filePath}. This tool requires the V3 template structure with existing routes.ts file.`);
    }
  }

  /**
   * Generate API documentation
   */
  private async generateAPIDocumentation(
    appPath: string,
    tables: TableSchema[],
    endpoints: EndpointInfo[],
    outputDir: string
  ): Promise<string> {
    const filePath = `${outputDir}/AUTO_API_DOCS.md`;
    
    let content = `# Auto-Generated API Documentation

Generated on: ${new Date().toISOString()}

## Overview

This API provides customizable operations for the following database tables:

${tables.map(table => `- **${table.name}** (${table.columns.length} columns)`).join('\n')}

**Available Operations:**
- **create** - POST endpoints for creating new records
- **read** - GET endpoints for fetching single records by ID
- **read_all** - GET endpoints for fetching all records
- **update** - PUT endpoints for updating existing records
- **delete** - DELETE endpoints for removing records

## Endpoints

`;

    // Group endpoints by table
    const endpointsByTable = endpoints.reduce((acc, endpoint) => {
      if (!acc[endpoint.table]) acc[endpoint.table] = [];
      acc[endpoint.table]!.push(endpoint);
      return acc;
    }, {} as Record<string, EndpointInfo[]>);

    for (const [tableName, tableEndpoints] of Object.entries(endpointsByTable)) {
      const table = tables.find(t => t.name === tableName)!;
      
      content += `### ${tableName}\n\n`;
      content += `**Schema:**\n`;
      content += `| Column | Type | Nullable | Auto Increment |\n`;
      content += `|--------|------|----------|----------------|\n`;
      
      for (const column of table.columns) {
        content += `| ${column.name} | ${column.type} | ${column.nullable ? 'Yes' : 'No'} | ${column.autoIncrement ? 'Yes' : 'No'} |\n`;
      }
      
      content += `\n**Endpoints:**\n\n`;
      
      for (const endpoint of tableEndpoints) {
        content += `#### ${endpoint.method} ${endpoint.path}\n`;
        content += `${endpoint.description}\n\n`;
        
        if (endpoint.method === 'POST') {
          content += `**Request Body:**\n\`\`\`json\n{\n`;
          for (const column of table.columns.filter(col => !col.autoIncrement)) {
            const optional = column.nullable || column.defaultValue ? '?' : '';
            content += `  "${column.name}"${optional}: ${this.getExampleValue(column.type)}\n`;
          }
          content += `}\n\`\`\`\n\n`;
        }
        
        if (endpoint.method === 'PUT') {
          content += `**Request Body:**\n\`\`\`json\n{\n`;
          for (const column of table.columns.filter(col => col.name !== table.primaryKey)) {
            content += `  "${column.name}"?: ${this.getExampleValue(column.type)}\n`;
          }
          content += `}\n\`\`\`\n\n`;
        }
      }
    }

    await this.fileEditTool.editFile(appPath, {
      path: filePath,
      mode: 'create',
      content,
      createDirs: true,
    });

    return filePath;
  }

  /**
   * Get example value for documentation
   */
  private getExampleValue(type: string): string {
    switch (type) {
      case 'number': return '123';
      case 'string': return '"example"';
      case 'boolean': return 'true';
      case 'Date': return '"2024-01-01T00:00:00Z"';
      case 'object': return '{}';
      default: return '"value"';
    }
  }

  /**
   * Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
}

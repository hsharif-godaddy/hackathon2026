import type { SkillToolDefinition } from '@airo/ai-skills';
import { z } from 'zod';
import { MySQLUtils, isSystemTable } from '../../../utils/mysql-utils.js';
import { logger } from '../../../logging/index.js';

const mysqlUtils = new MySQLUtils();

function validateTableName(tableName: string): void {
  if (isSystemTable(tableName)) {
    throw new Error(`Access denied: '${tableName}' is a protected system table`);
  }
}

/**
 * List all tables in the database
 */
export const listTablesTool: SkillToolDefinition = {
  name: 'listTables',
  description:
    'List all tables in the application database. Returns array of table names (excludes system tables like __drizzle_migrations).',

  parameters: z.object({}),

  async execute(_input, context) {
    const appId = context?.metadata?.appId as string;

    if (!appId) {
      throw new Error('App ID required for database operations');
    }

    logger.info('skill.database.listTables.execute', {
      appId,
    });

    try {
      const credentials = await mysqlUtils.loadCredentialsFromApp({
        id: appId,
        path: '',
      });

      const tables = await mysqlUtils.listTables(credentials);

      logger.info('skill.database.listTables.success', {
        appId,
        tableCount: tables.length,
      });

      return {
        success: true,
        tables,
      };
    } catch (error) {
      logger.error('skill.database.listTables.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  config: {
    timeout: 30000,
    requiresApp: true,
  },
};

/**
 * Get table schema information
 */
export const getSchemaTool: SkillToolDefinition = {
  name: 'getSchema',
  description:
    'Get schema information for a specific table. Returns array of column information including names, types, and constraints.',

  parameters: z.object({
    tableName: z.string().describe('Name of the table'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;

    if (!appId) {
      throw new Error('App ID required for database operations');
    }

    validateTableName(input.tableName);

    logger.info('skill.database.getSchema.execute', {
      appId,
      tableName: input.tableName,
    });

    try {
      const credentials = await mysqlUtils.loadCredentialsFromApp({
        id: appId,
        path: '',
      });

      const schema = await mysqlUtils.getTableSchema(credentials, input.tableName);

      logger.info('skill.database.getSchema.success', {
        appId,
        tableName: input.tableName,
        columnCount: schema.length,
      });

      return {
        success: true,
        tableName: input.tableName,
        columns: schema,
      };
    } catch (error) {
      logger.error('skill.database.getSchema.error', {
        appId,
        tableName: input.tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  config: {
    timeout: 30000,
    requiresApp: true,
  },
};

/**
 * Get paginated table data
 */
export const getTableDataTool: SkillToolDefinition = {
  name: 'getTableData',
  description:
    'Get paginated data from a table. Returns rows with pagination metadata (total count, hasMore flag).',

  parameters: z.object({
    tableName: z.string().describe('Name of the table'),
    page: z.number().int().positive().optional().describe('Page number (1-indexed, default: 1)'),
    limit: z
      .number()
      .int()
      .positive()
      .max(1000)
      .optional()
      .describe('Number of rows per page (default: 25, max: 1000)'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;

    if (!appId) {
      throw new Error('App ID required for database operations');
    }

    validateTableName(input.tableName);

    const page = input.page ?? 1;
    const limit = input.limit ?? 25;

    logger.info('skill.database.getTableData.execute', {
      appId,
      tableName: input.tableName,
      page,
      limit,
    });

    try {
      const credentials = await mysqlUtils.loadCredentialsFromApp({
        id: appId,
        path: '',
      });

      const result = await mysqlUtils.getTableData(credentials, input.tableName, page, limit);

      logger.info('skill.database.getTableData.success', {
        appId,
        tableName: input.tableName,
        rowCount: result.rows.length,
        total: result.total,
      });

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      logger.error('skill.database.getTableData.error', {
        appId,
        tableName: input.tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  config: {
    timeout: 30000,
    requiresApp: true,
  },
};

/**
 * Insert a new row into a table
 */
export const insertRowTool: SkillToolDefinition = {
  name: 'insertRow',
  description: 'Insert a new row into a table. Returns success status.',

  parameters: z.object({
    tableName: z.string().describe('Name of the table'),
    data: z
      .record(z.any())
      .refine((obj) => Object.keys(obj).length > 0, { message: 'data must not be empty' })
      .describe('Column-value pairs for the new row'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;

    if (!appId) {
      throw new Error('App ID required for database operations');
    }

    validateTableName(input.tableName);

    logger.info('skill.database.insertRow.execute', {
      appId,
      tableName: input.tableName,
      columnCount: Object.keys(input.data).length,
    });

    try {
      const credentials = await mysqlUtils.loadCredentialsFromApp({
        id: appId,
        path: '',
      });

      await mysqlUtils.insertRow(credentials, input.tableName, input.data);

      logger.info('skill.database.insertRow.success', {
        appId,
        tableName: input.tableName,
      });

      return {
        success: true,
      };
    } catch (error) {
      logger.error('skill.database.insertRow.error', {
        appId,
        tableName: input.tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  config: {
    timeout: 30000,
    requiresApp: true,
  },
};

/**
 * Update an existing row in a table
 */
export const updateRowTool: SkillToolDefinition = {
  name: 'updateRow',
  description:
    'Update an existing row in a table. Requires primary key to identify the row. Returns success status.',

  parameters: z.object({
    tableName: z.string().describe('Name of the table'),
    primaryKey: z
      .record(z.any())
      .refine((obj) => Object.keys(obj).length > 0, { message: 'primaryKey must not be empty' })
      .describe('Primary key column-value pairs for WHERE clause'),
    data: z
      .record(z.any())
      .refine((obj) => Object.keys(obj).length > 0, { message: 'data must not be empty' })
      .describe('Column-value pairs to update'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;

    if (!appId) {
      throw new Error('App ID required for database operations');
    }

    validateTableName(input.tableName);

    logger.info('skill.database.updateRow.execute', {
      appId,
      tableName: input.tableName,
      columnCount: Object.keys(input.data).length,
    });

    try {
      const credentials = await mysqlUtils.loadCredentialsFromApp({
        id: appId,
        path: '',
      });

      await mysqlUtils.updateRow(credentials, input.tableName, input.primaryKey, input.data);

      logger.info('skill.database.updateRow.success', {
        appId,
        tableName: input.tableName,
      });

      return {
        success: true,
      };
    } catch (error) {
      logger.error('skill.database.updateRow.error', {
        appId,
        tableName: input.tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  config: {
    timeout: 30000,
    requiresApp: true,
  },
};

/**
 * Delete a row from a table
 */
export const deleteRowTool: SkillToolDefinition = {
  name: 'deleteRow',
  description:
    'Delete a row from a table. Requires primary key to identify the row. Returns success status.',

  parameters: z.object({
    tableName: z.string().describe('Name of the table'),
    primaryKey: z
      .record(z.any())
      .refine((obj) => Object.keys(obj).length > 0, { message: 'primaryKey must not be empty' })
      .describe('Primary key column-value pairs for WHERE clause'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;

    if (!appId) {
      throw new Error('App ID required for database operations');
    }

    validateTableName(input.tableName);

    logger.info('skill.database.deleteRow.execute', {
      appId,
      tableName: input.tableName,
    });

    try {
      const credentials = await mysqlUtils.loadCredentialsFromApp({
        id: appId,
        path: '',
      });

      await mysqlUtils.deleteRow(credentials, input.tableName, input.primaryKey);

      logger.info('skill.database.deleteRow.success', {
        appId,
        tableName: input.tableName,
      });

      return {
        success: true,
      };
    } catch (error) {
      logger.error('skill.database.deleteRow.error', {
        appId,
        tableName: input.tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  config: {
    timeout: 30000,
    requiresApp: true,
  },
};

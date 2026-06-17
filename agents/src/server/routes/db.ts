import { Router, Request, Response, IRouter } from 'express';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { AppRepository } from '../../database/index.js';
import { formatCSVHeader, formatCSVRow } from '../../utils/csv-utils.js';
import { MySQLUtils, isSystemTable, type DatabaseCredentials } from '../../utils/mysql-utils.js';
import { Logger, log } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

/**
 * Sanitize a string for use in Content-Disposition filename.
 * Strips characters that could cause header injection or parsing issues.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_');
}

const router: IRouter = Router();
const appRepo = new AppRepository();
const mysqlUtils = new MySQLUtils();
const logger = Logger.create({ component: 'db-routes' });

// SECURITY: Apply ownership validation to all database routes
// Prevents cross-tenant access to database credentials and data
router.use('/apps/:id', validateAppOwnership);

/**
 * GET /apps/:id/database/tables - Get database tables for an app
 */
router.get('/apps/:id/database/tables', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    logger.info('route.db.tables.begin', {
      appId: id,
      url: req.url,
      method: req.method,
      path: req.path,
    });

    // Find the app
    const app = appRepo.findById(id);
    if (!app) {
      logger.warn('route.db.tables.not_found', {
        appId: id,
      });
      return res.status(404).json({ error: 'App not found' });
    }

    // Load credentials using MySQLUtils
    const credentials = await mysqlUtils.loadCredentialsFromApp(app);

    logger.info('route.db.tables.credentials_loaded', {
      appId: id,
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
    });

    // Get table list using MySQLUtils
    const tables = await mysqlUtils.listTables(credentials);

    logger.info('route.db.tables.success', {
      appId: id,
      database: credentials.database,
      tableCount: tables.length,
      tables: tables.slice(0, 5), // Log first 5 for verification
    });

    return res.json({
      tables,
      count: tables.length,
    });
  } catch (error) {
    const appId = req.params.id;
    const contextLogger = appId ? log.forApp(appId) : logger;

    // Enhanced error logging with more context
    log.error(contextLogger, 'route.db.tables.error', error as Error, {
      appId,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    // Return appropriate error response
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Failed to retrieve database tables',
      message: errorMessage,
    });
  }
});

/**
 * GET /apps/:id/database/tables/:tableName/schema - Get table schema
 */
router.get('/apps/:id/database/tables/:tableName/schema', async (req: Request, res: Response) => {
  try {
    const { id, tableName } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    if (!tableName) {
      return res.status(400).json({ error: 'Table name is required' });
    }

    // Prevent access to system tables
    if (isSystemTable(tableName)) {
      logger.warn('route.db.table_schema.system_table_blocked', {
        appId: id,
        tableName,
      });
      return res.status(403).json({ error: 'Access to system tables is not allowed' });
    }

    logger.info('route.db.table_schema.begin', {
      appId: id,
      tableName,
    });

    const app = appRepo.findById(id);
    if (!app) {
      logger.warn('route.db.table_schema.not_found', {
        appId: id,
      });
      return res.status(404).json({ error: 'App not found' });
    }

    // Load credentials and get schema using MySQLUtils
    const credentials = await mysqlUtils.loadCredentialsFromApp(app);
    const schema = await mysqlUtils.getTableSchema(credentials, tableName);

    logger.info('route.db.table_schema.success', {
      appId: id,
      tableName,
      columnCount: schema.length,
    });

    return res.json({
      columns: schema,
    });
  } catch (error) {
    const appId = req.params.id;
    const contextLogger = appId ? log.forApp(appId) : logger;

    log.error(contextLogger, 'route.db.table_schema.error', error as Error, {
      appId,
      tableName: req.params.tableName,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to retrieve table schema',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /apps/:id/database/tables/:tableName/data - Get table data with pagination
 */
router.get('/apps/:id/database/tables/:tableName/data', async (req: Request, res: Response) => {
  try {
    const { id, tableName } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    if (!tableName) {
      return res.status(400).json({ error: 'Table name is required' });
    }

    // Prevent access to system tables
    if (isSystemTable(tableName)) {
      logger.warn('route.db.table_data.system_table_blocked', {
        appId: id,
        tableName,
      });
      return res.status(403).json({ error: 'Access to system tables is not allowed' });
    }

    logger.info('route.db.table_data.begin', {
      appId: id,
      tableName,
      page,
      limit,
    });

    const app = appRepo.findById(id);
    if (!app) {
      logger.warn('route.db.table_data.not_found', {
        appId: id,
      });
      return res.status(404).json({ error: 'App not found' });
    }

    // Load credentials and get table data using MySQLUtils
    const credentials = await mysqlUtils.loadCredentialsFromApp(app);
    const result = await mysqlUtils.getTableData(credentials, tableName, page, limit);

    logger.info('route.db.table_data.success', {
      appId: id,
      tableName,
      page,
      limit,
      total: result.total,
      rowCount: result.rows.length,
    });

    return res.json(result);
  } catch (error) {
    const appId = req.params.id;
    const contextLogger = appId ? log.forApp(appId) : logger;

    log.error(contextLogger, 'route.db.table_data.error', error as Error, {
      appId,
      tableName: req.params.tableName,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to retrieve table data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /apps/:id/database/tables/:tableName/rows - Insert a new row
 */
router.post('/apps/:id/database/tables/:tableName/rows', async (req: Request, res: Response) => {
  try {
    const { id, tableName } = req.params;
    const { data } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    if (!tableName) {
      return res.status(400).json({ error: 'Table name is required' });
    }
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Row data is required' });
    }

    // Prevent access to system tables
    if (isSystemTable(tableName)) {
      logger.warn('route.db.insert_row.system_table_blocked', {
        appId: id,
        tableName,
      });
      return res.status(403).json({ error: 'Access to system tables is not allowed' });
    }

    logger.info('route.db.insert_row.begin', {
      appId: id,
      tableName,
      columnCount: Object.keys(data).length,
    });

    const app = appRepo.findById(id);
    if (!app) {
      logger.warn('route.db.insert_row.not_found', {
        appId: id,
      });
      return res.status(404).json({ error: 'App not found' });
    }

    // Load credentials and insert row using MySQLUtils
    const credentials = await mysqlUtils.loadCredentialsFromApp(app);
    await mysqlUtils.insertRow(credentials, tableName, data);

    logger.info('route.db.insert_row.success', {
      appId: id,
      tableName,
    });

    return res.json({ success: true, message: 'Row inserted successfully' });
  } catch (error) {
    const appId = req.params.id;
    const contextLogger = appId ? log.forApp(appId) : logger;

    log.error(contextLogger, 'route.db.insert_row.error', error as Error, {
      appId,
      tableName: req.params.tableName,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to insert row',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /apps/:id/database/tables/:tableName/rows - Update an existing row
 */
router.put('/apps/:id/database/tables/:tableName/rows', async (req: Request, res: Response) => {
  try {
    const { id, tableName } = req.params;
    const { primaryKey, data } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    if (!tableName) {
      return res.status(400).json({ error: 'Table name is required' });
    }
    if (!primaryKey || typeof primaryKey !== 'object') {
      return res.status(400).json({ error: 'Primary key is required' });
    }
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Row data is required' });
    }

    // Prevent access to system tables
    if (isSystemTable(tableName)) {
      logger.warn('route.db.update_row.system_table_blocked', {
        appId: id,
        tableName,
      });
      return res.status(403).json({ error: 'Access to system tables is not allowed' });
    }

    logger.info('route.db.update_row.begin', {
      appId: id,
      tableName,
      columnCount: Object.keys(data).length,
    });

    const app = appRepo.findById(id);
    if (!app) {
      logger.warn('route.db.update_row.not_found', {
        appId: id,
      });
      return res.status(404).json({ error: 'App not found' });
    }

    // Load credentials and update row using MySQLUtils
    const credentials = await mysqlUtils.loadCredentialsFromApp(app);
    await mysqlUtils.updateRow(credentials, tableName, primaryKey, data);

    logger.info('route.db.update_row.success', {
      appId: id,
      tableName,
    });

    return res.json({ success: true, message: 'Row updated successfully' });
  } catch (error) {
    const appId = req.params.id;
    const contextLogger = appId ? log.forApp(appId) : logger;

    log.error(contextLogger, 'route.db.update_row.error', error as Error, {
      appId,
      tableName: req.params.tableName,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to update row',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /apps/:id/database/tables/:tableName/rows - Delete a row
 */
router.delete('/apps/:id/database/tables/:tableName/rows', async (req: Request, res: Response) => {
  try {
    const { id, tableName } = req.params;
    const { primaryKey } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    if (!tableName) {
      return res.status(400).json({ error: 'Table name is required' });
    }
    if (!primaryKey || typeof primaryKey !== 'object') {
      return res.status(400).json({ error: 'Primary key is required' });
    }

    // Prevent access to system tables
    if (isSystemTable(tableName)) {
      logger.warn('route.db.delete_row.system_table_blocked', {
        appId: id,
        tableName,
      });
      return res.status(403).json({ error: 'Access to system tables is not allowed' });
    }

    logger.info('route.db.delete_row.begin', {
      appId: id,
      tableName,
    });

    const app = appRepo.findById(id);
    if (!app) {
      logger.warn('route.db.delete_row.not_found', {
        appId: id,
      });
      return res.status(404).json({ error: 'App not found' });
    }

    // Load credentials and delete row using MySQLUtils
    const credentials = await mysqlUtils.loadCredentialsFromApp(app);
    await mysqlUtils.deleteRow(credentials, tableName, primaryKey);

    logger.info('route.db.delete_row.success', {
      appId: id,
      tableName,
    });

    return res.json({ success: true, message: 'Row deleted successfully' });
  } catch (error) {
    const appId = req.params.id;
    const contextLogger = appId ? log.forApp(appId) : logger;

    log.error(contextLogger, 'route.db.delete_row.error', error as Error, {
      appId,
      tableName: req.params.tableName,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to delete row',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Number of rows per INSERT statement in SQL export.
 * Balances file size vs execution performance on reimport.
 */
const SQL_EXPORT_INSERT_BATCH_SIZE = 500;

/**
 * Escape a value for use in a SQL INSERT statement.
 * Handles strings, numbers, BigInt, null, booleans, Dates, and Buffers.
 */
function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  const str = String(value);
  // Escape backslash, single quote, newline, carriage return, null byte, and Ctrl-Z (0x1A).
  // Ctrl-Z is interpreted as EOF by mysql CLI on Windows — escaping prevents silent truncation.
  // eslint-disable-next-line no-control-regex
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\0/g, '\\0').replace(/\u001a/g, '\\Z')}'`;
}

/**
 * Stream SQL export for a single table (DDL + optional INSERT data).
 * Writes directly to the response stream.
 */
async function streamTableSqlExport(
  res: Response,
  credentials: DatabaseCredentials,
  tableName: string,
  schemaOnly: boolean
): Promise<void> {
  const escapedTableName = mysqlUtils.escapeIdentifier(tableName);

  // Write DROP TABLE + CREATE TABLE
  const ddl = await mysqlUtils.getCreateTableDDL(credentials, tableName);
  res.write(`DROP TABLE IF EXISTS ${escapedTableName};\n`);
  res.write(`${ddl};\n\n`);

  if (schemaOnly) return;

  // Fetch schema before allocating a streaming connection to avoid
  // leaking the pool connection if getTableSchema rejects.
  const schema = await mysqlUtils.getTableSchema(credentials, tableName);
  const columnNames = schema.map(col => mysqlUtils.escapeIdentifier(col.name));
  const columnsClause = columnNames.join(', ');

  const { stream, connection } = await mysqlUtils.streamTableData(credentials, tableName);

  const batch: string[] = [];

  const formatter = new Transform({
    objectMode: true,
    transform(row: Record<string, unknown>, _encoding, callback) {
      const values = schema.map(col => escapeSqlValue(row[col.name]));
      batch.push(`(${values.join(', ')})`);

      if (batch.length >= SQL_EXPORT_INSERT_BATCH_SIZE) {
        const chunk = `INSERT INTO ${escapedTableName} (${columnsClause}) VALUES\n${batch.join(',\n')};\n\n`;
        batch.length = 0;
        callback(null, chunk);
      } else {
        callback();
      }
    },
    flush(callback) {
      if (batch.length > 0) {
        const chunk = `INSERT INTO ${escapedTableName} (${columnsClause}) VALUES\n${batch.join(',\n')};\n\n`;
        batch.length = 0;
        callback(null, chunk);
      } else {
        callback();
      }
    },
  });

  // pipeline() includes res so client disconnect destroys upstream streams,
  // preventing wasted DB reads on a dead connection.
  try {
    await pipeline(stream, formatter, res, { end: false });
  } finally {
    try {
      connection.release();
    } catch (releaseError) {
      logger.warn('route.db.sql_export.release_failed', {
        error: releaseError instanceof Error ? releaseError.message : String(releaseError),
      });
    }
  }
}

/**
 * GET /apps/:id/database/export - Export multiple tables as a single SQL file
 *
 * Query params:
 *   - schemaOnly: "true" | "false" (default: "false") — export all tables as structure only
 *   - schemaOnlyTables: comma-separated table names — export only these tables as structure only
 *   - tables: comma-separated table names (default: all tables)
 *
 * When both schemaOnly and schemaOnlyTables are provided, schemaOnly wins (all tables are schema-only).
 */
router.get('/apps/:id/database/export', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const allSchemaOnly = req.query.schemaOnly === 'true';
  const tablesParam = req.query.tables as string | undefined;
  const schemaOnlyTablesParam = req.query.schemaOnlyTables as string | undefined;

  if (!id) {
    res.status(400).json({ error: 'App ID is required' });
    return;
  }

  const app = appRepo.findById(id);
  if (!app) {
    logger.warn('route.db.sql_export.not_found', { appId: id });
    res.status(404).json({ error: 'App not found' });
    return;
  }

  try {
    const credentials = await mysqlUtils.loadCredentialsFromApp(app);

    // Determine which tables to export
    const allTables = await mysqlUtils.listTables(credentials);
    let tablesToExport: string[];

    if (tablesParam) {
      const requested = [...new Set(tablesParam.split(',').map(t => t.trim()).filter(Boolean))];
      // Validate all requested tables exist and are not system tables
      for (const t of requested) {
        if (isSystemTable(t)) {
          res.status(403).json({ error: `Access to system table '${t}' is not allowed` });
          return;
        }
        if (!allTables.includes(t)) {
          res.status(400).json({ error: `Table '${t}' does not exist` });
          return;
        }
      }
      tablesToExport = requested;
    } else {
      tablesToExport = allTables;
    }

    if (tablesToExport.length === 0) {
      res.status(400).json({ error: 'No tables to export' });
      return;
    }

    // Parse and validate schemaOnlyTables — only allow tables that are in the export set
    const perTableSchemaOnly = new Set<string>();
    if (schemaOnlyTablesParam) {
      const requested = [...new Set(schemaOnlyTablesParam.split(',').map(t => t.trim()).filter(Boolean))];
      const exportSet = new Set(tablesToExport);
      for (const t of requested) {
        if (exportSet.has(t)) {
          perTableSchemaOnly.add(t);
        }
      }
    }

    logger.info('route.db.sql_export.begin', {
      appId: id,
      allSchemaOnly,
      schemaOnlyTables: schemaOnlyTablesParam ?? null,
      tableCount: tablesToExport.length,
      tables: tablesToExport.slice(0, 10),
    });

    // Set response headers — after this point, no JSON error responses
    const filename = sanitizeFilename(`${credentials.database}-export.sql`);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write SQL header
    res.write('-- Database export\n');
    res.write(`-- Generated: ${new Date().toISOString()}\n`);
    res.write(`-- Tables: ${tablesToExport.length}\n\n`);
    res.write('SET FOREIGN_KEY_CHECKS = 0;\n\n');

    // Export each table sequentially
    for (const tableName of tablesToExport) {
      const skipData = allSchemaOnly || perTableSchemaOnly.has(tableName);
      res.write(`-- Table: ${tableName}${skipData ? ' (structure only)' : ''}\n`);
      await streamTableSqlExport(res, credentials, tableName, skipData);
    }

    res.write('SET FOREIGN_KEY_CHECKS = 1;\n');
    res.write('-- EXPORT COMPLETE\n');

    logger.info('route.db.sql_export.success', {
      appId: id,
      allSchemaOnly,
      tableCount: tablesToExport.length,
    });

    res.end();
  } catch (error) {
    const contextLogger = id ? log.forApp(id) : logger;

    // Client disconnected — no point logging as an error
    if (req.destroyed) {
      logger.info('route.db.sql_export.client_disconnected', { appId: id });
      return;
    }

    log.error(contextLogger, 'route.db.sql_export.error', error as Error, {
      appId: id,
      allSchemaOnly,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to export database',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }
    if (!res.writableEnded) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      res.write(`\n-- ERROR: export aborted: ${msg}\n`);
      res.write('-- DO NOT IMPORT THIS FILE\n');
      res.end();
    }
  }
});

/**
 * GET /apps/:id/database/tables/:tableName/export - Export full table as CSV or JSON
 */
router.get('/apps/:id/database/tables/:tableName/export', async (req: Request, res: Response): Promise<void> => {
  const { id, tableName } = req.params;
  const format = (req.query.format as string)?.toLowerCase() || 'csv';

  if (!id) {
    res.status(400).json({ error: 'App ID is required' });
    return;
  }
  if (!tableName) {
    res.status(400).json({ error: 'Table name is required' });
    return;
  }
  if (format !== 'csv' && format !== 'json') {
    res.status(400).json({ error: 'Invalid format. Must be "csv" or "json"' });
    return;
  }

  if (isSystemTable(tableName)) {
    logger.warn('route.db.export.system_table_blocked', { appId: id, tableName });
    res.status(403).json({ error: 'Access to system tables is not allowed' });
    return;
  }

  const app = appRepo.findById(id);
  if (!app) {
    logger.warn('route.db.export.not_found', { appId: id });
    res.status(404).json({ error: 'App not found' });
    return;
  }

  let connection: Awaited<ReturnType<typeof mysqlUtils.streamTableData>>['connection'] | undefined;

  function releaseConnection() {
    if (connection) {
      try { connection.release(); } catch { /* already released */ }
      connection = undefined;
    }
  }

  try {
    const credentials = await mysqlUtils.loadCredentialsFromApp(app);

    // Pre-flight: get schema before setting headers (can still return proper error)
    const schema = await mysqlUtils.getTableSchema(credentials, tableName);
    const columnNames = schema.map(col => col.name);

    logger.info('route.db.export.begin', { appId: id, tableName, format, columnCount: columnNames.length });

    const safeFilename = sanitizeFilename(tableName);

    // Set response headers — after this point, no JSON error responses
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.csv"`);
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.json"`);
    }

    const result = await mysqlUtils.streamTableData(credentials, tableName);
    const stream = result.stream;
    connection = result.connection;

    // Build a Transform that formats each row object into the output format.
    // Using pipeline() gives us automatic backpressure and cleanup.
    let isFirstJsonRow = true;
    const formatter = new Transform({
      objectMode: true,
      transform(row: Record<string, unknown>, _encoding, callback) {
        if (format === 'csv') {
          callback(null, formatCSVRow(row, columnNames) + '\n');
        } else {
          if (isFirstJsonRow) {
            isFirstJsonRow = false;
            callback(null, JSON.stringify(row));
          } else {
            callback(null, ',\n' + JSON.stringify(row));
          }
        }
      },
    });

    // Write format preamble
    if (format === 'csv') {
      res.write('\uFEFF' + formatCSVHeader(columnNames) + '\n');
    } else {
      res.write('[\n');
    }

    // pipeline() handles backpressure, error propagation, and stream cleanup.
    // If the client disconnects (res closes), pipeline destroys upstream streams.
    try {
      await pipeline(stream, formatter, res, { end: false });
    } finally {
      releaseConnection();
    }

    // Write format epilogue and finish
    if (format === 'json') {
      res.write('\n]');
    }
    logger.info('route.db.export.success', { appId: id, tableName, format });
    res.end();
  } catch (error) {
    releaseConnection();

    const contextLogger = id ? log.forApp(id) : logger;
    log.error(contextLogger, 'route.db.export.error', error as Error, {
      appId: id,
      tableName,
      format,
      error: error instanceof Error ? error.message : String(error),
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to export table data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }
    // If headers already sent and pipeline errored (e.g. client disconnect), just end
    if (!res.writableEnded) {
      res.end();
    }
  }
});

export default router;

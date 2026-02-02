import { Router, Request, Response, IRouter } from 'express';
import { AppRepository } from '../../database/index.js';
import { MySQLUtils, isSystemTable } from '../../utils/mysql-utils.js';
import { Logger, log } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const router: IRouter = Router();
const appRepo = new AppRepository();
const mysqlUtils = new MySQLUtils();
const logger = Logger.create({ service: 'db-routes' });

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

export default router;

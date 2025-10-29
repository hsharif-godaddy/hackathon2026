import { Router, Request, Response, IRouter } from 'express';
import { AppRepository } from '../../database/index.js';
import type { CreateAppRequest, UpdateAppRequest } from '../../database/index.js';
import { DirectoryListingTool } from '../../tools/directory-listing.js';
import { ReadFileTool } from '../../tools/read-file.js';
import { FileEditTool } from '../../tools/file-edit.js';
import { ASTStyleEditor } from '../../tools/ast-style-editor.js';
import { ASTTextEditor } from '../../tools/ast-text-editor.js';
import { TokenUsageRepository } from '../../database/index.js';
import { ServerManagementTool } from '../../tools/server-management-tool.js';
import { getNameSuggestionService } from '../../services/name-suggestion.js';
import { Logger, log } from '../../logging/index.js';

const router: IRouter = Router();
const appRepo = new AppRepository();
const directoryTool = new DirectoryListingTool();
const readFileTool = new ReadFileTool();
const fileEditTool = new FileEditTool();
const astStyleEditor = new ASTStyleEditor();
const astTextEditor = new ASTTextEditor();
const tokenUsageRepo = new TokenUsageRepository();
const logger = Logger.create({ service: 'apps-routes' });

/**
 * GET /apps - List all apps
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const apps = appRepo.findAll(limit, offset);
    const total = appRepo.count();
    const totalPages = Math.ceil(total / limit);

    return res.json({
      apps,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    log.error(logger, 'route.apps.list.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/servers - Get running development servers
 */
router.get('/servers', async (req: Request, res: Response) => {
  // Running servers are now managed by the main app service
  return res.status(501).json({
    error: 'Server listing has been moved to the main app service',
    message: 'Use the main app API for server management operations'
  });
});

/**
 * GET /apps/config - Get app configuration for frontend
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const config = {
      showUsageCost: process.env.SHOW_USAGE_COST === 'true'
    };

    return res.json({ config });
  } catch (error) {
    log.error(logger, 'route.apps.config.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id - Get a specific app
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    const app = appRepo.findById(id);

    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    return res.json({ app });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.get.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id/status - Get app creation status
 */
router.get('/:id/status', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    return res.json({
      id: app.id,
      status: app.status,
      name: app.name,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.status.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /create - Create a new app (new simplified endpoint)
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { name, initialPrompt, siteId } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required and must be a non-empty string' });
    }

    if (!siteId || typeof siteId !== 'string' || siteId.trim().length === 0) {
      return res.status(400).json({ error: 'Site ID is required and must be a non-empty string' });
    }

    const data: CreateAppRequest = {
      name: name.trim(),
      initialPrompt: initialPrompt?.trim() || undefined,
      siteId: siteId.trim()
    };

    // App creation is now handled by the main app service
    return res.status(501).json({
      error: 'App creation has been moved to the main app service',
      message: 'Use the main app API for app creation operations'
    });
  } catch (error) {
    log.error(logger, 'route.apps.create.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /register - Register an existing app from main service
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { siteId, name, appPath, port, initialPrompt, previewUrl } = req.body;

    if (!siteId || typeof siteId !== 'string' || siteId.trim().length === 0) {
      return res.status(400).json({ error: 'siteId is required and must be a non-empty string' });
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return res.status(400).json({ error: 'name must be a non-empty string if provided' });
    }

    if (appPath !== undefined && (typeof appPath !== 'string' || appPath.trim().length === 0)) {
      return res.status(400).json({ error: 'appPath must be a non-empty string if provided' });
    }

    if (port !== undefined && (typeof port !== 'number' || port < 1 || port > 65535)) {
      return res.status(400).json({ error: 'port must be a valid port number (1-65535) if provided' });
    }

    if (initialPrompt !== undefined && typeof initialPrompt !== 'string') {
      return res.status(400).json({ error: 'initialPrompt must be a string if provided' });
    }

    if (previewUrl !== undefined && typeof previewUrl !== 'string') {
      return res.status(400).json({ error: 'previewUrl must be a string if provided' });
    }

    const result = await appRepo.registerOrUpdateApp({
      siteId,
      name,
      appPath,
      port,
      initialPrompt,
      previewUrl
    });

    return res.status(result.created ? 201 : 200).json(result);

  } catch (error) {
    log.error(logger, 'route.apps.register.error', error as Error, {});

    if (error instanceof Error && error.message.includes('mismatch')) {
      return res.status(403).json({ error: error.message });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps - Create a new app (legacy endpoint)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const data: CreateAppRequest = req.body;

    // Validate required fields
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required and must be a non-empty string' });
    }

    // Trim whitespace
    data.name = data.name.trim();

    // App creation is now handled by the main app service
    return res.status(501).json({
      error: 'App creation has been moved to the main app service',
      message: 'Use the main app API for app creation operations'
    });
  } catch (error) {
    log.error(logger, 'route.apps.create.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /apps/:id - Update an app
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    const data: UpdateAppRequest = req.body;

    // Validate name if provided
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim().length === 0) {
        return res.status(400).json({ error: 'Name must be a non-empty string' });
      }
      data.name = data.name.trim();
    }

    const app = appRepo.update(id, data);

    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    return res.json({ app });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.update.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /apps/:id - Delete an app
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    const deleted = await appRepo.delete(id);

    if (!deleted) {
      return res.status(404).json({ error: 'App not found' });
    }

    return res.status(204).send();
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.delete.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/stop - Stop development server for an app
 */
router.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    // Server stopping is now handled by deployment adapters or main app service
    return res.status(501).json({
      error: 'Server stop operations have been moved to deployment adapters',
      message: 'Direct server control is no longer available through agents API'
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.server.stop.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/ensure-running - Ensure app is running (start if needed)
 */
router.post('/:id/ensure-running', async (req: Request, res: Response) => {
  // if running on nomad, return success as these should be managed from main application
  if (process.env.NOMAD_TASK_NAME) {
    return res.json({
      success: true,
      action: 'none',
      status: 'running',
      message: 'App is already running'
    });
  }
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const contextLogger = log.forApp(id);
    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    contextLogger.info('route.apps.ensure-running.check', {});

    // Get current app status
    const currentStatus = await appRepo.getAppStatus(id);
    contextLogger.info('route.apps.ensure-running.status', { status: currentStatus?.status });

    // Just return the current status - no building or starting
    return res.json({
      success: true,
      status: currentStatus?.status || 'unknown',
      message: currentStatus?.message || 'Status checked successfully',
      app: {
        id: app.id,
        name: app.name,
        path: app.path,
        port: app.port
      }
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.ensure-running.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/stop-all - Stop all running development servers
 */
router.post('/stop-all', async (req: Request, res: Response) => {
  // Server stopping is now handled by deployment adapters or main app service
  return res.status(501).json({
    error: 'Bulk server operations have been moved to deployment adapters',
    message: 'Use the main app service or deployment adapter APIs for bulk operations'
  });
});

/**
 * POST /apps/:id/restart - Restart development server for an app
 */
router.post('/:id/restart', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    // Use the server management tool for consistent restart behavior
    const serverTool = new ServerManagementTool();
    const restartResult = await serverTool.restartServer({ reason: 'Manual restart via API' }, id);
    const restarted = restartResult.success;

    if (!restarted) {
      return res.status(404).json({ error: 'App not found or failed to restart' });
    }

    return res.json({ success: true, message: `Server restarted for app ${id}` });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.server.restart.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/cleanup-orphans - Force cleanup of orphaned processes
 */
router.post('/cleanup-orphans', async (req: Request, res: Response) => {
  // Process cleanup is now handled by deployment adapters
  return res.status(501).json({
    error: 'Process cleanup operations have been moved to deployment adapters',
    message: 'Use the deployment adapter APIs for process management'
  });
});

/**
 * POST /apps/:id/force-cleanup - Force cleanup processes for a specific app
 */
router.post('/:id/force-cleanup', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    // App-specific cleanup is now handled by deployment adapters
    return res.status(501).json({
      error: 'App cleanup operations have been moved to deployment adapters',
      message: 'Use the deployment adapter APIs for app-specific cleanup'
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.force-cleanup.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id/files - List files in app directory
 */
router.get('/:id/files', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path, maxDepth } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const result = await directoryTool.listDirectory(app.path, {
      path: path as string,
      maxDepth: maxDepth ? parseInt(maxDepth as string) : 3,
      showHidden: false
    });

    return res.json(result);
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.files.list.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id/files/read - Read file content
 */
router.get('/:id/files/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path: filePath } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const result = await readFileTool.readFile({ path: filePath as string }, app.path);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    return res.json(result);
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.files.read.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/files/write - Write file content
 */
router.post('/:id/files/write', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path: filePath, content, mode } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'File path and content are required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const result = await fileEditTool.editFile(app.path, {
      path: filePath,
      content: content,
      mode: mode || 'rewrite',
      createDirs: true
    }, {
      appId: id
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json(result);
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.files.write.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/files/edit - Edit file with partial changes
 */
router.post('/:id/files/edit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path: filePath, edits } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    if (!filePath || !edits || !Array.isArray(edits)) {
      return res.status(400).json({ error: 'File path and edits array are required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const result = await fileEditTool.editFile(app.path, {
      path: filePath,
      mode: 'edit',
      edits: edits
    }, {
      appId: id
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json(result);
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.files.edit.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/text/edit - Edit text content in app files
 */
router.post('/:id/text/edit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { selector, preciseSelector, oldText, newText, devContext } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const contextLogger = log.forApp(id);

    if (!selector || !oldText || !newText || !devContext) {
      contextLogger.warn('route.apps.text-edit.validation.failed', {
        hasSelector: !!selector,
        hasPreciseSelector: !!preciseSelector,
        hasOldText: !!oldText,
        hasNewText: !!newText,
        hasDevContext: !!devContext,
        selector,
        preciseSelector,
        oldText: oldText?.substring(0, 100),
        newText: newText?.substring(0, 100),
        devContext,
      });
      return res.status(400).json({ error: 'Selector, oldText, newText, and devContext are required' });
    }

    // Validate devContext - required for AST-based editing
    if (!devContext || !devContext.fileName || !devContext.componentName || !devContext.lineNumber) {
      contextLogger.warn('route.apps.text-edit.devcontext.invalid', {
        hasDevContext: !!devContext,
        hasFileName: !!(devContext && devContext.fileName),
        hasComponentName: !!(devContext && devContext.componentName),
        hasLineNumber: !!(devContext && devContext.lineNumber),
        devContext,
      });
      return res.status(400).json({
        error: 'Invalid development context',
        details: 'AST-based text editing requires complete devContext with fileName, componentName, and lineNumber'
      });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Debug logging
    contextLogger.debug('route.apps.text-edit.request', {
      selector,
      oldText: oldText.substring(0, 50) + (oldText.length > 50 ? '...' : ''),
      newText: newText.substring(0, 50) + (newText.length > 50 ? '...' : ''),
      devContext,
    });

    contextLogger.info('route.apps.text-edit.begin', {
      fileName: devContext.fileName,
      lineNumber: devContext.lineNumber,
    });

    // Use AST text editor to make precise text changes
    const editResult = await astTextEditor.editElementText(app.path, {
      selector,
      preciseSelector,
      oldText,
      newText,
      devContext
    });

    if (!editResult.success) {
      contextLogger.error('route.apps.text-edit.failed', {
        error: editResult.error,
      });
      return res.status(400).json({
        error: 'Failed to edit text',
        details: editResult.error
      });
    }

    contextLogger.info('route.apps.text-edit.success', {});

    return res.json({
      success: true,
      message: 'Text updated successfully using AST',
      data: {
        selector,
        oldText: editResult.oldText,
        newText: editResult.newText,
        filePath: editResult.filePath,
        diff: editResult.diff,
        commitHash: editResult.commitHash // Include commit hash in response
      }
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.text-edit.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/styles/edit - Edit element styles in app files using AST
 */
router.post('/:id/styles/edit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { selector, property, value, newClassName, newStyle, elementInfo } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const contextLogger = log.forApp(id);

    if (!selector || !property || value === undefined) {
      contextLogger.warn('route.apps.style-edit.validation.failed', {
        selector: !!selector,
        property: !!property,
        value: value !== undefined,
      });
      return res.status(400).json({ error: 'Selector, property, and value are required' });
    }

    if (!elementInfo || !elementInfo.devContext) {
      contextLogger.warn('route.apps.style-edit.elementinfo.invalid', {
        hasElementInfo: !!elementInfo,
        hasDevContext: !!(elementInfo && elementInfo.devContext),
      });
      return res.status(400).json({ error: 'Element info with dev context is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Debug logging
    contextLogger.debug('route.apps.style-edit.request', {
      selector: selector || 'MISSING',
      property: property || 'MISSING',
      value: value !== undefined ? value : 'UNDEFINED',
      hasElementInfo: !!elementInfo,
      hasDevContext: !!(elementInfo && elementInfo.devContext),
      devContext: elementInfo?.devContext,
    });

    contextLogger.info('route.apps.style-edit.begin', {
      fileName: elementInfo.devContext.fileName,
      lineNumber: elementInfo.devContext.lineNumber,
      className: newClassName?.trim() || 'inline-styles',
    });

    // Use AST-based style editor to make the actual file changes
    const editResult = await astStyleEditor.editElementStyle(app.path, {
      selector,
      property,
      value,
      newClassName,
      newStyle,
      elementInfo
    });

    if (!editResult.success) {
      contextLogger.error('route.apps.style-edit.failed', {
        error: editResult.error,
      });
      return res.status(400).json({
        error: 'Failed to edit style',
        details: editResult.error
      });
    }

    return res.json({
      success: true,
      message: 'Style updated successfully',
      data: {
        selector,
        property,
        value,
        filePath: editResult.filePath,
        changes: editResult.changes,
        commitHash: editResult.commitHash
      }
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.style-edit.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id/usage - Get token usage summary for an app
 */
router.get('/:id/usage', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const usage = tokenUsageRepo.getUsageInfo(id);
    return res.json({ usage });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.usage.get.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id/usage/history - Get detailed token usage history for an app
 */
router.get('/:id/usage/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit, offset, operation, conversationId } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const options: any = {};
    if (limit) options.limit = parseInt(limit as string);
    if (offset) options.offset = parseInt(offset as string);
    if (operation) options.operation = operation;
    if (conversationId) options.conversationId = conversationId as string;

    const history = tokenUsageRepo.getUsageHistory(id, options);

    return res.json({ history });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.usage.history.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id/usage/stats - Get usage statistics by time period
 */
router.get('/:id/usage/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { period = 'day', limit = 30 } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const stats = tokenUsageRepo.getUsageByPeriod(
      id,
      period as 'day' | 'week' | 'month',
      parseInt(limit as string)
    );

    return res.json({ stats });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.usage.stats.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /apps/:id/usage - Delete all token usage records for an app
 */
router.delete('/:id/usage', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const deleted = tokenUsageRepo.deleteAppUsage(id);
    if (!deleted) {
      return res.status(404).json({ error: 'No usage records found' });
    }

    return res.json({ message: 'Usage records deleted successfully' });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.usage.delete.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/suggest-name - Generate a suggested name for a project based on prompt
 */
router.post('/suggest-name', async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required and must be a non-empty string' });
    }

    logger.info('route.apps.name-suggest.begin', {
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 100),
    });

    // Use the dedicated name suggestion service
    const nameSuggestionService = getNameSuggestionService();
    const suggestedName = await nameSuggestionService.suggestName(prompt.trim());

    if (!suggestedName) {
      throw new Error('Failed to generate name suggestion');
    }

    logger.info('route.apps.name-suggest.success', { suggestedName });

    return res.json({
      name: suggestedName,
      suggestedName: suggestedName,
      prompt: prompt.trim()
    });
  } catch (error) {
    log.error(logger, 'route.apps.name-suggest.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to generate name suggestion',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Docker-specific routes have been moved to the app service

export { router as appsRouter };

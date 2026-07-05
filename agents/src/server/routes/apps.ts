/**
 * Apps Routes - Basic CRUD Operations
 *
 * This file contains core app management endpoints (list, get, create, update, delete, etc.)
 *
 * IMPORTANT: This file has grown too large (1300+ lines).
 * When adding new routes, please create separate route files instead of adding to this file.
 * Examples of proper route separation:
 * - download.ts - App download/zip operations
 * - publish.ts - App publish operations
 * - git.ts - Git operations
 *
 * Keep this file focused on basic CRUD operations only.
 */

import path from 'node:path';
import { Router, Request, Response, IRouter } from 'express';

import multer from 'multer';
import { AppRepository } from '../../database/index.js';
import type { App, CreateAppRequest, UpdateAppRequest } from '../../database/index.js';
import { DirectoryListingTool, DirectoryListingNotFoundError } from '../../tools/directory-listing.js';
import { BINARY_FILE_REGEX } from '../../utils/file-types.js';
import { createForWorkspace } from '../../workspace/index.js';
import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import { GitUtils } from '../../utils/git.js';
import { fileExists } from '../../utils/fs-utils.js';
import { isAppInRebuildFlow } from '../../services/rebuild/validate-inline-font.js';
import { ASTStyleEditor } from '../../tools/ast-style-editor.js';
import { ASTTextEditor } from '../../tools/ast-text-editor.js';
import { TextFixAgent } from '../../agents/text-fix-agent.js';
import { astImageEditor } from '../../tools/ast-image-editor.js';
import { editContent } from '../../tools/content-editor.js';
import { mutateContent, type MutateRequest } from '../../tools/content-mutation.js';
import { conformPageToContentLayer } from '../../services/content-conform.js';
import { USER_EDITS_FILE } from '../../tools/content-user-edits.js';
import { astElementRemover } from '../../tools/ast-element-remover.js';
import { mediaManifestService } from '../../services/MediaManifestService.js';
import {
  parseImageSlotPath,
} from '../../utils/slot-reference-utils.js';

import { ServerManagementTool } from '../../tools/server-management-tool.js';
import { getNameSuggestionService } from '../../services/name-suggestion.js';
import { getDomainSeedSuggestionService } from '../../services/domain-seed-suggestion.js';
import { Logger, log } from '../../logging/index.js';
import { BYPASS_SITE_IDS, skills } from '../../services/features.js';
import { getProfileRegistry, runWithProfile } from '../../profiles/index.js';
import { isComplianceManagedPath, COMPLIANCE_MANAGED_WRITE_ERROR } from '../../skills/compliance-docs/managed-paths.js';
import { searchCode } from '../../utils/code-search.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { getScreenshotStore, type ScreenshotStore } from './screenshot-store.js';

const router: IRouter = Router();

const appRepo = new AppRepository();

/**
 * Whether the compliance-docs skill is available for the request's agent profile.
 * Routes don't run inside a profile ALS context, so resolve the profile from the
 * JWT and evaluate the canonical predicate inside `runWithProfile`. Safe default
 * is false (can't determine → don't block) so non-compliance apps are unaffected.
 */
function complianceSkillAvailable(req: Request): boolean {
  const profileName = (req as AuthenticatedRequest).agentContext?.agentProfile;
  if (!profileName) return false;
  const profile = getProfileRegistry().get(profileName);
  if (!profile) return false;
  return runWithProfile(profile, () => skills.isEnabled('complianceDocs'));
}
const astStyleEditor = new ASTStyleEditor();
const astTextEditor = new ASTTextEditor();

const logger = Logger.create({ component: 'apps-routes' });

async function commitContentFile(
  appId: string,
  appPath: string,
  relPath: string,
  contentKey: string,
  contextLogger: ReturnType<typeof log.forApp>,
  routeLabel: 'content-edit' | 'content-mutate' = 'content-edit',
): Promise<string | undefined> {
  try {
    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) return undefined;
    const gitUtils = new GitUtils(workspace.tasks);
    // Commit the user-edit provenance lock in the SAME commit as the content
    // file so the recorded lock travels with the edit it protects. The lock is
    // only present on the CMS inline-edit path, so guard on existence — a
    // non-CMS edit (or the very first edit before the lock is written) must
    // not fail the commit.
    const lockRelPath = path.join('src', 'content', USER_EDITS_FILE);
    const includeLock = await fileExists(path.join(appPath, lockRelPath));
    const filesToCommit = includeLock ? [relPath, lockRelPath] : [relPath];
    // A no-op (serialized value already matches disk, e.g. focus/blur with no
    // real change) returns false rather than failing. The edit succeeded — disk
    // is already correct — so log at info (not commit-failed) and still return
    // the current SHA. commitFilesIfChanged detects this structurally via
    // `git status --porcelain`, so it doesn't depend on git's localized output.
    const committed = await gitUtils.commitFilesIfChanged(appPath, `Update content: ${contentKey}`, filesToCommit);
    if (!committed) {
      contextLogger.info(`route.apps.${routeLabel}.no-op`, {
        appId, relPath,
        message: 'edit value unchanged, nothing to commit',
      });
    }
    return await gitUtils.getCurrentCommit(appPath);
  } catch (error) {
    contextLogger.warn(`route.apps.${routeLabel}.commit-failed`, {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * GET /apps - List all apps (scoped to authenticated user's siteId)
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;

    // Ensure authentication context exists
    if (!authReq.agentContext || !authReq.agentContext.siteId) {
      return res.status(401).json({
        error: 'Authentication required',
        requiresAuth: true,
      });
    }

    const authenticatedSiteId = authReq.agentContext.siteId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    // SECURITY: Only return apps belonging to authenticated siteId
    // unless it's a bypass site (for dev/testing)
    const isBypassSite = BYPASS_SITE_IDS.includes(authenticatedSiteId);
    // Non-bypass sites own at most their own app (app.id === siteId). Wrap the
    // single lookup in an array so the response shape matches the bypass branch.
    const apps: App[] = isBypassSite
      ? appRepo.findAll(limit, offset)
      : [appRepo.findById(authenticatedSiteId)].filter(
          (app): app is App => app !== null,
        );

    const totalCount = isBypassSite
      ? appRepo.count()
      : appRepo.countBySiteId(authenticatedSiteId);

    const totalPages = Math.ceil(totalCount / limit);

    return res.json({
      apps,
      pagination: {
        page,
        limit,
        total: totalCount,
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
 * SECURITY: Apply ownership validation to all routes with :id parameter.
 *
 * This middleware protects against cross-tenant access where an attacker with valid
 * credentials for Site A attempts to access Site B's app by changing the :id parameter.
 *
 * Placement: MUST be before any :id routes to protect them.
 *
 * Regex pattern: strictly matches the canonical appId shape — a 10-char lowercase
 * nanoid (e.g. "jm2t5p2rxr"). Both production and local-control-plane issue this
 * format. Static routes like /create, /register, /servers do not match this
 * pattern and are handled by their specific route definitions above.
 */
router.use(
  '/:id([a-z0-9]{10})',
  validateAppOwnership
);

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
    const { siteId, name, appPath, port, initialPrompt, previewUrl, socketPath, publishSupervisorPath, subscriptionId, customerId } = req.body;

    logger.info('route.apps.register.request', {
      siteId,
      name,
      hasAppPath: !!appPath,
      hasPort: !!port,
      customerId: customerId || 'not-provided',
      subscriptionId: subscriptionId || 'not-provided'
    });

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

    if (socketPath !== undefined && typeof socketPath !== 'string') {
      return res.status(400).json({ error: 'socketPath must be a string if provided' });
    }

    if (publishSupervisorPath !== undefined && typeof publishSupervisorPath !== 'string') {
      return res.status(400).json({ error: 'publishSupervisorPath must be a string if provided' });
    }

    if (subscriptionId !== undefined && (typeof subscriptionId !== 'string' || subscriptionId.trim().length === 0)) {
      return res.status(400).json({ error: 'subscriptionId must be a non-empty string if provided' });
    }

    if (customerId !== undefined && (typeof customerId !== 'string' || customerId.trim().length === 0)) {
      return res.status(400).json({ error: 'customerId must be a non-empty string if provided' });
    }

    const result = await appRepo.registerOrUpdateApp({
      siteId,
      name,
      appPath,
      port,
      initialPrompt,
      previewUrl,
      socketPath,
      publishSupervisorPath,
      subscriptionId,
      customerId
    });

    return res.status(result.created ? 201 : 200).json(result);

  } catch (error) {
    log.error(logger, 'route.apps.register.error', error as Error, {});

    if (error instanceof Error && error.message.includes('mismatch')) {
      const [errorType, ...messageParts] = error.message.split(': ');
      return res.status(403).json({
        error: errorType,
        message: messageParts.join(': ')
      });
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

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(503).json({ error: 'App workspace is not available' });
    }

    const directoryTool = new DirectoryListingTool(workspace.files);
    const result = await directoryTool.listDirectory({
      path: path as string,
      maxDepth: maxDepth ? parseInt(maxDepth as string) : 3,
      showHidden: false
    });

    return res.json(result);
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.files.list.error', error as Error, {});
    if (error instanceof DirectoryListingNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof DevSupervisorError) {
      if (error.code === 'permission_denied') {
        return res.status(403).json({ error: error.message });
      }
      return res.status(503).json({ error: 'Workspace temporarily unavailable' });
    }
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

    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'File path is required' });
    }

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(404).json({ error: 'App not found' });
    }

    if (BINARY_FILE_REGEX.test(filePath)) {
      return res.status(422).json({
        error: 'Binary file — not readable as text',
        path: filePath,
      });
    }

    const content: string = await workspace.files.readText({ path: filePath });

    return res.json({
      success: true,
      path: filePath,
      content,
      totalLines: content.split('\n').length,
      truncated: false,
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    const requestedPath = typeof req.query.path === 'string' ? req.query.path : undefined;
    // Mirror the files/list route's error mapping: a missing file is a 404, not a
    // 500, so callers (e.g. rebuild "View source") can treat benign absence as the
    // empty state rather than a hard error. Only genuine failures are logged.
    if (error instanceof DevSupervisorError) {
      if (error.code === 'not_found') {
        return res.status(404).json({ error: 'File not found' });
      }
      if (error.code === 'permission_denied') {
        return res.status(403).json({ error: error.message });
      }
      log.error(contextLogger, 'route.apps.files.read.error', error as Error, {
        path: requestedPath,
        code: error.code,
        statusCode: error.statusCode,
      });
      return res.status(503).json({ error: 'Workspace temporarily unavailable' });
    }
    log.error(contextLogger, 'route.apps.files.read.error', error as Error, { path: requestedPath });
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

    const appPath = appRepo.findById(id)?.path;
    if (appPath && isComplianceManagedPath(filePath) && complianceSkillAvailable(req)) {
      return res.status(403).json({ error: COMPLIANCE_MANAGED_WRITE_ERROR });
    }

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not available' });
    }

    if (mode === 'create') {
      try {
        const writeResult = await workspace.files.write({ path: filePath, content, createOnly: true });
        return res.json({ success: true, path: filePath, mode: 'create', bytesWritten: writeResult.bytesWritten });
      } catch (createErr) {
        if (createErr instanceof DevSupervisorError && createErr.code === 'file_exists') {
          return res.status(409).json({ error: `File already exists: ${filePath}` });
        }
        throw createErr;
      }
    }

    const writeResult = await workspace.files.write({ path: filePath, content });
    return res.json({ success: true, path: filePath, mode: mode || 'rewrite', bytesWritten: writeResult.bytesWritten });
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

    const appPath = appRepo.findById(id)?.path;
    if (appPath && isComplianceManagedPath(filePath) && complianceSkillAvailable(req)) {
      return res.status(403).json({ error: COMPLIANCE_MANAGED_WRITE_ERROR });
    }

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not available' });
    }

    const results: Array<{ old: string; applied: number; error?: string }> = [];
    for (const edit of edits) {
      try {
        const editResult = await workspace.files.edit({
          path: filePath,
          oldString: edit.old,
          newString: edit.new,
        });
        results.push({ old: edit.old, applied: editResult.applied });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ old: edit.old, applied: 0, error: msg });
      }
    }

    const allSucceeded = results.every(r => r.applied > 0);
    return res.json({
      success: allSucceeded,
      path: filePath,
      mode: 'edit',
      edits: results,
      ...(allSucceeded ? {} : { error: 'Some edits failed' }),
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.files.edit.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/files/search - Search code in app files
 */
router.post('/:id/files/search', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { query, caseSensitive, regex, maxResults, filePattern } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const contextLogger = log.forApp(id);
    contextLogger.info('code-search.request', {
      message: 'Code search requested',
      query: query.substring(0, 100),
      caseSensitive,
      regex,
      maxResults
    });

    const searchOptions: {
      caseSensitive: boolean
      regex: boolean
      maxResults: number
      filePattern?: string
    } = {
      caseSensitive: caseSensitive === true,
      regex: regex === true,
      maxResults: maxResults || 100
    };

    if (filePattern && typeof filePattern === 'string') {
      searchOptions.filePattern = filePattern;
    }

    const result = await searchCode(id, app.path, query, searchOptions);

    contextLogger.info('code-search.complete', {
      message: 'Code search completed',
      matchCount: result.totalMatches,
      truncated: result.truncated
    });

    return res.json(result);
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.files.search.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/text/edit - Edit text content in app files
 */
router.post('/:id/text/edit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { selector, preciseSelector, oldText, newText, newHtml, devContext } = req.body;

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
      newHtml,
      devContext
    }, id);

    if (!editResult.success) {
      contextLogger.error('route.apps.text-edit.failed', {
        error: editResult.error,
        fileName: devContext.fileName,
        lineNumber: devContext.lineNumber,
        componentName: devContext.componentName,
        selector: selector?.substring(0, 200),
        preciseSelector: preciseSelector?.substring(0, 200),
        oldText: oldText?.substring(0, 200),
        newText: newText?.substring(0, 200),
        ...astTextEditor.lastDiagnostics,
      });
      return res.status(400).json({
        error: 'Failed to edit text',
        details: editResult.error,
        code: editResult.code,
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
 * POST /apps/:id/text/fix - Run a typo/grammar correction over the supplied text.
 *
 * Pure transformation — does NOT write to disk. Returns `{newText, changed}` so
 * the client can render a diff preview and the user can confirm before the
 * actual file edit goes through the existing `/text/edit` endpoint.
 */
/**
 * Hard cap on `oldText` to bound LLM cost and avoid output-token truncation.
 * 8000 chars covers any realistic visible UI element (a hero block is ~1k);
 * paired with `maxOutputTokens: 4000` in TextFixAgent, the model has headroom
 * for the JSON envelope without truncating mid-string.
 */
const MAX_FIX_INPUT_LENGTH = 8000;

router.post('/:id/text/fix', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { oldText } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    if (typeof oldText !== 'string' || !oldText.trim()) {
      return res.status(400).json({ error: 'oldText is required' });
    }

    if (oldText.length > MAX_FIX_INPUT_LENGTH) {
      return res.status(400).json({
        error: `oldText exceeds maximum length of ${MAX_FIX_INPUT_LENGTH} characters`,
      });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const contextLogger = log.forApp(id);
    contextLogger.info('route.apps.text-fix.begin', { textLength: oldText.length });

    const agent = new TextFixAgent();
    let result;
    try {
      await agent.initialize();
      result = await agent.correct(oldText);
    } finally {
      await agent.cleanup();
    }

    contextLogger.info('route.apps.text-fix.success', { changed: result.changed });

    return res.json({
      success: true,
      data: {
        newText: result.newText,
        changed: result.changed,
      },
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.text-fix.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/content/edit - Edit a field in the content layer (src/content/**).
 * Body: { contentKey: string, kind: 'copy' | 'richText', value: string }
 */
router.post('/:id/content/edit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ ok: false, error: { code: 'invalid-key', message: 'App ID is required' } });
    }
    const { contentKey, kind, value, expectedCurrent } = req.body ?? {};
    const contextLogger = log.forApp(id);

    if (typeof contentKey !== 'string' || typeof value !== 'string' || (kind !== 'copy' && kind !== 'richText')) {
      contextLogger.warn('route.apps.content-edit.validation.failed', {
        hasContentKey: typeof contentKey === 'string', kind, hasValue: typeof value === 'string',
      });
      return res.status(400).json({
        ok: false,
        error: { code: 'invalid-value', message: 'contentKey (string), kind ("copy"|"richText"), and value (string) are required' },
      });
    }

    if (expectedCurrent !== undefined && typeof expectedCurrent !== 'string') {
      contextLogger.warn('route.apps.content-edit.validation.failed', { expectedCurrentType: typeof expectedCurrent });
      return res.status(400).json({
        ok: false,
        error: { code: 'invalid-value', message: 'expectedCurrent, when present, must be a string' },
      });
    }

    const app = appRepo.findById(id);
    if (!app) {
      contextLogger.warn('route.apps.content-edit.app-not-found', { appId: id });
      return res.status(404).json({ ok: false, error: { code: 'app-not-found', message: 'App not found' } });
    }

    const contentDir = path.join(app.path, 'src', 'content');
    const result = await editContent(contentDir, { contentKey, kind, value, expectedCurrent });

    if (!result.ok) {
      contextLogger.warn('route.apps.content-edit.rejected', { contentKey, kind, errorCode: result.error.code });
      return res.status(400).json(result);
    }

    const commitHash = await commitContentFile(id, app.path, path.relative(app.path, result.file), contentKey, contextLogger);
    contextLogger.info('route.apps.content-edit.success', { contentKey, kind, file: result.file, commitHash });
    return res.json({ ...result, ...(commitHash ? { commitHash } : {}) });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.content-edit.error', error as Error, {});
    return res.status(500).json({ ok: false, error: { code: 'internal-error', message: 'Internal server error' } });
  }
});

/**
 * POST /apps/:id/content/mutate - Insert / remove / reorder items in a content
 * collection (src/content/**) by stable id. Deterministic canvas path, parallel
 * to /content/edit. Body: { op, collectionKey, item?/afterId? | itemId | order }.
 */
router.post('/:id/content/mutate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ ok: false, error: { code: 'invalid-key', message: 'App ID is required' } });
    }
    const { op, collectionKey, item, afterId, itemId, order } = req.body ?? {};
    const contextLogger = log.forApp(id);

    if ((op !== 'insert' && op !== 'remove' && op !== 'reorder') || typeof collectionKey !== 'string') {
      contextLogger.warn('route.apps.content-mutate.validation.failed', { op, hasCollectionKey: typeof collectionKey === 'string' });
      return res.status(400).json({
        ok: false,
        error: { code: 'invalid-value', message: 'op ("insert"|"remove"|"reorder") and collectionKey (string) are required' },
      });
    }

    const app = appRepo.findById(id);
    if (!app) {
      contextLogger.warn('route.apps.content-mutate.app-not-found', { appId: id });
      return res.status(404).json({ ok: false, error: { code: 'app-not-found', message: 'App not found' } });
    }

    const contentDir = path.join(app.path, 'src', 'content');
    const result = await mutateContent(contentDir, { op, collectionKey, item, afterId, itemId, order } as MutateRequest);

    if (!result.ok) {
      contextLogger.warn('route.apps.content-mutate.rejected', { op, collectionKey, errorCode: result.error.code });
      return res.status(400).json(result);
    }

    const commitHash = await commitContentFile(id, app.path, path.relative(app.path, result.file), collectionKey, contextLogger, 'content-mutate');
    contextLogger.info('route.apps.content-mutate.success', { op, collectionKey, file: result.file, id: result.id, commitHash });
    return res.json({ ...result, ...(commitHash ? { commitHash } : {}) });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.content-mutate.error', error as Error, {});
    return res.status(500).json({ ok: false, error: { code: 'internal-error', message: 'Internal server error' } });
  }
});

/**
 * POST /apps/:id/content/conform-page - Run the on-edit heal conform for a named page.
 * Body: { page: string } — must match `src/pages/<name>.tsx`.
 * Returns: { ok: true, applied: boolean } | { ok: false, error: { code, message } }.
 *
 * This route is ADDITIVE — it is not consumed by the paas BFF and does not
 * change any existing route shape. Protected by the `validateAppOwnership`
 * middleware already applied via `router.use('/:id([a-z0-9]{10})', ...)`.
 */
router.post('/:id/content/conform-page', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ ok: false, error: { code: 'invalid-key', message: 'App ID is required' } });
    }
    const { page, conformId } = req.body ?? {};
    const contextLogger = log.forApp(id);
    if (typeof page !== 'string' || !/^src\/pages\/[^/]+\.tsx$/.test(page)) {
      return res.status(400).json({
        ok: false,
        error: { code: 'invalid-value', message: 'page (src/pages/*.tsx) is required' },
      });
    }
    // conformId is optional (older dev-tools omit it → S1 batch fallback). When
    // present it MUST be a declarator loc-id (`L<line>C<col>`) — reject a
    // malformed value rather than pass it through to a silent no-match decline.
    if (conformId !== undefined && (typeof conformId !== 'string' || !/^L\d+C\d+$/.test(conformId))) {
      return res.status(400).json({
        ok: false,
        error: { code: 'invalid-value', message: 'conformId, when present, must match L<line>C<col>' },
      });
    }
    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ ok: false, error: { code: 'app-not-found', message: 'App not found' } });
    }
    const outcome = await conformPageToContentLayer({
      appId: id,
      appPath: app.path,
      fullPath: path.join(app.path, page),
      command: 'str_replace',
      isPageCreate: false,
      trigger: 'heal',
      conformId,
    });
    const applied: boolean = outcome.note !== null;
    contextLogger.info('route.apps.conform-page.done', {
      page,
      applied,
      ...(outcome.declineReason ? { reason: outcome.declineReason } : {}),
    });
    return res.json({
      ok: true,
      applied,
      ...(outcome.declineReason ? { reason: outcome.declineReason } : {}),
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.conform-page.error', error as Error, {});
    return res.status(500).json({ ok: false, error: { code: 'internal-error', message: 'Internal server error' } });
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

    // Use AST-based style editor to make the actual file changes.
    // Pass appId so editTemplate fires per-app git commits on success —
    // without it the commit step silently skips and Hover Bar edits leave
    // uncommitted changes in the working tree.
    const editResult = await astStyleEditor.editElementStyle(app.path, {
      selector,
      property,
      value,
      newClassName,
      newStyle,
      elementInfo,
      isRebuildFlow: await isAppInRebuildFlow(app.id),
    }, app.id);

    if (!editResult.success) {
      contextLogger.error('route.apps.style-edit.failed', {
        error: editResult.error,
        fileName: elementInfo.devContext.fileName,
        lineNumber: elementInfo.devContext.lineNumber,
        componentName: elementInfo.devContext.componentName,
        selector: selector?.substring(0, 200),
        property,
        value: value?.substring(0, 200),
        tagName: elementInfo.tagName,
        className: elementInfo.className?.substring(0, 200),
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
 * POST /apps/:id/images/replace - Replace image using AST-based approach
 */
router.post('/:id/images/replace', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { elementInfo, imageInfo, newImageUrl } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const contextLogger = log.forApp(id);

    if (!elementInfo || !elementInfo.devContext) {
      contextLogger.warn('route.apps.image-replace.validation.failed', {
        hasElementInfo: !!elementInfo,
        hasDevContext: !!(elementInfo && elementInfo.devContext),
      });
      return res.status(400).json({ error: 'Element info with dev context is required' });
    }

    if (!imageInfo || !imageInfo.type) {
      contextLogger.warn('route.apps.image-replace.imageinfo.invalid', {
        hasImageInfo: !!imageInfo,
        hasType: !!(imageInfo && imageInfo.type),
      });
      return res.status(400).json({ error: 'Image info with type is required' });
    }

    if (!newImageUrl) {
      contextLogger.warn('route.apps.image-replace.url.missing', {});
      return res.status(400).json({ error: 'New image URL is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    contextLogger.info('route.apps.image-replace.begin', {
      fileName: elementInfo.devContext.fileName,
      lineNumber: elementInfo.devContext.lineNumber,
      imageType: imageInfo.type,
      newImageUrl,
    });

    // If the current image uses a slot URL, update the manifest instead of
    // rewriting the source code. When the slot path is shared across multiple
    // records (e.g. data collections), fork a new manifest entry for this element.
    const slotName = parseImageSlotPath(imageInfo.currentUrl);
    if (slotName) {
      contextLogger.info('route.apps.image-replace.slot-detected', {
        slotName,
        newImageUrl,
      });

      const replaceResult = await mediaManifestService.updateSlotOrFork(id, slotName, {
        newUrl: newImageUrl,
        updateOptions: { markUserModified: true },
        forkContext: {
          devContext: elementInfo.devContext,
          elementInfo,
          imageInfo,
          selector: elementInfo.selector,
        },
      });

      if (replaceResult.success) {
        if (replaceResult.forked) {
          contextLogger.info('route.apps.image-replace.slot-forked', {
            originalSlotPath: replaceResult.originalSlotPath,
            slotPath: replaceResult.slotPath,
            commitHash: replaceResult.commitHash,
          });

          return res.json({
            success: true,
            message: 'Shared slot forked and image updated via manifest',
            data: {
              slotPath: replaceResult.slotPath,
              originalSlotPath: replaceResult.originalSlotPath,
              commitHash: replaceResult.commitHash,
            },
          });
        }

        contextLogger.info('route.apps.image-replace.slot-updated', {
          slotName,
          commitHash: replaceResult.commitHash,
        });

        return res.json({
          success: true,
          message: 'Slot image updated via manifest',
          data: {
            slotPath: slotName,
            commitHash: replaceResult.commitHash,
          },
        });
      }

      contextLogger.warn('route.apps.image-replace.slot-update-failed', {
        slotName,
        attemptedFork: replaceResult.attemptedFork,
        error: replaceResult.error,
      });
    }

    const replaceResult = await astImageEditor.replaceImage(app.path, {
      elementInfo,
      imageInfo,
      newImageUrl
    }, id);

    if (!replaceResult.success) {
      contextLogger.warn('route.apps.image-replace.ast-failed', {
        error: replaceResult.error,
        fileName: elementInfo.devContext.fileName,
        lineNumber: elementInfo.devContext.lineNumber,
        componentName: elementInfo.devContext.componentName,
        imageType: imageInfo.type,
        currentUrl: imageInfo.currentUrl?.substring(0, 200),
        newImageUrl: newImageUrl?.substring(0, 200),
      });
      return res.status(400).json({
        success: false,
        error: 'AST-based image replacement failed',
        details: replaceResult.error,
        fallbackRequired: true
      });
    }

    contextLogger.info('route.apps.image-replace.success', {
      oldUrl: replaceResult.changes?.oldUrl,
      newUrl: replaceResult.changes?.newUrl,
      imageType: replaceResult.changes?.imageType,
    });

    return res.json({
      success: true,
      message: 'Image replaced successfully',
      data: {
        filePath: replaceResult.filePath,
        changes: replaceResult.changes,
        commitHash: replaceResult.commitHash
      }
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.image-replace.error', error as Error, {});
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      fallbackRequired: true
    });
  }
});


/**
 * POST /apps/:id/elements/remove - Remove a single image/video element from app files using AST
 */
router.post('/:id/elements/remove', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { selector, preciseSelector, isVideo, elementInfo } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const contextLogger = log.forApp(id);

    if (!elementInfo || !elementInfo.devContext) {
      contextLogger.warn('route.apps.element-remove.validation.failed', {
        hasElementInfo: !!elementInfo,
        hasDevContext: !!(elementInfo && elementInfo.devContext),
      });
      return res.status(400).json({ error: 'Element info with dev context is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    contextLogger.info('route.apps.element-remove.begin', {
      fileName: elementInfo.devContext.fileName,
      lineNumber: elementInfo.devContext.lineNumber,
      tagName: elementInfo.tagName,
      isVideo: !!isVideo,
    });

    const editResult = await astElementRemover.removeElement(app.path, {
      selector,
      preciseSelector,
      isVideo,
      elementInfo,
    }, app.id);

    if (!editResult.success) {
      contextLogger.warn('route.apps.element-remove.failed', {
        error: editResult.error,
        fileName: elementInfo.devContext.fileName,
        lineNumber: elementInfo.devContext.lineNumber,
        componentName: elementInfo.devContext.componentName,
        tagName: elementInfo.tagName,
      });
      return res.status(400).json({
        error: 'Failed to remove element',
        details: editResult.error,
      });
    }

    contextLogger.info('route.apps.element-remove.success', {
      filePath: editResult.filePath,
      tagName: editResult.changes?.tagName,
      commitHash: editResult.commitHash,
    });

    return res.json({
      success: true,
      message: 'Element removed successfully',
      data: {
        filePath: editResult.filePath,
        changes: editResult.changes,
        commitHash: editResult.commitHash,
      },
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.element-remove.error', error as Error, {});
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

/**
 * POST /apps/suggest-domain-seeds - Generate up to 4 brandable domain seeds for a business description
 */
router.post('/suggest-domain-seeds', async (req: Request, res: Response) => {
  try {
    const rawPrompt: unknown = req.body.prompt;

    if (!rawPrompt || typeof rawPrompt !== 'string' || rawPrompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required and must be a non-empty string' });
    }

    const trimmedPrompt = rawPrompt.trim();

    if (trimmedPrompt.length === 0) {
      return res.status(400).json({ error: 'Prompt is required and must be a non-empty string' });
    }

    logger.info('route.apps.domain-seeds.begin', {
      promptLength: trimmedPrompt.length,
      promptPreview: trimmedPrompt.substring(0, 100),
    });

    const service = getDomainSeedSuggestionService();
    // Intentionally no executionContext — LLM cost is platform-borne, not customer-attributed.
    const seeds = await service.suggestDomainSeeds(trimmedPrompt);

    if (seeds === null) {
      logger.error('route.apps.domain-seeds.error', { reason: 'service-returned-null' });
      return res.status(500).json({ error: 'Failed to generate domain seed suggestions' });
    }

    logger.info('route.apps.domain-seeds.success', { seedsCount: seeds.length });

    return res.json({ seeds });
  } catch (error) {
    // Log full error server-side; do not return error.message in the body
    // since Vercel AI SDK errors can occasionally embed provider URLs.
    log.error(logger, 'route.apps.domain-seeds.error', error as Error, {});
    return res.status(500).json({ error: 'Failed to generate domain seed suggestions' });
  }
});

/**
 * GET /apps/:id/screenshot - Get app screenshot
 *
 * Storage is selected by getScreenshotStore():
 * - Host-backed (SCREENSHOT_DIR set, or preview-basename app path): served via
 *   res.sendFile for zero-copy streaming.
 * - Workspace-backed (all other apps): read through the Workspace API and
 *   returned as a buffered PNG response.
 */
router.get('/:id/screenshot', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const store: ScreenshotStore = getScreenshotStore(app);
    const hostPath: string | null = store.resolvePath(id);

    if (hostPath) {
      // Host-backed store — use sendFile for efficient streaming
      if (!(await store.exists(id))) {
        return res.status(404).json({ error: 'Screenshot not found' });
      }
      return res.sendFile(hostPath);
    }

    // Workspace-backed store — read buffer and send
    try {
      const buffer: Buffer = await store.read(id);
      return res.set('Content-Type', 'image/png').send(buffer);
    } catch (readError: unknown) {
      if (readError instanceof DevSupervisorError && readError.code === 'not_found') {
        return res.status(404).json({ error: 'Screenshot not found' });
      }
      const contextLogger = log.forApp(id);
      log.error(contextLogger, 'route.apps.screenshot.get.workspaceReadFailed', readError as Error, { appId: id });
      return res.status(502).json({ error: 'Screenshot storage unavailable' });
    }
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.screenshot.get.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/screenshot - Upload app screenshot
 * Accepts a PNG file and saves it with appId prefix
 * Uses SCREENSHOT_DIR environment variable if set, otherwise saves to the local
 * agent directory for preview workspaces or the app directory.
 */
const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG images are allowed'));
    }
  }
});

router.post('/:id/screenshot', upload.single('screenshot'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Screenshot file is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const store = getScreenshotStore(app);
    const { location } = await store.write(id, req.file.buffer);

    logger.info('route.apps.screenshot.upload.success', {
      appId: id,
      size: req.file.size,
      path: location,
    });

    return res.json({ success: true, path: location });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : logger;
    log.error(contextLogger, 'route.apps.screenshot.upload.error', error as Error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Docker-specific routes have been moved to the app service

export { router as appsRouter };

/**
 * Download Route
 *
 * Handles app download/zip operations with JWT-based authorization.
 * Requires canDownload permission in JWT claims (Airo Plus subscription).
 *
 * The zip is assembled server-side by dev-supervisor (WorkspaceFiles.archive)
 * and streamed straight through this route — no per-file size cap, no in-memory
 * buffering of file contents in the agent.
 */

import { Router, Request, Response } from 'express';
import { AppRepository } from '../../database/index.js';
import { Logger, log } from '../../logging/index.js';
import { ALLOWED_DIRECTORIES, ALLOWED_CONFIG_FILES } from '../../config/app-download.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { requirePermission } from '../middleware/require-permission.js';
import { createForWorkspace } from '../../workspace/index.js';

const router: Router = Router();
const appRepo = new AppRepository();
const logger = Logger.create({ component: 'download-routes' });

type NameStyle = 'appId' | 'name';

/**
 * Build the zip's base name, used for both Content-Disposition and the
 * top-level folder inside the archive.
 *
 * - `appId` style → `appId_<id>_<friendlyName>` (or `appId_<id>` if name empty);
 *    used by internal tools (debug-console) where the id is the primary key.
 * - `name` style → `<friendlyName>` (or `app-<id>` if name empty); used by the
 *    customer-facing download path.
 */
function buildBaseName(id: string, rawName: string | null | undefined, style: NameStyle): string {
  const friendlyName = (rawName ?? '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (style === 'appId') {
    return friendlyName ? `appId_${id}_${friendlyName}` : `appId_${id}`;
  }
  return friendlyName || `app-${id}`;
}

/**
 * GET /apps/:id/zip - Stream a zip archive of the user-facing app files.
 *
 * dev-supervisor walks the allowlisted dirs/files on the workspace filesystem
 * and streams the zip; this route proxies that stream to the client.
 */
router.get('/apps/:id/zip', validateAppOwnership, requirePermission('canDownload'), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const contextLogger = log.forApp(id);

  try {
    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      log.error(contextLogger, 'route.apps.zip.failure', new Error('Workspace unavailable'), {
        appId: id,
        reason: 'workspace_unavailable',
      });
      return res.status(503).json({
        error: 'App workspace is not available',
        details: 'The app preview is not running. Start the preview and try again.',
      });
    }

    const nameStyle: NameStyle = req.query.nameStyle === 'appId' ? 'appId' : 'name';
    const baseName = buildBaseName(id, app.name, nameStyle);

    logger.info('route.apps.zip.begin', { appId: id, includedDirs: ALLOWED_DIRECTORIES });

    // archive() resolves once dev-supervisor has responded 2xx and started
    // streaming. A pre-stream failure (path validation, supervisor down)
    // rejects here BEFORE we touch the response, so we can still send a clean
    // JSON error.
    const result = await workspace.files.archive({
      dirs: [...ALLOWED_DIRECTORIES],
      files: [...ALLOWED_CONFIG_FILES],
      prefix: baseName,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);

    // Each request logs exactly one terminal outcome — success, stream failure,
    // or client disconnect — whichever fires first.
    let settled = false;
    const settle = (emit: () => void): void => {
      if (settled) return;
      settled = true;
      emit();
    };

    result.stream.on('error', (err: Error) => {
      // Failure after headers were sent — destroy the socket so the client sees
      // a truncated transfer, not a structurally-valid (but incomplete) zip.
      settle(() => log.error(contextLogger, 'route.apps.zip.stream.failure', err, { appId: id }));
      res.destroy(err);
    });

    // 'finish' fires once the whole response has been flushed to the client —
    // the accurate success signal. The source stream's 'end' fires earlier
    // (before the bytes are flushed) and never fires at all on a disconnect.
    res.on('finish', () => {
      settle(() => logger.info('route.apps.zip.success', { appId: id }));
    });

    res.on('close', () => {
      if (!res.writableFinished) {
        // Client went away before the response finished (e.g. the browser tab
        // closed). Release the upstream dev-supervisor connection so it doesn't
        // drain in the background, and record it — a disconnect is neither a
        // success nor a server error.
        result.stream.destroy();
        settle(() => logger.warn('route.apps.zip.aborted', { appId: id, reason: 'client_disconnected' }));
      }
    });

    result.stream.pipe(res);
    return;
  } catch (error) {
    log.error(contextLogger, 'route.apps.zip.failure', error as Error, {
      appId: id,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      reason: 'unexpected_error',
    });

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Failed to create zip archive',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    res.destroy(error as Error);
    return;
  }
});

export default router;

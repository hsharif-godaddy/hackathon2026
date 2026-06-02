/**
 * Download Route
 *
 * Handles app download/zip operations with JWT-based authorization.
 * Requires canDownload permission in JWT claims (Airo Plus subscription).
 */

import { Router, Request, Response } from 'express';
import archiver from 'archiver';
import { AppRepository } from '../../database/index.js';
import { Logger, log } from '../../logging/index.js';
import { ALLOWED_DIRECTORIES, ALLOWED_CONFIG_FILES } from '../../config/app-download.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { requirePermission } from '../middleware/require-permission.js';
import { createForWorkspace, type WorkspaceClient } from '../../workspace/index.js';
import { isDevSupervisorNotFound } from '../../services/DevSupervisorClient.js';

const router: Router = Router();
const appRepo = new AppRepository();
const logger = Logger.create({ component: 'download-routes' });

/** Concurrent dev-supervisor downloads. Bounded so peak memory stays at ~CAP buffers. */
const DOWNLOAD_CONCURRENCY = 8;

/**
 * Run `worker` for each item with at most `cap` in flight at once.
 * Used to bound concurrent dev-supervisor downloads.
 */
async function withConcurrency<T>(
  items: readonly T[],
  cap: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(cap, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) break;
        await worker(item);
      }
    }),
  );
}

/**
 * GET /apps/:id/zip - Stream a zip archive of the user-facing app files.
 *
 * The archive is assembled by walking the workspace via dev-supervisor
 * (WorkspaceFiles.tree + WorkspaceFiles.download). The agent process no
 * longer reads the host filesystem directly.
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

    logger.info('route.apps.zip.begin', {
      appId: id,
      includedDirs: ALLOWED_DIRECTORIES,
    });

    // Walk each allowlisted directory in parallel.
    // Each tree() call is bounded by dev-supervisor's defaultMaxEntries (1000).
    const dirResults = await Promise.all(
      ALLOWED_DIRECTORIES.map((dir) => listDirectoryFiles(workspace, dir, id)),
    );
    const filePaths = [...dirResults.flat(), ...ALLOWED_CONFIG_FILES];

    const rawName = app.name || id;
    const safeName = rawName.replace(/[^a-zA-Z0-9 ]/g, '').trim() || id;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    let archiveError: Error | null = null;
    archive.on('warning', (err) => {
      logger.warn('route.apps.zip.archive.warning', {
        appId: id,
        code: (err as { code?: string }).code,
        message: err.message,
      });
    });
    archive.on('error', (err) => {
      archiveError = err;
      log.error(contextLogger, 'route.apps.zip.archive.failure', err, { appId: id });
    });

    archive.pipe(res);

    let appendedCount = 0;
    await withConcurrency(filePaths, DOWNLOAD_CONCURRENCY, async (filePath) => {
      if (archiveError) return;
      try {
        const result = await workspace.files.download({ path: filePath });
        archive.append(result.data, { name: filePath });
        appendedCount++;
      } catch (err) {
        if (isDevSupervisorNotFound(err)) return;
        throw err;
      }
    });

    await archive.finalize();

    // archive.on('error') captured into archiveError; rethrow so the outer
    // catch destroys the response instead of cleanly ending it (which would
    // emit HTTP 200 + a corrupt zip + a misleading success log).
    if (archiveError) throw archiveError;

    logger.info('route.apps.zip.success', {
      appId: id,
      size: archive.pointer(),
      fileCount: appendedCount,
    });

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
    // Headers already flushed — destroy the socket so the client sees a
    // truncated transfer instead of believing the (corrupt) zip is complete.
    res.destroy(error as Error);
    return;
  }
});

async function listDirectoryFiles(
  workspace: WorkspaceClient,
  dir: string,
  appId: string,
): Promise<string[]> {
  try {
    const tree = await workspace.files.tree({ path: dir, recursive: true });
    if (tree.truncated) {
      logger.warn('route.apps.zip.tree.truncated', {
        appId,
        dir,
        entryCount: tree.entries.length,
      });
    }
    return tree.entries
      .filter((e) => e.kind === 'file')
      .map((e) => e.path);
  } catch (err) {
    if (isDevSupervisorNotFound(err)) return [];
    throw err;
  }
}

export default router;

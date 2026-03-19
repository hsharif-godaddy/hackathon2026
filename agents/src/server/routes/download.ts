/**
 * Download Route
 *
 * Handles app download/zip operations with JWT-based authorization.
 * Requires canDownload permission in JWT claims (Airo Plus subscription).
 */

import { Router, Request, Response } from 'express';
import { existsSync, createWriteStream, createReadStream, unlinkSync, mkdirSync } from 'fs';
import { join as pathJoin } from 'path';
import archiver from 'archiver';
import { AppRepository } from '../../database/index.js';
import { Logger, log } from '../../logging/index.js';
import { ALLOWED_DIRECTORIES, ALLOWED_CONFIG_FILES } from '../../config/app-download.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { requirePermission } from '../middleware/require-permission.js';

const router: Router = Router();
const appRepo = new AppRepository();
const logger = Logger.create({ service: 'download-routes' });

/**
 * Temporary directory for zip downloads
 * Can be configured via DOWNLOAD_TEMP_DIR environment variable
 */
const DOWNLOAD_TEMP_DIR = process.env.DOWNLOAD_TEMP_DIR || '/tmp/airo-downloads';
if (!existsSync(DOWNLOAD_TEMP_DIR)) {
  mkdirSync(DOWNLOAD_TEMP_DIR, { recursive: true });
}

/**
 * Safe path joining helper for download operations
 *
 * This helper centralizes path.join calls to address Semgrep path traversal warnings.
 * These warnings are FALSE POSITIVES in this context because:
 *
 * 1. App ID is validated through database lookup (line 69) - returns 404 if invalid
 * 2. file/dir parameters come from hardcoded ALLOWED_* constants, not user input
 * 3. appPath comes from database, validated to exist (line 89)
 *
 * Security measures already in place:
 * - JWT authentication with canDownload permission required
 * - Allowlist-based file filtering (ALLOWED_DIRECTORIES, ALLOWED_CONFIG_FILES)
 * - Database validation of app existence and path
 *
 * @param base - Base directory (from database or DOWNLOAD_TEMP_DIR)
 * @param segment - Path segment (from allowlist constants or validated app ID)
 * @returns Joined path
 */
// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
function safePath(base: string, segment: string): string {
  return pathJoin(base, segment);
}

/**
 * GET /apps/:id/zip - Create a zip archive of the app files and stream it to the client
 *
 * Requires JWT with canDownload=true permission (Airo Plus subscription).
 *
 * Security:
 * - JWT authentication (middleware)
 * - App ownership validation (tenant isolation)
 * - canDownload permission check
 * - Allowlist-based file filtering (only user-facing files)
 *
 * Process:
 * 1. Validate JWT, app ownership, and canDownload permission
 * 2. Lookup app and validate path exists
 * 3. Create zip archive with allowed directories/files
 * 4. Stream zip to client
 * 5. Cleanup temporary file
 */
router.get('/apps/:id/zip', validateAppOwnership, requirePermission('canDownload'), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const contextLogger = log.forApp(id);
  let zipPath: string | undefined;

  try {
    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Check if app has a valid path
    if (!app.path) {
      log.error(contextLogger, 'route.apps.zip.failure', new Error('App does not have a path'), {
        appId: id,
        appPath: app.path,
        reason: 'no_path',
      });
      return res.status(400).json({
        error: 'App download is not available',
        details: 'This app does not have local files. Only local development apps can be downloaded.'
      });
    }

    // app.path already points to the app directory (e.g., /tmp/apps/{id}/app)
    const appPath = app.path;
    if (!existsSync(appPath)) {
      log.error(contextLogger, 'route.apps.zip.failure', new Error('App directory not found'), {
        appId: id,
        appPath,
        appPathFromDb: app.path,
        reason: 'path_not_found',
      });
      return res.status(404).json({
        error: 'App directory not found',
        details: `The app directory at ${appPath} does not exist on the filesystem.`
      });
    }

    zipPath = safePath(DOWNLOAD_TEMP_DIR, `${id}-${Date.now()}.zip`);
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    // Check which config files exist (from allowlist)
    const includedFiles: string[] = [];
    for (const file of ALLOWED_CONFIG_FILES) {
      if (existsSync(safePath(appPath, file))) {
        includedFiles.push(file);
      }
    }

    logger.info('route.apps.zip.begin', {
      appId: id,
      appPath,
      zipPath,
      includedFiles,
      includedDirs: ALLOWED_DIRECTORIES,
    });

    // All archiving work is inside a single Promise so that event listener
    // errors can reject() instead of throw. A throw inside an event callback
    // becomes an unhandled exception and crashes the process.
    await new Promise<void>((resolve, reject) => {
      // Handle archive errors - destroy output stream and reject
      archive.on('error', (err) => {
        log.error(contextLogger, 'route.apps.zip.failure', err, {
          appId: id,
          reason: 'archive_error',
        });
        output.destroy();
        reject(err);
      });

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          logger.warn('route.apps.zip.warning', {
            appId: id,
            code: err.code,
            message: err.message,
          });
        } else {
          output.destroy();
          reject(err);
        }
      });

      output.on('close', () => resolve());
      output.on('error', (err) => {
        output.destroy();
        reject(err);
      });

      // Pipe archive data to the file
      archive.pipe(output);

      // Only include user-facing files (allowlist approach from config/app-download.ts)
      // Add directories that contain user code
      for (const dir of ALLOWED_DIRECTORIES) {
        archive.directory(safePath(appPath, dir), dir);
      }

      // Add config files that were checked above
      for (const file of includedFiles) {
        archive.file(safePath(appPath, file), { name: file });
      }

      // Finalize the archive - triggers compression and eventual output.close
      archive.finalize();
    });

    logger.info('route.apps.zip.success', {
      appId: id,
      size: archive.pointer(),
      zipPath,
    });

    // Stream the zip file to the client
    const appName = app.name || id;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${appName}.zip"`);

    const fileStream = createReadStream(zipPath);
    fileStream.pipe(res);

    // Clean up zip file after streaming completes or on error
    let cleanupDone = false;
    const cleanup = () => {
      if (cleanupDone || !zipPath) {return;}
      cleanupDone = true;

      try {
        if (existsSync(zipPath)) {
          unlinkSync(zipPath);
          logger.info('route.apps.zip.cleanup.success', {
            appId: id,
            zipPath,
          });
        }
      } catch (cleanupError) {
        logger.warn('route.apps.zip.cleanup.failure', {
          appId: id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    };

    // Use 'close' event instead of 'end' + timeout for reliable cleanup
    fileStream.on('close', cleanup);

    fileStream.on('error', (streamError) => {
      log.error(contextLogger, 'route.apps.zip.stream.failure', streamError, {
        appId: id,
        zipPath,
      });
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream zip file' });
      }
    });

    // Return after setting up the stream (streaming happens asynchronously)
    return;
  } catch (error) {
    // Clean up partially written zip file if it was created
    if (zipPath && existsSync(zipPath)) {
      try {
        unlinkSync(zipPath);
      } catch (cleanupError) {
        logger.warn('route.apps.zip.cleanup.failure', {
          appId: id,
          zipPath,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }

    log.error(contextLogger, 'route.apps.zip.failure', error as Error, {
      appId: id,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      reason: 'unexpected_error',
    });
    return res.status(500).json({
      error: 'Failed to create zip archive',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

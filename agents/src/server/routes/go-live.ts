/**
 * Go Live Status Management Routes
 *
 * Manages .airo/live.json file for tracking go-live status per app.
 * This replaces localStorage-based tracking with file-based tracking.
 */

import express, { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { AppRepository } from '../../database/index.js';
import { log } from '../../logging/index.js';
import { requirePermission } from '../middleware/index.js';

const router: Router = Router();
const appRepo = new AppRepository();

interface LiveStatus {
  hasGoneLive: boolean;
  wentLiveAt: string | null;
}

/**
 * Validate app ID to prevent path traversal attacks
 * @throws {Error} if appId contains invalid characters
 */
function validateAppId(appId: string): void {
  // Only allow alphanumeric, hyphens, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(appId)) {
    throw new Error('Invalid app ID format');
  }
  // Prevent path traversal attempts
  if (appId.includes('..') || appId.includes('/') || appId.includes('\\')) {
    throw new Error('Invalid characters in app ID');
  }
}

/**
 * Get the base .airo directory path for an app
 * Uses the app path from database (works in both local and prod)
 */
function getAiroDirectoryPath(appPath: string): string {
  return path.join(appPath, '.airo');
}

/**
 * Get the path to .airo/live.json for an app
 */
function getAiroLiveJsonPath(appPath: string): string {
  return path.join(getAiroDirectoryPath(appPath), 'live.json');
}

/**
 * Ensure .airo directory exists
 */
async function ensureAiroDirectory(appPath: string, appId: string): Promise<void> {
  const airoDir = getAiroDirectoryPath(appPath);
  try {
    await fs.mkdir(airoDir, { recursive: true });
  } catch (error) {
    const contextLogger = log.forApp(appId);
    contextLogger.error('go-live.ensure-airo-dir.failure', {
      appId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * GET /apps/:id/go-live-status
 *
 * Read go-live status from .airo/live.json
 */
router.get('/apps/:id/go-live-status', async (req: Request, res: Response) => {
  const { id: appId } = req.params;

  if (!appId) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  const contextLogger = log.forApp(appId);

  // Get app from repository to access path
  const app = appRepo.findById(appId);
  if (!app) {
    return res.status(404).json({ error: 'App not found' });
  }

  try {
    const liveJsonPath = getAiroLiveJsonPath(app.path);

    // Try to read the file
    try {
      const content = await fs.readFile(liveJsonPath, 'utf-8');
      const status: LiveStatus = JSON.parse(content);

      contextLogger.info('go-live.status.read', {
        appId,
        hasGoneLive: status.hasGoneLive,
        wentLiveAt: status.wentLiveAt
      });

      return res.json(status);
    } catch (error: any) {
      // File doesn't exist - return default status
      if (error.code === 'ENOENT') {
        contextLogger.debug('go-live.status.not-found', {
          appId,
          message: 'No .airo/live.json file found, returning default status'
        });

        return res.json({
          hasGoneLive: false,
          wentLiveAt: null
        });
      }

      // JSON parse error - file is corrupted, return default and log warning
      if (error instanceof SyntaxError) {
        contextLogger.warn('go-live.status.parse-error', {
          appId,
          message: 'Failed to parse live.json, returning default status',
          error: error.message
        });

        return res.json({
          hasGoneLive: false,
          wentLiveAt: null
        });
      }

      // Other errors (permission denied, etc.)
      throw error;
    }
  } catch (error) {
    contextLogger.error('go-live.status.read.failure', {
      appId,
      error: error instanceof Error ? error.message : String(error)
    });

    return res.status(500).json({
      error: 'Failed to read go-live status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /apps/:id/mark-gone-live
 *
 * Mark app as having gone live by creating/updating .airo/live.json
 * Requires canPublish permission
 */
router.post('/apps/:id/mark-gone-live', requirePermission('canPublish'), async (req: Request, res: Response) => {
  const { id: appId } = req.params;

  if (!appId) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  const contextLogger = log.forApp(appId);

  // Get app from repository to access path
  const app = appRepo.findById(appId);
  if (!app) {
    return res.status(404).json({ error: 'App not found' });
  }

  try {
    // Ensure .airo directory exists
    await ensureAiroDirectory(app.path, appId);

    const timestamp = new Date().toISOString();
    const liveStatus: LiveStatus = {
      hasGoneLive: true,
      wentLiveAt: timestamp
    };

    const liveJsonPath = getAiroLiveJsonPath(app.path);

    // Write the status to file
    await fs.writeFile(liveJsonPath, JSON.stringify(liveStatus, null, 2), 'utf-8');

    contextLogger.info('go-live.mark.success', {
      appId,
      wentLiveAt: timestamp
    });

    return res.json({
      success: true,
      ...liveStatus
    });
  } catch (error) {
    contextLogger.error('go-live.mark.failure', {
      appId,
      error: error instanceof Error ? error.message : String(error)
    });

    return res.status(500).json({
      error: 'Failed to mark app as gone live',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;

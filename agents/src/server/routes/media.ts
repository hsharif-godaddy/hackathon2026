/**
 * Media Routes - Media slot management endpoints
 *
 * Provides API endpoints for:
 * - Getting media manifest and slots
 * - Updating slot selections (swapping images)
 */

import { Router, Request, Response, IRouter } from 'express';
import { mediaManifestService } from '../../services/MediaManifestService.js';
import { logger } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const router: IRouter = Router();

/**
 * Apply ownership validation to all routes with :appId parameter
 * This ensures users can only access their own app's media
 */
router.use('/:appId', (req, res, next) => {
  // Map appId to id for the ownership middleware
  // Cast to any to allow dynamic property assignment
  (req.params as Record<string, string>).id = req.params.appId ?? '';
  validateAppOwnership(req, res, next);
});

/**
 * GET /media/:appId/manifest
 * Get the complete media manifest for an app
 */
router.get('/:appId/manifest', async (req: Request, res: Response) => {
  try {
    const appId = req.params.appId;
    if (!appId) {
      return res.status(400).json({
        success: false,
        error: 'App ID is required',
      });
    }

    logger.info('route.media.get_manifest', { appId });

    const result = await mediaManifestService.getManifest(appId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error,
      });
    }

    return res.json({
      success: true,
      manifest: result.manifest,
    });
  } catch (error) {
    logger.error('route.media.get_manifest.error', {
      appId: req.params.appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to get manifest',
    });
  }
});

/**
 * GET /media/:appId/slots/:slotName
 * Get a specific slot from the manifest
 */
router.get('/:appId/slots/:slotName(*)', async (req: Request, res: Response) => {
  try {
    const appId = req.params.appId;
    const slotName = req.params.slotName;
    if (!appId || !slotName) {
      return res.status(400).json({
        success: false,
        error: 'App ID and slot name are required',
      });
    }

    logger.info('route.media.get_slot', { appId, slotName });

    const result = await mediaManifestService.getSlot(appId, slotName);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error,
      });
    }

    return res.json({
      success: true,
      slot: result.slot,
    });
  } catch (error) {
    logger.error('route.media.get_slot.error', {
      appId: req.params.appId,
      slotName: req.params.slotName,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to get slot',
    });
  }
});

/**
 * PUT /media/:appId/slots/:slotName
 * Update a slot's current image (swap with an alternative)
 *
 * Request body:
 * - newUrl: string - The URL to set as the current image
 * - alternativeIndex?: number - Index in the alternatives array (0 = current)
 */
router.put('/:appId/slots/:slotName(*)', async (req: Request, res: Response) => {
  try {
    const appId = req.params.appId;
    const slotName = req.params.slotName;
    if (!appId || !slotName) {
      return res.status(400).json({
        success: false,
        error: 'App ID and slot name are required',
      });
    }

    const { newUrl, alternativeIndex } = req.body;

    if (!newUrl && alternativeIndex === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Either newUrl or alternativeIndex is required',
      });
    }

    logger.info('route.media.update_slot', {
      appId,
      slotName,
      alternativeIndex,
    });

    const result = await mediaManifestService.updateSlot(appId, slotName, {
      newUrl: newUrl || '',
      alternativeIndex,
      markUserModified: true,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    return res.json({
      success: true,
      slot: result.slot,
      commitHash: result.commitHash,
    });
  } catch (error) {
    logger.error('route.media.update_slot.error', {
      appId: req.params.appId,
      slotName: req.params.slotName,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to update slot',
    });
  }
});

export default router;

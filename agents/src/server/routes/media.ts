/**
 * Media Routes - Media slot management endpoints
 *
 * Provides API endpoints for:
 * - Getting media manifest and slots
 * - Updating slot selections (swapping images)
 * - Uploading custom images to slots
 */

import { Router, Request, Response, IRouter } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { mediaManifestService } from '../../services/MediaManifestService.js';
import { imageProcessingService } from '../../services/ImageProcessingService.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { logger } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { getPersistentPublicDir } from '../../utils/persistent-assets.js';

const router: IRouter = Router();

// Configure multer for memory storage with 10MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// Rate limiter for uploads (reuse pattern from files.ts)
const UPLOAD_RATE_LIMIT_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const uploadRateLimiter = rateLimit({
  windowMs: UPLOAD_RATE_LIMIT_WINDOW_MS,
  max: 20,
  message: 'Too many upload requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  handler: (req: Request, res: Response) => {
    logger.warn('route.media.upload.rate_limit_exceeded', {
      ip: req.ip,
      appId: req.params.appId,
    }, { tags: ['security', 'rate-limiting'] });

    const retryAfter = Math.ceil(UPLOAD_RATE_LIMIT_WINDOW_MS / 1000);
    res.status(429).json({
      success: false,
      error: 'Too many upload requests, please try again later',
      retryAfter,
    });
  },
});

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
 * POST /media/:appId/slots/import
 * Auto-import an arbitrary image URL as a new media slot in airo-media.json.
 */
router.post('/:appId/slots/import', async (req: Request, res: Response) => {
  const appId = req.params.appId;
  const { imageUrl, devContext, imageAlt, imageType } = req.body;

  if (!appId) {
    res.status(400).json({
      success: false,
      error: 'App ID is required',
    });
    return;
  }

  if (!imageUrl || typeof imageUrl !== 'string') {
    res.status(400).json({
      success: false,
      error: 'imageUrl is required and must be a string',
    });
    return;
  }

  logger.info('route.media.import_slot.begin', {
    appId,
    imageUrl: imageUrl.substring(0, 200),
  });

  try {
    const result = await mediaManifestService.importSlot(appId, {
      imageUrl,
      devContext,
      imageAlt,
      imageType,
    });

    if (!result.success) {
      logger.error('route.media.import_slot.failed', {
        appId,
        error: result.error,
      });
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to import slot',
      });
      return;
    }

    logger.info('route.media.import_slot.success', {
      appId,
      slotPath: result.slotPath,
    });

    res.json({
      success: true,
      slotPath: result.slotPath,
    });
  } catch (error) {
    logger.error('route.media.import_slot.error', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
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

/**
 * Multer error handler middleware
 * Handles file size limit and other multer errors
 */
function handleMulterError(
  err: Error,
  req: Request,
  res: Response,
  next: (err?: Error) => void
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        success: false,
        error: 'File size exceeds 10MB limit',
      });
      return;
    }
    res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
    return;
  }
  next(err);
}

/**
 * POST /media/:appId/slots/:slotName/upload
 * Upload an image to a media slot
 */
router.post(
  '/:appId/slots/:slotName(*)/upload',
  uploadRateLimiter,
  (req: Request, res: Response, next: (err?: Error) => void) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        return handleMulterError(err, req, res, next);
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const appId = req.params.appId;
      const slotName = req.params.slotName;

      if (!appId || !slotName) {
        return res.status(400).json({
          success: false,
          error: 'App ID and slot name are required',
        });
      }

      // Security: Validate slotName doesn't contain path traversal patterns
      // Note: slotName can contain '/' for nested paths (e.g., "components/hero/section")
      if (slotName.includes('..') || slotName.startsWith('/') || slotName.includes('\0')) {
        logger.warn('route.media.upload.path_traversal_attempt', {
          appId,
          slotName,
        }, { tags: ['security', 'path-traversal-attempt'] });
        return res.status(400).json({
          success: false,
          error: 'Invalid slot name',
        });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No image file provided',
        });
      }

      // Validate image type
      if (!imageProcessingService.validateImageType(file.mimetype)) {
        return res.status(400).json({
          success: false,
          error: 'Only JPEG, PNG, WebP, and GIF images are supported',
        });
      }

      logger.info('route.media.upload.start', {
        appId,
        slotName,
        size: file.size,
      });

      // Get the existing slot to verify it exists
      const slotResult = await mediaManifestService.getSlot(appId, slotName);
      if (!slotResult.success) {
        return res.status(404).json({
          success: false,
          error: `Slot not found: ${slotName}`,
        });
      }

      // Get app path for storage
      const appRepository = new AppRepository();
      const app = appRepository.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          error: `App not found: ${appId}`,
        });
      }

      // Process the image (resize, optimize, strip metadata)
      const processed = await imageProcessingService.processImage(file.buffer, {
        maxWidth: 2048,
        maxHeight: 2048,
        quality: 85,
      });

      // Generate filename: {sanitized-slot}-{hash}.{ext}
      const sanitizedSlot = slotName
        .replace(/\//g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '');
      const hash = crypto
        .createHash('sha256')
        .update(processed.buffer)
        .digest('hex')
        .slice(0, 8);
      const ext = processed.format === 'jpeg' ? 'jpg' : processed.format;
      const filename = `${sanitizedSlot}-${hash}.${ext}`;

      // Ensure persistent media directory exists
      const mediaDir = path.join(getPersistentPublicDir(app.path), 'media');
      await fs.mkdir(mediaDir, { recursive: true });

      // Build file path and verify it stays within media directory (defense in depth)
      const filePath = path.join(mediaDir, filename);
      const resolvedMediaDir = path.resolve(mediaDir);
      const resolvedFilePath = path.resolve(filePath);
      if (!resolvedFilePath.startsWith(resolvedMediaDir + path.sep)) {
        logger.error('route.media.upload.path_escape_attempt', {
          appId,
          slotName,
          filename,
          resolvedFilePath,
          resolvedMediaDir,
        }, { tags: ['security', 'path-traversal-attempt'] });
        return res.status(400).json({
          success: false,
          error: 'Invalid file path',
        });
      }

      // Atomic write: write to temp file first, then rename
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      await fs.writeFile(tempPath, processed.buffer);
      await fs.rename(tempPath, filePath);

      // Build the URL (using airo-assets proxy pattern)
      const uploadedUrl = `/airo-assets/uploads/${filename}`;

      // Update manifest: new URL becomes current, old current goes to alternatives
      const updateResult = await mediaManifestService.updateSlotWithUpload(
        appId,
        slotName,
        uploadedUrl
      );

      if (!updateResult.success) {
        // Clean up the written file on failure
        await fs.unlink(filePath).catch(() => {});
        return res.status(500).json({
          success: false,
          error: updateResult.error || 'Failed to update manifest',
        });
      }

      logger.info('route.media.upload.success', {
        appId,
        slotName,
        uploadedUrl,
        originalSize: file.size,
        processedSize: processed.buffer.length,
      });

      return res.json({
        success: true,
        uploadedUrl,
        slot: updateResult.slot,
      });
    } catch (error) {
      logger.error('route.media.upload.error', {
        appId: req.params.appId,
        slotName: req.params.slotName,
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to upload image',
      });
    }
  }
);

export default router;

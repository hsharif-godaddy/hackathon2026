/**
 * Media Routes - Media slot management endpoints
 *
 * Provides API endpoints for:
 * - Getting media manifest and slots
 * - Updating slot selections (swapping images)
 * - Uploading custom images to slots
 */

import { getS2SToken, isS2SAuthEnabled } from '@airo/ai-lib';
import { Router, Request, Response, IRouter } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs/promises';
import sharp from 'sharp';
import {
  AIRO_ASSET_UPLOADS_URL_PREFIX,
  getFilenameFromUploadUrl,
  isSafeUploadFilename,
} from '@airo/shared/media';
import { mediaManifestService } from '../../services/MediaManifestService.js';
import { imageProcessingService } from '../../services/ImageProcessingService.js';
import { fileUploadService } from '../../services/FileUploadService.js';
import {
  collectUploadUrlsForFilename,
  collectUploadUrlsForFilenameFromSlot,
  deletePersistentUploadFiles,
} from '../../services/media-upload-deletion.js';
import { normalizeSearchQuery } from '../../services/image-search/normalize.js';

import { logger } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { validateVideoMagicBytes, VIDEO_MIME_TYPE } from '../../services/media-upload-video.js';
import { getPersistentPublicDir } from '../../utils/persistent-assets.js';
import { createForWorkspace } from '../../workspace/index.js';
import { generateImageCaptionFromBuffer, generateVideoCaptionFromBuffer } from '../../services/MediaCaptionService.js';
import { emitMediaCaption } from '../media-caption-emit.js';

// Image-level caption cache: persistent URL → caption.
// Prevents re-captioning the same image across slots or on swap-back.
const CAPTION_CACHE_MAX = 500;
const imageCaptionCache = new Map<string, string>();

function setCaptionCache(url: string, caption: string): void {
  if (imageCaptionCache.size >= CAPTION_CACHE_MAX) {
    // Evict oldest entry (first inserted)
    const firstKey = imageCaptionCache.keys().next().value;
    if (firstKey) imageCaptionCache.delete(firstKey);
  }
  imageCaptionCache.set(url, caption);
}

/**
 * Fire-and-forget: generate a caption asynchronously, persist it, and push to the client via WS + SSE.
 */
function captionAsync(opts: {
  appId: string;
  slotName: string;
  url: string;
  getBuffer: () => Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> | null;
  isVideo: boolean;
}): void {
  const { appId, slotName, url, getBuffer, isVideo } = opts;

  // Skip if already cached — still persist + push in case this is a new slot referencing the same URL
  if (imageCaptionCache.has(url)) {
    const cached = imageCaptionCache.get(url)!;
    mediaManifestService.updateSlotCaption(appId, slotName, cached, url).then(() => {
      emitMediaCaption({ appId, slotName, caption: cached });
    }).catch(() => {});
    return;
  }

  void (async () => {
    try {
      let caption: string | null = null;

      if (isVideo) {
        const result = getBuffer ? await getBuffer() : null;
        caption = await generateVideoCaptionFromBuffer(result?.buffer ?? null, slotName);
      } else {
        const result = getBuffer ? await getBuffer() : null;
        if (!result) return;
        caption = await generateImageCaptionFromBuffer(result.buffer, result.mimeType, result.filename);
      }

      if (!caption) return;

      setCaptionCache(url, caption);
      const persist = await mediaManifestService.updateSlotCaption(appId, slotName, caption, url);
      if (persist.success) {
        emitMediaCaption({ appId, slotName, caption });
      }
    } catch (err) {
      logger.warn('route.media.caption_async_failed', {
        appId,
        slotName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}

const router: IRouter = Router();

export { VIDEO_MIME_TYPE } from '../../services/media-upload-video.js';

/**
 * Cancel an in-flight logo generation job that currently owns a slot, before a
 * manual override (slot swap / upload) writes a new value. Best-effort.
 *
 * `logoGenerationService` is imported dynamically here so that the media routes
 * do NOT pull the websocket-server module graph (emitToApp → logger.child) at
 * module-eval time — that coupling breaks media-route unit tests whose logger
 * mock has no `.child`. The chain is only loaded when an override actually
 * races an in-flight job.
 */
async function cancelPendingLogoJob(
  appId: string,
  slotName: string,
  pendingJobId: string,
): Promise<void> {
  logger.info('logo.slot_override.cancel_pending', { appId, jobId: pendingJobId, slotName });
  try {
    const { logoGenerationService } = await import('../../services/logo/LogoGenerationService.js');
    await logoGenerationService.cancel(appId, pendingJobId, { revert: false });
  } catch (err) {
    logger.warn('logo.slot_override.cancel_failed', {
      appId,
      jobId: pendingJobId,
      slotName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Canonical MIME type constants for image formats
export const IMAGE_MIME_TYPE = {
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  GIF: 'image/gif',
} as const;

// Allowed image MIME types → file extensions
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  [IMAGE_MIME_TYPE.JPEG]: 'jpg',
  [IMAGE_MIME_TYPE.PNG]: 'png',
  [IMAGE_MIME_TYPE.WEBP]: 'webp',
  [IMAGE_MIME_TYPE.GIF]: 'gif',
};

// Allowed video MIME types → file extensions
const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  [VIDEO_MIME_TYPE.MP4]: 'mp4',
  [VIDEO_MIME_TYPE.WEBM]: 'webm',
  [VIDEO_MIME_TYPE.QUICKTIME]: 'mov',
};


// All allowed media MIME types (images + videos)
const ALLOWED_MEDIA_TYPES: Record<string, string> = {
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
};



// Magic byte signatures for image validation
const IMAGE_SIGNATURES: Array<{ mime: string; bytes: number[] }> = [
  { mime: IMAGE_MIME_TYPE.JPEG, bytes: [0xFF, 0xD8, 0xFF] },
  { mime: IMAGE_MIME_TYPE.PNG, bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: IMAGE_MIME_TYPE.WEBP, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header (bytes 8-11 checked separately)
  { mime: IMAGE_MIME_TYPE.GIF, bytes: [0x47, 0x49, 0x46, 0x38] },  // GIF8
];

function validateImageMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const sig = IMAGE_SIGNATURES.find((s) => s.mime === mimeType);
  if (!sig) return false;
  if (buffer.length < sig.bytes.length) return false;
  if (!sig.bytes.every((byte, i) => buffer[i] === byte)) return false;

  // WebP is a RIFF container — verify bytes 8-11 are "WEBP" to distinguish from WAV/AVI
  if (mimeType === IMAGE_MIME_TYPE.WEBP) {
    if (buffer.length < 12) return false;
    return buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  }

  return true;
}

// Configure multer for memory storage with 50MB limit (videos can be larger than images)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
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
    logger.warn(
      'route.media.upload.rate_limit_exceeded',
      {
        ip: req.ip,
        appId: req.params.appId,
      },
      { tags: ['security', 'rate-limiting'] }
    );

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
        httpStatus: result.httpStatus,
      });
      res.status(result.httpStatus).json({
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
 * Getty API item shape returned by the proxy search endpoint
 */
interface GettySearchItem {
  id: string;
  display_sizes: Array<{ name: string; uri: string; is_watermarked: boolean }>;
}

interface GettySearchResponse {
  result_count?: number;
  images?: GettySearchItem[];
}

function extractDisplayUrl(item: GettySearchItem): string | null {
  const order = ['high_res_comp', 'mid_res_comp', 'comp', 'preview'];
  for (const name of order) {
    const size = item.display_sizes.find((s) => s.name === name);
    if (size?.uri) return size.uri;
  }
  return null;
}

/**
 * GET /media/:appId/search
 * Search Getty Images and return display URLs + IDs for the media panel search UI.
 * Query params: q, page (default 1), pageSize (default 9, max 24), orientations
 */
router.get('/:appId/search', async (req: Request, res: Response) => {
  const appId = req.params.appId;
  if (!appId) {
    return res.status(400).json({ success: false, error: 'App ID is required' });
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    return res.status(400).json({ success: false, error: 'Query parameter q is required' });
  }

  // Normalize verbose queries into concise Getty-friendly search terms
  const phrase = await normalizeSearchQuery(q);

  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(24, Math.max(1, parseInt(String(req.query.pageSize || '9'), 10) || 9));
  const orientations =
    typeof req.query.orientations === 'string' && req.query.orientations !== 'any'
      ? req.query.orientations
      : null;

  const gettyBaseUrl =
    process.env.GETTY_IMAGE_PROXY_URL || 'https://getty-images-proxy.api.dev-godaddy.com';
  const appKey = process.env.GETTY_APP_KEY || 'airo-app-builder';

  let authHeader = '';
  if (isS2SAuthEnabled()) {
    authHeader = `sso-jwt ${await getS2SToken({ ssoHost: process.env.SSO_HOST || 'sso.test-godaddy.com' })}`;
  } else if (process.env.SSO_JWT) {
    authHeader = `sso-jwt ${process.env.SSO_JWT}`;
  }

  const params = new URLSearchParams({
    phrase,
    page: String(page),
    page_size: String(pageSize),
  });
  if (orientations) {
    params.append('orientations', orientations);
  }

  logger.info('route.media.search', { appId, q, phrase, page, pageSize, orientations });

  try {
    const response = await fetch(`${gettyBaseUrl}/v1/search?${params.toString()}`, {
      method: 'GET',
      headers: {
        ...(authHeader && { Authorization: authHeader }),
        'x-app-key': appKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn('route.media.search.upstream_error', {
        appId,
        status: response.status,
        text: text.slice(0, 200),
      });
      return res.status(502).json({ success: false, error: 'Getty search failed' });
    }

    const data = (await response.json()) as GettySearchResponse;
    const items: GettySearchItem[] = data.images ?? [];

    const images: string[] = [];
    const gettyIds: string[] = [];
    for (const item of items) {
      const url = extractDisplayUrl(item);
      if (url) {
        images.push(url);
        gettyIds.push(item.id);
      }
    }

    return res.json({
      success: true,
      images,
      gettyIds,
      totalResults: data.result_count ?? 0,
    });
  } catch (error) {
    logger.error('route.media.search.error', {
      appId,
      q,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, error: 'Failed to search images' });
  }
});

/**
 * Getty API video item shape returned by the proxy video search endpoint
 */
interface GettyVideoItem {
  id: string;
  title?: string;
  caption?: string;
  display_sizes: Array<{ name: string; uri: string; is_watermarked?: boolean }>;
}

interface GettyVideoSearchResponse {
  result_count?: number;
  videos?: GettyVideoItem[];
}

function extractVideoPreviewUrl(item: GettyVideoItem): string | null {
  const comp = item.display_sizes.find((s) => s.name === 'comp');
  if (comp?.uri) return comp.uri;
  const fallback = item.display_sizes.find((s) => s.name === 'preview' || s.name === 'thumb');
  return fallback?.uri || null;
}

function extractVideoThumbnailUrl(item: GettyVideoItem): string | null {
  const poster = item.display_sizes.find((s) => s.name === 'comp_poster');
  if (poster?.uri) return poster.uri;
  const thumb = item.display_sizes.find((s) => s.name === 'thumb');
  return thumb?.uri || null;
}

/**
 * GET /media/:appId/video-search
 * Search Getty Videos and return preview URLs + IDs for the media panel.
 * Query params: q, page (default 1), pageSize (default 9, max 24), orientations
 */
router.get('/:appId/video-search', async (req: Request, res: Response) => {
  const appId = req.params.appId;
  if (!appId) {
    return res.status(400).json({ success: false, error: 'App ID is required' });
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    return res.status(400).json({ success: false, error: 'Query parameter q is required' });
  }

  // Normalize verbose queries into concise Getty-friendly search terms
  const phrase = await normalizeSearchQuery(q);

  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(24, Math.max(1, parseInt(String(req.query.pageSize || '9'), 10) || 9));
  const orientations = typeof req.query.orientations === 'string' && req.query.orientations !== 'any'
    ? req.query.orientations
    : null;

  const gettyBaseUrl = (process.env.GETTY_IMAGE_PROXY_URL || 'https://getty-images-proxy.api.dev-godaddy.com')
    .replace(/\/(v1|img).*$/, '');
  const appKey = process.env.GETTY_APP_KEY || 'airo-app-builder';

  let authHeader = '';
  if (isS2SAuthEnabled()) {
    authHeader = `sso-jwt ${await getS2SToken({ ssoHost: process.env.SSO_HOST || 'sso.test-godaddy.com' })}`;
  } else if (process.env.SSO_JWT) {
    authHeader = `sso-jwt ${process.env.SSO_JWT}`;
  }

  const params = new URLSearchParams({
    phrase,
    page: String(page),
    page_size: String(pageSize),
    enableUpload: 'true',
    reportUsage: 'false',
  });
  if (orientations) {
    params.append('orientations', orientations);
  }

  logger.info('route.media.video_search', { appId, query: q, phrase, page, pageSize, orientations });

  try {
    const response = await fetch(`${gettyBaseUrl}/v1/videos/search?${params.toString()}`, {
      method: 'GET',
      headers: {
        ...(authHeader && { Authorization: authHeader }),
        'x-app-key': appKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn('route.media.video_search.upstream_error', { appId, status: response.status, text: text.slice(0, 200) });
      return res.status(502).json({ success: false, error: 'Getty video search failed' });
    }

    const data = (await response.json()) as GettyVideoSearchResponse | GettyVideoItem[];
    const rawVideos = Array.isArray(data) ? data : (data?.videos ?? []);
    const items: GettyVideoItem[] = Array.isArray(rawVideos) ? rawVideos : [];

    const seenIds = new Set<string>();
    const videos: string[] = [];
    const thumbnails: string[] = [];
    const gettyIds: string[] = [];

    for (const item of items) {
      if (seenIds.has(item.id)) continue;
      const previewUrl = extractVideoPreviewUrl(item);
      const thumbUrl = extractVideoThumbnailUrl(item);
      if (previewUrl) {
        seenIds.add(item.id);
        videos.push(previewUrl);
        thumbnails.push(thumbUrl || previewUrl);
        gettyIds.push(item.id);
      }
    }

    return res.json({
      success: true,
      videos,
      thumbnails,
      gettyIds,
      totalResults: (Array.isArray(data) ? data.length : data?.result_count) ?? 0,
    });
  } catch (error) {
    logger.error('route.media.video_search.error', {
      appId,
      q,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, error: 'Failed to search videos' });
  }
});

/**
 * DELETE /media/:appId/uploads/:filename
 * Delete a chat/persistent uploaded image and remove manifest references safely.
 */
router.delete('/:appId/uploads/:filename', async (req: Request, res: Response) => {
  const appId = req.params.appId;
  const filename = req.params.filename;

  if (!appId || !filename) {
    return res.status(400).json({
      success: false,
      error: 'App ID and filename are required',
    });
  }

  if (!isSafeUploadFilename(filename)) {
    logger.warn(
      'route.media.delete_upload.invalid_filename',
      {
        appId,
        filename,
      },
      { tags: ['security', 'path-traversal-attempt'] }
    );
    return res.status(400).json({
      success: false,
      error: 'Invalid filename',
    });
  }

  try {
    const manifestResult = await mediaManifestService.getManifest(appId);
    if (!manifestResult.success) {
      return res.status(500).json({
        success: false,
        error: manifestResult.error || 'Failed to read manifest',
      });
    }

    const uploadUrls = collectUploadUrlsForFilename(manifestResult.manifest, filename);
    let affectedSlots: string[] = [];
    let removedUrls: string[] = [];

    if (uploadUrls.length > 0) {
      const removeResult = await mediaManifestService.removeUploadedUrls(appId, uploadUrls);
      if (!removeResult.success) {
        return res.status(409).json({
          success: false,
          error: removeResult.error || 'Cannot delete upload while it is in use',
          affectedSlots: removeResult.affectedSlots || [],
          removedUrls: removeResult.removedUrls || uploadUrls,
        });
      }
      affectedSlots = removeResult.affectedSlots || [];
      removedUrls = removeResult.removedUrls || uploadUrls;
    }

    const { deletedPersistentUrls, failedPersistentUrls } = await deletePersistentUploadFiles(
      appId,
      uploadUrls
    );
    const chatDeleteResult = await fileUploadService.deleteUploadedFile(appId, filename);

    if (uploadUrls.length === 0 && !chatDeleteResult.deleted) {
      return res.status(404).json({
        success: false,
        error: 'Upload file not found',
      });
    }

    if (failedPersistentUrls.length > 0) {
      logger.warn('route.media.delete_upload.persistent_cleanup_failed', {
        appId,
        filename,
        failedPersistentUrls,
      });
    }

    logger.info('route.media.delete_upload.success', {
      appId,
      filename,
      affectedSlots,
      removedUrls,
      chatUploadDeleted: chatDeleteResult.deleted,
      uploadId: chatDeleteResult.uploadId,
      deletedPersistentUrls,
      failedPersistentUrls,
    });

    return res.json({
      success: true,
      affectedSlots,
      removedUrls,
      chatUploadDeleted: chatDeleteResult.deleted,
      uploadId: chatDeleteResult.uploadId,
      deletedPersistentUrls,
      failedPersistentUrls,
    });
  } catch (error) {
    logger.error('route.media.delete_upload.error', {
      appId,
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to delete upload',
    });
  }
});

/**
 * DELETE /media/:appId/slots/:slotName/uploads/:filename
 * Remove an uploaded media from one media slot while leaving the upload available elsewhere.
 */
router.delete(
  '/:appId/slots/:slotName(*)/uploads/:filename',
  async (req: Request, res: Response) => {
    const appId = req.params.appId;
    const slotName = req.params.slotName;
    const filename = req.params.filename;

    if (!appId || !slotName || !filename) {
      return res.status(400).json({
        success: false,
        error: 'App ID, slot name, and filename are required',
      });
    }

    if (slotName.includes('..') || slotName.startsWith('/') || slotName.includes('\0')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid slot name',
      });
    }

    if (!isSafeUploadFilename(filename)) {
      logger.warn(
        'route.media.delete_slot_upload.invalid_filename',
        {
          appId,
          slotName,
          filename,
        },
        { tags: ['security', 'path-traversal-attempt'] }
      );
      return res.status(400).json({
        success: false,
        error: 'Invalid filename',
      });
    }

    try {
      const manifestResult = await mediaManifestService.getManifest(appId);
      if (!manifestResult.success) {
        return res.status(500).json({
          success: false,
          error: manifestResult.error || 'Failed to read manifest',
        });
      }

      const slot = manifestResult.manifest?.[slotName];
      if (!slot) {
        return res.status(404).json({
          success: false,
          error: `Slot not found: ${slotName}`,
        });
      }

      const uploadUrls = collectUploadUrlsForFilenameFromSlot(slot, filename);
      if (uploadUrls.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Upload is not used in this slot',
        });
      }

      const removeResult = await mediaManifestService.removeUploadedUrlsFromSlot(
        appId,
        slotName,
        uploadUrls
      );
      if (!removeResult.success) {
        return res.status(409).json({
          success: false,
          error: removeResult.error || 'Cannot remove upload from slot',
          affectedSlots: removeResult.affectedSlots || [],
          removedUrls: removeResult.removedUrls || uploadUrls,
          chatUploadDeleted: false,
        });
      }

      logger.info('route.media.delete_slot_upload.success', {
        appId,
        slotName,
        filename,
        affectedSlots: removeResult.affectedSlots || [],
        removedUrls: removeResult.removedUrls || uploadUrls,
        chatUploadDeleted: false,
      });

      return res.json({
        success: true,
        affectedSlots: removeResult.affectedSlots || [],
        removedUrls: removeResult.removedUrls || uploadUrls,
        chatUploadDeleted: false,
        commitHash: removeResult.commitHash,
      });
    } catch (error) {
      logger.error('route.media.delete_slot_upload.error', {
        appId,
        slotName,
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to remove upload from slot',
      });
    }
  }
);

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

    const { newUrl, alternativeIndex, allowExternalUrl, gettyId, searchQuery, isVideo, forkContext, occurrenceIndex } = req.body;

    if (!newUrl && alternativeIndex === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Either newUrl or alternativeIndex is required',
      });
    }

    const parsedOccurrenceIndex = typeof occurrenceIndex === 'number'
      ? occurrenceIndex
      : typeof occurrenceIndex === 'string' && occurrenceIndex.trim() !== ''
        ? Number.parseInt(occurrenceIndex, 10)
        : null;

    logger.info('route.media.update_slot', {
      appId,
      slotName,
      alternativeIndex,
      hasForkContext: forkContext != null,
      occurrenceIndex: Number.isFinite(parsedOccurrenceIndex) ? parsedOccurrenceIndex : null,
    });

    // A user-driven slot override supersedes any in-flight logo job populating
    // this slot. Abort it (best-effort, no revert — we're about to write the
    // slot ourselves) so the background job can't clobber the user's choice.
    const existingSlotResult = await mediaManifestService.getSlot(appId, slotName);
    const pendingJobId = existingSlotResult.slot?.pendingJobId;
    if (pendingJobId) {
      await cancelPendingLogoJob(appId, slotName, pendingJobId);
    }

    const result = await mediaManifestService.updateSlotOrFork(appId, slotName, {
      newUrl: newUrl || '',
      updateOptions: {
        alternativeIndex,
        markUserModified: true,
        allowExternalUrl: allowExternalUrl === true,
        gettyAsset: typeof gettyId === 'string'
          ? { id: gettyId, mediaType: isVideo === true ? 'video' : 'image' }
          : undefined,
        mediaTypeHint: typeof gettyId !== 'string' && typeof isVideo === 'boolean'
          ? (isVideo ? 'video' : 'image')
          : undefined,
        searchQuery: typeof searchQuery === 'string' && searchQuery.trim() ? searchQuery.trim() : undefined,
      },
      forkContext: forkContext ?? null,
      occurrenceIndex: Number.isFinite(parsedOccurrenceIndex) ? parsedOccurrenceIndex : null,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    // Fire-and-forget async captioning — result pushed via WS + SSE `media_caption` event.
    const hasSearchCaption = typeof searchQuery === 'string' && searchQuery.trim();
    const isLogo = result.slot?.mediaType === 'logo';
    if (!hasSearchCaption && !isLogo && result.slot?.currentUrl) {
      const slotUrl = result.slot.currentUrl;
      const swapFilename = getFilenameFromUploadUrl(slotUrl);
      const isSwapVideo = result.slot.mediaType === 'video';
      captionAsync({
        appId,
        slotName,
        url: slotUrl,
        isVideo: !!isSwapVideo,
        getBuffer: swapFilename
          ? async () => {
              const workspace = createForWorkspace(appId, 'preview');
              if (!workspace) return null;
              const mediaPath = `public/assets/media/${swapFilename}`;
              const { data, contentType } = await workspace.files.download({ path: mediaPath });
              return { buffer: data, mimeType: contentType, filename: swapFilename };
            }
          : () => Promise.resolve(null),
      });
    }

    return res.json({
      success: true,
      slot: result.slot,
      commitHash: result.commitHash,
      forked: result.forked === true,
      slotPath: result.forked ? result.slotPath : slotName,
      originalSlotPath: result.originalSlotPath,
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
        error: 'File size exceeds 50MB limit',
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
 * POST /media/:appId/slots/:slotName/apply-upload
 * Apply a chat-uploaded file to a media slot (server-side copy, no browser roundtrip)
 */
router.post(
  '/:appId/slots/:slotName(*)/apply-upload',
  uploadRateLimiter,
  async (req: Request, res: Response) => {
    try {
      const appId = req.params.appId;
      const slotName = req.params.slotName;
      const { filename } = req.body;

      if (!appId || !slotName || !filename) {
        return res.status(400).json({
          success: false,
          error: 'App ID, slot name, and filename are required',
        });
      }

      if (slotName.includes('..') || slotName.startsWith('/') || slotName.includes('\0')) {
        return res.status(400).json({ success: false, error: 'Invalid slot name' });
      }

      if (filename.includes('..') || filename.includes('/') || filename.includes('\0')) {
        return res.status(400).json({ success: false, error: 'Invalid filename' });
      }

      // Validate the slot exists
      const slotResult = await mediaManifestService.getSlot(appId, slotName);
      if (!slotResult.success) {
        logger.warn('route.media.apply_upload.slot_not_found', { appId, slotName });
        return res.status(404).json({ success: false, error: `Slot not found: ${slotName}` });
      }

      // Find the chat upload file on disk
      const uploadedFiles = await fileUploadService.listUploadedFiles(appId);
      const matchingFile = uploadedFiles.find((f) => f.filename === filename);

      if (!matchingFile) {
        logger.warn('route.media.apply_upload.file_not_found', { appId, slotName, filename });
        return res.status(404).json({ success: false, error: 'Upload file not found' });
      }

      const appUploadsDir = fileUploadService.getAppUploadsDir(appId);
      let sourceFilePath: string | null = null;

      try {
        await fs.access(appUploadsDir);
        const uploadIds = await fs.readdir(appUploadsDir);
        for (const uploadId of uploadIds) {
          const candidatePath = fileUploadService.getFilePath(appId, uploadId, filename);
          try {
            await fs.access(candidatePath);
            sourceFilePath = candidatePath;
            break;
          } catch {
            // file not in this upload directory, try next
          }
        }
      } catch {
        // appUploadsDir doesn't exist
      }

      if (!sourceFilePath) {
        logger.warn('route.media.apply_upload.file_not_on_disk', { appId, slotName, filename });
        return res.status(404).json({ success: false, error: 'Upload file not found on disk' });
      }

      // Read the file
      const fileBuffer = await fs.readFile(sourceFilePath);
      const isVideo = matchingFile.mimeType?.startsWith('video/') ?? false;

      // Validate magic bytes for videos (images are validated during initial upload)
      if (isVideo) {
        if (!matchingFile.mimeType || !ALLOWED_VIDEO_TYPES[matchingFile.mimeType]) {
          return res.status(400).json({ success: false, error: 'Unsupported video type' });
        }
        if (!validateVideoMagicBytes(fileBuffer, matchingFile.mimeType)) {
          return res.status(400).json({ success: false, error: 'File content does not match declared video type' });
        }
      }

      // For videos, skip image processing — write raw buffer with correct extension.
      // For images, process through sharp for resizing/quality.
      let outputBuffer: Buffer;
      let ext: string;
      let dimensions: { width: number; height: number } | undefined;
      if (isVideo) {
        outputBuffer = fileBuffer;
        ext = ALLOWED_VIDEO_TYPES[matchingFile.mimeType ?? ''] || 'mp4';
      } else {
        const processed = await imageProcessingService.processImage(fileBuffer, {
          maxWidth: 3840,
          maxHeight: 3840,
          quality: 90,
        });
        outputBuffer = processed.buffer;
        ext = processed.format === 'jpeg' ? 'jpg' : processed.format;
        if (processed.originalWidth && processed.originalHeight) {
          dimensions = { width: processed.originalWidth, height: processed.originalHeight };
        }
      }

      // Generate filename and write to persistent media directory via workspace API
      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        return res.status(404).json({ success: false, error: `App workspace not found: ${appId}` });
      }

      const sanitizedSlot = slotName.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
      const hash = crypto.createHash('sha256').update(outputBuffer).digest('hex').slice(0, 8);
      const mediaFilename = `${sanitizedSlot}-${hash}.${ext}`;
      const mediaPath = `public/assets/media/${mediaFilename}`;

      await workspace.files.upload({ path: mediaPath, data: outputBuffer });

      const uploadedUrl = `${AIRO_ASSET_UPLOADS_URL_PREFIX}${mediaFilename}`;

      // A user-driven upload supersedes any in-flight logo job populating this
      // slot. Abort it (best-effort, no revert — we're about to write the slot
      // ourselves) so the background job can't clobber the user's choice.
      const pendingJobId = slotResult.slot?.pendingJobId;
      if (pendingJobId) {
        await cancelPendingLogoJob(appId, slotName, pendingJobId);
      }

      const updateResult = await mediaManifestService.updateSlotWithUpload(
        appId,
        slotName,
        uploadedUrl,
        { sourceFilename: filename, isVideo, dimensions }
      );

      if (!updateResult.success) {
        await workspace.files.delete({ path: mediaPath }).catch(() => {});
        return res.status(500).json({
          success: false,
          error: updateResult.error || 'Failed to update manifest',
        });
      }

      logger.info('route.media.apply_upload.success', {
        appId,
        slotName,
        uploadedUrl,
        sourceFilename: filename,
      });

      // Fire-and-forget async captioning — result pushed via WS + SSE `media_caption` event.
      const isLogo = updateResult.slot?.mediaType === 'logo';
      if (!isLogo) {
        const captionMimeType = isVideo
          ? (matchingFile.mimeType ?? 'video/mp4')
          : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        const captionBuffer = outputBuffer;
        captionAsync({
          appId,
          slotName,
          url: uploadedUrl,
          isVideo,
          getBuffer: async () => ({ buffer: captionBuffer, mimeType: captionMimeType, filename: mediaFilename }),
        });
      }

      return res.json({
        success: true,
        uploadedUrl,
        slot: updateResult.slot,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('route.media.apply_upload.error', {
        appId: req.params.appId,
        slotName: req.params.slotName,
        error: errorMessage,
      });

      return res.status(500).json({
        success: false,
        error: `Failed to apply upload: ${errorMessage}`,
      });
    }
  }
);

/**
 * POST /media/:appId/slots/import-upload
 * Register a chat-uploaded file as a new or existing media slot
 */
router.post('/:appId/slots/import-upload', uploadRateLimiter, async (req: Request, res: Response) => {
  try {
    const appId = req.params.appId;
    const { filename, slotName, assetRole } = req.body;

    if (!appId || !filename) {
      return res.status(400).json({
        success: false,
        error: 'App ID and filename are required',
      });
    }

    if (slotName && (slotName.includes('..') || slotName.startsWith('/') || slotName.includes('\0'))) {
      return res.status(400).json({ success: false, error: 'Invalid slot name' });
    }

    // assetRole is optional; reject unknown values at the boundary rather than
    // silently passing them through (they would just no-op downstream).
    if (assetRole !== undefined && assetRole !== null &&
        assetRole !== 'hero_image' && assetRole !== 'background') {
      return res.status(400).json({ success: false, error: 'Invalid assetRole' });
    }

    const result = await mediaManifestService.importChatUploadToSlot(appId, {
      filename,
      slotName,
      assetRole,
      createIfMissing: true,
    });

    if (!result.success) {
      return res.status(result.httpStatus ?? 500).json({
        success: false,
        error: result.error,
      });
    }

    logger.info('route.media.import_upload.success', {
      appId,
      slotPath: result.slotPath,
      uploadedUrl: result.uploadedUrl,
      sourceFilename: filename,
    });

    return res.json({
      success: true,
      slotPath: result.slotPath,
      slotUrl: result.slotUrl,
      uploadedUrl: result.uploadedUrl,
      slot: result.slot,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('route.media.import_upload.error', {
      appId: req.params.appId,
      error: errorMessage,
    });

    return res.status(500).json({
      success: false,
      error: `Failed to import upload: ${errorMessage}`,
    });
  }
});

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
        logger.warn(
          'route.media.upload.path_traversal_attempt',
          {
            appId,
            slotName,
          },
          { tags: ['security', 'path-traversal-attempt'] }
        );
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

      // Validate MIME type and magic bytes to prevent arbitrary content uploads
      if (!ALLOWED_MEDIA_TYPES[file.mimetype]) {
        return res.status(400).json({
          success: false,
          error: 'Only JPEG, PNG, WebP, GIF images and MP4, WebM, MOV videos are supported',
        });
      }

      const isVideoUpload = !!ALLOWED_VIDEO_TYPES[file.mimetype];

      // Validate magic bytes — images use strict signature check, videos use header check
      if (!isVideoUpload && !validateImageMagicBytes(file.buffer, file.mimetype)) {
        logger.warn('route.media.upload.magic_bytes_mismatch', {
          appId,
          slotName,
          mimetype: file.mimetype,
        }, { tags: ['security'] });
        return res.status(400).json({
          success: false,
          error: 'File content does not match declared image type',
        });
      }

      if (isVideoUpload && !validateVideoMagicBytes(file.buffer, file.mimetype)) {
        logger.warn('route.media.upload.video_magic_bytes_mismatch', {
          appId,
          slotName,
          mimetype: file.mimetype,
        }, { tags: ['security'] });
        return res.status(400).json({
          success: false,
          error: 'File content does not match declared video type',
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
        logger.warn('route.media.upload.slot_not_found', {
          appId,
          slotName,
          error: slotResult.error,
        });
        return res.status(404).json({
          success: false,
          error: `Slot not found: ${slotName}`,
        });
      }

      // Get workspace client for file operations
      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        logger.warn('route.media.upload.app_not_found', { appId, slotName });
        return res.status(404).json({
          success: false,
          error: `App not found: ${appId}`,
        });
      }

      // Single compression pass (Sharp/MozJPEG).
      // GIFs and animated WebPs skip processing to preserve animation.
      let outputBuffer: Buffer;
      let processedDimensions: { width: number; height: number } | undefined;
      const skipProcessing = isVideoUpload
        || file.mimetype === IMAGE_MIME_TYPE.GIF
        || (file.mimetype === IMAGE_MIME_TYPE.WEBP && ((await sharp(file.buffer).metadata().catch(() => ({ pages: 1 }))).pages ?? 1) > 1);

      if (!skipProcessing) {
        try {
          const processed = await imageProcessingService.processImage(file.buffer, {
            maxWidth: 3840,
            maxHeight: 3840,
            minWidth: 1,
            minHeight: 1,
            quality: 90,
          });
          outputBuffer = processed.buffer;
          processedDimensions = { width: processed.width, height: processed.height };
        } catch (processErr) {
          logger.warn('route.media.upload.image_processing_failed', {
            appId,
            slotName,
            error: processErr instanceof Error ? processErr.message : String(processErr),
          });
          return res.status(400).json({
            success: false,
            error: 'Image could not be processed. File may be corrupt or unsupported.',
          });
        }
      } else {
        outputBuffer = file.buffer;
      }

      // If overwriteFilename is provided (editing a local upload), reuse the
      // existing filename so the file is overwritten in place instead of
      // accumulating new files on each editor save.
      const overwriteFilename =
        typeof req.body?.overwriteFilename === 'string' ? req.body.overwriteFilename : undefined;
      const isOverwrite =
        overwriteFilename !== undefined &&
        !overwriteFilename.includes('/') &&
        !overwriteFilename.includes('..') &&
        !overwriteFilename.includes('\0');

      // chatFilenameOverwrite: editor was opened from a chat upload that has no persistent
      // URL yet. Overwrite the original chat file instead of creating a new copy.
      const chatFilenameOverwrite =
        !isOverwrite && typeof req.body?.chatFilenameOverwrite === 'string'
          ? req.body.chatFilenameOverwrite
          : undefined;
      const hasChatOverwrite =
        chatFilenameOverwrite !== undefined &&
        !chatFilenameOverwrite.includes('/') &&
        !chatFilenameOverwrite.includes('..') &&
        !chatFilenameOverwrite.includes('\0');

      let filename: string;
      if (isOverwrite) {
        filename = overwriteFilename!;
      } else {
        // Generate filename: {sanitized-slot}-{hash}.{ext}
        const sanitizedSlot = slotName
          .replace(/\//g, '-')
          .replace(/[^a-zA-Z0-9-]/g, '');
        const hash = crypto
          .createHash('sha256')
          .update(outputBuffer)
          .digest('hex')
          .slice(0, 8);
        const ext = ALLOWED_MEDIA_TYPES[file.mimetype];
        filename = `${sanitizedSlot}-${hash}.${ext}`;
      }

      // Write to workspace via dev-supervisor (handles path sandboxing)
      const mediaPath = `public/assets/media/${filename}`;
      logger.debug('route.media.upload.write_file', {
        appId,
        slotName,
        mediaPath,
        filename,
      });
      await workspace.files.upload({ path: mediaPath, data: outputBuffer });

      // Build the URL (using airo-assets proxy pattern)
      const uploadedUrl = `${AIRO_ASSET_UPLOADS_URL_PREFIX}${filename}`;

      if (isOverwrite) {
        // Overwriting a local upload in place — URL is unchanged so no manifest
        // update is needed. Also overwrite the corresponding chat upload file so
        // the thumbnail in UploadedMediaSection shows the updated image.
        const chatFilename = slotResult.slot?.uploadSources?.[uploadedUrl];
        if (chatFilename) {
          try {
            const chatFilePath = await fileUploadService.findUploadedFilePath(appId, chatFilename);
            if (chatFilePath) {
              const chatTempPath = `${chatFilePath}.tmp.${Date.now()}`;
              await fs.writeFile(chatTempPath, outputBuffer);
              await fs.rename(chatTempPath, chatFilePath);
              logger.debug('route.media.upload.overwrite_chat_copy_updated', {
                appId,
                slotName,
                chatFilename,
              });
            }
          } catch (chatErr) {
            // Non-fatal — thumbnail may show stale until next list refresh
            logger.warn('route.media.upload.overwrite_chat_copy_failed', {
              appId,
              slotName,
              chatFilename,
              error: chatErr instanceof Error ? chatErr.message : String(chatErr),
            });
          }
        }

        // Find all other slots that either share the same persistent URL or were
        // derived from the same original chat upload (different file per slot).
        // For sibling-copy slots, overwrite their files on disk too so the
        // preview proxy serves fresh content when their slots are reloaded.
        const affectedSlots: string[] = [];
        const manifestResult = await mediaManifestService.getManifest(appId);
        if (!manifestResult.success) {
          logger.warn('route.media.upload.overwrite_manifest_read_failed', {
            appId,
            slotName,
            error: manifestResult.error,
          });
        }
        if (manifestResult.success && manifestResult.manifest) {
          for (const [name, s] of Object.entries(manifestResult.manifest)) {
            if (name === slotName) continue;

            // Case A: both slots point at the same persistent file
            const sharesUrl = s.currentUrl === uploadedUrl || s.alternatives.includes(uploadedUrl);

            // Case B: different persistent file but produced from the same chat upload
            const sharesChatSource = !!(
              chatFilename &&
              s.uploadSources &&
              Object.values(s.uploadSources).includes(chatFilename)
            );

            if (!sharesUrl && !sharesChatSource) continue;

            // Always notify the client so it can invalidate the preview-server
            // cache for this slot — even if the disk write below fails.
            affectedSlots.push(name);

            if (!sharesUrl && sharesChatSource) {
              // Case B: different persistent file, same original chat upload.
              // Overwrite each sibling file derived from the same chat upload.
              const siblingUrls = Object.entries(s.uploadSources!)
                .filter(([, src]) => src === chatFilename)
                .map(([url]) => url);

              for (const siblingUrl of siblingUrls) {
                const siblingFilename = getFilenameFromUploadUrl(siblingUrl);
                if (!siblingFilename) continue;
                const siblingMediaPath = `public/assets/media/${siblingFilename}`;
                try {
                  await workspace.files.upload({ path: siblingMediaPath, data: outputBuffer });
                  logger.debug('route.media.upload.cross_slot_overwrite', {
                    appId,
                    slotName,
                    affectedSlot: name,
                    siblingUrl,
                  });
                } catch (crossErr) {
                  logger.warn('route.media.upload.cross_slot_overwrite_failed', {
                    appId,
                    slotName,
                    affectedSlot: name,
                    siblingUrl,
                    error: crossErr instanceof Error ? crossErr.message : String(crossErr),
                  });
                }
              }
            }
          }
        }

        logger.info('route.media.upload.overwrite_success', {
          appId,
          slotName,
          uploadedUrl,
          size: file.size,
          affectedSlots,
        });

        return res.json({
          success: true,
          uploadedUrl,
          affectedSlots,
        });
      }

      // Also save to chat uploads so the image appears in "Your Uploads" section.
      // Non-fatal — the persistent media write already succeeded.
      let chatUploadFilename: string | undefined;
      if (hasChatOverwrite) {
        // Editor was opened from a chat upload — overwrite it in place instead of
        // creating a new copy, so the thumbnail stays current and no duplicate appears.
        try {
          const chatFilePath = await fileUploadService.findUploadedFilePath(
            appId,
            chatFilenameOverwrite!
          );
          if (chatFilePath) {
            const chatTempPath = `${chatFilePath}.tmp.${Date.now()}`;
            await fs.writeFile(chatTempPath, outputBuffer);
            await fs.rename(chatTempPath, chatFilePath);
            chatUploadFilename = chatFilenameOverwrite;
            logger.debug('route.media.upload.chat_overwrite_updated', {
              appId,
              slotName,
              chatFilenameOverwrite,
            });
          }
        } catch (chatErr) {
          logger.warn('route.media.upload.chat_overwrite_failed', {
            appId,
            slotName,
            chatFilenameOverwrite,
            error: chatErr instanceof Error ? chatErr.message : String(chatErr),
          });
        }
      } else {
        try {
          // Pass the processed buffer so the chat copy stores the compressed
          // version (smaller on disk) rather than the raw original.
          const compressedFile = { ...file, buffer: outputBuffer, size: outputBuffer.length };
          const chatResult = await fileUploadService.processUpload(appId, [compressedFile]);
          if (chatResult.files?.length > 0) {
            chatUploadFilename = chatResult.files[0]?.filename;
          }
        } catch (chatErr) {
          logger.debug('route.media.upload.chat_copy_skipped', {
            appId,
            error: chatErr instanceof Error ? chatErr.message : String(chatErr),
          });
        }
      }

      // A user-driven upload supersedes any in-flight logo job populating this
      // slot. Abort it (best-effort, no revert — we're about to write the slot
      // ourselves) so the background job can't clobber the user's choice.
      const pendingJobId = slotResult.slot?.pendingJobId;
      if (pendingJobId) {
        await cancelPendingLogoJob(appId, slotName, pendingJobId);
      }

      // Update manifest: new URL becomes current, old current goes to alternatives.
      const updateResult = await mediaManifestService.updateSlotWithUpload(
        appId,
        slotName,
        uploadedUrl,
        { sourceFilename: chatUploadFilename, isVideo: isVideoUpload, dimensions: processedDimensions }
      );

      if (!updateResult.success) {
        logger.error('route.media.upload.manifest_update_failed', {
          appId,
          slotName,
          uploadedUrl,
          error: updateResult.error,
        });
        // Clean up the written file on failure
        await workspace.files.delete({ path: mediaPath }).catch(() => {});
        return res.status(500).json({
          success: false,
          error: updateResult.error || 'Failed to update manifest',
        });
      }

      logger.info('route.media.upload.success', {
        appId,
        slotName,
        uploadedUrl,
        size: file.size,
        chatUploadFilename,
      });

      // Fire-and-forget async captioning — result pushed via WS + SSE `media_caption` event.
      const isLogoUpload = updateResult.slot?.mediaType === 'logo';
      if (!isLogoUpload) {
        const uploadBuffer = file.buffer;
        const uploadMime = file.mimetype;
        captionAsync({
          appId,
          slotName,
          url: uploadedUrl,
          isVideo: isVideoUpload,
          getBuffer: async () => ({ buffer: uploadBuffer, mimeType: uploadMime, filename }),
        });
      }

      return res.json({
        success: true,
        uploadedUrl,
        chatUploadFilename,
        slot: updateResult.slot,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('route.media.upload.error', {
        appId: req.params.appId,
        slotName: req.params.slotName,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return res.status(500).json({
        success: false,
        error: `Failed to upload image: ${errorMessage}`,
      });
    }
  }
);

export default router;

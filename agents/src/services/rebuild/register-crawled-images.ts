/**
 * Registers crawled source-site images (downloaded + deduped during a rebuild)
 * as a synthetic upload batch so they surface in the builder's Media tab and
 * behave like uploaded media — browsable and reusable into any slot.
 *
 * Best-effort: reads the final asset manifest written by AssetProcessingService
 * and hands the image assets to FileUploadService. Never throws — a failure here
 * must not fail the rebuild.
 */
import { readFile } from 'fs/promises';
import path from 'path';

import { Logger } from '../../logging/index.js';
import type { AssetInfo, AssetManifest } from '../../types/rebuild.js';
import type { FileUploadService, LocalFileToRegister } from '../FileUploadService.js';

const logger = Logger.create({ component: 'rebuild-orchestration-service' });

/** Stable upload-batch id for crawled source images. Rebuilt on every crawl. */
export const CRAWLED_SOURCE_UPLOAD_ID = 'crawled-source';

/**
 * Derive a human-friendly display name for a crawled image. The actual stored
 * filename is the content-hash basename; this is only for the Media tab label.
 * Precedence: source-URL basename → slugified alt text → on-disk basename.
 */
function deriveOriginalName(asset: AssetInfo): string {
  // 1. Basename of the source URL's path (strip query/hash).
  try {
    const pathname = new URL(asset.url).pathname;
    const urlBase = decodeURIComponent(path.posix.basename(pathname));
    if (urlBase && urlBase !== '/' && urlBase.includes('.')) {
      return urlBase;
    }
  } catch {
    // not a parseable absolute URL — fall through
  }

  // 2. Slugified alt text, keeping the on-disk extension.
  if (asset.altText && asset.altText.trim()) {
    const slug = asset.altText
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    if (slug) {
      return `${slug}${path.extname(asset.localPath)}`;
    }
  }

  // 3. On-disk basename (the content-hash filename).
  return path.basename(asset.localPath);
}

/**
 * Read the rebuild asset manifest and register its image assets as an upload
 * batch. No-op (logged, never thrown) when the manifest is missing/unreadable
 * or has no images.
 *
 * @param appId   App whose uploads the images are registered under.
 * @param appPath Absolute path to the app workspace (source for the manifest +
 *                the on-disk asset files).
 * @param fileUploadService Injected upload service (shared singleton).
 */
export async function registerCrawledImagesAsUploads(
  appId: string,
  appPath: string,
  fileUploadService: FileUploadService
): Promise<void> {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- appPath is the server-assigned workspace; only string literals are joined here.
  const manifestPath = path.join(appPath, '.source-site', 'assets', 'manifest.json');

  let manifest: AssetManifest;
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(raw) as AssetManifest;
  } catch (error) {
    logger.info('rebuild.register_crawled_images.manifest_unavailable', {
      appId,
      manifestPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const imageAssets = Array.isArray(manifest?.assets)
    ? manifest.assets.filter((a) => a.type === 'image')
    : [];

  if (imageAssets.length === 0) {
    logger.info('rebuild.register_crawled_images.no_images', { appId });
    return;
  }

  try {
    // Building the file list (path.join + deriveOriginalName) is inside the try
    // so a malformed manifest entry (e.g. a non-string localPath) can't throw
    // out of this best-effort helper.
    const files: LocalFileToRegister[] = imageAssets.map((asset) => ({
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- asset.localPath is a server-generated path.relative under appPath; filename is an md5 hash plus a whitelisted extension, so it cannot contain traversal sequences.
      absoluteSourcePath: path.join(appPath, asset.localPath),
      originalName: deriveOriginalName(asset),
      mimeType: null, // FileUploadService derives from extension
      size: asset.fileSize,
    }));
    const result = await fileUploadService.registerLocalFilesAsUpload(appId, files, {
      uploadId: CRAWLED_SOURCE_UPLOAD_ID,
      source: 'crawled',
    });
    logger.info('rebuild.register_crawled_images.done', {
      appId,
      candidateCount: files.length,
      registeredCount: result.files.length,
      skippedCount: result.failedFiles.length,
    });
  } catch (error) {
    logger.warn('rebuild.register_crawled_images.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

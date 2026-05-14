/**
 * Media Manifest Service
 *
 * Centralized service for all media manifest (airo-media.json) operations.
 * Provides:
 * - Atomic read-modify-write operations with locking
 * - Automatic git commits on changes
 * - Compare-and-swap semantics to prevent data loss from concurrent updates
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { GitUtils } from '../utils/git.js';
import { logger } from '../logging/index.js';
import { gettyUploadService } from './GettyUploadService.js';
import { astImageEditor } from '../tools/ast-image-editor.js';
import { getPersistentPublicDir } from '../utils/persistent-assets.js';

export const MANIFEST_FILENAME = 'airo-media.json';

/** Result of POST /media/:appId/slots/import (importSlot). Failures include HTTP status for the route. */
export type ImportSlotResult =
  | { success: true; slotPath: string }
  | { success: false; error: string; httpStatus: number };

/**
 * Size configuration for media slots
 */
export interface MediaSize {
  width: number;
  height: number;
  fit: 'cover' | 'contain' | 'crop';
}

/**
 * A single slot entry in the manifest
 */
export interface MediaSlot {
  mediaType: 'image' | 'video' | 'generated' | 'logo';
  currentUrl: string;
  /** For videos: thumbnail image URL for preview display */
  thumbnailUrl?: string;
  searchQuery: string;
  requestedSize?: MediaSize;
  // Search filters used to find this media (stored for re-search context)
  orientations?: string;
  compositions?: string;
  moods?: string;
  graphicalStyles?: string;
  sortOrder?: string;
  color?: string;
  numberOfPeople?: string;
  ethnicity?: string;
  ageOfPeople?: string;
  minimumSize?: string;
  alternatives: string[];
  userModified: boolean;
  createdAt: string;
  lastUpdated: string;
  /** Getty image ID for the current image (undefined for generated/uploaded images) */
  gettyId?: string;
  /** Getty image IDs for alternative images (parallel to alternatives array) */
  alternativeGettyIds?: string[];
  /** Source element reference (fileName:lineNumber) for import dedup — distinguishes
   *  different elements that share the same URL or derived slot path */
  sourceRef?: string;
  /** Maps upload URLs to original chat upload filenames for dedup display.
   *  Key: persistent upload URL (/airo-assets/uploads/...), Value: original chat filename */
  uploadSources?: Record<string, string>;
  /** Maps transparent URL → solid-background URL for logo variants.
   *  Only populated when mediaType === 'logo'. */
  solidUrlMap?: Record<string, string>;
  /** Maps transparent URL → reversed (dark mode) URL for logo variants.
   *  Only populated when mediaType === 'logo'. */
  reversedUrlMap?: Record<string, string>;
  /** Maps transparent URL → reversed solid (dark mode + solid background) URL for logo variants.
   * Only populated when mediaType === 'logo'. */
  reversedSolidUrlMap?: Record<string, string>;
  /** Maps transparent URL → mockup-preview URL for logo variants.
   *  Only populated when mediaType === 'logo'. */
  mockupUrlMap?: Record<string, string>;
  /** Maps transparent URL → { sessionId, logoId } for logo edit traceability.
   *  Only populated when mediaType === 'logo'. Allows edit_logo to find the
   *  source session/logo for any saved logo variant. */
  logoSourceMap?: Record<string, { sessionId: string; logoId: string }>;
}

/**
 * The complete manifest mapping slot paths to slot data
 */
export type MediaManifest = Record<string, MediaSlot>;

/**
 * Options for updating a slot
 */
export interface UpdateSlotOptions {
  /** The new URL to use for this slot */
  newUrl: string;
  /** Index in alternatives array (0 = current, 1+ = alternatives) */
  alternativeIndex?: number;
  /** Mark as user-modified (prevents AI from overwriting) */
  markUserModified?: boolean;
  /** Allow injecting a URL that is not currently in the slot's alternatives (e.g. from user search) */
  allowExternalUrl?: boolean;
  /** Getty image ID to associate with an externally-injected URL (triggers CDN licensing) */
  gettyId?: string;
  /** Update the slot's search query metadata (shown in subtext under slot name) */
  searchQuery?: string;
}

/**
 * Result of a manifest operation
 */
export interface ManifestOperationResult {
  success: boolean;
  error?: string;
  manifest?: MediaManifest;
  slot?: MediaSlot;
  commitHash?: string;
}

// In-memory locks per app to prevent concurrent modifications
const appLocks = new Map<string, Promise<void>>();

/**
 * Acquire a lock for an app's manifest
 * Uses a simple promise-based mutex pattern
 */
async function acquireLock(appId: string): Promise<() => void> {
  // Wait for any existing lock to be released
  while (appLocks.has(appId)) {
    await appLocks.get(appId);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  appLocks.set(appId, lockPromise);

  return () => {
    appLocks.delete(appId);
    releaseLock!();
  };
}

/**
 * Known source directories mapped to their slot category.
 * Matched in order — first match wins.
 */
const SOURCE_DIR_CATEGORIES: [RegExp, string][] = [
  [/pages\/(.+?)\.[tj]sx?$/, 'pages'],
  [/layouts\/(?:parts\/)?(.+?)\.[tj]sx?$/, 'layouts'],
  [/components\/(?:ui\/)?(.+?)\.[tj]sx?$/, 'components'],
  [/sections\/(.+?)\.[tj]sx?$/, 'sections'],
];

/**
 * Derive a media slot path from dev context and image metadata.
 *
 * Slot paths follow the pattern: {category}/{name}/{descriptiveName}
 * e.g. "pages/home/hero", "layouts/header/logo", "components/hero/banner"
 *
 * Priority for the image name segment:
 *  1. Image alt text (most descriptive, e.g. "A happy dog" → "a-happy-dog")
 *  2. Filename from image URL (e.g. "hero-banner.jpg" → "hero-banner")
 *  3. Fallback to "image" with line number
 */
function deriveSlotPath(
  devContext?: { fileName: string; componentName: string; lineNumber: number },
  imageAlt?: string,
  imageUrl?: string,
): string {
  if (!devContext?.fileName) {
    return `imported/image-${Date.now()}`;
  }

  let category = 'pages';
  let segmentName = 'unknown';

  for (const [pattern, cat] of SOURCE_DIR_CATEGORIES) {
    const match = devContext.fileName.match(pattern);
    if (match?.[1]) {
      category = cat;
      segmentName = match[1]
        .replace(/\.page$/, '')     // strip .page suffix if present
        .replace(/\/index$/, '')    // strip /index suffix
        .replace(/^index$/, 'home') // top-level index = home
        .replace(/\//g, '-')       // flatten nested paths
        .toLowerCase();
      break;
    }
  }

  // Image name segment — prefer alt text, then URL filename, then line number
  let imageName = '';

  if (imageAlt?.trim()) {
    imageName = imageAlt.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')  // strip non-alphanumeric
      .replace(/\s+/g, '-')          // spaces to hyphens
      .substring(0, 40);             // keep reasonable length
  }

  if (!imageName && imageUrl && !imageUrl.startsWith('data:')) {
    try {
      const pathname = new URL(imageUrl, 'http://localhost').pathname;
      const filename = pathname.split('/').pop() || '';
      imageName = filename
        .replace(/\.[^.]+$/, '')          // strip extension
        .replace(/[^a-zA-Z0-9-]/g, '-')  // non-alphanum to hyphens
        .replace(/-+/g, '-')             // collapse multiple hyphens
        .replace(/^-|-$/g, '')           // trim leading/trailing hyphens
        .substring(0, 40)
        .toLowerCase();
    } catch {
      // URL parsing failed, fall through
    }
  }

  if (!imageName) {
    imageName = `image-${devContext.lineNumber || Date.now()}`;
  }

  return `${category}/${segmentName}/${imageName}`;
}

const AIRO_PREVIEW_HOST_SUFFIXES = [
  '.airoapp.ai',
  '.test-airoapp.ai',
] as const;

function isAiroPreviewHostname(hostname: string): boolean {
  return (
    hostname.includes('.preview.') &&
    AIRO_PREVIEW_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

/**
 * Normalize an image URL to a local path if it points to the preview server.
 * Browser img.src is fully qualified (e.g. "https://localhost:5009/assets/photo.jpg")
 * but the manifest should store just the path ("/assets/photo.jpg").
 */
function normalizeImageUrl(imageUrl: string): string {
  try {
    const url = new URL(imageUrl);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === 'local.gasket.dev-godaddy.com';
    if (isLocal || isAiroPreviewHostname(url.hostname)) {
      return url.pathname;
    }
  } catch {
    // Not a valid URL, return as-is
  }
  return imageUrl;
}

function isResolvedPathWithinRoot(resolvedFile: string, rootDir: string): boolean {
  const root = path.resolve(rootDir);
  const file = path.resolve(resolvedFile);
  const sep = path.sep;
  return file === root || file.startsWith(root + sep);
}

/**
 * Copy a local file (served by the preview server) into public/media/ so the
 * image-slot handler can serve it via /airo-assets/uploads/.
 *
 * @returns The /airo-assets/uploads/ URL, or null if the file couldn't be found/copied.
 */
async function copyLocalFileToMedia(
  appPath: string,
  localUrlPath: string,
  slotPath: string,
): Promise<string | null> {
  // Resolve local URL path to a filesystem path.
  // Vite serves public/ at root, so /assets/images/x.png → {app}/public/assets/images/x.png
  // getPersistentPublicDir(appPath) (.../assets/public/). Host layout stores files at
  // assets/public/images/... (URL /assets/images/... → relative path images/...), not
  // assets/public/assets/images/... — try preview mirror, then persistent with and without
  // the leading "assets/" segment.
  const sanitizedPath = localUrlPath.replace(/^\/+/, '');
  if (sanitizedPath.split('/').includes('..')) {
    logger.error('media_manifest.copy_local.path_traversal_blocked', { localUrlPath });
    return null;
  }

  const previewPublicRoot = path.resolve(appPath, 'public');
  const persistentPublicRoot = path.resolve(getPersistentPublicDir(appPath));
  const persistentRel = sanitizedPath.replace(/^assets\//, '');

  const candidates = [
    path.resolve(previewPublicRoot, sanitizedPath),
    path.resolve(persistentPublicRoot, persistentRel),
    path.resolve(persistentPublicRoot, sanitizedPath),
  ];
  const uniqueCandidates = [...new Set(candidates)];

  let sourcePath: string | null = null;
  for (const candidate of uniqueCandidates) {
    const underPreview = isResolvedPathWithinRoot(candidate, previewPublicRoot);
    const underPersistent = isResolvedPathWithinRoot(candidate, persistentPublicRoot);
    if (!underPreview && !underPersistent) {
      logger.error('media_manifest.copy_local.path_traversal_blocked', {
        localUrlPath,
        candidate,
      });
      continue;
    }
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) {
        continue;
      }
      sourcePath = candidate;
      break;
    } catch {
      // try next candidate
    }
  }

  if (!sourcePath) {
    logger.warn('media_manifest.copy_local.source_not_found', {
      localUrlPath,
      triedPaths: uniqueCandidates,
    });
    return null;
  }

  // Ensure public/media/ exists
  const mediaDir = path.join(appPath, 'public', 'media');
  await fs.mkdir(mediaDir, { recursive: true });

  // Read file and generate a content-hash filename
  const fileBuffer = await fs.readFile(sourcePath);
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 8);
  const ext = path.extname(localUrlPath) || '.jpg';
  const sanitizedSlot = slotPath.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
  const filename = `${sanitizedSlot}-${hash}${ext}`;

  const destPath = path.join(mediaDir, filename);
  const tmpPath = `${destPath}.tmp.${Date.now()}`;
  await fs.writeFile(tmpPath, fileBuffer);
  await fs.rename(tmpPath, destPath);

  logger.info('media_manifest.copy_local.success', {
    source: localUrlPath,
    dest: filename,
  });

  return `/airo-assets/uploads/${filename}`;
}

/**
 * For a logo slot, rewrite a non-transparent currentUrl to its transparent sibling
 * if one exists in the slot's variant maps. Returns the URL to use.
 *
 * Why: solid/reversed variants have backgrounds that produce visible borders when
 * placed on a website. The slot's solidUrlMap and reversedUrlMap are keyed by the
 * transparent URL, so a reverse lookup gives us the canonical transparent variant.
 */
function resolveTransparentLogoUrl(
  slot: MediaSlot,
  candidateUrl: string,
): { url: string; rewritten: boolean } {
  if (slot.mediaType !== 'logo') {
    return { url: candidateUrl, rewritten: false };
  }

  for (const [transparent, solid] of Object.entries(slot.solidUrlMap || {})) {
    if (solid === candidateUrl) {
      return { url: transparent, rewritten: true };
    }
  }
  for (const [transparent, reversed] of Object.entries(slot.reversedUrlMap || {})) {
    if (reversed === candidateUrl) {
      return { url: transparent, rewritten: true };
    }
  }
  for (const [transparent, reversedSolid] of Object.entries(slot.reversedSolidUrlMap || {})) {
    if (reversedSolid === candidateUrl) {
      return { url: transparent, rewritten: true };
    }
  }

  return { url: candidateUrl, rewritten: false };
}

/**
 * Service for managing the media manifest file with proper locking and git integration
 */
export class MediaManifestService {
  private appRepository: AppRepository;

  constructor() {
    this.appRepository = new AppRepository();
  }

  /**
   * Get the manifest path for an app
   */
  private getManifestPath(appPath: string): string {
    return path.join(appPath, MANIFEST_FILENAME);
  }

  /**
   * Write the manifest atomically (temp file + rename).
   */
  private async writeManifest(manifestPath: string, manifest: MediaManifest): Promise<void> {
    const tempPath = `${manifestPath}.tmp`;
    const content = JSON.stringify(manifest, null, 2);
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, manifestPath);
  }

  /**
   * Read the current manifest for an app (does not acquire lock)
   */
  async getManifest(appId: string): Promise<ManifestOperationResult> {
    const app = this.appRepository.findById(appId);
    if (!app) {
      return {
        success: false,
        error: `App not found: ${appId}`,
      };
    }

    const manifestPath = this.getManifestPath(app.path);

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as MediaManifest;
      return {
        success: true,
        manifest,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist - return empty manifest
        return {
          success: true,
          manifest: {},
        };
      }
      return {
        success: false,
        error: `Failed to read manifest: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get a specific slot from the manifest
   */
  async getSlot(appId: string, slotName: string): Promise<ManifestOperationResult> {
    const result = await this.getManifest(appId);
    if (!result.success || !result.manifest) {
      return result;
    }

    const slot = result.manifest[slotName];
    if (!slot) {
      return {
        success: false,
        error: `Slot not found: ${slotName}`,
      };
    }

    return {
      success: true,
      slot,
      manifest: result.manifest,
    };
  }

  /**
   * Import a new slot into the manifest, deriving the slot path from dev context.
   * If a slot with the derived path already exists, appends a counter suffix.
   */
  async importSlot(
    appId: string,
    options: {
      imageUrl: string;
      devContext?: { fileName: string; componentName: string; lineNumber: number };
      imageAlt?: string;
      imageType?: 'img' | 'background';
    }
  ): Promise<ImportSlotResult> {
    const release = await acquireLock(appId);

    try {
      const result = await this.getManifest(appId);
      if (!result.success || !result.manifest) {
        return {
          success: false,
          error: result.error || 'Failed to read manifest',
          httpStatus: 500,
        };
      }

      const manifest = result.manifest;

      // Normalize localhost URLs to local paths FIRST for dedup checks
      let normalizedUrl = normalizeImageUrl(options.imageUrl);

      // Build a source reference from devContext to distinguish different elements
      // that share the same URL or derived slot path (e.g., same logo in header + footer)
      const sourceRef = options.devContext
        ? `${options.devContext.fileName}:${options.devContext.lineNumber}`
        : undefined;

      // Dedup 1: If any existing slot has this exact source URL AND was imported
      // from the same source element, return it. The sourceRef check prevents
      // merging distinct elements that happen to share a URL.
      const existingByUrl = Object.entries(manifest).find(
        ([_, slot]) => slot.currentUrl === normalizedUrl && (!slot.sourceRef || slot.sourceRef === sourceRef)
      );

      if (existingByUrl) {
        logger.info('media_manifest.import_slot.duplicate_prevented', {
          appId,
          existingSlotPath: existingByUrl[0],
          imageUrl: options.imageUrl.substring(0, 200),
          reason: 'url_and_source_match',
        });
        return { success: true, slotPath: existingByUrl[0] };
      }

      let slotPath = deriveSlotPath(options.devContext, options.imageAlt, options.imageUrl);

      // Dedup 2: If the derived path exists, check sourceRef to distinguish
      // re-import of the same element vs a different element with the same path.
      const existingSlot = manifest[slotPath];
      if (existingSlot) {
        if (!existingSlot.sourceRef || existingSlot.sourceRef === sourceRef) {
          // Same element re-imported, or old slot without sourceRef (backward compat)
          logger.info('media_manifest.import_slot.duplicate_prevented', {
            appId,
            existingSlotPath: slotPath,
            imageUrl: options.imageUrl.substring(0, 200),
            reason: 'path_and_source_match',
          });
          return { success: true, slotPath };
        }
        // Different element with same derived path — use counter suffix
        let counter = 2;
        while (manifest[`${slotPath}-${counter}`]) {
          counter++;
        }
        slotPath = `${slotPath}-${counter}`;
      }

      // If the URL is a local path (e.g. /assets/photo.jpg), copy the file into
      // public/media/ so the image-slot handler can serve it via /airo-assets/uploads/.
      // Without this, the image manager shows broken images for local files.
      const app = this.appRepository.findById(appId);
      if (!app?.path) {
        return { success: false, error: 'App not found', httpStatus: 404 };
      }

      // Preserve the pre-copy URL for AST matching — this is what the source
      // code actually contains. After copyLocalFileToMedia, normalizedUrl
      // becomes /airo-assets/uploads/... which won't match the source.
      const sourceFileUrl = normalizedUrl;

      logger.info('media_manifest.import_slot.copy_local_begin', {
        appId,
        slotPath,
        normalizedUrl,
      });
      if (normalizedUrl.startsWith('/') && !normalizedUrl.startsWith('/airo-assets/')) {
        const uploadUrl = await copyLocalFileToMedia(app.path, normalizedUrl, slotPath);
        if (!uploadUrl) {
          logger.error('media_manifest.import_slot.copy_local_failed', {
            appId,
            slotPath,
            localPath: normalizedUrl,
          });
          return {
            success: false,
            error:
              'Could not read the image under public/ in the app workspace. Ensure the file exists (e.g. public/assets/images/...), then use Replace again.',
            httpStatus: 400,
          };
        }
        normalizedUrl = uploadUrl;
      }

      const now = new Date().toISOString();
      manifest[slotPath] = {
        mediaType: 'image',
        currentUrl: normalizedUrl,
        searchQuery: '',
        alternatives: [normalizedUrl],
        userModified: false,
        sourceRef,
        createdAt: now,
        lastUpdated: now,
      };

      const manifestPath = this.getManifestPath(app.path);
      await this.writeManifest(manifestPath, manifest);

      // Update the source file to use the new slot URL via AST-based replacement
      const newSlotUrl = `/airo-assets/images/${slotPath}`;
      if (options.devContext) {
        try {
          const replaceResult = await astImageEditor.replaceImage(app.path, {
            elementInfo: {
              tagName: options.imageType === 'background' ? 'div' : 'img',
              className: '',
              id: '',
              selector: '',
              devContext: options.devContext,
            },
            imageInfo: {
              type: options.imageType || 'img',
              currentUrl: sourceFileUrl,
            },
            newImageUrl: newSlotUrl,
          }, appId);

          if (replaceResult.success) {
            logger.info('media_manifest.import_slot.source_updated', {
              appId,
              slotPath,
              fileName: options.devContext.fileName,
            });
          } else {
            logger.warn('media_manifest.import_slot.source_update_failed', {
              appId,
              slotPath,
              fileName: options.devContext.fileName,
              error: replaceResult.error,
            });
          }
        } catch (sourceError) {
          // Log but don't fail - manifest import was still successful
          logger.warn('media_manifest.import_slot.source_update_failed', {
            appId,
            slotPath,
            fileName: options.devContext.fileName,
            error: sourceError instanceof Error ? sourceError.message : String(sourceError),
          });
        }
      }

      // Commit to git (includes both manifest and source file changes)
      const additionalFiles = options.devContext?.fileName ? [options.devContext.fileName] : undefined;
      try {
        await this.commitManifestChange(appId, slotPath, 'create', additionalFiles);
      } catch (gitError) {
        // Log but don't fail - the file change was successful
        logger.warn('media_manifest.import_slot.git_commit_failed', {
          appId,
          slotPath,
          error: gitError instanceof Error ? gitError.message : String(gitError),
        });
      }

      logger.info('media_manifest.import_slot.success', { appId, slotPath, imageUrl: options.imageUrl.substring(0, 200) });

      return { success: true, slotPath };
    } catch (error) {
      logger.error('media_manifest.import_slot.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: 'Failed to import slot', httpStatus: 500 };
    } finally {
      release();
    }
  }

  /**
   * Update a slot in the manifest with proper locking and git commit
   *
   * This is the main method for making changes to the manifest.
   * It acquires a lock, reads the current state, applies the update,
   * writes the file atomically, and commits to git.
   */
  async updateSlot(
    appId: string,
    slotName: string,
    options: UpdateSlotOptions
  ): Promise<ManifestOperationResult> {
    const app = this.appRepository.findById(appId);
    if (!app) {
      return {
        success: false,
        error: `App not found: ${appId}`,
      };
    }

    const logContext = { appId, slotName };
    logger.info('media_manifest.update_slot.begin', logContext);

    // Acquire lock for this app
    const releaseLock = await acquireLock(appId);

    try {
      const manifestPath = this.getManifestPath(app.path);

      // Read current manifest
      let manifest: MediaManifest = {};
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('media_manifest.update_slot.read_error', {
            ...logContext,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        // File doesn't exist or is corrupt - start fresh
        manifest = {};
      }

      // Get the existing slot
      const existingSlot = manifest[slotName];
      if (!existingSlot) {
        return {
          success: false,
          error: `Slot not found: ${slotName}`,
        };
      }

      // Build all URLs list (current + alternatives)
      const allUrls = [existingSlot.currentUrl, ...existingSlot.alternatives];

      // Validate the new URL is in the list
      const urlIndex = options.alternativeIndex ?? allUrls.indexOf(options.newUrl);

      let newCurrentUrl: string;
      let newAlternatives: string[];
      let newCurrentGettyId: string | undefined;
      let newAlternativeGettyIds: string[];

      if (urlIndex === -1 || urlIndex >= allUrls.length) {
        // Allow injecting an existing uploaded image URL that isn't in this slot yet
        if (options.newUrl && options.newUrl.startsWith('/airo-assets/uploads/')) {
          newCurrentUrl = options.newUrl;
          newAlternatives = [...new Set(allUrls)].filter((url) => url !== options.newUrl);
          newCurrentGettyId = undefined;

          // Build URL→GettyID map to maintain alignment after dedup
          const altGettyIds = existingSlot.alternativeGettyIds || [];
          const urlToGettyId = new Map<string, string>();
          urlToGettyId.set(existingSlot.currentUrl, existingSlot.gettyId || '');
          existingSlot.alternatives.forEach((url, i) => {
            if (!urlToGettyId.has(url)) {
              urlToGettyId.set(url, altGettyIds[i] || '');
            }
          });
          newAlternativeGettyIds = newAlternatives.map((url) => urlToGettyId.get(url) || '');
        } else if (options.allowExternalUrl && options.newUrl.startsWith('http')) {
          // Allow injecting an arbitrary URL from user-driven search (e.g. Getty search panel).
          // The existing allUrls remain as alternatives; the injected URL becomes current.
          newCurrentUrl = options.newUrl;
          newCurrentGettyId = options.gettyId || undefined;
          const altGettyIds = existingSlot.alternativeGettyIds || [];
          const urlToGettyId = new Map<string, string>();
          urlToGettyId.set(existingSlot.currentUrl, existingSlot.gettyId || '');
          existingSlot.alternatives.forEach((url, i) => {
            if (!urlToGettyId.has(url)) {
              urlToGettyId.set(url, altGettyIds[i] || '');
            }
          });
          newAlternatives = [...new Set(allUrls)];
          newAlternativeGettyIds = newAlternatives.map((url) => urlToGettyId.get(url) || '');
        } else {
          return {
            success: false,
            error: 'Invalid URL or alternative index',
          };
        }
      } else {
        // Swap: new URL becomes current, remove ALL occurrences from alternatives.
        // Use a URL→GettyID map to maintain alignment after deduplication.
        const altGettyIds = existingSlot.alternativeGettyIds || [];
        const urlToGettyId = new Map<string, string>();
        urlToGettyId.set(existingSlot.currentUrl, existingSlot.gettyId || '');
        existingSlot.alternatives.forEach((url, i) => {
          if (!urlToGettyId.has(url)) {
            urlToGettyId.set(url, altGettyIds[i] || '');
          }
        });

        newCurrentUrl = allUrls[urlIndex]!;
        newCurrentGettyId = urlToGettyId.get(newCurrentUrl) || undefined;
        newAlternatives = [...new Set(allUrls.filter((url) => url !== newCurrentUrl))];
        newAlternativeGettyIds = newAlternatives.map((url) => urlToGettyId.get(url) || '');
      }

      // If the newly-active image has a Getty ID, upload it to CDN and report usage
      if (newCurrentGettyId) {
        const uploadResults = await gettyUploadService.uploadAndReport([newCurrentGettyId]);
        if (uploadResults.length > 0 && uploadResults[0]?.url) {
          newCurrentUrl = uploadResults[0].url;
          logger.info('media_manifest.update_slot.getty_upload_complete', {
            ...logContext,
            gettyId: newCurrentGettyId,
            cdnUrl: newCurrentUrl,
          });
        } else if (options.allowExternalUrl) {
          // Search-selected URLs are watermarked comp images — never persist without a CDN URL.
          logger.warn('media_manifest.update_slot.getty_cdn_upload_failed', {
            ...logContext,
            gettyId: newCurrentGettyId,
          });
          return { success: false, error: 'Failed to license Getty image. Please try again.' };
        }
      }

      // Enforce transparent-logo invariant: if newCurrentUrl resolves to a solid or
      // reversed variant, rewrite to the transparent sibling so generated websites
      // never render logos with backgrounds.
      const resolved = resolveTransparentLogoUrl(existingSlot, newCurrentUrl);
      if (resolved.rewritten) {
        logger.warn('media_manifest.logo.non_transparent_rewritten', {
          ...logContext,
          originalUrl: newCurrentUrl,
          transparentUrl: resolved.url,
        });
        newCurrentUrl = resolved.url;
        // Drop any duplicate of the rewritten URL from alternatives; keep gettyIds aligned.
        const keptIndices = newAlternatives
          .map((url, i) => (url === newCurrentUrl ? -1 : i))
          .filter((i) => i >= 0);
        newAlternatives = keptIndices.map((i) => newAlternatives[i]!);
        newAlternativeGettyIds = keptIndices.map((i) => newAlternativeGettyIds[i] || '');
      }

      // Update the slot
      const updatedSlot: MediaSlot = {
        ...existingSlot,
        currentUrl: newCurrentUrl,
        alternatives: newAlternatives,
        userModified: options.markUserModified ?? true,
        lastUpdated: new Date().toISOString(),
        gettyId: newCurrentGettyId,
        alternativeGettyIds: newAlternativeGettyIds.some((id) => id)
          ? newAlternativeGettyIds
          : undefined,
        ...(options.searchQuery !== undefined && { searchQuery: options.searchQuery }),
      };

      manifest[slotName] = updatedSlot;

      // Write manifest and versions file atomically
      await this.writeManifest(manifestPath, manifest);

      logger.info('media_manifest.update_slot.written', {
        ...logContext,
        newUrl: newCurrentUrl,
      });

      // Commit to git
      let commitHash: string | undefined;
      try {
        commitHash = await this.commitManifestChange(appId, slotName, 'update');
      } catch (gitError) {
        // Log but don't fail - the file change was successful
        logger.warn('media_manifest.update_slot.git_commit_failed', {
          ...logContext,
          error: gitError instanceof Error ? gitError.message : String(gitError),
        });
      }

      logger.info('media_manifest.update_slot.success', {
        ...logContext,
        commitHash,
      });

      return {
        success: true,
        slot: updatedSlot,
        manifest,
        commitHash,
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * Update a slot with an uploaded image URL
   * The uploaded URL becomes current, old current moves to alternatives
   */
  async updateSlotWithUpload(
    appId: string,
    slotName: string,
    uploadedUrl: string,
    sourceFilename?: string
  ): Promise<ManifestOperationResult> {
    const app = this.appRepository.findById(appId);
    if (!app) {
      return {
        success: false,
        error: `App not found: ${appId}`,
      };
    }

    const logContext = { appId, slotName, uploadedUrl };
    logger.info('media_manifest.upload_slot.begin', logContext);

    const releaseLock = await acquireLock(appId);

    try {
      const manifestPath = this.getManifestPath(app.path);

      // Read current manifest
      let manifest: MediaManifest = {};
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('media_manifest.upload_slot.read_error', {
            ...logContext,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        manifest = {};
      }

      // Get existing slot
      const existingSlot = manifest[slotName];
      if (!existingSlot) {
        return {
          success: false,
          error: `Slot not found: ${slotName}`,
        };
      }

      // Build URL→GettyID map from current state for alignment-safe operations
      const altGettyIds = existingSlot.alternativeGettyIds || [];
      const urlToGettyId = new Map<string, string>();
      urlToGettyId.set(existingSlot.currentUrl, existingSlot.gettyId || '');
      existingSlot.alternatives.forEach((url, i) => {
        if (!urlToGettyId.has(url)) {
          urlToGettyId.set(url, altGettyIds[i] || '');
        }
      });

      // Move current URL to alternatives (if it's not already the uploaded URL)
      let newAlternatives: string[];

      if (existingSlot.currentUrl !== uploadedUrl) {
        newAlternatives = [existingSlot.currentUrl, ...existingSlot.alternatives];
      } else {
        newAlternatives = existingSlot.alternatives;
      }

      // Deduplicate alternatives (repeated uploads/swaps can cause duplicates)
      const deduplicatedAlternatives = [...new Set(newAlternatives)]
        .filter((url) => url !== uploadedUrl);

      // Rebuild Getty IDs aligned with deduped alternatives
      const newAlternativeGettyIds = deduplicatedAlternatives.map(
        (url) => urlToGettyId.get(url) || ''
      );

      // Track which chat upload produced this persistent URL
      const updatedUploadSources = { ...(existingSlot.uploadSources || {}) };
      if (sourceFilename) {
        updatedUploadSources[uploadedUrl] = sourceFilename;
      }

      // Update slot with uploaded URL as current
      const updatedSlot: MediaSlot = {
        ...existingSlot,
        currentUrl: uploadedUrl,
        alternatives: deduplicatedAlternatives,
        userModified: true,
        lastUpdated: new Date().toISOString(),
        searchQuery: '',  // upload is unrelated to any prior search term
        gettyId: undefined, // Uploaded image has no Getty ID
        alternativeGettyIds: newAlternativeGettyIds.some((id) => id)
          ? newAlternativeGettyIds
          : undefined,
        uploadSources: Object.keys(updatedUploadSources).length > 0
          ? updatedUploadSources
          : undefined,
      };

      manifest[slotName] = updatedSlot;

      // Write manifest and versions file atomically
      await this.writeManifest(manifestPath, manifest);

      // Commit manifest to git (media file is in persistent storage, not the workspace)
      let commitHash: string | undefined;
      try {
        commitHash = await this.commitManifestChange(appId, slotName, 'update');
      } catch (gitError) {
        logger.warn('media_manifest.upload_slot.git_commit_failed', {
          ...logContext,
          error: gitError instanceof Error ? gitError.message : String(gitError),
        });
      }

      logger.info('media_manifest.upload_slot.success', {
        ...logContext,
        commitHash,
      });

      return {
        success: true,
        slot: updatedSlot,
        manifest,
        commitHash,
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * Create or update a slot (used by the media slot tool during selection)
   */
  async setSlot(
    appId: string,
    slotName: string,
    slot: MediaSlot,
    skipGitCommit: boolean = false
  ): Promise<ManifestOperationResult> {
    const app = this.appRepository.findById(appId);
    if (!app) {
      return {
        success: false,
        error: `App not found: ${appId}`,
      };
    }

    const logContext = { appId, slotName };
    logger.info('media_manifest.set_slot.begin', logContext);

    // Acquire lock for this app
    const releaseLock = await acquireLock(appId);

    try {
      const manifestPath = this.getManifestPath(app.path);

      // Read current manifest
      let manifest: MediaManifest = {};
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('media_manifest.set_slot.read_error', {
            ...logContext,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        manifest = {};
      }

      // Preserve createdAt and userModified from existing slot
      const existing = manifest[slotName];
      if (existing) {
        slot.createdAt = existing.createdAt;
        if (existing.userModified) {
          slot.userModified = true;
        }
      }

      // Upload Getty images to CDN and replace preview URLs
      if (slot.gettyId) {
        const allGettyIds = [slot.gettyId, ...(slot.alternativeGettyIds || [])];
        const uploadResults = await gettyUploadService.uploadAndReport(allGettyIds);

        if (uploadResults.length > 0) {
          const resultMap = new Map(uploadResults.map(r => [r.id, r.url]));

          // Replace current URL if we got a CDN URL for it
          const cdnUrl = resultMap.get(slot.gettyId);
          if (cdnUrl) {
            slot.currentUrl = cdnUrl;
          }

          // Replace alternative URLs where we got CDN URLs
          if (slot.alternativeGettyIds && slot.alternativeGettyIds.length > 0) {
            slot.alternatives = slot.alternatives.map((altUrl, i) => {
              const altId = slot.alternativeGettyIds?.[i];
              if (altId) {
                return resultMap.get(altId) || altUrl;
              }
              return altUrl;
            });
          }

          logger.info('media_manifest.set_slot.getty_upload_complete', {
            ...logContext,
            uploadedCount: uploadResults.length,
            requestedCount: allGettyIds.length,
          });
        }
      }

      // Enforce transparent-logo invariant: if currentUrl resolves to a solid or reversed
      // variant, rewrite to the transparent sibling so generated websites never render
      // logos with backgrounds.
      const resolved = resolveTransparentLogoUrl(slot, slot.currentUrl);
      if (resolved.rewritten) {
        logger.warn('media_manifest.logo.non_transparent_rewritten', {
          ...logContext,
          originalUrl: slot.currentUrl,
          transparentUrl: resolved.url,
        });
        slot.currentUrl = resolved.url;
      }

      // Update the slot
      manifest[slotName] = slot;

      // Write manifest and versions file atomically
      await this.writeManifest(manifestPath, manifest);

      logger.info('media_manifest.set_slot.written', logContext);

      // Commit to git (unless skipped, e.g., during batch operations)
      let commitHash: string | undefined;
      if (!skipGitCommit) {
        try {
          const operation = existing ? 'update' : 'create';
          commitHash = await this.commitManifestChange(appId, slotName, operation);
        } catch (gitError) {
          logger.warn('media_manifest.set_slot.git_commit_failed', {
            ...logContext,
            error: gitError instanceof Error ? gitError.message : String(gitError),
          });
        }
      }

      logger.info('media_manifest.set_slot.success', {
        ...logContext,
        commitHash,
      });

      return {
        success: true,
        slot,
        manifest,
        commitHash,
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * Commit manifest changes to git
   * @param additionalFiles - Optional array of additional files to stage (relative to app.path)
   */
  private async commitManifestChange(
    appId: string,
    slotName: string,
    operation: 'create' | 'update' | 'delete',
    additionalFiles?: string[]
  ): Promise<string | undefined> {
    try {
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor || !devSupervisor.isAvailable()) {
        logger.debug('media_manifest.git_commit.no_supervisor', { appId });
        return undefined;
      }

      const gitUtils = new GitUtils(devSupervisor);
      const app = this.appRepository.findById(appId);
      if (!app) {
        return undefined;
      }

      // Stage the manifest file and any additional files
      const filesToStage = [MANIFEST_FILENAME, ...(additionalFiles || [])];
      const addResult = await gitUtils.addFiles(app.path, filesToStage);
      if (!addResult.success) {
        logger.warn('media_manifest.git_commit.add_failed', {
          appId,
          stderr: addResult.stderr,
        });
        return undefined;
      }

      // Check if there are changes to commit
      const status = await gitUtils.getStatus(app.path);
      if (status.stagedFiles === 0) {
        logger.debug('media_manifest.git_commit.no_changes', { appId });
        return undefined;
      }

      // Create commit message
      const messages: Record<string, string> = {
        create: `Add media slot: ${slotName}`,
        update: `Update media slot: ${slotName}`,
        delete: `Remove media slot: ${slotName}`,
      };
      const message = messages[operation] || `Update media manifest`;

      // Commit
      const commitResult = await gitUtils.commit(app.path, message);
      if (!commitResult.success) {
        logger.warn('media_manifest.git_commit.commit_failed', {
          appId,
          stderr: commitResult.stderr,
        });
        return undefined;
      }

      // Get the commit hash
      const lastCommit = await gitUtils.getLastCommit(app.path);
      return lastCommit?.hash;
    } catch (error) {
      logger.warn('media_manifest.git_commit.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}

// Export singleton instance
export const mediaManifestService = new MediaManifestService();

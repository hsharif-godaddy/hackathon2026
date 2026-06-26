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
import { AIRO_ASSET_UPLOADS_URL_PREFIX } from '@airo/shared/media';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { createForWorkspace } from '../workspace/index.js';
import { GitUtils } from '../utils/git.js';
import { logger } from '../logging/index.js';
import { gettyUploadService } from './GettyUploadService.js';
import { astImageEditor } from '../tools/ast-image-editor.js';
import type { ImageElementInfo, ImageInfo } from '../tools/ast-image-editor.js';
import { getPersistentPublicDir } from '../utils/persistent-assets.js';
import { fileUploadService } from './FileUploadService.js';
import { imageProcessingService } from './ImageProcessingService.js';
import { ALLOWED_VIDEO_TYPES, validateVideoMagicBytes } from './media-upload-video.js';
import type { SlotEligibleAssetRole } from './upload-handling-guidance.js';
import {
  buildForkedSlotPath,
  countSlotUrlReferences,
  imageSlotUrl,
  isSharedSlotReference,
  parseCollectionOccurrenceIndex,
} from '../utils/slot-reference-utils.js';

export const MANIFEST_FILENAME = 'airo-media.json';

export type ImportChatUploadResult =
  | {
      success: true;
      slotPath: string;
      slotUrl: string;
      uploadedUrl: string;
      slot: MediaSlot;
      commitHash?: string;
      /** True when the AIROBUILD-2789 guard fired: the canonical role slot was user-customized and the upload was routed to a fresh `uploads/<role>-<slug>` slot instead. The caller uses this to adjust agent guidance so the rendered hero/background isn't silently displaced. */
      deflectedFromCanonical?: boolean;
    }
  | { success: false; error: string; httpStatus?: number };

function slugFromChatUploadFilename(filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const slug = base
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .substring(0, 40);
  return slug || 'image';
}

export function deriveChatUploadSlotPath(
  manifest: MediaManifest,
  options: {
    filename: string;
    slotName?: string;
    assetRole?: SlotEligibleAssetRole | null;
  }
): string {
  if (options.slotName) {
    return options.slotName.trim().replace(/^\/+|\/+$/g, '');
  }

  const slug = slugFromChatUploadFilename(options.filename);
  const prefix = options.assetRole === 'background' ? 'uploads/background' : 'uploads/hero';
  const slotPath = `${prefix}-${slug}`;
  if (!manifest[slotPath]) {
    return slotPath;
  }

  let counter = 2;
  while (manifest[`${slotPath}-${counter}`]) {
    counter++;
  }
  return `${slotPath}-${counter}`;
}

const ASSET_ROLE_SUFFIXES: Record<string, string[]> = {
  hero_image: ['hero'],
  background: ['background', 'bg'],
}

/**
 * Find the established slot that serves the given asset role, identified by the
 * slot path's last segment matching a known role suffix (e.g. "hero_image"
 * matches paths whose last segment is "hero"). Used so auto-register updates the
 * canonical hero/background slot rather than creating a parallel
 * "uploads/hero-..." slot alongside it.
 *
 * Disambiguation when more than one slot matches (e.g. pages/home/hero AND
 * pages/about/hero): a single match is returned directly; with multiple
 * matches we prefer a "home" slot (the primary hero), and only if exactly one
 * home slot matches do we return it. Otherwise we return undefined so the
 * caller derives a fresh slot rather than silently overwriting the wrong one
 * (the wrong-slot failure mode behind AIROBUILD-2364).
 *
 * Caller must check the returned slot is untouched scaffold before overwriting (AIROBUILD-2789).
 */
function findSlotByAssetRole(
  manifest: MediaManifest,
  assetRole: string,
): string | undefined {
  const suffixes = ASSET_ROLE_SUFFIXES[assetRole]
  if (!suffixes) return undefined
  const matches = Object.keys(manifest).filter((slotPath) => {
    const segment = slotPath.split('/').pop() ?? slotPath
    return suffixes.includes(segment)
  })
  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]
  // Ambiguous — use the "home" slot only if exactly one matches, else don't guess.
  const homeMatches = matches.filter((slotPath) =>
    slotPath.split('/').includes('home')
  )
  return homeMatches.length === 1 ? homeMatches[0] : undefined
}


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
  /** Concise descriptive caption (max ~6 words). Used as alt text, default search query, and UI sublabel. */
  caption?: string;
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
  /** URLs of AI-generated media for this slot (from generate_video tool) */
  aiGeneratedUrls?: string[];
  /** Source element reference (fileName:lineNumber) for import dedup — distinguishes
   *  different elements that share the same URL or derived slot path */
  sourceRef?: string;
  /** Maps upload URLs to original chat upload filenames for dedup display.
   *  Key: persistent upload URL (/airo-assets/uploads/...), Value: original chat filename */
  uploadSources?: Record<string, string>;
  /** sha256 of the raw bytes of the chat upload backing this slot. Stable
   *  identity for "same image" dedup across re-uploads (the stored filename is
   *  not, since it embeds a timestamp). Set only for chat-upload-backed slots. */
  uploadContentHash?: string;
  /** Maps transparent URL → solid-background URL for logo variants.
   *  Only populated when mediaType === 'logo'. */
  solidUrlMap?: Record<string, string>;
  /** Maps transparent URL → mockup-preview URL for logo variants.
   *  Only populated when mediaType === 'logo'. */
  mockupUrlMap?: Record<string, string>;
  /** Maps transparent URL → landscape mockup URL for logo variants.
   *  Only populated when mediaType === 'logo'. */
  landscapeMockupUrlMap?: Record<string, string>;
  logoSourceMap?: Record<string, { sessionId: string; logoId: string }>;
  /** Aspect-ratio classification of the upload, set when dimensions are available. */
  naturalOrientation?: LogoOrientation;
  /** Set while a background logo job is populating this slot (shimmer placeholder /
   *  mid-regeneration). Cleared on completion, cancel, or failure. */
  pendingJobId?: string;
}

export type LogoOrientation = 'square' | 'horizontal' | 'vertical';

export const LOGO_NATURAL_SLOT_PATHS: Record<LogoOrientation, string> = {
  square: 'logo/primary',
  horizontal: 'logo/horizontal',
  vertical: 'logo/vertical',
};

/** Variant-map fields whose keys are tied to the prior `currentUrl` and must
 *  be dropped on upload — otherwise the supervisor resolver silently
 *  mis-resolves `?variant=solid` to a stale AI URL. */
const LOGO_VARIANT_MAP_FIELDS = [
  'solidUrlMap',
  'mockupUrlMap',
  'landscapeMockupUrlMap',
  'logoSourceMap',
] as const satisfies readonly (keyof MediaSlot)[];

/** ±15% from 1:1 is the perceptual "is this a square?" tolerance. */
export function classifyOrientation({ width, height }: { width: number; height: number }): LogoOrientation | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const ratio = width / height;
  if (ratio > 1.18) return 'horizontal';
  if (ratio < 0.85) return 'vertical';
  return 'square';
}

function clearLogoVariantMaps(): Partial<MediaSlot> {
  return Object.fromEntries(LOGO_VARIANT_MAP_FIELDS.map((field) => [field, undefined])) as Partial<MediaSlot>;
}

function buildSiblingLogoSlot(
  existing: MediaSlot | undefined,
  uploadedUrl: string,
  sourceFilename: string | undefined,
  naturalOrientation: LogoOrientation,
  nowIso: string,
): MediaSlot {
  const uploadSources = sourceFilename ? { [uploadedUrl]: sourceFilename } : undefined;

  if (!existing) {
    return {
      mediaType: 'logo',
      currentUrl: uploadedUrl,
      searchQuery: '',
      alternatives: [],
      userModified: true,
      createdAt: nowIso,
      lastUpdated: nowIso,
      naturalOrientation,
      ...(uploadSources && { uploadSources }),
    };
  }

  const carriedAlternatives = existing.currentUrl && existing.currentUrl !== uploadedUrl
    ? [existing.currentUrl, ...existing.alternatives]
    : existing.alternatives;
  const dedupedAlternatives = [...new Set(carriedAlternatives)].filter((url) => url !== uploadedUrl);

  const mergedUploadSources = {
    ...(existing.uploadSources || {}),
    ...(sourceFilename ? { [uploadedUrl]: sourceFilename } : {}),
  };

  return {
    ...existing,
    currentUrl: uploadedUrl,
    alternatives: dedupedAlternatives,
    userModified: true,
    lastUpdated: nowIso,
    searchQuery: '',
    gettyId: undefined,
    alternativeGettyIds: undefined,
    naturalOrientation,
    uploadSources: Object.keys(mergedUploadSources).length > 0 ? mergedUploadSources : undefined,
    ...clearLogoVariantMaps(),
  };
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
  /** Getty asset to associate with an externally-injected URL (triggers CDN licensing) */
  gettyAsset?: { id: string; mediaType: 'image' | 'video' };
  /** Media type hint when no Getty asset is provided (for video/image detection without CDN licensing) */
  mediaTypeHint?: 'image' | 'video';
  /** Update the slot's search query metadata (shown in subtext under slot name) */
  searchQuery?: string;
}

/** Element context for forking a shared slot to one DOM instance. */
export interface SlotForkContext {
  devContext: { fileName: string; componentName: string; lineNumber: number };
  elementInfo: ImageElementInfo;
  imageInfo: ImageInfo;
  selector?: string;
}

/**
 * Result of a manifest operation
 */
export interface ManifestOperationResult {
  success: boolean;
  error?: string;
  manifest?: MediaManifest;
  slot?: MediaSlot;
  /** Pre-CDN-rewrite snapshot of the chosen slot. */
  builtSlot?: MediaSlot;
  commitHash?: string;
  /** Set when manifest/source writes succeeded but git commit failed */
  commitFailed?: boolean;
  slotPath?: string;
}

export type UpdateSlotOrForkResult = ManifestOperationResult & {
  forked?: boolean;
  originalSlotPath?: string;
  attemptedFork?: boolean;
};

export interface RemoveUploadedUrlsResult extends ManifestOperationResult {
  affectedSlots?: string[];
  removedUrls?: string[];
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

/** Media types that should not be overwritten by image/video swap logic */
function isProtectedMediaType(mediaType: MediaSlot['mediaType']): boolean {
  return mediaType === 'logo' || mediaType === 'generated';
}

/** Resolve the new mediaType for a slot during a swap or upload */
function resolveMediaTypeUpdate(
  existingMediaType: MediaSlot['mediaType'],
  isVideo: boolean,
  isImage: boolean,
): Partial<Pick<MediaSlot, 'mediaType'>> {
  if (isVideo && !isProtectedMediaType(existingMediaType)) {
    return { mediaType: 'video' };
  }
  if (isImage && existingMediaType === 'video') {
    return { mediaType: 'image' };
  }
  return {};
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
  imageUrl?: string
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
        .replace(/\.page$/, '') // strip .page suffix if present
        .replace(/\/index$/, '') // strip /index suffix
        .replace(/^index$/, 'home') // top-level index = home
        .replace(/\//g, '-') // flatten nested paths
        .toLowerCase();
      break;
    }
  }

  // Image name segment — prefer alt text, then URL filename, then line number
  let imageName = '';

  if (imageAlt?.trim()) {
    imageName = imageAlt
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // strip non-alphanumeric
      .replace(/\s+/g, '-') // spaces to hyphens
      .substring(0, 40); // keep reasonable length
  }

  if (!imageName && imageUrl && !imageUrl.startsWith('data:')) {
    try {
      const pathname = new URL(imageUrl, 'http://localhost').pathname;
      const filename = pathname.split('/').pop() || '';
      imageName = filename
        .replace(/\.[^.]+$/, '') // strip extension
        .replace(/[^a-zA-Z0-9-]/g, '-') // non-alphanum to hyphens
        .replace(/-+/g, '-') // collapse multiple hyphens
        .replace(/^-|-$/g, '') // trim leading/trailing hyphens
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

const AIRO_PREVIEW_HOST_SUFFIXES = ['.airoapp.ai', '.test-airoapp.ai'] as const;

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
    const isLocal =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === 'local.gasket.dev-godaddy.com';
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
  slotPath: string
): Promise<{ url: string; destPath: string } | null> {
  // Resolve local URL path to a filesystem path.
  // Vite serves public/ at root, so /assets/images/x.png → {app}/public/assets/images/x.png
  // getPersistentPublicDir(appPath) (.../assets/public/). Host layout stores files at
  // assets/public/images/... (URL /assets/images/... → relative path images/...), not
  // assets/public/assets/images/... — try preview mirror, then persistent with and without
  // the leading "assets/" segment.
  const stripped = localUrlPath.replace(/^\/+/, '');
  let sanitizedPath: string;
  try {
    sanitizedPath = decodeURIComponent(stripped);
  } catch {
    logger.error('media_manifest.copy_local.invalid_encoding', { localUrlPath });
    return null;
  }
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

  return { url: `${AIRO_ASSET_UPLOADS_URL_PREFIX}${filename}`, destPath };
}

/**
 * Return a written media file's path RELATIVE to the app repo so it can be
 * staged in the SAME git commit as the manifest.
 *
 * Why this matters: import writes the processed bytes under public/ (chat
 * uploads → public/assets/media, "use this image" → public/media) and commits
 * the manifest, but historically left the file untracked — it only entered git
 * via the lazy end-of-session `git add .`. If that never ran (crash, abnormal
 * disconnect) or the preview workspace was reconstructed from git before it
 * did, the manifest came back pointing at a file that was never committed, so
 * the slot 404s ("file not found") while the picker still works from the
 * durable agent upload store.
 *
 * Returns null when the file is OUTSIDE the repo — the SHARED_STORAGE_DIR
 * layout keeps media on a CephFS mount that persists independently — so we
 * never try to `git add` a path that isn't in the working tree.
 */
function repoRelativeMediaPath(appPath: string, absFilePath: string): string | null {
  const rel: string = path.relative(appPath, absFilePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return rel;
}

/**
 * For a logo slot, rewrite a non-transparent currentUrl to its transparent sibling
 * if one exists in the slot's variant maps. Returns the URL to use.
 *
 * Why: solid variants have backgrounds that produce visible borders when
 * placed on a website. The slot's solidUrlMap is keyed by the
 * transparent URL, so a reverse lookup gives us the canonical transparent variant.
 */
function resolveTransparentLogoUrl(
  slot: MediaSlot,
  candidateUrl: string
): { url: string; rewritten: boolean } {
  if (slot.mediaType !== 'logo') {
    return { url: candidateUrl, rewritten: false };
  }

  for (const [transparent, solid] of Object.entries(slot.solidUrlMap || {})) {
    if (solid === candidateUrl) {
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
   * Also writes a copy to public/ so Vite's dev server can serve it at /airo-media.json
   * (Vite only auto-serves files from the public/ directory at root URLs).
   */
  private async writeManifest(manifestPath: string, manifest: MediaManifest): Promise<void> {
    const content = JSON.stringify(manifest, null, 2);
    const tempPath = `${manifestPath}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, manifestPath);

    // Mirror to public/ for browser access in dev mode (Vite serves public/ at root)
    const publicCopy = path.join(path.dirname(manifestPath), 'public', MANIFEST_FILENAME);
    try {
      await fs.writeFile(publicCopy, content, 'utf-8');
    } catch {
      // public/ may not exist (e.g. in test environments) — non-fatal
    }
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
          httpStatus: result.error?.startsWith('App not found:') ? 404 : 500,
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
        ([_, slot]) =>
          slot.currentUrl === normalizedUrl && (!slot.sourceRef || slot.sourceRef === sourceRef)
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
      let copiedMediaDestPath: string | null = null;
      if (normalizedUrl.startsWith('/') && !normalizedUrl.startsWith('/airo-assets/')) {
        const copyResult = await copyLocalFileToMedia(app.path, normalizedUrl, slotPath);
        if (!copyResult) {
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
        normalizedUrl = copyResult.url;
        copiedMediaDestPath = copyResult.destPath;
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

      // Update the source file to use the new slot URL via AST-based replacement.
      // The URL fallback may rewrite a different file than the clicked component
      // (e.g. a shared src/data/* collection), so track which file actually
      // changed to stage it for the commit below.
      const newSlotUrl = `/airo-assets/images/${slotPath}`;
      let rewrittenSourceFile: string | undefined;
      if (options.devContext) {
        try {
          const replaceResult = await astImageEditor.replaceImage(
            app.path,
            {
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
            },
            appId
          );

          if (replaceResult.success) {
            rewrittenSourceFile = options.devContext.fileName;
            logger.info('media_manifest.import_slot.source_updated', {
              appId,
              slotPath,
              fileName: options.devContext.fileName,
            });
          } else {
            // JSX-targeted replace refused (commonly a dynamic src such as
            // `arr.map(s => <img src={s.image} />)`). The source URL still
            // lives as a string literal in the backing data array/object, so
            // fall back to a URL-based rewrite there — repointing the data
            // without touching the dynamic JSX expression.
            const fallbackResult = await astImageEditor.replaceUrlInSource(
              app.path,
              {
                oldUrl: sourceFileUrl,
                newUrl: newSlotUrl,
                label: options.imageAlt,
                scopeFile: options.devContext.fileName,
              },
              appId
            );

            if (fallbackResult.success) {
              rewrittenSourceFile = fallbackResult.filePath || options.devContext.fileName;
              logger.info('media_manifest.import_slot.source_updated', {
                appId,
                slotPath,
                fileName: rewrittenSourceFile,
                strategy: 'url_fallback',
              });
            } else {
              logger.warn('media_manifest.import_slot.source_update_failed', {
                appId,
                slotPath,
                fileName: options.devContext.fileName,
                error: replaceResult.error,
                fallbackError: fallbackResult.error,
              });
            }
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

      // Commit to git (includes both manifest and source file changes). Stage
      // the file the rewrite actually touched: the URL fallback may resolve to a
      // different file (e.g. src/data/*) than the clicked one.
      const filesToStage = new Set<string>();
      if (options.devContext?.fileName) {
        filesToStage.add(options.devContext.fileName);
      }
      if (rewrittenSourceFile) {
        filesToStage.add(rewrittenSourceFile);
      }
      // Stage the copied media bytes in the SAME commit as the manifest so a
      // workspace recycle can't drop the file while the manifest still points at it.
      if (copiedMediaDestPath) {
        const copiedMediaPath: string | null = repoRelativeMediaPath(app.path, copiedMediaDestPath);
        if (copiedMediaPath) {
          filesToStage.add(copiedMediaPath);
        }
      }
      const additionalFiles = filesToStage.size > 0 ? [...filesToStage] : undefined;
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

      logger.info('media_manifest.import_slot.success', {
        appId,
        slotPath,
        imageUrl: options.imageUrl.substring(0, 200),
      });

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
   * License a Getty asset and resolve the CDN URL for a slot swap.
   */
  private async resolveLicensedUrl(
    newUrl: string,
    updateOptions: Omit<UpdateSlotOptions, 'newUrl'> | undefined,
    existingSlot: MediaSlot,
    logContext: Record<string, string>,
  ): Promise<
    | { success: true; url: string; gettyId?: string }
    | { success: false; error: string }
  > {
    let newCurrentUrl = newUrl;
    const newCurrentGettyId = updateOptions?.gettyAsset?.id;
    const effectiveMediaType = updateOptions?.gettyAsset?.mediaType || updateOptions?.mediaTypeHint;
    const isVideo = effectiveMediaType === 'video';
    const isImage = effectiveMediaType === 'image';

    if (newCurrentGettyId) {
      if (isVideo) {
        const videoUrl = await gettyUploadService.uploadVideo(newCurrentGettyId);
        if (videoUrl) {
          newCurrentUrl = videoUrl;
          logger.info('media_manifest.fork_slot.getty_video_upload_complete', {
            ...logContext,
            gettyId: newCurrentGettyId,
            cdnUrl: newCurrentUrl,
          });
        } else {
          logger.error('media_manifest.fork_slot.getty_video_upload_failed', {
            ...logContext,
            gettyId: newCurrentGettyId,
          });
          return { success: false, error: 'Failed to license Getty video. Please try again.' };
        }
      } else {
        const uploadResults = await gettyUploadService.uploadAndReport([newCurrentGettyId]);
        if (uploadResults.length > 0 && uploadResults[0]?.url) {
          newCurrentUrl = uploadResults[0].url;
          logger.info('media_manifest.fork_slot.getty_upload_complete', {
            ...logContext,
            gettyId: newCurrentGettyId,
            cdnUrl: newCurrentUrl,
          });
        } else if (updateOptions?.allowExternalUrl) {
          logger.warn('media_manifest.fork_slot.getty_cdn_upload_failed', {
            ...logContext,
            gettyId: newCurrentGettyId,
          });
          return { success: false, error: 'Failed to license Getty image. Please try again.' };
        }
      }
    }

    const resolved = resolveTransparentLogoUrl(existingSlot, newCurrentUrl);
    if (resolved.rewritten) {
      logger.warn('media_manifest.fork_slot.logo.non_transparent_rewritten', {
        ...logContext,
        originalUrl: newCurrentUrl,
        transparentUrl: resolved.url,
      });
      newCurrentUrl = resolved.url;
    }

    return {
      success: true,
      url: newCurrentUrl,
      gettyId: newCurrentGettyId,
    };
  }

  /**
   * Fork a shared slot into a new manifest entry and repoint one source reference.
   * Used when multiple DOM instances share the same slot path (e.g. data collections).
   */
  async forkSlotForElement(
    appId: string,
    options: {
      slotName: string;
      newUrl: string;
      devContext: { fileName: string; componentName: string; lineNumber: number };
      elementInfo: ImageElementInfo;
      imageInfo: ImageInfo;
      occurrenceIndex?: number | null;
      updateOptions?: Omit<UpdateSlotOptions, 'newUrl'>;
    }
  ): Promise<ManifestOperationResult & { slotPath?: string }> {
    const release = await acquireLock(appId);

    try {
      const hasValidDevContext = Boolean(
        options.devContext.fileName.startsWith('src/')
        || options.devContext.fileName.startsWith('app/')
      );
      const canRepointByIndex = options.occurrenceIndex != null && options.occurrenceIndex >= 0;
      const canRepointByLabel = Boolean(options.imageInfo.alt?.trim());
      if (!hasValidDevContext && !canRepointByIndex && !canRepointByLabel) {
        return {
          success: false,
          error: 'Could not identify which item to update. Click Replace on the specific image in Edit mode, then swap again.',
        };
      }

      const app = this.appRepository.findById(appId);
      if (!app?.path) {
        return { success: false, error: 'App not found' };
      }

      const manifestResult = await this.getManifest(appId);
      if (!manifestResult.success || !manifestResult.manifest) {
        return {
          success: false,
          error: manifestResult.error || 'Failed to read manifest',
        };
      }

      const manifest = manifestResult.manifest;
      const existingSlot = manifest[options.slotName];
      if (!existingSlot) {
        return { success: false, error: `Slot not found: ${options.slotName}` };
      }

      const sourceRef = `${options.devContext.fileName}:${options.devContext.lineNumber}`;
      const newSlotPath = buildForkedSlotPath(options.slotName, manifest);
      const now = new Date().toISOString();
      const logContext = { appId, slotName: options.slotName, newSlotPath };

      const licensed = await this.resolveLicensedUrl(
        options.newUrl,
        options.updateOptions,
        existingSlot,
        logContext,
      );
      if (!licensed.success) {
        return { success: false, error: licensed.error };
      }

      const effectiveMediaType = options.updateOptions?.gettyAsset?.mediaType
        || options.updateOptions?.mediaTypeHint;
      const isVideo = effectiveMediaType === 'video';
      const isImage = effectiveMediaType === 'image';

      manifest[newSlotPath] = {
        mediaType: existingSlot.mediaType === 'video' ? 'video' : 'image',
        ...resolveMediaTypeUpdate(existingSlot.mediaType, isVideo, isImage),
        currentUrl: licensed.url,
        searchQuery: options.updateOptions?.searchQuery?.trim()
          || existingSlot.searchQuery
          || '',
        alternatives: [licensed.url],
        userModified: true,
        sourceRef,
        gettyId: licensed.gettyId,
        createdAt: now,
        lastUpdated: now,
      };

      const manifestPath = this.getManifestPath(app.path);
      await this.writeManifest(manifestPath, manifest);

      const replaceResult = await astImageEditor.replaceSharedSlotReference(
        app.path,
        {
          elementInfo: options.elementInfo,
          imageInfo: options.imageInfo,
          newImageUrl: imageSlotUrl(newSlotPath),
          oldSlotPath: options.slotName,
          newSlotPath,
          occurrenceIndex: options.occurrenceIndex,
        },
        appId
      );

      if (!replaceResult.success) {
        delete manifest[newSlotPath];
        await this.writeManifest(manifestPath, manifest);
        return {
          success: false,
          error: replaceResult.error || 'Failed to repoint shared slot reference',
        };
      }

      const additionalFiles = [
        options.devContext.fileName,
        ...(replaceResult.filePath && replaceResult.filePath !== options.devContext.fileName
          ? [replaceResult.filePath]
          : []),
      ].filter((filePath): filePath is string => (
        Boolean(filePath)
        && filePath !== 'unknown'
        && (filePath.startsWith('src/') || filePath.startsWith('app/'))
      ));

      let commitHash: string | undefined;
      let commitFailed = false;
      try {
        commitHash = await this.commitManifestChange(appId, newSlotPath, 'create', additionalFiles);
      } catch (gitError) {
        commitFailed = true;
        logger.warn('media_manifest.fork_slot.git_commit_failed', {
          appId,
          slotPath: newSlotPath,
          error: gitError instanceof Error ? gitError.message : String(gitError),
        });
      }

      logger.info('media_manifest.fork_slot.success', {
        appId,
        originalSlotPath: options.slotName,
        slotPath: newSlotPath,
        sourceRef,
        commitFailed,
      });

      return {
        success: true,
        slotPath: newSlotPath,
        slot: manifest[newSlotPath],
        commitHash,
        commitFailed,
      };
    } catch (error) {
      logger.error('media_manifest.fork_slot.error', {
        appId,
        slotName: options.slotName,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: 'Failed to fork slot' };
    } finally {
      release();
    }
  }

  /**
   * Update a slot in-place, or fork it first when the path is shared across
   * multiple source records and element context is provided.
   */
  async updateSlotOrFork(
    appId: string,
    slotName: string,
    options: {
      newUrl: string;
      updateOptions?: Omit<UpdateSlotOptions, 'newUrl'>;
      forkContext?: SlotForkContext | null;
      occurrenceIndex?: number | null;
    }
  ): Promise<UpdateSlotOrForkResult> {
    const app = this.appRepository.findById(appId);
    const refCount = app?.path ? await countSlotUrlReferences(app.path, slotName) : 0;

    const manifestResult = await this.getManifest(appId);
    const slotSourceRef = manifestResult.manifest?.[slotName]?.sourceRef;

    const selectorOccurrenceIndex = options.forkContext
      ? parseCollectionOccurrenceIndex(
        options.forkContext.selector || options.forkContext.elementInfo.selector || ''
      )
      : null;
    const occurrenceIndex = options.occurrenceIndex ?? selectorOccurrenceIndex;
    const hasValidForkContext = Boolean(
      options.forkContext?.devContext?.fileName?.startsWith('src/')
      || options.forkContext?.devContext?.fileName?.startsWith('app/')
    );
    const canRepointByIndex = occurrenceIndex != null && occurrenceIndex >= 0;
    const canRepointByLabel = Boolean(options.forkContext?.imageInfo?.alt?.trim());
    const clickSourceRef = options.forkContext?.devContext
      ? `${options.forkContext.devContext.fileName}:${options.forkContext.devContext.lineNumber}`
      : null;
    const isShared = isSharedSlotReference(refCount, clickSourceRef, slotSourceRef);
    const canRepoint = canRepointByIndex
      || canRepointByLabel
      || (hasValidForkContext && options.forkContext != null);
    const shouldFork = isShared && canRepoint;

    if (isShared && !shouldFork) {
      logger.warn('media_manifest.update_slot_or_fork.missing_index', {
        appId,
        slotName,
        refCount,
        hasForkContext: options.forkContext != null,
      });
      return {
        success: false,
        error: 'Could not identify which item to update. Click Replace on the specific image in Edit mode, then swap again.',
      };
    }

    if (shouldFork) {
      const devContext = options.forkContext?.devContext ?? {
        fileName: 'unknown',
        componentName: 'unknown',
        lineNumber: 0,
      };
      const elementInfo = options.forkContext?.elementInfo ?? {
        tagName: 'img',
        className: '',
        id: '',
        selector: '',
        devContext,
      };
      const imageInfo = options.forkContext?.imageInfo ?? {
        type: 'img' as const,
        currentUrl: imageSlotUrl(slotName),
      };

      logger.info('media_manifest.update_slot_or_fork.fork', {
        appId,
        slotName,
        refCount,
        occurrenceIndex,
        hasForkContext: options.forkContext != null,
        clickSourceRef: `${devContext.fileName}:${devContext.lineNumber}`,
      });

      const forkResult = await this.forkSlotForElement(appId, {
        slotName,
        newUrl: options.newUrl,
        devContext,
        elementInfo,
        imageInfo,
        occurrenceIndex,
        updateOptions: options.updateOptions,
      });

      if (forkResult.success) {
        return {
          ...forkResult,
          forked: true,
          originalSlotPath: slotName,
          attemptedFork: true,
        };
      }

      return {
        ...forkResult,
        attemptedFork: true,
      };
    }

    const updateResult = await this.updateSlot(appId, slotName, {
      newUrl: options.newUrl,
      ...options.updateOptions,
    });

    return {
      ...updateResult,
      forked: false,
    };
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
        if (options.newUrl && options.newUrl.startsWith(AIRO_ASSET_UPLOADS_URL_PREFIX)) {
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
          newCurrentGettyId = options.gettyAsset?.id || undefined;
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

      // If the newly-active media has a Getty ID, upload it to CDN and report usage
      const effectiveMediaType = options.gettyAsset?.mediaType || options.mediaTypeHint
      const isVideo = effectiveMediaType === 'video'
      const isImage = effectiveMediaType === 'image'
      if (newCurrentGettyId) {
        if (isVideo) {
          const videoUrl = await gettyUploadService.uploadVideo(newCurrentGettyId);
          if (videoUrl) {
            newCurrentUrl = videoUrl;
            logger.info('media_manifest.update_slot.getty_video_upload_complete', {
              ...logContext,
              gettyId: newCurrentGettyId,
              cdnUrl: newCurrentUrl,
            });
          } else {
            logger.error('media_manifest.update_slot.getty_video_upload_failed', {
              ...logContext,
              gettyId: newCurrentGettyId,
            });
            return { success: false, error: 'Failed to license Getty video. Please try again.' };
          }
        } else {
          const uploadResults = await gettyUploadService.uploadAndReport([newCurrentGettyId]);
          if (uploadResults.length > 0 && uploadResults[0]?.url) {
            newCurrentUrl = uploadResults[0].url;
            logger.info('media_manifest.update_slot.getty_upload_complete', {
              ...logContext,
              gettyId: newCurrentGettyId,
              cdnUrl: newCurrentUrl,
            });
          } else if (options.allowExternalUrl) {
            logger.warn('media_manifest.update_slot.getty_cdn_upload_failed', {
              ...logContext,
              gettyId: newCurrentGettyId,
            });
            return { success: false, error: 'Failed to license Getty image. Please try again.' };
          }
        }
      }

      // Enforce transparent-logo invariant: if newCurrentUrl resolves to a solid
      // variant, rewrite to the transparent sibling so generated websites never
      // render logos with backgrounds.
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
      const urlChanged = newCurrentUrl !== existingSlot.currentUrl;

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
        // A user-driven currentUrl change drops any in-progress logo job marker —
        // the background job (if any) is no longer the source of this slot's content.
        pendingJobId: undefined,
        // Update mediaType when swapping between image and video (preserve logo/generated)
        ...resolveMediaTypeUpdate(existingSlot.mediaType, isVideo, isImage),
        ...(options.searchQuery !== undefined && { searchQuery: options.searchQuery }),
        // Update caption only when searchQuery is explicitly provided (preserves AI-generated captions)
        ...(options.searchQuery !== undefined && { caption: options.searchQuery || undefined }),
        // naturalOrientation describes the upload that set it; any URL swap (alternative
        // pick, AI revert) invalidates it. Cleared here so downstream consumers don't
        // size a horizontal AI logo as if it were the prior square upload.
        ...(urlChanged ? { naturalOrientation: undefined } : {}),
        // Clear stale caption when URL changes without an explicit searchQuery —
        // prevents the previous image's caption from being used as alt text for the new image.
        ...(urlChanged && options.searchQuery === undefined ? { caption: undefined } : {}),
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
    options?: {
      sourceFilename?: string;
      isVideo?: boolean;
      /** Natural pixel dimensions; when provided for a logo, co-populates the layout-matching sibling slot. */
      dimensions?: { width: number; height: number };
      /**
       * Repo-relative media file paths the CALLER wrote into the workspace
       * (e.g. public/assets/media/<file>). Staged in the SAME commit as the
       * manifest so a workspace recycle can't drop the bytes while keeping the
       * manifest entry that points at them. Omit when the bytes live outside the
       * repo (CDN/Getty URL, or shared-storage mount that persists on its own).
       */
      stagedMediaPaths?: string[];
    }
  ): Promise<ManifestOperationResult> {
    const { sourceFilename, isVideo, dimensions, stagedMediaPaths } = options || {};
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
      const deduplicatedAlternatives = [...new Set(newAlternatives)].filter(
        (url) => url !== uploadedUrl
      );

      // Rebuild Getty IDs aligned with deduped alternatives
      const newAlternativeGettyIds = deduplicatedAlternatives.map(
        (url) => urlToGettyId.get(url) || ''
      );

      // Track which chat upload produced this persistent URL
      const updatedUploadSources = { ...(existingSlot.uploadSources || {}) };
      if (sourceFilename) {
        updatedUploadSources[uploadedUrl] = sourceFilename;
      }

      const naturalOrientation = dimensions ? classifyOrientation(dimensions) : undefined;
      const isLogoSlot = existingSlot.mediaType === 'logo' || slotName.startsWith('logo/');
      const nowIso = new Date().toISOString();

      // Update slot with uploaded URL as current
      const updatedSlot: MediaSlot = {
        ...existingSlot,
        currentUrl: uploadedUrl,
        alternatives: deduplicatedAlternatives,
        userModified: true,
        lastUpdated: nowIso,
        searchQuery: '', // upload is unrelated to any prior search term
        caption: undefined, // clear stale caption — async captioning will re-generate
        gettyId: undefined, // Uploaded image has no Getty ID
        // A user-driven upload drops any in-progress logo job marker — the
        // background job (if any) is no longer the source of this slot's content.
        pendingJobId: undefined,
        alternativeGettyIds: newAlternativeGettyIds.some((id) => id)
          ? newAlternativeGettyIds
          : undefined,
        uploadSources: Object.keys(updatedUploadSources).length > 0
          ? updatedUploadSources
          : undefined,
        // Update mediaType when uploading a video or reverting to an image (preserve logo/generated)
        ...resolveMediaTypeUpdate(existingSlot.mediaType, !!isVideo, isVideo === false),
        ...(isLogoSlot ? clearLogoVariantMaps() : {}),
        ...(isLogoSlot && naturalOrientation ? { naturalOrientation } : {}),
      };

      manifest[slotName] = updatedSlot;

      if (isLogoSlot && naturalOrientation) {
        const siblingSlotName = LOGO_NATURAL_SLOT_PATHS[naturalOrientation];
        if (siblingSlotName !== slotName) {
          const siblingSlot = manifest[siblingSlotName];
          const siblingHasDeliberateUserChoice =
            !!siblingSlot?.userModified && siblingSlot.currentUrl !== uploadedUrl;
          if (!siblingHasDeliberateUserChoice) {
            manifest[siblingSlotName] = buildSiblingLogoSlot(
              siblingSlot,
              uploadedUrl,
              sourceFilename,
              naturalOrientation,
              nowIso,
            );
          }
        }
      }

      // Write manifest and versions file atomically
      await this.writeManifest(manifestPath, manifest);

      // Commit manifest + any caller-written media bytes together, so the slot
      // can't end up referencing a committed manifest entry whose file was
      // never committed (untracked file dropped on a workspace recycle → 404).
      let commitHash: string | undefined;
      try {
        commitHash = await this.commitManifestChange(appId, slotName, 'update', stagedMediaPaths);
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
   * Copy a chat-uploaded file into persistent media storage and register it in a manifest slot.
   * Creates the slot when missing unless createIfMissing is false (apply-upload flow).
   */
  async importChatUploadToSlot(
    appId: string,
    options: {
      filename: string;
      slotName?: string;
      assetRole?: SlotEligibleAssetRole | null;
      createIfMissing?: boolean;
    }
  ): Promise<ImportChatUploadResult> {
    const { filename, assetRole, createIfMissing = true } = options;

    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\0')) {
      return { success: false, error: 'Invalid filename', httpStatus: 400 };
    }

    const app = this.appRepository.findById(appId);
    if (!app?.path) {
      return { success: false, error: `App not found: ${appId}`, httpStatus: 404 };
    }

    const uploadedFiles = await fileUploadService.listUploadedFiles(appId);
    // Match by stored filename first, then by original display name — agents
    // sometimes pass the display name rather than the internal stored filename.
    const matchingFile = uploadedFiles.find(
      (f) => f.filename === filename || f.originalName === filename
    );
    if (!matchingFile) {
      return { success: false, error: 'Upload file not found', httpStatus: 404 };
    }

    // Always use the internal stored filename for disk lookup, even if the
    // caller passed the original display name.
    const storedFilename = matchingFile.filename;
    const sourceFilePath = await fileUploadService.findUploadedFilePath(appId, storedFilename);
    if (!sourceFilePath) {
      return { success: false, error: 'Upload file not found on disk', httpStatus: 404 };
    }

    const releaseLock = await acquireLock(appId);

    try {
      const manifestPath = this.getManifestPath(app.path);
      let manifest: MediaManifest = {};
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('media_manifest.import_chat_upload.read_error', {
            appId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        manifest = {};
      }

      const fileBuffer = await fs.readFile(sourceFilePath);
      const isVideo = matchingFile.mimeType?.startsWith('video/') ?? false;
      // Stable identity for "same image" — survives re-uploads (which get a
      // fresh stored filename). Computed before dedup so a re-uploaded
      // duplicate can be matched to its existing slot. NOTE: this hashes the
      // RAW source upload bytes, NOT the processed/resized file written to
      // /media/ below — re-hashing the stored media file would produce a
      // different value and must not be treated as equivalent.
      const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Intent-driven resolution: explicit slotName → scaffold role slot → fresh path (AIROBUILD-2789).
      const roleCandidate: string | undefined =
        !options.slotName && assetRole
          ? findSlotByAssetRole(manifest, assetRole)
          : undefined;
      const roleCandidateSlot: MediaSlot | undefined = roleCandidate
        ? manifest[roleCandidate]
        : undefined;
      const roleCandidateIsScaffold: boolean =
        roleCandidateSlot !== undefined &&
        roleCandidateSlot.userModified === false &&
        Object.keys(roleCandidateSlot.uploadSources ?? {}).length === 0 &&
        (roleCandidateSlot.aiGeneratedUrls?.length ?? 0) === 0;
      const deflectedFromCanonical: boolean = !!roleCandidate && !roleCandidateIsScaffold;
      if (deflectedFromCanonical) {
        logger.info('media_manifest.import_chat_upload.role_slot_skipped', {
          appId,
          slotPath: roleCandidate,
          assetRole,
          reason: roleCandidateSlot?.userModified
            ? 'userModified'
            : (roleCandidateSlot?.aiGeneratedUrls?.length ?? 0) > 0
              ? 'hasAiGeneratedUrls'
              : 'hasUploadSources',
        });
      }
      const slotName: string =
        options.slotName?.trim().replace(/^\/+|\/+$/g, '') ||
        (roleCandidate && roleCandidateIsScaffold ? roleCandidate : undefined) ||
        deriveChatUploadSlotPath(manifest, { filename, assetRole });

      if (slotName.includes('..') || slotName.startsWith('/') || slotName.includes('\0')) {
        return { success: false, error: 'Invalid slot name', httpStatus: 400 };
      }

      const existingSlot = manifest[slotName];
      if (!existingSlot && !createIfMissing) {
        return { success: false, error: `Slot not found: ${slotName}`, httpStatus: 404 };
      }

      if (isVideo) {
        if (!matchingFile.mimeType || !ALLOWED_VIDEO_TYPES[matchingFile.mimeType]) {
          return { success: false, error: 'Unsupported video type', httpStatus: 400 };
        }
        if (!validateVideoMagicBytes(fileBuffer, matchingFile.mimeType)) {
          return {
            success: false,
            error: 'File content does not match declared video type',
            httpStatus: 400,
          };
        }
      }

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

      const sanitizedSlot = slotName.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
      const hash = crypto.createHash('sha256').update(outputBuffer).digest('hex').slice(0, 8);
      const mediaFilename = `${sanitizedSlot}-${hash}.${ext}`;

      const mediaDir = path.join(getPersistentPublicDir(app.path), 'media');
      await fs.mkdir(mediaDir, { recursive: true });

      const filePath = path.join(mediaDir, mediaFilename);
      const resolvedMediaDir = path.resolve(mediaDir);
      const resolvedFilePath = path.resolve(filePath);
      if (!resolvedFilePath.startsWith(resolvedMediaDir + path.sep)) {
        return { success: false, error: 'Invalid file path', httpStatus: 400 };
      }

      // Whether this exact media file already existed (same slot + same output
      // bytes ⇒ same deterministic filename). If it did, a prior successful
      // import already references it — so on a later manifest-write failure we
      // must NOT delete it as an "orphan", or we'd break that earlier slot.
      const fileExistedBefore: boolean = await fs.stat(filePath).then(() => true).catch(() => false);

      const tempPath = `${filePath}.tmp.${Date.now()}`;
      await fs.writeFile(tempPath, outputBuffer);
      try {
        await fs.rename(tempPath, filePath);
      } catch (renameError) {
        // rename failed — the temp file would otherwise leak. Best-effort clean.
        await fs.unlink(tempPath).catch(() => {});
        throw renameError;
      }

      const uploadedUrl = `${AIRO_ASSET_UPLOADS_URL_PREFIX}${mediaFilename}`;
      const nowIso = new Date().toISOString();
      const naturalOrientation = dimensions ? classifyOrientation(dimensions) : undefined;
      const isLogoSlot = existingSlot?.mediaType === 'logo' || slotName.startsWith('logo/');

      const updatedSlot = this.buildImportedSlot({
        existingSlot,
        uploadedUrl,
        filename: storedFilename,
        isVideo,
        nowIso,
        naturalOrientation,
        isLogoSlot,
        contentHash,
      });

      manifest[slotName] = updatedSlot;
      try {
        await this.writeManifest(manifestPath, manifest);
      } catch (writeError) {
        // The media file is on disk but the manifest never recorded it. Remove
        // the orphan so failed imports don't leak — but ONLY if this import
        // created the file. If it already existed, a prior successful import
        // still references it; deleting it would 404 that slot.
        if (!fileExistedBefore) {
          await fs.unlink(filePath).catch(() => {});
        }
        throw writeError;
      }

      let commitHash: string | undefined;
      try {
        // Stage the processed media bytes (just written to filePath) in the SAME
        // commit as the manifest, so a workspace recycle can't drop the file
        // while keeping the manifest entry that points at it. null when the file
        // lives outside the repo (SHARED_STORAGE_DIR / CephFS mount).
        const stagedMediaPath: string | null = repoRelativeMediaPath(app.path, filePath);
        commitHash = await this.commitManifestChange(
          appId,
          slotName,
          existingSlot ? 'update' : 'create',
          stagedMediaPath ? [stagedMediaPath] : undefined,
        );
      } catch (gitError) {
        logger.warn('media_manifest.import_chat_upload.git_commit_failed', {
          appId,
          slotName,
          error: gitError instanceof Error ? gitError.message : String(gitError),
        });
      }

      const slotUrl = isVideo
        ? `/airo-assets/videos/${slotName}`
        : `/airo-assets/images/${slotName}`;

      logger.info('media_manifest.import_chat_upload.success', {
        appId,
        slotName,
        uploadedUrl,
        sourceFilename: storedFilename,
        created: !existingSlot,
      });

      return {
        success: true,
        slotPath: slotName,
        slotUrl,
        uploadedUrl,
        slot: updatedSlot,
        commitHash,
        deflectedFromCanonical,
      };
    } catch (error) {
      logger.error('media_manifest.import_chat_upload.error', {
        appId,
        filename: storedFilename ?? filename,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import chat upload',
        httpStatus: 500,
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * Update only the caption field of a slot (used by fire-and-forget captioning after upload/generation).
   * @param forUrl If provided, only applies caption if the slot's currentUrl still matches (guards against TOCTOU).
   */
  async updateSlotCaption(
    appId: string,
    slotName: string,
    caption: string,
    forUrl?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!caption.trim()) return { success: false, error: 'Caption is empty' };

    const app = this.appRepository.findById(appId);
    if (!app) return { success: false, error: `App not found: ${appId}` };

    const releaseLock = await acquireLock(appId);
    try {
      const manifestPath = this.getManifestPath(app.path);
      let manifest: MediaManifest = {};
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      } catch {
        return { success: false, error: 'Manifest not found' };
      }

      const slot = manifest[slotName];
      if (!slot) return { success: false, error: `Slot not found: ${slotName}` };

      // TOCTOU guard: if the image was swapped since captioning started, skip
      if (forUrl && slot.currentUrl !== forUrl) {
        return { success: false, error: 'Slot URL changed since captioning started' };
      }

      slot.caption = caption;
      // If no search query exists, also set it so Getty auto-search works
      if (!slot.searchQuery) {
        slot.searchQuery = caption;
      }

      await this.writeManifest(manifestPath, manifest);

      // Commit the caption update so the manifest change isn't left dangling
      const commitHash = await this.commitManifestChange(appId, slotName, 'update');
      logger.info('media_manifest.caption_updated', { appId, slotName, caption, commitHash });
      return { success: true };
    } finally {
      releaseLock();
    }
  }

  /**
   * Build the MediaSlot for a chat-upload import. Pure transformation of the
   * existing slot (if any) plus the freshly stored upload — no I/O. New slots
   * are created `userModified`; existing slots keep their identity while the
   * prior current URL is preserved as an alternative and Getty metadata is
   * remapped/cleared (an uploaded file has no Getty id).
   */
  private buildImportedSlot(params: {
    existingSlot: MediaSlot | undefined;
    uploadedUrl: string;
    filename: string;
    isVideo: boolean;
    nowIso: string;
    naturalOrientation: MediaSlot['naturalOrientation'];
    isLogoSlot: boolean;
    contentHash: string;
  }): MediaSlot {
    const { existingSlot, uploadedUrl, filename, isVideo, nowIso, naturalOrientation, isLogoSlot, contentHash } = params;

    if (!existingSlot) {
      return {
        mediaType: isVideo ? 'video' : 'image',
        currentUrl: uploadedUrl,
        searchQuery: '',
        alternatives: [],
        userModified: true,
        createdAt: nowIso,
        lastUpdated: nowIso,
        uploadSources: { [uploadedUrl]: filename },
        uploadContentHash: contentHash,
        ...(isLogoSlot && naturalOrientation ? { naturalOrientation } : {}),
      };
    }

    const altGettyIds = existingSlot.alternativeGettyIds || [];
    const urlToGettyId = new Map<string, string>();
    urlToGettyId.set(existingSlot.currentUrl, existingSlot.gettyId || '');
    existingSlot.alternatives.forEach((url, i) => {
      if (!urlToGettyId.has(url)) {
        urlToGettyId.set(url, altGettyIds[i] || '');
      }
    });

    const newAlternatives = existingSlot.currentUrl !== uploadedUrl
      ? [existingSlot.currentUrl, ...existingSlot.alternatives]
      : existingSlot.alternatives;

    const deduplicatedAlternatives = [...new Set(newAlternatives)].filter(
      (url) => url !== uploadedUrl
    );
    const newAlternativeGettyIds = deduplicatedAlternatives.map(
      (url) => urlToGettyId.get(url) || ''
    );

    const updatedUploadSources = { ...(existingSlot.uploadSources || {}) };
    updatedUploadSources[uploadedUrl] = filename;

    return {
      ...existingSlot,
      currentUrl: uploadedUrl,
      alternatives: deduplicatedAlternatives,
      userModified: true,
      lastUpdated: nowIso,
      searchQuery: '',
      gettyId: undefined,
      alternativeGettyIds: newAlternativeGettyIds.some((id) => id)
        ? newAlternativeGettyIds
        : undefined,
      uploadSources: updatedUploadSources,
      uploadContentHash: contentHash,
      ...resolveMediaTypeUpdate(existingSlot.mediaType, isVideo, !isVideo),
      ...(uploadedUrl !== existingSlot.currentUrl ? { naturalOrientation: undefined } : {}),
      ...(isLogoSlot ? clearLogoVariantMaps() : {}),
      ...(isLogoSlot && naturalOrientation ? { naturalOrientation } : {}),
    };
  }


  private buildSlotAfterUploadUrlRemoval(
    existingSlot: MediaSlot,
    removeSet: Set<string>
  ): { changed: boolean; updatedSlot?: MediaSlot } {
    const pruneStringMap = (map?: Record<string, string>): Record<string, string> | undefined => {
      if (!map) return undefined;
      const next = Object.fromEntries(
        Object.entries(map).filter(([key, value]) => !removeSet.has(key) && !removeSet.has(value))
      );
      return Object.keys(next).length > 0 ? next : undefined;
    };

    const pruneLogoSourceMap = (
      map?: Record<string, { sessionId: string; logoId: string }>
    ): Record<string, { sessionId: string; logoId: string }> | undefined => {
      if (!map) return undefined;
      const next = Object.fromEntries(Object.entries(map).filter(([key]) => !removeSet.has(key)));
      return Object.keys(next).length > 0 ? next : undefined;
    };

    const uploadSourceUrls = Object.keys(existingSlot.uploadSources || {});
    const hasRemovedCurrent = removeSet.has(existingSlot.currentUrl);
    const hasRemovedAlternative = existingSlot.alternatives.some((url) => removeSet.has(url));
    const hasRemovedUploadSource = uploadSourceUrls.some((url) => removeSet.has(url));
    const hasRemovedLogoMapEntry = [
      existingSlot.solidUrlMap,
      existingSlot.mockupUrlMap,
      existingSlot.landscapeMockupUrlMap,
    ].some(
      (map) =>
        map &&
        Object.entries(map).some(([key, value]) => removeSet.has(key) || removeSet.has(value))
    );
    const hasRemovedLogoSourceMapEntry = Object.keys(existingSlot.logoSourceMap || {}).some((url) =>
      removeSet.has(url)
    );

    if (
      !hasRemovedCurrent &&
      !hasRemovedAlternative &&
      !hasRemovedUploadSource &&
      !hasRemovedLogoMapEntry &&
      !hasRemovedLogoSourceMapEntry
    ) {
      return { changed: false };
    }

    const altGettyIds = existingSlot.alternativeGettyIds || [];
    const urlToGettyId = new Map<string, string>();
    urlToGettyId.set(existingSlot.currentUrl, existingSlot.gettyId || '');
    existingSlot.alternatives.forEach((url, i) => {
      if (!urlToGettyId.has(url)) {
        urlToGettyId.set(url, altGettyIds[i] || '');
      }
    });

    const newCurrentUrl = hasRemovedCurrent
      ? existingSlot.alternatives.find((url) => !removeSet.has(url))
      : existingSlot.currentUrl;

    if (!newCurrentUrl) {
      return { changed: true };
    }

    const newAlternatives = [...new Set(existingSlot.alternatives)].filter(
      (url) => !removeSet.has(url) && url !== newCurrentUrl
    );
    const newAlternativeGettyIds = newAlternatives.map((url) => urlToGettyId.get(url) || '');
    const newUploadSources = existingSlot.uploadSources
      ? Object.fromEntries(
          Object.entries(existingSlot.uploadSources).filter(([url]) => !removeSet.has(url))
        )
      : undefined;

    const updatedSlot: MediaSlot = {
      ...existingSlot,
      currentUrl: newCurrentUrl,
      alternatives: newAlternatives,
      userModified: true,
      lastUpdated: new Date().toISOString(),
      gettyId: urlToGettyId.get(newCurrentUrl) || undefined,
      alternativeGettyIds: newAlternativeGettyIds.some((id) => id)
        ? newAlternativeGettyIds
        : undefined,
      uploadSources:
        newUploadSources && Object.keys(newUploadSources).length > 0 ? newUploadSources : undefined,
      ...(newCurrentUrl !== existingSlot.currentUrl ? { naturalOrientation: undefined } : {}),
      solidUrlMap: pruneStringMap(existingSlot.solidUrlMap),
      mockupUrlMap: pruneStringMap(existingSlot.mockupUrlMap),
      landscapeMockupUrlMap: pruneStringMap(existingSlot.landscapeMockupUrlMap),
      logoSourceMap: pruneLogoSourceMap(existingSlot.logoSourceMap),
    };

    return { changed: true, updatedSlot };
  }

  /**
   * Remove one or more persistent upload URLs from the manifest. If a removed
   * URL is currently active for a slot, promote the first remaining alternative.
   */
  async removeUploadedUrls(
    appId: string,
    uploadedUrls: string[]
  ): Promise<RemoveUploadedUrlsResult> {
    const app = this.appRepository.findById(appId);
    if (!app) {
      return {
        success: false,
        error: `App not found: ${appId}`,
      };
    }

    const urlsToRemove = [...new Set(uploadedUrls)].filter((url) =>
      url.startsWith(AIRO_ASSET_UPLOADS_URL_PREFIX)
    );
    if (urlsToRemove.length === 0) {
      return { success: true, affectedSlots: [], removedUrls: [] };
    }

    const removeSet = new Set(urlsToRemove);
    const logContext = { appId, removedUrls: urlsToRemove };
    logger.info('media_manifest.remove_uploads.begin', logContext);

    const releaseLock = await acquireLock(appId);

    try {
      const manifestPath = this.getManifestPath(app.path);
      let manifest: MediaManifest = {};
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('media_manifest.remove_uploads.read_error', {
            ...logContext,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return { success: true, manifest: {}, affectedSlots: [], removedUrls: urlsToRemove };
      }

      const nextManifest: MediaManifest = { ...manifest };
      const affectedSlots: string[] = [];
      const blockedSlots: string[] = [];

      for (const [slotName, existingSlot] of Object.entries(manifest)) {
        const removal = this.buildSlotAfterUploadUrlRemoval(existingSlot, removeSet);
        if (!removal.changed) {
          continue;
        }

        if (!removal.updatedSlot) {
          blockedSlots.push(slotName);
          continue;
        }

        nextManifest[slotName] = removal.updatedSlot;
        affectedSlots.push(slotName);
      }

      if (blockedSlots.length > 0) {
        return {
          success: false,
          error: `Cannot delete upload because it is the only media for slot: ${blockedSlots.join(', ')}`,
          affectedSlots,
          removedUrls: urlsToRemove,
        };
      }

      if (affectedSlots.length === 0) {
        return { success: true, manifest, affectedSlots: [], removedUrls: urlsToRemove };
      }

      await this.writeManifest(manifestPath, nextManifest);

      let commitHash: string | undefined;
      try {
        commitHash = await this.commitManifestChange(appId, 'uploaded media', 'update');
      } catch (gitError) {
        logger.warn('media_manifest.remove_uploads.git_commit_failed', {
          ...logContext,
          error: gitError instanceof Error ? gitError.message : String(gitError),
        });
      }

      logger.info('media_manifest.remove_uploads.success', {
        ...logContext,
        affectedSlots,
        commitHash,
      });

      return {
        success: true,
        manifest: nextManifest,
        affectedSlots,
        removedUrls: urlsToRemove,
        commitHash,
      };
    } finally {
      releaseLock();
    }
  }

  async removeUploadedUrlsFromSlot(
    appId: string,
    slotName: string,
    uploadedUrls: string[]
  ): Promise<RemoveUploadedUrlsResult> {
    const app = this.appRepository.findById(appId);
    if (!app) {
      return {
        success: false,
        error: `App not found: ${appId}`,
      };
    }

    const urlsToRemove = [...new Set(uploadedUrls)].filter((url) =>
      url.startsWith(AIRO_ASSET_UPLOADS_URL_PREFIX)
    );
    if (urlsToRemove.length === 0) {
      return { success: true, affectedSlots: [], removedUrls: [] };
    }

    const removeSet = new Set(urlsToRemove);
    const logContext = { appId, slotName, removedUrls: urlsToRemove };
    logger.info('media_manifest.remove_uploads_from_slot.begin', logContext);

    const releaseLock = await acquireLock(appId);

    try {
      const manifestPath = this.getManifestPath(app.path);
      let manifest: MediaManifest = {};
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('media_manifest.remove_uploads_from_slot.read_error', {
            ...logContext,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return { success: true, manifest: {}, affectedSlots: [], removedUrls: urlsToRemove };
      }

      const existingSlot = manifest[slotName];
      if (!existingSlot) {
        return {
          success: false,
          error: `Slot not found: ${slotName}`,
          affectedSlots: [],
          removedUrls: urlsToRemove,
        };
      }

      const removal = this.buildSlotAfterUploadUrlRemoval(existingSlot, removeSet);
      if (!removal.changed) {
        return { success: true, manifest, affectedSlots: [], removedUrls: urlsToRemove };
      }

      if (!removal.updatedSlot) {
        return {
          success: false,
          error: `Cannot remove upload because it is the only media for slot: ${slotName}`,
          affectedSlots: [],
          removedUrls: urlsToRemove,
        };
      }

      const nextManifest: MediaManifest = {
        ...manifest,
        [slotName]: removal.updatedSlot,
      };

      await this.writeManifest(manifestPath, nextManifest);

      let commitHash: string | undefined;
      try {
        commitHash = await this.commitManifestChange(appId, slotName, 'update');
      } catch (gitError) {
        logger.warn('media_manifest.remove_uploads_from_slot.git_commit_failed', {
          ...logContext,
          error: gitError instanceof Error ? gitError.message : String(gitError),
        });
      }

      logger.info('media_manifest.remove_uploads_from_slot.success', {
        ...logContext,
        commitHash,
      });

      return {
        success: true,
        manifest: nextManifest,
        affectedSlots: [slotName],
        removedUrls: urlsToRemove,
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
    slotOrBuilder: MediaSlot | ((manifest: MediaManifest) => MediaSlot),
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

      // Builder runs under the lock so callers can dedup against the latest manifest.
      const slot: MediaSlot =
        typeof slotOrBuilder === 'function' ? slotOrBuilder(manifest) : slotOrBuilder;

      // Preserve createdAt and userModified from existing slot
      const existing = manifest[slotName];
      if (existing) {
        slot.createdAt = existing.createdAt;
        if (existing.userModified) {
          slot.userModified = true;
        }
      }

      const builtSlot: MediaSlot = structuredClone(slot);

      // Upload Getty images to CDN and replace preview URLs
      if (slot.gettyId) {
        const allGettyIds = [slot.gettyId, ...(slot.alternativeGettyIds || [])];
        const uploadResults = await gettyUploadService.uploadAndReport(allGettyIds);

        if (uploadResults.length > 0) {
          const resultMap = new Map(uploadResults.map((r) => [r.id, r.url]));

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

      // Enforce transparent-logo invariant: if currentUrl resolves to a solid
      // variant, rewrite to the transparent sibling so generated websites never
      // render logos with backgrounds.
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
        builtSlot,
        manifest,
        commitHash,
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * Remove a slot entry from the manifest. Used to revert a fresh placeholder on
   * cancel/failure — an empty currentUrl would 500 in the resolver, so the slot
   * must be removed rather than blanked. Returns success when the slot is already
   * absent (no write performed).
   */
  async removeSlot(
    appId: string,
    slotName: string,
    skipGitCommit: boolean = false
  ): Promise<ManifestOperationResult> {
    const app = this.appRepository.findById(appId);
    if (!app) {
      return { success: false, error: `App not found: ${appId}` };
    }

    const logContext = { appId, slotName };
    logger.info('media_manifest.remove_slot.begin', logContext);

    const releaseLock = await acquireLock(appId);
    try {
      const manifestPath = this.getManifestPath(app.path);

      let manifest: MediaManifest = {};
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('media_manifest.remove_slot.read_error', {
            ...logContext,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        manifest = {};
      }

      if (!manifest[slotName]) {
        logger.info('media_manifest.remove_slot.absent', logContext);
        return { success: true, manifest };
      }

      delete manifest[slotName];
      await this.writeManifest(manifestPath, manifest);
      logger.info('media_manifest.remove_slot.written', logContext);

      let commitHash: string | undefined;
      if (!skipGitCommit) {
        try {
          commitHash = await this.commitManifestChange(appId, slotName, 'delete');
        } catch (gitError) {
          logger.warn('media_manifest.remove_slot.git_commit_failed', {
            ...logContext,
            error: gitError instanceof Error ? gitError.message : String(gitError),
          });
        }
      }

      logger.info('media_manifest.remove_slot.success', { ...logContext, commitHash });
      return { success: true, manifest, commitHash };
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
      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        logger.warn('media_manifest.git_commit.no_supervisor', { appId });
        return undefined;
      }

      const gitUtils = new GitUtils(workspace.tasks);
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

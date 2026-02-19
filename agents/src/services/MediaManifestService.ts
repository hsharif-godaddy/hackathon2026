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
import { AppRepository } from '../database/repositories/AppRepository.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { GitUtils } from '../utils/git.js';
import { logger } from '../logging/index.js';
import { gettyUploadService } from './GettyUploadService.js';

export const MANIFEST_FILENAME = 'airo-media.json';

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
  mediaType: 'image' | 'video' | 'generated';
  currentUrl: string;
  /** For videos: thumbnail image URL for preview display */
  thumbnailUrl?: string;
  searchQuery: string;
  requestedSize?: MediaSize;
  orientations?: string;
  compositions?: string;
  alternatives: string[];
  userModified: boolean;
  createdAt: string;
  lastUpdated: string;
  /** Getty image ID for the current image (undefined for generated/uploaded images) */
  gettyId?: string;
  /** Getty image IDs for alternative images (parallel to alternatives array) */
  alternativeGettyIds?: string[];
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
      if (urlIndex === -1 || urlIndex >= allUrls.length) {
        return {
          success: false,
          error: 'Invalid URL or alternative index',
        };
      }

      // Swap: new URL becomes current, old current goes to alternatives
      let newCurrentUrl = allUrls[urlIndex]!;
      const newAlternatives = allUrls.filter((_, i) => i !== urlIndex);

      // Build Getty ID arrays (current + alternatives, same order as allUrls)
      // Pad alternativeGettyIds to match alternatives length to prevent misalignment
      const altGettyIds = existingSlot.alternativeGettyIds || [];
      const paddedAltGettyIds = altGettyIds.length >= existingSlot.alternatives.length
        ? altGettyIds
        : [...altGettyIds, ...Array<string>(existingSlot.alternatives.length - altGettyIds.length).fill('')];
      const allGettyIds = [
        existingSlot.gettyId || '',
        ...paddedAltGettyIds,
      ];
      const newCurrentGettyId = allGettyIds[urlIndex] || undefined;
      const newAlternativeGettyIds = allGettyIds.filter((_, i) => i !== urlIndex);

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
        }
      }

      // Update the slot
      const updatedSlot: MediaSlot = {
        ...existingSlot,
        currentUrl: newCurrentUrl,
        alternatives: newAlternatives,
        userModified: options.markUserModified ?? true,
        lastUpdated: new Date().toISOString(),
        gettyId: newCurrentGettyId,
        alternativeGettyIds: newAlternativeGettyIds.filter(Boolean).length > 0
          ? newAlternativeGettyIds.filter(Boolean)
          : undefined,
      };

      manifest[slotName] = updatedSlot;

      // Write atomically (temp file + rename)
      const tempPath = `${manifestPath}.tmp`;
      const content = JSON.stringify(manifest, null, 2);
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, manifestPath);

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
    uploadedUrl: string
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

      // Move current URL to alternatives (if it's not already the uploaded URL)
      const newAlternatives =
        existingSlot.currentUrl !== uploadedUrl
          ? [existingSlot.currentUrl, ...existingSlot.alternatives]
          : existingSlot.alternatives;

      // Update slot with uploaded URL as current
      const updatedSlot: MediaSlot = {
        ...existingSlot,
        currentUrl: uploadedUrl,
        alternatives: newAlternatives,
        userModified: true,
        lastUpdated: new Date().toISOString(),
      };

      manifest[slotName] = updatedSlot;

      // Write atomically
      const tempPath = `${manifestPath}.tmp`;
      const content = JSON.stringify(manifest, null, 2);
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, manifestPath);

      // Commit to git (including the uploaded media file)
      let commitHash: string | undefined;
      try {
        // Extract filename from uploadedUrl (e.g., "/airo-assets/uploads/image.jpg" -> "image.jpg")
        const uploadedFilename = uploadedUrl.replace('/airo-assets/uploads/', '');
        const mediaFilePath = path.join('public', 'media', uploadedFilename);
        commitHash = await this.commitManifestChange(appId, slotName, 'update', [mediaFilePath]);
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

      // Update the slot
      manifest[slotName] = slot;

      // Write atomically
      const tempPath = `${manifestPath}.tmp`;
      const content = JSON.stringify(manifest, null, 2);
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, manifestPath);

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

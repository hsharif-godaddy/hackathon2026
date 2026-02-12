/**
 * Media Slot Tool - Slot-based media management for images and videos
 *
 * This tool provides a slot-based indirection layer for media assets.
 * Instead of embedding Getty URLs directly in code, the agent assigns
 * semantic slot identifiers that resolve to actual media through a proxy.
 *
 * This enables:
 * - Changing images without code edits
 * - Browsing alternatives for any image placement
 * - Tracking AI-selected vs user-modified media
 * - Re-searching with original query context
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { MediaSearchTool, type MediaSearchResult } from './media-search-tool.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { logger } from '../logging/index.js';

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
  searchQuery: string;
  requestedSize?: MediaSize;
  alternatives: string[];
  userModified: boolean;
  createdAt: string;
  lastUpdated: string;
}

/**
 * The complete manifest mapping slot paths to slot data
 */
export type MediaManifest = Record<string, MediaSlot>;

/**
 * Input options for selecting media into a slot
 */
export interface MediaSlotOptions {
  slot: string;
  query: string;
  mediaType?: 'image' | 'video';
  size?: {
    width: number;
    height: number;
    fit?: 'cover' | 'contain' | 'crop';
  };
  orientations?: string;
  compositions?: string;
  count?: number;
  // Context
  appId: string;
  conversationId?: string;
  customerId?: string;
}

/**
 * Result from selecting media into a slot
 */
export interface MediaSlotResult {
  success: boolean;
  slot: string;
  slotUrl: string;
  mediaType: 'image' | 'video';
  searchQuery: string;
  resolvedUrl?: string;
  alternativeCount?: number;
  error?: string;
}

const MANIFEST_FILENAME = 'airo-media.json';

/**
 * Service for managing media slots and the manifest file
 */
export class MediaSlotTool {
  private mediaSearchTool: MediaSearchTool;
  private appRepository: AppRepository;

  constructor() {
    this.mediaSearchTool = new MediaSearchTool();
    this.appRepository = new AppRepository();
  }

  /**
   * Select media for a slot - searches, stores in manifest, returns slot URL
   */
  async selectMedia(options: MediaSlotOptions): Promise<MediaSlotResult> {
    const {
      slot,
      query,
      mediaType = 'image',
      size,
      orientations,
      compositions,
      count = 5,
      appId,
      conversationId,
      customerId,
    } = options;

    const logContext = { appId, slot, mediaType, query };

    logger.info('media_slot.select.begin', logContext);

    // Validate slot path
    if (!slot || typeof slot !== 'string' || slot.trim().length === 0) {
      return {
        success: false,
        slot: '',
        slotUrl: '',
        mediaType,
        searchQuery: query,
        error: 'Slot path is required',
      };
    }

    // Normalize slot path (remove leading/trailing slashes)
    const normalizedSlot = slot.trim().replace(/^\/+|\/+$/g, '');

    // Get app path
    const app = this.appRepository.findById(appId);
    if (!app) {
      logger.error('media_slot.select.app_not_found', { ...logContext, appId });
      return {
        success: false,
        slot: normalizedSlot,
        slotUrl: '',
        mediaType,
        searchQuery: query,
        error: `App not found: ${appId}`,
      };
    }

    try {
      // Search for media using existing MediaSearchTool
      // Note: conversationId and customerId are not used by MediaSearchTool currently
      // but we keep them in the options interface for future image analysis integration
      const searchResult = await this.mediaSearchTool.searchMedia(
        query,
        mediaType,
        count,
        appId,
        undefined, // size (for generation only)
        undefined, // filename (for generation only)
        {
          ...(orientations && { orientations }),
          ...(compositions && { compositions }),
        }
      );

      if (!searchResult.success) {
        logger.warn('media_slot.select.search_failed', {
          ...logContext,
          error: searchResult.error,
        });
        return {
          success: false,
          slot: normalizedSlot,
          slotUrl: '',
          mediaType,
          searchQuery: query,
          error: searchResult.error || 'Media search failed',
        };
      }

      // Extract URLs from search result
      const urls = this.extractUrls(searchResult);
      if (urls.length === 0) {
        logger.warn('media_slot.select.no_results', logContext);
        return {
          success: false,
          slot: normalizedSlot,
          slotUrl: '',
          mediaType,
          searchQuery: query,
          error: 'No media found for the search query',
        };
      }

      const primaryUrl = urls[0]!;
      const alternatives = urls.slice(1);

      // Build the slot entry
      const now = new Date().toISOString();
      const slotEntry: MediaSlot = {
        mediaType,
        currentUrl: primaryUrl,
        searchQuery: query,
        alternatives,
        userModified: false,
        createdAt: now,
        lastUpdated: now,
      };

      // Add size if provided (mainly for images)
      if (size) {
        slotEntry.requestedSize = {
          width: size.width,
          height: size.height,
          fit: size.fit || 'cover',
        };
      }

      // Update the manifest
      const manifestPath = path.join(app.path, MANIFEST_FILENAME);
      await this.updateManifest(manifestPath, normalizedSlot, slotEntry);

      // Build the slot URL
      const slotUrl = mediaType === 'video'
        ? `/airo-assets/videos/${normalizedSlot}`
        : `/airo-assets/images/${normalizedSlot}`;

      logger.info('media_slot.select.success', {
        ...logContext,
        slot: normalizedSlot,
        slotUrl,
        alternativeCount: alternatives.length,
      });

      return {
        success: true,
        slot: normalizedSlot,
        slotUrl,
        mediaType,
        searchQuery: query,
        resolvedUrl: primaryUrl,
        alternativeCount: alternatives.length,
      };
    } catch (error) {
      logger.error('media_slot.select.error', {
        ...logContext,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        slot: normalizedSlot,
        slotUrl: '',
        mediaType,
        searchQuery: query,
        error: `Failed to select media: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Extract URLs from MediaSearchResult
   */
  private extractUrls(result: MediaSearchResult): string[] {
    const urls: string[] = [];

    // Fallback to direct URLs from MediaSearchResult
    if (result.urls && Array.isArray(result.urls)) {
      urls.push(...result.urls);
    } else if (result.url) {
      urls.push(result.url);
    }

    return urls;
  }

  /**
   * Read the manifest file, update with new slot, and write back
   * Note: Atomic write (temp file + rename) prevents partial writes.
   * Race condition between concurrent writes is acceptable since slots
   * are typically unique per agent conversation.
   */
  private async updateManifest(
    manifestPath: string,
    slot: string,
    entry: MediaSlot
  ): Promise<void> {
    // Read existing manifest or create empty
    let manifest: MediaManifest = {};

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
    } catch (error) {
      // File doesn't exist or is corrupt - start fresh
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('media_slot.manifest.read_error', {
          manifestPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      manifest = {};
    }

    // Check if slot already exists and preserve createdAt
    const existing = manifest[slot];
    if (existing) {
      entry.createdAt = existing.createdAt;
      // Preserve userModified if user had modified it
      if (existing.userModified) {
        entry.userModified = true;
      }
    }

    // Update the slot
    manifest[slot] = entry;

    // Write atomically (write to temp, then rename)
    const tempPath = `${manifestPath}.tmp`;
    const content = JSON.stringify(manifest, null, 2);

    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, manifestPath);

    logger.debug('media_slot.manifest.updated', {
      manifestPath,
      slot,
      totalSlots: Object.keys(manifest).length,
    });
  }

  /**
   * Read the current manifest for an app
   */
  async getManifest(appId: string): Promise<MediaManifest | null> {
    const app = this.appRepository.findById(appId);
    if (!app) {
      return null;
    }

    const manifestPath = path.join(app.path, MANIFEST_FILENAME);

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // File doesn't exist - return empty manifest
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      return null;
    }
  }

  /**
   * Get a specific slot from the manifest
   */
  async getSlot(appId: string, slot: string): Promise<MediaSlot | null> {
    const manifest = await this.getManifest(appId);
    if (!manifest) {
      return null;
    }
    return manifest[slot] || null;
  }
}

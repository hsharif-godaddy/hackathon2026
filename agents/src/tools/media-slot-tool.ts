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

import { MediaSearchTool, type MediaSearchResult, type MediaSearchOptions } from './media-search-tool.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { logger } from '../logging/index.js';
import {
  mediaManifestService,
  type MediaSlot,
  type MediaManifest,
  type MediaSize,
} from '../services/MediaManifestService.js';

// Re-export types for backwards compatibility
export type { MediaSize, MediaSlot, MediaManifest };

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
  orientations?: string | string[];
  compositions?: string | string[];
  moods?: string[];
  graphicalStyles?: string[];
  sortOrder?: string;
  color?: string;
  useService?: boolean;
  advancedFilters?: MediaSearchOptions['advancedFilters'];
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
  /** For videos: thumbnail image URL for preview display */
  thumbnailUrl?: string;
  alternatives?: string[];
  alternativeCount?: number;
  error?: string;
}

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
      moods,
      graphicalStyles,
      sortOrder,
      color,
      useService,
      advancedFilters,
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
          ...(moods && { moods }),
          ...(graphicalStyles && { graphicalStyles }),
          ...(sortOrder && { sortOrder }),
          ...(color && { color }),
          ...(useService !== undefined && { useService }),
          ...(advancedFilters && { advancedFilters }),
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

      // Extract URLs and Getty IDs from search result
      const { urls, gettyIds } = this.extractUrlsAndGettyIds(searchResult);
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

      // Extract thumbnail URL for videos (from Getty's display_sizes)
      const thumbnailUrl = mediaType === 'video' ? searchResult.thumbnailUrl : undefined;

      const toCommaSeparated = (v: string | string[] | undefined): string | undefined => {
        if (!v) return undefined;
        return Array.isArray(v) ? v.join(',') : v;
      };

      const buildSlot = (manifest: MediaManifest): MediaSlot => {
        const deduped = MediaSlotTool.dedupAgainstManifest(manifest, normalizedSlot, urls, gettyIds);
        if (deduped.skippedCount > 0) {
          logger.info('media_slot.select.deduped', {
            ...logContext,
            skippedCount: deduped.skippedCount,
            promotedIndex: deduped.skippedCount,
          });
        }
        if (deduped.exhausted) {
          logger.warn('media_slot.select.dedup_exhausted', {
            ...logContext,
            candidateCount: urls.length,
            manifestSize: Object.keys(manifest).length,
          });
        }
        if (deduped.noSignal) {
          logger.warn('media_slot.select.dedup_no_signal', {
            ...logContext,
            candidateCount: urls.length,
            manifestSize: Object.keys(manifest).length,
          });
        }

        const primaryUrl = deduped.urls[0]!;
        const alternatives = deduped.urls.slice(1);
        const primaryGettyId = deduped.gettyIds[0];
        const alternativeGettyIds = deduped.gettyIds.slice(1);

        const now = new Date().toISOString();
        const slotEntry: MediaSlot = {
          mediaType,
          currentUrl: primaryUrl,
          ...(thumbnailUrl && { thumbnailUrl }),
          searchQuery: query,
          alternatives,
          userModified: false,
          createdAt: now,
          lastUpdated: now,
          ...(primaryGettyId && { gettyId: primaryGettyId }),
          ...(alternativeGettyIds.length > 0 && { alternativeGettyIds }),
        };

        if (size) {
          slotEntry.requestedSize = {
            width: size.width,
            height: size.height,
            fit: size.fit || 'cover',
          };
        }

        if (orientations) slotEntry.orientations = toCommaSeparated(orientations);
        if (compositions) slotEntry.compositions = toCommaSeparated(compositions);
        if (moods) slotEntry.moods = moods.join(',');
        if (graphicalStyles) slotEntry.graphicalStyles = graphicalStyles.join(',');
        if (sortOrder) slotEntry.sortOrder = sortOrder;
        if (color) slotEntry.color = color;
        if (advancedFilters?.numberOfPeople) slotEntry.numberOfPeople = advancedFilters.numberOfPeople.join(',');
        if (advancedFilters?.ethnicity) slotEntry.ethnicity = advancedFilters.ethnicity.join(',');
        if (advancedFilters?.ageOfPeople) slotEntry.ageOfPeople = advancedFilters.ageOfPeople.join(',');
        if (advancedFilters?.minimumSize) slotEntry.minimumSize = advancedFilters.minimumSize;

        return slotEntry;
      };

      // Skip git commit here since AI selections are auto-committed in batches
      const manifestResult = await mediaManifestService.setSlot(appId, normalizedSlot, buildSlot, true);
      if (!manifestResult.success || !manifestResult.builtSlot) {
        throw new Error(manifestResult.error || 'Failed to update manifest');
      }

      const chosenPrimaryUrl = manifestResult.builtSlot.currentUrl;
      const chosenAlternatives = manifestResult.builtSlot.alternatives;

      const slotUrl = mediaType === 'video'
        ? `/airo-assets/videos/${normalizedSlot}`
        : `/airo-assets/images/${normalizedSlot}`;

      logger.info('media_slot.select.success', {
        ...logContext,
        slot: normalizedSlot,
        slotUrl,
        alternativeCount: chosenAlternatives.length,
      });

      return {
        success: true,
        slot: normalizedSlot,
        slotUrl,
        mediaType,
        searchQuery: query,
        resolvedUrl: chosenPrimaryUrl,
        ...(thumbnailUrl && { thumbnailUrl }),
        alternatives: chosenAlternatives,
        alternativeCount: chosenAlternatives.length,
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

  /** gettyId-only dedup; setSlot rewrites currentUrl to CDN post-builder so URL equality is cross-call meaningless. */
  static dedupAgainstManifest(
    manifest: MediaManifest,
    currentSlotPath: string,
    urls: string[],
    gettyIds: string[]
  ): {
    urls: string[];
    gettyIds: string[];
    skippedCount: number;
    exhausted: boolean;
    noSignal: boolean;
  } {
    const usedGettyIds = new Set<string>();
    for (const [slotPath, slot] of Object.entries(manifest)) {
      if (slotPath === currentSlotPath) continue;
      if (slot.gettyId) usedGettyIds.add(slot.gettyId);
    }

    if (usedGettyIds.size === 0) {
      return { urls, gettyIds, skippedCount: 0, exhausted: false, noSignal: false };
    }

    const currentId = gettyIds[0] ?? '';
    const currentIsKnownDup = currentId !== '' && usedGettyIds.has(currentId);

    if (!currentIsKnownDup) {
      // Top candidate is fresh or unverifiable — respect agent's choice. Flag noSignal if we couldn't verify.
      return { urls, gettyIds, skippedCount: 0, exhausted: false, noSignal: currentId === '' };
    }

    const firstFreshIdx = urls.findIndex((_url, i) => {
      const id = gettyIds[i] ?? '';
      return id !== '' && !usedGettyIds.has(id);
    });

    if (firstFreshIdx === -1) {
      // Top candidate is a known dup and no confidently-fresh alternative exists — caller will ship a duplicate.
      return { urls, gettyIds, skippedCount: 0, exhausted: true, noSignal: false };
    }

    const reorderedUrls = [
      urls[firstFreshIdx]!,
      ...urls.slice(0, firstFreshIdx),
      ...urls.slice(firstFreshIdx + 1),
    ];
    const reorderedGettyIds = [
      gettyIds[firstFreshIdx] ?? '',
      ...gettyIds.slice(0, firstFreshIdx),
      ...gettyIds.slice(firstFreshIdx + 1),
    ];

    return {
      urls: reorderedUrls,
      gettyIds: reorderedGettyIds,
      skippedCount: firstFreshIdx,
      exhausted: false,
      noSignal: false,
    };
  }

  /**
   * Extract URLs and Getty IDs from MediaSearchResult
   */
  private extractUrlsAndGettyIds(result: MediaSearchResult): { urls: string[]; gettyIds: string[] } {
    const urls: string[] = [];
    const gettyIds: string[] = [];

    if (result.urls && Array.isArray(result.urls)) {
      urls.push(...result.urls);
      // Pad gettyIds to match urls length to maintain alignment
      const idsArray = Array.isArray(result.gettyIds) ? result.gettyIds : [];
      for (let i = 0; i < result.urls.length; i++) {
        gettyIds.push(idsArray[i] ?? '');
      }
    } else if (result.url) {
      urls.push(result.url);
      gettyIds.push(result.gettyId ?? '');
    }

    return { urls, gettyIds };
  }

  /**
   * Read the current manifest for an app
   * Delegates to MediaManifestService for centralized access
   */
  async getManifest(appId: string): Promise<MediaManifest | null> {
    const result = await mediaManifestService.getManifest(appId);
    if (!result.success) {
      return null;
    }
    return result.manifest || null;
  }

  /**
   * Get a specific slot from the manifest
   * Delegates to MediaManifestService for centralized access
   */
  async getSlot(appId: string, slot: string): Promise<MediaSlot | null> {
    const result = await mediaManifestService.getSlot(appId, slot);
    if (!result.success) {
      return null;
    }
    return result.slot || null;
  }
}

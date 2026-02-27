/**
 * Getty Media Driver
 *
 * Handles both image and video search through Getty Images API.
 * Implements the shared MediaDriver interface for unified access.
 */
import { log } from '../../../logging/index.js';
import { toolImageSearchEvents, toolVideoSearchEvents } from '../../../logging/events/index.js';

import { BaseDriver } from './base-driver.js';
import type { MediaDriver, MediaDriverSearchOptions, MediaResult, MediaItem } from './media-driver.js';

// Re-export shared types under legacy names for backward compatibility
export type { MediaDriverSearchOptions as GettyMediaOptions };
export type { MediaResult as GettyMediaResult };
export type { MediaItem as GettyMediaItem };
export type { MediaDriverSearchOptions, MediaResult, MediaItem };

/**
 * Media type enumeration
 */
export type MediaType = 'image' | 'video';

/**
 * Getty API response structure
 */
interface GettyAPIResponse {
  result_count: number;
  images?: GettyAPIItem[];
  videos?: GettyAPIItem[];
}

/**
 * Getty API item structure
 */
interface GettyAPIItem {
  id: string;
  display_sizes: DisplaySize[];
  max_dimensions?: {
    height: number;
    width: number;
  };
  title?: string;
  caption?: string;
}

/**
 * Display size information
 */
interface DisplaySize {
  is_watermarked: boolean;
  name: string;
  uri: string;
}

/**
 * Getty Media Driver
 * Handles both image and video search with shared infrastructure.
 * Implements MediaDriver for unified access from MediaSearchTool.
 */
export class GettyMediaDriver extends BaseDriver implements MediaDriver {
  constructor() {
    super({
      serviceName: 'getty-media-driver',
      defaultBaseUrl: 'https://getty-images-proxy.api.test-godaddy.com',
      appKeyEnvVar: 'GETTY_APP_KEY',
      defaultAppKey: 'airo-app-builder',
    });
  }

  /**
   * Search for media (images or videos) using Getty API
   */
  async search(options: MediaDriverSearchOptions): Promise<MediaResult> {
    const mediaType = options.mediaType || 'image';

    try {
      const {
        query,
        count = 1,
        sortOrder = 'best_match',
        graphicalStyles,
        orientations,
        compositions,
        color,
        moods,
        numberOfPeople,
        ethnicity,
        ageOfPeople,
        minimumSize,
      } = options;

      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return {
          success: false,
          error: 'A valid search query is required',
        };
      }

      if (!this.hasAuth()) {
        return {
          success: false,
          error: this.getAuthErrorMessage(),
        };
      }

      const queryParams = new URLSearchParams({
        phrase: query,
        page: '1',
        page_size: count.toString(),
        sort_order: sortOrder,
      });

      // Array-based Getty filters - append each value as separate query param
      const arrayFilters: Array<{ param: string; values?: string[]; imageOnly: boolean }> = [
        { param: 'orientations', values: orientations, imageOnly: true },
        { param: 'compositions', values: compositions, imageOnly: true },
        { param: 'graphical_styles', values: graphicalStyles, imageOnly: true },
        { param: 'moods', values: moods, imageOnly: true },
        { param: 'number_of_people', values: numberOfPeople, imageOnly: true },
        { param: 'ethnicity', values: ethnicity, imageOnly: true },
        { param: 'age_of_people', values: ageOfPeople, imageOnly: true },
      ];

      for (const { param, values, imageOnly } of arrayFilters) {
        if (values && values.length > 0 && (!imageOnly || mediaType === 'image')) {
          for (const value of values) {
            queryParams.append(param, value);
          }
        }
      }

      if (minimumSize && mediaType === 'image') {
        queryParams.append('minimum_size', minimumSize);
      }

      if (color && mediaType === 'image') {
        queryParams.append('color', color);
      }

      const endpoint = mediaType === 'image' ? '/v1/search' : '/v1/videos/search';

      this.logger.info('getty-media.request', {
        mediaType,
        baseUrl: this.apiBaseUrl,
        endpoint,
        params: {
          phrase: query,
          page: 1,
          pageSize: count,
          sortOrder,
          ...(graphicalStyles && { graphicalStyles }),
          ...(orientations && { orientations }),
          ...(compositions && { compositions }),
          ...(color && { color }),
          ...(moods && { moods }),
          ...(numberOfPeople && { numberOfPeople }),
          ...(ethnicity && { ethnicity }),
          ...(ageOfPeople && { ageOfPeople }),
          ...(minimumSize && { minimumSize }),
        },
      });

      const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
      eventLogger.begin(this.logger, {
        toolName: 'GettyMediaDriver',
        prompt: query,
        count,
        provider: 'getty',
      });

      const response = await this.get(endpoint, queryParams);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('getty-media.request.failed', {
          mediaType,
          status: response.status,
          statusText: response.statusText,
          errorText,
        });
        throw new Error(`Getty API request failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as GettyAPIResponse;

      this.logger.info('getty-media.response', {
        mediaType,
        resultCount: data.result_count,
        itemsReturned:
          mediaType === 'image'
            ? (data.images?.length || 0)
            : (data.videos?.length || 0),
        hasResults:
          ((mediaType === 'image' ? data.images?.length : data.videos?.length) || 0) > 0,
      });
      const items = mediaType === 'image' ? data.images : data.videos;

      if (!data || !items || !Array.isArray(items) || items.length === 0) {
        this.logger.warn('getty-media.no-results', {
          mediaType,
          phrase: query,
          resultCount: data?.result_count || 0,
        });
        return {
          success: false,
          error: `No ${mediaType}s found matching your search criteria`,
        };
      }

      // For videos, perform upload step to get final URL
      if (mediaType === 'video' && items[0]) {
        const videoId = items[0].id;
        const uploadUrl = await this.uploadVideo(videoId);

        if (!uploadUrl) {
          this.logger.error('getty-media.video-upload.no-url', {
            videoId,
            phrase: query,
          });
          return {
            success: false,
            error: 'Failed to get video URL from upload response',
          };
        }

        const processedItem = this.processItem(items[0], mediaType);
        processedItem.urls.highRes = uploadUrl;

        this.logger.info('getty-media.video.success', {
          videoId,
          videoUrl: uploadUrl,
          title: processedItem.title,
        });

        return {
          success: true,
          items: [processedItem],
          totalResults: data.result_count,
        };
      }

      // For images, process all items
      const processedItems = items.map((item) => this.processItem(item, mediaType));

      this.logger.info('getty-media.images.success', {
        phrase: query,
        itemsProcessed: processedItems.length,
        totalResults: data.result_count,
        imageIds: processedItems.map((item) => item.id),
      });

      return {
        success: true,
        items: processedItems,
        totalResults: data.result_count,
      };
    } catch (error) {
      const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
      eventLogger.failure(this.logger, error as Error, {
        toolName: 'GettyMediaDriver',
        prompt: options.query,
        count: options.count || 1,
        provider: 'getty',
      });

      return {
        success: false,
        error: `Getty ${mediaType} search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Upload video to get final URL
   */
  private async uploadVideo(videoId: string): Promise<string | null> {
    try {
      this.logger.info('getty-media.video-upload.begin', { videoId });

      const response = await this.post('/v1/videos/upload?reportUsage=true', { id: videoId });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Getty Video upload request failed: ${response.status} ${errorText}`);
      }

      const uploadData = (await response.json()) as { id: string; videoUrl: string };

      if (!uploadData || !uploadData.videoUrl) {
        return null;
      }

      this.logger.info('getty-media.video-upload.success', {
        videoId,
        videoUrl: uploadData.videoUrl,
      });

      return uploadData.videoUrl;
    } catch (error) {
      log.error(this.logger, 'getty-media.video-upload.error', error as Error, { videoId });
      return null;
    }
  }

  /**
   * Process Getty API item into common MediaItem format
   */
  private processItem(item: GettyAPIItem, mediaType: string): MediaItem {
    const urls: { preview?: string; thumbnail?: string; standard?: string; highRes?: string } = {};

    if (item.display_sizes && Array.isArray(item.display_sizes)) {
      const preview = item.display_sizes.find((size) => size && size.name === 'preview');
      const thumbnail = item.display_sizes.find((size) => size && size.name === 'thumb');
      const standard = item.display_sizes.find((size) => size && size.name === 'comp');

      if (preview && preview.uri) urls.preview = preview.uri;
      if (thumbnail && thumbnail.uri) urls.thumbnail = thumbnail.uri;
      if (standard && standard.uri) urls.standard = standard.uri;

      if (mediaType === 'image') {
        const midRes = item.display_sizes.find((size) => size && size.name === 'mid_res_comp');
        const highRes = item.display_sizes.find((size) => size && size.name === 'high_res_comp');

        if (highRes && highRes.uri) {
          urls.highRes = highRes.uri;
        } else if (midRes && midRes.uri) {
          urls.highRes = midRes.uri;
        }
      }
    }

    const result: MediaItem = {
      id: item.id,
      urls,
    };

    if (item.title !== undefined) {
      result.title = item.title;
    }

    if (item.caption !== undefined) {
      result.caption = item.caption;
    }

    if (item.max_dimensions) {
      result.dimensions = {
        height: item.max_dimensions.height,
        width: item.max_dimensions.width,
      };
    }

    return result;
  }
}

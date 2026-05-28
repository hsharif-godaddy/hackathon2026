/**
 * Getty Media Driver
 *
 * Handles both image and video search through the GoDaddy Getty Images proxy
 * (`api.{test-,}godaddy.com/getty-proxy` or env-configured base). Auth and
 * S2S token lifecycle live in `BaseDriverV2` (`USE_S2S_AUTH`, `S2S_AWS_PROFILE`,
 * `SSO_HOST`). Proxy base URL: `GETTY_IMAGE_PROXY_URL` or dev direct proxy default.
 *
 * Implements the shared MediaDriver interface for unified access.
 */
import { log } from '../../../logging/index.js';
import { toolImageSearchEvents, toolVideoSearchEvents } from '../../../logging/events/index.js';

import { BaseDriverV2 } from './base-driver-v2.js';
import { GETTY_CONFIG_MEDIA_AUTH_MISSING } from './getty-config-messages.js';
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
export class GettyMediaDriver extends BaseDriverV2 implements MediaDriver {
  constructor() {
    const baseUrl = (
      process.env.GETTY_IMAGE_PROXY_URL || 'https://getty-images-proxy.api.dev-godaddy.com'
    ).replace(/\/+$/, '');
    super({
      serviceName: 'getty-media-driver-v2',
      baseUrl,
      appKeyEnvVar: 'GETTY_APP_KEY',
      defaultAppKey: 'airo-app-builder',
    });

    this.logger.info('getty-media-driver.config.initialized', {
      baseUrl: this.apiBaseUrl,
    });

    if (!this.hasAuth()) {
      this.logger.warn('getty-media-driver.auth.missing', {
        message: GETTY_CONFIG_MEDIA_AUTH_MISSING,
      });
    }
  }

  /**
   * Filter keys that can be dropped during relaxation.
   */
  private static readonly DROPPABLE_FILTER_KEYS = [
    'moods',
    'orientations',
    'compositions',
    'graphicalStyles',
    'numberOfPeople',
    'ethnicity',
    'ageOfPeople',
    'minimumSize',
    'color',
  ] as const;

  /**
   * Filter relaxation levels for retry when searches return zero results.
   * Each level progressively removes more filters to broaden the search.
   */
  private static readonly FILTER_RELAXATION_LEVELS: Array<{
    name: string;
    drop: Set<(typeof GettyMediaDriver.DROPPABLE_FILTER_KEYS)[number]>;
  }> = [
      { name: 'all-filters', drop: new Set() },
      { name: 'drop-moods', drop: new Set(['moods']) },
      { name: 'drop-moods-orientations', drop: new Set(['moods', 'orientations']) },
      {
        name: 'drop-advanced',
        drop: new Set([
          'moods',
          'orientations',
          'numberOfPeople',
          'ethnicity',
          'ageOfPeople',
          'minimumSize',
        ]),
      },
      {
        name: 'query-only',
        drop: new Set([
          'moods',
          'orientations',
          'compositions',
          'graphicalStyles',
          'numberOfPeople',
          'ethnicity',
          'ageOfPeople',
          'minimumSize',
          'color',
        ]),
      },
    ];

  /**
   * Search for media (images or videos) using Getty API.
   * Automatically retries with progressively relaxed filters when no results are found.
   */
  async search(options: MediaDriverSearchOptions): Promise<MediaResult> {
    const mediaType = options.mediaType || 'image';

    try {
      const {
        query,
        count = 1,
        sortOrder = 'best_match',
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
          error: GETTY_CONFIG_MEDIA_AUTH_MISSING,
        };
      }

      const endpoint = mediaType === 'image' ? '/v1/search' : '/v1/videos/search';

      if (mediaType === 'video') {
        toolVideoSearchEvents.begin(this.logger, {
          toolName: 'GettyMediaDriver',
          prompt: query,
          provider: 'getty',
        });
      } else {
        toolImageSearchEvents.begin(this.logger, {
          toolName: 'GettyMediaDriver',
          prompt: query,
          count,
          provider: 'getty',
        });
      }

      const levels = GettyMediaDriver.FILTER_RELAXATION_LEVELS;
      let previousQueryString: string | null = null;

      for (let i = 0; i < levels.length; i++) {
        const level = levels[i]!;
        const isLastLevel = i === levels.length - 1;
        const queryParams = this.buildQueryParams(options, level.drop);
        const queryString = queryParams.toString();

        if (previousQueryString !== null && previousQueryString === queryString) {
          continue;
        }
        previousQueryString = queryString;

        this.logger.info('getty-media.request', {
          mediaType,
          baseUrl: this.apiBaseUrl,
          endpoint,
          relaxationLevel: level.name,
          queryString,
        });

        const response = await this.get(endpoint, queryParams);

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error('getty-media.request.failed', {
            mediaType,
            status: response.status,
            statusText: response.statusText,
            errorText,
            relaxationLevel: level.name,
          });
          throw new Error(`Getty API request failed: ${response.status} ${errorText}`);
        }

        const data = (await response.json()) as GettyAPIResponse;
        const items = mediaType === 'image' ? data.images : data.videos;

        this.logger.info('getty-media.response', {
          mediaType,
          resultCount: data.result_count,
          itemsReturned: items?.length || 0,
          hasResults: (items?.length || 0) > 0,
          relaxationLevel: level.name,
        });

        if (!data || !items || !Array.isArray(items) || items.length === 0) {
          if (!isLastLevel) {
            this.logger.info('getty-media.retry.relaxing-filters', {
              mediaType,
              phrase: query,
              currentLevel: level.name,
              resultCount: data?.result_count || 0,
            });
            continue;
          }

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

        if (i > 0) {
          this.logger.info('getty-media.retry.succeeded', {
            mediaType,
            phrase: query,
            relaxationLevel: level.name,
            resultCount: data.result_count,
          });
        }

        if (mediaType === 'video') {
          toolVideoSearchEvents.success(this.logger, {
            toolName: 'GettyMediaDriver',
            prompt: query,
            provider: 'getty',
            resultUrl: items[0]?.display_sizes?.[0]?.uri || '',
          });
        } else {
          toolImageSearchEvents.success(this.logger, {
            toolName: 'GettyMediaDriver',
            prompt: query,
            count,
            provider: 'getty',
            resultCount: data.result_count,
          });
        }

        return this.processSearchResults(data, items, mediaType, query);
      }

      return {
        success: false,
        error: `No ${mediaType}s found matching your search criteria`,
      };
    } catch (error) {
      if (mediaType === 'video') {
        toolVideoSearchEvents.failure(this.logger, error as Error, {
          toolName: 'GettyMediaDriver',
          prompt: options.query,
          provider: 'getty',
        });
      } else {
        toolImageSearchEvents.failure(this.logger, error as Error, {
          toolName: 'GettyMediaDriver',
          prompt: options.query,
          count: options.count || 1,
          provider: 'getty',
        });
      }

      return {
        success: false,
        error: `Getty ${mediaType} search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Build URLSearchParams for a Getty search, dropping specified filter keys.
   */
  private buildQueryParams(
    options: MediaDriverSearchOptions,
    dropFilters: Set<(typeof GettyMediaDriver.DROPPABLE_FILTER_KEYS)[number]>,
  ): URLSearchParams {
    const mediaType = options.mediaType || 'image';
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

    const queryParams = new URLSearchParams({
      phrase: query,
      page: '1',
      page_size: count.toString(),
      sort_order: sortOrder,
    });

    type DroppableFilterKey = (typeof GettyMediaDriver.DROPPABLE_FILTER_KEYS)[number];
    const arrayFilters: Array<{ key: DroppableFilterKey; param: string; values?: string[]; imageOnly: boolean }> = [
      { key: 'orientations', param: 'orientations', values: orientations, imageOnly: true },
      { key: 'compositions', param: 'compositions', values: compositions, imageOnly: true },
      { key: 'graphicalStyles', param: 'graphical_styles', values: graphicalStyles, imageOnly: true },
      { key: 'moods', param: 'moods', values: moods, imageOnly: true },
      { key: 'numberOfPeople', param: 'number_of_people', values: numberOfPeople, imageOnly: true },
      { key: 'ethnicity', param: 'ethnicity', values: ethnicity, imageOnly: true },
      { key: 'ageOfPeople', param: 'age_of_people', values: ageOfPeople, imageOnly: true },
    ];

    for (const { key, param, values, imageOnly } of arrayFilters) {
      if (dropFilters.has(key)) continue;
      if (values && values.length > 0 && (!imageOnly || mediaType === 'image')) {
        for (const value of values) {
          queryParams.append(param, value);
        }
      }
    }

    if (!dropFilters.has('minimumSize') && minimumSize && mediaType === 'image') {
      queryParams.append('minimum_size', minimumSize);
    }

    if (!dropFilters.has('color') && color && mediaType === 'image') {
      queryParams.append('color', color);
    }

    return queryParams;
  }

  /**
   * Process successful search results into MediaResult format.
   */
  private async processSearchResults(
    data: GettyAPIResponse,
    items: GettyAPIItem[],
    mediaType: string,
    query: string,
  ): Promise<MediaResult> {
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

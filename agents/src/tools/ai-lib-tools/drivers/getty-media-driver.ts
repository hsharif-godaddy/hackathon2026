/**
 * Unified Getty Media Driver
 * 
 * Handles both image and video search through Getty Images API
 * Consolidates common functionality to eliminate code duplication
 */
import { log } from '../../../logging/index.js';
import { toolImageSearchEvents, toolVideoSearchEvents } from '../../../logging/events/index.js';

import { BaseDriver } from './base-driver.js';

/**
 * Media type enumeration
 */
export type MediaType = 'image' | 'video';

/**
 * Options for Getty media search
 */
export interface GettyMediaOptions {
  phrase: string;
  page?: number;
  pageSize?: number;
  sortOrder?: string;
  graphicalStyles?: string;
  orientations?: string;
  compositions?: string;
  color?: string;
}

/**
 * Getty media result
 */
export interface GettyMediaResult {
  success: boolean;
  items?: GettyMediaItem[];
  totalResults?: number;
  error?: string;
}

/**
 * Getty media item (image or video)
 */
export interface GettyMediaItem {
  id: string;
  urls: {
    preview?: string;
    thumbnail?: string;
    standard?: string;
    highRes?: string;
  };
  dimensions?: {
    height?: number;
    width?: number;
  };
  title?: string;
  caption?: string;
}

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
 * Unified Getty Media Tool
 * Handles both image and video search with shared infrastructure
 */
export class GettyMediaDriver extends BaseDriver {
  constructor() {
    super({
      serviceName: 'getty-media-driver',
      defaultBaseUrl: 'https://getty-images-proxy.api.test-godaddy.com',
      appKeyEnvVar: 'GETTY_APP_KEY',
      defaultAppKey: 'airo-app-builder',
    });
  }

  /**
   * Convert filter values from PascalCase/mixed format to Getty API's expected lowercase snake_case
   * 
   * Note: Getty API only supports single values per filter parameter, not comma-separated lists.
   * This function takes the first value if multiple are provided.
   * 
   * @param value - Filter value or comma-separated values (e.g., "Horizontal,Square" or "CopySpace,Candid")
   * @returns Single lowercase snake_case value (e.g., "horizontal" or "copy_space")
   */
  private convertToGettyFormat(value: string): string {
    // Getty API doesn't support multiple values - take only the first one
    const firstValue = (value.split(',')[0] || '').trim();
    
    // Convert PascalCase to snake_case and lowercase
    return firstValue
      .replace(/([A-Z])/g, '_$1') // Add underscore before capitals
      .toLowerCase()
      .replace(/^_/, ''); // Remove leading underscore
  }

  /**
   * Search for media (images or videos) using Getty API
   * 
   * @param mediaType - Type of media to search ('image' or 'video')
   * @param options - Search options
   * @returns Promise resolving to media search result
   */
  async search(mediaType: MediaType, options: GettyMediaOptions): Promise<GettyMediaResult> {
    try {
      const { phrase, page = 1, pageSize = 1, sortOrder = 'best_match', graphicalStyles, orientations, compositions, color } = options;

      if (!phrase || typeof phrase !== 'string' || phrase.trim().length === 0) {
        return {
          success: false,
          error: 'A valid search phrase is required'
        };
      }

      if (!this.hasAuth()) {
        return {
          success: false,
          error: this.getAuthErrorMessage()
        };
      }

      const queryParams = new URLSearchParams({
        phrase,
        page: page.toString(),
        page_size: pageSize.toString(),
        sort_order: sortOrder
      });

      if (graphicalStyles && mediaType === 'image') {
        queryParams.append('graphical_styles', graphicalStyles);
      }

      // Getty API expects lowercase snake_case values for filters
      if (orientations && mediaType === 'image') {
        const converted = this.convertToGettyFormat(orientations);
        this.logger.info('getty-media.filter.conversion', { 
          filter: 'orientations', 
          original: orientations, 
          converted 
        });
        queryParams.append('orientations', converted);
      }

      if (compositions && mediaType === 'image') {
        const converted = this.convertToGettyFormat(compositions);
        this.logger.info('getty-media.filter.conversion', { 
          filter: 'compositions', 
          original: compositions, 
          converted 
        });
        queryParams.append('compositions', converted);
      }

      if (color && mediaType === 'image') {
        // Color parameter expects hex format (e.g., #FF0000)
        queryParams.append('color', color);
      }

      const endpoint = mediaType === 'image' ? '/v1/search' : '/v1/videos/search';

      // Log the full request with all parameters
      this.logger.info('getty-media.request', {
        mediaType,
        baseUrl: this.apiBaseUrl,
        endpoint,
        params: {
          phrase,
          page,
          pageSize,
          sortOrder,
          ...(graphicalStyles && { graphicalStyles }),
          ...(orientations && { orientations }),
          ...(compositions && { compositions }),
          ...(color && { color })
        }
      });

      const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
      eventLogger.begin(this.logger, {
        toolName: 'GettyMediaDriver',
        prompt: phrase,
        count: pageSize,
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

      const data = await response.json() as GettyAPIResponse;

      // Log the response summary
      this.logger.info('getty-media.response', {
        mediaType,
        resultCount: data.result_count,
        itemsReturned: mediaType === 'image' 
          ? (data.images?.length || 0)
          : (data.videos?.length || 0),
        hasResults: ((mediaType === 'image' ? data.images?.length : data.videos?.length) || 0) > 0
      });
      const items = mediaType === 'image' ? data.images : data.videos;

      if (!data || !items || !Array.isArray(items) || items.length === 0) {
        this.logger.warn('getty-media.no-results', {
          mediaType,
          phrase,
          resultCount: data?.result_count || 0
        });
        return {
          success: false,
          error: `No ${mediaType}s found matching your search criteria`
        };
      }

      // For videos, perform upload step to get final URL
      if (mediaType === 'video' && items[0]) {
        const videoId = items[0].id;
        const uploadUrl = await this.uploadVideo(videoId);
        
        if (!uploadUrl) {
          this.logger.error('getty-media.video-upload.no-url', {
            videoId,
            phrase
          });
          return {
            success: false,
            error: 'Failed to get video URL from upload response'
          };
        }

        const processedItem = this.processItem(items[0], mediaType);
        processedItem.urls.highRes = uploadUrl;

        this.logger.info('getty-media.video.success', {
          videoId,
          videoUrl: uploadUrl,
          title: processedItem.title
        });

        return {
          success: true,
          items: [processedItem],
          totalResults: data.result_count
        };
      }

      // For images, process all items
      const processedItems = items.map(item => this.processItem(item, mediaType));

      this.logger.info('getty-media.images.success', {
        phrase,
        itemsProcessed: processedItems.length,
        totalResults: data.result_count,
        imageIds: processedItems.map(item => item.id)
      });

      return {
        success: true,
        items: processedItems,
        totalResults: data.result_count
      };

    } catch (error) {
      const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
      eventLogger.failure(this.logger, error as Error, {
        toolName: 'GettyMediaDriver',
        prompt: options.phrase,
        count: options.pageSize || 1,
        provider: 'getty',
      });
      
      return {
        success: false,
        error: `Getty ${mediaType} search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Upload video to get final URL
   * 
   * @param videoId - Video ID from search results
   * @returns Promise resolving to video URL or null
   */
  private async uploadVideo(videoId: string): Promise<string | null> {
    try {
      this.logger.info('getty-media.video-upload.begin', { videoId });

      const response = await this.post('/v1/videos/upload?reportUsage=true', { id: videoId });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Getty Video upload request failed: ${response.status} ${errorText}`);
      }

      const uploadData = await response.json() as { id: string; videoUrl: string };

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
   * Process Getty API item into common format
   * 
   * @param item - Getty API item
   * @param mediaType - Type of media
   * @returns Processed media item
   */
  private processItem(item: GettyAPIItem, mediaType: MediaType): GettyMediaItem {
    const urls: { preview?: string; thumbnail?: string; standard?: string; highRes?: string } = {};

    if (item.display_sizes && Array.isArray(item.display_sizes)) {
      const preview = item.display_sizes.find(size => size && size.name === 'preview');
      const thumbnail = item.display_sizes.find(size => size && size.name === 'thumb');
      const standard = item.display_sizes.find(size => size && size.name === 'comp');

      if (preview && preview.uri) urls.preview = preview.uri;
      if (thumbnail && thumbnail.uri) urls.thumbnail = thumbnail.uri;
      if (standard && standard.uri) urls.standard = standard.uri;

      if (mediaType === 'image') {
        const midRes = item.display_sizes.find(size => size && size.name === 'mid_res_comp');
        const highRes = item.display_sizes.find(size => size && size.name === 'high_res_comp');

        if (highRes && highRes.uri) {
          urls.highRes = highRes.uri;
        } else if (midRes && midRes.uri) {
          urls.highRes = midRes.uri;
        }
      }
    }

    const result: GettyMediaItem = {
      id: item.id,
      urls
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
        width: item.max_dimensions.width
      };
    }

    return result;
  }
}


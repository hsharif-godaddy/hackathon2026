/**
 * Unified Getty Media Driver
 * 
 * Handles both image and video search through Getty Images API
 * Consolidates common functionality to eliminate code duplication
 */
import { Logger, log } from '../../../logging/index.js';
import { toolImageSearchEvents, toolVideoSearchEvents } from '../../../logging/events/index.js';

const logger = Logger.create({ service: 'getty-media-driver' });

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
export class GettyMediaDriver {
  private apiBaseUrl: string;
  private appKey: string;
  private ssoJwt: string;

  constructor() {
    // Extract base URL without any path components
    const baseUrl = process.env.GETTY_API_URL || 'https://getty-images-proxy.api.test-godaddy.com';
    
    // Strip any path components to get clean base URL (backward compatibility)
    try {
      const urlObj = new URL(baseUrl);
      this.apiBaseUrl = `${urlObj.protocol}//${urlObj.host}`;
    } catch (error) {
      // If URL parsing fails, strip common path patterns
      this.apiBaseUrl = baseUrl.replace(/\/(img\/search|v1\/search|v1\/videos).*$/, '');
    }
    
    this.appKey = process.env.GETTY_APP_KEY || 'airo-app-builder';

    if (process.env.GETTY_TOKEN) {
      this.ssoJwt = 'Bearer ' + process.env.GETTY_TOKEN;
    } else if (process.env.SSO_JWT) {
      this.ssoJwt = 'sso-jwt ' + process.env.SSO_JWT;
    } else {
      this.ssoJwt = '';
    }

    if (!this.ssoJwt) {
      logger.warn('getty-media.auth.missing', {
        message: 'Neither GETTY_TOKEN nor SSO_JWT is set',
      });
    }
    
    // Log the configured base URL for debugging
    logger.info('getty-media.config.initialized', {
      configuredUrl: baseUrl,
      cleanedBaseUrl: this.apiBaseUrl,
      hasToken: !!this.ssoJwt
    });
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
      const { phrase, page = 1, pageSize = 1, sortOrder = 'best_match', graphicalStyles } = options;

      if (!phrase || typeof phrase !== 'string' || phrase.trim().length === 0) {
        return {
          success: false,
          error: 'A valid search phrase is required'
        };
      }

      if (!this.ssoJwt) {
        return {
          success: false,
          error: 'SSO JWT token is not configured. Please add it to your .env file.'
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

      const endpoint = mediaType === 'image' ? '/v1/search' : '/v1/videos/search';
      const url = `${this.apiBaseUrl}${endpoint}?${queryParams.toString()}`;

      // Log the full URL being requested for debugging
      logger.info('getty-media.request.url', {
        mediaType,
        baseUrl: this.apiBaseUrl,
        endpoint,
        fullUrl: url
      });

      const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
      eventLogger.begin(logger, {
        toolName: 'GettyMediaDriver',
        prompt: phrase,
        count: pageSize,
        provider: 'getty',
      });

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': this.ssoJwt,
          'x-app-key': this.appKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Getty API request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as GettyAPIResponse;
      const items = mediaType === 'image' ? data.images : data.videos;

      if (!data || !items || !Array.isArray(items) || items.length === 0) {
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
          return {
            success: false,
            error: 'Failed to get video URL from upload response'
          };
        }

        const processedItem = this.processItem(items[0], mediaType);
        processedItem.urls.highRes = uploadUrl;

        return {
          success: true,
          items: [processedItem],
          totalResults: data.result_count
        };
      }

      // For images, process all items
      const processedItems = items.map(item => this.processItem(item, mediaType));

      return {
        success: true,
        items: processedItems,
        totalResults: data.result_count
      };

    } catch (error) {
      const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
      eventLogger.failure(logger, error as Error, {
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
      logger.info('getty-media.video-upload.begin', { videoId });

      const uploadUrl = `${this.apiBaseUrl}/v1/videos/upload`;
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': this.ssoJwt,
          'x-app-key': this.appKey,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: videoId })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Getty Video upload request failed: ${response.status} ${errorText}`);
      }

      const uploadData = await response.json() as { id: string; videoUrl: string };

      if (!uploadData || !uploadData.videoUrl) {
        return null;
      }

      logger.info('getty-media.video-upload.success', {
        videoId,
        videoUrl: uploadData.videoUrl,
      });

      return uploadData.videoUrl;
    } catch (error) {
      log.error(logger, 'getty-media.video-upload.error', error as Error, { videoId });
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


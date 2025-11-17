/**
 * Media Search Tool - Unified Image and Video Search
 * 
 * This tool provides both image and video search functionality using Getty Images API.
 * By default, it searches for images unless explicitly requested to search for videos.
 * 
 * Configuration:
 * - Requires SSO_JWT, GETTY_API_URL, and GETTY_APP_KEY environment variables
 * 
 * Usage:
 * ```typescript
 * // Search for images (default)
 * const result = await findMedia({ prompt: "sunset over mountains" });
 * 
 * // Search for a video explicitly
 * const videoResult = await findMedia({ prompt: "ocean waves", mediaType: "video" });
 * 
 * // Search for multiple images
 * const multipleImages = await findMedia({ prompt: "sunset", count: 5 });
 * 
 * // Parallel image search
 * const parallelResults = await findMedia({ 
 *   prompt: ["cats", "dogs"], 
 *   count: 2 
 * });
 * ```
 */
import { GettyMediaDriver } from './ai-lib-tools/drivers/getty-media-driver.js';
import { logger } from '../logging/index.js';
import { toolImageSearchEvents, toolVideoSearchEvents } from '../logging/events/index.js';

/**
 * Media type enumeration
 */
export type MediaType = 'image' | 'video';

/**
 * Options for media search
 */
export interface MediaSearchOptions {
  prompt: string | string[];
  mediaType?: MediaType;
  count?: number;
}

/**
 * Result from media search
 */
export interface MediaSearchResult {
  success: boolean;
  url?: string;
  urls?: string[];
  error?: string;
  results?: Array<{
    prompt: string;
    success: boolean;
    url?: string;
    urls?: string[];
    error?: string;
  }>;
}

/**
 * Service for searching media (images or videos) using Getty Images API
 * 
 * By default searches for images. Set mediaType to 'video' for video search.
 * Video search only supports single prompts (no parallel search or count).
 */
export class MediaSearchTool {
  private driver: GettyMediaDriver;

  constructor() {
    this.driver = new GettyMediaDriver();
  }

  /**
   * Search for media (image or video) based on the given prompt(s)
   * 
   * @param prompt - The search prompt or array of prompts (array only for images)
   * @param mediaType - Type of media to search for ('image' or 'video', defaults to 'image')
   * @param count - Number of results per prompt (only for images)
   * @returns An object containing the media URL(s) or an error
   */
  async searchMedia(
    prompt: string | string[], 
    mediaType: MediaType = 'image',
    count?: number
  ): Promise<MediaSearchResult> {
    // Video search validation
    if (mediaType === 'video') {
      if (Array.isArray(prompt)) {
        return {
          success: false,
          error: 'Video search does not support multiple prompts. Please provide a single prompt.'
        };
      }

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return {
          success: false,
          error: 'A valid search prompt is required for video search'
        };
      }

      return this.searchSingle(prompt, 'video');
    }

    // Image search (default)
    if (Array.isArray(prompt)) {
      if (prompt.length === 0 || prompt.some(p => !p || typeof p !== 'string' || p.trim().length === 0)) {
        return {
          success: false,
          error: 'All prompts must be valid non-empty strings'
        };
      }

      if (prompt.length > 20) {
        return {
          success: false,
          error: 'Maximum 20 prompts allowed for parallel search'
        };
      }

      return this.searchParallel(prompt, count || 1);
    }

    // Single image search
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return {
        success: false,
        error: 'A valid search prompt is required'
      };
    }

    if (count !== undefined && (count < 1 || count > 50)) {
      return {
        success: false,
        error: 'Count must be between 1 and 50'
      };
    }

    return this.searchSingle(prompt, 'image', count || 1);
  }

  /**
   * Search for single media item (image or video)
   * 
   * @param prompt - The search prompt
   * @param mediaType - Type of media to search
   * @param count - Number of results (only for images)
   * @returns Promise resolving to media search result
   */
  private async searchSingle(
    prompt: string,
    mediaType: MediaType,
    count = 1
  ): Promise<MediaSearchResult> {
    try {
      const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
      eventLogger.begin(logger, {
        toolName: 'MediaSearchTool',
        prompt,
        count,
        provider: 'getty',
      });

      const result = await this.driver.search(mediaType, {
        phrase: prompt.trim(),
        page: 1,
        pageSize: Math.min(count, mediaType === 'image' ? 10 : 1),
        ...(mediaType === 'image' && { graphicalStyles: 'photography' }),
        sortOrder: 'best_match'
      });

      if (!result.success || !result.items || result.items.length === 0) {
        eventLogger.failure(logger, new Error(result.error || `No ${mediaType}s found`), {
          toolName: 'MediaSearchTool',
          prompt,
          count,
          provider: 'getty',
        });
        return {
          success: false,
          error: result.error || `No ${mediaType}s found for this search query`
        };
      }

      const mediaUrls: string[] = [];
      for (const item of result.items.slice(0, count)) {
        const mediaUrl = item?.urls?.highRes || item?.urls?.standard || item?.urls?.preview || item?.urls?.thumbnail;
        if (mediaUrl) {
          mediaUrls.push(mediaUrl);
        }
      }

      if (mediaUrls.length === 0) {
        eventLogger.failure(logger, new Error(`No valid ${mediaType} URLs found`), {
          toolName: 'MediaSearchTool',
          prompt,
          count,
          provider: 'getty',
        });
        return {
          success: false,
          error: `No valid ${mediaType} URLs found in Getty response`
        };
      }

      if (mediaType === 'video') {
        (eventLogger as any).success(logger, {
          toolName: 'MediaSearchTool',
          prompt,
          provider: 'getty',
          resultUrl: mediaUrls[0] || '',
        });
      } else {
        (eventLogger as any).success(logger, {
          toolName: 'MediaSearchTool',
          prompt,
          count,
          provider: 'getty',
          resultUrls: mediaUrls,
          resultCount: mediaUrls.length,
        });
      }

      if (count === 1 && mediaUrls.length > 0) {
        return {
          success: true,
          url: mediaUrls[0]!
        };
      } else {
        return {
          success: true,
          urls: mediaUrls
        };
      }
    } catch (error) {
      const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
      eventLogger.failure(logger, error as Error, {
        toolName: 'MediaSearchTool',
        prompt,
        count,
        provider: 'getty',
      });
      return {
        success: false,
        error: `Getty ${mediaType} search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Search for multiple images in parallel
   * 
   * @param prompts - Array of search prompts
   * @param count - Number of results per prompt
   * @returns Promise resolving to parallel search result
   */
  private async searchParallel(prompts: string[], count = 1): Promise<MediaSearchResult> {
    try {
      toolImageSearchEvents.begin(logger, {
        toolName: 'MediaSearchTool',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'getty',
      });

      const searchPromises = prompts.map(prompt => this.searchSingle(prompt, 'image', count));
      const results = await Promise.all(searchPromises);

      const combinedResults = results.map((result, index) => {
        const combined: {
          prompt: string;
          success: boolean;
          url?: string;
          urls?: string[];
          error?: string;
        } = {
          prompt: prompts[index] || '',
          success: result.success,
        };
        if (result.url) combined.url = result.url;
        if (result.urls) combined.urls = result.urls;
        if (result.error) combined.error = result.error;
        return combined;
      });

      const hasAnySuccess = results.some(r => r.success);

      toolImageSearchEvents.success(logger, {
        toolName: 'MediaSearchTool',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'getty',
        resultUrls: results.flatMap(r => r.urls || (r.url ? [r.url] : [])),
        resultCount: results.reduce((sum, r) => sum + (r.urls?.length || (r.url ? 1 : 0)), 0),
      });

      if (hasAnySuccess) {
        return {
          success: true,
          results: combinedResults
        };
      } else {
        return {
          success: false,
          results: combinedResults,
          error: 'All parallel searches failed'
        };
      }
    } catch (error) {
      toolImageSearchEvents.failure(logger, error as Error, {
        toolName: 'MediaSearchTool',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'getty',
      });
      return {
        success: false,
        error: `Getty parallel image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Tool interface for media search - maintains backward compatibility
 * 
 * @param options - Search options with prompt, optional mediaType, and optional count
 * @returns Promise resolving to media search result
 */
export async function findMedia(options: MediaSearchOptions): Promise<MediaSearchResult> {
  const { prompt, mediaType = 'image', count } = options;

  // Validate prompt
  if (Array.isArray(prompt)) {
    if (prompt.length === 0 || prompt.some(p => !p || typeof p !== 'string')) {
      return {
        success: false,
        error: 'A valid array of search prompts is required'
      };
    }
  } else if (!prompt || typeof prompt !== 'string') {
    return {
      success: false,
      error: 'A valid search prompt is required'
    };
  }

  try {
    const mediaSearchTool = new MediaSearchTool();
    return await mediaSearchTool.searchMedia(prompt, mediaType, count);
  } catch (error) {
    const promptForLog = Array.isArray(prompt) ? prompt.join(', ') : prompt;
    
    if (mediaType === 'video') {
      toolVideoSearchEvents.failure(logger, error as Error, {
        toolName: 'MediaSearchTool',
        prompt: promptForLog,
        provider: 'getty'
      });
    } else {
      toolImageSearchEvents.failure(logger, error as Error, {
        toolName: 'MediaSearchTool',
        prompt: promptForLog,
        provider: 'getty',
        count: count ?? 1
      });
    }

    return {
      success: false,
      error: `Media search failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}


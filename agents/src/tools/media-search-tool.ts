/**
 * Media Tool - Unified Image Search, Video Search, and Image Generation
 *
 * This tool provides image search, video search, and AI image generation.
 * By default, it searches for images. Use mediaType to specify video search or image generation.
 *
 * Configuration:
 * - Image/Video Search: Requires either GOCODE_USE_S2S_AUTH=true (hosted) or SSO_JWT (local).
 *   GETTY_IMAGE_PROXY_URL is optional (defaults: test uses getty-images-proxy for jomax SSO, api.test gateway when S2S-only; prod uses api.godaddy.com/getty-proxy).
 *   GETTY_APP_KEY defaults to 'airo-app-builder'.
 * - Image Generation: Uses OpenAI DALL-E via ai-lib unified provider
 *
 * Usage:
 * ```typescript
 * // Search for images (default)
 * const result = await findMedia({ prompt: "sunset over mountains" });
 *
 * // Search for a video explicitly
 * const videoResult = await findMedia({ prompt: "ocean waves", mediaType: "video" });
 *
 * // Generate an image with AI
 * const generateResult = await findMedia({
 *   prompt: "sunset over mountains",
 *   mediaType: "generate",
 *   appId: "app123"
 * });
 *
 * // Search for multiple images
 * const multipleImages = await findMedia({ prompt: "sunset", count: 5 });
 * ```
 */
import { GettyMediaDriver } from './ai-lib-tools/drivers/getty-media-driver.js';
import { ImageSearchServiceDriver } from './ai-lib-tools/drivers/image-search-service-driver.js';
import type { MediaDriver, MediaDriverSearchOptions } from './ai-lib-tools/drivers/media-driver.js';
import { createOpenAIClient } from '@airo/ai-lib';
import { AIRO_ASSET_UPLOADS_URL_PREFIX } from '@airo/shared/media';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { nanoid } from 'nanoid';
import { logger } from '../logging/index.js';
import {
  toolImageSearchEvents,
  toolVideoSearchEvents,
  toolImageGenerationEvents,
} from '../logging/events/index.js';
import OpenAI from 'openai';
import { createForWorkspace } from '../workspace/index.js';

/**
 * Media type enumeration - now includes generate
 */
export type MediaType = 'image' | 'video' | 'generate';

/**
 * Options for media search and generation
 */
export interface MediaSearchOptions {
  prompt: string | string[];
  mediaType?: MediaType;
  count?: number;
  useService?: boolean; // per-request toggle

  // Core filters (top-level for LLM visibility)
  orientations?: string | string[];
  compositions?: string | string[];
  moods?: string[];
  graphicalStyles?: string[];
  sortOrder?: string;
  color?: string;

  // Advanced filters (nested object).
  // Note: numberOfPeople, ethnicity, ageOfPeople, minimumSize are supported by both Getty and the service.
  // The remaining fields (subjectCategory, copySpaceAmount, copySpaceLocation, usageContext,
  // backgroundType, visualComplexity, tone, peopleFocus) are only supported by the image search service
  // and are silently ignored when useService is false.
  advancedFilters?: {
    numberOfPeople?: string[];
    ethnicity?: string[];
    ageOfPeople?: string[];
    minimumSize?: string;
    subjectCategory?: string[];
    copySpaceAmount?: string[];
    copySpaceLocation?: string[];
    usageContext?: string[];
    backgroundType?: string[];
    visualComplexity?: string[];
    tone?: string[];
    peopleFocus?: string[];
  };

  // For image generation (mediaType: 'generate')
  appId?: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  filename?: string;
}

/**
 * Result from media search or generation
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
    gettyId?: string;
    gettyIds?: string[];
  }>;
  // For video results - thumbnail image for preview
  thumbnailUrl?: string;
  // For image generation
  filepath?: string;
  publicPath?: string;
  base64Data?: string;
  /** Getty image ID corresponding to url field */
  gettyId?: string;
  /** Getty image IDs corresponding to urls array (same order) */
  gettyIds?: string[];
}

/**
 * Service for searching media (images or videos) using Getty Images API
 * and generating images using OpenAI DALL-E
 *
 * By default searches for images. Set mediaType to 'video' for video search
 * or 'generate' for AI image generation.
 * Video search only supports single prompts (no parallel search or count).
 * Image generation requires appId and only supports single prompts.
 */
export class MediaSearchTool {
  private gettyDriver: GettyMediaDriver;
  private serviceDriver: ImageSearchServiceDriver;
  private appsBaseDir: string;

  constructor() {
    this.gettyDriver = new GettyMediaDriver();
    this.serviceDriver = new ImageSearchServiceDriver();
    this.appsBaseDir = process.env.APPS_BASE_DIR || '/tmp/airo-app-builder';
  }

  /**
   * Search for media (image or video) or generate an image based on the given prompt(s)
   *
   * @param prompt - The search/generation prompt or array of prompts (array only for image search)
   * @param mediaType - Type of media to search/generate ('image', 'video', or 'generate', defaults to 'image')
   * @param count - Number of results per prompt (only for image search)
   * @param appId - App ID for image generation (required when mediaType is 'generate')
   * @param size - Image size for generation (only for 'generate')
   * @param filename - Custom filename for generation (only for 'generate')
   * @param options - Additional search options (orientations, compositions, color)
   * @returns An object containing the media URL(s) or generation result
   */
  async searchMedia(
    prompt: string | string[],
    mediaType: MediaType = 'image',
    count?: number,
    appId?: string,
    size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto',
    filename?: string,
    options?: {
      orientations?: string | string[];
      compositions?: string | string[];
      color?: string;
      moods?: string[];
      graphicalStyles?: string[];
      sortOrder?: string;
      useService?: boolean;
      advancedFilters?: MediaSearchOptions['advancedFilters'];
    }
  ): Promise<MediaSearchResult> {
    // Image generation
    if (mediaType === 'generate') {
      if (Array.isArray(prompt)) {
        return {
          success: false,
          error:
            'Image generation does not support multiple prompts. Please provide a single prompt.',
        };
      }

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return {
          success: false,
          error: 'A valid prompt is required for image generation',
        };
      }

      if (!appId) {
        return {
          success: false,
          error: 'App ID is required for image generation',
        };
      }

      return this.generateImage(prompt, appId, size, filename);
    }

    // Video search validation
    if (mediaType === 'video') {
      if (Array.isArray(prompt)) {
        return {
          success: false,
          error: 'Video search does not support multiple prompts. Please provide a single prompt.',
        };
      }

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return {
          success: false,
          error: 'A valid search prompt is required for video search',
        };
      }

      return this.searchSingle(prompt, 'video', 1, options);
    }

    // Image search (default)
    if (Array.isArray(prompt)) {
      if (
        prompt.length === 0 ||
        prompt.some((p) => !p || typeof p !== 'string' || p.trim().length === 0)
      ) {
        return {
          success: false,
          error: 'All prompts must be valid non-empty strings',
        };
      }

      if (prompt.length > 20) {
        return {
          success: false,
          error: 'Maximum 20 prompts allowed for parallel search',
        };
      }

      return this.searchParallel(prompt, count || 1, options);
    }

    // Single image search
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return {
        success: false,
        error: 'A valid search prompt is required',
      };
    }

    if (count !== undefined && (count < 1 || count > 50)) {
      return {
        success: false,
        error: 'Count must be between 1 and 50',
      };
    }

    return this.searchSingle(prompt, 'image', count || 1, options);
  }

  /**
   * Get the appropriate driver based on configuration
   */
  private getDriver(mediaType: string, useService?: boolean): MediaDriver {
    // Only use image search service for images, never for videos
    if (mediaType === 'image' && this.shouldUseService(useService)) {
      return this.serviceDriver;
    }
    return this.gettyDriver;
  }

  /**
   * Determine whether to route through image search service
   */
  private shouldUseService(useService?: boolean): boolean {
    if (useService !== undefined) return useService;
    return process.env.IMAGE_SEARCH_USE_SERVICE === 'true';
  }

  /**
   * Build unified MediaDriverSearchOptions from the tool's option format
   */
  private buildDriverOptions(
    prompt: string,
    mediaType: 'image' | 'video',
    count: number,
    options?: {
      orientations?: string | string[];
      compositions?: string | string[];
      color?: string;
      moods?: string[];
      graphicalStyles?: string[];
      sortOrder?: string;
      useService?: boolean;
      advancedFilters?: MediaSearchOptions['advancedFilters'];
    }
  ): MediaDriverSearchOptions {
    const toArray = (v: string | string[] | undefined): string[] | undefined => {
      if (!v) return undefined;
      return Array.isArray(v) ? v : [v];
    };

    return {
      query: prompt.trim(),
      mediaType,
      count: Math.min(count, mediaType === 'image' ? 20 : 1),
      orientations: toArray(options?.orientations),
      compositions: toArray(options?.compositions),
      moods: options?.moods,
      graphicalStyles:
        options?.graphicalStyles || (mediaType === 'image' ? ['photography'] : undefined),
      sortOrder: options?.sortOrder || 'best_match',
      color: options?.color,
      // Advanced filters (shared)
      numberOfPeople: options?.advancedFilters?.numberOfPeople,
      ethnicity: options?.advancedFilters?.ethnicity,
      ageOfPeople: options?.advancedFilters?.ageOfPeople,
      minimumSize: options?.advancedFilters?.minimumSize,
      // Advanced filters (service-only, silently ignored by Getty driver)
      subjectCategory: options?.advancedFilters?.subjectCategory,
      copySpaceAmount: options?.advancedFilters?.copySpaceAmount,
      copySpaceLocation: options?.advancedFilters?.copySpaceLocation,
      usageContext: options?.advancedFilters?.usageContext,
      backgroundType: options?.advancedFilters?.backgroundType,
      visualComplexity: options?.advancedFilters?.visualComplexity,
      tone: options?.advancedFilters?.tone,
      peopleFocus: options?.advancedFilters?.peopleFocus,
    };
  }

  private async searchSingle(
    prompt: string,
    mediaType: MediaType,
    count = 1,
    options?: {
      orientations?: string | string[];
      compositions?: string | string[];
      color?: string;
      moods?: string[];
      graphicalStyles?: string[];
      sortOrder?: string;
      useService?: boolean;
      advancedFilters?: MediaSearchOptions['advancedFilters'];
    }
  ): Promise<MediaSearchResult> {
    try {
      const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
      eventLogger.begin(logger, {
        toolName: 'MediaSearchTool',
        prompt,
        count,
        provider: 'getty',
      });

      const driver = this.getDriver(mediaType, options?.useService);
      const driverOptions = this.buildDriverOptions(
        prompt,
        mediaType as 'image' | 'video',
        count,
        options
      );
      const result = await driver.search(driverOptions);

      if (!result.success || !result.items || result.items.length === 0) {
        eventLogger.failure(logger, new Error(result.error || `No ${mediaType}s found`), {
          toolName: 'MediaSearchTool',
          prompt,
          count,
          provider: 'getty',
        });
        return {
          success: false,
          error: result.error || `No ${mediaType}s found for this search query`,
        };
      }

      const mediaUrls: string[] = [];
      const gettyIds: string[] = [];
      for (const item of result.items.slice(0, count)) {
        const mediaUrl =
          item?.urls?.highRes ||
          item?.urls?.standard ||
          item?.urls?.preview ||
          item?.urls?.thumbnail;
        if (mediaUrl) {
          mediaUrls.push(mediaUrl);
          gettyIds.push(item.id);
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
          error: `No valid ${mediaType} URLs found in search response`,
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

      // For videos, extract thumbnail URL from the item's urls
      let thumbnailUrl: string | undefined;
      if (mediaType === 'video' && result.items[0]) {
        const item = result.items[0];
        thumbnailUrl = item.urls?.preview || item.urls?.thumbnail || item.urls?.standard;
      }

      if (count === 1 && mediaUrls.length > 0) {
        return {
          success: true,
          url: mediaUrls[0]!,
          ...(gettyIds[0] && { gettyId: gettyIds[0] }),
          ...(thumbnailUrl && { thumbnailUrl }),
        };
      } else {
        return {
          success: true,
          urls: mediaUrls,
          gettyIds,
          ...(thumbnailUrl && { thumbnailUrl }),
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
        error: `Media ${mediaType} search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Search for multiple images in parallel
   */
  private async searchParallel(
    prompts: string[],
    count = 1,
    options?: {
      orientations?: string | string[];
      compositions?: string | string[];
      color?: string;
      moods?: string[];
      graphicalStyles?: string[];
      sortOrder?: string;
      useService?: boolean;
      advancedFilters?: MediaSearchOptions['advancedFilters'];
    }
  ): Promise<MediaSearchResult> {
    try {
      toolImageSearchEvents.begin(logger, {
        toolName: 'MediaSearchTool',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'getty',
      });

      const searchPromises = prompts.map((prompt) =>
        this.searchSingle(prompt, 'image', count, options)
      );
      const results = await Promise.all(searchPromises);

      const combinedResults = results.map((result, index) => {
        const combined: {
          prompt: string;
          success: boolean;
          url?: string;
          urls?: string[];
          error?: string;
          gettyId?: string;
          gettyIds?: string[];
        } = {
          prompt: prompts[index] || '',
          success: result.success,
        };
        if (result.url) combined.url = result.url;
        if (result.urls) combined.urls = result.urls;
        if (result.error) combined.error = result.error;
        if (result.gettyId) combined.gettyId = result.gettyId;
        if (result.gettyIds) combined.gettyIds = result.gettyIds;
        return combined;
      });

      const hasAnySuccess = results.some((r) => r.success);

      toolImageSearchEvents.success(logger, {
        toolName: 'MediaSearchTool',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'getty',
        resultUrls: results.flatMap((r) => r.urls || (r.url ? [r.url] : [])),
        resultCount: results.reduce((sum, r) => sum + (r.urls?.length || (r.url ? 1 : 0)), 0),
      });

      if (hasAnySuccess) {
        return {
          success: true,
          results: combinedResults,
        };
      } else {
        return {
          success: false,
          results: combinedResults,
          error: 'All parallel searches failed',
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
        error: `Parallel image search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Generate an image using OpenAI DALL-E
   */
  private async generateImage(
    prompt: string,
    appId: string,
    size: '1024x1024' | '1024x1536' | '1536x1024' | 'auto' = '1024x1024',
    filename?: string
  ): Promise<MediaSearchResult> {
    const startTime = Date.now();
    const logData = {
      toolName: 'media-tool',
      appId,
      prompt,
      options: { size, filename },
    };

    toolImageGenerationEvents.begin(logger, logData);

    try {
      const openaiClient = await createOpenAIClient();
      if (!openaiClient) {
        return {
          success: false,
          error: 'OpenAI client could not be created - authentication not configured properly',
        };
      }

      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        return {
          success: false,
          error: `Workspace not available for app: ${appId}`,
        };
      }

      const appRepository = new AppRepository();
      const app = appRepository.findById(appId);

      const result = await openaiClient.images.generate({
        model: 'gpt-image-1',
        prompt: prompt.trim(),
        n: 1,
        size: size,
      });

      if (!result.data || result.data.length === 0) {
        return {
          success: false,
          error: 'No image generated from the provided prompt',
        };
      }

      const imageData = result.data[0];
      if (!imageData || (!imageData.b64_json && !imageData.url)) {
        return {
          success: false,
          error: 'No image data returned from the API',
        };
      }

      const safeFilename =
        filename ||
        prompt
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 40);

      const fullFilename = `${safeFilename}-${nanoid(6)}.png`;
      const uploadPath = `public/assets/images/${fullFilename}`;

      let imageBuffer: Buffer;
      if (imageData.b64_json) {
        imageBuffer = Buffer.from(imageData.b64_json, 'base64');
      } else {
        const res = await fetch(imageData.url as string);
        if (!res.ok) {
          throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
        }
        imageBuffer = Buffer.from(await res.arrayBuffer());
      }

      await workspace.files.upload({ path: uploadPath, data: imageBuffer });

      const publicPath = `${AIRO_ASSET_UPLOADS_URL_PREFIX}${fullFilename}`;
      const executionTime = Date.now() - startTime;

      toolImageGenerationEvents.success(logger, {
        toolName: logData.toolName,
        appId: logData.appId,
        prompt: logData.prompt,
        options: {
          size: logData.options.size,
          ...(logData.options.filename && { filename: logData.options.filename }),
        },
        resultStats: {
          success: true,
          filePath: uploadPath,
          publicPath,
          fileSize: imageBuffer.length,
          executionTime,
        },
      });

      const imageUrl = app?.previewUrl
        ? `${app.previewUrl.replace(/\/+$/, '')}${publicPath}`
        : publicPath;

      return {
        success: true,
        url: imageUrl,
        filepath: uploadPath,
        publicPath,
        ...(imageData.b64_json && { base64Data: imageData.b64_json }),
      };
    } catch (error) {
      toolImageGenerationEvents.failure(logger, error as Error, logData);
      return {
        success: false,
        error: `Image generation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * Tool interface for media search and generation - maintains backward compatibility
 */
export async function findMedia(options: MediaSearchOptions): Promise<MediaSearchResult> {
  const {
    prompt,
    mediaType = 'image',
    count,
    orientations,
    compositions,
    color,
    moods,
    graphicalStyles,
    sortOrder,
    useService,
    advancedFilters,
    appId,
    size,
    filename,
  } = options;

  // Validate prompt
  if (Array.isArray(prompt)) {
    if (prompt.length === 0 || prompt.some((p) => !p || typeof p !== 'string')) {
      return {
        success: false,
        error: 'A valid array of search prompts is required',
      };
    }
  } else if (!prompt || typeof prompt !== 'string') {
    return {
      success: false,
      error: 'A valid search prompt is required',
    };
  }

  try {
    const mediaSearchTool = new MediaSearchTool();
    const searchOptions = {
      ...(orientations !== undefined && { orientations }),
      ...(compositions !== undefined && { compositions }),
      ...(color !== undefined && { color }),
      ...(moods !== undefined && { moods }),
      ...(graphicalStyles !== undefined && { graphicalStyles }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(useService !== undefined && { useService }),
      ...(advancedFilters !== undefined && { advancedFilters }),
    };
    return await mediaSearchTool.searchMedia(
      prompt,
      mediaType,
      count,
      appId,
      size,
      filename,
      Object.keys(searchOptions).length > 0 ? searchOptions : undefined
    );
  } catch (error) {
    const promptForLog = Array.isArray(prompt) ? prompt.join(', ') : prompt;

    if (mediaType === 'generate') {
      toolImageGenerationEvents.failure(logger, error as Error, {
        toolName: 'media-tool',
        appId: appId || '',
        prompt: promptForLog,
      });
    } else if (mediaType === 'video') {
      toolVideoSearchEvents.failure(logger, error as Error, {
        toolName: 'MediaSearchTool',
        prompt: promptForLog,
        provider: 'getty',
      });
    } else {
      toolImageSearchEvents.failure(logger, error as Error, {
        toolName: 'MediaSearchTool',
        prompt: promptForLog,
        provider: 'getty',
        count: count ?? 1,
      });
    }

    return {
      success: false,
      error: `Media operation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

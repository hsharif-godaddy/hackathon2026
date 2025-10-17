/**
 * Image Search Tool - Getty Images Integration
 * 
 * This tool provides image search functionality using Getty Images API for professional stock photos.
 * 
 * Configuration:
 * - Requires SSO_JWT, GETTY_API_URL, and GETTY_APP_KEY environment variables
 * 
 * Usage:
 * ```typescript
 * // Using the default Getty driver - single image
 * const tool = new ImageSearchTool();
 * const result = await tool.searchImage("sunset over mountains");
 * 
 * // Searching for multiple images
 * const multipleResults = await tool.searchImage("sunset over mountains", 5);
 * 
 * // Parallel search with multiple prompts
 * const parallelResults = await tool.searchImage(["sunset over mountains", "forest landscape", "ocean waves"]);
 * 
 * // Parallel search with multiple images per prompt
 * const parallelMultiple = await tool.searchImage(["cats", "dogs"], 3);
 * 
 * // Using the legacy function interface
 * const result = await findImage({ prompt: "sunset over mountains" });
 * const multipleResult = await findImage({ prompt: "sunset over mountains", count: 3 });
 * const parallelResult = await findImage({ prompt: ["cats", "dogs"], count: 2 });
 * ```
 */
import OpenAI from 'openai';
import { GettyImageTool } from './image-search-driver/getty-driver.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../logging/index.js';
import { toolImageSearchEvents } from '../logging/events/index.js';

export interface ImageSearchOptions {
  prompt: string | string[];
  count?: number;
}

export interface ImageSearchResult {
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
 * Base interface for image search drivers
 */
export interface ImageSearchDriver {
  searchImage(prompt: string, count?: number): Promise<ImageSearchResult>;
  searchImagesParallel(prompts: string[], count?: number): Promise<ImageSearchResult>;
}


/**
 * Getty driver for image search
 */
class GettyImageSearchDriver implements ImageSearchDriver {
  private gettyTool: GettyImageTool;

  constructor() {
    this.gettyTool = new GettyImageTool();
  }

  async searchImage(prompt: string, count = 1): Promise<ImageSearchResult> {
    try {
      toolImageSearchEvents.begin(logger, {
        toolName: 'GettyImageSearchDriver',
        prompt,
        count,
        provider: 'getty',
      });

      const result = await this.gettyTool.searchImages({
        phrase: prompt.trim(),
        page: 1,
        pageSize: Math.min(count, 10), // Getty API usually limits page size
        graphicalStyles: 'photography',
        sortOrder: 'best_match'
      });

      if (!result.success || !result.images || result.images.length === 0) {
        toolImageSearchEvents.failure(logger, new Error(result.error || 'No images found for this search query'), {
          toolName: 'GettyImageSearchDriver',
          prompt,
          count,
          provider: 'getty',
        });
        return {
          success: false,
          error: result.error || 'No images found for this search query'
        };
      }

      const imageUrls: string[] = [];
      for (const image of result.images.slice(0, count)) {
        const imageUrl = image?.urls?.highRes || image?.urls?.standard || image?.urls?.preview || image?.urls?.thumbnail;
        if (imageUrl) {
          imageUrls.push(imageUrl);
        }
      }

      if (imageUrls.length === 0) {
        toolImageSearchEvents.failure(logger, new Error('No valid image URLs found in Getty response'), {
          toolName: 'GettyImageSearchDriver',
          prompt,
          count,
          provider: 'getty',
        });
        return {
          success: false,
          error: 'No valid image URLs found in Getty response'
        };
      }

      toolImageSearchEvents.success(logger, {
        toolName: 'GettyImageSearchDriver',
        prompt,
        count,
        provider: 'getty',
        resultUrls: imageUrls,
        resultCount: imageUrls.length,
      });

      if (count === 1 && imageUrls.length > 0) {
        return {
          success: true,
          url: imageUrls[0]!  // Safe: we just checked length > 0
        };
      } else {
        return {
          success: true,
          urls: imageUrls
        };
      }
    } catch (error) {
      toolImageSearchEvents.failure(logger, error as Error, {
        toolName: 'GettyImageSearchDriver',
        prompt,
        count,
        provider: 'getty',
      });
      return {
        success: false,
        error: `Getty image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async searchImagesParallel(prompts: string[], count = 1): Promise<ImageSearchResult> {
    try {
      toolImageSearchEvents.begin(logger, {
        toolName: 'GettyImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'getty',
      });

      const searchPromises = prompts.map(prompt => this.searchImage(prompt, count));
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
        toolName: 'GettyImageSearchDriver',
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
        toolName: 'GettyImageSearchDriver',
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
 * Service for searching images using Getty Images API
 */
export class ImageSearchTool {
  private driver: ImageSearchDriver;

  constructor(driver?: ImageSearchDriver) {
    this.driver = driver || new GettyImageSearchDriver();
  }

  /**
   * Search for images based on the given prompt(s) using the configured driver
   * @param prompt The search prompt or array of prompts
   * @param count The number of images to search for per prompt (default: 1)
   * @returns An object containing the image URL(s) or an error
   */
  async searchImage(prompt: string | string[], count = 1): Promise<ImageSearchResult> {
    // Handle array of prompts
    if (Array.isArray(prompt)) {
      return this.searchImagesParallel(prompt, count);
    }

    // Validate single prompt input
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return {
        success: false,
        error: 'A valid search prompt is required'
      };
    }

    if (count < 1 || count > 50) {
      return {
        success: false,
        error: 'Count must be between 1 and 50'
      };
    }

    return this.driver.searchImage(prompt, count);
  }

  /**
   * Search for images using multiple prompts in parallel
   * @param prompts Array of search prompts
   * @param count The number of images to search for per prompt (default: 1)
   * @returns An object containing results for each prompt
   */
  async searchImagesParallel(prompts: string[], count = 1): Promise<ImageSearchResult> {
    // Validate input
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return {
        success: false,
        error: 'A valid array of search prompts is required'
      };
    }

    if (prompts.some(p => !p || typeof p !== 'string' || p.trim().length === 0)) {
      return {
        success: false,
        error: 'All prompts must be valid non-empty strings'
      };
    }

    if (count < 1 || count > 50) {
      return {
        success: false,
        error: 'Count must be between 1 and 50'
      };
    }

    if (prompts.length > 20) {
      return {
        success: false,
        error: 'Maximum 20 prompts allowed for parallel search'
      };
    }

    return this.driver.searchImagesParallel(prompts, count);
  }
}

/**
 * Tool interface for image search - maintains backward compatibility
 */
export async function findImage(options: { prompt: string | string[]; count?: number }): Promise<ImageSearchResult> {
  const { prompt, count = 1 } = options;

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
    const imageSearchTool = new ImageSearchTool();
    const result = await imageSearchTool.searchImage(prompt, count);
    return result;
  } catch (error) {
    const promptForLog = Array.isArray(prompt) ? prompt.join(', ') : prompt;
    toolImageSearchEvents.failure(logger, error as Error, {
      toolName: 'ImageSearchTool',
      prompt: promptForLog,
      count: count || 1,
      provider: 'getty',
    });
    return {
      success: false,
      error: `Image search failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

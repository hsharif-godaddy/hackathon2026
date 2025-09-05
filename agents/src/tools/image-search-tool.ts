/**
 * Image Search Tool - Driver-based Architecture
 * 
 * This tool provides image search functionality through multiple providers:
 * - Getty: Uses Getty Images API for professional stock photos (default)
 * - OpenAI: Uses OpenAI's web search capabilities
 * - Unsplash: Uses Unsplash's API for stock photos (with file-based caching)
 * 
 * Configuration:
 * - Set IMAGE_SEARCH_DRIVER environment variable to 'getty', 'openai', or 'unsplash'
 * - Getty driver requires SSO_JWT, GETTY_API_URL, and GETTY_APP_KEY
 * - OpenAI driver requires OPENAI_API_KEY
 * - Unsplash driver requires UNSPLASH_ACCESS_KEY
 * 
 * Caching (Unsplash only):
 * - Cache files are stored in /tmp/unsplash/
 * - Cache expires after 24 hours
 * - Cache key is based on search prompt + count (case-insensitive)
 * - Both successful and error results are cached (except network errors)
 * - Automatic cleanup runs every hour
 * 
 * Usage:
 * ```typescript
 * // Using the default configured driver - single image
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
 * // Using a specific driver
 * const customTool = new ImageSearchTool(new GettyImageSearchDriver());
 * 
 * // Using the legacy function interface
 * const result = await findImage({ prompt: "sunset over mountains" });
 * const multipleResult = await findImage({ prompt: "sunset over mountains", count: 3 });
 * const parallelResult = await findImage({ prompt: ["cats", "dogs"], count: 2 });
 * ```
 */
import OpenAI from 'openai';
import { GettyImageTool } from './getty-image-tool.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../logging/index.js';
import { toolImageSearchEvents, toolCacheEvents } from '../logging/events/index.js';

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
 * Simple file-based cache for image search results
 */
class UnsplashCache {
  private cacheDir: string;
  private maxAge: number; // in milliseconds

  constructor(cacheDir = '/tmp/unsplash', maxAge = 24 * 60 * 60 * 1000) { // Default 24 hours
    this.cacheDir = cacheDir;
    this.maxAge = maxAge;
    this.ensureCacheDir();
  }

  /**
   * Generate a cache key from search prompt and count
   */
  private generateCacheKey(prompt: string, count: number): string {
    const data = `${prompt.trim().toLowerCase()}-${count}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Get cache file path for a given key
   */
  private getCacheFilePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    } catch (error) {
      toolCacheEvents.setFailure(logger, error as Error, {
        toolName: 'UnsplashCache',
        cacheKey: 'directory-creation',
      });
    }
  }

  /**
   * Check if a cached result exists and is still valid
   */
  async get(prompt: string, count: number): Promise<ImageSearchResult | null> {
    const key = this.generateCacheKey(prompt, count);
    try {
      const filePath = this.getCacheFilePath(key);

      if (!fs.existsSync(filePath)) {
        return null;
      }

      const fileStats = fs.statSync(filePath);
      const now = Date.now();
      const fileAge = now - fileStats.mtime.getTime();

      if (fileAge > this.maxAge) {
        // Cache expired, remove file
        fs.unlinkSync(filePath);
        return null;
      }

      const cachedData = fs.readFileSync(filePath, 'utf-8');
      const result = JSON.parse(cachedData) as ImageSearchResult;

      toolCacheEvents.getSuccess(logger, {
        toolName: 'UnsplashCache',
        cacheKey: key,
        operation: 'get',
        cacheDir: this.cacheDir,
        fileAge,
      });
      return result;
    } catch (error) {
      toolCacheEvents.getFailure(logger, error as Error, {
        toolName: 'UnsplashCache',
        cacheKey: key,
      });
      return null;
    }
  }

  /**
   * Store a result in the cache
   */
  async set(prompt: string, count: number, result: ImageSearchResult): Promise<void> {
    const key = this.generateCacheKey(prompt, count);
    try {
      const filePath = this.getCacheFilePath(key);

      fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
      toolCacheEvents.setSuccess(logger, {
        toolName: 'UnsplashCache',
        cacheKey: key,
        operation: 'set',
        cacheDir: this.cacheDir,
      });
    } catch (error) {
      toolCacheEvents.setFailure(logger, error as Error, {
        toolName: 'UnsplashCache',
        cacheKey: key,
      });
    }
  }

  /**
   * Clean up expired cache files
   */
  async cleanup(): Promise<void> {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        return;
      }

      const files = fs.readdirSync(this.cacheDir);
      const now = Date.now();
      let cleanedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        const fileStats = fs.statSync(filePath);
        const fileAge = now - fileStats.mtime.getTime();

        if (fileAge > this.maxAge) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        toolCacheEvents.cleanupSuccess(logger, {
          toolName: 'UnsplashCache',
          cacheKey: '',
          operation: 'cleanup',
          cacheDir: this.cacheDir,
          itemsProcessed: cleanedCount,
        });
      }
    } catch (error) {
      toolCacheEvents.cleanupFailure(logger, error as Error, {
        toolName: 'UnsplashCache',
      });
    }
  }
}

/**
 * OpenAI driver for image search
 */
class OpenAIImageSearchDriver implements ImageSearchDriver {
  private openaiClient: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      logger.warn('OpenAI API key not configured', {
        toolName: 'OpenAIImageSearchDriver',
      });
    }

    this.openaiClient = new OpenAI({
      apiKey: apiKey
    });
  }

  async searchImage(prompt: string, count = 1): Promise<ImageSearchResult> {
    const searchPrompt = count > 1
      ? `Find ${count} relevant images for: ${prompt.trim()}. Return only the direct image URLs, one per line.`
      : `Find a relevant image for: ${prompt.trim()}. Return only the direct image URL.`;

    try {
      if (!this.openaiClient) {
        return {
          success: false,
          error: 'OpenAI API key not configured'
        };
      }

      toolImageSearchEvents.begin(logger, {
        toolName: 'OpenAIImageSearchDriver',
        prompt: searchPrompt,
        count,
        provider: 'openai',
      });

      const response = await this.openaiClient.responses.create({
        model: "gpt-5",
        tools: [
          { type: "web_search_preview" }
        ],
        input: searchPrompt
      });

      const responseText = response.output_text || '';
      const urlMatches = responseText.match(/https?:\/\/[^\s)]+\.(jpg|jpeg|png|gif|webp)/gi);

      if (!urlMatches || urlMatches.length === 0) {
        toolImageSearchEvents.failure(logger, new Error('No valid image URLs found in the response'), {
          toolName: 'OpenAIImageSearchDriver',
          prompt: searchPrompt,
          count,
          provider: 'openai',
        });
        return {
          success: false,
          error: 'No valid image URLs found in the response'
        };
      }

      const imageUrls = urlMatches.slice(0, count);

      if (imageUrls.length === 0) {
        toolImageSearchEvents.failure(logger, new Error('No valid image URLs found after filtering'), {
          toolName: 'OpenAIImageSearchDriver',
          prompt: searchPrompt,
          count,
          provider: 'openai',
        });
        return {
          success: false,
          error: 'No valid image URLs found after filtering'
        };
      }

      toolImageSearchEvents.success(logger, {
        toolName: 'OpenAIImageSearchDriver',
        prompt: searchPrompt,
        count,
        provider: 'openai',
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
        toolName: 'OpenAIImageSearchDriver',
        prompt: searchPrompt,
        count,
        provider: 'openai',
      });
      return {
        success: false,
        error: `OpenAI image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async searchImagesParallel(prompts: string[], count = 1): Promise<ImageSearchResult> {
    try {
      toolImageSearchEvents.begin(logger, {
        toolName: 'OpenAIImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'openai',
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
        toolName: 'OpenAIImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'openai',
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
        toolName: 'OpenAIImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'openai',
      });
      return {
        success: false,
        error: `OpenAI parallel image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
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
 * Unsplash driver for image search with file-based caching
 */
class UnsplashImageSearchDriver implements ImageSearchDriver {
  private accessKey: string | undefined;
  private cache: UnsplashCache;

  constructor() {
    this.accessKey = process.env.UNSPLASH_ACCESS_KEY;
    this.cache = new UnsplashCache();

    if (!this.accessKey) {
      logger.warn('Unsplash access key not configured', {
        toolName: 'UnsplashImageSearchDriver',
      });
    }

    // Periodically clean up expired cache files
    this.scheduleCleanup();
  }

  /**
   * Schedule periodic cache cleanup
   */
  private scheduleCleanup(): void {
    // Clean up every hour
    const interval = setInterval(() => {
      this.cache.cleanup();
    }, 60 * 60 * 1000);
    interval.unref();
  }

  async searchImage(prompt: string, count = 1): Promise<ImageSearchResult> {
    try {
      if (!this.accessKey) {
        return {
          success: false,
          error: 'Unsplash access key not configured'
        };
      }

      // Check cache first
      const cachedResult = await this.cache.get(prompt, count);
      if (cachedResult) {
        toolImageSearchEvents.success(logger, {
          toolName: 'UnsplashImageSearchDriver',
          prompt,
          count,
          provider: 'unsplash',
          cacheHit: true,
          resultUrls: cachedResult.urls || (cachedResult.url ? [cachedResult.url] : []),
          resultCount: cachedResult.urls?.length || (cachedResult.url ? 1 : 0),
        });
        return cachedResult;
      }

      toolImageSearchEvents.begin(logger, {
        toolName: 'UnsplashImageSearchDriver',
        prompt,
        count,
        provider: 'unsplash',
        cacheHit: false,
      });

      const searchUrl = new URL('https://api.unsplash.com/search/photos');
      searchUrl.searchParams.set('query', prompt.trim());
      searchUrl.searchParams.set('per_page', Math.min(count, 30).toString()); // Unsplash limits to 30 per page
      searchUrl.searchParams.set('orientation', 'landscape');

      const response = await fetch(searchUrl.toString(), {
        headers: {
          'Authorization': `Client-ID ${this.accessKey}`,
          'Accept-Version': 'v1'
        }
      });

      if (!response.ok) {
        throw new Error(`Unsplash API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        results: Array<{
          urls: {
            regular?: string;
            small?: string;
            thumb?: string;
          };
        }>;
      };

      if (!data.results || data.results.length === 0) {
        const errorResult = {
          success: false as const,
          error: 'No images found for this search query'
        };
        toolImageSearchEvents.failure(logger, new Error('No images found for this search query'), {
          toolName: 'UnsplashImageSearchDriver',
          prompt,
          count,
          provider: 'unsplash',
        });
        // Cache the error result to avoid repeated API calls for unsuccessful searches
        await this.cache.set(prompt, count, errorResult);
        return errorResult;
      }

      const imageUrls: string[] = [];
      for (const image of data.results.slice(0, count)) {
        const imageUrl = image.urls?.regular || image.urls?.small || image.urls?.thumb;
        if (imageUrl) {
          imageUrls.push(imageUrl);
        }
      }

      if (imageUrls.length === 0) {
        const errorResult = {
          success: false as const,
          error: 'No valid image URLs found in Unsplash response'
        };
        toolImageSearchEvents.failure(logger, new Error('No valid image URLs found in Unsplash response'), {
          toolName: 'UnsplashImageSearchDriver',
          prompt,
          count,
          provider: 'unsplash',
        });
        // Cache the error result
        await this.cache.set(prompt, count, errorResult);
        return errorResult;
      }

      toolImageSearchEvents.success(logger, {
        toolName: 'UnsplashImageSearchDriver',
        prompt,
        count,
        provider: 'unsplash',
        cacheHit: false,
        resultUrls: imageUrls,
        resultCount: imageUrls.length,
      });

      let result: ImageSearchResult;
      if (count === 1 && imageUrls.length > 0) {
        result = {
          success: true,
          url: imageUrls[0]!  // Safe: we just checked length > 0
        };
      } else {
        result = {
          success: true,
          urls: imageUrls
        };
      }

      // Cache the successful result
      await this.cache.set(prompt, count, result);
      return result;
    } catch (error) {
      toolImageSearchEvents.failure(logger, error as Error, {
        toolName: 'UnsplashImageSearchDriver',
        prompt,
        count,
        provider: 'unsplash',
      });
      const errorResult = {
        success: false as const,
        error: `Unsplash image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
      // Don't cache network errors or API failures as they might be temporary
      return errorResult;
    }
  }

  async searchImagesParallel(prompts: string[], count = 1): Promise<ImageSearchResult> {
    try {
      toolImageSearchEvents.begin(logger, {
        toolName: 'UnsplashImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'unsplash',
        cacheHit: false,
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
        toolName: 'UnsplashImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'unsplash',
        cacheHit: false,
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
        toolName: 'UnsplashImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'unsplash',
      });
      return {
        success: false,
        error: `Unsplash parallel image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Factory function to create the appropriate image search driver
 */
function createImageSearchDriver(): ImageSearchDriver {
  const driverType = process.env.IMAGE_SEARCH_DRIVER || 'getty';

  switch (driverType.toLowerCase()) {
    case 'openai':
      return new OpenAIImageSearchDriver();
    case 'unsplash':
      return new UnsplashImageSearchDriver();
    case 'getty':
    default:
      return new GettyImageSearchDriver();
  }
}

/**
 * Driver-based service for searching images from various providers
 * Supports Getty, OpenAI, and Unsplash drivers, configurable via IMAGE_SEARCH_DRIVER environment variable
 */
export class ImageSearchTool {
  private driver: ImageSearchDriver;

  constructor(driver?: ImageSearchDriver) {
    this.driver = driver || createImageSearchDriver();
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
      provider: (process.env.IMAGE_SEARCH_DRIVER || 'getty') as 'getty' | 'openai' | 'unsplash',
    });
    return {
      success: false,
      error: `Image search failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

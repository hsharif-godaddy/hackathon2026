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
 * // Using a specific driver
 * const customTool = new ImageSearchTool(new GettyImageSearchDriver());
 * 
 * // Using the legacy function interface
 * const result = await findImage({ prompt: "sunset over mountains" });
 * const multipleResult = await findImage({ prompt: "sunset over mountains", count: 3 });
 * ```
 */
import OpenAI from 'openai';
import { GettyImageTool } from './getty-image-tool.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ImageSearchOptions {
  prompt: string;
  count?: number;
}

export interface ImageSearchResult {
  success: boolean;
  url?: string;
  urls?: string[];
  error?: string;
}

/**
 * Base interface for image search drivers
 */
export interface ImageSearchDriver {
  searchImage(prompt: string, count?: number): Promise<ImageSearchResult>;
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
      console.warn(`⚠️ Failed to create cache directory ${this.cacheDir}:`, error);
    }
  }

  /**
   * Check if a cached result exists and is still valid
   */
  async get(prompt: string, count: number): Promise<ImageSearchResult | null> {
    try {
      const key = this.generateCacheKey(prompt, count);
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
      
      console.log(`💾 [Unsplash Cache] Found cached result for prompt: "${prompt}" (count: ${count})`);
      return result;
    } catch (error) {
      console.warn(`⚠️ Failed to read cache for prompt "${prompt}":`, error);
      return null;
    }
  }

  /**
   * Store a result in the cache
   */
  async set(prompt: string, count: number, result: ImageSearchResult): Promise<void> {
    try {
      const key = this.generateCacheKey(prompt, count);
      const filePath = this.getCacheFilePath(key);
      
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
      console.log(`💾 [Unsplash Cache] Cached result for prompt: "${prompt}" (count: ${count})`);
    } catch (error) {
      console.warn(`⚠️ Failed to write cache for prompt "${prompt}":`, error);
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
        console.log(`🧹 [Unsplash Cache] Cleaned up ${cleanedCount} expired cache files`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to cleanup cache:', error);
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
      console.warn('⚠️ OPENAI_API_KEY not set. OpenAI image search will not work.');
    }
    
    this.openaiClient = new OpenAI({
      apiKey: apiKey
    });
  }

  async searchImage(prompt: string, count = 1): Promise<ImageSearchResult> {
    try {
      if (!this.openaiClient) {
        return { 
          success: false, 
          error: 'OpenAI API key not configured' 
        };
      }

      const searchPrompt = count > 1 
        ? `Find ${count} relevant images for: ${prompt.trim()}. Return only the direct image URLs, one per line.`
        : `Find a relevant image for: ${prompt.trim()}. Return only the direct image URL.`;
      
      console.log(`🔍 [OpenAI] Searching for ${count} image(s) with prompt: "${searchPrompt}"`);
      
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
        return {
          success: false,
          error: 'No valid image URLs found in the response'
        };
      }
      
      const imageUrls = urlMatches.slice(0, count);
      
      if (imageUrls.length === 0) {
        return {
          success: false,
          error: 'No valid image URLs found after filtering'
        };
      }
      
      console.log(`✅ [OpenAI] Found ${imageUrls.length} image URL(s): ${imageUrls.join(', ')}`);
      
      if (count === 1) {
        return {
          success: true,
          url: imageUrls[0]!
        };
      } else {
        return {
          success: true,
          urls: imageUrls
        };
      }
    } catch (error) {
      console.error('❌ OpenAI image search failed:', error);
      return {
        success: false,
        error: `OpenAI image search failed: ${error instanceof Error ? error.message : String(error)}`
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
      console.log(`🔍 [Getty] Searching for ${count} image(s) with prompt: "${prompt}"`);
      
      const result = await this.gettyTool.searchImages({
        phrase: prompt.trim(),
        page: 1,
        pageSize: Math.min(count, 10), // Getty API usually limits page size
        graphicalStyles: 'photography',
        sortOrder: 'best_match'
      });

      if (!result.success || !result.images || result.images.length === 0) {
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
        return {
          success: false,
          error: 'No valid image URLs found in Getty response'
        };
      }

      console.log(`✅ [Getty] Found ${imageUrls.length} image URL(s): ${imageUrls.join(', ')}`);
      
      if (count === 1) {
        return {
          success: true,
          url: imageUrls[0]!
        };
      } else {
        return {
          success: true,
          urls: imageUrls
        };
      }
    } catch (error) {
      console.error('❌ Getty image search failed:', error);
      return {
        success: false,
        error: `Getty image search failed: ${error instanceof Error ? error.message : String(error)}`
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
      console.warn('⚠️ UNSPLASH_ACCESS_KEY not set. Unsplash image search will not work.');
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
        return cachedResult;
      }

      console.log(`🔍 [Unsplash] Searching for ${count} image(s) with prompt: "${prompt}"`);
      
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

      const data = await response.json() as any;
      
      if (!data.results || data.results.length === 0) {
        const errorResult = {
          success: false as const,
          error: 'No images found for this search query'
        };
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
        // Cache the error result
        await this.cache.set(prompt, count, errorResult);
        return errorResult;
      }

      console.log(`✅ [Unsplash] Found ${imageUrls.length} image URL(s): ${imageUrls.join(', ')}`);
      
      let result: ImageSearchResult;
      if (count === 1) {
        result = {
          success: true,
          url: imageUrls[0]!
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
      console.error('❌ Unsplash image search failed:', error);
      const errorResult = {
        success: false as const,
        error: `Unsplash image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
      // Don't cache network errors or API failures as they might be temporary
      return errorResult;
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
   * Search for images based on the given prompt using the configured driver
   * @param prompt The search prompt
   * @param count The number of images to search for (default: 1)
   * @returns An object containing the image URL(s) or an error
   */
  async searchImage(prompt: string, count = 1): Promise<ImageSearchResult> {
    // Validate input
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
}

/**
 * Tool interface for image search - maintains backward compatibility
 */
export async function findImage(options: { prompt: string; count?: number }): Promise<ImageSearchResult> {
  const { prompt, count = 1 } = options;
  
  if (!prompt || typeof prompt !== 'string') {
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
    console.error('❌ Image search failed:', error);
    return {
      success: false,
      error: `Image search failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

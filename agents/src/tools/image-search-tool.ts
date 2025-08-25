/**
 * Image Search Tool - Driver-based Architecture
 * 
 * This tool provides image search functionality through multiple providers:
 * - Getty: Uses Getty Images API for professional stock photos (default)
 * - OpenAI: Uses OpenAI's web search capabilities
 * - Unsplash: Uses Unsplash's API for stock photos
 * 
 * Configuration:
 * - Set IMAGE_SEARCH_DRIVER environment variable to 'getty', 'openai', or 'unsplash'
 * - Getty driver requires SSO_JWT, GETTY_API_URL, and GETTY_APP_KEY
 * - OpenAI driver requires OPENAI_API_KEY
 * - Unsplash driver requires UNSPLASH_ACCESS_KEY
 * 
 * Usage:
 * ```typescript
 * // Using the default configured driver
 * const tool = new ImageSearchTool();
 * const result = await tool.searchImage("sunset over mountains");
 * 
 * // Using a specific driver
 * const customTool = new ImageSearchTool(new GettyImageSearchDriver());
 * 
 * // Using the legacy function interface
 * const result = await findImage({ prompt: "sunset over mountains" });
 * ```
 */
import OpenAI from 'openai';
import { GettyImageTool, type GettyImageOptions } from './getty-image-tool.js';

export interface ImageSearchOptions {
  prompt: string;
}

export interface ImageSearchResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Base interface for image search drivers
 */
export interface ImageSearchDriver {
  searchImage(prompt: string): Promise<ImageSearchResult>;
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

  async searchImage(prompt: string): Promise<ImageSearchResult> {
    try {
      if (!this.openaiClient) {
        return { 
          success: false, 
          error: 'OpenAI API key not configured' 
        };
      }

      const searchPrompt = `Find a relevant image for: ${prompt.trim()}. Return only the direct image URL.`;
      
      console.log(`🔍 [OpenAI] Searching for image with prompt: "${searchPrompt}"`);
      
      const response = await this.openaiClient.responses.create({
        model: "gpt-5",
        tools: [
          { type: "web_search_preview" }
        ],
        input: searchPrompt
      });
      
      const responseText = response.output_text || '';
      const urlMatch = responseText.match(/https?:\/\/[^\s)]+\.(jpg|jpeg|png|gif|webp)/i);
      
      if (!urlMatch) {
        return {
          success: false,
          error: 'No valid image URL found in the response'
        };
      }
      
      const imageUrl = urlMatch[0];
      console.log(`✅ [OpenAI] Found image URL: ${imageUrl}`);
      
      return {
        success: true,
        url: imageUrl
      };
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

  async searchImage(prompt: string): Promise<ImageSearchResult> {
    try {
      console.log(`🔍 [Getty] Searching for image with prompt: "${prompt}"`);
      
      const result = await this.gettyTool.searchImages({
        phrase: prompt.trim(),
        page: 1,
        pageSize: 1,
        graphicalStyles: 'photography',
        sortOrder: 'best_match'
      });

      if (!result.success || !result.images || result.images.length === 0) {
        return {
          success: false,
          error: result.error || 'No images found for this search query'
        };
      }

      const image = result.images[0];
      const imageUrl = image?.urls?.highRes || image?.urls?.standard || image?.urls?.preview || image?.urls?.thumbnail;
      
      if (!imageUrl) {
        return {
          success: false,
          error: 'No valid image URL found in Getty response'
        };
      }

      console.log(`✅ [Getty] Found image URL: ${imageUrl}`);
      
      return {
        success: true,
        url: imageUrl
      };
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
 * Unsplash driver for image search
 */
class UnsplashImageSearchDriver implements ImageSearchDriver {
  private accessKey: string | undefined;

  constructor() {
    this.accessKey = process.env.UNSPLASH_ACCESS_KEY;
    
    if (!this.accessKey) {
      console.warn('⚠️ UNSPLASH_ACCESS_KEY not set. Unsplash image search will not work.');
    }
  }

  async searchImage(prompt: string): Promise<ImageSearchResult> {
    try {
      if (!this.accessKey) {
        return {
          success: false,
          error: 'Unsplash access key not configured'
        };
      }

      console.log(`🔍 [Unsplash] Searching for image with prompt: "${prompt}"`);
      
      const searchUrl = new URL('https://api.unsplash.com/search/photos');
      searchUrl.searchParams.set('query', prompt.trim());
      searchUrl.searchParams.set('per_page', '1');
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

      const data = await response.json();
      
      if (!data.results || data.results.length === 0) {
        return {
          success: false,
          error: 'No images found for this search query'
        };
      }

      const image = data.results[0];
      const imageUrl = image.urls?.regular || image.urls?.small || image.urls?.thumb;
      
      if (!imageUrl) {
        return {
          success: false,
          error: 'No valid image URL found in Unsplash response'
        };
      }

      console.log(`✅ [Unsplash] Found image URL: ${imageUrl}`);
      
      return {
        success: true,
        url: imageUrl
      };
    } catch (error) {
      console.error('❌ Unsplash image search failed:', error);
      return {
        success: false,
        error: `Unsplash image search failed: ${error instanceof Error ? error.message : String(error)}`
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
   * Search for an image based on the given prompt using the configured driver
   * @param prompt The search prompt
   * @returns An object containing the image URL or an error
   */
  async searchImage(prompt: string): Promise<ImageSearchResult> {
    // Validate input
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return { 
        success: false, 
        error: 'A valid search prompt is required' 
      };
    }

    return this.driver.searchImage(prompt);
  }
}

/**
 * Tool interface for image search - maintains backward compatibility
 */
export async function findImage(options: { prompt: string }): Promise<ImageSearchResult> {
  const { prompt } = options;
  
  if (!prompt || typeof prompt !== 'string') {
    return { 
      success: false, 
      error: 'A valid search prompt is required' 
    };
  }
  
  try {
    const imageSearchTool = new ImageSearchTool();
    const result = await imageSearchTool.searchImage(prompt);
    return result;
  } catch (error) {
    console.error('❌ Image search failed:', error);
    return {
      success: false,
      error: `Image search failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}


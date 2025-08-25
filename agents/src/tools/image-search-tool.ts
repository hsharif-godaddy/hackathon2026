import OpenAI from 'openai';

export interface ImageSearchOptions {
  prompt: string;
}

export interface ImageSearchResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Simple service for searching images from the web using OpenAI's API
 * Returns a single image URL based on the provided prompt
 */
export class ImageSearchTool {
  private openaiClient: OpenAI;

  constructor() {
    // Initialize OpenAI client using API key from environment variables
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.warn('⚠️ OPENAI_API_KEY not set. Image search will not work.');
    }
    
    this.openaiClient = new OpenAI({
      apiKey: apiKey
    });
  }

  /**
   * Search for an image based on the given prompt using OpenAI's API
   * @param prompt The search prompt
   * @returns An object containing the image URL or an error
   */
  async searchImage(prompt: string): Promise<ImageSearchResult> {
    try {
      // Validate input
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return { 
          success: false, 
          error: 'A valid search prompt is required' 
        };
      }

      if (!this.openaiClient) {
        return { 
          success: false, 
          error: 'OpenAI API key not configured' 
        };
      }

      // Create a search prompt that specifically asks for an image
      const searchPrompt = `Find a relevant image for: ${prompt.trim()}. Return only the direct image URL.`;
      
      console.log(`🔍 Searching for image with prompt: "${searchPrompt}"`);
      
      // Use OpenAI's response API with web search capabilities
      const response = await this.openaiClient.responses.create({
        model: "gpt-5", // Or another appropriate model that supports tools
        tools: [
          { type: "web_search_preview" }
        ],
        input: searchPrompt
      });
      
      // Extract image URL from the response
      // This is a simplified approach - in practice, you'd need to parse the response more carefully
      const responseText = response.output_text || '';
      
      // Extract URL using regex - looks for image URLs in the response
      const urlMatch = responseText.match(/https?:\/\/[^\s)]+\.(jpg|jpeg|png|gif|webp)/i);
      
      if (!urlMatch) {
        return {
          success: false,
          error: 'No valid image URL found in the response'
        };
      }
      
      const imageUrl = urlMatch[0];
      console.log(`✅ Found image URL: ${imageUrl}`);
      
      return {
        success: true,
        url: imageUrl
      };
    } catch (error) {
      console.error('❌ OpenAI image search failed:', error);
      return {
        success: false,
        error: `Image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Tool interface for image search
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
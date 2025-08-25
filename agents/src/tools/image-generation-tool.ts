import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';

export interface ImageGenerationOptions {
  prompt: string;
  size?: '1024x1024' | '512x512' | '256x256';
  style?: 'vivid' | 'natural';
  appId: string; // App ID to determine where to save the image
  filename?: string; // Optional custom filename (without extension)
}

export interface ImageGenerationResult {
  success: boolean;
  filepath?: string; // Local path to the saved image
  publicPath?: string; // Public path to use in the app
  base64Data?: string; // Base64 image data
  error?: string;
}

/**
 * Service for generating images using OpenAI's DALL-E model
 */
export class ImageGenerationTool {
  private openaiClient: OpenAI;
  private appsBaseDir: string;

  constructor() {
    // Initialize OpenAI client using API key from environment variables
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.warn('⚠️ OPENAI_API_KEY not set. Image generation will not work.');
    }
    
    this.openaiClient = new OpenAI({
      apiKey: apiKey
    });

    // Get base directory for apps from environment variable or use default
    this.appsBaseDir = process.env.APPS_BASE_DIR || '/tmp/apps';
    console.log(`📁 Using apps base directory: ${this.appsBaseDir}`);
  }

  /**
   * Generate an image based on the given prompt and save it to the app's public directory
   * @param options Generation options including prompt, size, style, and appId
   * @returns Object containing success status and filepath or error
   */
  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    try {
      const { prompt, size = '1024x1024', style = 'vivid', appId, filename } = options;
      
      // Validate input
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return { 
          success: false, 
          error: 'A valid prompt is required' 
        };
      }

      if (!appId) {
        return { 
          success: false, 
          error: 'App ID is required to save the image' 
        };
      }

      if (!this.openaiClient) {
        return { 
          success: false, 
          error: 'OpenAI API key not configured' 
        };
      }

      // Determine the app path and public directory path
      const appPath = path.join(this.appsBaseDir, appId);
      const publicDir = path.join(appPath, 'public');
      
      // Ensure the public directory exists
      if (!fs.existsSync(publicDir)) {
        try {
          fs.mkdirSync(publicDir, { recursive: true });
          console.log(`📁 Created public directory: ${publicDir}`);
        } catch (error) {
          return {
            success: false,
            error: `Failed to create public directory: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      }

      // Create an images subdirectory
      const imagesDir = path.join(publicDir, 'images');
      if (!fs.existsSync(imagesDir)) {
        try {
          fs.mkdirSync(imagesDir, { recursive: true });
          console.log(`📁 Created images directory: ${imagesDir}`);
        } catch (error) {
          return {
            success: false,
            error: `Failed to create images directory: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      }

      console.log(`🎨 Generating image with prompt: "${prompt.trim()}"`);
      
      // Always request base64 data to save the image locally
      const result = await this.openaiClient.images.generate({
        model: "gpt-image-1",
        prompt: prompt.trim(),
        n: 1,  // Generate one image
        size: size,
        style: style,
        response_format: "b64_json", // Always get base64 to save locally
      });

      // Check if we have results
      if (!result.data || result.data.length === 0) {
        return {
          success: false,
          error: 'No image generated from the provided prompt'
        };
      }
      
      const imageData = result.data[0];
      
      // Process the base64 data and save to the public directory
      if (imageData.b64_json) {
        // Generate a safe filename based on the prompt or use provided filename
        const safeFilename = filename || 
          prompt.trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 40);
        
        const fullFilename = `${safeFilename}-${nanoid(6)}.png`;
        const filePath = path.join(imagesDir, fullFilename);
        
        try {
          // Convert base64 to buffer and write to file
          const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
          fs.writeFileSync(filePath, imageBuffer);
          
          console.log(`✅ Image saved to: ${filePath}`);
          
          // Create public path that can be used in the app
          const publicPath = `/images/${fullFilename}`;
          
          return {
            success: true,
            filepath: filePath,
            publicPath: publicPath,
            base64Data: imageData.b64_json
          };
        } catch (fileError) {
          console.error(`❌ Failed to save image: ${fileError instanceof Error ? fileError.message : String(fileError)}`);
          
          return {
            success: false,
            error: `Failed to save image to file: ${fileError instanceof Error ? fileError.message : String(fileError)}`
          };
        }
      }
      
      return {
        success: false,
        error: 'No image data returned from the API'
      };
    } catch (error) {
      console.error('❌ Image generation failed:', error);
      return {
        success: false,
        error: `Image generation failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Tool interface for image generation
 */
export async function generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const { prompt, size, style, appId, filename } = options;
  
  if (!prompt || typeof prompt !== 'string') {
    return { 
      success: false, 
      error: 'A valid prompt is required' 
    };
  }
  
  if (!appId) {
    return { 
      success: false, 
      error: 'App ID is required to save the image' 
    };
  }
  
  try {
    const imageGenerationTool = new ImageGenerationTool();
    const result = await imageGenerationTool.generateImage({
      prompt,
      size,
      style,
      appId,
      filename
    });
    
    return result;
  } catch (error) {
    console.error('❌ Image generation failed:', error);
    return {
      success: false,
      error: `Image generation failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
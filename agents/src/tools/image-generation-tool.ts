import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { logger } from '../logging/index.js';
import { toolImageGenerationEvents } from '../logging/events/index.js';

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
      logger.warn('OpenAI API key not configured - image generation will not work', {
        component: 'ImageGenerationTool',
        missingConfig: 'OPENAI_API_KEY'
      });
    }
    
    this.openaiClient = new OpenAI({
      apiKey: apiKey
    });

    // Get base directory for apps from environment variable or use default
    this.appsBaseDir = process.env.APPS_BASE_DIR || '/tmp/apps';
    logger.info('Image generation tool initialized', {
      component: 'ImageGenerationTool', 
      appsBaseDir: this.appsBaseDir
    });
  }

  /**
   * Generate an image based on the given prompt and save it to the app's public directory
   * @param options Generation options including prompt, size, style, and appId
   * @returns Object containing success status and filepath or error
   */
  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    
    // Build logging data
    const logData = {
      toolName: 'image-generation',
      appId: options.appId,
      prompt: options.prompt,
      options: {
        size: options.size,
        style: options.style,
        filename: options.filename
      }
    };
    
    // Log operation begin
    toolImageGenerationEvents.begin(logger, logData);
    
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
          logger.debug('Created public directory for app', { 
            appId, 
            publicDir,
            component: 'ImageGenerationTool'
          });
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
          logger.debug('Created images directory for app', { 
            appId, 
            imagesDir,
            component: 'ImageGenerationTool'
          });
        } catch (error) {
          return {
            success: false,
            error: `Failed to create images directory: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      }

      logger.debug('Generating image with OpenAI', { 
        appId, 
        prompt: prompt.trim(), 
        size, 
        style,
        component: 'ImageGenerationTool'
      });
      
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
      if (imageData && imageData.b64_json) {
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
          
          // Create public path that can be used in the app
          const publicPath = `/images/${fullFilename}`;
          const executionTime = Date.now() - startTime;
          
          // Log success
          toolImageGenerationEvents.success(logger, {
            toolName: logData.toolName,
            appId: logData.appId,
            prompt: logData.prompt,
            options: {
              ...(logData.options.size && { size: logData.options.size }),
              ...(logData.options.style && { style: logData.options.style }),
              ...(logData.options.filename && { filename: logData.options.filename }),
            },
            resultStats: {
              success: true,
              filePath,
              publicPath,
              fileSize: imageBuffer.length,
              executionTime
            }
          });
          
          return {
            success: true,
            filepath: filePath,
            publicPath: publicPath,
            base64Data: imageData.b64_json
          };
        } catch (fileError) {
          // Log failure
          toolImageGenerationEvents.failure(logger, fileError as Error, logData);
          
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
      // Log failure
      toolImageGenerationEvents.failure(logger, error as Error, logData);
      
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
      size: size || '1024x1024',
      style: style || 'vivid',
      appId,
      ...(filename && { filename })
    });
    
    return result;
  } catch (error) {
    logger.error('Image generation function failed', {
      error: error instanceof Error ? error.message : String(error),
      appId,
      prompt
    });
    return {
      success: false,
      error: `Image generation failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
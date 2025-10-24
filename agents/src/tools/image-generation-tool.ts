import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { logger } from '../logging/index.js';
import { toolImageGenerationEvents } from '../logging/events/index.js';
import { createOpenAIClient } from '@airo/ai-lib';

export interface ImageGenerationOptions {
  prompt: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
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
  private appsBaseDir: string;

  constructor() {
    // Get base directory for apps from environment variable or use default
    this.appsBaseDir = process.env.APPS_BASE_DIR || '/tmp/apps';
    logger.info('Image generation tool initialized', {
      component: 'ImageGenerationTool',
      appsBaseDir: this.appsBaseDir
    });
  }

  /**
   * Create OpenAI client using ai-lib's unified provider system
   * This leverages ai-lib's authentication handling while providing access to the full OpenAI client
   */
  private async createOpenAIClient(): Promise<OpenAI | null> {
    try {
      logger.debug('image-generation.client.create.start', {
        component: 'ImageGenerationTool',
        message: 'Creating OpenAI client via ai-lib unified provider'
      });

      // Use ai-lib's createOpenAIClient function which handles authentication automatically
      // This supports both S2S authentication and API key authentication
      const openaiClient = await createOpenAIClient();

      logger.debug('image-generation.client.create.success', {
        component: 'ImageGenerationTool',
        message: 'Successfully created OpenAI client via ai-lib'
      });

      return openaiClient;
    } catch (error) {
      logger.error('image-generation.client.create.failed', {
        component: 'ImageGenerationTool',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return null;
    }
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
        filename: options.filename
      }
    };

    // Log operation begin
    toolImageGenerationEvents.begin(logger, logData);

    try {
      const { prompt, size = '1024x1024', appId, filename } = options;

      // Validate input
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        logger.warn('image-generation.validation.failed', {
          component: 'ImageGenerationTool',
          error: 'Invalid prompt'
        });
        return {
          success: false,
          error: 'A valid prompt is required'
        };
      }

      if (!appId) {
        logger.warn('image-generation.validation.failed', {
          component: 'ImageGenerationTool',
          error: 'Missing app ID'
        });
        return {
          success: false,
          error: 'App ID is required to save the image'
        };
      }

      // Create OpenAI client using ai-lib unified provider
      const openaiClient = await this.createOpenAIClient();
      if (!openaiClient) {
        logger.error('image-generation.client.create.failed', {
          component: 'ImageGenerationTool',
          error: 'Failed to create OpenAI client via ai-lib unified provider'
        });
        return {
          success: false,
          error: 'OpenAI client could not be created - authentication not configured properly'
        };
      }

      // Setup directories
      const appPath = path.join(this.appsBaseDir, appId);
      const publicDir = path.join(appPath, 'public');
      const imagesDir = path.join(publicDir, 'images');

      // Ensure directories exist
      try {
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }
      } catch (error) {
        logger.error('image-generation.directories.failed', {
          component: 'ImageGenerationTool',
          error: error instanceof Error ? error.message : String(error),
          appId
        });
        return {
          success: false,
          error: `Failed to create directories: ${error instanceof Error ? error.message : String(error)}`
        };
      }

      // Generate image using gpt-image-1 model
      const result = await openaiClient.images.generate({
        model: "gpt-image-1",
        prompt: prompt.trim(),
        n: 1,
        size: size,
      });

      // Check if we have results
      if (!result.data || result.data.length === 0) {
        logger.warn('image-generation.api.no-data', {
          component: 'ImageGenerationTool',
          appId,
          error: 'No image data returned from API',
          resultData: result.data
        });
        return {
          success: false,
          error: 'No image generated from the provided prompt'
        };
      }

      const imageData = result.data[0];

      // Process returned image (prefer base64, fallback to URL if provided)
      if (imageData && (imageData.b64_json || imageData.url)) {
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
          // Get the image bytes from base64 or by downloading the URL
          let imageBuffer: Buffer;
          if (imageData.b64_json) {
            imageBuffer = Buffer.from(imageData.b64_json, 'base64');
          } else {
            const res = await fetch(imageData.url as string);
            if (!res.ok) {
              throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
            }
            const arrBuf = await res.arrayBuffer();
            imageBuffer = Buffer.from(arrBuf);
          }

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
            ...(imageData.b64_json && { base64Data: imageData.b64_json })
          };
        } catch (fileError) {
          logger.error('image-generation.file.save.failed', {
            component: 'ImageGenerationTool',
            appId,
            error: fileError instanceof Error ? fileError.message : String(fileError),
            filePath,
            stack: fileError instanceof Error ? fileError.stack : undefined
          });

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
      const executionTime = Date.now() - startTime;

      logger.error('image-generation.failed', {
        component: 'ImageGenerationTool',
        appId: options.appId,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        stack: error instanceof Error ? error.stack : undefined
      });

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
  const { prompt, size, appId, filename } = options;
  
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

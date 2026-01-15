import { createTool, type Tool, generateImageWithModel } from '@airo/ai-lib';
import { z } from 'zod';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { nanoid } from 'nanoid';
import { logger } from '../logging/index.js';
import { toolImageGenerationEvents } from '../logging/events/index.js';
import fs from 'node:fs';
import path from 'node:path';

export interface ImageEditorOptions {
  prompt: string;
  appId: string;
  size?: string;
  aspectRatio?: string;
  filename?: string;
}

export interface ImageEditorResult {
  success: boolean;
  url?: string;
  filepath?: string;
  publicPath?: string;
  base64Data?: string;
  error?: string;
}

export class ImageEditorTool {
  private appsBaseDir: string;
  private appRepository: AppRepository;

  constructor(appRepository?: AppRepository) {
    this.appsBaseDir = process.env.APPS_BASE_DIR || '/tmp/apps';
    this.appRepository = appRepository || new AppRepository();
  }

  async processImage(options: ImageEditorOptions): Promise<ImageEditorResult> {
    const startTime = Date.now();
    const { prompt, appId, size, aspectRatio, filename } = options;

    const logData = {
      toolName: 'image-editor-tool',
      appId,
      prompt,
      options: { size, aspectRatio, filename }
    };

    toolImageGenerationEvents.begin(logger, logData);

    try {
      const appPath = path.join(this.appsBaseDir, appId, 'app');
      const publicDir = path.join(appPath, 'public');
      const imagesDir = path.join(publicDir, 'images');

      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      const result = await generateImageWithModel({
        prompt: prompt.trim(),
        ...(size && { size: size as `${number}x${number}` }),
        ...(aspectRatio && { aspectRatio: aspectRatio as `${number}:${number}` }),
        n: 1,
      });

      if (!result.image) {
        return {
          success: false,
          error: 'No image generated from the provided prompt'
        };
      }

      const safeFilename = filename ||
        prompt.trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 40);

      const fullFilename = `${safeFilename}-${nanoid(6)}.png`;
      const filePath = path.join(imagesDir, fullFilename);

      const imageBuffer = Buffer.from(result.image, 'base64');
      fs.writeFileSync(filePath, imageBuffer);

      const publicPath = `/images/${fullFilename}`;
      const executionTime = Date.now() - startTime;

      toolImageGenerationEvents.success(logger, {
        toolName: logData.toolName,
        appId: logData.appId,
        prompt: logData.prompt,
        options: {
          ...(logData.options.size && { size: logData.options.size }),
          ...(logData.options.aspectRatio && { aspectRatio: logData.options.aspectRatio }),
          ...(logData.options.filename && { filename: logData.options.filename })
        },
        resultStats: {
          success: true,
          filePath,
          publicPath,
          fileSize: imageBuffer.length,
          executionTime
        }
      });

      const app = this.appRepository.findById(appId);
      const imageUrl = app?.previewUrl 
        ? `${app.previewUrl.replace(/\/+$/, '')}${publicPath}` 
        : publicPath;

      return {
        success: true,
        url: imageUrl,
        filepath: filePath,
        publicPath,
        base64Data: result.image
      };
    } catch (error) {
      toolImageGenerationEvents.failure(logger, error as Error, logData);
      return {
        success: false,
        error: `Image creation failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

interface ImageEditorResponse {
  success: boolean;
  prompt: string;
  error?: string;
  url?: string;
  filepath?: string;
  publicPath?: string;
}

export const imageEditorAITool: Tool = createTool(
  'Create images using AI with Gemini 2.5 Flash Image model. Provide a descriptive prompt to generate custom images for the application.',
  z.object({
    prompt: z.string().describe('Text prompt describing the image to create. Be specific and detailed for best results.'),
    size: z.string().optional().describe('Image size (e.g., "1024x1024", "1920x1080"). Optional - model will use default if not specified.'),
    aspectRatio: z.string().optional().describe('Aspect ratio (e.g., "1:1", "16:9", "3:2"). Optional - alternative to size.'),
    filename: z.string().optional().describe('Optional custom filename without extension for the generated image')
  }),
  async (input, context) => {
    const { prompt, size, aspectRatio, filename } = input;
    
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('A valid prompt is required');
    }
    
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID is required and is not available in context');
    }
    
    const options: ImageEditorOptions = {
      prompt,
      appId,
      ...(size && { size }),
      ...(aspectRatio && { aspectRatio }),
      ...(filename && { filename })
    };
    
    const imageEditorTool = new ImageEditorTool();
    const result = await imageEditorTool.processImage(options);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to create image');
    }
    
    const response: ImageEditorResponse = {
      success: result.success,
      prompt,
      ...(result.error && { error: result.error }),
      ...(result.url && { url: result.url }),
      ...(result.filepath && { filepath: result.filepath }),
      ...(result.publicPath && { publicPath: result.publicPath })
    };
    
    return JSON.stringify(response, null, 2);
  }
);

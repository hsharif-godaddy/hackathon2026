import { createTool, type Tool, generateImageWithModel } from '@airo/ai-lib';
import { AIRO_ASSET_UPLOADS_URL_PREFIX } from '@airo/shared/media';
import { z } from 'zod';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { nanoid } from 'nanoid';
import { logger } from '../logging/index.js';
import { toolImageGenerationEvents } from '../logging/events/index.js';
import { createForWorkspace } from '../workspace/index.js';

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
  private appRepository: AppRepository;

  constructor(appRepository?: AppRepository) {
    this.appRepository = appRepository || new AppRepository();
  }

  async processImage(options: ImageEditorOptions): Promise<ImageEditorResult> {
    const startTime = Date.now();
    const { prompt, appId, size, aspectRatio, filename } = options;

    const logData = {
      toolName: 'image-editor-tool',
      appId,
      prompt,
      options: { size, aspectRatio, filename },
    };

    toolImageGenerationEvents.begin(logger, logData);

    try {
      // Get the app's actual path from the database
      const app = this.appRepository.findById(appId);
      if (!app) {
        return {
          success: false,
          error: `App not found: ${appId}`,
        };
      }

      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        return { success: false, error: 'Workspace not available' };
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
          error: 'No image generated from the provided prompt',
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

      const imageBuffer = Buffer.from(result.image, 'base64');
      await workspace.files.upload({ path: uploadPath, data: imageBuffer });

      const publicPath = `${AIRO_ASSET_UPLOADS_URL_PREFIX}${fullFilename}`;
      const executionTime = Date.now() - startTime;

      toolImageGenerationEvents.success(logger, {
        toolName: logData.toolName,
        appId: logData.appId,
        prompt: logData.prompt,
        options: {
          ...(logData.options.size && { size: logData.options.size }),
          ...(logData.options.aspectRatio && { aspectRatio: logData.options.aspectRatio }),
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

      // Use the app object already fetched earlier
      const imageUrl = app.previewUrl
        ? `${app.previewUrl.replace(/\/+$/, '')}${publicPath}`
        : publicPath;

      return {
        success: true,
        url: imageUrl,
        filepath: uploadPath,
        publicPath,
        base64Data: result.image,
      };
    } catch (error) {
      toolImageGenerationEvents.failure(logger, error as Error, logData);
      return {
        success: false,
        error: `Image creation failed: ${error instanceof Error ? error.message : String(error)}`,
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
    prompt: z
      .string()
      .describe(
        'Text prompt describing the image to create. Be specific and detailed for best results.'
      ),
    size: z
      .string()
      .optional()
      .describe(
        'Image size (e.g., "1024x1024", "1920x1080"). Optional - model will use default if not specified.'
      ),
    aspectRatio: z
      .string()
      .optional()
      .describe('Aspect ratio (e.g., "1:1", "16:9", "3:2"). Optional - alternative to size.'),
    filename: z
      .string()
      .optional()
      .describe('Optional custom filename without extension for the generated image'),
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
      ...(filename && { filename }),
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
      ...(result.publicPath && { publicPath: result.publicPath }),
    };

    return JSON.stringify(response, null, 2);
  }
);

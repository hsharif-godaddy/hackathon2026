import { z } from 'zod';
import { logger } from '../../../logging/index.js';
import { grantSessionManager } from '@airo/ai-grants';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { imagegenService } from '../../../services/ImagegenService.js';
import { appRepository } from '../../../database/repositories/index.js';

// Keep in sync with editImageTool.config.validate which uses isAllowedLogoUrl() to block logo editing
const LOGO_PATH_PATTERN = /genai-assistant\/.*logo/i;
const ALLOWED_LOGO_HOSTNAMES = new Set(['isteam.wsimg.com', 'isteam.test-wsimg.com', 'isteam.dev-wsimg.com']);

function isAllowedLogoUrl(urlString: string): boolean {
  try {
    const { hostname, pathname } = new URL(urlString);
    return ALLOWED_LOGO_HOSTNAMES.has(hostname) && LOGO_PATH_PATTERN.test(pathname);
  } catch {
    return false;
  }
}

const GenerateImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('Image description'),
  orientation: z
    .enum(['landscape', 'portrait', 'square'])
    .default('landscape')
    .describe('Image orientation'),
  imageCount: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(4)
    .default(1)
    .describe('How many images (1-4)'),
});

const EditImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('Desired edits'),
  imageUrl: z.url().describe('Source image URL'),
});

type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;
type EditImageInput = z.infer<typeof EditImageInputSchema>;

export const generateImageTool: SkillToolDefinition = {
  name: 'generate_image',
  description:
    'Generate AI images from a description.',

  parameters: GenerateImageInputSchema,

  async execute(input: GenerateImageInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media-image.tools.generate_image.start', {
      promptLength: input.prompt.length,
      orientation: input.orientation,
      imageCount: input.imageCount,
      appId,
    });

    // 1. Get customer context from app database
    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media-image.tools.generate_image.no_customer', { appId });
      return { error: 'Unable to determine customer identity for image generation' };
    }

    // 2. Get budget user from grant system
    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('skills.media-image.tools.generate_image.grants_exhausted', { appId, socketId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to generate images.' };
    }

    // 3. Call imagegen API (map tool params to API params)
    const result = await imagegenService.generateImages({
      description: input.prompt,
      orientation: input.orientation,
      count: input.imageCount,
      customerId,
      budgetUserId,
    });

    logger.info('skills.media-image.tools.generate_image.success', {
      sessionId: result.sessionId,
      imageCount: result.images.length,
      orientation: input.orientation,
    });

    // 4. Return structured result
    return {
      structuredContent: {
        images: result.images,
        sessionId: result.sessionId,
      },
    };
  },

  config: {
    timeout: 120000, // 2 minutes for image generation
  },
};

export const editImageTool: SkillToolDefinition = {
  name: 'edit_image',
  description: 'Apply AI edits to an existing image. Renders onto an opaque canvas — no transparency. For logos, load media-logo skill and use media-logo__generate_logo instead (provides transparent variant).',
  parameters: EditImageInputSchema,

  async execute(input: EditImageInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media-image.tools.edit_image.start', {
      promptLength: input.prompt.length,
      hasImageUrl: !!input.imageUrl,
      appId,
    });

    // 1. Get customer context from app database
    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media-image.tools.edit_image.no_customer', { appId });
      return { error: 'Unable to determine customer identity for image editing' };
    }

    // 2. Get budget user from grant system
    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('skills.media-image.tools.edit_image.grants_exhausted', { appId, socketId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to edit images.' };
    }

    // 3. Call imagegen API
    const result = await imagegenService.editImage({
      description: input.prompt,
      imageUrl: input.imageUrl,
      customerId,
      budgetUserId,
    });

    logger.info('skills.media-image.tools.edit_image.success', {
      sessionId: result.sessionId,
    });

    // 4. Return structured result
    return {
      structuredContent: {
        url: result.url,
        sessionId: result.sessionId,
      },
    };
  },

  config: {
    timeout: 120000, // 2 minutes for image editing
    validate(input: EditImageInput) {
      if (isAllowedLogoUrl(input.imageUrl)) {
        throw new Error(
          'This URL is a generated logo. Editing logos loses transparency and degrades text/layout. ' +
          'Regenerate via media-logo__generate_logo with adjusted style, brandColors, or symbol. Load media-logo skill first if needed.'
        );
      }
    },
  },
};

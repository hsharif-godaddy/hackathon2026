/**
 * Media Skill Tools
 *
 * Provides tools for:
 * - Logo generation (auto-saves all variants into a media slot)
 * - Image generation (direct REST API call via ImagegenService with S2S auth)
 * - Image editing (direct REST API call via ImagegenService with S2S auth)
 * - Video generation (direct REST API call via ImagegenService with S2S auth, internal polling)
 */

import { z } from 'zod';
import { logger } from '../../../logging/index.js';
import { grantSessionManager } from '@airo/ai-grants';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { logoService } from '../../../services/LogoService.js';
import { imagegenService } from '../../../services/ImagegenService.js';
import { mediaManifestService } from '../../../services/MediaManifestService.js';
import { appRepository } from '../../../database/repositories/index.js';
import { appPlanTool } from '../../../tools/app-plan-tool.js';

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

// ============================================================================
// Input Schemas
// ============================================================================
type LogoStyle =
  | 'line'
  | 'glyph'
  | 'full-color'
  | 'dual-tone'
  | '3d'
  | 'badge'
  | 'colored-line'
  | 'handmade'
  | 'mascot'
  | 'monogram'
  | 'name-mark';

const LOGO_STYLES: LogoStyle[] = [
  'line',
  'glyph',
  'full-color',
  'dual-tone',
  '3d',
  'badge',
  'colored-line',
  'handmade',
  'mascot',
  'monogram',
  'name-mark'
];

const GenerateLogoInputSchema = z.object({
  brandName: z.string().min(1).max(100).describe('Primary text for the logo (business/brand name)'),

  brandTagline: z.string().max(100).optional().describe('Secondary text like tagline, slogan, or "Est. 2020"'),

  brandDescription: z
    .string()
    .min(1)
    .max(500)
    .describe('What the business does - informs visual choices for the logo design'),

  style: z
    .enum(LOGO_STYLES as [string, ...string[]])
    .describe(
      'Logo visual style preset. Options: line (minimalist line art), glyph (iconic symbol), ' +
        'full-color (vibrant illustrated), dual-tone (two colors), 3d (depth/dimension), ' +
        'badge (emblem/seal), flat (modern flat design), colored-line (line art with color), ' +
        'handmade (hand-drawn feel), mascot (character illustration), monogram (initials/lettermark), ' +
        'name-mark (stylized typography)'
    ),

  styleDescription: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Additional custom style direction beyond the preset (e.g., "make it more playful" or "corporate and serious")'
    ),

  symbol: z
    .string()
    .max(100)
    .optional()
    .describe('Icon or imagery to incorporate into the logo (e.g., "coffee cup", "mountain", "abstract waves")'),

  brandColors: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Color preferences as a description (e.g., "warm orange and brown", "professional blue"). Leave empty for AI to choose appropriate colors.'
    ),

  brandPersonality: z
    .string()
    .max(200)
    .optional()
    .describe('Brand personality traits (e.g., "professional and trustworthy", "playful and creative")'),

  brandAudience: z
    .string()
    .max(200)
    .optional()
    .describe('Target audience description (e.g., "young professionals", "families with children")'),

  count: z.coerce.number().int().min(1).max(4).default(4).describe('Number of logo variations to generate (1-4, default: 4)'),
});

const GenerateImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('The text prompt to generate an image for'),
  orientation: z
    .enum(['landscape', 'portrait', 'square'])
    .default('landscape')
    .describe('The orientation of the image'),
  imageCount: z
    .coerce // Coerce string to number since LLMs often pass numbers as strings
    .number()
    .int()
    .min(1)
    .max(4)
    .default(1)
    .describe('Number of images to generate as a number (1-4, default: 1)'),
});

const EditImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('The prompt for the edits to be made to the image'),
  imageUrl: z.url().describe('The URL of the image to be edited'),
});

const GenerateVideoInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('The text prompt to generate a video for'),
  orientation: z
    .enum(['landscape', 'portrait'])
    .default('landscape')
    .describe('The orientation of the video'),
  duration: z
    .coerce
    .number()
    .int()
    .refine((val) => [5, 6, 7, 8].includes(val), {
      message: 'Duration must be 5, 6, 7, or 8 seconds',
    })
    .describe('The duration of the video in seconds (5, 6, 7, or 8)'),
});

// ============================================================================
// Type Aliases for Tool Inputs
// ============================================================================

type GenerateLogoInput = z.infer<typeof GenerateLogoInputSchema>;
type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;
type EditImageInput = z.infer<typeof EditImageInputSchema>;
type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Logo generation tool using direct REST API call via LogoService
 */
const LOGO_SLOT_PATH = 'logo/primary';

export const generateLogoTool: SkillToolDefinition = {
  name: 'generate_logo',
  description:
    'Generate professional logos for a business using AI. Automatically saves all generated logos into the media slot system. Returns slot URL for use in source code, plus logo preview data. Requires business name and description.',

  parameters: GenerateLogoInputSchema,

  async execute(input: GenerateLogoInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media.tools.generate_logo.start', {
      brandName: input.brandName,
      logoCount: input.count,
      appId,
    });

    // 1. Get customer context from app database
    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media.tools.generate_logo.no_customer', { appId });
      return { error: 'Unable to determine customer identity for logo generation' };
    }

    // 2. Get budget user from grant system (required — logo generation must be billed)
    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('skills.media.tools.generate_logo.grants_exhausted', { appId, socketId, budgetUserId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to generate logos.' };
    }

    // 3. Enrich optional brand fields from app plan
    const enrichedInput = { ...input };

    if (!enrichedInput.brandColors && appId) {
      try {
        const planResult = await appPlanTool.execute({ appId, operation: 'get' });
        const palette = planResult.data?.colorPalette;
        if (palette?.primary) {
          const parts = [`primary: ${palette.primary}`];
          if (palette.secondary) parts.push(`secondary: ${palette.secondary}`);
          if (palette.accent) parts.push(`accent: ${palette.accent}`);
          enrichedInput.brandColors = parts.join(', ');
        }
      } catch (e) {
        logger.warn('skills.media.tools.generate_logo.enrich_colors_failed', {
          appId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 4. Call logo API
    const result = await logoService.generateLogos({
      ...enrichedInput,
      customerId,
      budgetUserId,
    });

    logger.info('skills.media.tools.generate_logo.success', {
      brandName: input.brandName,
      sessionId: result.sessionId,
      logoCount: result.logos.length,
    });

    // 5. Auto-save all logos into a single media slot (merge with existing)
    const slotUrl = `/airo-assets/images/${LOGO_SLOT_PATH}`;
    if (appId && result.logos.length > 0) {
      try {
        const transparentUrls = result.logos.map(l => l.transparentUrl);
        const solidUrlMap: Record<string, string> = {};
        for (const logo of result.logos) {
          solidUrlMap[logo.transparentUrl] = logo.solidUrl;
        }

        // Merge with existing slot so regeneration appends instead of overwriting
        const existingResult = await mediaManifestService.getSlot(appId, LOGO_SLOT_PATH);
        const existingSlot = existingResult.success ? existingResult.slot : undefined;
        let mergedAlternatives = transparentUrls.slice(1);
        let mergedSolidUrlMap = { ...solidUrlMap };

        if (existingSlot) {
          const existingUrls = [existingSlot.currentUrl, ...(existingSlot.alternatives || [])];
          const newUrlSet = new Set(transparentUrls);
          const oldUrls = existingUrls.filter(url => !newUrlSet.has(url));
          mergedAlternatives = [...mergedAlternatives, ...oldUrls];
          mergedSolidUrlMap = { ...(existingSlot.solidUrlMap || {}), ...solidUrlMap };
        }

        const now = new Date().toISOString();

        await mediaManifestService.setSlot(appId, LOGO_SLOT_PATH, {
          mediaType: 'logo',
          currentUrl: transparentUrls[0]!,
          searchQuery: input.brandName,
          alternatives: mergedAlternatives,
          solidUrlMap: mergedSolidUrlMap,
          userModified: false,
          createdAt: now,
          lastUpdated: now,
        });

        logger.info('skills.media.tools.generate_logo.slot_saved', {
          appId,
          slotPath: LOGO_SLOT_PATH,
          logoCount: result.logos.length,
          totalLogos: mergedAlternatives.length + 1,
        });
      } catch (e) {
        logger.warn('skills.media.tools.generate_logo.slot_save_failed', {
          appId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 6. Return structured result for the frontend + instructions for the agent
    return {
      text: `Generated ${result.logos.length} logos and saved to slot "${LOGO_SLOT_PATH}". ` +
        `Logo 1 is set as the default. Slot URL: ${slotUrl} (transparent), ${slotUrl}?variant=solid (solid background). ` +
        `If the user's request includes placement (e.g. "add logo to header"), place the slot URL in source code now. ` +
        `Otherwise, present the logos and let the user decide — they can swap via the widget and ask you to place it later.`,
      structuredContent: {
        logos: result.logos,
        sessionId: result.sessionId,
        slotUrl,
        slotPath: LOGO_SLOT_PATH,
      },
    };
  },

  config: {
    timeout: 120000,
  },
};

export const generateImageTool: SkillToolDefinition = {
  name: 'generate_image',
  description:
    'Generate images from text prompts using AI. Returns URLs to generated images. Use this when image search does not find suitable results or when custom AI-generated images are needed.',

  parameters: GenerateImageInputSchema,

  async execute(input: GenerateImageInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media.tools.generate_image.start', {
      promptLength: input.prompt.length,
      orientation: input.orientation,
      imageCount: input.imageCount,
      appId,
    });

    // 1. Get customer context from app database
    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media.tools.generate_image.no_customer', { appId });
      return { error: 'Unable to determine customer identity for image generation' };
    }

    // 2. Get budget user from grant system
    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('skills.media.tools.generate_image.grants_exhausted', { appId, socketId });
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

    logger.info('skills.media.tools.generate_image.success', {
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

/**
 * Image editing tool using direct REST API call via ImagegenService
 */
export const editImageTool: SkillToolDefinition = {
  name: 'edit_image',
  description:
    'Edit an existing image using AI-powered modifications. Provide the image URL and describe the changes you want to make. ' +
    'This tool renders edits onto an opaque canvas, so it cannot produce transparent backgrounds. ' +
    'Do NOT use this for logos — generate_logo already provides transparent and solid variants.',

  parameters: EditImageInputSchema,

  async execute(input: EditImageInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media.tools.edit_image.start', {
      promptLength: input.prompt.length,
      hasImageUrl: !!input.imageUrl,
      appId,
    });

    // 1. Get customer context from app database
    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media.tools.edit_image.no_customer', { appId });
      return { error: 'Unable to determine customer identity for image editing' };
    }

    // 2. Get budget user from grant system
    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('skills.media.tools.edit_image.grants_exhausted', { appId, socketId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to edit images.' };
    }

    // 3. Call imagegen API
    const result = await imagegenService.editImage({
      description: input.prompt,
      imageUrl: input.imageUrl,
      customerId,
      budgetUserId,
    });

    logger.info('skills.media.tools.edit_image.success', {
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
          'This URL is a generated logo. The edit_image tool cannot reliably modify logos — it renders onto an opaque canvas (losing transparency) and produces poor results for text and layout changes. ' +
          'Instead, regenerate with media__generate_logo using adjusted parameters (style, styleDescription, brandColors, symbol) to get the desired design. Logos are automatically saved to the slot system.'
        );
      }
    },
  },
};

/**
 * Video generation tool using direct REST API call via ImagegenService
 * Polls internally until the video is ready (up to 5 minutes).
 */
export const generateVideoTool: SkillToolDefinition = {
  name: 'generate_video',
  description:
    'Generate videos from text prompts using AI. Returns URL to generated video. Video generation takes up to 5 minutes.',

  parameters: GenerateVideoInputSchema,

  async execute(input: GenerateVideoInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media.tools.generate_video.start', {
      promptLength: input.prompt.length,
      orientation: input.orientation,
      duration: input.duration,
      appId,
    });

    // 1. Get customer context from app database
    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media.tools.generate_video.no_customer', { appId });
      return { error: 'Unable to determine customer identity for video generation' };
    }

    // 2. Get budget user from grant system
    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('skills.media.tools.generate_video.grants_exhausted', { appId, socketId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to generate videos.' };
    }

    // 3. Call imagegen API (polls internally until complete)
    const result = await imagegenService.generateVideo({
      description: input.prompt,
      orientation: input.orientation,
      duration: input.duration,
      customerId,
      budgetUserId,
    });

    logger.info('skills.media.tools.generate_video.success', {
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
    timeout: 330000, // 5.5 minutes (poll timeout is 5 min, add buffer)
  },
};

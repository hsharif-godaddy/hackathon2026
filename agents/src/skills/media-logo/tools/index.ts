import { z } from 'zod';
import { logger } from '../../../logging/index.js';
import { grantSessionManager } from '@airo/ai-grants';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { logoService } from '../../../services/LogoService.js';
import { mediaManifestService } from '../../../services/MediaManifestService.js';
import { appRepository } from '../../../database/repositories/index.js';
import { appPlanTool } from '../../../tools/app-plan-tool.js';
import { MemoryRepository } from '../../../database/repositories/MemoryRepository.js';
import { buildBrandLogoData } from '../../../utils/brand-data.js';

const memoryRepo = new MemoryRepository();

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

type GenerateLogoInput = z.infer<typeof GenerateLogoInputSchema>;

const LOGO_SLOT_PATH = 'logo/primary';

export const generateLogoTool: SkillToolDefinition = {
  name: 'generate_logo',
  description: `Generate professional logos using AI. Auto-saves to media slot system; returns slotUrl for source code placement.

## Rules

1. Generate 3-4 variations for user choice.
2. To change logos, call again with **adjusted style/symbol/colors**`,

  parameters: GenerateLogoInputSchema,

  async execute(input: GenerateLogoInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media-logo.tools.generate_logo.start', {
      brandName: input.brandName,
      logoCount: input.count,
      appId,
    });

    // 1. Get customer context from app database
    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media-logo.tools.generate_logo.no_customer', { appId });
      return { error: 'Unable to determine customer identity for logo generation' };
    }

    // 2. Get budget user from grant system (required — logo generation must be billed)
    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('skills.media-logo.tools.generate_logo.grants_exhausted', { appId, socketId, budgetUserId });
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
        logger.warn('skills.media-logo.tools.generate_logo.enrich_colors_failed', {
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

    logger.info('skills.media-logo.tools.generate_logo.success', {
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

        logger.info('skills.media-logo.tools.generate_logo.slot_saved', {
          appId,
          slotPath: LOGO_SLOT_PATH,
          logoCount: result.logos.length,
          totalLogos: mergedAlternatives.length + 1,
        });

        // Save first logo to brand.logo memory key for the brand book
        const firstLogo = result.logos[0];
        if (firstLogo) {
          memoryRepo.set(appId, 'brand.logo', buildBrandLogoData(firstLogo)).catch((error) => {
            logger.warn('skills.media.tools.generate_logo.brandData_failed', {
              appId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      } catch (e) {
        logger.warn('skills.media-logo.tools.generate_logo.slot_save_failed', {
          appId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 6. Return structured result for the frontend + instructions for the agent
    return {
      text: `Generated ${result.logos.length} logos and saved to slot "${LOGO_SLOT_PATH}". ` +
        `Logo 1 is set as the default. Slot URL: ${slotUrl} (transparent), ${slotUrl}?variant=solid (solid background).`,
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

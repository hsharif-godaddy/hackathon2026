/**
 * Generate Logo AI Tool
 *
 * AI-lib wrapper for logo generation, registered as a core tool
 * so the develop agent can call it directly without loading the media skill.
 */

import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { logger } from '../../logging/index.js'
import { grantSessionManager } from '@airo/ai-grants'
import { BudgetExceededError } from '@airo/ai-common'
import { logoService } from '../../services/LogoService.js'
import { appRepository } from '../../database/repositories/index.js'
import { appPlanTool } from '../app-plan-tool.js'
import { MemoryRepository } from '../../database/repositories/MemoryRepository.js'
import { buildBrandLogoData } from '../../utils/brand-data.js'

const memoryRepo = new MemoryRepository()

const LOGO_STYLES = [
  'line', 'glyph', 'full-color', 'dual-tone', '3d', 'badge',
  'colored-line', 'handmade', 'mascot', 'monogram', 'name-mark'
] as const;

const GenerateLogoInputSchema = z.object({
  brandName: z.string().min(1).max(100).describe('Primary text for the logo (business/brand name)'),
  brandTagline: z.string().max(100).optional().describe('Secondary text like tagline, slogan, or "Est. 2020"'),
  brandDescription: z.string().min(1).max(500).describe('What the business does - informs visual choices for the logo design'),
  style: z.enum(LOGO_STYLES).describe(
    'Logo visual style preset. Options: line (minimalist line art), glyph (iconic symbol), ' +
    'full-color (vibrant illustrated), dual-tone (two colors), 3d (depth/dimension), ' +
    'badge (emblem/seal), colored-line (line art with color), ' +
    'handmade (hand-drawn feel), mascot (character illustration), monogram (initials/lettermark), ' +
    'name-mark (stylized typography)'
  ),
  styleDescription: z.string().max(200).optional().describe('Additional custom style direction beyond the preset'),
  symbol: z.string().max(100).optional().describe('Icon or imagery to incorporate (e.g., "coffee cup", "mountain")'),
  brandColors: z.string().max(100).optional().describe('Color preferences as a description. Leave empty for AI to choose.'),
  brandPersonality: z.string().max(200).optional().describe('Brand personality traits (e.g., "professional and trustworthy")'),
  brandAudience: z.string().max(200).optional().describe('Target audience description'),
  count: z.coerce.number().int().min(1).max(4).default(1).describe('Number of logo variations to generate (1-4, default: 1)'),
  layout: z.string().optional().describe('Layout variants to generate. Use "all" to get square, horizontal, and vertical variants.'),
});

export const generateLogoAITool: Tool = createTool(
  `Generate professional logos for a business using AI. Returns URLs to generated logo images.

WHEN TO USE:
- Right after colors and fonts have been chosen for a new site
- User explicitly requests a logo
- During initial site setup to establish brand identity

IMPORTANT:
- Requires brandName and brandDescription at minimum
- Will auto-enrich with brand colors from the app plan if not provided
- Returns structured logo URLs (square, horizontal, vertical variants)
- Logo URLs are saved to memory for the brand book page`,

  GenerateLogoInputSchema,

  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined;
    const socketId = (context as any)?.socketId as string | undefined;

    logger.info('tools.generate_logo.start', {
      brandName: input.brandName,
      logoCount: input.count,
      appId,
    });

    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('tools.generate_logo.no_customer', { appId });
      return { error: 'Unable to determine customer identity for logo generation' };
    }

    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('tools.generate_logo.grants_exhausted', { appId, socketId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to generate logos.' };
    }

    // Enrich brand colors from app plan if not provided
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
        logger.warn('tools.generate_logo.enrich_colors_failed', {
          appId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const serviceInput = {
      ...enrichedInput,
      customerId,
      budgetUserId,
    };

    let result;
    try {
      result = await logoService.generateLogos(serviceInput);
    } catch (error) {
      if (BudgetExceededError.isInstance(error)) {
        return { error: 'Budget exceeded — please purchase additional credits to generate logos.' };
      }
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        return { error: 'Logo generation timed out. Please try again.' };
      }
      logger.error('tools.generate_logo.error', { appId, error: error instanceof Error ? error.message : String(error) });
      return { error: 'Logo generation failed. Please try again.' };
    }

    logger.info('tools.generate_logo.success', {
      brandName: input.brandName,
      sessionId: result.sessionId,
    });

    // Save first logo to memory as default (will be overwritten if user selects a different one)
    let autosaveFailed = false;
    if (appId) {
      const firstLogo = result.logos[0];
      if (firstLogo) {
        try {
          await memoryRepo.set(appId, 'brand.logo', buildBrandLogoData(firstLogo));
          await memoryRepo.delete(appId, 'brand.logo.error').catch(() => {});
        } catch (error) {
          autosaveFailed = true;
          logger.warn('tools.generate_logo.brandData_failed', {
            appId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Build per-logo brand.logo data so agent can save the correct one when user selects
    const logoBrandData = result.logos.map((logo: any) => buildBrandLogoData(logo));

    return {
      structuredContent: {
        logos: result.logos,
        logoBrandData,
        sessionId: result.sessionId,
        ...(autosaveFailed && { autosaveFailed: true }),
        instruction: 'When the user selects a logo (e.g. "Use logo 2"), save that logo\'s brand data to memory key "brand.logo" using memorySet. Use the logoBrandData array (0-indexed) to get the correct data.' +
          (autosaveFailed ? ' NOTE: Auto-save to brand book failed — you must save the selected logo manually via memorySet.' : ''),
      },
    };
  }
);

/**
 * Edit Logo AI Tool
 *
 * AI-lib wrapper for logo editing, allowing users to refine
 * previously generated logos with natural language prompts.
 */

import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { logger } from '../../logging/index.js'
import { grantSessionManager } from '@airo/ai-grants'
import { BudgetExceededError } from '@airo/ai-common'
import { logoService } from '../../services/LogoService.js'
import { appRepository } from '../../database/repositories/index.js'
import { MemoryRepository } from '../../database/repositories/MemoryRepository.js'
import { buildBrandLogoData } from '../../utils/brand-data.js'

const memoryRepo = new MemoryRepository()

const EditLogoInputSchema = z.object({
  sourceSessionId: z.string().min(1).describe('Session ID from a previous generateLogo call'),
  sourceLogoId: z.string().min(1).describe('Logo ID to edit (from the logos array of a previous generateLogo result)'),
  prompt: z.string().min(1).max(500).describe('Edit instruction describing what to change (e.g., "Make the logo blue", "Remove the tagline text", "Make it more minimal")'),
  layout: z.string().optional().describe('Layout variants to generate for the edited logo. Use "all" for square, horizontal, and vertical.'),
  count: z.coerce.number().int().min(1).max(4).default(1).describe('Number of edit variations to generate (1-4, default: 1)'),
});

export const editLogoAITool: Tool = createTool(
  `Edit an existing logo using AI. Modifies a previously generated logo based on a natural language prompt.

WHEN TO USE:
- User wants to refine, modify, or adjust a previously generated logo
- User asks to change colors, style, text, or other aspects of their logo
- User says things like "make the logo blue", "remove the text", "make it simpler"

IMPORTANT:
- Requires sourceSessionId and sourceLogoId from a previous generateLogo result
- The prompt should describe the desired change clearly
- Returns new logo URLs (the original is not modified)
- Edited logo URLs are saved to memory for the brand book page`,

  EditLogoInputSchema,

  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined;
    const socketId = (context as any)?.socketId as string | undefined;

    logger.info('tools.edit_logo.start', {
      sourceSessionId: input.sourceSessionId,
      sourceLogoId: input.sourceLogoId,
      prompt: input.prompt.slice(0, 100),
      appId,
    });

    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('tools.edit_logo.no_customer', { appId });
      return { error: 'Unable to determine customer identity for logo editing' };
    }

    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('tools.edit_logo.grants_exhausted', { appId, socketId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to edit logos.' };
    }

    const serviceInput = {
      sourceSessionId: input.sourceSessionId,
      sourceLogoId: input.sourceLogoId,
      prompt: input.prompt,
      customerId,
      budgetUserId,
      ...(input.layout && { layout: input.layout }),
      ...(input.count && { count: input.count }),
    };

    let result;
    try {
      result = await logoService.editLogos(serviceInput);
    } catch (error) {
      if (BudgetExceededError.isInstance(error)) {
        return { error: 'Budget exceeded — please purchase additional credits to edit logos.' };
      }
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        return { error: 'Logo editing timed out. Please try again.' };
      }
      logger.error('tools.edit_logo.error', { appId, error: error instanceof Error ? error.message : String(error) });
      return { error: 'Logo editing failed. Please try again.' };
    }

    logger.info('tools.edit_logo.success', {
      sourceSessionId: input.sourceSessionId,
      newSessionId: result.sessionId,
      logoCount: result.logos.length,
    });

    // Save first edited logo to memory for the brand book
    let autosaveFailed = false;
    if (appId) {
      const firstLogo = result.logos[0];
      if (firstLogo) {
        try {
          await memoryRepo.set(appId, 'brand.logo', buildBrandLogoData(firstLogo));
          await memoryRepo.delete(appId, 'brand.logo.error').catch(() => {});
        } catch (error) {
          autosaveFailed = true;
          logger.warn('tools.edit_logo.brandData_failed', {
            appId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const logoBrandData = result.logos.map((logo: any) => buildBrandLogoData(logo));

    return {
      structuredContent: {
        logos: result.logos,
        logoBrandData,
        sessionId: result.sessionId,
        ...(autosaveFailed && { autosaveFailed: true }),
        instruction: 'When the user selects an edited logo (e.g. "Use that one"), save that logo\'s brand data to memory key "brand.logo" using memorySet. Use the logoBrandData array (0-indexed) to get the correct data.' +
          (autosaveFailed ? ' NOTE: Auto-save to brand book failed — you must save the selected logo manually via memorySet.' : ''),
      },
    };
  }
);

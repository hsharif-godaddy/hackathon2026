/**
 * Logo Skill Tools
 *
 * Provides tools for:
 * - Logo generation (auto-saves all variants into a media slot)
 * - Logo editing (edit an existing generated logo via AI, auto-saves variants into a media slot)
 */

import { z } from 'zod';
import { logger } from '../../../logging/index.js';
import { grantSessionManager } from '@airo/ai-grants';
import { BudgetExceededError } from '@airo/ai-common';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { logoService, type ProcessedLogo } from '../../../services/LogoService.js';
import { mediaManifestService } from '../../../services/MediaManifestService.js';
import { appRepository } from '../../../database/repositories/index.js';
import { appPlanTool } from '../../../tools/app-plan-tool.js';

// ============================================================================
// Input Schemas
// ============================================================================
const LOGO_STYLES = [
  'line',
  'glyph',
  'full-color',
  'dual-tone',
  '3d',
  'badge',
  'colored-line',
  'handmade',
  'mascot',
  'name-mark',
] as const;

const LogoVariationSchema = z.object({
  style: z
    .enum(LOGO_STYLES)
    .describe(
      'Logo visual style preset. Options: line (minimalist line art), glyph (iconic symbol), ' +
        'full-color (vibrant illustrated), dual-tone (two colors), 3d (depth/dimension), ' +
        'badge (emblem/seal), colored-line (line art with color), ' +
        'handmade (hand-drawn feel), mascot (character illustration), ' +
        'name-mark (stylized typography)'
    ),
  styleDescription: z.string().max(200).optional().describe('Additional custom style direction for this variation'),
  symbol: z.string().max(100).optional().describe('Icon or imagery to incorporate (e.g., "coffee cup", "mountain")'),
  brandColors: z.string().max(100).optional().describe('Color overrides for this variation'),
});

const GenerateLogoInputSchema = z.object({
  brandName: z.string().min(1).max(100).describe('Primary text for the logo (business/brand name)'),

  brandTagline: z.string().max(100).optional().describe('Secondary text like tagline, slogan, or "Est. 2020"'),

  brandDescription: z
    .string()
    .min(1)
    .max(500)
    .describe('What the business does - informs visual choices for the logo design'),

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

  layout: z
    .enum(['square', 'horizontal', 'vertical', 'all'])
    .default('horizontal')
    .describe(
      'Which layout orientation to generate. ' +
        'square (1024x1024 — app icons, social profiles), ' +
        'horizontal (1536x1024, default — headers, navbars, email signatures), ' +
        'vertical (1024x1536 — sidebars, mobile, signage), ' +
        'or all (generates all three orientations). ' +
        'Each logo in the response includes URLs only for the requested layout(s).'
    ),

  variations: z
    .array(LogoVariationSchema)
    .min(1)
    .max(4)
    .describe('Style variations to generate. The first variation should be the closest match to what the user wants — the best style for their brand. Subsequent variations provide alternatives for the user to choose from.'),
});

const EditLogoInputSchema = z.object({
  sourceSessionId: z
    .string()
    .min(1)
    .optional()
    .describe('The sessionId from a previous logo generation result. If omitted, automatically resolved from the current saved logo slot.'),

  sourceLogoId: z
    .string()
    .min(1)
    .optional()
    .describe('The id of the specific logo to edit. If omitted, automatically resolved from the current saved logo slot.'),

  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('Description of the edits to make to the logo (e.g., "Make the logo blue", "Remove the tagline", "Make the icon larger")'),

  layout: z
    .enum(['square', 'horizontal', 'vertical', 'all'])
    .optional()
    .describe(
      'Which layout orientation to edit. If omitted, uses the same layout as the source logo. ' +
        'square (1024x1024), horizontal (1536x1024), vertical (1024x1536), or all.'
    ),

  count: z.coerce.number().int().min(1).max(4).default(1).describe('Number of edited logo variations to generate (1-4, default: 1)'),
});

// ============================================================================
// Type Aliases for Tool Inputs
// ============================================================================

type GenerateLogoInput = z.infer<typeof GenerateLogoInputSchema>;
type EditLogoInput = z.infer<typeof EditLogoInputSchema>;

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Per-orientation logo slot paths.
 * Each orientation gets its own slot so they can be used independently
 * (e.g., horizontal in header, vertical in hero, square for favicon).
 */
type LogoLayout = 'square' | 'horizontal' | 'vertical';

const LOGO_SLOT_PATHS: Record<LogoLayout, string> = {
  square: 'logo/primary',
  horizontal: 'logo/horizontal',
  vertical: 'logo/vertical',
};

/** Default slot path used for backwards compatibility and auto-resolution. */
const DEFAULT_LOGO_SLOT_PATH = 'logo/primary';

/** URL getters per orientation from a ProcessedLogo. */
const LAYOUT_URL_GETTERS: Record<LogoLayout, {
  transparent: (l: ProcessedLogo) => string | undefined;
  solid: (l: ProcessedLogo) => string | undefined;
  reversed: (l: ProcessedLogo) => string | undefined;
  reversedSolid: (l: ProcessedLogo) => string | undefined;
  mockup: (l: ProcessedLogo) => string | undefined;
  landscapeMockup: (l: ProcessedLogo) => string | undefined;
}> = {
  square: {
    transparent: (l) => l.transparentUrl,
    solid: (l) => l.solidUrl,
    reversed: (l) => l.reversedUrl,
    reversedSolid: (l) => l.reversedSolidUrl,
    mockup: (l) => l.mockupUrl,
    landscapeMockup: (l) => l.landscapeMockupUrl,
  },
  horizontal: {
    transparent: (l) => l.horizontalTransparentUrl,
    solid: (l) => l.horizontalSolidUrl,
    reversed: (l) => l.horizontalReversedUrl,
    reversedSolid: (l) => l.horizontalReversedSolidUrl,
    mockup: (l) => l.horizontalMockupUrl,
    landscapeMockup: (l) => l.horizontalLandscapeMockupUrl,
  },
  vertical: {
    transparent: (l) => l.verticalTransparentUrl,
    solid: (l) => l.verticalSolidUrl,
    reversed: (l) => l.verticalReversedUrl,
    reversedSolid: (l) => l.verticalReversedSolidUrl,
    mockup: (l) => l.verticalMockupUrl,
    landscapeMockup: (l) => l.verticalLandscapeMockupUrl,
  },
};

/**
 * Determine which orientations are present in the logo results.
 *
 * Assumption: all logos in a generation batch share the same orientation set.
 * Only the first logo is inspected. If the API ever returns heterogeneous
 * orientations across logos in a single batch, logos beyond the first may be
 * saved to the wrong slot.
 */
function getLayoutsFromLogos(logos: ProcessedLogo[]): LogoLayout[] {
  const layouts: LogoLayout[] = [];
  const first = logos[0];
  if (!first) return ['square'];
  if (first.transparentUrl || first.solidUrl) layouts.push('square');
  if (first.horizontalTransparentUrl || first.horizontalSolidUrl) layouts.push('horizontal');
  if (first.verticalTransparentUrl || first.verticalSolidUrl) layouts.push('vertical');

  // Warn if any subsequent logo has a different orientation set — this would
  // indicate the homogeneous-batch assumption no longer holds.
  if (logos.length > 1) {
    for (let i = 1; i < logos.length; i++) {
      const l = logos[i]!;
      const hasSquare = !!(l.transparentUrl || l.solidUrl);
      const hasHorizontal = !!(l.horizontalTransparentUrl || l.horizontalSolidUrl);
      const hasVertical = !!(l.verticalTransparentUrl || l.verticalSolidUrl);
      const otherLayouts: LogoLayout[] = [];
      if (hasSquare) otherLayouts.push('square');
      if (hasHorizontal) otherLayouts.push('horizontal');
      if (hasVertical) otherLayouts.push('vertical');
      if (otherLayouts.length === 0) otherLayouts.push('square');

      if (otherLayouts.length !== layouts.length || otherLayouts.some((lay, idx) => lay !== layouts[idx])) {
        logger.warn('logo.layouts.mismatch', {
          message: 'Logo batch contains heterogeneous orientation sets — only the first logo was used to determine layouts',
          firstLogoLayouts: layouts,
          mismatchIndex: i,
          mismatchLayouts: otherLayouts,
        });
        break;
      }
    }
  }

  return layouts.length > 0 ? layouts : ['square'];
}

/**
 * Save logos to per-orientation media slots. Each layout present in the results
 * gets its own slot, enabling independent use in different placements.
 */
const SLOT_SAVED_EVENTS = {
  generate_logo: 'skills.media-logo.tools.generate_logo.slot_saved',
  edit_logo: 'skills.media-logo.tools.edit_logo.slot_saved',
} as const;

async function saveLogosToSlots(
  appId: string,
  logos: ProcessedLogo[],
  sessionId: string,
  searchQuery: string,
  toolName: keyof typeof SLOT_SAVED_EVENTS,
  logoSessionIds?: Map<string, string>,
): Promise<{ savedSlots: Record<string, string> }> {
  const layouts = getLayoutsFromLogos(logos);
  const savedSlots: Record<string, string> = {};

  for (const layout of layouts) {
    const slotPath = LOGO_SLOT_PATHS[layout];
    const getters = LAYOUT_URL_GETTERS[layout];

    const transparentUrls = logos
      .map(l => getters.transparent(l))
      .filter(Boolean) as string[];

    if (transparentUrls.length === 0) continue;

    const solidUrlMap: Record<string, string> = {};
    const reversedUrlMap: Record<string, string> = {};
    const reversedSolidUrlMap: Record<string, string> = {};
    const mockupUrlMap: Record<string, string> = {};
    const landscapeMockupUrlMap: Record<string, string> = {};
    const logoSourceMap: Record<string, { sessionId: string; logoId: string }> = {};
    for (const logo of logos) {
      const tUrl = getters.transparent(logo);
      const sUrl = getters.solid(logo);
      const rUrl = getters.reversed(logo);
      const rsUrl = getters.reversedSolid(logo);
      const mUrl = getters.mockup(logo);
      const lmUrl = getters.landscapeMockup(logo);
      const logoSessionId = logoSessionIds?.get(logo.id) ?? sessionId;
      if (tUrl && sUrl) solidUrlMap[tUrl] = sUrl;
      if (tUrl && rUrl) reversedUrlMap[tUrl] = rUrl;
      if (tUrl && rsUrl) reversedSolidUrlMap[tUrl] = rsUrl;
      if (tUrl && mUrl) mockupUrlMap[tUrl] = mUrl;
      if (tUrl && lmUrl) landscapeMockupUrlMap[tUrl] = lmUrl;
      if (tUrl) logoSourceMap[tUrl] = { sessionId: logoSessionId, logoId: logo.id };
    }

    // Merge with existing slot
    const existingResult = await mediaManifestService.getSlot(appId, slotPath);
    const existingSlot = existingResult.success ? existingResult.slot : undefined;
    let mergedAlternatives = transparentUrls.slice(1);
    let mergedSolidUrlMap = { ...solidUrlMap };
    let mergedReversedUrlMap = { ...reversedUrlMap };
    let mergedReversedSolidUrlMap = { ...reversedSolidUrlMap };
    let mergedMockupUrlMap = { ...mockupUrlMap };
    let mergedLandscapeMockupUrlMap = { ...landscapeMockupUrlMap };
    let mergedLogoSourceMap = { ...logoSourceMap };

    if (existingSlot) {
      const existingUrls = [existingSlot.currentUrl, ...(existingSlot.alternatives || [])];
      const newUrlSet = new Set(transparentUrls);
      const oldUrls = existingUrls.filter(url => !newUrlSet.has(url));
      mergedAlternatives = [...mergedAlternatives, ...oldUrls];
      mergedSolidUrlMap = { ...(existingSlot.solidUrlMap || {}), ...solidUrlMap };
      mergedReversedUrlMap = { ...(existingSlot.reversedUrlMap || {}), ...reversedUrlMap };
      mergedReversedSolidUrlMap = { ...(existingSlot.reversedSolidUrlMap || {}), ...reversedSolidUrlMap };
      mergedMockupUrlMap = { ...(existingSlot.mockupUrlMap || {}), ...mockupUrlMap };
      mergedLandscapeMockupUrlMap = { ...(existingSlot.landscapeMockupUrlMap || {}), ...landscapeMockupUrlMap };
      mergedLogoSourceMap = { ...(existingSlot.logoSourceMap || {}), ...logoSourceMap };
    }

    const now = new Date().toISOString();

    await mediaManifestService.setSlot(appId, slotPath, {
      mediaType: 'logo',
      currentUrl: transparentUrls[0]!,
      searchQuery: existingSlot?.searchQuery || searchQuery,
      alternatives: mergedAlternatives,
      solidUrlMap: mergedSolidUrlMap,
      reversedUrlMap: mergedReversedUrlMap,
      reversedSolidUrlMap: mergedReversedSolidUrlMap,
      mockupUrlMap: mergedMockupUrlMap,
      landscapeMockupUrlMap: mergedLandscapeMockupUrlMap,
      logoSourceMap: mergedLogoSourceMap,
      userModified: false,
      createdAt: existingSlot?.createdAt || now,
      lastUpdated: now,
    });

    const slotUrl = `/airo-assets/images/${slotPath}`;
    savedSlots[layout] = slotUrl;

    logger.info(SLOT_SAVED_EVENTS[toolName], {
      appId,
      slotPath,
      layout,
      logoCount: logos.length,
      totalLogos: mergedAlternatives.length + 1,
    });
  }

  return { savedSlots };
}

/**
 * Build slot URL summary text for the agent.
 */
function buildSlotSummary(savedSlots: Record<string, string>): string {
  const entries = Object.entries(savedSlots);
  if (entries.length === 0) {
    return 'No slot URLs saved — logos are available via CDN URLs in the structured result.';
  }
  if (entries.length === 1) {
    const [layout, url] = entries[0]!;
    return `Slot URL: ${url} (transparent), ${url}?variant=solid (solid). Layout: ${layout}.`;
  }
  return 'Slot URLs: ' + entries.map(([layout, url]) => `${layout}: ${url}`).join(', ') +
    '. Append ?variant=solid for solid backgrounds. Use the orientation-specific slot URL matching the placement context.';
}

export const generateLogoTool: SkillToolDefinition = {
  name: 'generate_logo',
  description:
    'Generate professional logos for a business using AI. Automatically saves all generated logos into the media slot system. Returns slot URL for use in source code, plus logo preview data. Requires business name and description.',

  parameters: GenerateLogoInputSchema,

  async execute(input: GenerateLogoInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media-logo.tools.generate_logo.start', {
      brandName: input.brandName,
      variationCount: input.variations.length,
      appId,
    });

    if (!appId) {
      logger.error('skills.media-logo.tools.generate_logo.no_app_id');
      return { error: 'Unable to determine app id for logo generation' };
    }

    // 1. Get customer context from app database
    const app = appRepository.findById(appId);
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

    // 3. Enrich brand colors from app plan (used as fallback for variations without explicit colors)
    let enrichedBrandColors: string | undefined;

    if (appId) {
      try {
        const planResult = await appPlanTool.execute({ appId, operation: 'get' });
        const palette = planResult.data?.colorPalette;
        if (palette?.primary) {
          const parts = [`primary: ${palette.primary}`];
          if (palette.secondary) parts.push(`secondary: ${palette.secondary}`);
          if (palette.accent) parts.push(`accent: ${palette.accent}`);
          enrichedBrandColors = parts.join(', ');
        }
      } catch (e) {
        logger.warn('skills.media-logo.tools.generate_logo.enrich_colors_failed', {
          appId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 4. Call logo API — one call per variation, in parallel
    const variationResults = await Promise.allSettled(
      input.variations.map((variation) =>
        logoService.generateLogos({
          brandName: input.brandName,
          brandDescription: input.brandDescription,
          brandTagline: input.brandTagline,
          brandColors: variation.brandColors || enrichedBrandColors,
          brandPersonality: input.brandPersonality,
          brandAudience: input.brandAudience,
          style: variation.style,
          styleDescription: variation.styleDescription,
          symbol: variation.symbol,
          layout: input.layout,
          count: 1,
          appId,
          customerId,
          budgetUserId,
        })
      )
    );

    // Collect successful results — preserve per-logo sessionId for edit_logo auto-resolution
    const logos: ProcessedLogo[] = [];
    const logoSessionIds = new Map<string, string>();
    let sessionId = '';
    let variationFailureCount = 0;
    for (const r of variationResults) {
      if (r.status === 'fulfilled') {
        for (const logo of r.value.logos) {
          logos.push(logo);
          logoSessionIds.set(logo.id, r.value.sessionId);
        }
        if (!sessionId) sessionId = r.value.sessionId;
      } else {
        variationFailureCount += 1;
        logger.warn('skills.media-logo.tools.generate_logo.variation_failed', {
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }

    const budgetExhaustedRejection = variationResults.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected' && BudgetExceededError.isInstance(r.reason),
    );
    if (budgetExhaustedRejection) {
      logger.warn('skills.media-logo.tools.generate_logo.budget_exceeded', {
        appId,
        customerId,
        budgetUserId,
        successfulLogoCount: logos.length,
        failedVariationCount: variationFailureCount,
      });
      throw budgetExhaustedRejection.reason;
    }

    if (logos.length === 0) {
      return { text: 'All logo variations failed to generate. Please try again.' };
    }

    const result = { sessionId, logos };

    logger.info('skills.media-logo.tools.generate_logo.success', {
      brandName: input.brandName,
      sessionId: result.sessionId,
      logoCount: result.logos.length,
      variationsRequested: input.variations.length,
    });

    // 5. Auto-save logos to per-orientation slots
    let savedSlots: Record<string, string> = {};
    let slotSaveFailed = false;
    if (appId && result.logos.length > 0) {
      try {
        const saveResult = await saveLogosToSlots(appId, result.logos, result.sessionId, input.brandName, 'generate_logo', logoSessionIds);
        savedSlots = saveResult.savedSlots;
      } catch (e) {
        slotSaveFailed = true;
        logger.warn('skills.media-logo.tools.generate_logo.slot_save_failed', {
          appId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (Object.keys(savedSlots).length === 0 && result.logos.length > 0) {
      logger.warn('skills.media-logo.tools.generate_logo.no_slots_saved', {
        appId,
        logoCount: result.logos.length,
        sessionId: result.sessionId,
      });
    }

    // 6. Return structured result for the frontend + instructions for the agent
    const primaryLayout = savedSlots.square ? 'square' : savedSlots.horizontal ? 'horizontal' : savedSlots.vertical ? 'vertical' : 'square';
    const primarySlotPath = LOGO_SLOT_PATHS[primaryLayout as LogoLayout] ?? DEFAULT_LOGO_SLOT_PATH;
    const primarySlotUrl = savedSlots[primaryLayout] || `/airo-assets/images/${primarySlotPath}`;

    const failureNote = variationFailureCount > 0
      ? ` ${variationFailureCount} of ${input.variations.length} variations failed to generate — mention this to the user.`
      : '';
    const slotSaveNote = slotSaveFailed
      ? ' Slot save failed — the logo will not appear in the Brand Book until retried. Tell the user and offer to retry.'
      : '';

    return {
      text: `Generated ${result.logos.length} of ${input.variations.length} logos.${failureNote}${slotSaveNote} ${buildSlotSummary(savedSlots)} ` +
        `Logo 1 is set as the default. ` +
        `If the user's request includes placement (e.g. "add logo to header"), place the appropriate slot URL in source code now. ` +
        `Otherwise, present the logos and let the user decide — they can swap via the widget and ask you to place it later.`,
      structuredContent: {
        logos: result.logos,
        sessionId: result.sessionId,
        slotUrl: primarySlotUrl,
        slotPath: primarySlotPath,
        savedSlots,
        slotSaveFailed,
      },
    };
  },

  config: {
    timeout: 240_000,
  },
};

/**
 * Logo editing tool using direct REST API call via LogoService
 */
export const editLogoTool: SkillToolDefinition = {
  name: 'edit_logo',
  description:
    'Edit an existing generated logo using AI. Optionally provide sourceSessionId and sourceLogoId from a previous generate_logo result, ' +
    'or omit them to automatically edit the current saved logo from the slot system. ' +
    'Describe the changes you want (e.g., "Make it blue", "Remove the tagline", "Make the icon larger"). ' +
    'Returns new logo variants with transparent/solid/mockup versions, auto-saved to the slot system.',

  parameters: EditLogoInputSchema,

  async execute(input: EditLogoInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media-logo.tools.edit_logo.start', {
      sourceSessionId: input.sourceSessionId,
      sourceLogoId: input.sourceLogoId,
      promptLength: input.prompt.length,
      count: input.count,
      appId,
    });

    if (!appId) {
      logger.error('skills.media-logo.tools.edit_logo.no_app_id');
      return { error: 'Unable to determine app id for logo editing' };
    }

    // 1. Get customer context from app database
    const app = appRepository.findById(appId);
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media-logo.tools.edit_logo.no_customer', { appId });
      return { error: 'Unable to determine customer identity for logo editing' };
    }

    // 2. Get budget user from grant system (required — logo editing must be billed)
    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('skills.media-logo.tools.edit_logo.grants_exhausted', { appId, socketId, budgetUserId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to edit logos.' };
    }

    // 3. Resolve sourceSessionId/sourceLogoId from slot if not provided
    let { sourceSessionId, sourceLogoId } = input;

    if (!sourceSessionId || !sourceLogoId) {
      try {
        // Check all orientation slots for a logo with source tracking
        const slotPathsToCheck = Object.values(LOGO_SLOT_PATHS);
        const checked = new Set<string>();
        let resolved = false;
        let slotFoundButNoMetadata = false;

        for (const slotPath of slotPathsToCheck) {
          if (checked.has(slotPath)) continue;
          checked.add(slotPath);
          const slotResult = await mediaManifestService.getSlot(appId, slotPath);
          if (slotResult.success && slotResult.slot) {
            if (!slotResult.slot.logoSourceMap) {
              slotFoundButNoMetadata = true;
              continue;
            }
            const source = slotResult.slot.logoSourceMap[slotResult.slot.currentUrl];
            if (source) {
              sourceSessionId = source.sessionId;
              sourceLogoId = source.logoId;
              resolved = true;
              logger.info('skills.media-logo.tools.edit_logo.auto_resolved', {
                appId,
                sourceSessionId,
                sourceLogoId,
                slotPath,
                currentUrl: slotResult.slot.currentUrl,
              });
              break;
            }
          }
        }

        if (!resolved) {
          return {
            error: slotFoundButNoMetadata
              ? "Your existing logo doesn't have edit metadata. Regenerate it with media-logo__generate_logo first, then you can edit it."
              : 'No saved logo found to edit. Generate a logo first with media-logo__generate_logo, then edit it.',
          };
        }
      } catch (e) {
        logger.error('skills.media-logo.tools.edit_logo.auto_resolve_failed', {
          appId,
          error: e instanceof Error ? e.message : String(e),
        });
        return { error: 'Failed to look up the current logo. Provide sourceSessionId and sourceLogoId explicitly.' };
      }
    }

    // 4. Call logo edit API — sourceSessionId/sourceLogoId are guaranteed defined
    // (either provided by caller or resolved from slot above, with early returns on failure)
    const result = await logoService.editLogos({
      sourceSessionId: sourceSessionId!,
      sourceLogoId: sourceLogoId!,
      prompt: input.prompt,
      layout: input.layout,
      count: input.count,
      appId,
      customerId,
      budgetUserId,
    });

    logger.info('skills.media-logo.tools.edit_logo.success', {
      sourceSessionId,
      sessionId: result.sessionId,
      logoCount: result.logos.length,
    });

    // 5. Auto-save edited logos to per-orientation slots
    let savedSlots: Record<string, string> = {};
    if (appId && result.logos.length > 0) {
      try {
        const saveResult = await saveLogosToSlots(appId, result.logos, result.sessionId, 'edited logo', 'edit_logo');
        savedSlots = saveResult.savedSlots;
      } catch (e) {
        logger.warn('skills.media-logo.tools.edit_logo.slot_save_failed', {
          appId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (Object.keys(savedSlots).length === 0 && result.logos.length > 0) {
      logger.warn('skills.media-logo.tools.edit_logo.no_slots_saved', {
        appId,
        logoCount: result.logos.length,
        sessionId: result.sessionId,
      });
    }

    // 6. Return structured result for the frontend + instructions for the agent
    const primaryLayout = savedSlots.square ? 'square' : savedSlots.horizontal ? 'horizontal' : savedSlots.vertical ? 'vertical' : 'square';
    const primarySlotPath = LOGO_SLOT_PATHS[primaryLayout as LogoLayout] ?? DEFAULT_LOGO_SLOT_PATH;
    const primarySlotUrl = savedSlots[primaryLayout] || `/airo-assets/images/${primarySlotPath}`;

    return {
      text: `Edited logo and generated ${result.logos.length} variation(s). ${buildSlotSummary(savedSlots)} ` +
        `The edited logo is now the default in the slot. Previous logos are preserved as alternatives.`,
      structuredContent: {
        logos: result.logos,
        sessionId: result.sessionId,
        slotUrl: primarySlotUrl,
        slotPath: primarySlotPath,
        savedSlots,
      },
    };
  },

  config: {
    timeout: 240_000,
  },
};

// ============================================================================
// Offer Logo Actions Tool
// ============================================================================

/**
 * Passthrough tool that surfaces "Add to library" / "Set as logo" buttons
 * in the chat UI via LogoActionsToolRenderer. No server-side logic — the
 * renderer handles iframe detection and postMessage.
 */
export const offerLogoActionsTool: SkillToolDefinition = {
  name: 'offer_logo_actions',
  description:
    'Offer the user "Add to my library" and "Set as my logo" quick-action buttons for a generated logo. Call this after generate_logo or edit_logo with the transparent URL of the primary logo.',
  parameters: z.object({
    imageUrl: z.string().describe('The transparent logo image URL to offer actions for'),
  }),
  async execute(input) {
    return {
      text: '',
      structuredContent: { imageUrl: input.imageUrl },
    };
  },
};

// ============================================================================
// Set Venture Logo Tool
// ============================================================================

/**
 * Reads the current horizontal and square logo slot URLs and returns them so
 * the matching client renderer (SetVentureLogoToolRenderer) can post both
 * versions to the Venture Home iframe parent.
 *
 * Caller contract — see `agents/src/prompts/initial/templates/logo-designer/core.md`
 * ("Set as my logo" branch in Step 7). The prompt runs
 * `edit_logo({ layout: "square" })` immediately before this tool so the primary
 * slot reflects the user's currently-selected logo. Reordering that branch
 * without updating this comment will cause the tool to silently return stale
 * URLs.
 */
export const setVentureLogoTool: SkillToolDefinition = {
  name: 'set_venture_logo',
  description:
    'Sends the current horizontal and square logos to the Venture Home dashboard via the chat-side renderer. ' +
    'Call this only after edit_logo has produced a fresh square version. No arguments required.',
  parameters: z.object({}),
  async execute(_input, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;

    if (!appId) {
      logger.error('skills.media-logo.tools.set_venture_logo.no_app_id');
      return { error: 'Unable to determine app id for set_venture_logo' };
    }

    logger.info('skills.media-logo.tools.set_venture_logo.start', { appId });

    let horizontalResult: Awaited<ReturnType<typeof mediaManifestService.getSlot>>;
    let squareResult: Awaited<ReturnType<typeof mediaManifestService.getSlot>>;
    try {
      [horizontalResult, squareResult] = await Promise.all([
        mediaManifestService.getSlot(appId, LOGO_SLOT_PATHS.horizontal),
        mediaManifestService.getSlot(appId, LOGO_SLOT_PATHS.square),
      ]);
    } catch (e) {
      logger.error('skills.media-logo.tools.set_venture_logo.slot_lookup_failed', {
        appId,
        error: e instanceof Error ? e.message : String(e),
      });
      return { error: 'Failed to look up the current logos. Please try again.' };
    }

    const horizontalUrl = horizontalResult.success ? horizontalResult.slot?.currentUrl : undefined;
    const squareUrl = squareResult.success ? squareResult.slot?.currentUrl : undefined;

    if (!horizontalUrl || !squareUrl) {
      logger.warn('skills.media-logo.tools.set_venture_logo.slot_missing', {
        appId,
        hasHorizontal: !!horizontalUrl,
        hasSquare: !!squareUrl,
      });
      return {
        error:
          'Could not find both horizontal and square logos. Generate a logo first, then run edit_logo with layout: "square".',
      };
    }

    logger.info('skills.media-logo.tools.set_venture_logo.success', {
      appId,
      hasHorizontal: true,
      hasSquare: true,
    });

    return {
      text: 'Sent horizontal and square logos to the venture dashboard.',
      structuredContent: { horizontalUrl, squareUrl },
    };
  },
};

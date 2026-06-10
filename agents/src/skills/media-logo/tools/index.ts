/**
 * media-logo — prompt-based logo generation skill tool.
 *
 * One tool, one call: `generate_logo({ prompt, layout, referenceUrl? })`.
 * The agent owns the prompt; the tool injects the brand color palette as a
 * deterministic suffix so the agent doesn't have to repeat hex codes (saves
 * tokens and avoids hallucination).
 *
 * Edit and generate collapse into one call: pass `referenceUrl` to seed the
 * generation, omit it for from-scratch. When the agent omits it but the user
 * is iterating on the saved logo, the tool auto-resolves `referenceUrl` from
 * the current slot.
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { grantSessionManager } from '@airo/ai-grants';
import { BudgetExceededError } from '@airo/ai-common';

import { logger } from '../../../logging/index.js';
import { appRepository } from '../../../database/repositories/index.js';
import { appPlanTool } from '../../../tools/app-plan-tool.js';
import { mediaManifestService } from '../../../services/MediaManifestService.js';
import { getKvMemoryStore } from '../../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../../memory/interfaces/scope.js';
import {
  logoService,
  type LogoLayout,
  type LayoutUrls,
  type LogoColors,
  type LogoSessionResponse,
} from '../../../services/LogoService.js';

const PROMPT_HARD_MAX = 2000;
const PROMPT_SCHEMA_MAX = 1800; // leaves ~200 chars for the palette suffix

const ToolLayoutSchema = z.enum(['square', 'horizontal', 'vertical', 'all']);
type ToolLayout = z.infer<typeof ToolLayoutSchema>;

const GenerateLogoInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(PROMPT_SCHEMA_MAX)
    .describe(
      'Complete description of the logo you want, in plain English. ' +
        'Include subject, style, mood, and composition. The tool appends ' +
        'the brand color palette automatically — do not list hex values. ' +
        'Example: "A minimalist line-art glyph of a coffee cup with a ' +
        'sunrise behind it, monoline strokes, generous padding."',
    ),
  layout: ToolLayoutSchema.default('horizontal').describe(
    'Logo orientation. square (1024x1024 — favicon, app icon), ' +
      'horizontal (1536x1024, default — header, navbar), ' +
      'vertical (1024x1536 — sidebar, hero), or all (generates all three).',
  ),
  referenceUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional reference image URL. Pass when the user uploaded an inspiration " +
        "image to chat — use the upload's signed URL visible in conversation context. " +
        'Omit when iterating on the existing saved logo; the tool resolves the ' +
        'current slot URL automatically.',
    ),
});

type GenerateLogoInput = z.infer<typeof GenerateLogoInputSchema>;

type LogoSlotLayout = LogoLayout;

const LOGO_SLOT_PATHS: Record<LogoSlotLayout, string> = {
  square: 'logo/primary',
  horizontal: 'logo/horizontal',
  vertical: 'logo/vertical',
};

const ALL_LAYOUTS: readonly LogoLayout[] = ['square', 'horizontal', 'vertical'] as const;

/** Five core palette tokens we surface to the model. */
type CorePaletteKey = 'primary' | 'secondary' | 'accent' | 'background' | 'foreground';
const CORE_PALETTE_KEYS: readonly CorePaletteKey[] = [
  'primary',
  'secondary',
  'accent',
  'background',
  'foreground',
] as const;

/**
 * Read the color palette from the most authoritative source we have.
 * Returns the subset of core tokens that are actually populated; missing
 * tokens are skipped (no placeholders, no hallucinated hex values).
 */
async function readPalette(appId: string): Promise<Partial<Record<CorePaletteKey, string>>> {
  // 1. App plan tool (hex strings keyed directly by `primary`/`secondary`/...)
  try {
    const plan = await appPlanTool.execute({ appId, operation: 'get' });
    const palette = plan.data?.colorPalette;
    if (palette) {
      const out: Partial<Record<CorePaletteKey, string>> = {};
      for (const k of CORE_PALETTE_KEYS) {
        const v = palette[k];
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
      }
      if (Object.keys(out).length > 0) return out;
    }
  } catch (err) {
    logger.warn('skill.media-logo.palette.app_plan_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Memory key `brand.colors.palette` (object shape `{ primary: { value }, ... }`)
  try {
    const scope = workspaceScopeFromAppId(appId);
    const result = await getKvMemoryStore().get(scope, 'brand.colors.palette');
    if (result.success && result.exists && result.value && typeof result.value === 'object') {
      const palette = result.value as Record<string, unknown>;
      const out: Partial<Record<CorePaletteKey, string>> = {};
      for (const k of CORE_PALETTE_KEYS) {
        const slot = palette[k];
        if (slot && typeof slot === 'object' && 'value' in slot) {
          const v = (slot as { value?: unknown }).value;
          if (typeof v === 'string' && v.trim()) out[k] = v.trim();
        } else if (typeof slot === 'string' && slot.trim()) {
          out[k] = slot.trim();
        }
      }
      if (Object.keys(out).length > 0) return out;
    }
  } catch (err) {
    logger.warn('skill.media-logo.palette.memory_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {};
}

function buildPaletteSuffix(palette: Partial<Record<CorePaletteKey, string>>): string {
  const parts: string[] = [];
  for (const k of CORE_PALETTE_KEYS) {
    const v = palette[k];
    if (v) parts.push(`${k} ${v}`);
  }
  if (parts.length === 0) return '';
  return ` Brand colors: ${parts.join(', ')}.`;
}

/**
 * Color roles sent to the logo API as structured params. `background` is the
 * surface the logo lands on (header/footer use `bg-background`); the rest are
 * brand colors to harmonize with. `foreground` is intentionally excluded — the
 * logo's reversed/solid variants handle light/dark polarity, so the exact
 * background hex is the only contrast signal the API needs.
 */
const STRUCTURED_COLOR_KEYS: readonly (keyof LogoColors)[] = [
  'primary',
  'secondary',
  'accent',
  'background',
] as const;

/**
 * Build the structured `colors` payload from the resolved palette. Sends
 * whatever is populated (send-if-present) and returns undefined when none of
 * the roles resolved, so the caller can omit the field entirely.
 */
function buildLogoColors(
  palette: Partial<Record<CorePaletteKey, string>>,
): LogoColors | undefined {
  const out: LogoColors = {};
  for (const k of STRUCTURED_COLOR_KEYS) {
    const v = palette[k];
    if (v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function assembleFinalPrompt(agentPrompt: string, suffix: string, appId: string): string {
  if (!suffix) return agentPrompt;
  const combined = agentPrompt + suffix;
  if (combined.length <= PROMPT_HARD_MAX) return combined;

  // Suffix would push past the hard cap — drop it rather than truncate the
  // suffix mid-sentence (clamp would leave broken hex codes).
  logger.warn('skill.media-logo.prompt_truncated', {
    appId,
    agentPromptLength: agentPrompt.length,
    suffixLength: suffix.length,
    note: 'palette suffix dropped to keep prompt under 2000 chars',
  });
  return agentPrompt;
}

function expandLayouts(input: ToolLayout): LogoLayout[] {
  if (input === 'all') return [...ALL_LAYOUTS];
  return [input];
}

interface ResolvedReference {
  /** The reference URL to seed generation from, if one was found. */
  url: string | undefined;
  /**
   * True when a saved logo slot exists but no usable reference could be
   * resolved from it. Distinguishes "iterate-but-couldn't" (a real anomaly
   * worth surfacing) from a clean first-time generation (no slot at all).
   */
  existingSlotWithoutReference: boolean;
}

async function resolveReferenceUrl(
  appId: string,
  callerProvided: string | undefined,
  layouts: LogoLayout[],
): Promise<ResolvedReference> {
  if (callerProvided) return { url: callerProvided, existingSlotWithoutReference: false };

  // Auto-resolve from the slot. Prefer a slot matching one of the requested
  // layouts; otherwise fall back across the other orientations so an edit that
  // targets a layout the user hasn't generated yet can still seed from the logo
  // they already have. Horizontal is the canonical user logo (the default
  // layout and what the logo-designer flow generates first), so it leads the
  // fallback — this is what lets "Set as my logo" reformat the existing
  // horizontal logo into a square companion when no square slot exists yet.
  const candidatePaths = [
    ...layouts.map((l) => LOGO_SLOT_PATHS[l]),
    LOGO_SLOT_PATHS.horizontal,
    LOGO_SLOT_PATHS.square,
    LOGO_SLOT_PATHS.vertical,
  ];
  const seen = new Set<string>();
  let sawSlot = false;
  for (const path of candidatePaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      const r = await mediaManifestService.getSlot(appId, path);
      if (!r.success || !r.slot) continue;
      sawSlot = true;
      const sourceMap = r.slot.logoSourceMap;
      if (!sourceMap) continue;
      const source = sourceMap[r.slot.currentUrl];
      if (source) {
        logger.info('skill.media-logo.reference.slot_resolved', {
          appId,
          slotPath: path,
          currentUrl: r.slot.currentUrl,
        });
        return { url: r.slot.currentUrl, existingSlotWithoutReference: false };
      }
      logger.info('skill.media-logo.reference.slot_no_source', { appId, slotPath: path });
    } catch (err) {
      logger.warn('skill.media-logo.reference.slot_lookup_failed', {
        appId,
        slotPath: path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { url: undefined, existingSlotWithoutReference: sawSlot };
}

interface SaveSlotsResult {
  savedSlots: Partial<Record<LogoLayout, string>>;
  slotSaveFailed: boolean;
  failedLayouts: LogoLayout[];
}

async function saveLogoToSlots(
  appId: string,
  response: LogoSessionResponse,
  searchQuery: string,
): Promise<SaveSlotsResult> {
  const savedSlots: Partial<Record<LogoLayout, string>> = {};
  const failedLayouts: LogoLayout[] = [];
  const now = new Date().toISOString();

  for (const layout of ALL_LAYOUTS) {
    const variants: LayoutUrls | undefined = response.logo.urls[layout];
    if (!variants) continue;

    const slotPath = LOGO_SLOT_PATHS[layout];
    const transparent = variants.transparent;

    const solidUrlMap = { [transparent]: variants.solid };
    const reversedUrlMap = { [transparent]: variants.reversed };
    const reversedSolidUrlMap = { [transparent]: variants.reversedSolid };
    const mockupUrlMap = { [transparent]: variants.mockup };
    const landscapeMockupUrlMap = { [transparent]: variants.landscapeMockup };
    const logoSourceMap = {
      [transparent]: { sessionId: response.sessionId, logoId: response.logo.id },
    };

    let mergedAlternatives: string[] = [];
    let mergedSolidUrlMap = { ...solidUrlMap };
    let mergedReversedUrlMap = { ...reversedUrlMap };
    let mergedReversedSolidUrlMap = { ...reversedSolidUrlMap };
    let mergedMockupUrlMap = { ...mockupUrlMap };
    let mergedLandscapeMockupUrlMap = { ...landscapeMockupUrlMap };
    let mergedLogoSourceMap = { ...logoSourceMap };
    let createdAt = now;

    try {
      const existing = await mediaManifestService.getSlot(appId, slotPath);
      if (existing.success && existing.slot) {
        const old = existing.slot;
        const oldUrls = [old.currentUrl, ...(old.alternatives ?? [])].filter(
          (u) => u && u !== transparent,
        );
        mergedAlternatives = oldUrls;
        mergedSolidUrlMap = { ...(old.solidUrlMap ?? {}), ...solidUrlMap };
        mergedReversedUrlMap = { ...(old.reversedUrlMap ?? {}), ...reversedUrlMap };
        mergedReversedSolidUrlMap = { ...(old.reversedSolidUrlMap ?? {}), ...reversedSolidUrlMap };
        mergedMockupUrlMap = { ...(old.mockupUrlMap ?? {}), ...mockupUrlMap };
        mergedLandscapeMockupUrlMap = {
          ...(old.landscapeMockupUrlMap ?? {}),
          ...landscapeMockupUrlMap,
        };
        mergedLogoSourceMap = { ...(old.logoSourceMap ?? {}), ...logoSourceMap };
        createdAt = old.createdAt || now;
      }

      await mediaManifestService.setSlot(appId, slotPath, {
        mediaType: 'logo',
        currentUrl: transparent,
        searchQuery,
        alternatives: mergedAlternatives,
        solidUrlMap: mergedSolidUrlMap,
        reversedUrlMap: mergedReversedUrlMap,
        reversedSolidUrlMap: mergedReversedSolidUrlMap,
        mockupUrlMap: mergedMockupUrlMap,
        landscapeMockupUrlMap: mergedLandscapeMockupUrlMap,
        logoSourceMap: mergedLogoSourceMap,
        userModified: false,
        createdAt,
        lastUpdated: now,
      });

      savedSlots[layout] = `/airo-assets/images/${slotPath}`;
      logger.info('skill.media-logo.slot_saved', {
        appId, slotPath, layout, sessionId: response.sessionId,
      });
    } catch (err) {
      failedLayouts.push(layout);
      logger.error('skill.media-logo.slot_save_failed', {
        appId,
        slotPath,
        layout,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { savedSlots, slotSaveFailed: failedLayouts.length > 0, failedLayouts };
}

function buildResultText(args: {
  /** Layouts actually produced by the API (not merely requested). */
  producedLayouts: LogoLayout[];
  savedSlots: Partial<Record<LogoLayout, string>>;
  failedLayouts: LogoLayout[];
  /**
   * True when the caller omitted `referenceUrl`, a saved logo existed, but no
   * usable reference could be resolved — i.e. an intended edit silently became
   * a fresh design. Lets the agent tell the user it's a new logo, not a tweak.
   */
  generatedFromScratchDespiteExisting: boolean;
}): string {
  const count = args.producedLayouts.length;
  const slotEntries = Object.entries(args.savedSlots);
  const slotNote = slotEntries.length === 0
    ? 'No slot URLs saved.'
    : slotEntries.length === 1
      ? `Slot URL: ${slotEntries[0]![1]} (transparent).`
      : 'Slot URLs: ' +
        slotEntries.map(([l, u]) => `${l}: ${u}`).join(', ') +
        '. Use the orientation matching the placement.';

  const failureNote = args.failedLayouts.length > 0
    ? ` Slot save failed for: ${args.failedLayouts.join(', ')} — ${args.failedLayouts.length > 1 ? 'those layouts' : 'that layout'} will not appear in the Brand Book until retried. Tell the user and offer to retry.`
    : '';

  const fromScratchNote = args.generatedFromScratchDespiteExisting
    ? ' Note: no usable reference was found for the existing logo, so this is a brand-new design rather than an edit of the current one — let the user know if they expected a tweak.'
    : '';

  return (
    `Generated logo${count > 1 ? 's' : ''} for ${count} layout` +
    `${count > 1 ? 's' : ''}.${failureNote}${fromScratchNote} ${slotNote} ` +
    "If the user's request includes a placement (e.g. \"add it to the header\"), place the appropriate slot URL in source code now. " +
    'Otherwise, present the result and let the user decide — they can ask you to place it later.'
  );
}

export const generateLogoTool: SkillToolDefinition = {
  name: 'generate_logo',
  description:
    'Generate a logo from a prompt. Pass `referenceUrl` to seed from an uploaded image; ' +
    'omit it to iterate on the saved logo (auto-resolved from the slot). ' +
    'The tool appends the brand color palette to your prompt automatically — ' +
    'do not list hex values yourself. One layout per call (or `all` for the full kit).',

  parameters: GenerateLogoInputSchema,

  async execute(input: GenerateLogoInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skill.media-logo.generate_logo.start', {
      appId,
      layout: input.layout,
      promptLength: input.prompt.length,
      hasReference: Boolean(input.referenceUrl),
    });

    if (!appId) {
      logger.error('skill.media-logo.generate_logo.no_app_id');
      return { error: 'Unable to determine app id for logo generation' };
    }

    // AAB-only: the `apps` table (and thus customerId) may not exist for PaaS.
    // Logo generation is currently an AAB feature, so a missing record is a
    // hard error rather than a fallback.
    const app = appRepository.findById(appId);
    const customerId = app?.customerId;
    if (!customerId) {
      logger.error('skill.media-logo.generate_logo.no_customer', { appId });
      return { error: 'Unable to determine customer identity for logo generation' };
    }

    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;
    if (!budgetUserId) {
      logger.error('skill.media-logo.generate_logo.grants_exhausted', {
        appId, socketId, customerId,
      });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to generate logos.' };
    }

    if (input.referenceUrl && !input.referenceUrl.startsWith('https://')) {
      return { error: 'referenceUrl must use https' };
    }

    const palette = await readPalette(appId);
    const suffix = buildPaletteSuffix(palette);
    const finalPrompt = assembleFinalPrompt(input.prompt, suffix, appId);

    // Structured brand colors, gated by the `appbuilder-logo-brand-colors`
    // switchboard flag (surfaced on context.metadata via the agent JWT; default
    // off) until the logo API accepts them. The prose suffix above is unaffected
    // and remains the functional path. Send-if-present: omitted when nothing
    // resolved.
    const logoBrandColorsEnabled =
      (context as { metadata?: { logoBrandColorsEnabled?: boolean } })?.metadata
        ?.logoBrandColorsEnabled === true;
    const colors = logoBrandColorsEnabled ? buildLogoColors(palette) : undefined;
    if (colors) {
      logger.info('skill.media-logo.colors.resolved', {
        appId,
        keys: Object.keys(colors),
        hasBackground: Boolean(colors.background),
      });
    }

    const layouts = expandLayouts(input.layout);
    const reference = await resolveReferenceUrl(appId, input.referenceUrl, layouts);
    const referenceUrl = reference.url;

    // The caller omitted a reference and we couldn't resolve one from an
    // existing slot — an intended "make it blue"-style edit will produce a
    // fresh design instead. Surface it so it isn't silently misleading.
    const generatedFromScratchDespiteExisting =
      !input.referenceUrl && referenceUrl === undefined && reference.existingSlotWithoutReference;
    if (generatedFromScratchDespiteExisting) {
      logger.warn('skill.media-logo.reference.unresolved_with_existing_slot', {
        appId,
        layout: input.layout,
      });
    }

    let response: LogoSessionResponse;
    try {
      response = await logoService.generate({
        prompt: finalPrompt,
        layout: layouts,
        ...(referenceUrl !== undefined && { referenceUrl }),
        ...(colors && { colors }),
        appId,
        customerId,
        budgetUserId,
      });
    } catch (err) {
      if (BudgetExceededError.isInstance(err)) throw err;
      logger.error('skill.media-logo.generate_logo.error', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { error: err instanceof Error ? err.message : 'Logo generation failed' };
    }

    const { savedSlots, slotSaveFailed, failedLayouts } = await saveLogoToSlots(
      appId,
      response,
      input.prompt.slice(0, 80),
    );

    const producedLayouts = Object.keys(response.logo.urls) as LogoLayout[];

    const layoutKeys = Object.keys(savedSlots) as LogoLayout[];
    const primaryLayout: LogoLayout =
      layoutKeys.includes('square') ? 'square'
      : layoutKeys.includes('horizontal') ? 'horizontal'
      : layoutKeys.includes('vertical') ? 'vertical'
      : layouts[0]!;
    const primarySlotPath = LOGO_SLOT_PATHS[primaryLayout];
    const primarySlotUrl = savedSlots[primaryLayout] ?? `/airo-assets/images/${primarySlotPath}`;

    const text = buildResultText({
      producedLayouts,
      savedSlots,
      failedLayouts,
      generatedFromScratchDespiteExisting,
    });

    return {
      text,
      structuredContent: {
        logo: response.logo,
        sessionId: response.sessionId,
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
 * Pushes the current horizontal + square logo slot URLs to the Venture
 * Home dashboard via the chat-side renderer. Used by the logo-designer
 * template's "Set as my logo" branch after a fresh square generate_logo call.
 */
export const setVentureLogoTool: SkillToolDefinition = {
  name: 'set_venture_logo',
  description:
    'Sends the current horizontal and square logos to the Venture Home dashboard via the chat-side renderer. ' +
    'Call this only after generate_logo has produced a fresh square version. No arguments required.',
  parameters: z.object({}),
  async execute(_input, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;

    if (!appId) {
      logger.error('skill.media-logo.set_venture_logo.no_app_id');
      return { error: 'Unable to determine app id for set_venture_logo' };
    }

    logger.info('skill.media-logo.set_venture_logo.start', { appId });

    let horizontalResult: Awaited<ReturnType<typeof mediaManifestService.getSlot>>;
    let squareResult: Awaited<ReturnType<typeof mediaManifestService.getSlot>>;
    try {
      [horizontalResult, squareResult] = await Promise.all([
        mediaManifestService.getSlot(appId, LOGO_SLOT_PATHS.horizontal),
        mediaManifestService.getSlot(appId, LOGO_SLOT_PATHS.square),
      ]);
    } catch (e) {
      logger.error('skill.media-logo.set_venture_logo.slot_lookup_failed', {
        appId,
        error: e instanceof Error ? e.message : String(e),
      });
      return { error: 'Failed to look up the current logos. Please try again.' };
    }

    const horizontalUrl = horizontalResult.success ? horizontalResult.slot?.currentUrl : undefined;
    const squareUrl = squareResult.success ? squareResult.slot?.currentUrl : undefined;

    if (!horizontalUrl || !squareUrl) {
      logger.warn('skill.media-logo.set_venture_logo.slot_missing', {
        appId,
        hasHorizontal: !!horizontalUrl,
        hasSquare: !!squareUrl,
      });
      return {
        error:
          'Could not find both horizontal and square logos. Generate a logo first, then run generate_logo with layout: "square".',
      };
    }

    logger.info('skill.media-logo.set_venture_logo.success', {
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

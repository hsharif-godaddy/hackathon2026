/**
 * media-logo — prompt-based logo generation skill tools.
 *
 * Two tools:
 *   - `generate_logo({ prompt, layout })` — create a logo from scratch,
 *     optionally influenced by uploaded inspiration images (auto-resolved from context).
 *   - `edit_logo({ prompt, layout })` — modify the existing saved logo;
 *     the tool auto-resolves the current slot URL as the base reference.
 *
 * Both tools inject the brand color palette as a deterministic prompt suffix so
 * the agent doesn't have to repeat hex codes (saves tokens and avoids hallucination).
 *
 * Inspiration images are never passed as tool inputs (LLMs hallucinate URLs).
 * Instead, both tools resolve uploaded images from the message's context
 * attachments (`selected_assets` with `sourceType: 'upload'`).
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { grantSessionManager } from '@airo/ai-grants';
import { BudgetExceededError } from '@airo/ai-common';
import { getCurrentTraceIds, type BackgroundTaskRegistry, type BackgroundTaskOutcome } from '@airo/ai-transport';

import { logger } from '../../../logging/index.js';
import { appRepository } from '../../../database/repositories/index.js';
import { appPlanTool } from '../../../tools/app-plan-tool.js';
import { mediaManifestService } from '../../../services/MediaManifestService.js';
import { getKvMemoryStore } from '../../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../../memory/interfaces/scope.js';
import { LOGO_SLOT_PATHS, FAVICON_SLOT_PATH, ALL_LAYOUTS } from '../../../services/logo/logo-slots.js';
import { logoGenerationService, type LogoRunOutcome } from '../../../services/logo/LogoGenerationService.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { readLogoJob } from '../../../services/logo/logo-job-state.js';
import {
  type LogoLayout,
  type LogoVariant,
  type LogoColors,
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
  background: z
    .boolean()
    .default(true)
    .describe(
      'Run generation in the background (default true): the tool returns immediately with ' +
        'animated placeholder slots that update when the logo is ready — use this when you ' +
        'can keep working or end your turn without needing the finished logo. ' +
        'Set false to generate synchronously and WAIT for the finished logo before the tool ' +
        'returns — required when your very next step depends on the logo being done (e.g. you ' +
        'will immediately ask the user about it or act on it in the same flow).',
    ),
  followUpVariants: z
    .array(z.enum(['favicon', 'square', 'horizontal', 'vertical']))
    .optional()
    .describe(
      'Additional variants to derive after this logo finishes generating. ' +
        'Populated sibling slots are always re-derived automatically; use this ' +
        "to request variants that don't exist yet (e.g. favicon on first generation).",
    ),
});

type GenerateLogoInput = z.infer<typeof GenerateLogoInputSchema>;

const EditLogoInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(PROMPT_SCHEMA_MAX)
    .describe(
      'Description of the change to make to the existing logo. Be specific about what to modify and what to keep.',
    ),
  layout: ToolLayoutSchema.default('horizontal').describe(
    'Logo orientation. square (1024x1024 — favicon, app icon), ' +
      'horizontal (1536x1024, default — header, navbar), ' +
      'vertical (1024x1536 — sidebar, hero), or all (generates all three).',
  ),
  background: z
    .boolean()
    .default(true)
    .describe(
      'Run generation in the background (default true): the tool returns immediately with ' +
        'animated placeholder slots that update when the logo is ready — use this when you ' +
        'can keep working or end your turn without needing the finished logo. ' +
        'Set false to generate synchronously and WAIT for the finished logo before the tool ' +
        'returns — required when your very next step depends on the logo being done (e.g. you ' +
        'will immediately ask the user about it or act on it in the same flow).',
    ),
  followUpVariants: z
    .array(z.enum(['favicon', 'square', 'horizontal', 'vertical']))
    .optional()
    .describe(
      'Additional variants to derive after this logo finishes generating. ' +
        'Populated sibling slots are always re-derived automatically; use this ' +
        "to request variants that don't exist yet (e.g. favicon on first generation).",
    ),
});

type EditLogoInput = z.infer<typeof EditLogoInputSchema>;

interface SelectedAssetData {
  mediaType: string;
  sourceType: string;
  imageUrl: string;
}

/**
 * Extract uploaded image URLs from context attachments. Avoids requiring the
 * LLM to pass URLs as tool inputs (prevents hallucination).
 */
function resolveInspirationFromContext(context: unknown): string[] {
  const contextAttachments = (context as { contextAttachments?: Array<{ type: string; data: unknown }> })?.contextAttachments;
  if (!contextAttachments) return [];
  const selectedAssets = contextAttachments.find((att) => att.type === 'selected_assets');
  if (!selectedAssets) return [];
  const assets = selectedAssets.data as SelectedAssetData[] | undefined;
  if (!Array.isArray(assets)) return [];
  return assets
    .filter((a) => a.sourceType === 'upload' && a.mediaType === 'IMAGE' && a.imageUrl?.startsWith('https://'))
    .map((a) => a.imageUrl);
}

/**
 * Auto-detect populated sibling logo slots that should be re-derived after a
 * new logo finishes. Merges with any explicit followUpVariants from the LLM.
 */
async function resolveFollowUpVariants(
  appId: string,
  generatingLayouts: LogoLayout[],
  explicitVariants: LogoVariant[] | undefined,
): Promise<LogoVariant[]> {
  const variants: Set<LogoVariant> = new Set(explicitVariants ?? [])
  const generatingSlots: Set<string> = new Set(generatingLayouts.map((l) => LOGO_SLOT_PATHS[l]))

  const candidates: Array<[LogoVariant, string]> = [
    ['square', LOGO_SLOT_PATHS.square],
    ['horizontal', LOGO_SLOT_PATHS.horizontal],
    ['vertical', LOGO_SLOT_PATHS.vertical],
    ['favicon', FAVICON_SLOT_PATH],
  ]
  for (const [variant, slotPath] of candidates) {
    if (generatingSlots.has(slotPath)) continue
    if (variants.has(variant)) continue
    try {
      const r = await mediaManifestService.getSlot(appId, slotPath)
      if (r.success && r.slot?.currentUrl && r.slot.logoSourceMap?.[r.slot.currentUrl]) {
        variants.add(variant)
      }
    } catch (err) {
      logger.warn('skill.media-logo.followUp.slot_lookup_failed', {
        appId, slotPath, error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return [...variants]
}

/** Five core palette tokens we surface to the model. */
type CorePaletteKey = 'primary' | 'secondary' | 'accent' | 'background' | 'foreground';
const CORE_PALETTE_KEYS: readonly CorePaletteKey[] = [
  'primary',
  'secondary',
  'accent',
  'background',
  'foreground',
] as const;

interface BrandContext {
  palette: Partial<Record<CorePaletteKey, string>>;
  brandName: string | undefined;
}

/**
 * Read brand context (palette + name) from the most authoritative source.
 * Palette tokens that are missing are skipped (no placeholders).
 * `brandName` comes from the app plan's `appName` — used as the S3 slug
 * by the logo API so file keys are human-readable.
 */
async function readBrandContext(appId: string): Promise<BrandContext> {
  let brandName: string | undefined;

  // 1. App plan tool (hex strings keyed directly by `primary`/`secondary`/...)
  try {
    const plan = await appPlanTool.execute({ appId, operation: 'get' });
    brandName = typeof plan.data?.appName === 'string' ? plan.data.appName.trim() || undefined : undefined;
    const palette = plan.data?.colorPalette;
    if (palette) {
      const out: Partial<Record<CorePaletteKey, string>> = {};
      for (const k of CORE_PALETTE_KEYS) {
        const v = palette[k];
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
      }
      if (Object.keys(out).length > 0) return { palette: out, brandName };
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
      if (Object.keys(out).length > 0) return { palette: out, brandName };
    }
  } catch (err) {
    logger.warn('skill.media-logo.palette.memory_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { palette: {}, brandName };
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
 * brand colors to harmonize with. `foreground` is intentionally excluded —
 * the background hex is the only contrast signal the API needs.
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
  layouts: LogoLayout[],
): Promise<ResolvedReference> {
  // Auto-resolve from the slot. Prefer a slot matching one of the requested
  // layouts; otherwise fall back across the other orientations so an edit that
  // targets a layout the user hasn't generated yet can still seed from the logo
  // they already have. Horizontal is the canonical user logo (the default
  // layout and what the logo-designer flow generates first), so it leads the
  // fallback — this is what lets edit_logo reformat the existing horizontal
  // logo into a square companion when no square slot exists yet.
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

/** Shared toModelOutput projection for both generate_logo and edit_logo. */
function toLogoModelOutput({ output }: { output?: unknown }): { type: 'text'; value: string } {
  const o = (output ?? {}) as Record<string, unknown>;
  if (o.error) return { type: 'text', value: JSON.stringify({ error: o.error }) };

  const sc = (o.structuredContent ?? {}) as Record<string, unknown>;
  const lean: Record<string, unknown> = {
    ...(o.text ? { text: o.text } : {}),
    status: sc.status,
    slots: sc.slots,
    slotSaveFailed: Boolean(sc.slotSaveFailed),
    ...(Array.isArray(sc.failedLayouts) && sc.failedLayouts.length ? { failedLayouts: sc.failedLayouts } : {}),
    ...(Array.isArray(sc.skippedLayouts) && sc.skippedLayouts.length ? { skippedLayouts: sc.skippedLayouts } : {}),
  };
  return { type: 'text', value: JSON.stringify(lean) };
}

/** Extract the per-turn background task registry from tool context (present only when switchboard flag is on). */
function getBackgroundTaskRegistry(context: unknown): BackgroundTaskRegistry | undefined {
  return (context as { metadata?: { __backgroundTaskRegistry?: BackgroundTaskRegistry } })?.metadata?.__backgroundTaskRegistry;
}

/** Register a background logo task on the per-turn registry so the agent loop
 *  awaits its outcome before finalizing. */
function registerBackgroundTask(
  registry: BackgroundTaskRegistry,
  result: { jobId?: string; slots?: string[]; done?: Promise<LogoRunOutcome> },
  toolName: string,
): void {
  if (!result.done || !result.jobId) return;
  const jobId: string = result.jobId;
  const slots: string[] = result.slots ?? [];
  registry.register({
    taskId: jobId,
    toolName,
    timeoutMs: 240_000,
    done: result.done.then((outcome): BackgroundTaskOutcome => {
      if (outcome.status === 'completed') {
        return {
          status: 'completed',
          taskId: jobId,
          toolName,
          result: {
            slots,
            logoId: outcome.logoId,
            slotSaveFailed: outcome.slotSaveFailed,
            skippedLayouts: outcome.skippedLayouts,
          },
        };
      }
      return {
        status: 'failed',
        taskId: jobId,
        toolName,
        error: outcome.status === 'cancelled'
          ? 'Logo generation was cancelled.'
          : outcome.status === 'superseded'
            ? 'Logo generation was superseded by a newer request.'
            : outcome.status === 'failed'
              ? outcome.error ?? 'Logo generation failed.'
              : 'Logo generation failed.',
      };
    }),
  });
}

/** Shared synchronous/background result handler for both generate_logo and edit_logo. */
async function handleLogoResult(
  result: Awaited<ReturnType<typeof logoGenerationService.start>>,
  input: { background: boolean },
  layouts: LogoLayout[],
  logPrefix: string,
  appId: string,
): Promise<Record<string, unknown>> {
  if (result.status === 'error') {
    return { error: result.error ?? 'Logo generation could not be started' };
  }

  // Synchronous mode: wait for the background run to settle, then report THIS
  // job's outcome (resolved through `done`, not re-read from the per-app job
  // file — which could describe a newer job after a supersede). Used when the
  // caller's next step depends on the finished logo (the logo-designer flow
  // asks the user about it immediately after).
  if (input.background === false) {
    const outcome = await result.done;
    if (outcome?.status === 'completed') {
      const skippedLayouts: string[] = outcome.skippedLayouts ?? [];
      const hasSkipped: boolean = skippedLayouts.length > 0;
      // Every requested layout was left untouched because the user had manually
      // overridden those slots (save-time userModified guard) — the new logo was
      // generated but NOT applied. Tell the model so it doesn't claim the new logo
      // is live over the user's custom one.
      const allKept: boolean = hasSkipped && skippedLayouts.length === layouts.length;
      logger.info(`${logPrefix}.completed_sync`, {
        appId, jobId: result.jobId, slots: result.slots,
        slotSaveFailed: outcome.slotSaveFailed, skippedLayouts,
      });
      const text: string = outcome.slotSaveFailed
        ? 'Logo generated, but one or more layouts failed to save — you may want to regenerate.'
        : allKept
          ? 'Logo generated, but the brand slots were left unchanged because the user had ' +
            'manually set a custom logo. The new logo was NOT applied — do not tell the user it ' +
            'was; ask before replacing their custom logo.'
          : hasSkipped
            ? `Logo generated and saved. Kept the user's custom logo (left unchanged) for: ${skippedLayouts.join(', ')}.`
            : 'Logo generated and saved to the brand slots.';
      return {
        text,
        structuredContent: {
          started: true,
          jobId: result.jobId,
          slots: result.slots,
          status: 'completed',
          logoId: outcome.logoId,
          logo: outcome.logo,
          sessionId: outcome.sessionId,
          ...(outcome.slotSaveFailed
            ? { slotSaveFailed: true, failedLayouts: outcome.failedLayouts }
            : {}),
          ...(hasSkipped ? { skippedLayouts } : {}),
        },
      };
    }
    const status: string = outcome?.status ?? 'unknown';
    logger.warn(`${logPrefix}.failed_sync`, {
      appId, jobId: result.jobId, status,
    });
    const error: string =
      status === 'cancelled'
        ? 'Logo generation was cancelled.'
        : status === 'superseded'
          ? 'Logo generation was superseded by a newer request.'
          : 'Logo generation failed. Please try again.';
    return { error, structuredContent: { jobId: result.jobId, status } };
  }

  logger.info(`${logPrefix}.queued`, {
    appId, jobId: result.jobId, slots: result.slots,
  });

  return {
    text:
      'Logo generation has started in the background. Placeholder slots are in place — ' +
      'you can reference the logo slots now and they will update automatically when the logo is ready. ' +
      'I will let you know when it completes (or if it fails).',
    structuredContent: {
      started: true,
      jobId: result.jobId,
      slots: result.slots,
      status: 'queued',
    },
  };
}

export const generateLogoTool: SkillToolDefinition = {
  name: 'generate_logo',
  description:
    'Generate a new logo from scratch. If the user uploaded inspiration images in the chat, ' +
    'the tool picks them up automatically. The tool appends the brand color palette to your prompt ' +
    'automatically — do not list hex values yourself. One layout per call (or `all` for the full kit).',

  parameters: GenerateLogoInputSchema,

  async execute(input: GenerateLogoInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;
    const conversationId = (context as { metadata?: { conversationId?: string } })?.metadata?.conversationId;

    // Capture the active OTel span (the `media-logo__generate_logo` tool span)
    // synchronously here — logoGenerationService.start() detaches the real work
    // onto setImmediate, after which the ambient OTel context is gone. The logo
    // API uses these to nest its LLM/image observations under this tool span.
    const traceIds = getCurrentTraceIds();
    const traceparent: string | undefined = traceIds ? `00-${traceIds.traceId}-${traceIds.observationId}-01` : undefined;

    const inspirationUrls: string[] = resolveInspirationFromContext(context);
    const backgroundRegistry: BackgroundTaskRegistry | undefined = getBackgroundTaskRegistry(context);

    logger.info('skill.media-logo.generate_logo.start', {
      appId,
      layout: input.layout,
      promptLength: input.prompt.length,
      inspirationCount: inspirationUrls.length,
    });

    if (!appId) {
      logger.error('skill.media-logo.generate_logo.no_app_id');
      return { error: 'Unable to determine app id for logo generation' };
    }

    // AAB-only: the `apps` table (and thus customerId) may not exist for PaaS.
    // Logo generation is currently an AAB feature, so a missing record is a
    // hard error rather than a fallback.
    const app = appRepository.findById(appId);
    const customerId: string | undefined = app?.customerId;
    if (!customerId) {
      logger.error('skill.media-logo.generate_logo.no_customer', { appId });
      return { error: 'Unable to determine customer identity for logo generation' };
    }

    const budgetUserId: string | null | undefined = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;
    if (!budgetUserId) {
      logger.error('skill.media-logo.generate_logo.grants_exhausted', {
        appId, socketId, customerId,
      });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to generate logos.' };
    }

    const { palette, brandName } = await readBrandContext(appId);
    const suffix: string = buildPaletteSuffix(palette);
    const finalPrompt: string = assembleFinalPrompt(input.prompt, suffix, appId);

    const colors: LogoColors | undefined = buildLogoColors(palette);

    const layouts: LogoLayout[] = expandLayouts(input.layout);
    const references: { inspiration: string[] } | undefined = inspirationUrls.length > 0
      ? { inspiration: inspirationUrls }
      : undefined;

    const followUpVariants: LogoVariant[] = await resolveFollowUpVariants(appId, layouts, input.followUpVariants as LogoVariant[] | undefined);

    const result = await logoGenerationService.start({
      appId,
      prompt: finalPrompt,
      layouts,
      ...(references !== undefined ? { references } : {}),
      ...(colors !== undefined ? { colors } : {}),
      ...(brandName !== undefined ? { brandName } : {}),
      customerId,
      budgetUserId,
      searchQuery: input.prompt.slice(0, 80),
      suppressGrowl: input.background === false || !!backgroundRegistry,
      ...(traceparent !== undefined ? { traceparent } : {}),
      ...(conversationId !== undefined ? { conversationId } : {}),
      ...(followUpVariants.length ? { followUpVariants } : {}),
    });

    // Only the primary job's `done` is registered. chainDone (follow-up variant
    // outcomes) is NOT registered because the registry is per-turn and variants
    // settle after the turn ends. Upgrade path: session-scoped registry.
    if (input.background !== false && backgroundRegistry) {
      registerBackgroundTask(backgroundRegistry, result, 'generate_logo');
    }

    return handleLogoResult(result, input, layouts, 'skill.media-logo.generate_logo', appId);
  },

  // The text-only agent can't see images and doesn't need the internal job
  // bookkeeping (started/jobId/logoId). It references logos via the slot paths
  // in `slots` plus the `text` ack. The full structuredContent still reaches the
  // UI/Brand Book; only the model-facing result is projected down.
  toModelOutput: toLogoModelOutput,

  config: {
    timeout: 240_000,
  },
};

export const editLogoTool: SkillToolDefinition = {
  name: 'edit_logo',
  description:
    'Edit the existing saved logo. The tool automatically retrieves the current logo from the brand slot — ' +
    'you only need to describe the change. If the user uploaded inspiration images, they are picked up automatically.',

  parameters: EditLogoInputSchema,

  async execute(input: EditLogoInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;
    const conversationId = (context as { metadata?: { conversationId?: string } })?.metadata?.conversationId;

    // Capture the active OTel span (the `media-logo__edit_logo` tool span)
    // synchronously here — logoGenerationService.start() detaches the real work
    // onto setImmediate, after which the ambient OTel context is gone. The logo
    // API uses these to nest its LLM/image observations under this tool span.
    const traceIds = getCurrentTraceIds();
    const traceparent: string | undefined = traceIds ? `00-${traceIds.traceId}-${traceIds.observationId}-01` : undefined;

    const inspirationUrls: string[] = resolveInspirationFromContext(context);
    const backgroundRegistry: BackgroundTaskRegistry | undefined = getBackgroundTaskRegistry(context);

    logger.info('skill.media-logo.edit_logo.start', {
      appId,
      layout: input.layout,
      promptLength: input.prompt.length,
      inspirationCount: inspirationUrls.length,
    });

    if (!appId) {
      logger.error('skill.media-logo.edit_logo.no_app_id');
      return { error: 'Unable to determine app id for logo generation' };
    }

    // AAB-only: the `apps` table (and thus customerId) may not exist for PaaS.
    // Logo generation is currently an AAB feature, so a missing record is a
    // hard error rather than a fallback.
    const app = appRepository.findById(appId);
    const customerId: string | undefined = app?.customerId;
    if (!customerId) {
      logger.error('skill.media-logo.edit_logo.no_customer', { appId });
      return { error: 'Unable to determine customer identity for logo generation' };
    }

    const budgetUserId: string | null | undefined = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;
    if (!budgetUserId) {
      logger.error('skill.media-logo.edit_logo.grants_exhausted', {
        appId, socketId, customerId,
      });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to generate logos.' };
    }

    const layouts: LogoLayout[] = expandLayouts(input.layout);
    const resolved: ResolvedReference = await resolveReferenceUrl(appId, layouts);
    if (!resolved.url) {
      return { error: 'No existing logo found in brand slots. Use generate_logo to create one first.' };
    }

    const { palette, brandName } = await readBrandContext(appId);
    const suffix: string = buildPaletteSuffix(palette);
    const finalPrompt: string = assembleFinalPrompt(input.prompt, suffix, appId);

    const colors: LogoColors | undefined = buildLogoColors(palette);

    const references: { logo: string; inspiration?: string[] } = {
      logo: resolved.url,
      ...(inspirationUrls.length > 0 ? { inspiration: inspirationUrls } : {}),
    };

    const followUpVariants: LogoVariant[] = await resolveFollowUpVariants(appId, layouts, input.followUpVariants as LogoVariant[] | undefined);

    const result = await logoGenerationService.start({
      appId,
      prompt: finalPrompt,
      layouts,
      references,
      ...(colors !== undefined ? { colors } : {}),
      ...(brandName !== undefined ? { brandName } : {}),
      customerId,
      budgetUserId,
      searchQuery: input.prompt.slice(0, 80),
      suppressGrowl: input.background === false || !!backgroundRegistry,
      ...(traceparent !== undefined ? { traceparent } : {}),
      ...(conversationId !== undefined ? { conversationId } : {}),
      ...(followUpVariants.length ? { followUpVariants } : {}),
    });

    if (input.background !== false && backgroundRegistry) {
      registerBackgroundTask(backgroundRegistry, result, 'edit_logo');
    }

    return handleLogoResult(result, input, layouts, 'skill.media-logo.edit_logo', appId);
  },

  toModelOutput: toLogoModelOutput,

  config: {
    timeout: 240_000,
  },
};

const GenerateLogoVariantInputSchema = z.object({
  variant: z
    .enum(['square', 'horizontal', 'vertical', 'favicon'])
    .describe(
      'Target variant to derive from the existing logo. ' +
        'favicon — extract a compact square icon (saved to logo/favicon slot). ' +
        'square/horizontal/vertical — reformat the logo to that layout.',
    ),
  prompt: z
    .string()
    .max(PROMPT_SCHEMA_MAX)
    .optional()
    .describe('Optional additional direction for the variant (e.g. "simplify the icon for small sizes").'),
  background: z
    .boolean()
    .default(true)
    .describe(
      'Run generation in the background (default true): the tool returns immediately with ' +
        'an animated placeholder slot that updates when the variant is ready. ' +
        'Set false to wait for the finished variant before the tool returns.',
    ),
});

type GenerateLogoVariantInput = z.infer<typeof GenerateLogoVariantInputSchema>;

export const generateLogoVariantTool: SkillToolDefinition = {
  name: 'generate_logo_variant',
  description:
    'Derive a variant of the existing logo (e.g. a favicon, or a reformatted layout). ' +
    'Requires an existing logo in the brand slots. The source logo is resolved automatically.',

  parameters: GenerateLogoVariantInputSchema,

  async execute(input: GenerateLogoVariantInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;
    const conversationId = (context as { metadata?: { conversationId?: string } })?.metadata?.conversationId;

    const traceIds = getCurrentTraceIds();
    const traceparent: string | undefined = traceIds ? `00-${traceIds.traceId}-${traceIds.observationId}-01` : undefined;

    logger.info('skill.media-logo.generate_logo_variant.start', {
      appId,
      variant: input.variant,
    });

    if (!appId) {
      logger.error('skill.media-logo.generate_logo_variant.no_app_id');
      return { error: 'Unable to determine app id for logo variant generation' };
    }

    const app = appRepository.findById(appId);
    const customerId: string | undefined = app?.customerId;
    if (!customerId) {
      logger.error('skill.media-logo.generate_logo_variant.no_customer', { appId });
      return { error: 'Unable to determine customer identity for logo variant generation' };
    }

    const budgetUserId: string | null | undefined = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;
    if (!budgetUserId) {
      logger.error('skill.media-logo.generate_logo_variant.grants_exhausted', { appId, socketId, customerId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to generate logo variants.' };
    }

    const sourceCandidates: string[] = [LOGO_SLOT_PATHS.square, LOGO_SLOT_PATHS.horizontal, LOGO_SLOT_PATHS.vertical];
    let sourceUrl: string | undefined;
    for (const path of sourceCandidates) {
      try {
        const r = await mediaManifestService.getSlot(appId, path);
        if (!r.success || !r.slot?.currentUrl) continue;
        const sourceMap = r.slot.logoSourceMap;
        if (sourceMap && sourceMap[r.slot.currentUrl]) {
          sourceUrl = r.slot.currentUrl;
          logger.info('skill.media-logo.generate_logo_variant.source_resolved', { appId, slotPath: path });
          break;
        }
      } catch (err) {
        logger.warn('skill.media-logo.generate_logo_variant.slot_lookup_failed', {
          appId, slotPath: path, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!sourceUrl) {
      return { error: 'No existing logo found in brand slots. Use generate_logo to create one first.' };
    }

    const { palette, brandName } = await readBrandContext(appId);
    const colors: LogoColors | undefined = buildLogoColors(palette);
    const backgroundRegistry: BackgroundTaskRegistry | undefined = getBackgroundTaskRegistry(context);

    const result = await logoGenerationService.startVariant({
      appId,
      sourceUrl,
      variant: input.variant as LogoVariant,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      ...(colors !== undefined ? { colors } : {}),
      ...(brandName !== undefined ? { brandName } : {}),
      customerId,
      budgetUserId,
      suppressGrowl: input.background === false || !!backgroundRegistry,
      ...(traceparent !== undefined ? { traceparent } : {}),
      ...(conversationId !== undefined ? { conversationId } : {}),
    });

    if (input.background !== false && backgroundRegistry) {
      registerBackgroundTask(backgroundRegistry, result, 'generate_logo_variant');
    }

    const layouts: LogoLayout[] = input.variant === 'favicon' ? [] : [input.variant as LogoLayout];
    return handleLogoResult(result, input, layouts, 'skill.media-logo.generate_logo_variant', appId);
  },

  toModelOutput: toLogoModelOutput,

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
    'Requires both horizontal and square logo slots to be populated. If a layout is missing, ' +
    'use generate_logo_variant to derive it from an existing logo first. No arguments required.',
  parameters: z.object({}),
  async execute(_input, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;

    if (!appId) {
      logger.error('skill.media-logo.set_venture_logo.no_app_id');
      return { error: 'Unable to determine app id for set_venture_logo' };
    }

    logger.info('skill.media-logo.set_venture_logo.start', { appId });

    const workspace = createForWorkspace(appId, 'preview')?.files ?? null;
    if (workspace) {
      const job = await readLogoJob(workspace, appId);
      if (job && (job.status === 'queued' || job.status === 'generating')) {
        logger.info('skill.media-logo.set_venture_logo.pending', { appId, jobId: job.jobId });
        return {
          text: 'The logo is still generating — I will set it on the venture dashboard once it is ready.',
          structuredContent: { pending: true },
        };
      }
    }

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

    if (!horizontalUrl && !squareUrl) {
      logger.warn('skill.media-logo.set_venture_logo.slot_missing', { appId, hasHorizontal: false, hasSquare: false });
      return { error: 'No logos found in brand slots. Use generate_logo to create one first.' };
    }

    if (!squareUrl) {
      logger.warn('skill.media-logo.set_venture_logo.slot_missing', { appId, hasHorizontal: true, hasSquare: false });
      return {
        error:
          'Square logo not found. Use generate_logo_variant with variant "square" to derive one from the existing horizontal logo, then retry set_venture_logo.',
      };
    }

    if (!horizontalUrl) {
      logger.warn('skill.media-logo.set_venture_logo.slot_missing', { appId, hasHorizontal: false, hasSquare: true });
      return {
        error:
          'Horizontal logo not found. Use generate_logo_variant with variant "horizontal" to derive one from the existing square logo, then retry set_venture_logo.',
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

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
import { getCurrentTraceIds } from '@airo/ai-transport';

import { logger } from '../../../logging/index.js';
import { appRepository } from '../../../database/repositories/index.js';
import { appPlanTool } from '../../../tools/app-plan-tool.js';
import { mediaManifestService } from '../../../services/MediaManifestService.js';
import { getKvMemoryStore } from '../../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../../memory/interfaces/scope.js';
import { LOGO_SLOT_PATHS, ALL_LAYOUTS } from '../../../services/logo/logo-slots.js';
import { logoGenerationService } from '../../../services/logo/LogoGenerationService.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { readLogoJob } from '../../../services/logo/logo-job-state.js';
import {
  type LogoLayout,
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
});

type GenerateLogoInput = z.infer<typeof GenerateLogoInputSchema>;

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
    const conversationId = (context as { metadata?: { conversationId?: string } })?.metadata?.conversationId;

    // Capture the active OTel span (the `media-logo__generate_logo` tool span)
    // synchronously here — logoGenerationService.start() detaches the real work
    // onto setImmediate, after which the ambient OTel context is gone. The logo
    // API uses these to nest its LLM/image observations under this tool span.
    const traceIds = getCurrentTraceIds();
    const traceparent = traceIds ? `00-${traceIds.traceId}-${traceIds.observationId}-01` : undefined;

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

    // Tell the logo API how to use the reference: a caller-supplied URL is an
    // uploaded inspiration image (generate a new logo in that style, with the
    // brand brief); an auto-resolved slot URL is the saved logo being iterated on
    // (preserve identity, skip the brief). Omitted when there's no reference.
    const referenceMode: 'inspiration' | 'edit' | undefined = input.referenceUrl
      ? 'inspiration'
      : referenceUrl !== undefined
        ? 'edit'
        : undefined;

    // The caller omitted a reference and we couldn't resolve one from an
    // existing slot — an intended "make it blue"-style edit will produce a
    // fresh design instead. Surface it so it isn't silently misleading.
    if (!input.referenceUrl && referenceUrl === undefined && reference.existingSlotWithoutReference) {
      logger.warn('skill.media-logo.reference.unresolved_with_existing_slot', {
        appId,
        layout: input.layout,
      });
    }

    const result = await logoGenerationService.start({
      appId,
      prompt: finalPrompt,
      layouts,
      ...(referenceUrl !== undefined ? { referenceUrl } : {}),
      ...(referenceMode !== undefined ? { referenceMode } : {}),
      ...(colors !== undefined ? { colors } : {}),
      customerId,
      budgetUserId,
      searchQuery: input.prompt.slice(0, 80),
      ...(input.background === false ? { suppressGrowl: true } : {}),
      ...(traceparent !== undefined ? { traceparent } : {}),
      ...(conversationId !== undefined ? { conversationId } : {}),
    });

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
        const skippedLayouts = outcome.skippedLayouts ?? [];
        const hasSkipped = skippedLayouts.length > 0;
        // Every requested layout was left untouched because the user had manually
        // overridden those slots (save-time userModified guard) — the new logo was
        // generated but NOT applied. Tell the model so it doesn't claim the new logo
        // is live over the user's custom one.
        const allKept = hasSkipped && skippedLayouts.length === layouts.length;
        logger.info('skill.media-logo.generate_logo.completed_sync', {
          appId, jobId: result.jobId, slots: result.slots,
          slotSaveFailed: outcome.slotSaveFailed, skippedLayouts,
        });
        const text = outcome.slotSaveFailed
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
      const status = outcome?.status ?? 'unknown';
      logger.warn('skill.media-logo.generate_logo.failed_sync', {
        appId, jobId: result.jobId, status,
      });
      const error =
        status === 'cancelled'
          ? 'Logo generation was cancelled.'
          : status === 'superseded'
            ? 'Logo generation was superseded by a newer request.'
            : 'Logo generation failed. Please try again.';
      return { error, structuredContent: { jobId: result.jobId, status } };
    }

    logger.info('skill.media-logo.generate_logo.queued', {
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
  },

  // The text-only agent can't see images and doesn't need the internal job
  // bookkeeping (started/jobId/logoId). It references logos via the slot paths
  // in `slots` plus the `text` ack. The full structuredContent still reaches the
  // UI/Brand Book; only the model-facing result is projected down.
  toModelOutput: ({ output }) => {
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

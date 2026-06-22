import { randomUUID } from 'crypto'
import { runPreflightTools } from '@airo/ai-transport'
import type { KnownAppMetadata } from '@airo/shared'
import { installDesignKitForApp } from './install.js'
import { applyKitDesignTokens } from './apply-kit-design.js'
import { AppMetadataRepository } from '../../database/repositories/AppMetadataRepository.js'

export interface ForcedInstallLogger {
  info: (event: string, data?: Record<string, unknown>) => void
  warn: (event: string, data?: Record<string, unknown>) => void
}

type PreflightToolMap = Record<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>

/**
 * Build the install tool-result text. When the kit was also loaded, we tell the
 * model its primitives are already in context; otherwise we tell it to call
 * loadUiKit. Both variants carry the hard directive that stops the model from
 * scoring the catalog and picking a different kit — the prompt guard alone does
 * not hold (observed: it re-selected `toast-blocks` over a forced install).
 */
function forcedInstallMessage(slug: string, written: number, loaded: boolean, applied: { colors: boolean; fonts: boolean }, questions: string[]): string {
  const directive = `The user explicitly selected the \`${slug}\` design kit from the gallery; it IS the chosen design system. Do NOT call listDesignSystems or installDesignSystem again, and do NOT score the catalog or switch to a different kit.`
  const loadClause = loaded
    ? 'Its primitives are already loaded (see the loadUiKit result below).'
    : 'Call `loadUiKit` to read its primitives.'
  // The kit's colors/fonts are applied deterministically in code (the model
  // reliably ignores a directive to apply them, re-deriving its own from the
  // business domain), and the colorScheme/fontTheme tools are removed from this
  // variant — so tell the model the tokens are locked, not to set them.
  const appliedParts = [applied.colors && 'colors', applied.fonts && 'fonts'].filter(Boolean).join(' and ')
  // The interview must ask THIS kit's own intake questions (from the catalog) —
  // they're authored to gather exactly what the kit needs. Fall back to the
  // standard Phase-1 questions only when the kit ships none (e.g. Obsidian).
  const interviewClause = questions.length > 0
    ? `In your Phase 1 \`askQuestion\` interview, ask the user THESE kit-specific questions (generate 2-3 suggested answers for each), plus the project name if not already given:\n${questions.map((q, i) => `  ${i + 1}. ${q.trim()}`).join('\n')}`
    : `Run your standard Phase 1 \`askQuestion\` interview (name, audience, scope) — this kit ships no intake questions of its own.`
  // Do NOT tell the model to build here. This variant's job is the setup flow:
  // interview → set project name → todo list → hand off to develop (which builds).
  // Telling it to "build the page" makes it edit files DURING the interview turn,
  // muddying the question widget (the user then has to type instead of clicking).
  const tokensClause = appliedParts
    ? `The kit's ${appliedParts} are ALREADY applied to the site — do NOT change them, and do NOT edit files or build pages yourself.`
    : `Do NOT edit files or build pages yourself.`
  return `Installed \`${slug}\` (${written} files in docs/ui-kit/). ${directive} ${loadClause} ${tokensClause} ${interviewClause}\nAfter the interview: set the project name, create the todo list, then hand off to develop (develop builds the pages).`
}

/**
 * Returns true when agentConfig is a design-system variant — either the normal
 * variant (preflightTools includes 'listDesignSystems') or a forked
 * `initial-design-system-*-attached` variant, which drops that preflight tool.
 * The id branch is scoped to the `-attached` suffix so it only rescues the
 * forked variants; normal variants are caught by the preflightTools branch.
 */
export function isDesignSystemVariant(agentConfig: { id?: string; metadata?: Record<string, unknown> } | undefined): boolean {
  const tools = agentConfig?.metadata?.preflightTools
  if (Array.isArray(tools) && tools.includes('listDesignSystems')) return true
  const id = agentConfig?.id
  return typeof id === 'string' && id.startsWith('initial-design-system') && id.endsWith('-attached')
}

/**
 * Install a design kit by slug into the app workspace and return synthesized
 * tool_call + tool_result messages to prepend to the LLM history, making the
 * model believe it called installDesignSystem itself.
 *
 * When `tools` is supplied (the design-system variant's toolset), loadUiKit is
 * run too, so the kit's real primitives land in context and the model applies
 * THIS kit's colors/fonts instead of re-scoring the catalog. This is the forked
 * path — it only runs when a user explicitly attached a kit, leaving the normal
 * auto-select flow untouched.
 *
 * Returns [] (never throws) on any failure — the caller falls back to normal
 * LLM-driven auto-selection.
 */
export async function injectForcedDesignKit(input: {
  designKitSlug: string
  appId: string
  logger: ForcedInstallLogger
  tools?: PreflightToolMap
  customerId?: string
}): Promise<Array<{ role: string; content: unknown }>> {
  const { designKitSlug, appId, logger, tools, customerId } = input
  try {
    const result = await installDesignKitForApp(appId, designKitSlug)

    if ('error' in result) {
      if (result.error === 'slug_not_found') {
        logger.warn('design_kit.forced_install.slug_not_found', { slug: designKitSlug, appId })
      } else {
        logger.warn('design_kit.forced_install.workspace_unavailable', { slug: designKitSlug, appId })
      }
      return []
    }

    // Deterministically apply the kit's palette + fonts from its structured
    // catalog tokens. A prompt directive to "apply the kit's colors" does NOT
    // hold — the model re-derives its own palette from the business domain
    // (observed: a dark kit became terracotta for a coffee shop). So we apply in
    // code and lock colorScheme/fontTheme via the `designKitTokensLocked` marker
    // below (the tools stay wired on every variant — the marker-keyed guard in
    // color-scheme.ts/font-theme.ts does the locking, so it also covers post-handoff
    // develop turns). Best-effort.
    const applied = await applyKitDesignTokens({
      appId, design: result.design, displayName: result.displayName, customerId,
    })

    // The deterministic token writes leave the interview turn's tree dirty.
    // Rather than commit them (a forced-install -attached turn has no git
    // workspace connection, so the commit fails and the tree stays dirty), the
    // post-stream validator grants this single turn validator-immunity: it skips
    // on the askQuestion stop-after even with a dirty tree, keyed on the forced
    // install having run THIS turn (see MessageExecutionService / forcedInstallThisTurn,
    // AIROBUILD-2665). That prevents the phantom-postcss continuation → premature
    // build without touching validation on any other turn.
    if (applied.appliedColors || applied.appliedFonts) {
      // Record the forced-install-only lock signal: the kit's tokens were
      // applied DETERMINISTICALLY IN CODE here, so colorScheme/fontTheme must be
      // locked (a model override would undo this in-code apply). The wizard flow
      // never runs applyKitDesignTokens (it applies via the tools themselves), so
      // it never sets this marker and keeps the tools usable. Best-effort — a
      // metadata hiccup must never block the build (AIROBUILD-2665).
      try {
        new AppMetadataRepository().merge(appId, { designKitTokensLocked: true } satisfies Partial<KnownAppMetadata>)
      } catch (err) {
        logger.warn('design_kit.forced_install.lock_marker_failed', { appId, slug: result.slug, err: String(err) })
      }
    }

    // Load the kit's primitives so the model builds layout/components to THIS
    // kit. loadUiKit only needs the appId off context.metadata; runPreflightTools
    // swallows per-tool failures, so a workspace hiccup just drops the load pair.
    const loadUiKitMessages = tools?.loadUiKit
      ? await runPreflightTools({ preflightTools: ['loadUiKit'], tools, context: { metadata: { appId } }, logger })
      : []
    const loaded = loadUiKitMessages.length > 0

    logger.info('design_kit.forced_install', {
      slug: result.slug, appId, written: result.written, loaded,
      appliedColors: applied.appliedColors, appliedFonts: applied.appliedFonts,
    })
    const toolCallId = `pf_${randomUUID()}`
    // Use the canonical slug from the catalog (result.slug) for both the
    // tool-call input and the result text, so they never diverge if the
    // catalog normalises the user-supplied slug.
    return [
      {
        role: 'assistant',
        content: [{ type: 'tool-call' as const, toolCallId, toolName: 'installDesignSystem', input: { slug: result.slug } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result' as const, toolCallId, toolName: 'installDesignSystem', output: { type: 'text' as const, value: forcedInstallMessage(result.slug, result.written, loaded, { colors: applied.appliedColors, fonts: applied.appliedFonts }, result.questions ?? []) } }],
      },
      ...loadUiKitMessages,
    ]
  } catch (err) {
    logger.warn('design_kit.forced_install.failed', { slug: designKitSlug, appId, err: String(err) })
    return []
  }
}

/**
 * Shared forced-install entry point for both transports: log the request, gate
 * on the design-system variant, and either skip (non-variant) or install. The
 * SSE block and the WS preflightEnricher only differ in where the slug comes
 * from (ExecuteParams vs context.metadata) — keep that extraction at the call
 * site and route the common log/gate/install through here so the two transports
 * can't drift (see packages/ai-transport/CLAUDE.md). Returns [] (never throws)
 * when skipped or on any install failure.
 */
export async function enrichWithForcedDesignKit(input: {
  designKitSlug: string
  appId: string
  agentConfig: { id?: string; tools?: Record<string, unknown>; metadata?: Record<string, unknown> }
  transport: 'sse' | 'ws'
  logger: ForcedInstallLogger
  customerId?: string
}): Promise<Array<{ role: string; content: unknown }>> {
  const { designKitSlug, appId, agentConfig, transport, logger, customerId } = input
  logger.info('design_kit.forced_install.requested', { designKitSlug, appId, transport })
  if (!isDesignSystemVariant(agentConfig)) {
    logger.warn('design_kit.forced_install.skipped_non_variant', {
      designKitSlug, appId, transport, preflightTools: agentConfig.metadata?.preflightTools,
    })
    return []
  }
  return injectForcedDesignKit({
    designKitSlug, appId, logger, customerId,
    tools: agentConfig.tools as PreflightToolMap | undefined,
  })
}

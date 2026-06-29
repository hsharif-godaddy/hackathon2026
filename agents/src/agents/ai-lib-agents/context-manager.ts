/**
 * AI-Lib Context Manager
 * Integrates ConversationContextManager capabilities with ai-lib agents
 */

import { ConversationContextManager } from '../../services/ConversationContextManager.js'
import { AppContextManager } from '../../services/AppContextManager.js'
import { getKvMemoryStore, getMessageStore, getSummaryStore } from '../../memory/adapters/index.js'
import type { KvMemoryStore, MessageStore, SummaryStore } from '../../memory/interfaces/index.js'
import { customerIdFromContext, workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import type { EnhancedAgentContext, ContextMessage, ContextGenerationConfig, AgentContextPreferences } from './types.js'
import { DEFAULT_CONTEXT_CONFIG } from './types.js'
import { UI_KIT_COPY_GUARDRAIL } from '../../prompts/ui-kit-guardrail.js'
import { logger, log } from '../../logging/index.js'
import { getAgentConfig } from '../../services/features.js'
import type { FormattedContext } from '../../services/helpers/ContextFormatter.js'

import type { AgentExecutionContext } from '../../base/agent.interface.js'
import type { AgentsAppContext } from '../../types/agents-app-context.js'
import { getValidatedTemplateVersion, getTemplateDescriptionPath } from '../../utils/prompt-utils.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { contextAttachmentRegistry } from '../../services/ContextAttachmentRegistry.js'
import type { ContextAttachment } from '@airo/shared/context-attachment'
import { createForWorkspace } from '../../workspace/index.js'
import { extractStoredUploadFilename } from '../../services/upload-stored-filename.js'
import { isDevSupervisorNotFound } from '../../services/DevSupervisorClient.js'
import {
  buildUploadHandlingGuidance,
  sanitizeUploadFileNameForDisplay,
  type UploadPlacementIntent,
} from '../../services/upload-handling-guidance.js'
import type { ViewResult } from '../../workspace/files.js'
import type { PersistedUploadClassification } from '../../services/renderers/upload-classification-persistence.js'

const swallowNotFound = <T>(fallback: T) => (err: unknown): T => {
    if (isDevSupervisorNotFound(err)) return fallback
    throw err
}

type AttachmentContextMessage = {
  role: 'user' | 'system'
  content: string
  insertionOrder?: 'before_history' | 'after_history'
  cachePoint?: { type: 'ephemeral' }
  assetImages?: string[]
}

/**
 * Pull a file name from one attachment item. The two upload attachment shapes
 * key it differently — `selected_assets` items carry `filename`, `file_upload`
 * items carry `name` — so accept either. Anything else yields null.
 */
function extractAttachmentFileName(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const record: Record<string, unknown> = item as Record<string, unknown>
  const candidate: unknown = record.filename ?? record.name
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

/**
 * File names the user is engaging on the CURRENT turn, drawn from the live
 * context attachments. Used to decide whether a persisted upload classification
 * should re-inject its imperative "place this" guidance (only when the file is
 * attached this turn) or a passive availability note (a leftover from an
 * earlier turn/session). Handles every upload attachment shape: an array of
 * assets (`selected_assets`), `{ files: [...] }`, or a single `{ name }`
 * (`file_upload`). Unrecognised shapes simply contribute no names — the entry
 * then falls through to the passive branch, which is the safe default.
 */
function collectAttachedUploadFileNames(attachments: ContextAttachment[] | undefined): Set<string> {
  const names: Set<string> = new Set<string>()
  if (!attachments) return names
  for (const attachment of attachments) {
    const data: unknown = attachment.data
    if (Array.isArray(data)) {
      for (const item of data) {
        const name: string | null = extractAttachmentFileName(item)
        if (name) names.add(name)
      }
      continue
    }
    if (data && typeof data === 'object') {
      const files: unknown = (data as { files?: unknown }).files
      if (Array.isArray(files)) {
        for (const item of files) {
          const name: string | null = extractAttachmentFileName(item)
          if (name) names.add(name)
        }
        continue
      }
      const name: string | null = extractAttachmentFileName(data)
      if (name) names.add(name)
    }
  }
  return names
}

/**
 * Map of display name → CURRENT-turn stored filename, drawn from the live
 * `selected_assets` attachments (each asset's `imageUrl` carries the unique
 * stored filename). Used to override a persisted classification's possibly
 * STALE `storedUploadFilename`: the persisted loop reads the pre-turn JSON
 * (this turn's re-classify/persist runs later), so on a re-upload/correction
 * turn its `storedUploadFilename` points at the PRIOR upload. Surfacing that in
 * the imperative `import_upload` block let the agent re-place the old (wrong)
 * image. When the file is attached this turn we have its fresh stored filename
 * here and prefer it. `file_upload` attachments carry no per-item URL, so they
 * contribute nothing and fall back to the persisted value (unchanged).
 */
export function collectAttachedUploadStoredFilenames(attachments: ContextAttachment[] | undefined): Map<string, string> {
  const byName: Map<string, string> = new Map<string, string>()
  if (!attachments) return byName
  for (const attachment of attachments) {
    const data: unknown = attachment.data
    if (!Array.isArray(data)) continue
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const record: { filename?: unknown; imageUrl?: unknown; videoUrl?: unknown } = item as { filename?: unknown; imageUrl?: unknown; videoUrl?: unknown }
      const fileName: string | null = typeof record.filename === 'string' && record.filename.length > 0 ? record.filename : null
      const imageUrl: string | null = typeof record.imageUrl === 'string' && record.imageUrl.length > 0 ? record.imageUrl : null
      // VIDEO assets may carry the upload URL in imageUrl, videoUrl, or both
      // (mapUploadedFilesToAssetItems sets both to the same value). Prefer
      // imageUrl when present, fall back to videoUrl.
      const videoUrl: string | null = typeof record.videoUrl === 'string' && record.videoUrl.length > 0 ? record.videoUrl : null
      if (!fileName || (!imageUrl && !videoUrl)) continue
      const stored: string | null = extractStoredUploadFilename(imageUrl ?? videoUrl ?? undefined)
      if (stored) byName.set(fileName, stored)
    }
  }
  return byName
}

/**
 * AI-Lib Context Manager
 * Bridges the gap between ai-lib agents and the rich context system
 */
export class AILibContextManager {
    private conversationContextManager: ConversationContextManager
    private appContextManager: AppContextManager
    private appRepository: AppRepository
    private config: ContextGenerationConfig

    constructor(
        config: Partial<ContextGenerationConfig> = {},
        private messageStore: MessageStore = getMessageStore(),
        kvMemoryStore: KvMemoryStore = getKvMemoryStore(),
        private summaryStore: SummaryStore = getSummaryStore(),
    ) {
        // Use injected message store so history loads share the same adapter singletons.
        this.conversationContextManager = new ConversationContextManager(
            this.messageStore,
            config.maxHistoryMessages || DEFAULT_CONTEXT_CONFIG.maxHistoryMessages
        )
        this.appContextManager = new AppContextManager(kvMemoryStore)
        this.appRepository = new AppRepository()
        this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config }
    }

    /**
     * Build context messages for conversation history
     * @param baseSystemPrompt - The base system prompt from markdown file (returned unchanged)
     * @param context - Enhanced agent context
     * @param agentPreferences - Optional agent-specific context preferences to override defaults
     * @returns Object with static system prompt and context messages
     *
     * NOTE: The conversation summary injected here does NOT include the operation log.
     * The operation log is injected separately by ConversationHistoryLoader as a dedicated
     * message in the conversation history. Both components must be used together for complete
     * context reconstruction after summarization.
     */
    async buildContextMessages(
        baseSystemPrompt: string,
        context: EnhancedAgentContext,
        agentPreferences?: AgentContextPreferences
    ): Promise<{
        systemPrompt: string
        contextMessages: Array<{ role: 'user' | 'system'; content: string; insertionOrder?: 'before_history' | 'after_history'; cachePoint?: { type: 'ephemeral' } }>
        formattedContexts?: FormattedContext[]
    }> {
        // Always show concise summary
        const contextSummary = {
            hasMetadata: !!context.metadata,
            hasAppContext: !!context.appContext,
            hasContextAttachments: !!context.contextAttachments && context.contextAttachments.length > 0
        }

        logger.info('context.build.start', {
            availableContexts: Object.entries(contextSummary).filter(([_, v]) => v).map(([k]) => k.replace('has', '').toLowerCase()),
            ...contextSummary
        })

        // Detailed logging if enabled
        const contextLogging = getAgentConfig.contextLogging()
        if (contextLogging.detailed) {
            logger.debug('context.build.details', {
                ...contextSummary,
                conversationMaxMessages: context.conversation?.maxMessages,
                appContextDepth: context.appContext?.maxDirectoryDepth,
                contextAttachmentsCount: context.contextAttachments?.length || 0
            })
        }

        const { contextMessages, formattedContexts } = await this.buildRichContextMessages(context, agentPreferences)

        // Convert context messages to conversation format
        const conversationContextMessages: Array<{ role: 'user' | 'system'; content: string; insertionOrder?: 'before_history' | 'after_history'; cachePoint?: { type: 'ephemeral' } }> = []

        // Always show message count summary
        logger.info('context.messages.generated', {
            messageCount: contextMessages.length
        })

        // Detailed logging if enabled
        if (contextLogging.detailed) {
            logger.debug('context.messages.details', {
                messageTypes: contextMessages.map(msg => msg.type),
                totalContextLength: contextMessages.reduce((sum, msg) => sum + msg.content.length, 0)
            })
        }

        // Add template description as system message FIRST (most important context)
        // Check agent preferences for template description inclusion
        const includeTemplate = agentPreferences?.includeTemplateDescription !== false // Default true if not specified
        const templateDescription = includeTemplate ? await this.getTemplateDescription(context) : null
        if (templateDescription) {
            // Template content logging if enabled
            if (contextLogging.templateContent) {
                logger.debug('context.template.content', {
                    contentPreview: templateDescription.substring(0, 500)
                })
            }

            conversationContextMessages.push({
                role: 'system',
                content: templateDescription,
                insertionOrder: 'before_history'
            })
        }

        // UI-kit anchor + persisted upload classification both live in the preview workspace.
        // Reads run in parallel because they're independent; this is hot-path code.
        const workspaceAppId = context.metadata?.appId as string | undefined
        const workspaceForApp = workspaceAppId ? createForWorkspace(workspaceAppId, 'preview') : null
        const stashedKitMetaExists = typeof context.metadata?.kitMetaExists === 'boolean'
            ? context.metadata.kitMetaExists
            : undefined

        const [kitMetaExists, combinedClassification, legacyClassification] = workspaceForApp
            ? await Promise.all([
                stashedKitMetaExists ?? workspaceForApp.files.stat({ paths: ['docs/ui-kit/kit-meta.json'] })
                    .then((s) => {
                        const entry = s.entries[0]
                        return !!entry && entry.error === undefined && entry.kind === 'file'
                    }),
                // Combined multi-file classification (preferred) plus the legacy
                // single-file fallback for already-deployed apps. Parsed below.
                workspaceForApp.files.view({ path: 'docs/.upload-classifications.json', limit: 65536 })
                    .catch(swallowNotFound<ViewResult | null>(null)),
                workspaceForApp.files.view({ path: 'docs/.upload-classification.json', limit: 65536 })
                    .catch(swallowNotFound<ViewResult | null>(null)),
            ])
            : [stashedKitMetaExists ?? false, null, null]

        if (kitMetaExists) {
            conversationContextMessages.push({
                role: 'user',
                content: [
                    'This app has a UI kit design system at `docs/ui-kit/`. The kit is your design language — it defines the visual vocabulary for everything you build.',
                    '',
                    'Before building any page or component, call `loadUiKit` to load the kit into context. Use `include` for specific layouts or landing pages.',
                    '',
                    'How to work with the kit:',
                    '- Default to kit components for every UI need — reach for them before inventing anything new.',
                    '- Use the kit\'s color tokens, spacing scale, typography, border radii, and motion patterns in all code you write.',
                    '- When you need something the kit doesn\'t explicitly provide, compose existing kit components or extend them in a way that matches the kit\'s style and tokens.',
                    '- Never contradict the kit — don\'t override its colors, introduce fonts it doesn\'t define, or break its component patterns.',
                    `- ${UI_KIT_COPY_GUARDRAIL}`,
                    '',
                    'The kit is your anchor. Everything you produce should look like it belongs to this design system.',
                ].join('\n'),
                insertionOrder: 'after_history'
            })
        }

        // Prefer the combined multi-file classification ({ files: [...] }); fall
        // back to the legacy single-object file written by already-deployed apps.
        // Typed as PersistedUploadClassification so the load-bearing `placed`
        // flag (and the other fields read below) are compile-linked to the
        // persisted shape — a field rename fails the build instead of silently
        // resurrecting the re-injection bug.
        const classificationEntries: PersistedUploadClassification[] = []
        try {
            if (combinedClassification) {
                const parsed: { files?: PersistedUploadClassification[] } = JSON.parse(combinedClassification.content)
                if (Array.isArray(parsed?.files)) {
                    classificationEntries.push(...parsed.files)
                }
            } else if (legacyClassification) {
                const legacyEntry: unknown = JSON.parse(legacyClassification.content)
                if (legacyEntry !== null && typeof legacyEntry === 'object' && typeof (legacyEntry as PersistedUploadClassification).fileName === 'string') {
                    classificationEntries.push(legacyEntry as PersistedUploadClassification)
                }
            }
        } catch (err: unknown) {
            logger.warn('context.upload-classification.parse-failed', {
                appId: workspaceAppId,
                error: err instanceof Error ? err.message : String(err),
            })
        }

        // File names the user is engaging this turn. An unplaced upload gets its
        // imperative "place this" guidance re-injected ONLY when it is attached
        // this turn; otherwise it is a leftover and gets a passive note (below).
        const attachedUploadNames: Set<string> = collectAttachedUploadFileNames(context.contextAttachments)
        // Fresh stored filename per display name for files attached THIS turn —
        // overrides the persisted (possibly stale) storedUploadFilename below.
        const attachedStoredFilenames: Map<string, string> = collectAttachedUploadStoredFilenames(context.contextAttachments)

        for (const entry of classificationEntries) {
            const fileName: string = entry.fileName || 'unknown'
            const isVideo: boolean = /\.(mp4|mov|avi|webm|mkv|m4v)$/i.test(fileName)
            const isImage: boolean = !isVideo && /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(fileName)
            const slotUrl: string | null = entry.slotUrl ?? null
            const placementIntent: UploadPlacementIntent = entry.placementIntent ?? 'unclear'
            // Sanitize before interpolating into agent-facing markdown (a
            // backtick/newline could break the code span or inject a line into
            // the instructions). slotUrl is sanitized too — it derives from a
            // semantic, partly filename-based path.
            const displayName: string = sanitizeUploadFileNameForDisplay(fileName)
            const displaySlotUrl: string | null = slotUrl ? sanitizeUploadFileNameForDisplay(slotUrl) : null

            // Re-inject the full "Upload handling" action block ONLY for uploads
            // the agent has NOT yet placed. A placed upload (a slot was
            // registered for it, or its bytes were written into an asset file) —
            // or a reference-only image (a style cue, applied when first given) —
            // is settled. Re-surfacing its action block every turn made the agent
            // re-handle a finished upload (re-charging the user) and risked
            // unrequested edits — e.g. "swap the logo" on a turn where the user
            // only asked about a background (AIROBUILD-2364). For settled uploads
            // we emit only a terse note so the agent still knows the file exists.
            // `placed` is the explicit lifecycle flag; the slotUrl half is a
            // legacy back-compat heuristic for entries written before `placed`
            // existed (a recorded slot URL always meant the upload was placed).
            const isPlaced: boolean = entry.placed === true || (isImage && !!slotUrl)
            if (isPlaced || placementIntent === 'reference_only') {
                const note: string = placementIntent === 'reference_only'
                    ? `Uploaded \`${displayName}\` was provided as a style/inspiration reference and has already been applied — do not place it on the site unless the user explicitly asks.`
                    : `Uploaded \`${displayName}\` is already placed on the site${displaySlotUrl ? ` (slot \`${displaySlotUrl}\`)` : ''}. No action needed unless the user explicitly asks to change it.`
                conversationContextMessages.push({
                    role: 'user',
                    content: note,
                    insertionOrder: 'after_history',
                })
                continue
            }

            // Imperative "place this" guidance is reserved for an upload the user
            // is engaging THIS turn — the file is in the current attachments. The
            // arrival turn's guidance comes from the upload renderers directly;
            // this loop carries it across the continuation/handoff iterations of
            // that SAME message (where the file_upload renderer skips re-classify
            // and relies on re-injection). An unplaced upload that is NOT attached
            // this turn is a leftover from an earlier turn/session — re-issuing an
            // imperative for it made the agent place a stale upload on an
            // unrelated turn (e.g. "fix this runtime error" → also swap the logo),
            // AIROBUILD-2364. Emit only a passive availability note for those.
            const attachedThisTurn: boolean = attachedUploadNames.has(fileName)
            if (!attachedThisTurn) {
                // Images: a chat-uploaded image is NOT on the workspace filesystem
                // (the upload route only mirrors NON-image uploads into docs/), so
                // pointing the agent at `src/assets/<name>` sends it hunting for a
                // file that isn't there — and then reaching for a terminal `cp`
                // (which can't touch the workspace tree) — the observed "src/assets
                // is inaccessible / please re-upload" loop. Documents DO land in
                // docs/, so keep that locator for them. Videos land in public/videos/.
                const availabilityNote: string = isVideo
                    ? `Uploaded \`${displayName}\` is available on disk (\`public/videos/${displayName}\`) but has not been placed on the site. Do not place it unless the user explicitly asks.`
                    : isImage
                        ? `Uploaded \`${displayName}\` is available in your upload store (not on the workspace filesystem — do NOT look for it under \`src/assets\` or try to read/\`cp\` it from a terminal) but has not been placed on the site. Do not place it unless the user explicitly asks.`
                        : `Uploaded \`${displayName}\` is available on disk (\`docs/${displayName}\`) but has not been placed on the site. Do not place it unless the user explicitly asks.`
                conversationContextMessages.push({
                    role: 'user',
                    content: availabilityNote,
                    insertionOrder: 'after_history',
                })
                continue
            }

            // Prefer THIS turn's stored filename (from the live attachment URL)
            // over the persisted one. The persisted loop reads the pre-turn JSON,
            // so on a re-upload/correction turn entry.storedUploadFilename is the
            // PRIOR upload — using it would re-place the old (wrong) image.
            const freshStoredFilename: string | null = attachedStoredFilenames.get(fileName) ?? null
            const handling: string = buildUploadHandlingGuidance({
                fileName,
                assetRole: entry.assetRole ?? null,
                placementIntent,
                slotUrl,
                storedUploadFilename: freshStoredFilename ?? entry.storedUploadFilename ?? null,
                isImage,
                isVideo,
                deflectedFromCanonical: entry.deflectedFromCanonical ?? false,
            })
            // For images, defer the "where/how" entirely to the Upload handling
            // steps above (import_upload for slots, empty-content create for
            // logos) — both pull the bytes from the upload store. Stating a
            // `src/assets/<name>` "file location" is wrong (chat-upload images are
            // not mirrored to the workspace tree) and makes the agent try to read
            // or `cp` a file that isn't there. Documents are mirrored into docs/;
            // videos into public/videos/ — keep those locators.
            const locationLine: string = isVideo
                ? `File location: \`public/videos/${displayName}\``
                : isImage
                    ? `This upload lives in your upload store, not on the workspace filesystem — place it using the Upload handling steps above. Do NOT look for it under \`src/assets\` or read/\`cp\` it from a terminal.`
                    : `File location: \`docs/${displayName}\``
            // Dump the entry with the fresh stored filename too, so the agent
            // can't pick the stale one out of the raw JSON either. fileName and
            // summary (the latter is LLM vision output over a user image) are
            // run through the same backtick/control-char stripper as every other
            // agent-facing sink — JSON.stringify already neutralizes structural
            // fence-breakout, so this is defense-in-depth/consistency only.
            const displayedEntry: PersistedUploadClassification = {
                ...entry,
                ...(freshStoredFilename ? { storedUploadFilename: freshStoredFilename } : {}),
                fileName: sanitizeUploadFileNameForDisplay(entry.fileName),
                ...(entry.summary ? { summary: sanitizeUploadFileNameForDisplay(entry.summary) } : {}),
            }
            conversationContextMessages.push({
                role: 'user',
                content: [
                    `## Upload Classification\n\n\`\`\`json\n${JSON.stringify(displayedEntry, null, 2)}\n\`\`\``,
                    '',
                    locationLine,
                    '',
                    handling,
                ].join('\n'),
                insertionOrder: 'after_history'
            })
        }

        const memorySummary = await this.loadConversationSummary(context)
        if (memorySummary) {
            const memoryContent = this.formatMemorySummary(memorySummary)
            // SECURITY: Memory is injected as USER message, not system message
            // User-derived content (conversation summaries) must not be elevated to system prompt privilege
            // System prompts have higher trust and could enable prompt injection attacks
            conversationContextMessages.push({
                role: 'user',
                content: memoryContent,
                insertionOrder: 'before_history',
                cachePoint: { type: 'ephemeral' }
            })
        }

        // Forward app context messages (stable, secrets, media_slots) with their
        // configured insertionOrder. All are 'after_history' to avoid invalidating
        // the cached prefix when the agent edits files.
        // NOTE: Must be 'user' role because Anthropic requires all system messages to be
        // contiguous at the start. Memory (user) comes before this, so this must also be user.
        for (const msg of contextMessages) {
            if (msg.type?.startsWith('app_context_')) {
                conversationContextMessages.push({
                    role: 'user',
                    content: msg.content,
                    // All app_context_* messages should carry explicit insertionOrder from
                    // buildAppContextMessage(). Fallback is defensive only — if this fires,
                    // it means a new app_context type was added without setting insertionOrder.
                    insertionOrder: msg.insertionOrder || 'after_history',
                })
            }
        }

        // Process generic context attachments using the registry
        if (context.contextAttachments && Array.isArray(context.contextAttachments) && context.contextAttachments.length > 0) {
            try {
                // The current user message drives upload classification
                // (e.g. "use this as the hero" vs "make it look like this").
                // It is populated on context.metadata._userMessage by the shared
                // transport layer before contextProvider runs; without it the
                // FileUploadContextRenderer classifier sees no intent signal.
                const userPrompt = (context.metadata?._userMessage as string | undefined) ?? ''
                const attachmentMessages = await this.processContextAttachments(
                    context.contextAttachments,
                    userPrompt,
                    context
                )
                conversationContextMessages.push(...attachmentMessages)

                // Collect vision inputs (base64 images) from attachment renderers
                const allAssetImages: string[] = []
                for (const msg of attachmentMessages) {
                    if (msg.assetImages && msg.assetImages.length > 0) {
                        allAssetImages.push(...msg.assetImages)
                    }
                }
                if (allAssetImages.length > 0) {
                    formattedContexts.push({
                        type: 'selected_assets_context',
                        content: '',
                        assetImages: allAssetImages
                    })
                }
            } catch (error) {
                logger.error('context.attachments.processing.error', {
                    error: error instanceof Error ? error.message : String(error),
                    attachmentCount: context.contextAttachments.length
                })
            }
        }

        logger.info('context.build.success', {
            messageCount: conversationContextMessages.length
        })

        // Detailed logging if enabled
        if (contextLogging.detailed) {
            logger.debug('context.build.breakdown', {
                staticSystemPromptLength: baseSystemPrompt.length,
                totalContextLength: conversationContextMessages.reduce((sum, msg) => sum + msg.content.length, 0),
                messageCount: conversationContextMessages.length
            })
        }

        return {
            systemPrompt: baseSystemPrompt,
            contextMessages: conversationContextMessages,
            formattedContexts
        }
    }

    private async loadConversationSummary(context: EnhancedAgentContext): Promise<{
        text: string
        tokenCount: number
        originalTokenCount: number
    } | null> {
        const appId = context.metadata?.appId as string | undefined
        if (!appId) {
            return null
        }

        // Use pinned summary from ConversationHistoryLoader when available to ensure
        // both summary loading paths use the same version, preventing cache invalidation
        const pinnedId = this.conversationContextManager.getHistoryLoader().getPinnedSummaryId(appId)
        const scope = workspaceScopeFromAppId(appId, customerIdFromContext(context))
        let latestSummary: Awaited<ReturnType<SummaryStore['findLatestForApp']>> = null
        if (pinnedId) {
            const pinned = await this.summaryStore.findById(pinnedId)
            // Validate the pinned summary belongs to this app as a safety net
            if (pinned && pinned.appId !== appId) {
                logger.warn('context.summary.pinned_app_mismatch', {
                    appId,
                    pinnedSummaryId: pinnedId,
                    pinnedAppId: pinned.appId,
                })
            }
            latestSummary = pinned?.appId === appId ? pinned : null
        }
        if (!latestSummary) {
            latestSummary = await this.summaryStore.findLatestForApp(scope)
        }
        if (!latestSummary) {
            return null
        }

        // Data integrity check: Verify the summary's message range end still exists
        // NOTE: This adds an extra DB lookup on every context build with summaries.
        // Future optimization: Move this validation into findLatestForApp or rely on FK constraints
        const rangeEnd = latestSummary.messageRangeEnd
        if (rangeEnd) {
            const rangeEndExists = await this.messageStore.getMessageById(rangeEnd)
            if (!rangeEndExists) {
                logger.warn('context.summary.range_end_missing', {
                    appId,
                    summaryId: latestSummary.id,
                    messageRangeEnd: rangeEnd
                })
                return null
            }
        }

        logger.info('context.summary.memory_injected', {
            appId,
            summaryTokens: latestSummary.summaryTokenCount,
            originalTokens: latestSummary.originalTokenCount,
            hasOperationLog: !!latestSummary.operationLog
        })

        return {
            text: latestSummary.summaryText,
            tokenCount: latestSummary.summaryTokenCount,
            originalTokenCount: latestSummary.originalTokenCount
        }
    }

    private formatMemorySummary(summary: { text: string }): string {
        return ['# Memory', summary.text].join('\n\n')
    }

    /**
     * Build context messages for various context types
     * @param context - Enhanced agent context
     * @param agentPreferences - Optional agent-specific context preferences
     * @returns Array of context messages
     */
    private async buildRichContextMessages(context: EnhancedAgentContext, agentPreferences?: AgentContextPreferences): Promise<{
        contextMessages: ContextMessage[]
        formattedContexts: FormattedContext[]
    }> {
        const messages: ContextMessage[] = []
        const formattedContexts: FormattedContext[] = []

        // Merge agent preferences with default config (agent preferences take priority)
        const effectiveConfig: ContextGenerationConfig = {
            ...this.config,
            ...(agentPreferences?.includeAppContext !== undefined && { includeAppContext: agentPreferences.includeAppContext }),
            ...(agentPreferences?.includeConversationHistory !== undefined && { includeConversationHistory: agentPreferences.includeConversationHistory }),
            ...(agentPreferences?.maxHistoryMessages !== undefined && { maxHistoryMessages: agentPreferences.maxHistoryMessages }),
            ...(agentPreferences?.maxDirectoryDepth !== undefined && { maxDirectoryDepth: agentPreferences.maxDirectoryDepth })
        }

        try {
            // Build app context (returns array with stable + dynamic parts)
            if (effectiveConfig.includeAppContext && context.appContext && context.metadata?.appId) {
                const appContextMessages = await this.buildAppContextMessage(context)
                if (appContextMessages.length > 0) {
                    messages.push(...appContextMessages)
                }
            }
        } catch (error) {
            logger.error('context.messages.build.failure', {
                error: error instanceof Error ? error.message : String(error)
            })
        }

        return {
            contextMessages: messages,
            formattedContexts
        }
    }

    /**
     * Process context attachments using the registry system
     */
    private async processContextAttachments(
        attachments: ContextAttachment[],
        userPrompt: string,
        context: EnhancedAgentContext
    ): Promise<AttachmentContextMessage[]> {
        const messages: AttachmentContextMessage[] = []
        
        const appId = context.metadata?.appId as string
        const contextLogger = appId ? log.forApp(appId) : logger

        contextLogger.info('context.attachments.processing', {
            count: attachments.length,
            types: attachments.map(a => a.type)
        })

        for (const attachment of attachments) {
            try {
                const renderContext: { appId?: string; appPath?: string; conversationId?: string; isContinuation?: boolean } = {}

                if (context.metadata?.appId) renderContext.appId = context.metadata.appId as string
                if (context.metadata?.appPath) renderContext.appPath = context.metadata.appPath as string
                if (context.conversation?.conversationId) renderContext.conversationId = context.conversation.conversationId
                // Handoff/auto-continue turns re-feed the same attachment with a
                // non-user prompt — let the upload renderers skip re-classifying.
                if (context.metadata?.__isContinuationTurn) renderContext.isContinuation = true
                
                const rendered = await contextAttachmentRegistry.render(
                    attachment,
                    userPrompt,
                    renderContext
                )

                if (rendered) {
                    messages.push({
                        role: rendered.role || 'user',
                        content: rendered.content,
                        insertionOrder: rendered.insertionOrder || 'after_history',
                        ...(rendered.cachePoint && { cachePoint: rendered.cachePoint }),
                        ...(rendered.assetImages && rendered.assetImages.length > 0 && { assetImages: rendered.assetImages })
                    })

                    contextLogger.debug('context.attachment.rendered', {
                        type: attachment.type,
                        role: rendered.role,
                        insertionOrder: rendered.insertionOrder,
                        contentLength: rendered.content.length
                    })
                }
            } catch (error) {
                contextLogger.error('context.attachment.render.error', {
                    type: attachment.type,
                    error: error instanceof Error ? error.message : String(error)
                })
            }
        }

        return messages
    }

    /**
     * Build app context messages using AppContextManager
     * Returns separate messages for stable (cached) and dynamic (after_history) context
     */
    private async buildAppContextMessage(context: EnhancedAgentContext): Promise<ContextMessage[]> {
        try {
            const appId = context.metadata?.appId as string
            const contextLogger = appId ? log.forApp(appId) : logger

            contextLogger.debug('context.app.build.start', {
                hasMetadata: !!context.metadata,
                appPath: context.metadata?.appPath,
                hasAppContext: !!context.appContext
            })

            const executionContext = this.buildExecutionContext(context)

            contextLogger.debug('context.execution.built', {
                threadId: executionContext.threadId,
                hasMetadata: !!executionContext.metadata,
                metadataAppPath: executionContext.metadata?.appPath
            })

            const appContextResult = await this.appContextManager.generateContextMessage(executionContext)

            const messages: ContextMessage[] = []

            // Stable context (package info, color scheme) placed after_history to avoid
            // invalidating the cached prefix when the agent edits files (e.g., package.json)
            if (appContextResult.stableContext) {
                messages.push({
                    role: 'user',
                    content: appContextResult.stableContext,
                    type: 'app_context_stable',
                    insertionOrder: 'after_history'
                })
            }

            // Dynamic contexts (secrets, media slots) go after history to prevent cache invalidation
            if (appContextResult.secretsContext) {
                messages.push({
                    role: 'user',
                    content: appContextResult.secretsContext,
                    type: 'app_context_secrets',
                    insertionOrder: 'after_history'
                })
            }

            if (appContextResult.mediaSlotsContext) {
                messages.push({
                    role: 'user',
                    content: appContextResult.mediaSlotsContext,
                    type: 'app_context_media_slots',
                    insertionOrder: 'after_history'
                })
            }

            if (appContextResult.gitStatusContext) {
                messages.push({
                    role: 'user',
                    content: appContextResult.gitStatusContext,
                    type: 'app_context_git_status',
                    insertionOrder: 'after_history'
                })
            }

            if (appContextResult.publishStateContext) {
                messages.push({
                    role: 'user',
                    content: appContextResult.publishStateContext,
                    type: 'app_context_publish_state',
                    insertionOrder: 'after_history'
                })
            }

            if (appContextResult.commerceContext) {
                messages.push({
                    role: 'user',
                    content: appContextResult.commerceContext,
                    type: 'app_context_commerce',
                    insertionOrder: 'after_history'
                })
            }

            if (messages.length === 0) {
                contextLogger.debug('context.app.build.empty', {
                    reason: 'AppContextManager returned no content'
                })
                return []
            }

            contextLogger.info('context.app.build.success', {
                stableContextLength: appContextResult.stableContext?.length || 0,
                secretsContextLength: appContextResult.secretsContext?.length || 0,
                mediaSlotsContextLength: appContextResult.mediaSlotsContext?.length || 0,
                gitStatusContextLength: appContextResult.gitStatusContext?.length || 0,
                publishStateContextLength: appContextResult.publishStateContext?.length || 0,
                commerceContextLength: appContextResult.commerceContext?.length || 0,
                totalMessages: messages.length
            })

            const contextLogging = getAgentConfig.contextLogging()
            if (contextLogging.appContextContent) {
                contextLogger.debug('context.app.content', {
                    stableContext: appContextResult.stableContext,
                    secretsContext: appContextResult.secretsContext,
                    mediaSlotsContext: appContextResult.mediaSlotsContext,
                    gitStatusContext: appContextResult.gitStatusContext,
                    publishStateContext: appContextResult.publishStateContext,
                    commerceContext: appContextResult.commerceContext
                })
            }

            return messages
        } catch (error) {
            logger.error('context.app.build.failure', {
                error: error instanceof Error ? error.message : String(error)
            })
            return []
        }
    }

    /**
     * Build execution context for compatibility with existing services
     */
    private buildExecutionContext(context: EnhancedAgentContext): AgentExecutionContext {
        // Resolve appPath from appId using AppRepository
        let appPath = ''
        const appId = context.metadata?.appId as string

        if (appId) {
            const contextLogger = log.forApp(appId)
            const app = this.appRepository.findById(appId)
            if (app) {
                appPath = app.path
                contextLogger.debug('context.app.path.resolved', { appPath })
            } else {
                contextLogger.warn('context.app.path.not_found', {})
            }
        }

        return {
            threadId: 'ai-lib-context-' + Date.now(),
            timestamp: new Date(),
            metadata: {
                appId: context.metadata?.appId,
                appPath, // Resolved from AppRepository
                ...context.metadata
            }
        }
    }

    /**
     * Convert raw app context to enhanced agent context (no optimization, include all available context)
     * @param rawContext - Raw app context from frontend
     * @returns Enhanced agent context with all available sections
     */
    convertToEnhancedContext(rawContext: AgentsAppContext): EnhancedAgentContext {
        // Always show concise conversion summary
        const availableContexts = Object.keys(rawContext).filter(key => rawContext[key as keyof AgentsAppContext])

        logger.info('context.conversion.start', {
            availableSections: availableContexts.length,
            sections: availableContexts
        })

        // Detailed logging if enabled
        const contextLogging = getAgentConfig.contextLogging()
        if (contextLogging.detailed) {
            logger.debug('context.conversion.details', {
                originalContextKeys: availableContexts,
                hasMetadata: !!rawContext.metadata,
                hasConversation: !!rawContext.conversation,
                hasAppContext: !!rawContext.appContext,
                hasContextAttachments: !!rawContext.contextAttachments
            })
        }

        // Simply convert the structure, keeping all available context
        const enhancedContext: EnhancedAgentContext = {
            metadata: rawContext.metadata || {},
            ...(rawContext.conversation && { conversation: rawContext.conversation }),
            ...(rawContext.appContext && { appContext: rawContext.appContext }),
            ...(rawContext.contextAttachments && { contextAttachments: rawContext.contextAttachments })
        }

        return enhancedContext
    }


    /**
     * Get conversation summary for debugging
     */
    async getConversationSummary(conversationId: string): Promise<{
        totalMessages: number
        recentMessages: number
        messageTypes: Record<string, number>
    }> {
        return this.conversationContextManager.getConversationSummary(conversationId)
    }

    /**
     * Get template description based on app context
     * @param context - Enhanced agent context containing app metadata
     * @returns Template description content or null if not available
     */
    private async getTemplateDescription(context: EnhancedAgentContext): Promise<string | null> {
        // Extract appId from context metadata
        const appId = context.metadata?.appId as string
        if (!appId) {
            logger.debug('context.template.skip', {
                reason: 'No appId found in context metadata'
            })
            return null
        }

        const contextLogger = log.forApp(appId)

        // Look up app path using AppRepository
        const app = this.appRepository.findById(appId)
        if (!app) {
            contextLogger.warn('context.template.app_not_found', {
                reason: 'App not found in repository'
            })
            return null
        }

        const appPath = app.path
        contextLogger.debug('context.template.version_check', { appPath })

        // Get validated template version from app directory
        const validatedVersion = getValidatedTemplateVersion(appPath)
        if (!validatedVersion) {
            contextLogger.debug('context.template.no_version', {
                reason: 'No valid template version found'
            })
            return null
        }

        // Get template description file path
        // Note: We need to handle both source (src/) and compiled (dist/) locations
        let templateDescPath = getTemplateDescriptionPath(validatedVersion, import.meta.url)

        // If the path doesn't exist (likely because we're running from dist/),
        // try to find it in the source directory
        if (!existsSync(templateDescPath)) {
            // Construct path to source directory
            const currentDir = path.dirname(fileURLToPath(import.meta.url))
            const sourcePromptsDir = path.resolve(currentDir, '..', '..', '..', 'src', 'prompts')
            templateDescPath = path.join(sourcePromptsDir, 'template-descriptions', `${validatedVersion}.md`)

            contextLogger.debug('context.template.path.fallback', { templateDescPath })
        }

        if (!existsSync(templateDescPath)) {
            contextLogger.warn('context.template.file_not_found', { templateDescPath })
            return null
        }

        try {
            const templateDescription = readFileSync(templateDescPath, 'utf-8')
            const trimmedDescription = templateDescription.trim()

            contextLogger.info('context.template.load.success', {
                templateVersion: validatedVersion,
                contentLength: trimmedDescription.length,
                filePath: templateDescPath
            })

            const contextLogging = getAgentConfig.contextLogging()
            if (contextLogging.templateContent) {
                contextLogger.debug('context.template.content', {
                    templateVersion: validatedVersion,
                    content: trimmedDescription
                })
            }

            // Append color system descriptions unless an upload provides its own color tokens
            const hasDesignUpload = context.contextAttachments?.some(
                (a: ContextAttachment) => a.type === 'ui_kit_upload' || (a.type === 'file_upload' && (a.data as any)?.isDesignMd)
            )
            if (!hasDesignUpload) {
                const colorSystemPath = templateDescPath.replace('.md', '-color-system.md')
                if (existsSync(colorSystemPath)) {
                    const colorSystem = readFileSync(colorSystemPath, 'utf-8').trim()
                    return trimmedDescription + '\n\n' + colorSystem
                }
            }

            return trimmedDescription
        } catch (error) {
            contextLogger.error('context.template.read.failure', {
                templateDescPath,
                error: error instanceof Error ? error.message : String(error)
            })
            return null
        }
    }

}

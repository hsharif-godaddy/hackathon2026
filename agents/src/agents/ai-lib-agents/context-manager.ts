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
import { logger, log } from '../../logging/index.js'
import { getAgentConfig } from '../../services/features.js'
import type { FormattedContext } from '../../services/helpers/ContextFormatter.js'

import type { AgentExecutionContext } from '../../base/agent.interface.js'
import type { AgentsAppContext } from '../../types/websocket-context.js'
import { getValidatedTemplateVersion, getTemplateDescriptionPath } from '../../utils/prompt-utils.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { contextAttachmentRegistry } from '../../services/ContextAttachmentRegistry.js'
import type { ContextAttachment } from '@airo/shared/context-attachment'

type AttachmentContextMessage = {
  role: 'user' | 'system'
  content: string
  insertionOrder?: 'before_history' | 'after_history'
  cachePoint?: { type: 'ephemeral' }
  assetImages?: string[]
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
                const attachmentMessages = await this.processContextAttachments(
                    context.contextAttachments,
                    '', // User prompt not available at this stage
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
                const renderContext: { appId?: string; appPath?: string; conversationId?: string } = {}
                
                if (context.metadata?.appId) renderContext.appId = context.metadata.appId as string
                if (context.metadata?.appPath) renderContext.appPath = context.metadata.appPath as string
                if (context.conversation?.conversationId) renderContext.conversationId = context.conversation.conversationId
                
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
                totalMessages: messages.length
            })

            const contextLogging = getAgentConfig.contextLogging()
            if (contextLogging.appContextContent) {
                contextLogger.debug('context.app.content', {
                    stableContext: appContextResult.stableContext,
                    secretsContext: appContextResult.secretsContext,
                    mediaSlotsContext: appContextResult.mediaSlotsContext,
                    gitStatusContext: appContextResult.gitStatusContext,
                    publishStateContext: appContextResult.publishStateContext
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

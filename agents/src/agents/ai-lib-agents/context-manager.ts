/**
 * AI-Lib Context Manager
 * Integrates ConversationContextManager capabilities with ai-lib agents
 */

import type { ModelMessage, ToolModelMessage, UserModelMessage, AssistantModelMessage } from 'ai'
import { ConversationContextManager } from '../../services/ConversationContextManager.js'
import { isAIToolMessage, isOpenAIMessage, getMessageContent } from '../../services/ConversationHistoryLoader.js'
import { AppContextManager } from '../../services/AppContextManager.js'
import { conversationRepository } from '../../database/repositories/index.js'
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
import type { ContextAttachment } from '../../types/context-attachment.js'

type AttachmentContextMessage = {
  role: 'user' | 'system'
  content: string
  insertionOrder?: 'before_history' | 'after_history'
  cachePoint?: { type: 'ephemeral' }
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

    constructor(config: Partial<ContextGenerationConfig> = {}) {
        // Use singleton conversation repository to ensure hooks work correctly
        this.conversationContextManager = new ConversationContextManager(
            conversationRepository,
            config.maxHistoryMessages || DEFAULT_CONTEXT_CONFIG.maxHistoryMessages
        )
        this.appContextManager = new AppContextManager()
        this.appRepository = new AppRepository()
        this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config }
    }

    /**
     * Build context messages for conversation history
     * @param baseSystemPrompt - The base system prompt from markdown file (returned unchanged)
     * @param context - Enhanced agent context
     * @param agentPreferences - Optional agent-specific context preferences to override defaults
     * @returns Object with static system prompt and context messages
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
                insertionOrder: 'before_history',
                cachePoint: { type: 'ephemeral' }
            })
        }

        // Add app context as system message (second priority)
        const appContextMessages = contextMessages.filter(msg => msg.type === 'app_context')
        if (appContextMessages.length > 0) {
            conversationContextMessages.push({
                role: 'system',
                content: appContextMessages.map(msg => msg.content).join('\n\n'),
                insertionOrder: 'before_history',
                cachePoint: { type: 'ephemeral' }
            })
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

    /**
     * Build conversation history for ai-lib agents
     * @param context - Enhanced agent context
     * @returns Array of conversation messages in AI SDK v6 ModelMessage format
     */
    async buildConversationHistory(
        context: EnhancedAgentContext
    ): Promise<ModelMessage[]> {
        if (!this.config.includeConversationHistory || !context.conversation?.conversationId) {
            return []
        }

        try {
            // Use the existing ConversationContextManager to build messages
            const executionContext = this.buildExecutionContext(context)
            const llmMessages = await this.conversationContextManager.buildMessages(
                '', // Empty system prompt since we handle that separately
                'placeholder', // Placeholder user message
                context.conversation.conversationId,
                undefined, // aiEditContext now handled via contextAttachments
                executionContext
            )

            // Filter out system and placeholder messages, convert to AI SDK v6 format
            let messages: ModelMessage[] = []
            
            for (const msg of llmMessages) {
                if (msg.role === 'system' || msg.content === 'placeholder') {
                    continue
                }

                // Convert tool messages to AI SDK v6 ToolModelMessage format
                if (msg.role === 'tool') {
                    // If already in AI SDK v6 format
                    if (isAIToolMessage(msg)) {
                        const toolResult = msg.content[0]
                        const content = getMessageContent(msg)
                        if (!content || content.trim() === '') {
                            logger.warn('context.conversation_history.skipping_empty_tool_message', {
                                toolCallId: toolResult?.toolCallId,
                                toolName: toolResult?.toolName
                            })
                            continue
                        }
                        const toolMessage: ToolModelMessage = {
                            role: 'tool',
                            content: [{
                                type: 'tool-result',
                                toolCallId: toolResult?.toolCallId ?? '',
                                toolName: toolResult?.toolName ?? '',
                                output: { type: 'text', value: content }
                            }]
                        }
                        messages.push(toolMessage)
                        continue
                    }

                    // Handle OpenAI format tool messages
                    if (isOpenAIMessage(msg)) {
                        // Skip tool messages with empty content
                        if (!msg.content || msg.content.trim() === '') {
                            logger.warn('context.conversation_history.skipping_empty_tool_message', {
                                toolCallId: msg.tool_call_id,
                                toolName: msg.name
                            })
                            continue
                        }

                        // Skip tool messages without required IDs
                        if (!msg.tool_call_id || !msg.name) {
                            logger.warn('context.conversation_history.skipping_tool_message_missing_ids', {
                                toolCallId: msg.tool_call_id,
                                toolName: msg.name,
                                reason: 'Tool message missing required tool_call_id or name'
                            })
                            continue
                        }

                        const toolMessage: ToolModelMessage = {
                            role: 'tool',
                            content: [{
                                type: 'tool-result',
                                toolCallId: msg.tool_call_id,
                                toolName: msg.name,
                                output: {
                                    type: 'text',
                                    value: msg.content
                                }
                            }]
                        }
                        messages.push(toolMessage)
                        continue
                    }
                }

                // Handle assistant messages with tool calls
                if (msg.role === 'assistant') {
                    // Skip empty assistant messages without tool calls
                    if ((!msg.content || msg.content.trim() === '') && !msg.tool_calls) {
                        continue
                    }
                    
                    // Convert tool_calls to content array format (AI SDK v6)
                    if (msg.tool_calls && msg.tool_calls.length > 0) {
                        const contentParts: any[] = []
                        
                        // Add text content if present
                        if (msg.content && msg.content.trim()) {
                            contentParts.push({
                                type: 'text',
                                text: msg.content
                            })
                        }
                        
                        // Add tool calls as ToolCallPart objects
                        for (const toolCall of msg.tool_calls as any[]) {
                            let parsedArgs
                            try {
                                parsedArgs = JSON.parse(toolCall.function.arguments)
                            } catch (error) {
                                logger.warn('context.conversation_history.tool_call_parse_error', {
                                    toolCallId: toolCall.id,
                                    toolName: toolCall.function.name,
                                    arguments: toolCall.function.arguments,
                                    error: error instanceof Error ? error.message : String(error)
                                })
                                parsedArgs = {}
                            }
                            
                            contentParts.push({
                                type: 'tool-call',
                                toolCallId: toolCall.id,
                                toolName: toolCall.function.name,
                                input: parsedArgs  // ← Must be 'input', not 'args'
                            })
                        }
                        
                        const assistantMessage: AssistantModelMessage = {
                            role: 'assistant',
                            content: contentParts
                        }
                        messages.push(assistantMessage)
                        continue
                    }
                    
                    // Assistant message without tool calls - just text
                    const content = (msg.content && msg.content.trim()) ? msg.content : ' '
                    const assistantMessage: AssistantModelMessage = {
                        role: 'assistant',
                        content
                    }
                    messages.push(assistantMessage)
                    continue
                }

                // Handle user messages
                if (msg.role === 'user') {
                    // Skip empty user messages
                    if (!msg.content || msg.content.trim() === '') {
                        continue
                    }
                    const userMessage: UserModelMessage = {
                        role: 'user',
                        content: msg.content
                    }
                    messages.push(userMessage)
                    continue
                }
            }

            // Strip out tool calls that don't have corresponding tool results
            // This handles failed tool calls that never got a result saved
            const toolResultIds = new Set<string>()
            for (const msg of messages) {
                if (msg.role === 'tool') {
                    const content = (msg as ToolModelMessage).content
                    if (Array.isArray(content) && content[0]) {
                        const firstPart = content[0]
                        if ('toolCallId' in firstPart) {
                            toolResultIds.add(firstPart.toolCallId)
                        }
                    }
                }
            }
            
            // Filter out tool calls without matching results
            let strippedToolCallCount = 0
            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i]
                if (!msg || msg.role !== 'assistant') continue
                
                const content = (msg as AssistantModelMessage).content
                if (Array.isArray(content)) {
                    const originalLength = content.length
                    const filteredContent = content.filter((part: any) => {
                        if (part.type === 'tool-call') {
                            const hasResult = toolResultIds.has(part.toolCallId)
                            if (!hasResult) {
                                strippedToolCallCount++
                                logger.warn('context.conversation_history.stripping_tool_call_without_result', {
                                    toolCallId: part.toolCallId,
                                    toolName: part.toolName,
                                    reason: 'Tool call has no corresponding tool result (likely failed execution)'
                                })
                            }
                            return hasResult
                        }
                        return true
                    })
                    
                    // Update the message content if we filtered out any tool calls
                    if (filteredContent.length !== originalLength) {
                        (msg as AssistantModelMessage).content = filteredContent
                    }
                }
            }
            
            if (strippedToolCallCount > 0) {
                logger.info('context.conversation_history.stripped_orphaned_tool_calls', {
                    count: strippedToolCallCount,
                    reason: 'Removed tool calls without matching results to maintain message validity'
                })
            }

            // Filter out assistant messages with empty content arrays (can happen after stripping orphaned tool calls)
            messages = messages.filter(msg => {
                if (msg.role !== 'assistant') return true
                const content = (msg as AssistantModelMessage).content
                if (Array.isArray(content) && content.length === 0) {
                    logger.warn('context.conversation_history.skipping_empty_assistant_message', {
                        reason: 'Assistant message has empty content array after stripping orphaned tool calls'
                    })
                    return false
                }
                return true
            })

            // Strip out tool results that don't have corresponding tool calls
            // This handles cases where token limiting dropped the assistant tool-call message
            // but kept the tool result message (because token limiting processes backwards)
            const toolCallIds = new Set<string>()
            for (const msg of messages) {
                if (msg.role === 'assistant') {
                    const content = (msg as AssistantModelMessage).content
                    if (Array.isArray(content)) {
                        content.forEach((part: any) => {
                            if (part.type === 'tool-call') {
                                toolCallIds.add(part.toolCallId)
                            }
                        })
                    }
                }
            }

            // Filter out orphaned tool results
            const validMessages = messages.filter(msg => {
                if (msg.role !== 'tool') return true
                const content = (msg as ToolModelMessage).content
                if (Array.isArray(content) && content[0]) {
                    const firstPart = content[0]
                    if ('toolCallId' in firstPart) {
                        const hasToolCall = toolCallIds.has(firstPart.toolCallId)
                        if (!hasToolCall) {
                            logger.warn('context.conversation_history.stripping_orphaned_tool_result', {
                                toolCallId: firstPart.toolCallId,
                                toolName: 'toolName' in firstPart ? firstPart.toolName : 'unknown',
                                reason: 'Tool result has no corresponding tool call (likely dropped during token limiting)'
                            })
                        }
                        return hasToolCall
                    }
                }
                return true
            })

            const strippedToolResultCount = messages.length - validMessages.length
            if (strippedToolResultCount > 0) {
                logger.info('context.conversation_history.stripped_orphaned_tool_results', {
                    count: strippedToolResultCount,
                    reason: 'Removed tool results without matching tool calls to prevent AI SDK errors'
                })
            }

            return validMessages
        } catch (error) {
            logger.error('context.conversation_history.build.failure', {
                error: error instanceof Error ? error.message : String(error)
            })
            return []
        }
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
            // Build app context
            if (effectiveConfig.includeAppContext && context.appContext && context.metadata?.appId) {
                const appContextMessage = await this.buildAppContextMessage(context)
                if (appContextMessage) {
                    messages.push(appContextMessage)
                }
            }

            // Build hot files context
            if (context.metadata?.appId) {
                const hotFilesMessage = await this.buildHotFilesContextMessage(context)
                if (hotFilesMessage) {
                    messages.push(hotFilesMessage)
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
                        ...(rendered.cachePoint && { cachePoint: rendered.cachePoint })
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
     * Build hot files context message using FileContextManager
     */
    private async buildHotFilesContextMessage(context: EnhancedAgentContext): Promise<ContextMessage | null> {
        try {
            // Extract appId and resolve appPath from context metadata
            const appId = context.metadata?.appId as string
            if (!appId) {
                logger.debug('context.hot_files.skip', {
                    reason: 'No appId found in context metadata'
                })
                return null
            }

            const contextLogger = log.forApp(appId)

            // Look up app path using AppRepository
            const app = this.appRepository.findById(appId)
            if (!app) {
                contextLogger.warn('context.hot_files.app_not_found', {
                    reason: 'App not found in repository'
                })
                return null
            }

            // NOTE: Hot files are now automatically included during conversation history loading
            // via the HotFileInclusionStrategy compression strategy. This method returns null
            // as hot files are handled by the history loader during loadAllMessagesWithTokenLimit.
            contextLogger.debug('context.hot_files.skip', {
                reason: 'Hot files now handled by history loader compression'
            })
            return null
        } catch (error) {
            logger.error('context.hot_files.build.failure', {
                error: error instanceof Error ? error.message : String(error)
            })
            return null
        }
    }

    /**
     * Build app context message using AppContextManager
     */
    private async buildAppContextMessage(context: EnhancedAgentContext): Promise<ContextMessage | null> {
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

            const appContextContent = await this.appContextManager.generateContextMessage(executionContext)

            if (!appContextContent) {
                contextLogger.debug('context.app.build.empty', {
                    reason: 'AppContextManager returned null'
                })
                return null
            }

            contextLogger.info('context.app.build.success', {
                contentLength: appContextContent.length
            })

            const contextLogging = getAgentConfig.contextLogging()
            if (contextLogging.appContextContent) {
                contextLogger.debug('context.app.content', {
                    content: appContextContent
                })
            }

            return {
                role: 'user',
                content: appContextContent,
                type: 'app_context',
                insertionOrder: 'before_history' // Insert fresh context BEFORE conversation history
            }
        } catch (error) {
            logger.error('context.app.build.failure', {
                error: error instanceof Error ? error.message : String(error)
            })
            return null
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

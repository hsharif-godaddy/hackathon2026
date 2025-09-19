/**
 * AI-Lib Context Manager
 * Integrates ConversationContextManager capabilities with ai-lib agents
 */

import { ConversationContextManager } from '../../services/ConversationContextManager.js'
import { AppContextManager } from '../../services/AppContextManager.js'
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js'
import type { EnhancedAgentContext, ContextMessage, ContextGenerationConfig } from './types.js'
import { DEFAULT_CONTEXT_CONFIG } from './types.js'
import type { AgentExecutionContext } from '../../base/agent.interface.js'
import type { AgentsAppContext } from '../../types/websocket-context.js'

/**
 * AI-Lib Context Manager
 * Bridges the gap between ai-lib agents and the rich context system
 */
export class AILibContextManager {
    private conversationContextManager: ConversationContextManager
    private appContextManager: AppContextManager
    private config: ContextGenerationConfig

    constructor(config: Partial<ContextGenerationConfig> = {}) {
        this.conversationContextManager = new ConversationContextManager(
            new ConversationRepository(),
            config.maxHistoryMessages || DEFAULT_CONTEXT_CONFIG.maxHistoryMessages
        )
        this.appContextManager = new AppContextManager()
        this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config }
    }

    /**
     * Build context messages for conversation history
     * @param baseSystemPrompt - The base system prompt from markdown file (returned unchanged)
     * @param context - Enhanced agent context
     * @returns Object with static system prompt and context messages
     */
    async buildContextMessages(
        baseSystemPrompt: string,
        context: EnhancedAgentContext
    ): Promise<{
        systemPrompt: string
        contextMessages: Array<{ role: 'user' | 'system'; content: string }>
    }> {
        console.log('🎨 Building context messages (keeping system prompt static):', {
            hasMetadata: !!context.metadata,
            hasConversation: !!context.conversation,
            hasAppContext: !!context.appContext,
            hasAiEditContext: !!context.aiEditContext,
            hasVisualContext: !!context.visualContext,
            conversationMaxMessages: context.conversation?.maxMessages,
            appContextDepth: context.appContext?.maxDirectoryDepth
        })

        const contextMessages = await this.buildRichContextMessages(context)

        // If no context messages, return just the base prompt
        if (contextMessages.length === 0) {
            console.log('📝 No context messages generated, using static system prompt only')
            return {
                systemPrompt: baseSystemPrompt,
                contextMessages: []
            }
        }

        console.log('📋 Generated context messages:', {
            totalMessages: contextMessages.length,
            messageTypes: contextMessages.map(msg => msg.type),
            totalContextLength: contextMessages.reduce((sum, msg) => sum + msg.content.length, 0)
        })

        // Convert context messages to conversation format
        const conversationContextMessages: Array<{ role: 'user' | 'system'; content: string }> = []

        // Add app context as system message
        const appContextMessages = contextMessages.filter(msg => msg.type === 'app_context')
        if (appContextMessages.length > 0) {
            conversationContextMessages.push({
                role: 'system',
                content: `## Current Project Context\n\n${appContextMessages.map(msg => msg.content).join('\n\n')}`
            })
        }

        // Add visual context as system message
        const visualMessages = contextMessages.filter(msg => msg.type === 'visual_context')
        if (visualMessages.length > 0) {
            conversationContextMessages.push({
                role: 'system',
                content: `## User Visual Context\n\n${visualMessages.map(msg => msg.content).join('\n\n')}`
            })
        }

        // Add AI edit context as system message
        const aiEditMessages = contextMessages.filter(msg => msg.type === 'ai_edit_context')
        if (aiEditMessages.length > 0) {
            conversationContextMessages.push({
                role: 'system',
                content: `## Selected Element Context\n\n${aiEditMessages.map(msg => msg.content).join('\n\n')}`
            })
        }

        console.log('✅ Context messages built:', {
            staticSystemPromptLength: baseSystemPrompt.length,
            contextMessagesCount: conversationContextMessages.length,
            totalContextLength: conversationContextMessages.reduce((sum, msg) => sum + msg.content.length, 0)
        })

        return {
            systemPrompt: baseSystemPrompt,
            contextMessages: conversationContextMessages
        }
    }

    /**
     * Build conversation history for ai-lib agents
     * @param context - Enhanced agent context
     * @returns Array of conversation messages
     */
    async buildConversationHistory(
        context: EnhancedAgentContext
    ): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> {
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
                context.aiEditContext,
                executionContext
            )

            // Filter out system and placeholder messages, convert to ai-lib format
            return llmMessages
                .filter(msg => msg.role !== 'system' && msg.content !== 'placeholder')
                .map(msg => ({
                    role: msg.role as 'user' | 'assistant' | 'system',
                    content: msg.content
                }))
        } catch (error) {
            console.error('AILibContextManager: Error building conversation history:', error)
            return []
        }
    }

    /**
     * Build context messages for various context types
     * @param context - Enhanced agent context
     * @returns Array of context messages
     */
    private async buildRichContextMessages(context: EnhancedAgentContext): Promise<ContextMessage[]> {
        const messages: ContextMessage[] = []

        try {
            // Build app context
            if (this.config.includeAppContext && context.appContext && context.metadata?.appId) {
                const appContextMessage = await this.buildAppContextMessage(context)
                if (appContextMessage) {
                    messages.push(appContextMessage)
                }
            }

            // Build AI edit context
            if (this.config.includeAiEditContext && context.aiEditContext) {
                const aiEditMessage = this.buildAiEditContextMessage(context.aiEditContext)
                if (aiEditMessage) {
                    messages.push(aiEditMessage)
                }
            }

            // Build visual context
            if (this.config.includeVisualContext && context.visualContext) {
                const visualMessage = this.buildVisualContextMessage(context.visualContext)
                if (visualMessage) {
                    messages.push(visualMessage)
                }
            }
        } catch (error) {
            console.error('AILibContextManager: Error building context messages:', error)
        }

        return messages
    }

    /**
     * Build app context message using AppContextManager
     */
    private async buildAppContextMessage(context: EnhancedAgentContext): Promise<ContextMessage | null> {
        try {
            const executionContext = this.buildExecutionContext(context)
            const appContextContent = await this.appContextManager.generateContextMessage(executionContext)

            if (!appContextContent) {
                return null
            }

            return {
                role: 'user',
                content: appContextContent,
                type: 'app_context'
            }
        } catch (error) {
            console.error('AILibContextManager: Error building app context:', error)
            return null
        }
    }

    /**
     * Build AI edit context message
     */
    private buildAiEditContextMessage(aiEditContext: NonNullable<EnhancedAgentContext['aiEditContext']>): ContextMessage | null {
        try {
            const elementInfo = aiEditContext.elementInfo || {}
            const devContext = aiEditContext.devContext || {}

            // Sanitize and validate the context data
            const sanitizedContext = {
                element: {
                    tag: String(elementInfo.tagName || 'unknown').replace(/[<>]/g, ''),
                    classes: String(elementInfo.className || 'none').substring(0, 200),
                    id: String(elementInfo.id || 'none').substring(0, 100),
                    textContent: String(elementInfo.textContent || 'none').substring(0, 300),
                    selector: String(aiEditContext.selector || 'unknown').substring(0, 200)
                },
                source: {
                    fileName: String(devContext.fileName || 'unknown').substring(0, 200),
                    componentName: String(devContext.componentName || 'unknown').substring(0, 100),
                    lineNumber: Number.isInteger(devContext.lineNumber) ? devContext.lineNumber : 'unknown'
                }
            }

            const content = `[AI Edit Context - Selected Element]

Element Details:
- Tag: ${sanitizedContext.element.tag}
- Classes: ${sanitizedContext.element.classes}
- ID: ${sanitizedContext.element.id}
- Text Content: "${sanitizedContext.element.textContent}"
- CSS Selector: ${sanitizedContext.element.selector}

Source Code Location:
- File: ${sanitizedContext.source.fileName}
- Component: ${sanitizedContext.source.componentName}
- Line: ${sanitizedContext.source.lineNumber}

Instructions: The following user message refers to changes for this specific selected element. Focus your edits on the code at the specified file and location.`

            return {
                role: 'user',
                content,
                type: 'ai_edit_context'
            }
        } catch (error) {
            console.error('AILibContextManager: Error building AI edit context:', error)
            return null
        }
    }

    /**
     * Build visual context message
     */
    private buildVisualContextMessage(visualContext: NonNullable<EnhancedAgentContext['visualContext']>): ContextMessage | null {
        try {
            // Sanitize and validate the visual context data
            const sanitizedContext = {
                page: String(visualContext.page || '/').substring(0, 200),
                scroll_position: {
                    x: typeof visualContext.scroll_position?.x === 'number' && !isNaN(visualContext.scroll_position.x) ? visualContext.scroll_position.x : 0,
                    y: typeof visualContext.scroll_position?.y === 'number' && !isNaN(visualContext.scroll_position.y) ? visualContext.scroll_position.y : 0
                },
                active_section: visualContext.active_section ? String(visualContext.active_section).substring(0, 100) : 'unknown',
                viewport: {
                    width: (typeof visualContext.viewport?.width === 'number' && !isNaN(visualContext.viewport.width)) ? visualContext.viewport.width : 0,
                    height: (typeof visualContext.viewport?.height === 'number' && !isNaN(visualContext.viewport.height)) ? visualContext.viewport.height : 0
                },
                timestamp: visualContext.timestamp || Date.now()
            }

            let activePageSection = ''
            let contextNotes = ''

            if (sanitizedContext.active_section === 'dev-tools-initializing') {
                activePageSection = 'The user\'s preview application is loaded but visual context capture is still initializing.'
                contextNotes = 'The preview app is running and dev-tools are loading. The visual context system should be available shortly. Focus on understanding the user\'s intent from their message. When they say "this" or "here", ask for clarification about which specific element or section they\'re referring to.'
            } else if (sanitizedContext.active_section === 'iframe-blocked') {
                activePageSection = 'The user\'s preview application access is blocked or restricted.'
                contextNotes = 'Visual context cannot be captured due to technical restrictions. Focus on understanding the user\'s intent from their message context. When they use terms like "this" or "here", ask for clarification or provide general guidance.'
            } else if (sanitizedContext.active_section === 'no-iframe') {
                activePageSection = 'No preview application iframe was found.'
                contextNotes = 'The user may be referring to code or functionality in general. Focus on understanding their development needs and provide appropriate guidance.'
            } else if (sanitizedContext.active_section === 'unknown') {
                activePageSection = 'The active page section could not be determined.'
                contextNotes = `The user's message refers to content visible at their current scroll position (${sanitizedContext.scroll_position.y}px from top). When they say "this" or "here", try to understand from context what they're referring to.`
            } else {
                activePageSection = `The user is currently viewing the "${sanitizedContext.active_section}" section.`
                contextNotes = `The user's message refers to content visible at their current scroll position (${sanitizedContext.scroll_position.y}px from top). When they say "this" or "here", they likely mean elements visible in the "${sanitizedContext.active_section}" section around this scroll position.`
            }

            const content = `[User's Current Visual Context]

Page Information:
- Current Page: ${sanitizedContext.page}
- ${activePageSection}

Scroll Position:
- Horizontal: ${sanitizedContext.scroll_position.x}px
- Vertical: ${sanitizedContext.scroll_position.y}px

Viewport Size:
- Width: ${sanitizedContext.viewport.width}px
- Height: ${sanitizedContext.viewport.height}px

Context Notes: ${contextNotes}`

            return {
                role: 'user',
                content,
                type: 'visual_context'
            }
        } catch (error) {
            console.error('AILibContextManager: Error building visual context:', error)
            return null
        }
    }

    /**
     * Build execution context for compatibility with existing services
     */
    private buildExecutionContext(context: EnhancedAgentContext): AgentExecutionContext {
        return {
            threadId: 'ai-lib-context-' + Date.now(),
            timestamp: new Date(),
            metadata: {
                appId: context.metadata?.appId,
                appPath: '', // Will be resolved by AppContextManager
                visualContext: context.visualContext,
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
        console.log('📋 Converting raw context to enhanced context (all sections enabled):', {
            originalContextKeys: Object.keys(rawContext).filter(key => rawContext[key as keyof AgentsAppContext]),
            hasMetadata: !!rawContext.metadata,
            hasConversation: !!rawContext.conversation,
            hasAppContext: !!rawContext.appContext,
            hasAiEditContext: !!rawContext.aiEditContext,
            hasVisualContext: !!rawContext.visualContext
        })

        // Simply convert the structure, keeping all available context
        const enhancedContext: EnhancedAgentContext = {
            metadata: rawContext.metadata || {},
            ...(rawContext.conversation && { conversation: rawContext.conversation }),
            ...(rawContext.appContext && { appContext: rawContext.appContext }),
            ...(rawContext.aiEditContext && { aiEditContext: rawContext.aiEditContext }),
            ...(rawContext.visualContext && { visualContext: rawContext.visualContext })
        }

        console.log('✅ Context conversion complete:', {
            enhancedContextKeys: Object.keys(enhancedContext).filter(key => enhancedContext[key as keyof EnhancedAgentContext]),
            allSectionsEnabled: true
        })

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

}

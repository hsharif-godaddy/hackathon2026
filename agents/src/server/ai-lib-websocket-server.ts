/**
 * AI-Lib WebSocket Server Implementation
 * Updated to use ExperimentalAgentFactory system
 */

import { Server as HTTPServer } from 'http'
import { createExperimentalWebSocketServer, type ConversationHistoryProvider } from '@airo/ai-lib'
import { 
  createWebSocketAgentFactory,
  aiLibAgentMetadata
} from '../agents/ai-lib-agents/index.js'
import { AILibContextManager } from '../agents/ai-lib-agents/context-manager.js'
import { AgentsMessagePersistence } from './conversation-persistence.js'
import { ConversationContextManager } from '../services/ConversationContextManager.js'
import { ConversationRepository } from '../database/repositories/ConversationRepository.js'
import { logger } from '../logging/index.js'
import { MAX_PROMPT_LENGTH } from '../services/features.js'
import type { AgentsAppContext } from '../types/websocket-context.js'

/**
 * Context logging configuration
 */
interface ContextLoggingConfig {
  /** Enable detailed context logging (default: false) */
  detailed: boolean
  /** Enable app context content logging (default: false) */
  appContextContent: boolean
  /** Enable template description content logging (default: false) */
  templateContent: boolean
  /** Enable visual context details (default: false) */
  visualContextDetails: boolean
  /** Enable raw context data logging (default: false) */
  rawContextData: boolean
}

/**
 * Create context logging configuration from environment variables
 */
function createContextLoggingConfig(): ContextLoggingConfig {
  return {
    detailed: process.env.DEBUG_CONTEXT_DETAILED === 'true',
    appContextContent: process.env.DEBUG_APP_CONTEXT_CONTENT === 'true',
    templateContent: process.env.DEBUG_TEMPLATE_CONTENT === 'true', 
    visualContextDetails: process.env.DEBUG_VISUAL_CONTEXT === 'true',
    rawContextData: process.env.DEBUG_RAW_CONTEXT === 'true'
  }
}

/**
 * Create and setup the AI-Lib WebSocket server
 */
export async function setupAILibWebSocketServer(httpServer: HTTPServer) {
  console.log('🚀 Setting up ExperimentalAgentFactory WebSocket server with conversation persistence...')
  
  // Create context logging configuration
  const contextLoggingConfig = createContextLoggingConfig()
  console.log('🎛️ Context logging configuration:', {
    summary: 'Always enabled (concise)',
    detailed: contextLoggingConfig.detailed ? 'Enabled (DEBUG_CONTEXT_DETAILED=true)' : 'Disabled',
    appContextContent: contextLoggingConfig.appContextContent ? 'Enabled (DEBUG_APP_CONTEXT_CONTENT=true)' : 'Disabled',
    templateContent: contextLoggingConfig.templateContent ? 'Enabled (DEBUG_TEMPLATE_CONTENT=true)' : 'Disabled',
    visualContextDetails: contextLoggingConfig.visualContextDetails ? 'Enabled (DEBUG_VISUAL_CONTEXT=true)' : 'Disabled',
    rawContextData: contextLoggingConfig.rawContextData ? 'Enabled (DEBUG_RAW_CONTEXT=true)' : 'Disabled'
  })
  
  // Enable debug logging if requested
  if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
    console.log('🔍 Conversation history debug logging enabled')
  }
  
  if (process.env.DEBUG_AI_REQUESTS === 'true') {
    console.log('🔍 AI request debug logging enabled')
    // Enable AI SDK debug logging
    process.env.DEBUG = 'ai:*'
  }

  try {
    // Create the agent factory
    const agentFactory = await createWebSocketAgentFactory()
    
    // Create context manager for app context and template descriptions
    const contextManager = new AILibContextManager({}, contextLoggingConfig)
    
    // Create message persistence implementation
    const messagePersistence = new AgentsMessagePersistence()
    
    // Create token-based conversation history provider
    const conversationRepo = new ConversationRepository()
    const conversationContextManager = new ConversationContextManager(conversationRepo, 10) // Max 10 messages
    
    // Create system context message provider with configurable logging
    const systemContextProvider = {
      async loadSystemContextMessages(context?: Record<string, unknown>): Promise<Array<{ role: 'system', content: string }>> {
        // Always show concise summary
        console.log('🎯 SystemContext: Loading context messages')
        
        if (!context) {
          console.log('⚠️ SystemContext: No context provided')
          return []
        }
        
        try {
          // Convert to enhanced context and enrich with app context and template descriptions
          const agentsAppContext = context as AgentsAppContext
          
          // Detailed logging if enabled
          if (contextLoggingConfig.detailed) {
            console.log('🔍 SystemContext: Converting to enhanced context:', {
              rawContextKeys: Object.keys(agentsAppContext),
              hasMetadata: !!agentsAppContext.metadata,
              hasAppContext: !!agentsAppContext.appContext,
              hasVisualContext: !!agentsAppContext.visualContext,
              hasAiEditContext: !!agentsAppContext.aiEditContext
            })
          }
          
          // Raw context data logging if enabled
          if (contextLoggingConfig.rawContextData) {
            console.log('📋 SystemContext: Raw context data:', agentsAppContext)
          }
          
          const enhancedContext = contextManager.convertToEnhancedContext(agentsAppContext)
          
          // Build context messages including app context and template descriptions
          const contextResult = await contextManager.buildContextMessages('', enhancedContext)
          
          // Always show summary
          const contextTypes = contextResult.contextMessages.map(msg => 
            msg.content.includes('## Template Framework Description') ? 'template' :
            msg.content.includes('## Current Project Context') ? 'app' :
            msg.content.includes('## User Visual Context') ? 'visual' :
            msg.content.includes('## Selected Element Context') ? 'element' : 'unknown'
          )
          
          console.log(`✅ SystemContext: Built ${contextResult.contextMessages.length} messages [${contextTypes.join(', ')}]`)
          
          // Detailed context breakdown if enabled
          if (contextLoggingConfig.detailed) {
            contextResult.contextMessages.forEach((msg, index) => {
              const msgType = contextTypes[index]
              console.log(`📄 SystemContext Message ${index + 1} (${msgType}): ${msg.content.length} chars`)
            })
          }
          
          // Return as system messages
          return contextResult.contextMessages.map(msg => ({
            role: 'system' as const,
            content: msg.content
          }))
        } catch (error) {
          console.error('❌ SystemContext: Error loading context:', error)
          return []
        }
      }
    }
    
    const conversationHistoryProvider = {
      async loadConversationHistory(conversationId: string, context?: Record<string, unknown>): Promise<Array<{ role: 'user' | 'assistant', content: string }>> {
        if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
          console.log('📚 TokenBasedHistoryProvider: Loading conversation history')
        }
        
        // Extract appId and agentName from context
        const metadata = (context?.metadata as any) || {}
        const appId = metadata.appId
        const agentName = metadata.agentId || 'develop' // Default to develop agent
        
        if (!appId) {
          console.warn('⚠️ No appId found in context, cannot load conversation history')
          return []
        }
        
        if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
          console.log(`📚 Loading ALL messages for app: ${appId}, agent: ${agentName}`)
        }
        
        try {
          // Use the new token-based method with model name for accurate token counting
          // Based on model-selection.ts, all agents currently use 'claude4'
          const modelName = 'claude4'
          const messages = await conversationContextManager.loadAllMessagesWithTokenLimit(appId, agentName, 40000, modelName)
          
          if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
            console.log(`✅ TokenBasedHistoryProvider: Loaded ${messages.length} messages`)
          }
          
          // Filter out system and tool messages, and map to the expected format
          return messages
            .filter(msg => msg.role === 'user' || msg.role === 'assistant')
            .map(msg => ({
              role: msg.role as 'user' | 'assistant',
              content: msg.content || ''
            }))
        } catch (error) {
          console.error('❌ Error in TokenBasedHistoryProvider:', error)
          return []
        }
      }
    }
    
    // Create the WebSocket server with the agent factory and built-in persistence
    const wsServer = createExperimentalWebSocketServer(httpServer, {
      agents: agentFactory.agents,
      
      // Built-in message persistence
      messagePersistence,
      
      // Context extractor to validate appId and message length
      // Conversation history provider
      conversationHistoryProvider,
      
      // System context message provider (custom extension)
      systemContextProvider,
      
      // Context extractor to validate appId
      contextExtractor: (rawContext: Record<string, unknown>) => {
        // Extract appId from context metadata
        const metadata = rawContext.metadata as any
        const appId = metadata?.appId
        const message = rawContext.message as string
        
        if (!appId || typeof appId !== 'string') {
          throw new Error('appId is required in context.metadata.appId')
        }
        
        // Validate message length - same limit as frontend
        if (message && typeof message === 'string' && message.length > MAX_PROMPT_LENGTH) {
          throw new Error(`Message exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`)
        }
        
        console.log('✅ Validated appId:', appId)
        
        // DEBUG: Log the raw context being received
        console.log('🔍 Raw Context Received:', {
          keys: Object.keys(rawContext),
          hasMetadata: !!rawContext.metadata,
          hasAppContext: !!rawContext.appContext,
          hasVisualContext: !!rawContext.visualContext,
          hasAiEditContext: !!rawContext.aiEditContext,
          hasConversation: !!rawContext.conversation,
          messageLength: message?.length || 0,
          appId
        })
        
        // Log the full context for debugging (but don't modify it)
        console.log('📋 Full Raw Context Data:', rawContext)
        
        // Return the processed context unchanged
        return rawContext
      },
      
      // Connection handler
      onConnection: (socketId: string) => {
        console.log('🔌 WebSocket client connected:', socketId)
      },
      
      // Optional event handlers (persistence is now handled automatically)
      onMessageStart: async (socketId: string, message: string, agentName?: string, context?: Record<string, unknown>) => {
        // Message started
      },
      
      onMessageComplete: async (socketId: string, result: any, context?: Record<string, unknown>) => {
        // Message completed
      },
      
      onDisconnection: (socketId: string) => {
        console.log('🔌 WebSocket client disconnected:', socketId)
      }
    })

    console.log('📡 ExperimentalAgentFactory WebSocket server ready for connections')
    console.log(`🎯 Available agents: ${agentFactory.getAvailableAgents().map(a => a.id).join(', ')}`)
    console.log(`🔧 Default agent: develop`)
    console.log(`📊 Agent count: ${agentFactory.getAgentCount()}`)
    console.log(`🌐 Multi-agent mode: ${agentFactory.isMultiAgentMode()}`)
    console.log(`🏭 Agent handoffs: enabled`)
    console.log(`🎨 Tool execution hooks: enabled`)
    console.log(`📋 Handoff history tracking: enabled`)
    console.log(`💾 Conversation persistence: enabled (built-in)`)
    console.log(`🔄 Conversation history loading: enabled`)

    // Log agent factory details
    const availableAgents = agentFactory.getAvailableAgents()
    console.log('📋 Agent details:')
    availableAgents.forEach(agent => {
      const metadata = aiLibAgentMetadata[agent.id]
      console.log(`  - ${agent.id}: ${agent.name}`)
      console.log(`    ${agent.description}`)
      if (metadata) {
        console.log(`    Tools: ${metadata.toolGroups.join(', ')}`)
        console.log(`    Tags: ${metadata.tags.join(', ')}`)
      }
    })

    return { wsServer, agentFactory }

  } catch (error) {
    console.error('❌ Failed to setup ExperimentalAgentFactory WebSocket server:', error)
    logger.error('WebSocket server setup failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    throw error
  }
}

/**
 * Get WebSocket server info for health checks
 */
export function getWebSocketServerInfo() {
  return {
    agentIds: Object.keys(aiLibAgentMetadata),
    agentMetadata: aiLibAgentMetadata,
    defaultAgent: 'develop',
    totalAgents: Object.keys(aiLibAgentMetadata).length,
    serverType: 'ExperimentalAgentFactory',
    features: [
      'agent-handoffs',
      'tool-execution-hooks', 
      'handoff-history-tracking',
      'dynamic-system-prompts',
      'multi-agent-coordination'
    ]
  }
}

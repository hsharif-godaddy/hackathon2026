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
import { jwtAuthMiddleware } from './middleware/jwt-auth.js'
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
          // Convert assistant messages with tool calls to plain text for conversation history
          return messages
            .filter(msg => msg.role === 'user' || msg.role === 'assistant')
            .map(msg => {
              if (msg.role === 'assistant' && (msg as any).tool_calls) {
                // Convert tool calls to readable text for conversation history
                const toolCalls = (msg as any).tool_calls || []
                let content = msg.content || ''
                
                // Append tool call information as readable text
                if (toolCalls.length > 0) {
                  const toolDescriptions = toolCalls.map((toolCall: any) => {
                    try {
                      const toolName = toolCall.function?.name || 'unknown_tool'
                      const toolArgs = toolCall.function?.arguments
                      
                      // Try to parse and format the arguments safely
                      let formattedArgs = 'unknown_arguments'
                      if (toolArgs) {
                        try {
                          const parsedArgs = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs
                          // Create a safe, readable representation
                          if (typeof parsedArgs === 'object') {
                            formattedArgs = Object.entries(parsedArgs)
                              .map(([key, value]) => `${key}: ${String(value).substring(0, 100)}`)
                              .join(', ')
                          } else {
                            formattedArgs = String(parsedArgs).substring(0, 100)
                          }
                        } catch (jsonError) {
                          // If JSON parsing fails, use the raw string but truncate it
                          formattedArgs = `invalid_json: ${String(toolArgs).substring(0, 100)}`
                        }
                      }
                      
                      return `Called ${toolName} with: ${formattedArgs}`
                    } catch (error) {
                      return `Called tool with invalid data`
                    }
                  }).join('\n')
                  
                  content = content ? `${content}\n\n[Tool calls: ${toolDescriptions}]` : `[Tool calls: ${toolDescriptions}]`
                }
                
                return {
                  role: msg.role as 'user' | 'assistant',
                  content
                }
              } else {
                return {
                  role: msg.role as 'user' | 'assistant',
                  content: msg.content || ''
                }
              }
            })
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
      
      // Context extractor to validate appId
      contextExtractor: (rawContext: Record<string, unknown>, socketContext?: any) => {
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
        
        // Extract pre-validated customer data from Socket.IO middleware
        if (socketContext && socketContext.socket && socketContext.socket.handshake.auth) {
          const { customerContext } = socketContext.socket.handshake.auth;

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

          return {
            ...rawContext,
            customerContext // Use cached customer context (no more auth needed!)
          };
        }
        
        // Handle bypass for local development
        if (process.env.BYPASS_AUTH_FOR_LOCAL === 'true') {
          return {
            ...rawContext,
            customerContext: {
              customerId: 'local-dev-customer',
              shopperId: 'local-dev-shopper',
              siteId: appId
            }
          };
        }
        
        throw new Error('No customer context found - authentication may have failed at handshake');
      },
      
      // Connection handler
      onConnection: (socketId: string) => {
        console.log('🔌 WebSocket client connected:', socketId)
      },
      
      // Optional event handlers (persistence is now handled automatically)
      onMessageStart: async (socketId: string, message: string, agentName?: string, context?: Record<string, unknown>) => {
        // Authentication already done at handshake - just log the message start
        if (context && context.customerContext) {
          const customerContext = context.customerContext as any;
          console.log(`📨 WebSocket message from customer ${customerContext.customerId} (${customerContext.shopperId}): "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
        } else if (process.env.BYPASS_AUTH_FOR_LOCAL !== 'true') {
          throw new Error('Missing customer context - authentication may have failed');
        }
      },
      
      onMessageComplete: async (socketId: string, result: any, context?: Record<string, unknown>) => {
        const duration = result.duration || 'unknown';
        const steps = result.steps || 0;
        const agentId = result.agentId || 'unknown';
        
        console.log(`✅ WebSocket message completed for ${socketId}: ${steps} steps, ${duration} (agent: ${agentId})`);
        
        // Log customer context if available (for audit purposes)
        if (context?.customerContext) {
          const customerContext = context.customerContext as any;
          console.log(`📊 WebSocket request completed for customer: ${customerContext.customerId} (shopper: ${customerContext.shopperId})`);
        }
      },
      
      onDisconnection: (socketId: string) => {
        console.log('🔌 WebSocket client disconnected:', socketId)
      },
      
      onError: (socketId: string, error: Error, message?: string) => {
        // Check if this is a customer context error (auth-related)
        if (error.message.includes('customer context') || 
            error.message.includes('authentication may have failed')) {
          logger.error('WebSocket context error:', { 
            socketId, 
            error: error.message, 
            message: message ? message.substring(0, 100) : undefined,
            type: 'context_error'
          });
        } else {
          logger.error('WebSocket error:', { 
            socketId, 
            error: error.message, 
            message: message ? message.substring(0, 100) : undefined,
            type: 'general_error'
          });
        }
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

    // Add Socket.IO authentication middleware
    wsServer.getIO().use(async (socket, next) => {
      try {
        // Skip authentication for local development when explicitly disabled
        if (process.env.BYPASS_AUTH_FOR_LOCAL === 'true') {
          next();
          return;
        }

        // Extract JWT token from handshake
        const authHeader = socket.handshake.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          throw new Error('Missing or invalid Authorization header');
        }
        
        const token = authHeader.substring(7);
        
        // Do FULL JWT validation at handshake (including signature verification)
        console.log('🔐 Performing full JWT validation with SSO at handshake...');
        
        const validationResult = await jwtAuthMiddleware.jwtValidationService.authenticate(token);
        
        if (!validationResult.valid) {
          console.log(`❌ CONNECTION REJECTED: JWT validation failed - ${validationResult.reason}`);
          throw new Error(`JWT validation failed: ${validationResult.reason}`);
        }
        
        console.log(`✅ Connection approved: Full JWT validation passed for customer ${validationResult.payload?.cid}`);
        
        // Store validated user data in socket for reuse (no more SSO calls needed!)
        socket.handshake.auth = { 
          token, 
          decoded: validationResult.payload,
          customerContext: {
            customerId: validationResult.payload?.cid,
            shopperId: validationResult.payload?.shopperId,
            tokenExp: validationResult.payload?.exp
          }
        };
        
        // Add token refresh handler for this socket
        socket.on('tokenRefresh', async (data) => {
          try {
            console.log(`🔄 Token refresh requested for customer ${socket.handshake.auth.customerContext.customerId}`);
            
            const refreshResult = await jwtAuthMiddleware.jwtValidationService.authenticate(data.newToken);
            
            if (!refreshResult.valid) {
              console.log(`❌ Token refresh failed: ${refreshResult.reason}`);
              socket.emit('tokenRefreshError', { error: refreshResult.reason });
              return;
            }
            
            // Update socket auth data with new token
            socket.handshake.auth = {
              token: data.newToken,
              decoded: refreshResult.payload,
              customerContext: {
                customerId: refreshResult.payload?.cid,
                shopperId: refreshResult.payload?.shopperId,
                tokenExp: refreshResult.payload?.exp
              }
            };
            
            console.log(`✅ Token refreshed for customer ${refreshResult.payload?.cid}, expires: ${new Date(refreshResult.payload?.exp * 1000).toISOString()}`);
            socket.emit('tokenRefreshSuccess', { 
              newExpiry: refreshResult.payload?.exp,
              customerId: refreshResult.payload?.cid 
            });
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ Token refresh error: ${errorMessage}`);
            socket.emit('tokenRefreshError', { error: errorMessage });
          }
        });
        
        next(); // Allow connection
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Socket.IO auth failed: ${errorMessage}`);
        next(new Error(`Authentication failed: ${errorMessage}`));
      }
    });

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

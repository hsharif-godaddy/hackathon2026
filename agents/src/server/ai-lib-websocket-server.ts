/**
 * AI-Lib WebSocket Server Implementation
 * Updated to use ExperimentalAgentFactory system
 */

import { Server as HTTPServer } from 'http'
import { 
  createExperimentalWebSocketServer,
  type MessageProvider,
  type ContextProvider,
  type ConversationPersistence,
  type ConversationMessage,
  type PersistenceStreamingEvent,
  type ConversationContext
} from '@airo/ai-lib'
// Define ContextMessage interface locally (extends ConversationMessage with required insertionOrder)
interface ContextMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** Optional cache point for cost optimization */
  cachePoint?: { type: 'ephemeral' }
  /** When to insert this message relative to conversation history */
  insertionOrder: 'before_history' | 'after_history'
}
import { 
  createWebSocketAgentFactory,
  aiLibAgentMetadata
} from '../agents/ai-lib-agents/index.js'
import { AILibContextManager } from '../agents/ai-lib-agents/context-manager.js'
import { AgentsMessagePersistence } from './conversation-persistence.js'
import { ConversationContextManager } from '../services/ConversationContextManager.js'
import { ConversationRepository } from '../database/repositories/ConversationRepository.js'
import { fileContextRegistry } from '../services/FileContextRegistry.js'
import { logger } from '../logging/index.js'
import { jwtAuthMiddleware } from './middleware/jwt-auth.js'
import { MAX_PROMPT_LENGTH, getAgentConfig } from '../services/features.js'
import type { AgentsAppContext } from '../types/websocket-context.js'


/**
 * Create and setup the AI-Lib WebSocket server
 */
export async function setupAILibWebSocketServer(httpServer: HTTPServer) {
  logger.info('websocket.server.setup.begin', {
    message: 'Setting up ExperimentalAgentFactory WebSocket server with conversation persistence'
  })
  
  // Create context logging configuration  
  const contextLogging = getAgentConfig.contextLogging()
  logger.info('websocket.context.config', {
    summary: 'Always enabled (concise)',
    detailed: contextLogging.detailed,
    appContextContent: contextLogging.appContextContent,
    templateContent: contextLogging.templateContent,
    visualContextDetails: contextLogging.visualContextDetails,
    rawContextData: contextLogging.rawContextData,
    debugFlags: {
      DEBUG_CONTEXT_DETAILED: process.env.DEBUG_CONTEXT_DETAILED === 'true',
      DEBUG_APP_CONTEXT_CONTENT: process.env.DEBUG_APP_CONTEXT_CONTENT === 'true',
      DEBUG_TEMPLATE_CONTENT: process.env.DEBUG_TEMPLATE_CONTENT === 'true',
      DEBUG_VISUAL_CONTEXT: process.env.DEBUG_VISUAL_CONTEXT === 'true',
      DEBUG_RAW_CONTEXT: process.env.DEBUG_RAW_CONTEXT === 'true'
    }
  })
  
  // Enable debug logging if requested
  if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
    logger.debug('websocket.debug.conversation_history.enabled', {
      message: 'Conversation history debug logging enabled'
    })
  }
  
  if (process.env.DEBUG_AI_REQUESTS === 'true') {
    logger.debug('websocket.debug.ai_requests.enabled', {
      message: 'AI request debug logging enabled'
    })
    // Enable AI SDK debug logging
    process.env.DEBUG = 'ai:*'
  }

  try {
    // Create the agent factory
    const agentFactory = await createWebSocketAgentFactory()
    
    // Create context manager for app context and template descriptions
    const contextManager = new AILibContextManager()
    
    // Register context manager with file context registry for tools
    fileContextRegistry.setContextManager(contextManager)
    
    // Create message persistence implementation
    const messagePersistence = new AgentsMessagePersistence()
    
    // Create token-based conversation history provider
    const conversationRepo = new ConversationRepository()
    const conversationContextManager = new ConversationContextManager(conversationRepo, 10) // Max 10 messages
    
    // Create context provider implementation for app context and templates
    const contextProvider: ContextProvider = {
      async loadContextMessages(context: Record<string, unknown>): Promise<ContextMessage[]> {
        // Always show concise summary
        logger.debug('websocket.context.provider.loading', {
          message: 'Loading context messages'
        })
        
        if (!context) {
          logger.warn('websocket.context.provider.no_context', {
            message: 'No context provided'
          })
          return []
        }
        
        try {
          // Convert to enhanced context and enrich with app context and template descriptions
          const agentsAppContext = context as AgentsAppContext
          
          // Detailed logging if enabled
          if (contextLogging.detailed) {
            logger.debug('websocket.context.provider.detailed', {
              message: 'Converting to enhanced context',
              rawContextKeys: Object.keys(agentsAppContext),
              hasMetadata: !!agentsAppContext.metadata,
              hasAppContext: !!agentsAppContext.appContext,
              hasVisualContext: !!agentsAppContext.visualContext,
              hasAiEditContext: !!agentsAppContext.aiEditContext
            })
          }
          
          // Raw context data logging if enabled
          if (contextLogging.rawContextData) {
            logger.debug('websocket.context.provider.raw_data', {
              message: 'Raw context data',
              context: agentsAppContext
            })
          }
          
          const enhancedContext = contextManager.convertToEnhancedContext(agentsAppContext)
          
          // Build context messages including app context and template descriptions
          const contextResult = await contextManager.buildContextMessages('', enhancedContext)
          
          logger.info('websocket.context.provider.success', {
            message: 'Built context messages',
            messageCount: contextResult.contextMessages.length
          })
          
          // Return the context messages directly - the context manager already set insertionOrder
          return contextResult.contextMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            insertionOrder: msg.insertionOrder || 'after_history',
            ...(msg.cachePoint && { cachePoint: msg.cachePoint })
          }))
        } catch (error) {
          logger.error('websocket.context.provider.failure', {
            message: 'Error loading context',
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          })
          console.error('❌ Context provider error details:', error)
          return []
        }
      }
    }
    
    // Create message provider implementation for conversation history
    const messageProvider: MessageProvider = {
      async loadMessages(conversationId: string, context: Record<string, unknown>): Promise<ConversationMessage[]> {
        if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
          logger.debug('websocket.message.provider.loading', {
            message: 'Loading conversation messages'
          })
        }
        
        // Extract appId and agentName from context
        const metadata = (context?.metadata as any) || {}
        const appId = metadata.appId
        const agentName = metadata.agentId || 'develop' // Default to develop agent
        
        if (!appId) {
          logger.warn('websocket.message.provider.no_app_id', {
            message: 'No appId found in context, cannot load conversation history'
          })
          return []
        }
        
        if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
          logger.debug('websocket.message.provider.loading_messages', {
            message: 'Loading ALL messages',
            appId,
            agentName
          })
        }
        
        try {
          // Use the new token-based method with model name for accurate token counting
          // Based on model-selection.ts, all agents currently use 'claude4'
          const modelName = 'claude4'
          const messages = await conversationContextManager.loadAllMessagesWithTokenLimit(appId, agentName, 40000, modelName)
          
          if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
            logger.debug('websocket.message.provider.success', {
              message: 'Loaded messages',
              messageCount: messages.length
            })
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
                          if (typeof parsedArgs === 'object' && parsedArgs !== null) {
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
          logger.error('websocket.message.provider.failure', {
            message: 'Error in MessageProvider',
            error: error instanceof Error ? error.message : String(error)
          })
          return []
        }
      }
    }
    
    // Create the WebSocket server with the agent factory and built-in persistence
    const wsServer = createExperimentalWebSocketServer(httpServer, {
      agents: agentFactory.agents,
      
      // Built-in message persistence
      messagePersistence,
      
      // Message provider for conversation history
      messageProvider,
      
      // Context provider for app context and templates
      contextProvider,
      
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

          logger.debug('websocket.context.app_id.validated', {
            message: 'Validated appId',
            appId
          })
        
          // DEBUG: Log the raw context being received
          logger.debug('websocket.context.raw_received', {
            message: 'Raw context received',
            contextKeys: Object.keys(rawContext),
            hasMetadata: !!rawContext.metadata,
            hasAppContext: !!rawContext.appContext,
            hasVisualContext: !!rawContext.visualContext,
            hasAiEditContext: !!rawContext.aiEditContext,
            hasConversation: !!rawContext.conversation,
            messageLength: message?.length || 0,
            appId
          })
          
          // Log the full context for debugging (but don't modify it)
          logger.debug('websocket.context.full_raw_data', {
            message: 'Full raw context data',
            rawContext
          })

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
        logger.info('websocket.connection.connected', {
          message: 'WebSocket client connected',
          socketId
        })
      },
      
      // Optional event handlers (persistence is now handled automatically)
      onMessageStart: async (socketId: string, message: string, agentName?: string, context?: Record<string, unknown>) => {
        // Authentication already done at handshake - just log the message start
        if (context && context.customerContext) {
          const customerContext = context.customerContext as any;
          logger.info('websocket.message.start', {
            message: 'WebSocket message from customer',
            customerId: customerContext.customerId,
            shopperId: customerContext.shopperId,
            messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
            agentName
          });
        } else if (process.env.BYPASS_AUTH_FOR_LOCAL !== 'true') {
          throw new Error('Missing customer context - authentication may have failed');
        }
      },
      
      onMessageComplete: async (socketId: string, result: any, context?: Record<string, unknown>) => {
        const duration = result.duration || 'unknown';
        const steps = result.steps || 0;
        const agentId = result.agentId || 'unknown';
        
        logger.info('websocket.message.completed', {
          message: 'WebSocket message completed',
          socketId,
          steps,
          duration,
          agentId
        });
        
        // Log customer context if available (for audit purposes)
        if (context?.customerContext) {
          const customerContext = context.customerContext as any;
          logger.info('websocket.request.customer_completed', {
            message: 'WebSocket request completed for customer',
            customerId: customerContext.customerId,
            shopperId: customerContext.shopperId
          });
        }
      },
      
      onDisconnection: (socketId: string) => {
        logger.info('websocket.connection.disconnected', {
          message: 'WebSocket client disconnected',
          socketId
        })
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

    logger.info('websocket.server.ready', {
      message: 'ExperimentalAgentFactory WebSocket server ready for connections',
      availableAgents: agentFactory.getAvailableAgents().map(a => a.id),
      defaultAgent: 'develop',
      agentCount: agentFactory.getAgentCount(),
      multiAgentMode: agentFactory.isMultiAgentMode(),
      features: {
        agentHandoffs: true,
        toolExecutionHooks: true,
        handoffHistoryTracking: true,
        conversationPersistence: true,
        conversationHistoryLoading: true
      }
    })

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
        logger.info('websocket.auth.jwt_validation.start', {
          message: 'Performing full JWT validation with SSO at handshake'
        });
        
        const validationResult = await jwtAuthMiddleware.jwtValidationService.authenticate(token);
        
        if (!validationResult.valid) {
          logger.warn('websocket.auth.connection_rejected', {
            message: 'CONNECTION REJECTED: JWT validation failed',
            reason: validationResult.reason
          });
          throw new Error(`JWT validation failed: ${validationResult.reason}`);
        }
        
        logger.info('websocket.auth.connection_approved', {
          message: 'Connection approved: Full JWT validation passed',
          customerId: validationResult.payload?.cid
        });
        
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
            logger.info('websocket.auth.token_refresh.requested', {
              message: 'Token refresh requested',
              customerId: socket.handshake.auth.customerContext.customerId
            });
            
            const refreshResult = await jwtAuthMiddleware.jwtValidationService.authenticate(data.newToken);
            
            if (!refreshResult.valid) {
              logger.warn('websocket.auth.token_refresh.failed', {
                message: 'Token refresh failed',
                reason: refreshResult.reason
              });
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
            
            logger.info('websocket.auth.token_refresh.success', {
              message: 'Token refreshed for customer',
              customerId: refreshResult.payload?.cid,
              expiryTime: new Date(refreshResult.payload?.exp * 1000).toISOString()
            });
            socket.emit('tokenRefreshSuccess', { 
              newExpiry: refreshResult.payload?.exp,
              customerId: refreshResult.payload?.cid 
            });
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('websocket.auth.token_refresh.error', {
              message: 'Token refresh error',
              error: errorMessage
            });
            socket.emit('tokenRefreshError', { error: errorMessage });
          }
        });
        
        next(); // Allow connection
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('websocket.auth.socket_auth_failed', {
          message: 'Socket.IO auth failed',
          error: errorMessage
        });
        next(new Error(`Authentication failed: ${errorMessage}`));
      }
    });

    return { wsServer, agentFactory }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('websocket.server.setup.failure', {
      message: 'Failed to setup ExperimentalAgentFactory WebSocket server',
      error: errorMessage,
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

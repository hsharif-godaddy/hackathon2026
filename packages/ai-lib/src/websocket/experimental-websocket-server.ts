import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import type { ExperimentalAgentFactory, ExperimentalAgentWrapper } from '../core/agent-factory-experimental.js'
import { createExperimentalAgentFactory } from '../core/agent-factory-experimental.js'
import type { MessagePersistence, MessagePersistenceWithCleanup, PersistenceStreamingEvent, MessagePersistenceContext } from './persistence-interface.js'

/**
 * Interface for providing conversation history to agents
 */
export interface ConversationHistoryProvider {
  /**
   * Load conversation history for a given conversation ID
   * @param conversationId - The conversation ID to load history for
   * @param context - Additional context that might be needed for loading history
   * @returns Array of conversation messages in chronological order
   */
  loadConversationHistory(
    conversationId: string,
    context?: Record<string, unknown>
  ): Promise<Array<{
    role: 'user' | 'assistant'
    content: string
  }>>
}

/**
 * WebSocket Server Configuration for ExperimentalAgentFactory
 */
export interface ExperimentalWebSocketConfig {
  /** Agents object from agentFactory.defineAgents() (required) */
  agents: {
    get: (id: string) => ExperimentalAgentWrapper
    list: () => (string | number)[]
    [key: string]: any
  }

  /** Default agent name to use if none specified */
  defaultAgent?: string

  /** Context extractor function for processing custom context */
  contextExtractor?: (rawContext: Record<string, unknown>) => Record<string, unknown>

  /** CORS configuration */
  cors?: {
    origin?: string | string[] | boolean
    methods?: string[]
  }

  /** Include detailed usage data in responses */
  includeUsageData?: boolean

  /** Message persistence implementation */
  messagePersistence?: MessagePersistence

  /** Conversation history provider for loading conversation context */
  conversationHistoryProvider?: ConversationHistoryProvider

  /** Event handlers */
  onConnection?: (socketId: string) => void
  onDisconnection?: (socketId: string) => void
  onMessageStart?: (socketId: string, message: string, agentName?: string, context?: Record<string, unknown>) => void
  onMessageComplete?: (socketId: string, result: {
    agentName: string
    duration: string
    usage?: any
    toolCalls?: any[]
  }, context?: Record<string, unknown>) => void
  onError?: (socketId: string, error: Error, message?: string, context?: Record<string, unknown>) => void

  /** Socket.IO server options */
  socketOptions?: Partial<import('socket.io').ServerOptions>
}

/**
 * Chat message data from client
 */
export interface ChatMessage {
  message: string
  agentName?: string // For backward compatibility
  agentId?: string   // Following schema pattern
  context?: Record<string, unknown>
  conversationHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}

/**
 * WebSocket message types following the normalized event schema
 */
export interface WebSocketMessage {
  type: 'step_start' | 'chunk' | 'tool_start' | 'tool_result' | 'step_complete' | 'complete' | 'error' | 'agents_available'
  content: string
  data: Record<string, unknown>
}

/**
 * Modern WebSocket Server for ExperimentalAgentFactory
 * 
 * Simplified architecture that always uses an agent factory and supports
 * both single and multi-agent scenarios.
 */
export class ExperimentalWebSocketServer {
  private io: SocketIOServer
  private config: ExperimentalWebSocketConfig
  private activeStreams: Map<string, AbortController> = new Map()
  private activeConversations: Map<string, {
    conversationId: string
    agentName: string
    context: MessagePersistenceContext
    streamingEvents: PersistenceStreamingEvent[]
    startTime: number
  }> = new Map()

  constructor(httpServer: HTTPServer, config: ExperimentalWebSocketConfig) {
    this.config = config

    // Validate configuration
    if (!config.agents) {
      throw new Error('ExperimentalWebSocketServer requires an agents object in config')
    }

    // Initialize Socket.IO server
    this.io = new SocketIOServer(httpServer, {
      cors: config.cors || {
        origin: "*",
        methods: ["GET", "POST"]
      },
      ...config.socketOptions
    })

    this.setupEventHandlers()
  }

  /**
   * Setup Socket.IO event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      const socketId = socket.id

      // Call connection handler
      this.config.onConnection?.(socketId)

      // Send available agents on connection
      this.sendAvailableAgents(socket)

      // Handle chat messages (supporting both 'chat' and 'chat_message' for compatibility)
      socket.on('chat', async (data: ChatMessage) => {
        await this.handleChatMessage(socket, data)
      })

      socket.on('chat_message', async (data: ChatMessage) => {
        await this.handleChatMessage(socket, data)
      })

      // Handle agent list requests
      socket.on('get_agents', () => {
        this.sendAvailableAgents(socket)
      })

      // Handle disconnection
      socket.on('disconnect', async () => {
        // Cancel any active streams for this socket
        const controller = this.activeStreams.get(socketId)
        if (controller) {
          controller.abort()
          this.activeStreams.delete(socketId)
        }

        // Handle persistence cleanup
        const conversation = this.activeConversations.get(socketId)
        if (conversation && this.config.messagePersistence) {
          // Check if persistence supports cleanup
          if ('handleDisconnection' in this.config.messagePersistence) {
            await (this.config.messagePersistence as MessagePersistenceWithCleanup).handleDisconnection(
              socketId,
              [conversation.conversationId]
            )
          }
          this.activeConversations.delete(socketId)
        }

        this.config.onDisconnection?.(socketId)
      })

      // Handle stream cancellation
      socket.on('cancel', () => {
        const controller = this.activeStreams.get(socketId)
        if (controller) {
          controller.abort()
          this.activeStreams.delete(socketId)
        }
      })
    })
  }

  /**
   * Send available agents to client
   */
  private sendAvailableAgents(socket: any): void {
    const agentList = this.config.agents.list()

    socket.emit('message', {
      type: 'agents_available',
      content: '',
      data: {
        agents: agentList.map((agentName: string | number) => {
          const agentNameStr = String(agentName)
          return {
            id: agentNameStr,
            name: this.config.agents.get(agentNameStr)?.getName() || agentNameStr,
            description: `${agentNameStr} agent`
          }
        }),
        defaultAgent: this.config.defaultAgent || String(agentList[0]) || null
      }
    } as WebSocketMessage)
  }

  /**
   * Capture streaming event for persistence
   */
  private async captureStreamingEvent(socketId: string, type: string, content?: string, data?: any): Promise<void> {
    const conversation = this.activeConversations.get(socketId)
    if (conversation && this.config.messagePersistence) {
      const event: PersistenceStreamingEvent = {
        type,
        content: content || undefined,
        data,
        timestamp: new Date()
      }

      // Add to local tracking
      conversation.streamingEvents.push(event)

      // Call persistence capture
      await this.config.messagePersistence.captureStreamingEvent(
        conversation.conversationId,
        event,
        conversation.context
      )
    }
  }

  /**
   * Process stream with real-time tool events from baseStream
   */
  private async processStreamWithToolEvents(socket: any, streamResult: any, currentStep: number): Promise<void> {
    const baseStream = streamResult.baseStream
    if (!baseStream) {
      // Fallback to text-only streaming if baseStream is not available
      for await (const chunk of streamResult.textStream) {
        const chunkData = {
          step: currentStep,
          source: 'ai_response'
        }

        socket.emit('message', {
          type: 'chunk',
          content: chunk,
          data: chunkData
        } as WebSocketMessage)

        await this.captureStreamingEvent(socket.id, 'chunk', chunk, chunkData)
      }
      return
    }

    try {
      const reader = baseStream.getReader()
      let accumulatedToolInput = new Map<string, string>() // Track tool input deltas
      let eventCount = 0
      let toolEventCount = 0

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        eventCount++

        if (value?.part) {
          const part = value.part

          // Log tool-related events for debugging
          if (part.type.includes('tool')) {
            toolEventCount++
          }

          switch (part.type) {
            case 'text-delta':
              // Handle text chunks
              const textData = {
                step: currentStep,
                source: 'ai_response'
              }

              socket.emit('message', {
                type: 'chunk',
                content: part.text,
                data: textData
              } as WebSocketMessage)

              await this.captureStreamingEvent(socket.id, 'chunk', part.text, textData)
              break

            case 'tool-input-start':
              // Tool call is starting
              accumulatedToolInput.set(part.id, '')

              const toolStartData = {
                step: currentStep,
                tool: {
                  id: part.id,
                  name: part.toolName,
                  input: {} // Will be populated as deltas arrive
                }
              }

              socket.emit('message', {
                type: 'tool_start',
                content: `Using ${part.toolName}...`,
                data: toolStartData
              } as WebSocketMessage)

              await this.captureStreamingEvent(socket.id, 'tool_start', `Using ${part.toolName}...`, toolStartData)
              break

            case 'tool-input-delta':
              // Accumulate tool input
              const currentInput = accumulatedToolInput.get(part.id) || ''
              accumulatedToolInput.set(part.id, currentInput + part.delta)
              break

            case 'tool-call':
              // Tool call is complete with full input
              break

            case 'tool-result':
              // Tool execution completed with result

              const toolResultData = {
                step: currentStep,
                tool: {
                  id: part.toolCallId,
                  name: part.toolName,
                  input: part.input,
                  output: part.output
                }
              }

              socket.emit('message', {
                type: 'tool_result',
                content: `${part.toolName} completed`,
                data: toolResultData
              } as WebSocketMessage)

              await this.captureStreamingEvent(socket.id, 'tool_result', `${part.toolName} completed`, toolResultData)
              break

            case 'tool-error':
              // Tool execution completed with error (but we'll treat it as completed)

              const toolErrorData = {
                step: currentStep,
                tool: {
                  id: part.toolId || part.toolCallId || part.id,
                  name: part.toolName,
                  input: part.input || {},
                  output: part.error?.message || part.error || 'Tool execution error'
                }
              }


              socket.emit('message', {
                type: 'tool_result',
                content: `${part.toolName} completed`,
                data: toolErrorData
              } as WebSocketMessage)

              await this.captureStreamingEvent(socket.id, 'tool_result', `${part.toolName} completed`, toolErrorData)
              break

            default:
              // Unhandled tool event
              break
          }
        }
      }
    } catch (error) {
      console.error('❌ Error processing baseStream, falling back to text-only:', error)
      // Fallback to text-only streaming
      for await (const chunk of streamResult.textStream) {
        const chunkData = {
          step: currentStep,
          source: 'ai_response'
        }

        socket.emit('message', {
          type: 'chunk',
          content: chunk,
          data: chunkData
        } as WebSocketMessage)

        await this.captureStreamingEvent(socket.id, 'chunk', chunk, chunkData)
      }
    }
  }

  /**
   * Handle incoming chat messages
   */
  private async handleChatMessage(socket: any, data: ChatMessage): Promise<void> {
    const socketId = socket.id
    const startTime = Date.now()
    let agentName: string | undefined
    let processedContext: Record<string, unknown> | undefined

    try {
      // Validate message
      if (!data.message || typeof data.message !== 'string') {
        throw new Error('Invalid message: message field is required and must be a string')
      }

      // Determine which agent to use (support both agentId and agentName for compatibility)
      agentName = data.agentId || data.agentName || this.config.defaultAgent
      if (!agentName) {
        throw new Error('No agent specified and no default agent configured')
      }

      // Get agent from agents
      const agent = this.config.agents.get(agentName)
      if (!agent) {
        throw new Error(`Agent '${agentName}' not found`)
      }

      // Process context if provided (do this BEFORE calling event handlers)
      if (data.context && this.config.contextExtractor) {
        processedContext = this.config.contextExtractor(data.context)
      } else {
        // Ensure processedContext is always defined
        processedContext = data.context || {}
      }

      // Handle persistence if configured
      let conversationId: string | undefined
      if (this.config.messagePersistence) {
        const metadata = (processedContext?.metadata as any) || {}
        const persistenceContext: MessagePersistenceContext = {
          socketId,
          agentName,
          appId: metadata.appId,
          userId: metadata.userId,
          sessionId: metadata.sessionId,
          ...processedContext
        }

        // Check if we already have an active conversation for this socket
        const existingConversation = this.activeConversations.get(socketId)

        if (existingConversation && existingConversation.agentName === agentName) {
          // Reuse existing conversation for the same agent
          conversationId = existingConversation.conversationId
          if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
            console.log('🔄 Reusing existing conversation for socket:', socketId, 'conversation:', conversationId)
          }

          // Continue the existing conversation if the method is available
          if (this.config.messagePersistence.continueConversation) {
            await this.config.messagePersistence.continueConversation(
              conversationId,
              data.message,
              persistenceContext
            )
          }

          // Update context but keep the same conversation ID
          existingConversation.context = persistenceContext
          existingConversation.streamingEvents = []
        } else {
          // Create new conversation (first message or agent switch)
          conversationId = await this.config.messagePersistence.startConversation(
            data.message,
            persistenceContext
          )

          if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
            console.log('🆕 Created new conversation for socket:', socketId, 'conversation:', conversationId)
          }

          // Track conversation for streaming events
          this.activeConversations.set(socketId, {
            conversationId,
            agentName,
            context: persistenceContext,
            streamingEvents: [],
            startTime: Date.now()
          })
        }
      }

      // Load conversation history if provider is configured and conversation ID is available
      if (this.config.conversationHistoryProvider && !data.conversationHistory) {
        // Try to get conversation ID from various sources
        let historyConversationId = conversationId // From persistence

        // Also check if conversation ID is provided in context (fallback, not normally used)
        if (!historyConversationId && processedContext?.conversation) {
          const conversationContext = processedContext.conversation as any
          historyConversationId = conversationContext?.conversationId
        }

        if (historyConversationId) {
          try {
            console.log('📚 Loading conversation history for conversation:', historyConversationId)
            const conversationHistory = await this.config.conversationHistoryProvider.loadConversationHistory(
              historyConversationId,
              processedContext
            )

            // Add conversation history to the data
            data.conversationHistory = conversationHistory

            console.log('✅ Loaded conversation history:', {
              conversationId: historyConversationId,
              historyLength: conversationHistory.length
            })
          } catch (error) {
            console.warn('⚠️ Failed to load conversation history:', error)
            // Continue without history - don't fail the entire request
          }
        }
      }

      // Call message start handler with processed context
      this.config.onMessageStart?.(socketId, data.message, agentName, processedContext)

      // Create abort controller for this stream
      const controller = new AbortController()
      this.activeStreams.set(socketId, controller)

      // Start streaming
      await this.streamAgentResponse(socket, agent, data, processedContext, agentName, startTime)

    } catch (error) {
      // Handle errors following the schema
      const errorMessage = error instanceof Error ? error.message : String(error)

      socket.emit('message', {
        type: 'error',
        content: errorMessage,
        data: {
          timestamp: new Date().toISOString(),
          agentId: agentName || this.config.defaultAgent
        }
      } as WebSocketMessage)

      this.config.onError?.(socketId, error instanceof Error ? error : new Error(String(error)), data.message, processedContext)

      // Handle persistence error
      const conversation = this.activeConversations.get(socketId)
      if (conversation && this.config.messagePersistence) {
        await this.config.messagePersistence.handleConversationError(
          conversation.conversationId,
          error instanceof Error ? error : new Error(String(error)),
          data.message,
          conversation.context
        )
        this.activeConversations.delete(socketId)
      }
    } finally {
      // Clean up
      this.activeStreams.delete(socketId)
    }
  }

  /**
   * Stream agent response to client using normalized event schema
   */
  private async streamAgentResponse(
    socket: any,
    agent: ExperimentalAgentWrapper,
    data: ChatMessage,
    context: Record<string, unknown> | undefined,
    agentName: string,
    startTime: number
  ): Promise<void> {

    // Prepare messages array
    const messages = []

    // Add conversation history if provided
    if (data.conversationHistory && data.conversationHistory.length > 0) {
      console.log(`🔄 ExperimentalWebSocketServer: Adding ${data.conversationHistory.length} conversation history messages`)
      console.log(`📋 ExperimentalWebSocketServer: Conversation history details:`)
      data.conversationHistory.forEach((msg, index) => {
        console.log(`  ${index + 1}. ${msg.role}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`)
      })
      messages.push(...data.conversationHistory)
    } else {
      console.log(`ℹ️ ExperimentalWebSocketServer: No conversation history provided`)
      console.log(`🔍 ExperimentalWebSocketServer: data.conversationHistory =`, data.conversationHistory)
    }

    // Prepare the prompt
    let prompt = data.message
    if (context) {
      prompt = `[CONTEXT]\n${JSON.stringify(context, null, 2)}\n\n${data.message}`
    }

    console.log(`🚀 ExperimentalWebSocketServer: Calling streamGenerate with:`)
    console.log(`  - Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}`)
    console.log(`  - Messages count: ${messages.length}`)
    console.log(`  - Messages:`, messages.map(m => `${m.role}: ${m.content.substring(0, 50)}...`))

    // Start streaming using streamGenerate with error handling for tool validation issues
    let streamResult
    try {
      streamResult = await agent.streamGenerate(prompt, {
        ...(messages.length > 0 && {
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        }),
        // Pass execution context for tools
        ...(context && { executionContext: context })
      })
    } catch (error: any) {
      // Handle API call errors (like tool input validation failures)
      if (error?.name === 'AI_APICallError' || error?.message?.includes('toolUse.input is invalid')) {
        console.error('❌ Tool input validation error:', error.message)

        // Create an error message that explains the issue to the LLM
        const errorExplanation = `Tool call failed due to invalid input format: ${error.message}. Please ensure all tool arguments are properly formatted as valid JSON objects. Check that:
1. All string values are properly quoted
2. All object properties use valid JSON syntax
3. No undefined or null values are passed as tool arguments
4. Arrays and objects are properly structured

Please retry your tool call with corrected input formatting.`

        // Send error message to client
        socket.emit('message', {
          type: 'error',
          content: errorExplanation,
          data: {
            timestamp: new Date().toISOString(),
            agentId: agentName,
            errorType: 'tool_validation_error',
            originalError: error.message
          }
        } as WebSocketMessage)

        // Also capture this for persistence
        await this.captureStreamingEvent(socket.id, 'error', errorExplanation, {
          agentId: agentName,
          errorType: 'tool_validation_error',
          originalError: error.message
        })

        return
      }

      // Re-throw other errors to be handled by the outer catch block
      throw error
    }

    let currentStep = 1
    let fullContent = ''

    // Emit step start
    const stepStartData = {
      step: currentStep,
      stepType: 'reasoning'
    }
    socket.emit('message', {
      type: 'step_start',
      content: '',
      data: stepStartData
    } as WebSocketMessage)

    // Capture for persistence
    await this.captureStreamingEvent(socket.id, 'step_start', '', stepStartData)

    // Process both text chunks and tool events from baseStream
    await this.processStreamWithToolEvents(socket, streamResult, currentStep)

    // Get final result with usage and tool calls
    const finalResult = await streamResult.getFinalResult()

    // Calculate duration
    const duration = `${Date.now() - startTime}ms`

    // Emit step complete
    socket.emit('message', {
      type: 'step_complete',
      content: fullContent,
      data: {
        step: currentStep,
        isFinal: true,
        toolCalls: finalResult.toolCalls || [],
        usage: this.config.includeUsageData ? finalResult.usage : undefined
      }
    } as WebSocketMessage)

    // Emit final completion event
    socket.emit('message', {
      type: 'complete',
      content: fullContent,
      data: {
        totalSteps: currentStep,
        usage: this.config.includeUsageData ? finalResult.usage : undefined,
        toolCalls: finalResult.toolCalls || [],
        agentId: agentName,
        duration
      }
    } as WebSocketMessage)

    // Complete persistence if configured
    const conversation = this.activeConversations.get(socket.id)
    if (conversation && this.config.messagePersistence) {
      const result = {
        agentName,
        duration,
        usage: finalResult.usage,
        toolCalls: finalResult.toolCalls
      }

      await this.config.messagePersistence.completeConversation(
        conversation.conversationId,
        conversation.streamingEvents,
        result,
        conversation.context
      )

      // Clean up conversation tracking
      this.activeConversations.delete(socket.id)
    }

    // Call completion handler with context
    this.config.onMessageComplete?.(socket.id, {
      agentName,
      duration,
      usage: finalResult.usage,
      toolCalls: finalResult.toolCalls
    }, context)
  }

  /**
   * Get the Socket.IO server instance
   */
  getIO(): SocketIOServer {
    return this.io
  }

  /**
   * Close the WebSocket server
   */
  close(): void {
    // Cancel all active streams
    for (const controller of this.activeStreams.values()) {
      controller.abort()
    }
    this.activeStreams.clear()

    // Close Socket.IO server
    this.io.close()
  }
}

/**
 * Helper factory for creating a simple single-agent factory
 */
export function createSingleAgentFactory(
  agentName: string,
  agentConfig: Parameters<ExperimentalAgentFactory['defineAgents']>[0][string]
): ExperimentalAgentFactory {
  const factory = createExperimentalAgentFactory()
  factory.defineAgents({
    [agentName]: agentConfig
  })

  return factory
}

/**
 * Create an ExperimentalWebSocketServer instance
 */
export function createExperimentalWebSocketServer(
  httpServer: HTTPServer,
  config: ExperimentalWebSocketConfig
): ExperimentalWebSocketServer {
  return new ExperimentalWebSocketServer(httpServer, config)
}

/**
 * Helper function for single agent use case
 */
export function createSingleAgentWebSocketServer(
  httpServer: HTTPServer,
  agentName: string,
  agentConfig: Parameters<ExperimentalAgentFactory['defineAgents']>[0][string],
  options?: Omit<ExperimentalWebSocketConfig, 'agents' | 'defaultAgent'>
): ExperimentalWebSocketServer {
  const factory = createSingleAgentFactory(agentName, agentConfig)
  const agents = factory.defineAgents({ [agentName]: agentConfig })

  return new ExperimentalWebSocketServer(httpServer, {
    agents,
    defaultAgent: agentName,
    ...options
  })
}

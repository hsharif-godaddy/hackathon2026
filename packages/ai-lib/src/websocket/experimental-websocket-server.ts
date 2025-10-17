import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import type { ExperimentalAgentFactory, ExperimentalAgentWrapper } from '../core/agent-factory-experimental.js'
import { createExperimentalAgentFactory } from '../core/agent-factory-experimental.js'
import { calculateCostEstimate, formatCostEstimate, getCacheHitRate, type TokenUsage } from '../utils/model-pricing.js'
import type {
  MessageProvider,
  ContextProvider,
  ConversationPersistence,
  ConversationPersistenceWithCleanup,
  ConversationMessage,
  PersistenceStreamingEvent,
  ConversationContext
} from './interfaces.js'


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

  /** File path resolver for uploaded files */
  filePathResolver?: (appId: string, uploadId: string, filename: string) => string

  /** CORS configuration */
  cors?: {
    origin?: string | string[] | boolean
    methods?: string[]
  }

  /** Include detailed usage data in responses */
  includeUsageData?: boolean

  /** Message persistence implementation */
  messagePersistence?: ConversationPersistence

  /** Message provider for loading conversation history */
  messageProvider?: MessageProvider

  /** Context provider for loading system context and other contextual messages */
  contextProvider?: ContextProvider

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
  conversationHistory?: ConversationMessage[]
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
    context: ConversationContext
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
            await (this.config.messagePersistence as ConversationPersistenceWithCleanup).handleDisconnection(
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
      await this.processTextOnlyStream(socket, streamResult, currentStep)
      return
    }

    let reader: ReadableStreamDefaultReader | null = null
    const socketId = socket.id
    const abortController = this.activeStreams.get(socketId)

    try {
      reader = baseStream.getReader()
      const accumulatedToolInput = new Map<string, string>() // Track tool input deltas
      let eventCount = 0
      let toolEventCount = 0

      // eslint-disable-next-line no-constant-condition
      while (true) { // Intentional infinite loop until stream is done
        // Check if the stream was cancelled
        if (abortController?.signal.aborted) {
          console.warn('⚠️ Stream processing cancelled by client')
          break
        }

        let readResult
        try {
          readResult = await reader!.read()
        } catch (readError: unknown) {
          // Handle specific stream read errors
          if (this.isNetworkError(readError)) {
            const errorMessage = readError instanceof Error ? readError.message : String(readError)
            console.warn('⚠️ Network error during stream read, attempting graceful fallback:', errorMessage)
            throw readError // Re-throw to trigger fallback
          }
          throw readError
        }

        const { done, value } = readResult

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
            case 'text-delta': {
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
            }

            case 'tool-input-start': {
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
            }

            case 'tool-input-delta': {
              // Accumulate tool input
              const currentInput = accumulatedToolInput.get(part.id) || ''
              accumulatedToolInput.set(part.id, currentInput + part.delta)
              break
            }

            case 'tool-call':
              // Tool call is complete with full input
              break

            case 'tool-result': {
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
            }

            case 'tool-error': {
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
            }

            default:
              // Unhandled tool event
              break
          }
        }
      }
    } catch (error: unknown) {
      // Enhanced error logging with structured information
      const errorInfo = this.analyzeStreamError(error)

      console.error('❌ Error processing baseStream, falling back to text-only:', {
        errorType: errorInfo.type,
        errorMessage: errorInfo.message,
        isNetworkError: errorInfo.isNetworkError,
        isAbortError: errorInfo.isAbortError,
        originalError: error
      })

      // Don't attempt fallback if the stream was intentionally cancelled
      if (errorInfo.isAbortError) {
        console.info('ℹ️ Stream processing was cancelled, skipping fallback')
        return
      }

      // Fallback to text-only streaming with better error handling
      try {
        await this.processTextOnlyStream(socket, streamResult, currentStep)
      } catch (fallbackError: unknown) {
        console.error('❌ Fallback to text-only streaming also failed:', fallbackError)
        // Emit error to client as last resort
        socket.emit('message', {
          type: 'error',
          content: `Stream processing failed: ${errorInfo.message}`,
          data: {
            timestamp: new Date().toISOString(),
            errorType: errorInfo.type,
            step: currentStep
          }
        } as WebSocketMessage)
      }
    } finally {
      // Ensure reader is always cleaned up
      await this.safeCleanupReader(reader)
    }
  }

  /**
   * Helper method to safely process text-only streaming
   */
  private async processTextOnlyStream(socket: any, streamResult: any, currentStep: number): Promise<void> {
    const socketId = socket.id
    const abortController = this.activeStreams.get(socketId)

    try {
      for await (const chunk of streamResult.textStream) {
        // Check if the stream was cancelled
        if (abortController?.signal.aborted) {
          console.warn('⚠️ Text stream processing cancelled by client')
          break
        }

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
    } catch (error: unknown) {
      const errorInfo = this.analyzeStreamError(error)

      if (!errorInfo.isAbortError) {
        console.error('❌ Error in text-only stream processing:', errorInfo)
        throw error
      }
    }
  }

  /**
   * Analyze stream errors to provide better error handling
   */
  private analyzeStreamError(error: unknown): {
    type: string
    message: string
    isNetworkError: boolean
    isAbortError: boolean
  } {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorName = error instanceof Error ? error.name : 'UnknownError'

    // Check for abort/cancellation errors (both UK and US spellings)
    const isAbortError = errorName === 'AbortError' ||
                        errorMessage.includes('aborted') ||
                        errorMessage.includes('cancelled') ||
                        errorMessage.includes('canceled')

    // Check for network-related errors
    const isNetworkError = this.isNetworkError(error)

    let errorType = 'UnknownError'
    if (isAbortError) {
      errorType = 'AbortError'
    } else if (isNetworkError) {
      errorType = 'NetworkError'
    } else if (errorName) {
      errorType = errorName
    }

    return {
      type: errorType,
      message: errorMessage,
      isNetworkError,
      isAbortError
    }
  }

  /**
   * Check if an error is network-related
   */
  private isNetworkError(error: unknown): boolean {
    if (!error) return false

    const errorMessage = error instanceof Error ? error.message : ''
    const errorName = error instanceof Error ? error.name : ''
    const errorCode = (error as any)?.code || ''
    const errorCause = (error as any)?.cause

    // Known undici/fetch network error codes (explicit whitelist)
    const knownNetworkCodes = new Set([
      'UND_ERR_SOCKET',
      'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'UND_ERR_REQUEST_TIMEOUT'
    ])

    // Check explicit error codes first
    if (knownNetworkCodes.has(errorCode) || (errorCause && knownNetworkCodes.has(errorCause.code))) {
      return true
    }

    // Check for specific well-defined network error messages
    const networkErrorMessages = [
      'terminated',
      'other side closed',
      'content-length'
    ]

    // Only check exact error names for fetch/network errors
    const isNetworkErrorName = errorName === 'TypeError' && errorMessage.includes('terminated') ||
                              errorName === 'FetchError' ||
                              errorName === 'SocketError'

    const hasNetworkMessage = networkErrorMessages.some(msg => errorMessage.includes(msg))

    return isNetworkErrorName || hasNetworkMessage
  }

  /**
   * Safely cleanup a stream reader
   */
  private async safeCleanupReader(reader: ReadableStreamDefaultReader | null): Promise<void> {
    if (!reader) return

    try {
      // Cancel the reader if it's still active
      await reader.cancel()
    } catch (cancelError: unknown) {
      // Ignore cancel errors - reader might already be closed
      const errorMessage = cancelError instanceof Error ? cancelError.message : String(cancelError)
      console.debug('Reader cancel error (expected if already closed):', errorMessage)
    }

    try {
      // Release the lock
      reader.releaseLock()
    } catch (releaseError: unknown) {
      // Ignore release errors - lock might already be released
      const errorMessage = releaseError instanceof Error ? releaseError.message : String(releaseError)
      console.debug('Reader release error (expected if already released):', errorMessage)
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
        const persistenceContext: ConversationContext = {
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
      if (this.config.messageProvider && !data.conversationHistory && conversationId) {
        try {
          console.log('📚 Loading conversation history for conversation:', conversationId)
          const conversationHistory = await this.config.messageProvider.loadMessages(
            conversationId,
            processedContext || {}
          )

          // Add conversation history to the data
          data.conversationHistory = conversationHistory

          console.log('✅ Loaded conversation history:', {
            conversationId,
            historyLength: conversationHistory.length
          })
        } catch (error) {
          console.warn('⚠️ Failed to load conversation history:', error)
          // Continue without history - don't fail the entire request
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
   * Assemble messages from various providers with proper ordering and cache points
   */
  private async assembleMessages(
    data: ChatMessage, 
    context: Record<string, unknown> | undefined
  ): Promise<{
    messages: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'ephemeral' } }>
    contextMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'ephemeral' } }>
  }> {
    const messages: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'ephemeral' } }> = []
    const contextMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'ephemeral' } }> = []
    const beforeHistoryMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'ephemeral' } }> = []
    const afterHistoryMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'ephemeral' } }> = []

    // Load context messages if provider is configured
    if (this.config.contextProvider) {
      try {
        const contextToLoad = context || {}
        const loadedContextMessages = await this.config.contextProvider.loadContextMessages(contextToLoad)
        
        // Separate messages by insertion order and convert to proper format
        for (const msg of loadedContextMessages) {
          const { insertionOrder, ...messageWithoutOrder } = msg
          const convertedMessage = {
            role: messageWithoutOrder.role,
            content: messageWithoutOrder.content,
            ...(messageWithoutOrder.cachePoint && { cachePoint: messageWithoutOrder.cachePoint })
          }
          
          if (insertionOrder === 'before_history') {
            beforeHistoryMessages.push(convertedMessage)
          } else {
            afterHistoryMessages.push(convertedMessage)
          }
        }
        
        console.log(`✅ Loaded ${loadedContextMessages.length} context messages (${beforeHistoryMessages.length} before history, ${afterHistoryMessages.length} after history)`)
        console.log(`🎯 Cache points: ${loadedContextMessages.filter(m => m.cachePoint).length} messages with caching enabled`)
      } catch (error) {
        console.error('❌ Error loading context messages:', error)
        // Continue without context if loading fails
      }
    }

    // Assemble final message order:
    // 1. Context messages marked "before_history" go to contextMessages
    contextMessages.push(...beforeHistoryMessages)
    
    // 2. Conversation history (if provided) - convert to proper format
    if (data.conversationHistory && data.conversationHistory.length > 0) {
      console.log(`🔄 Adding ${data.conversationHistory.length} conversation history messages`)
      const convertedHistoryMessages = data.conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
        ...(msg.cachePoint && { cachePoint: msg.cachePoint })
      }))
      messages.push(...convertedHistoryMessages)
    }
    
    // 3. Context messages marked "after_history" go to messages (after conversation history, before user message)
    messages.push(...afterHistoryMessages)

    console.log(`🚀 Message assembly complete:`)
    console.log(`  - Context messages (before history): ${contextMessages.length}`)
    console.log(`  - Messages (history + after-history context): ${messages.length}`)
    console.log(`  - Total cache points: ${[...contextMessages, ...messages].filter(m => m.cachePoint).length}`)

    return { messages, contextMessages }
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
    let currentStep = 1

    // Assemble messages using clean interface-based approach
    const { messages, contextMessages } = await this.assembleMessages(data, context)

    // Keep the original user prompt intact - no modification!
    const originalPrompt = data.message

    // Start streaming using streamGenerate with clean message assembly
    let streamResult
    try {
      streamResult = await agent.streamGenerate(originalPrompt, {
        // Add context messages with cache points intact
        ...(contextMessages.length > 0 && { context: contextMessages }),
        // Add conversation history messages
        ...(messages.length > 0 && { messages }),
        // Pass execution context for tools
        ...(context && { executionContext: context })
      })
    } catch (error: any) {
      // Handle API call errors (like tool input validation failures)
      console.log('🔍 Caught error in streamGenerate:', {
        name: error?.name,
        message: error?.message,
        isAPIError: error?.name === 'AI_APICallError',
        hasToolUseInvalid: error?.message?.includes('toolUse.input is invalid'),
        hasJSONParsingFailed: error?.message?.includes('JSON parsing failed')
      })
      
      if (error?.name === 'AI_APICallError' || error?.message?.includes('toolUse.input is invalid') || error?.message?.includes('JSON parsing failed')) {
        console.error('❌ Tool input validation error:', error.message)

        // Emit step start for the failed tool call
        const stepStartData = {
          step: currentStep,
          stepType: 'reasoning'
        }
        socket.emit('message', {
          type: 'step_start',
          content: '',
          data: stepStartData
        } as WebSocketMessage)
        await this.captureStreamingEvent(socket.id, 'step_start', '', stepStartData)

        // Send tool failure result to show the user what went wrong
        const toolErrorData = {
          step: currentStep,
          tool: {
            id: 'failed-tool-call',
            name: 'tool_validation_failed',
            input: {},
            output: `Tool call failed due to invalid JSON format: ${error.message}. Please check your JSON syntax and try again.`
          }
        }

        socket.emit('message', {
          type: 'tool_result',
          content: 'Tool call failed - invalid JSON format',
          data: toolErrorData
        } as WebSocketMessage)

        await this.captureStreamingEvent(socket.id, 'tool_result', 'Tool call failed - invalid JSON format', toolErrorData)

        // Emit step complete to indicate this attempt is done
        socket.emit('message', {
          type: 'step_complete',
          content: '',
          data: {
            step: currentStep,
            isFinal: false,
            toolCalls: [{
              id: 'failed-tool-call',
              name: 'tool_validation_failed',
              input: {},
              output: `Invalid JSON in tool call: ${error.message}`
            }],
            usage: undefined
          }
        } as WebSocketMessage)

        // Create an error explanation that helps the LLM understand and retry
        const retryPrompt = `The previous tool call failed due to invalid JSON syntax. Error: ${error.message}

Please analyze what went wrong and retry the tool call with properly formatted JSON. Ensure:
1. All string values are properly quoted with double quotes
2. All object properties use valid JSON syntax  
3. No trailing commas in objects or arrays
4. All brackets and braces are properly closed
5. No undefined or null values are passed as tool arguments

Please try again with corrected formatting.`

        // Continue the conversation by making a new streamGenerate call with the error feedback
        try {
          currentStep++
          
          // Add the error as a user message to help the agent understand what went wrong
          const retryMessages = [...messages, 
            { role: 'user' as const, content: originalPrompt },
            { role: 'assistant' as const, content: 'I encountered an error with my tool call due to invalid JSON syntax. Let me fix that and try again.' },
            { role: 'user' as const, content: retryPrompt }
          ]

          streamResult = await agent.streamGenerate(retryPrompt, {
            ...(contextMessages.length > 0 && { context: contextMessages }),
            messages: retryMessages,
            ...(context && { executionContext: context })
          })
        } catch (retryError: any) {
          // If retry also fails, fall back to error handling
          console.error('❌ Retry also failed:', retryError.message)
          throw retryError
        }
      } else {
        // Re-throw other errors to be handled by the outer catch block
        throw error
      }
    }

    const fullContent = ''

    // Emit step start (currentStep was already incremented in error handler if needed)
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
    
    // Log token and cache usage information
    if (finalResult.usage) {
      // Merge usage data with caching information
      const usage: TokenUsage = {
        ...finalResult.usage,
        // Include cache metrics from the caching object if available
        ...((finalResult as any).caching && {
          cachedInputTokensRead: (finalResult as any).caching.cachedInputTokens,
          cachedInputTokensWrite: (finalResult as any).caching.cacheWriteInputTokens
        })
      }
      
      // Get model information from agent config
      // Get model name from agent configuration
      let modelName = 'unknown'
      try {
        const agentConfig = agent.getConfig()
        modelName = agentConfig.modelName || agentName || 'unknown'
      } catch (error) {
        console.warn(`⚠️  Failed to get model name from agent config: ${error}`)
        modelName = agentName || 'unknown'
      }
      
      console.log(`📊 Token Usage Statistics:`)
      console.log(`   Input tokens: ${usage.inputTokens || 0}`)
      console.log(`   Output tokens: ${usage.outputTokens || 0}`)  
      console.log(`   Total tokens: ${usage.totalTokens || 0}`)
      
      // Log cache usage if available
      const totalCachedTokens = (usage.cachedInputTokensRead || 0) + (usage.cachedInputTokensWrite || 0)
      if (totalCachedTokens > 0) {
        const cacheHitRate = getCacheHitRate(usage)
        console.log(`   🎯 Cached input tokens: ${totalCachedTokens}`)
        if (usage.cachedInputTokensRead && usage.cachedInputTokensWrite) {
          console.log(`     • Read: ${usage.cachedInputTokensRead}, Write: ${usage.cachedInputTokensWrite}`)
        } else if (usage.cachedInputTokensRead) {
          console.log(`     • Read: ${usage.cachedInputTokensRead}`)
        } else if (usage.cachedInputTokensWrite) {
          console.log(`     • Write: ${usage.cachedInputTokensWrite}`)
        }
        console.log(`   💰 Cache hit rate: ${cacheHitRate.toFixed(1)}%`)
      } else {
        console.log(`   🔍 No cache usage detected`)
      }
      
      // Calculate and log cost estimate using accurate model pricing
      const costEstimate = calculateCostEstimate(usage, modelName)
      const costLines = formatCostEstimate(costEstimate, usage)
      costLines.forEach(line => console.log(line))
    }

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

// Re-export interfaces for convenience
export type {
  MessageProvider,
  ContextProvider,
  ConversationPersistence,
  ConversationPersistenceWithCleanup,
  ConversationMessage,
  PersistenceStreamingEvent,
  ConversationContext
} from './interfaces.js'

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

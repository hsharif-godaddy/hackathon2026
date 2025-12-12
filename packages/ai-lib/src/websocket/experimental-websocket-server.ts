import type { ModelMessage } from 'ai'
import { APICallError } from '@ai-sdk/provider'
import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import type { AgentFactory, AgentWrapper } from '../core/agent-factory.js'
import { createAgentFactory } from '../core/agent-factory.js'
import { calculateCostEstimate, formatCostEstimate, getCacheHitRate, type TokenUsage } from '../utils/model-pricing.js'
import { classifyError } from '../utils/retry-with-backoff.js'
import { BudgetExceededError, containsBudgetExceededPattern } from '../utils/errors.js'
import type { AgentsCollection } from '../core/types.js'
import type { HandoffStateManager } from '../tools/handoff-helpers.js'
import { createLogger } from '../utils/logger.js'
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
 * APM agent type for tool execution tracking
 * Using 'any' to avoid strict type dependency on elastic-apm-node
 */
type APMAgent = any
type APMSpan = any


/**
 * Agent execution result with usage tracking
 */
interface AgentExecutionResult {
  usage?: TokenUsage
  totalUsage?: TokenUsage
  finishReason?: string
  toolCalls?: any[]
  caching?: {
    cachedInputTokens?: number
    cacheWriteInputTokens?: number
  }
}

/**
 * Processed context that may include optional application metadata
 */
interface ProcessedContext extends Record<string, unknown> {
  appId?: string
  metadata?: Record<string, unknown>
}

type MetadataRecord = Record<string, unknown> & {
  appId?: string
}

/**
 * WebSocket Server Configuration for AgentFactory
 */
export interface WebSocketConfig {
  /** Agents object from agentFactory.defineAgents() (required) */
  agents: AgentsCollection

  /** Default agent name to use if none specified */
  defaultAgent?: string

  /** Optional state manager for agent handoffs */
  stateManager?: HandoffStateManager

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

  /** Optional APM agent for tool execution tracking */
  apmAgent?: APMAgent

  /** Optional function to get active websocket transaction by socket ID */
  getActiveTransaction?: (socketId: string) => APMAgent | undefined

  /** Agent routing hook - determines which agent should handle a message */
  agentRouter?: (socketId: string, data: ChatMessage) => string | undefined

  /** Event handlers */
  onConnection?: (socketId: string) => void
  onDisconnection?: (socketId: string) => void
  onMessageStart?: (socketId: string, message: string, agentName?: string, context?: Record<string, unknown>) => void | Promise<void>
  onMessageComplete?: (socketId: string, result: {
    agentName: string
    duration: string
    usage?: any
    toolCalls?: any[]
  }, context?: Record<string, unknown>) => void
  onError?: (socketId: string, error: Error, message?: string, context?: Record<string, unknown>) => void
  onTokenUsage?: (usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedInputTokens?: number
    cacheWriteInputTokens?: number
  }, metadata: {
    agentName: string
    modelName: string
    conversationId?: string
    appId?: string
    context?: Record<string, unknown>
  }) => void | Promise<void>

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
  type: 'step_start' | 'chunk' | 'tool_start' | 'tool_input_delta' | 'tool_call' | 'tool_result' | 'step_complete' | 'complete' | 'error' | 'agents_available' | 'recovery_status'
  content: string
  data: Record<string, unknown>
}

/**
 * Type guard to check if an error is a budget exceeded API error
 * Encapsulates the budget error detection logic to avoid duplication
 * Narrows the type to APICallError with statusCode guaranteed to be 400
 */
function isBudgetExceededAPIError(error: unknown): error is APICallError & { statusCode: 400; responseBody: string } {
  return APICallError.isInstance(error) &&
    error.statusCode === 400 &&
    !!error.responseBody &&
    containsBudgetExceededPattern(error.responseBody)
}

/**
 * Modern WebSocket Server for AgentFactory
 *
 * Simplified architecture that always uses an agent factory and supports
 * both single and multi-agent scenarios.
 */
export class WebSocketServer {
  private io: SocketIOServer
  private config: WebSocketConfig
  private logger = createLogger('websocket')
  private activeStreams: Map<string, AbortController> = new Map()
  private activeConversations: Map<string, {
    conversationId: string
    agentName: string
    context: ConversationContext
    streamingEvents: PersistenceStreamingEvent[]
    startTime: number
    pendingSegments?: any[]
    pendingToolCalls?: Map<string, any>
    accumulatedContent?: string
  }> = new Map()

  /**
   * Track active APM spans for tool executions
   * Key format: "socketId:toolId"
   */
  private activeToolSpans: Map<string, APMSpan> = new Map()

  /**
   * Track disconnected sockets with active streams during recovery window
   * Allows LLM to continue working while client reconnects
   */
  private disconnectedStreams: Map<string, {
    abortController: AbortController
    timeoutId: NodeJS.Timeout
    bufferedEvents: WebSocketMessage[]
    conversationId: string
  }> = new Map()

  /**
   * Recovery window for connection state recovery (5 minutes)
   * During this time, streams continue and events are buffered
   */
  private readonly STREAM_RECOVERY_WINDOW = 5 * 60 * 1000

  constructor(httpServer: HTTPServer, config: WebSocketConfig) {
    this.config = config

    // Validate configuration
    if (!config.agents) {
      throw new Error('WebSocketServer requires an agents object in config')
    }

    // Initialize Socket.IO server with merged configuration
    // Note: config.socketOptions will override any conflicting keys
    this.io = new SocketIOServer(httpServer, {
      cors: config.cors || {
        origin: "*",
        methods: ["GET", "POST"]
      },
      // Default buffer size for large payloads (e.g., screenshots)
      maxHttpBufferSize: 50 * 1024 * 1024, // 50MB default
      // Enable connection state recovery to preserve socket IDs and allow reconnection
      connectionStateRecovery: {
        maxDisconnectionDuration: this.STREAM_RECOVERY_WINDOW,
        skipMiddlewares: true
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
      const auth = socket.handshake.auth || {}
      const previousSocketId = auth.previousSocketId

      // Debug logging for all connections
      this.logger.info('Socket connection established', {
        socketId,
        hasAuth: !!auth,
        authKeys: Object.keys(auth),
        previousSocketId: previousSocketId || 'none',
        recovered: socket.recovered
      })

      // Debug logging for recovery
      if (previousSocketId) {
        this.logger.info('Connection with previousSocketId detected', {
          socketId,
          previousSocketId,
          hasDisconnectedStream: this.disconnectedStreams.has(previousSocketId),
          disconnectedStreamsSize: this.disconnectedStreams.size,
          disconnectedStreamKeys: Array.from(this.disconnectedStreams.keys())
        })
      }

      // Check if this is a recovered connection with buffered events (automatic recovery)
      if (socket.recovered && this.disconnectedStreams.has(socketId)) {
        this.logger.info('Socket reconnected during recovery window (automatic), replaying buffered events', { socketId })
        const streamData = this.disconnectedStreams.get(socketId)!

        // Cancel the abort timeout
        clearTimeout(streamData.timeoutId)

        // Replay all buffered events
        for (const event of streamData.bufferedEvents) {
          socket.emit('message', event)
        }

        // Move back to active streams
        this.activeStreams.set(socketId, streamData.abortController)
        this.disconnectedStreams.delete(socketId)

        this.logger.info('Replayed buffered events and resumed stream', {
          socketId,
          eventCount: streamData.bufferedEvents.length
        })
      }
      // Check for manual recovery after page reload (client sends previousSocketId)
      else if (previousSocketId && this.disconnectedStreams.has(previousSocketId)) {
        this.logger.info('Manual recovery after page reload, transferring buffered events', {
          newSocketId: socketId,
          previousSocketId
        })
        const streamData = this.disconnectedStreams.get(previousSocketId)!

        // Cancel the abort timeout
        clearTimeout(streamData.timeoutId)

        // Get conversation info for the client
        const conversation = this.activeConversations.get(previousSocketId)

        // Send recovery status to client BEFORE replaying events
        socket.emit('message', {
          type: 'recovery_status',
          content: '',
          data: {
            isRecovering: true,
            hasBufferedEvents: streamData.bufferedEvents.length > 0,
            bufferedEventCount: streamData.bufferedEvents.length,
            conversationId: conversation?.conversationId,
            agentName: conversation?.agentName
          }
        } as WebSocketMessage)

        // Replay all buffered events to the new socket
        for (const event of streamData.bufferedEvents) {
          socket.emit('message', event)
        }

        // Move to active streams with NEW socket ID
        this.activeStreams.set(socketId, streamData.abortController)

        // Update conversation tracking to new socket ID
        if (conversation) {
          this.activeConversations.set(socketId, conversation)
          this.activeConversations.delete(previousSocketId)
        }

        // Clean up old socket ID
        this.disconnectedStreams.delete(previousSocketId)

        this.logger.info('Transferred buffered events to new socket after page reload', {
          newSocketId: socketId,
          previousSocketId,
          eventCount: streamData.bufferedEvents.length,
          conversationId: conversation?.conversationId
        })
      }
      // Check if client is trying to recover but stream already completed/cleaned up
      else if (previousSocketId) {
        this.logger.info('Recovery attempted but no buffered events found', {
          newSocketId: socketId,
          previousSocketId
        })
        // Send recovery status indicating stream already completed
        socket.emit('message', {
          type: 'recovery_status',
          content: '',
          data: {
            isRecovering: true,
            hasBufferedEvents: false,
            bufferedEventCount: 0,
            streamCompleted: true
          }
        } as WebSocketMessage)
      }

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

      // Handle disconnection with graceful recovery window
      socket.on('disconnect', async (reason) => {
        this.logger.info('Socket disconnected', { socketId, reason })

        // Check if there's an active stream for this socket
        const controller = this.activeStreams.get(socketId)
        const conversation = this.activeConversations.get(socketId)

        if (controller && conversation) {
          // Don't abort immediately - move to disconnected streams with timeout
          this.logger.info('Active stream detected, starting recovery window', {
            socketId,
            recoveryWindow: `${this.STREAM_RECOVERY_WINDOW}ms`,
            conversationId: conversation.conversationId
          })

          // Set timeout to abort if client doesn't reconnect
          const timeoutId = setTimeout(() => {
            this.logger.warn('Recovery window expired, aborting stream', { socketId })
            controller.abort()
            this.disconnectedStreams.delete(socketId)
            this.activeStreams.delete(socketId)

            // Clean up conversation
            this.cleanupConversation(socketId).catch((error) => {
              this.logger.error('Error cleaning up conversation after recovery timeout', error)
            })
          }, this.STREAM_RECOVERY_WINDOW)

          // Move to disconnected streams with empty buffer
          this.disconnectedStreams.set(socketId, {
            abortController: controller,
            timeoutId,
            bufferedEvents: [],
            conversationId: conversation.conversationId
          })

          // Remove from active streams (but don't abort the controller)
          this.activeStreams.delete(socketId)
        } else {
          // No active stream - clean up immediately
          if (controller) {
            controller.abort()
            this.activeStreams.delete(socketId)
          }

          await this.cleanupConversation(socketId)
        }

        // Clean up APM spans (these can't be recovered)
        this.cleanupToolSpans(socketId)

        this.config.onDisconnection?.(socketId)
      })

      // Handle explicit stream cancellation (user clicked cancel button)
      socket.on('cancel', () => {
        this.logger.info('Stream explicitly cancelled by user', { socketId })

        // Cancel any active or disconnected stream
        const controller = this.activeStreams.get(socketId) ||
                          this.disconnectedStreams.get(socketId)?.abortController

        if (controller) {
          controller.abort()
          this.activeStreams.delete(socketId)

          // Clean up disconnected stream if exists
          const disconnected = this.disconnectedStreams.get(socketId)
          if (disconnected) {
            clearTimeout(disconnected.timeoutId)
            this.disconnectedStreams.delete(socketId)
          }
        }
      })
    })
  }

  /**
   * Emit message to socket with buffering support for disconnected sockets
   *
   * If socket is disconnected but stream is active (recovery window),
   * events are buffered and replayed on reconnection.
   */
  private emitToSocket(socket: any, event: string, message: WebSocketMessage): void {
    const socketId = socket.id

    // Check if socket is disconnected but stream is still active
    if (this.disconnectedStreams.has(socketId)) {
      // Buffer the event instead of emitting
      this.disconnectedStreams.get(socketId)!.bufferedEvents.push(message)
      this.logger.debug('Buffered event during disconnection', {
        socketId,
        eventType: message.type,
        bufferSize: this.disconnectedStreams.get(socketId)!.bufferedEvents.length
      })
    } else {
      // Normal emit
      socket.emit(event, message)
    }
  }

  /**
   * Clean up conversation state and persistence
   */
  private async cleanupConversation(socketId: string): Promise<void> {
    const conversation = this.activeConversations.get(socketId)
    if (conversation && this.config.messagePersistence) {
      if ('handleDisconnection' in this.config.messagePersistence) {
        await (this.config.messagePersistence as ConversationPersistenceWithCleanup).handleDisconnection(
          socketId,
          [conversation.conversationId]
        )
      }
      this.activeConversations.delete(socketId)
    }
  }

  /**
   * Clean up APM tool spans for a socket
   */
  private cleanupToolSpans(socketId: string): void {
    for (const [spanKey, span] of this.activeToolSpans.entries()) {
      if (spanKey.startsWith(`${socketId}:`)) {
        try {
          span.setOutcome('unknown')
          span.addLabels({ disconnect_cleanup: true })
          span.end()
        } catch {
          // Silently fail - APM cleanup should not disrupt disconnect handling
        }
        this.activeToolSpans.delete(spanKey)
      }
    }
  }

  /**
   * Send available agents to client
   */
  private sendAvailableAgents(socket: any): void {
    const agentList = this.config.agents.list()

    this.emitToSocket(socket, 'message', {
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
   * Initialize conversation buffers for incremental persistence
   * Ensures all required properties are defined
   */
  private initializeConversationBuffers(conversation: {
    pendingSegments?: any[]
    pendingToolCalls?: Map<string, any>
    accumulatedContent?: string
  }): asserts conversation is {
    pendingSegments: any[]
    pendingToolCalls: Map<string, any>
    accumulatedContent: string
  } {
    if (!conversation.pendingSegments) {
      conversation.pendingSegments = []
    }
    if (!conversation.pendingToolCalls) {
      conversation.pendingToolCalls = new Map()
    }
    if (!conversation.accumulatedContent) {
      conversation.accumulatedContent = ''
    }
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

      this.initializeConversationBuffers(conversation)

      const agentMessageId = conversation.context.agentMessageId

      if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
        this.logger.debug('Event captured for persistence', {
          type,
          hasAgentMessageId: !!agentMessageId,
          hasUpdateMethod: !!this.config.messagePersistence.updateAgentTurn,
          willTriggerUpdate: !!(agentMessageId && this.config.messagePersistence.updateAgentTurn && type === 'tool_result'),
          contentLength: content?.length || 0
        })
      }

      if (agentMessageId && this.config.messagePersistence.updateAgentTurn) {
        const timestamp = event.timestamp || new Date()

        if (type === 'chunk' || type === 'text_chunk') {
          if (content) {
            conversation.accumulatedContent += content
            conversation.pendingSegments.push({
              id: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
              type: 'content',
              content,
              timestamp,
              metadata: undefined
            })
          }
        } else if (type === 'tool_start' && data?.tool) {
          const toolId = data.tool.id || `tool_${Date.now()}`
          const toolData = {
            id: toolId,
            name: data.tool.name,
            input: data.tool.input,
            status: 'running',
            startTime: timestamp
          }
          conversation.pendingToolCalls.set(toolId, toolData)

          conversation.pendingSegments.push({
            id: `seg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'tool_call',
            timestamp,
            toolCall: toolData
          })
        } else if (type === 'tool_result' && data?.tool) {
          const toolId = data.tool.id
          const existingTool = conversation.pendingToolCalls.get(toolId)

          if (existingTool) {
            existingTool.input = data.tool.input || existingTool.input
            existingTool.result = data.tool.output ?? content ?? data.tool.result
            existingTool.status = 'completed'
            existingTool.endTime = timestamp

            if (existingTool.startTime && timestamp) {
              const startTime = new Date(existingTool.startTime).getTime()
              const endTime = new Date(timestamp).getTime()
              existingTool.duration = endTime - startTime
            }

            const segmentIndex = conversation.pendingSegments.findIndex(s =>
              s.type === 'tool_call' && s.toolCall?.id === toolId
            )
            if (segmentIndex >= 0) {
              conversation.pendingSegments[segmentIndex].toolCall = existingTool
            }

            try {
              if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
                this.logger.debug('Updating agent turn with tool result', {
                  messageId: agentMessageId,
                  toolId,
                  toolName: existingTool.name,
                  contentLength: conversation.accumulatedContent.length,
                  segmentsCount: conversation.pendingSegments.length,
                  toolCallsCount: conversation.pendingToolCalls.size
                })
              }
              await this.config.messagePersistence.updateAgentTurn(
                conversation.conversationId,
                agentMessageId,
                {
                  content: conversation.accumulatedContent,
                  segments: [...conversation.pendingSegments],
                  toolCalls: Array.from(conversation.pendingToolCalls.values())
                },
                conversation.context
              )
            } catch (error) {
              this.logger.warn('Failed to update agent turn with tool result', error)
            }
          }
        }
      }
    }
  }

  /**
   * Start APM span for tool execution
   *
   * Creates a span as a child of the active WebSocket transaction if available,
   * otherwise creates a standalone span. Tool input is added later via the tool-call event.
   */
  private startToolSpan(socketId: string, toolId: string, toolName: string): void {
    if (!this.config.apmAgent && !this.config.getActiveTransaction) {
      return
    }

    try {
      const apmAgent = this.config.apmAgent
      const transaction = this.config.getActiveTransaction?.(socketId)

      if (!apmAgent) {
        return
      }

      // Create span as child of transaction if available, otherwise standalone
      // In Elastic APM, transaction.startSpan() creates a child span
      const span = transaction
        ? transaction.startSpan(`Tool: ${toolName}`, 'tool_execution', 'agent')
        : apmAgent.startSpan(`Tool: ${toolName}`, 'tool_execution', 'agent')

      if (span) {
        span.addLabels({
          tool_id: toolId,
          tool_name: toolName,
          socket_id: socketId
        })

        const spanKey = `${socketId}:${toolId}`
        this.activeToolSpans.set(spanKey, span)
      }
    } catch {
      // Silently fail - APM tracking should not break the application
    }
  }

  /**
   * End APM span for tool execution
   */
  private endToolSpan(socketId: string, toolId: string, success: boolean, errorMessage?: string): void {
    const spanKey = `${socketId}:${toolId}`
    const span = this.activeToolSpans.get(spanKey)

    if (span) {
      try {
        span.setOutcome(success ? 'success' : 'failure')

        if (!success && errorMessage) {
          span.addLabels({
            error_message: errorMessage
          })
        }

        span.end()
        this.activeToolSpans.delete(spanKey)
      } catch {
        // Silently fail - APM tracking should not break the application
      }
    }
  }

  /**
   * Process stream with real-time tool events from baseStream
   */
  private async processStreamWithToolEvents(socket: any, streamResult: any, currentStep: number, agentName: string): Promise<void> {
    const baseStream = streamResult.baseStream
    if (!baseStream) {
      // Fallback to text-only streaming if baseStream is not available
      await this.processTextOnlyStream(socket, streamResult, currentStep, agentName)
      return
    }

    let reader: ReadableStreamDefaultReader | null = null
    const socketId = socket.id
    const abortController = this.activeStreams.get(socketId)

    try {
      reader = baseStream.getReader()
      const accumulatedToolInput = new Map<string, string>() // Track tool input deltas

      // eslint-disable-next-line no-constant-condition
      while (true) { // Intentional infinite loop until stream is done
        // Check if the stream was cancelled
        if (abortController?.signal.aborted) {
          this.logger.warn('Stream processing cancelled by client')
          break
        }

        let readResult
        try {
          readResult = await reader!.read()
        } catch (readError: unknown) {
          // Handle specific stream read errors
          if (this.isNetworkError(readError)) {
            const errorMessage = readError instanceof Error ? readError.message : String(readError)
            this.logger.warn('Network error during stream read, attempting graceful fallback', { error: errorMessage })
            throw readError // Re-throw to trigger fallback
          }
          throw readError
        }

        const { done, value } = readResult

        if (done) {
          break
        }

        if (value?.part) {
          const part = value.part

          switch (part.type) {
            case 'error': {
              // AI SDK surfaced an error part - check if it's a budget error
              const error = part.error

              // Check if it's AI SDK's native APICallError with budget pattern
              if (isBudgetExceededAPIError(error)) {
                this.logger.error('Budget exceeded error detected', {
                  message: error.message,
                  statusCode: error.statusCode
                })

                // Convert to BudgetExceededError for UI
                throw new BudgetExceededError(
                  'Your AI usage budget has been reached.',
                  error.statusCode,
                  error.responseBody
                )
              }

              // Log and re-throw other errors unchanged
              this.logger.error('Stream error part received', {
                message: error instanceof Error ? error.message : String(error),
                statusCode: APICallError.isInstance(error) ? error.statusCode : undefined
              })

              throw error instanceof Error ? error : new Error(String(error))
            }

            case 'text-delta': {
              // Handle text chunks
              const textData = {
                step: currentStep,
                source: 'ai_response',
                agentId: agentName
              }

              this.emitToSocket(socket, 'message', {
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
                },
                agentId: agentName
              }

              // Start APM span for tool execution
              this.startToolSpan(socket.id, part.id, part.toolName)

              this.emitToSocket(socket, 'message', {
                type: 'tool_start',
                content: `Using ${part.toolName}...`,
                data: toolStartData
              } as WebSocketMessage)

              await this.captureStreamingEvent(socket.id, 'tool_start', `Using ${part.toolName}...`, toolStartData)
              break
            }

            case 'tool-input-delta': {
              // Accumulate tool input - emit delta for future status updates
              const currentInput = accumulatedToolInput.get(part.id) || ''
              accumulatedToolInput.set(part.id, currentInput + part.delta)

              // Emit input delta event for future use
              this.emitToSocket(socket, 'message', {
                type: 'tool_input_delta',
                content: '',
                data: {
                  toolId: part.id,
                  toolName: part.toolName,
                  delta: part.delta,
                  agentId: agentName
                }
              } as WebSocketMessage)
              break
            }

            case 'tool-call': {
              // Tool call is complete with full input - emit with accumulated input
              const toolId = part.id || part.toolCallId
              const fullInput = accumulatedToolInput.get(toolId) || '{}'
              let parsedInput: Record<string, unknown> = {}

              try {
                parsedInput = JSON.parse(fullInput)
              } catch (error) {
                this.logger.error('Failed to parse tool input', { fullInput })
              }

              const toolCallData = {
                step: currentStep,
                tool: {
                  id: toolId,
                  name: part.toolName,
                  input: parsedInput
                },
                agentId: agentName
              }

              this.emitToSocket(socket, 'message', {
                type: 'tool_call',
                content: `${part.toolName} input ready`,
                data: toolCallData
              } as WebSocketMessage)

              await this.captureStreamingEvent(socket.id, 'tool_call', `${part.toolName} input ready`, toolCallData)

              // Update APM span with input data now that we have it
              const spanKey = `${socket.id}:${toolId}`
              const span = this.activeToolSpans.get(spanKey)
              if (span && parsedInput && Object.keys(parsedInput).length > 0) {
                span.addLabels({
                  tool_input_keys: Object.keys(parsedInput).join(',')
                })
              }
              break
            }

            case 'tool-result': {
              // Tool execution completed with result
              const toolId = part.id || part.toolCallId

              const toolResultData = {
                step: currentStep,
                tool: {
                  id: toolId,
                  name: part.toolName,
                  input: part.input,
                  output: part.output
                },
                agentId: agentName
              }

              // End APM span for successful tool execution
              this.endToolSpan(socket.id, toolId, true)

              this.emitToSocket(socket, 'message', {
                type: 'tool_result',
                content: `${part.toolName} completed`,
                data: toolResultData
              } as WebSocketMessage)

              await this.captureStreamingEvent(socket.id, 'tool_result', `${part.toolName} completed`, toolResultData)
              break
            }

            case 'tool-error': {
              // Tool execution failed with error - communicate this clearly to frontend and LLM
              const toolId = part.id || part.toolCallId || part.toolId

              const errorMessage = part.error?.message || (typeof part.error === 'string' ? part.error : String(part.error)) || 'Tool execution error'

              const toolErrorData = {
                step: currentStep,
                tool: {
                  id: toolId,
                  name: part.toolName,
                  input: part.input || {},
                  output: {},
                  error: errorMessage,
                  is_error: true
                },
                agentId: agentName
              }

              // End APM span for failed tool execution
              this.endToolSpan(socket.id, toolId, false, errorMessage)

              this.emitToSocket(socket, 'message', {
                type: 'tool_result',
                content: `${part.toolName} failed: ${errorMessage}`,
                data: toolErrorData
              } as WebSocketMessage)

              await this.captureStreamingEvent(socket.id, 'tool_result', `${part.toolName} failed: ${errorMessage}`, toolErrorData)
              break
            }

            default:
              // Unhandled tool event
              break
          }
        }
      }
    } catch (error: unknown) {
      // Non-retryable errors (budget exceeded, auth, etc.) should propagate immediately
      const classification = classifyError(error);
      if (!classification.retryable) {
        // Check if it's a budget error from APICallError
        if (isBudgetExceededAPIError(error)) {
          this.logger.error('Non-retryable budget error - propagating', {
            category: classification.category,
            message: error.message,
            statusCode: error.statusCode
          });

          throw new BudgetExceededError(
            'Your AI usage budget has been reached.',
            error.statusCode,
            error.responseBody
          );
        }

        this.logger.error('Non-retryable error in stream processing - propagating', {
          category: classification.category,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }

      // Enhanced error logging with structured information
      const errorInfo = this.analyzeStreamError(error);

      this.logger.error('Error processing baseStream, falling back to text-only', {
        errorType: errorInfo.type,
        errorMessage: errorInfo.message,
        isNetworkError: errorInfo.isNetworkError,
        isAbortError: errorInfo.isAbortError,
        originalError: error
      })

      // Fallback to text-only streaming with better error handling
      try {
        await this.processTextOnlyStream(socket, streamResult, currentStep, agentName)
      } catch (fallbackError: unknown) {
        // Non-retryable errors should propagate
        const fallbackClassification = classifyError(fallbackError);
        if (!fallbackClassification.retryable) {
          throw fallbackError;
        }

        this.logger.error('Fallback to text-only streaming also failed', fallbackError)
        // Emit error to client as last resort
        this.emitToSocket(socket, 'message', {
          type: 'error',
          content: `Stream processing failed: ${errorInfo.message}`,
          data: {
            timestamp: new Date().toISOString(),
            errorType: errorInfo.type,
            step: currentStep,
            agentId: agentName
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
  private async processTextOnlyStream(socket: any, streamResult: any, currentStep: number, agentName: string): Promise<void> {
    const socketId = socket.id
    const abortController = this.activeStreams.get(socketId)

    try {
      for await (const chunk of streamResult.textStream) {
        // Check if the stream was cancelled
        if (abortController?.signal.aborted) {
          this.logger.warn('Text stream processing cancelled by client')
          break
        }

        const chunkData = {
          step: currentStep,
          source: 'ai_response',
          agentId: agentName
        }

        this.emitToSocket(socket, 'message', {
          type: 'chunk',
          content: chunk,
          data: chunkData
        } as WebSocketMessage)

        await this.captureStreamingEvent(socket.id, 'chunk', chunk, chunkData)
      }
    } catch (error: unknown) {
      const errorInfo = this.analyzeStreamError(error)

      if (!errorInfo.isAbortError) {
        this.logger.error('Error in text-only stream processing', errorInfo)
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
      this.logger.debug('Reader cancel error (expected if already closed)', { error: errorMessage })
    }

    try {
      // Release the lock
      reader.releaseLock()
    } catch (releaseError: unknown) {
      // Ignore release errors - lock might already be released
      const errorMessage = releaseError instanceof Error ? releaseError.message : String(releaseError)
      this.logger.debug('Reader release error (expected if already released)', { error: errorMessage })
    }
  }

  /**
   * Handle incoming chat messages with handoff support
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

      // 1. Determine initial agent (check state manager first for handoffs)
      agentName = this.getActiveAgent(socketId, data)
      if (!agentName) {
        throw new Error('No agent specified and no default agent configured')
      }

      // 2. Process context (add socketId for tools)
      processedContext = await this.processContext(data, socketId)

      // 3. Setup persistence (conversation ID, tracking)
      await this.setupPersistence(socketId, agentName, data, processedContext)

      // 4. Load conversation history
      await this.loadConversationHistory(socketId, data, processedContext)

      // 5. Call message start handler
      this.config.onMessageStart?.(socketId, data.message, agentName, processedContext)

      // 6. Create abort controller
      const controller = new AbortController()
      this.activeStreams.set(socketId, controller)

      // 7. Execute agent(s) - loop handles handoffs
      let currentMessage = data.message
      let iterationCount = 0
      const maxHandoffs = 10 // Prevent infinite loops

      while (iterationCount < maxHandoffs) {
        iterationCount++

        // Get current agent
        const agent = this.config.agents.get(agentName)
        if (!agent) {
          throw new Error(`Agent '${agentName}' not found`)
        }

        // Refresh context before each iteration (important for handoffs)
        // This ensures todo list context and other dynamic state is current
        if (iterationCount > 1) {
          processedContext = await this.processContext(data, socketId)

          // Reload conversation history for the new agent
          // This is critical - the new agent needs the full conversation history
          const { conversationHistory, ...dataWithoutHistory } = data
          const iterationData: ChatMessage = {
            ...dataWithoutHistory,
            message: currentMessage
          }

          await this.loadConversationHistory(socketId, iterationData, processedContext)

          // Use the iteration data with fresh history
          data = iterationData
        }

        // Create message data for this iteration
        const iterationData: ChatMessage = {
          ...data,
          message: currentMessage
        }

        // Stream agent response (tools execute here, including handoff)
        // Never emit completion during the loop - we'll handle it after
        await this.streamAgentResponse(socket, agent, iterationData, processedContext, agentName, startTime, false)

        // Check if handoff occurred
        const handoffDetails = this.getHandoffDetails(socketId, agentName)
        if (!handoffDetails) {
          // No handoff - we're done, exit loop
          break
        }

        // Handoff occurred - update session metadata with appId
        const currentAppId = extractAppIdFromMessageContext(data.context)
        if (
          currentAppId &&
          this.config.stateManager &&
          'setSessionMetadata' in this.config.stateManager &&
          typeof this.config.stateManager.setSessionMetadata === 'function'
        ) {
          this.config.stateManager.setSessionMetadata(socketId, { appId: currentAppId })
        }

        // Prepare for next iteration
        this.logger.info(`Handoff detected: ${agentName} -> ${handoffDetails.newAgentName}`)
        agentName = handoffDetails.newAgentName
        currentMessage = handoffDetails.handoffPrompt
      }

      if (iterationCount >= maxHandoffs) {
        this.logger.warn(`Maximum handoff limit (${maxHandoffs}) reached`)
      }

      // 8. Complete the conversation (after all handoffs complete)
      await this.completeConversation(socketId, socket, agentName, startTime, processedContext)

    } catch (error: unknown) {
      // Extract error details for UI
      let errorMessage = error instanceof Error ? error.message : String(error);
      let errorType: string | undefined;
      let statusCode: number | undefined;

      // Check if it's a BudgetExceededError (already converted in stream handler)
      const isBudgetError = BudgetExceededError.isInstance(error);
      if (isBudgetError) {
        errorMessage = error.message;
        errorType = error.errorType;
        statusCode = error.statusCode;
      }
      // Check if it's AI SDK's APICallError (but not a budget error)
      const isNonBudgetApiCallError = !isBudgetError && APICallError.isInstance(error);
      if (isNonBudgetApiCallError) {
        errorMessage = error.message;
        statusCode = error.statusCode;
      }

      this.logger.warn(`agent error detected`, {
        message: errorMessage,
        errorType,
        statusCode,
        socketId,
        agentName
      });

      this.emitToSocket(socket, 'message', {
        type: 'error',
        content: errorMessage,
        data: {
          timestamp: new Date().toISOString(),
          agentId: agentName || this.config.defaultAgent,
          ...(errorType && { errorType }),
          ...(statusCode && { statusCode })
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
   * Get the active agent for this session
   */
  private getActiveAgent(socketId: string, data: ChatMessage): string | undefined {
    // Always evaluate router first so brand new apps can start with the Initial agent
    const routedAgent = this.config.agentRouter ? this.config.agentRouter(socketId, data) : undefined

    if (this.config.stateManager && this.config.stateManager.getCurrentAgent) {
      const currentAgent = this.config.stateManager.getCurrentAgent(socketId)
      if (currentAgent) {
        const currentAppId = extractAppIdFromMessageContext(data.context)
        const sessionAppId = this.config.stateManager.getSessionMetadata?.(socketId)?.appId

        if (sessionAppId && currentAppId && sessionAppId !== currentAppId) {
          this.logger.debug('App ID changed, clearing state manager session', {
            socketId,
            oldAppId: sessionAppId,
            newAppId: currentAppId,
            oldAgent: currentAgent
          })
          this.config.stateManager.clearSession?.(socketId)
          if (routedAgent) {
            return routedAgent
          }
          // No router result - fall through so explicit agent/default logic can run
        } else {
          // Same app or no metadata tracking – honor the session-controlled agent
          return currentAgent
        }
      }
    }

    if (routedAgent) {
      return routedAgent
    }

    // Check for explicit agent selection in message (after router hook)
    if (data.agentId || data.agentName) {
      return data.agentId || data.agentName
    }

    // Fall back to default agent
    return this.config.defaultAgent
  }

  /**
   * Process context and add socketId
   */
  private async processContext(data: ChatMessage, socketId: string): Promise<Record<string, unknown>> {
    let context: Record<string, unknown>

    if (data.context && this.config.contextExtractor) {
      // contextExtractor may be async, so await it
      context = await Promise.resolve(this.config.contextExtractor(data.context))
    } else {
      context = data.context || {}
    }

    // Get current agent from state manager (for handoffs)
    // This is REQUIRED - every context must have an agentId
    const currentAgent = this.getActiveAgent(socketId, data)
    if (!currentAgent) {
      throw new Error('No active agent found - agentId is required in context.metadata')
    }

    // Ensure metadata exists and set agentId
    const metadata = ((context as { metadata?: MetadataRecord }).metadata) || {}
    context = {
      ...context,
      metadata: {
        ...metadata,
        agentId: currentAgent
      }
    }

    const appId = extractAppIdFromMetadata(metadata)
    if (
      appId &&
      this.config.stateManager &&
      'setSessionMetadata' in this.config.stateManager &&
      typeof this.config.stateManager.setSessionMetadata === 'function'
    ) {
      this.config.stateManager.setSessionMetadata(socketId, { appId })
    }

    // Add socketId so it's available to tools via executionContext
    return {
      ...context,
      socketId
    }
  }

  /**
   * Setup persistence for this conversation
   */
  private async setupPersistence(
    socketId: string,
    agentName: string,
    data: ChatMessage,
    processedContext: Record<string, unknown>
  ): Promise<void> {
    if (!this.config.messagePersistence) return

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

    if (existingConversation) {
      // Reuse existing conversation, even if agent changed (handoff scenario)
      if (this.config.messagePersistence.continueConversation) {
        await this.config.messagePersistence.continueConversation(
          existingConversation.conversationId,
          data.message,
          persistenceContext
        )
      }

      // Update agent name and context for handoff
      existingConversation.agentName = agentName
      existingConversation.context = persistenceContext
      existingConversation.streamingEvents = []
      this.initializeConversationBuffers(existingConversation)
    } else {
      // Create new conversation (first message only)
      const conversationId = await this.config.messagePersistence.startConversation(
        data.message,
        persistenceContext
      )

      // Track conversation for streaming events
      this.activeConversations.set(socketId, {
        conversationId,
        agentName,
        context: persistenceContext,
        streamingEvents: [],
        startTime: Date.now(),
        pendingSegments: [],
        pendingToolCalls: new Map(),
        accumulatedContent: ''
      })
    }
  }

  /**
   * Load conversation history if available
   */
  private async loadConversationHistory(
    socketId: string,
    data: ChatMessage,
    processedContext: Record<string, unknown>
  ): Promise<void> {
    if (!this.config.messageProvider || data.conversationHistory) return

    const conversation = this.activeConversations.get(socketId)
    if (!conversation) return

    try {
      const conversationHistory = await this.config.messageProvider.loadMessages(
        conversation.conversationId,
        processedContext
      )

      data.conversationHistory = conversationHistory
    } catch (error) {
      this.logger.warn('Failed to load conversation history', error)
    }
  }

  /**
   * Check if handoff occurred and get details
   */
  private getHandoffDetails(
    socketId: string,
    currentAgentName: string
  ): { newAgentName: string; handoffPrompt: string } | null {
    if (!this.config.stateManager || !this.config.stateManager.getCurrentAgent) {
      return null
    }

    const newAgentName = this.config.stateManager.getCurrentAgent(socketId)
    if (!newAgentName || newAgentName === currentAgentName) {
      return null
    }

    // Handoff occurred - get the prompt
    const handoffPrompt = this.config.stateManager.getLastHandoffPrompt?.(socketId)
    if (!handoffPrompt) {
      this.logger.warn(`Handoff to ${newAgentName} detected but no prompt available`)
      return null
    }

    // Clear the prompt so it's not reused
    this.config.stateManager.clearLastHandoffPrompt?.(socketId)

    return { newAgentName, handoffPrompt }
  }

  /**
   * Complete the conversation after all handoffs
   */
  private async completeConversation(
    socketId: string,
    socket: any,
    agentName: string,
    startTime: number,
    processedContext: Record<string, unknown>
  ): Promise<void> {
    const duration = `${Date.now() - startTime}ms`

    // Complete persistence FIRST (includes git commits) before sending complete event
    // Store commit hash if persistence layer provides it via context
    let commitHash: string | null = null
    const conversation = this.activeConversations.get(socketId)
    if (conversation && this.config.messagePersistence) {
      await this.config.messagePersistence.completeConversation(
        conversation.conversationId,
        conversation.streamingEvents,
        { agentName, duration },
        conversation.context
      )

      // Get commit hash from context (always set by persistence layer: string or null)
      commitHash = (conversation.context as any).commitHash ?? null

      // Don't delete conversation - keep it active for next user message
      // Only cleanup happens on disconnect or error
    }

    // Emit final completion event to client AFTER persistence completes
    // Always include commit hash (null if no commit was created)
    this.emitToSocket(socket, 'message', {
      type: 'complete',
      content: '',
      data: {
        totalSteps: 1, // We don't track steps across handoffs
        usage: undefined,
        toolCalls: [],
        agentId: agentName,
        duration,
        commitHash // null if no commit, hash string if commit was created
      }
    } as WebSocketMessage)

    // Call completion handler
    this.config.onMessageComplete?.(socketId, {
      agentName,
      duration,
      usage: undefined,
      toolCalls: []
    }, processedContext)
  }

  /**
   * Assemble messages from various providers with proper ordering and cache points
   */
  private async assembleMessages(
    data: ChatMessage,
    context: Record<string, unknown> | undefined
  ): Promise<{
    messages: ModelMessage[]
    contextMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'ephemeral' } }>
  }> {
    const messages: ModelMessage[] = []
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

        this.logger.info(`Loaded ${loadedContextMessages.length} context messages (${beforeHistoryMessages.length} before history, ${afterHistoryMessages.length} after history)`)
        this.logger.info(`Cache points: ${loadedContextMessages.filter(m => m.cachePoint).length} messages with caching enabled`)
      } catch (error) {
        this.logger.error('Error loading context messages', error)
        // Continue without context if loading fails
      }
    }

    // Assemble final message order:
    // 1. Context messages marked "before_history" go to contextMessages
    contextMessages.push(...beforeHistoryMessages)

    // 2. Conversation history (if provided) - preserve full message structure including tool calls
    if (data.conversationHistory && data.conversationHistory.length > 0) {
      this.logger.info(`Adding ${data.conversationHistory.length} conversation history messages`)
      const convertedHistoryMessages = data.conversationHistory.map(msg => {
        const converted: any = {
          role: msg.role,
          content: msg.content,
          ...(msg.cachePoint && { cachePoint: msg.cachePoint })
        }

        // Preserve tool calls for assistant messages
        if (msg.role === 'assistant' && msg.tool_calls) {
          converted.tool_calls = msg.tool_calls
        }

        // Tool messages already have content in the correct format (array of tool-result parts)

        return converted
      })
      messages.push(...convertedHistoryMessages)
    }

    // 3. Context messages marked "after_history" go to messages (after conversation history, before user message)
    messages.push(...afterHistoryMessages)

    // 4. Strip leading tool messages that appear before any assistant message
    // This prevents orphaned tool results from being placed at the start of conversation
    // which can happen when context messages are prepended to history
    while (messages.length > 0 && messages[0] && messages[0].role === 'tool') {
      const removedMessage = messages.shift()
      if (removedMessage) {
        this.logger.warn('Stripped leading tool message without preceding assistant message', {
          toolCallId: (removedMessage as any).tool_call_id,
          reason: 'Tool results must follow assistant tool calls, cannot be first message'
        })
      }
    }

    this.logger.info('Message assembly complete', {
      contextMessages: contextMessages.length,
      messages: messages.length,
      cachePoints: contextMessages.filter(m => m.cachePoint).length + messages.filter(m => (m as any).cachePoint).length
    })

    return { messages, contextMessages }
  }

  /**
   * Stream agent response to client using normalized event schema
   * @param shouldComplete - Whether to complete the conversation (false during handoffs)
   */
  private async streamAgentResponse(
    socket: any,
    agent: AgentWrapper,
    data: ChatMessage,
    context: Record<string, unknown> | undefined,
    agentName: string,
    startTime: number,
    shouldComplete: boolean = true
  ): Promise<void> {
    let currentStep = 1

    // Keep the original user prompt intact - no modification!
    const originalPrompt = data.message

    // if the last message in messages == originalPrompt, remove it
    if (data.conversationHistory && data.conversationHistory.length > 0) {
      const lastMessage = data.conversationHistory[data.conversationHistory.length - 1]
      if (lastMessage && lastMessage.content === originalPrompt) {
        data.conversationHistory.pop()
      }
    }

    // Assemble messages using clean interface-based approach
    const { messages, contextMessages } = await this.assembleMessages(data, context)

    const activeConversation = this.activeConversations.get(socket.id)
    if (activeConversation && this.config.messagePersistence?.startAgentTurn) {
      try {
        const messageId = await this.config.messagePersistence.startAgentTurn(
          activeConversation.conversationId,
          activeConversation.context
        )
        activeConversation.context.agentMessageId = messageId
      } catch (error) {
        this.logger.warn('Failed to start agent turn', error)
      }
    }

    // Start streaming using streamGenerate with clean message assembly
    // Extract screenshots from context metadata if present
    let processedFiles: any[] | undefined
    if (context?.metadata && Array.isArray((context.metadata as any)._screenshots)) {
      const screenshots = (context.metadata as any)._screenshots as string[]
      processedFiles = []
      for (let i = 0; i < screenshots.length; i++) {
        try {
          // Convert data URL to ProcessedFile
          const dataUrl = screenshots[i]
          if (!dataUrl) continue

          const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
          if (matches && matches[1] && matches[2]) {
            const mimeType: string = matches[1]
            const base64Content: string = matches[2]
            const size = Math.ceil((base64Content.length * 3) / 4)
            const fileExtension = mimeType.split('/')[1] || 'png'

            processedFiles.push({
              input: {
                source: dataUrl,
                mimeType,
                filename: `screenshot-${i + 1}.${fileExtension}`
              },
              base64Content,
              metadata: {
                size,
                mimeType,
                filename: `screenshot-${i + 1}.${fileExtension}`,
                extractedAt: new Date(),
                processingTime: 0
              }
            })
          }
        } catch (error) {
          this.logger.error('Failed to process screenshot', error)
        }
      }
      if (processedFiles.length > 0) {
        this.logger.info(`Attached ${processedFiles.length} image(s) for vision processing (screenshots + asset images)`)
      }
    }

    let streamResult
    try {
      streamResult = await agent.streamGenerate(originalPrompt, {
        // Add context messages with cache points intact
        ...(contextMessages.length > 0 && { context: contextMessages }),
        // Add conversation history messages
        ...(messages.length > 0 && { messages }),
        // Pass execution context for tools
        ...(context && { executionContext: context }),
        // Pass screenshots as files for vision processing
        ...(processedFiles && processedFiles.length > 0 && { files: processedFiles })
      })
    } catch (error: any) {
      // Handle API call errors (like tool input validation failures)
      const isAPIError = APICallError.isInstance(error)

      this.logger.debug('Caught error in streamGenerate', {
        name: error?.name,
        message: error?.message,
        statusCode: isAPIError ? error.statusCode : error?.statusCode,
        responseBody: isAPIError ? error.responseBody?.slice(0, 200) : error?.responseBody?.slice?.(0, 200),
        isAPIError,
        hasToolUseInvalid: error?.message?.includes('toolUse.input is invalid'),
        hasJSONParsingFailed: error?.message?.includes('JSON parsing failed')
      })

      const isToolValidationError =
        error?.message?.includes('toolUse.input is invalid') ||
        error?.message?.includes('JSON parsing failed')

      if (isToolValidationError) {
        this.logger.error('Tool input validation error', { message: error.message })

        // Emit step start for the failed tool call
        const stepStartData = {
          step: currentStep,
          stepType: 'reasoning',
          agentId: agentName
        }
        this.emitToSocket(socket, 'message', {
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
          },
          agentId: agentName
        }

        this.emitToSocket(socket, 'message', {
          type: 'tool_result',
          content: 'Tool call failed - invalid JSON format',
          data: toolErrorData
        } as WebSocketMessage)

        await this.captureStreamingEvent(socket.id, 'tool_result', 'Tool call failed - invalid JSON format', toolErrorData)

        // Emit step complete to indicate this attempt is done
        this.emitToSocket(socket, 'message', {
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
            usage: undefined,
            agentId: agentName
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
            ...(context && { executionContext: context }),
            // Include screenshots in retry as well
            ...(processedFiles && processedFiles.length > 0 && { files: processedFiles })
          })
        } catch (retryError: any) {
          // If retry also fails, fall back to error handling
          this.logger.error('Retry also failed', { message: retryError.message })
          throw retryError
        }
      } else {
        // Non-retryable errors (budget exceeded, etc.) should propagate immediately
        const errorClassification = classifyError(error);
        if (!errorClassification.retryable) {
          this.logger.warn(`Non-retryable error in streamGenerate: ${errorClassification.category || 'unknown'}`, {
            category: errorClassification.category,
            statusCode: errorClassification.statusCode
          });
          throw error;
        }

        // Re-throw other errors to be handled by the outer catch block
        throw error
      }
    }

    const fullContent = ''

    // Emit step start (currentStep was already incremented in error handler if needed)
    const stepStartData = {
      step: currentStep,
      stepType: 'reasoning',
      agentId: agentName
    }
    this.emitToSocket(socket, 'message', {
      type: 'step_start',
      content: '',
      data: stepStartData
    } as WebSocketMessage)

    // Capture for persistence
    await this.captureStreamingEvent(socket.id, 'step_start', '', stepStartData)

    // Process both text chunks and tool events from baseStream
    await this.processStreamWithToolEvents(socket, streamResult, currentStep, agentName)

    // Get final result with usage and tool calls
    const finalResult = await streamResult.getFinalResult() as AgentExecutionResult

    // Log token and cache usage information
    // Use totalUsage for accurate multi-step token tracking (sums all steps)
    const usageToTrack = finalResult.totalUsage || finalResult.usage
    if (usageToTrack) {
      // Merge usage data with caching information
      const usage: TokenUsage = {
        ...usageToTrack,
        // Include cache metrics from the caching object if available
        ...(finalResult.caching && {
          cachedInputTokensRead: finalResult.caching.cachedInputTokens,
          cachedInputTokensWrite: finalResult.caching.cacheWriteInputTokens
        })
      }

      // Get model information from agent config
      // Get model name from agent configuration
      let modelName = 'unknown'
      try {
        const agentConfig = agent.getConfig()
        modelName = agentConfig.modelName || agentName || 'unknown'
      } catch (error) {
        this.logger.warn(`Failed to get model name from agent config: ${error}`)
        modelName = agentName || 'unknown'
      }

      this.logger.info('Token Usage Statistics', {
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        totalTokens: usage.totalTokens || 0
      })

      // Log cache usage if available
      const totalCachedTokens = (usage.cachedInputTokensRead || 0) + (usage.cachedInputTokensWrite || 0)
      if (totalCachedTokens > 0) {
        const cacheHitRate = getCacheHitRate(usage)
        const cacheDetails: any = {
          totalCachedTokens,
          cacheHitRate: cacheHitRate.toFixed(1) + '%'
        }
        if (usage.cachedInputTokensRead && usage.cachedInputTokensWrite) {
          cacheDetails.read = usage.cachedInputTokensRead
          cacheDetails.write = usage.cachedInputTokensWrite
        } else if (usage.cachedInputTokensRead) {
          cacheDetails.read = usage.cachedInputTokensRead
        } else if (usage.cachedInputTokensWrite) {
          cacheDetails.write = usage.cachedInputTokensWrite
        }
        this.logger.info('Cache usage', cacheDetails)
      } else {
        this.logger.info('No cache usage detected')
      }

      // Calculate and log cost estimate using accurate model pricing
      const costEstimate = calculateCostEstimate(usage, modelName)
      const costLines = formatCostEstimate(costEstimate, usage)
      this.logger.info(costLines.join('\n'))

      // Call onTokenUsage callback with accurate multi-step usage
      if (this.config.onTokenUsage) {
        try {
          const activeConversation = this.activeConversations.get(socket.id)
          const processedContext = context as ProcessedContext
          await this.config.onTokenUsage(
            {
              inputTokens: usage.inputTokens || 0,
              outputTokens: usage.outputTokens || 0,
              totalTokens: usage.totalTokens || 0,
              ...(usage.cachedInputTokensRead !== undefined && { cachedInputTokens: usage.cachedInputTokensRead }),
              ...(usage.cachedInputTokensWrite !== undefined && { cacheWriteInputTokens: usage.cachedInputTokensWrite })
            },
            {
              agentName,
              modelName,
              ...(activeConversation?.conversationId && { conversationId: activeConversation.conversationId }),
              ...(processedContext?.appId && { appId: processedContext.appId })
            }
          )
        } catch (error) {
          this.logger.error('Error in onTokenUsage callback', { error })
        }
      }
    }

    // Calculate duration
    const duration = `${Date.now() - startTime}ms`

    // Emit step complete
    this.emitToSocket(socket, 'message', {
      type: 'step_complete',
      content: fullContent,
      data: {
        step: currentStep,
        isFinal: true,
        toolCalls: finalResult.toolCalls || [],
        usage: this.config.includeUsageData ? usageToTrack : undefined,
        agentId: agentName
      }
    } as WebSocketMessage)

    // Only emit completion events if this is the final agent (no handoff pending)
    if (shouldComplete) {
      // Emit final completion event
      this.emitToSocket(socket, 'message', {
        type: 'complete',
        content: fullContent,
        data: {
          totalSteps: currentStep,
          usage: this.config.includeUsageData ? usageToTrack : undefined,
          toolCalls: finalResult.toolCalls || [],
          agentId: agentName,
          duration
        }
      } as WebSocketMessage)
    }

    // Note: Conversation completion is now handled by completeConversation()
    // This allows multiple agents to contribute to the same conversation during handoffs
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
  agentConfig: Parameters<AgentFactory['defineAgents']>[0][string]
): AgentFactory {
  const factory = createAgentFactory()
  factory.defineAgents({
    [agentName]: agentConfig
  })

  return factory
}

/**
 * Create an WebSocketServer instance
 */
export function createWebSocketServer(
  httpServer: HTTPServer,
  config: WebSocketConfig
): WebSocketServer {
  return new WebSocketServer(httpServer, config)
}

function extractAppIdFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined
  }
  const appIdValue = (metadata as MetadataRecord).appId
  return typeof appIdValue === 'string' ? appIdValue : undefined
}

function extractAppIdFromMessageContext(context: unknown): string | undefined {
  if (!context || typeof context !== 'object') {
    return undefined
  }
  const metadata = (context as { metadata?: MetadataRecord }).metadata
  return extractAppIdFromMetadata(metadata)
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
  agentConfig: Parameters<AgentFactory['defineAgents']>[0][string],
  options?: Omit<WebSocketConfig, 'agents' | 'defaultAgent'>
): WebSocketServer {
  const factory = createSingleAgentFactory(agentName, agentConfig)
  const agents = factory.defineAgents({ [agentName]: agentConfig })

  return new WebSocketServer(httpServer, {
    agents,
    defaultAgent: agentName,
    ...options
  })
}

/**
 * Agent Observability Events Service
 *
 * Wraps the @godaddy/agent-observability-events SDK to provide
 * structured event tracking for agent conversations, invocations,
 * tool executions, and handoffs.
 */

import { randomUUID } from 'node:crypto'
import {
  AgentEventsClient,
  NodeEnvEnum,
  createConversationStart,
  createConversationEnd,
  createInvocationStart,
  createInvocationEnd,
  createToolStart,
  createToolEnd,
  createHandoff,
  createError,
  createLlmStart,
  createLlmEnd,
  type AgentGlobalContext,
  type LlmOutputMessage
} from '@godaddy/agent-observability-events'
import { logger } from '../logging/index.js'

/**
 * Configuration options for the Agent Observability Service
 */
export interface AgentObservabilityConfig {
  /** GoDaddy environment (dev, test, prod) */
  env: 'dev' | 'test' | 'prod'
  /** Unique agent identifier */
  agentId: string
  /** Human-readable agent name */
  agentName?: string
  /** Agent version string */
  agentVersion?: string
  /** API key for Event Bus authentication (required for test/prod) */
  apiKey?: string | undefined
  /** Enable PCI data auto-sanitization (default: true) */
  autoSanitizePci?: boolean
  /** Enable sensitive data mode - omits all input/output text (default: false) */
  sensitiveDataMode?: boolean
  /** Static global context applied to all events */
  globalContext?: AgentGlobalContext
}

/**
 * Session state for tracking conversation timing and IDs
 */
export interface SessionState {
  conversationId: string
  traceId: string
  spanId: string
  startTime: number
  invocationCount: number
}

/**
 * Generate a 32-character hex trace ID
 *
 * @returns Hex trace ID string
 */
export function generateTraceId(): string {
  return randomUUID().replace(/-/g, '')
}

/**
 * Generate a 16-character hex span ID
 *
 * @returns Hex span ID string
 */
export function generateSpanId(): string {
  return randomUUID().replace(/-/g, '').substring(0, 16)
}

/**
 * Service for sending agent observability events to the Event Bus
 *
 * Provides a simplified interface for tracking agent lifecycle events including:
 * - Conversation start/end
 * - Invocations (user request handling)
 * - LLM calls
 * - Tool executions
 * - Agent handoffs
 * - Errors
 *
 * @example
 * ```typescript
 * const service = new AgentObservabilityService({
 *   env: 'dev',
 *   agentId: 'my-agent',
 *   agentName: 'My Agent',
 *   agentVersion: '1.0.0'
 * })
 *
 * // Start a conversation (synchronous - IDs generated locally)
 * const session = service.startConversation({
 *   privateLabelId: 1,
 *   userType: 'c1',
 *   visitorId: 'visitor-uuid'
 * })
 *
 * // Track an invocation (synchronous - IDs generated locally)
 * const invocation = service.startInvocation(session.conversationId, 'user message')
 * ```
 */
export class AgentObservabilityService {
  private client: AgentEventsClient | null = null
  private readonly config: AgentObservabilityConfig
  private readonly enabled: boolean
  private readonly sessions: Map<string, SessionState> = new Map()

  /**
   * Create a new Agent Observability Service
   *
   * @param config - Service configuration options
   */
  constructor(config: AgentObservabilityConfig) {
    this.config = config
    this.enabled = true

    logger.info('observability.constructor.begin', {
      message: 'Creating observability service',
      agentId: config.agentId,
      env: config.env
    })

    try {
      this.client = this.createClient()
      logger.info('observability.initialized', {
        message: 'Agent observability service initialized',
        agentId: config.agentId,
        agentName: config.agentName,
        env: config.env,
        enabled: this.enabled,
        hasClient: this.client !== null
      })
    } catch (error) {
      logger.error('observability.init_failed', {
        message: 'Failed to initialize agent observability service',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      this.enabled = false
    }
  }

  /**
   * Create the underlying AgentEventsClient
   */
  private createClient(): AgentEventsClient {
    // Map our env to nodeEnv format expected by SDK
    // Explicitly set nodeEnv to override NODE_ENV detection (takes precedence over env.NODE_ENV)
    const nodeEnvMap: Record<string, NodeEnvEnum> = {
      dev: NodeEnvEnum.Development,
      test: NodeEnvEnum.Test,
      prod: NodeEnvEnum.Production
    }

    return new AgentEventsClient({
      nodeEnv: nodeEnvMap[this.config.env] || NodeEnvEnum.Development,
      agentId: this.config.agentId,
      autoSanitizePci: this.config.autoSanitizePci ?? false,
      sensitiveDataMode: this.config.sensitiveDataMode ?? false,
      ...(this.config.agentName && { agentName: this.config.agentName }),
      ...(this.config.agentVersion && { agentVersion: this.config.agentVersion }),
      ...(this.config.apiKey && { apiKey: this.config.apiKey }),
      ...(this.config.globalContext && { globalContext: this.config.globalContext }),
      eventBusOptions: { dxEnabled: false }
    })
  }

  /**
   * Check if the service is enabled
   *
   * @returns True if observability is enabled and client is initialized
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null
  }

  /**
   * Start a new conversation session (non-blocking)
   *
   * Creates a unique conversation ID and initializes session tracking.
   * IDs are generated locally and returned immediately.
   * Event is sent to Event Bus in background (fire-and-forget).
   *
   * @param context - Session context data
   * @returns Session state with generated IDs
   */
  startConversation(context: {
    privateLabelId?: number
    userType?: string
    visitorId?: string
    sessionId?: string
    customerId?: string
    market?: string
  }): SessionState {
    const conversationId = randomUUID()
    const traceId = generateTraceId()
    const spanId = generateSpanId()
    const startTime = Date.now()

    const session: SessionState = {
      conversationId,
      traceId,
      spanId,
      startTime,
      invocationCount: 0
    }

    this.sessions.set(conversationId, session)

    // Return session immediately - IDs are generated locally, no need to wait for Event Bus
    // Send event to Event Bus in background (fire-and-forget)
    if (this.isEnabled()) {
      this.sendConversationStartInBackground(conversationId, traceId, spanId, context)
    }

    return session
  }

  /**
   * Send conversation start event to Event Bus in background (non-blocking)
   */
  private sendConversationStartInBackground(
    conversationId: string,
    traceId: string,
    spanId: string,
    context: {
      privateLabelId?: number
      userType?: string
      visitorId?: string
      sessionId?: string
      customerId?: string
      market?: string
    }
  ): void {
    // Build globalContext only with defined values to avoid overriding client defaults
    const globalContext: AgentGlobalContext = {}
    if (context.privateLabelId !== undefined || context.market !== undefined) {
      globalContext.site = {}
      if (context.privateLabelId !== undefined) globalContext.site.privateLabelId = context.privateLabelId
      if (context.market !== undefined) globalContext.site.market = context.market
    }
    if (context.userType !== undefined || context.visitorId !== undefined || context.sessionId !== undefined || context.customerId !== undefined) {
      globalContext.context = {}
      if (context.userType !== undefined) globalContext.context.userType = context.userType
      if (context.visitorId !== undefined) globalContext.context.visitorId = context.visitorId
      if (context.sessionId !== undefined) globalContext.context.sessionId = context.sessionId
      if (context.customerId !== undefined) globalContext.context.customerId = context.customerId
    }

    const sendPromise = Object.keys(globalContext).length > 0
      ? this.client!.sendConversationStart({
          conversationId,
          traceId,
          spanId,
          eventData: createConversationStart(),
          globalContext
        })
      : this.client!.sendConversationStart({
          conversationId,
          traceId,
          spanId,
          eventData: createConversationStart()
        })

    // Fire-and-forget with logging
    logger.info('observability.conversation.sending', {
      conversationId,
      traceId,
      spanId,
      dxEnabled: false,
      env: this.config.env
    })

    sendPromise
      .then(() => {
        logger.info('observability.conversation.started', { conversationId, traceId })
      })
      .catch((error: unknown) => {
        logger.error('observability.conversation.start_failed', {
          conversationId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
      })
  }

  /**
   * End a conversation session
   *
   * @param conversationId - The conversation ID to end
   * @param closeReason - Reason for closing the conversation
   */
  async endConversation(
    conversationId: string,
    closeReason: 'completion' | 'agent_initiated' | 'task_complete' | 'manual' = 'completion'
  ): Promise<void> {
    const session = this.sessions.get(conversationId)
    if (!session) {
      logger.warn('observability.conversation.not_found', {
        conversationId,
        message: 'Session not found for conversation end'
      })
      return
    }

    const durationMs = Date.now() - session.startTime

    if (!this.isEnabled()) {
      this.sessions.delete(conversationId)
      return
    }

    try {
      // Reuse conversation's traceId and spanId to keep all events in the same trace
      await this.client!.sendConversationEnd({
        conversationId,
        traceId: session.traceId,
        spanId: session.spanId,
        eventData: createConversationEnd({
          closeReason,
          conversationDurationMs: durationMs
        })
      })

      logger.debug('observability.conversation.ended', {
        conversationId,
        durationMs,
        closeReason,
        invocationCount: session.invocationCount
      })
    } catch (error) {
      logger.error('observability.conversation.end_failed', {
        conversationId,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.sessions.delete(conversationId)
    }
  }

  /**
   * Start tracking an agent invocation (non-blocking)
   *
   * Invocations are nested under the conversation trace, using the conversation's
   * traceId and the conversation's spanId as the parent span.
   * IDs are generated locally and returned immediately.
   * Event is sent to Event Bus in background (fire-and-forget).
   *
   * @param conversationId - The conversation ID
   * @param inputText - User's input message
   * @param parentSpanId - Optional parent span for nested tracking (defaults to conversation span)
   * @returns Object with traceId, spanId, and startTime
   */
  startInvocation(
    conversationId: string,
    inputText: string,
    parentSpanId?: string
  ): { traceId: string; spanId: string; startTime: number } {
    const session = this.sessions.get(conversationId)
    // Reuse conversation's traceId to keep invocations in the same trace, or generate new
    const traceId = session?.traceId || generateTraceId()
    const spanId = generateSpanId()
    const startTime = Date.now()
    // Use conversation's spanId as parent if no explicit parent provided
    const effectiveParentSpanId = parentSpanId || session?.spanId

    if (session) {
      session.invocationCount++
    }

    // Return immediately - IDs are generated locally, no need to wait for Event Bus
    // Send event to Event Bus in background (fire-and-forget)
    if (this.isEnabled()) {
      this.sendInvocationStartInBackground(conversationId, traceId, spanId, inputText, effectiveParentSpanId)
    }

    return { traceId, spanId, startTime }
  }

  /**
   * Send invocation start event to Event Bus in background (non-blocking)
   */
  private sendInvocationStartInBackground(
    conversationId: string,
    traceId: string,
    spanId: string,
    inputText: string,
    parentSpanId?: string
  ): void {
    this.client!.sendInvocationStart({
      conversationId,
      traceId,
      spanId,
      eventData: createInvocationStart({ inputText }),
      ...(parentSpanId && { parentSpanId })
    })
      .then(() => {
        logger.debug('observability.invocation.started', { conversationId, traceId, spanId })
      })
      .catch((error: unknown) => {
        logger.error('observability.invocation.start_failed', {
          conversationId,
          error: error instanceof Error ? error.message : String(error)
        })
      })
  }

  /**
   * Track the end of an agent invocation
   *
   * @param conversationId - The conversation ID
   * @param traceId - Trace ID from startInvocation
   * @param spanId - Span ID from startInvocation
   * @param data - Invocation result data
   */
  async endInvocation(
    conversationId: string,
    traceId: string,
    spanId: string,
    data: {
      responseType: 'tool_call' | 'llm_reply' | 'handoff'
      startTime: number
      outputText?: string
      totalTokens?: number
      totalCost?: number
      executionOutcome?: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'INCOMPLETE' | 'UNKNOWN'
      userIntent?: string
    }
  ): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    const durationMs = Date.now() - data.startTime

    try {
      await this.client!.sendInvocationEnd({
        conversationId,
        traceId,
        spanId,
        eventData: createInvocationEnd({
          responseType: data.responseType,
          durationMs,
          ...(data.outputText && { outputText: data.outputText }),
          ...(data.totalTokens && { totalTokens: data.totalTokens }),
          ...(data.totalCost && { totalCost: data.totalCost }),
          ...(data.executionOutcome && { executionOutcome: data.executionOutcome }),
          ...(data.userIntent && { userIntent: data.userIntent })
        })
      })

      logger.debug('observability.invocation.ended', {
        conversationId,
        traceId,
        durationMs,
        responseType: data.responseType
      })
    } catch (error) {
      logger.error('observability.invocation.end_failed', {
        conversationId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Track the start of an LLM call
   *
   * @param conversationId - The conversation ID
   * @param traceId - Parent trace ID
   * @param parentSpanId - Parent span ID (invocation)
   * @param data - LLM call parameters
   * @returns Span ID and start time for this LLM call
   */
  async startLlmCall(
    conversationId: string,
    traceId: string,
    parentSpanId: string,
    data: {
      model: string
      provider: string
      input: Array<{ role: LlmOutputMessage['role']; content: string }>
      tools?: string[]
      toolChoice?: 'auto' | 'required' | 'none'
    }
  ): Promise<{ spanId: string; startTime: number }> {
    const spanId = generateSpanId()
    const startTime = Date.now()

    if (!this.isEnabled()) {
      return { spanId, startTime }
    }

    try {
      logger.info('observability.llm.sending', {
        conversationId,
        spanId,
        model: data.model,
        provider: data.provider,
        inputCount: data.input?.length || 0
      })

      await this.client!.sendLlmStart({
        conversationId,
        traceId,
        spanId,
        parentSpanId,
        eventData: createLlmStart({
          model: data.model,
          provider: data.provider,
          input: data.input,
          ...(data.tools && { tools: data.tools }),
          ...(data.toolChoice && { toolChoice: data.toolChoice })
        })
      })

      logger.info('observability.llm.started', {
        conversationId,
        spanId,
        model: data.model,
        provider: data.provider
      })
    } catch (error) {
      logger.error('observability.llm.start_failed', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    }

    return { spanId, startTime }
  }

  /**
   * Track the end of an LLM call
   *
   * @param conversationId - The conversation ID
   * @param traceId - Parent trace ID
   * @param spanId - Span ID from startLlmCall
   * @param parentSpanId - Parent span ID
   * @param data - LLM result data
   */
  async endLlmCall(
    conversationId: string,
    traceId: string,
    spanId: string,
    parentSpanId: string,
    data: {
      model: string
      provider: string
      startTime: number
      output: LlmOutputMessage[]
      toolCalls?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>
      usage?: {
        totalTokens?: number
        inputTokens?: number
        outputTokens?: number
        cachedTokens?: number
        reasoningTokens?: number
        totalCost?: number
      }
      finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call'
      executionOutcome?: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'UNKNOWN'
      responseId?: string
      reasoningSummary?: string
    }
  ): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    const durationMs = Date.now() - data.startTime

    try {
      logger.info('observability.llm.end.sending', {
        conversationId,
        spanId,
        model: data.model,
        durationMs,
        outputCount: data.output?.length || 0,
        toolCallCount: data.toolCalls?.length || 0
      })

      await this.client!.sendLlmEnd({
        conversationId,
        traceId,
        spanId,
        parentSpanId,
        eventData: createLlmEnd({
          model: data.model,
          provider: data.provider,
          durationMs,
          output: data.output,
          // executionOutcome is required by the SDK - always include it
          executionOutcome: data.executionOutcome || 'SUCCESS',
          ...(data.toolCalls && { toolCalls: data.toolCalls }),
          ...(data.usage && { usage: data.usage }),
          ...(data.finishReason && { finishReason: data.finishReason }),
          ...(data.responseId && { responseId: data.responseId }),
          ...(data.reasoningSummary && { reasoningSummary: data.reasoningSummary })
        })
      })

      logger.info('observability.llm.ended', {
        conversationId,
        traceId,
        spanId,
        parentSpanId,
        durationMs,
        model: data.model,
        provider: data.provider,
        finishReason: data.finishReason,
        executionOutcome: data.executionOutcome || 'SUCCESS',
        hasOutput: data.output?.length > 0,
        hasUsage: !!data.usage,
        hasToolCalls: !!data.toolCalls?.length
      })
    } catch (error) {
      logger.error('observability.llm.end_failed', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    }
  }

  /**
   * Track the start of a tool execution
   *
   * @param conversationId - The conversation ID
   * @param traceId - Parent trace ID
   * @param parentSpanId - Parent span ID
   * @param data - Tool execution parameters
   * @returns Tool call ID and span ID for tracking
   */
  async startToolExecution(
    conversationId: string,
    traceId: string,
    parentSpanId: string,
    data: {
      toolName: string
      toolCallId: string
      toolInput?: Record<string, unknown>
    }
  ): Promise<{ spanId: string; startTime: number }> {
    const spanId = generateSpanId()
    const startTime = Date.now()

    if (!this.isEnabled()) {
      return { spanId, startTime }
    }

    try {
      await this.client!.sendToolStart({
        conversationId,
        traceId,
        spanId,
        parentSpanId,
        eventData: createToolStart({
          toolName: data.toolName,
          toolCallId: data.toolCallId,
          ...(data.toolInput && { toolInput: data.toolInput })
        })
      })

      logger.debug('observability.tool.started', {
        conversationId,
        spanId,
        toolName: data.toolName,
        toolCallId: data.toolCallId
      })
    } catch (error) {
      logger.error('observability.tool.start_failed', {
        conversationId,
        toolName: data.toolName,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return { spanId, startTime }
  }

  /**
   * Track the end of a tool execution
   *
   * @param conversationId - The conversation ID
   * @param traceId - Parent trace ID
   * @param spanId - Span ID from startToolExecution
   * @param parentSpanId - Parent span ID
   * @param data - Tool result data
   */
  async endToolExecution(
    conversationId: string,
    traceId: string,
    spanId: string,
    parentSpanId: string,
    data: {
      toolName: string
      toolCallId: string
      startTime: number
      executionOutcome?: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'UNKNOWN'
      toolResponse?: unknown
    }
  ): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    const durationMs = Date.now() - data.startTime

    try {
      await this.client!.sendToolEnd({
        conversationId,
        traceId,
        spanId,
        parentSpanId,
        eventData: createToolEnd({
          toolName: data.toolName,
          toolCallId: data.toolCallId,
          durationMs,
          ...(data.executionOutcome && { executionOutcome: data.executionOutcome }),
          ...(data.toolResponse !== undefined && { toolResponse: data.toolResponse })
        })
      })

      logger.debug('observability.tool.ended', {
        conversationId,
        spanId,
        toolName: data.toolName,
        durationMs,
        outcome: data.executionOutcome
      })
    } catch (error) {
      logger.error('observability.tool.end_failed', {
        conversationId,
        toolName: data.toolName,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Track an agent handoff
   *
   * @param conversationId - The conversation ID
   * @param traceId - Parent trace ID
   * @param parentSpanId - Parent span ID
   * @param data - Handoff details
   */
  async trackHandoff(
    conversationId: string,
    traceId: string,
    parentSpanId: string,
    data: {
      fromAgentName: string
      fromAgentId: string
      toAgentName: string
      toAgentId: string
      reason: string
      routingMethod: 'llm' | 'rule_based' | 'hybrid'
    }
  ): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    const spanId = generateSpanId()

    try {
      await this.client!.sendHandoff({
        conversationId,
        traceId,
        spanId,
        parentSpanId,
        eventData: createHandoff({
          fromAgentName: data.fromAgentName,
          fromAgentId: data.fromAgentId,
          toAgentName: data.toAgentName,
          toAgentId: data.toAgentId,
          reason: data.reason,
          routingMethod: data.routingMethod
        })
      })

      logger.debug('observability.handoff.tracked', {
        conversationId,
        fromAgent: data.fromAgentId,
        toAgent: data.toAgentId,
        reason: data.reason
      })
    } catch (error) {
      logger.error('observability.handoff.failed', {
        conversationId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Track an error event
   *
   * @param conversationId - The conversation ID
   * @param traceId - Parent trace ID
   * @param parentSpanId - Parent span ID
   * @param data - Error details
   */
  async trackError(
    conversationId: string,
    traceId: string,
    parentSpanId: string,
    data: {
      errorType: string
      errorMessage: string
      errorPhase: 'init' | 'execution' | 'cleanup'
      isRetryable: boolean
      errorStack?: string
    }
  ): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    const spanId = generateSpanId()

    try {
      await this.client!.sendError({
        conversationId,
        traceId,
        spanId,
        parentSpanId,
        eventData: createError({
          errorType: data.errorType,
          errorMessage: data.errorMessage,
          errorPhase: data.errorPhase,
          isRetryable: data.isRetryable,
          ...(data.errorStack && { errorStack: data.errorStack })
        })
      })

      logger.debug('observability.error.tracked', {
        conversationId,
        errorType: data.errorType,
        errorPhase: data.errorPhase
      })
    } catch (error) {
      logger.error('observability.error.tracking_failed', {
        conversationId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Get session state for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Session state or undefined if not found
   */
  getSession(conversationId: string): SessionState | undefined {
    return this.sessions.get(conversationId)
  }
}

/**
 * Singleton instance of the Agent Observability Service
 * Initialized with configuration from environment variables
 */
let observabilityService: AgentObservabilityService | null = null

/**
 * Get or create the singleton observability service instance
 *
 * @returns The observability service instance
 */
/**
 * Detect environment from GoDaddy infrastructure URLs
 * Test environments use: test-godaddy.com, test-airoapp.ai
 * Prod environments use: godaddy.com, airoapp.ai (without "test-")
 */
function detectEnvFromUrls(): 'dev' | 'test' | 'prod' | null {
  const urlsToCheck = [
    process.env.GODADDY_API_BASE_URL,
    process.env.SSO_HOST,
    process.env.AGENT_URL,
    process.env.PREVIEW_URL
  ]

  for (const url of urlsToCheck) {
    if (!url) continue
    if (url.includes('test-godaddy.com') || url.includes('test-airoapp.ai')) {
      return 'test'
    }
    if (url.includes('dev-godaddy.com') || url.includes('dev-airoapp.ai')) {
      return 'dev'
    }
    // Check for prod patterns (godaddy.com without test- or dev- prefix)
    if ((url.includes('godaddy.com') && !url.includes('test-') && !url.includes('dev-')) ||
        (url.includes('airoapp.ai') && !url.includes('test-') && !url.includes('dev-'))) {
      return 'prod'
    }
  }

  return null
}

export function getObservabilityService(): AgentObservabilityService {
  if (!observabilityService) {
    // Map standard NODE_ENV values to internal env format
    const envMap: Record<string, 'dev' | 'test' | 'prod'> = {
      development: 'dev',
      dev: 'dev',
      test: 'test',
      production: 'prod',
      prod: 'prod'
    }

    // Priority: URL detection > NODE_ENV > default 'dev'
    let env: 'dev' | 'test' | 'prod' = 'dev'
    const detectedEnv = detectEnvFromUrls()
    if (detectedEnv) {
      env = detectedEnv
    } else {
      env = envMap[process.env.NODE_ENV || 'dev'] || 'dev'
    }

    // Environment-specific agentId for Langfuse
    const agentIdMap: Record<string, string> = {
      dev: 'pk-lf-24986b63-40d4-4260-b609-346585850b87',
      test: 'pk-lf-0ecee30a-8c2b-4ae2-b4f2-460b797373a9',
      prod: 'pk-lf-549986bc-df1f-4ced-8681-aadb90dbe941'
    }

    const agentId = process.env.AGENT_OBSERVABILITY_AGENT_ID || agentIdMap[env] || 'pk-lf-24986b63-40d4-4260-b609-346585850b87'

    // Log environment detection for debugging
    logger.info('observability.env_detected', {
      env,
      nodeEnv: process.env.NODE_ENV,
      godaddyApiUrl: process.env.GODADDY_API_BASE_URL,
      agentId
    })

    observabilityService = new AgentObservabilityService({
      env,
      agentId,
      agentName: process.env.AGENT_OBSERVABILITY_AGENT_NAME || 'airo-app-builder',
      agentVersion: process.env.npm_package_version || '1.0.0',
      apiKey: process.env.AGENT_OBSERVABILITY_API_KEY,
      autoSanitizePci: process.env.AGENT_OBSERVABILITY_SANITIZE_PCI === 'true',
      sensitiveDataMode: process.env.AGENT_OBSERVABILITY_SENSITIVE_MODE === 'true',
      globalContext: {
        site: {
          privateLabelId: process.env.PRIVATE_LABEL_ID ? parseInt(process.env.PRIVATE_LABEL_ID, 10) : 1
        },
        context: {
          userType: process.env.AGENT_OBSERVABILITY_USER_TYPE || 'c1'
        }
      }
    })
  }

  return observabilityService
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetObservabilityService(): void {
  observabilityService = null
}


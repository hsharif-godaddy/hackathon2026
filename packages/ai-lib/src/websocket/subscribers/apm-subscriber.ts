import type { EventSubscriber, StreamingEvent } from '../interfaces.js'

/**
 * APM agent type for tool execution tracking
 * Using 'any' to avoid strict type dependency on elastic-apm-node
 */
export type APMAgent = any
export type APMSpan = any
export type APMTransaction = any

/**
 * APM subscriber that tracks tool execution spans and metrics
 * Integrates with Elastic APM for monitoring tool performance
 *
 * Key features:
 * - Starts APM spans on tool_start events
 * - Ends spans on tool_result events with success/failure status
 * - Adds labels for tool identification and error tracking
 * - Filters to only process tool-related events
 *
 * @example
 * ```typescript
 * const subscriber = new APMSubscriber(
 *   apmAgent,
 *   activeToolSpans,
 *   getActiveTransaction
 * )
 * channel.subscribe(conversationId, subscriber)
 * ```
 */
export class APMSubscriber implements EventSubscriber {
  id: string

  /**
   * Non-blocking subscriber - APM tracking errors should never affect the stream.
   * Monitoring is fire-and-forget; errors are silently handled in onEvent.
   */
  blocking = false

  private apmAgent: APMAgent
  private activeSpans: Map<string, APMSpan>
  private getActiveTransaction: ((socketId: string) => APMTransaction | undefined) | undefined
  private socketId: string | undefined

  /**
   * Creates a new APM subscriber
   *
   * @param apmAgent - Elastic APM agent instance
   * @param activeSpans - Map of active tool spans (key format: `${socketId}:${toolId}`)
   * @param getActiveTransaction - Optional function to get active WebSocket transaction
   * @param socketId - Optional socket ID for span creation
   *
   * @example
   * ```typescript
   * const subscriber = new APMSubscriber(
   *   apmAgent,
   *   activeToolSpans,
   *   (socketId) => activeTransactions.get(socketId)
   * )
   * ```
   */
  constructor(
    apmAgent: APMAgent,
    activeSpans: Map<string, APMSpan>,
    getActiveTransaction?: (socketId: string) => APMTransaction | undefined,
    socketId?: string
  ) {
    this.apmAgent = apmAgent
    this.activeSpans = activeSpans
    this.getActiveTransaction = getActiveTransaction
    this.socketId = socketId
    this.id = `apm-${socketId || 'global'}`
  }

  /**
   * Handles streaming events by tracking tool execution spans
   * Starts spans on tool_start, ends spans on tool_result
   *
   * @param event - The streaming event to process
   *
   * @example
   * ```typescript
   * await subscriber.onEvent(event)
   * ```
   */
  async onEvent(event: StreamingEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'tool_start':
          this.startToolSpan(event)
          break
        case 'tool_result':
          this.endToolSpan(event)
          break
        default:
          // Ignore non-tool events
          break
      }
    } catch {
      // Silently fail - APM tracking should not break the application
    }
  }

  /**
   * Handles errors during event processing
   * APM errors are logged but don't affect stream
   *
   * @param _error - The error that occurred (unused)
   */
  onError(_error: Error): void {
    // APM tracking errors should not affect the stream
    // Errors are already caught and silently handled in onEvent
  }

  /**
   * Filters events to only process tool-related events
   *
   * @param event - The event to filter
   * @returns true for tool_start and tool_result events, false otherwise
   *
   * @example
   * ```typescript
   * if (subscriber.filter(event)) {
   *   await subscriber.onEvent(event)
   * }
   * ```
   */
  filter(event: StreamingEvent): boolean {
    return event.type === 'tool_start' || event.type === 'tool_result'
  }

  /**
   * Resolves socket ID from instance property or event data
   * Reduces duplication between startToolSpan and endToolSpan
   *
   * @param event - The streaming event
   * @returns Socket ID if available, undefined otherwise
   */
  private getSocketId(event: StreamingEvent): string | undefined {
    return this.socketId ||
           (typeof event.data.socketId === 'string' ? event.data.socketId : undefined)
  }

  /**
   * Starts APM span for tool execution
   * Creates span as child of WebSocket transaction if available
   *
   * @param event - The tool_start event
   *
   * @example
   * ```typescript
   * this.startToolSpan(event)
   * ```
   */
  private startToolSpan(event: StreamingEvent): void {
    if (!this.apmAgent) {
      return
    }

    const data = event.data as any
    const toolId = data.toolId as string || data.tool?.id as string
    const toolName = data.toolName as string || data.tool?.name as string

    if (!toolId || !toolName) {
      return
    }

    const socketId = this.getSocketId(event)
    const transaction = socketId ? this.getActiveTransaction?.(socketId) : undefined

    // Create span as child of transaction if available, otherwise standalone
    const span = transaction
      ? transaction.startSpan(`Tool: ${toolName}`, 'tool_execution', 'agent')
      : this.apmAgent.startSpan(`Tool: ${toolName}`, 'tool_execution', 'agent')

    if (span) {
      span.addLabels({
        tool_id: toolId,
        tool_name: toolName,
        socket_id: socketId || 'unknown',
        conversation_id: event.conversationId
      })

      const spanKey = `${socketId || 'global'}:${toolId}`
      this.activeSpans.set(spanKey, span)
    }
  }

  /**
   * Ends APM span for tool execution
   * Sets outcome (success/failure) and adds error labels if applicable
   *
   * @param event - The tool_result event
   *
   * @example
   * ```typescript
   * this.endToolSpan(event)
   * ```
   */
  private endToolSpan(event: StreamingEvent): void {
    const data = event.data as any
    const toolId = data.toolId as string || data.tool?.id as string

    if (!toolId) {
      return
    }

    const socketId = this.getSocketId(event)
    const spanKey = `${socketId || 'global'}:${toolId}`
    const span = this.activeSpans.get(spanKey)

    if (span) {
      const isError = data.is_error === true || data.tool?.is_error === true
      const errorMessage = data.error as string || data.tool?.error as string

      span.setOutcome(isError ? 'failure' : 'success')

      if (isError && errorMessage) {
        span.addLabels({
          error_message: errorMessage
        })
      }

      span.end()
      this.activeSpans.delete(spanKey)
    }
  }
}

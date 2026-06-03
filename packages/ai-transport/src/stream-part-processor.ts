/** Callbacks driving `StreamPartProcessor.processPart`.
 *
 * **Error contract:** `onError` MAY throw — `processPart` relies on that to
 * propagate stream-level errors (e.g. budget-exceeded) out to the transport's
 * outer catch. All other callbacks MUST NOT throw. `processPart` has no
 * try/catch around tool-lifecycle callbacks; a throw there aborts
 * `processPart` mid-iteration with the processor's internal state partially
 * updated. Implementations that do additional work inside those callbacks
 * (I/O, event publishing, APM hooks) must guard internally. */
export interface PartProcessorCallbacks {
  onTextDelta(content: string, accumulated: string): void
  onToolStart(toolCallId: string, toolName: string, step: number): void
  onToolInputDelta(toolCallId: string, delta: string, accumulated: string, toolName: string | undefined): void
  /** Fires when the streamed tool-input buffer fails to JSON.parse on the
   * `tool-call` part. The processor will still invoke `onToolCall` afterwards
   * with `parsedInput` set to the raw string, so callers retain control over
   * the wire-shape fallback. Required so a future transport can't silently
   * forget to log/observe parse failures — the whole point of lifting this
   * hook into shared code is to prevent that drift. */
  onToolInputParseFailure(toolCallId: string, toolName: string, rawInput: string): void
  onToolCall(toolCallId: string, toolName: string, parsedInput: unknown): void
  /** `sdkInput` is `part.input` from the AI SDK when present — the SDK's
   * authoritative final parsed input (post-schema coercion/defaults). The
   * accumulated buffer version is available via `processor.getToolCall()`.
   * Consumers should prefer `sdkInput` when defined. Typed as `unknown`
   * because the SDK's shape depends on the tool's Zod schema — a
   * `z.object(...)` tool yields an object, a `z.string()` tool yields a
   * string, a `z.array(...)` tool yields an array. `null` is kept distinct
   * from `undefined`: `null` is a schema-allowed nullable argument (the
   * SDK validated and accepted it); `undefined` means the SDK did not
   * supply input on this part and the consumer should fall back to
   * `processor.getToolCall().input`. Collapsing them would lose that
   * signal.
   *
   * `toolName` is forwarded from `part.toolName` when the SDK provides it.
   * It is undefined for orphan result/error parts that arrive without a
   * prior `tool-input-start` AND without a `toolName` field. Consumers
   * should prefer this over `processor.getToolCall(id)?.name`, which is
   * unavailable for orphan parts, before falling back to `'unknown'`. */
  onToolResult(toolCallId: string, result: unknown, sdkInput: unknown, toolName: string | undefined): void
  onToolError(toolCallId: string, error: Error, sdkInput: unknown, toolName: string | undefined): void
  onStepStart(step: number): void
  onError(error: Error): void
}

export interface ToolCallRecord {
  id: string
  name: string
  input: unknown
  output?: unknown
  status: 'pending' | 'completed' | 'error'
  error?: string
}

export interface PartProcessorState {
  accumulatedContent: string
  toolCalls: Map<string, ToolCallRecord>
  accumulatedToolInputs: Map<string, string>
  currentStep: number
}

function extractToolError(raw: unknown): Error {
  if (raw instanceof Error) return raw
  if (typeof raw === 'string') return new Error(raw || 'Tool execution error')
  if (raw && typeof raw === 'object') {
    const message = (raw as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return new Error(message)
  }
  return new Error('Tool execution error')
}

export class StreamPartProcessor {
  private state: PartProcessorState = {
    accumulatedContent: '',
    toolCalls: new Map(),
    accumulatedToolInputs: new Map(),
    currentStep: 1,
  }

  private stepHasToolCall = false
  private finishResult: { finishReason: string; totalUsage?: unknown } | undefined

  constructor(private callbacks: PartProcessorCallbacks) {}

  processPart(part: { type: string; [key: string]: unknown }): void {
    switch (part.type) {
      case 'text-delta': {
        const text = part.text as string
        this.state.accumulatedContent += text
        this.callbacks.onTextDelta(text, this.state.accumulatedContent)
        break
      }

      case 'tool-input-start': {
        const id = part.id as string
        const toolName = part.toolName as string

        if (this.stepHasToolCall) {
          this.state.currentStep++
          this.stepHasToolCall = false
        }
        this.callbacks.onStepStart(this.state.currentStep)

        this.state.accumulatedToolInputs.set(id, '')
        this.state.toolCalls.set(id, {
          id,
          name: toolName,
          input: {},
          status: 'pending',
        })
        this.callbacks.onToolStart(id, toolName, this.state.currentStep)
        break
      }

      case 'tool-input-delta': {
        const id = (part.id ?? part.toolCallId) as string
        const delta = part.delta as string
        const current = this.state.accumulatedToolInputs.get(id) ?? ''
        const accumulated = current + delta
        this.state.accumulatedToolInputs.set(id, accumulated)
        // Prefer part.toolName (SDK-provided) and fall back to the registered
        // record so out-of-order streams still emit a name when possible.
        const toolName = (part.toolName as string | undefined) ?? this.state.toolCalls.get(id)?.name
        this.callbacks.onToolInputDelta(id, delta, accumulated, toolName)
        break
      }

      case 'tool-call': {
        const id = (part.id ?? part.toolCallId) as string
        const toolName = part.toolName as string
        const rawInput = this.state.accumulatedToolInputs.get(id) ?? ''
        let parsedInput: unknown
        try {
          parsedInput = rawInput ? JSON.parse(rawInput) : {}
        } catch {
          parsedInput = rawInput
          this.callbacks.onToolInputParseFailure(id, toolName, rawInput)
        }

        const toolCall = this.state.toolCalls.get(id)
        if (toolCall) {
          toolCall.input = parsedInput
        }
        this.stepHasToolCall = true
        this.callbacks.onToolCall(id, toolName, parsedInput)
        break
      }

      case 'tool-result': {
        const id = (part.id ?? part.toolCallId) as string
        const toolCall = this.state.toolCalls.get(id)
        if (toolCall) {
          toolCall.output = part.output
          toolCall.status = 'completed'
          if (part.input !== undefined) toolCall.input = part.input
        }
        const toolName = (part.toolName as string | undefined) ?? toolCall?.name
        this.callbacks.onToolResult(id, part.output, part.input, toolName)
        break
      }

      case 'tool-error': {
        const id = (part.id ?? part.toolCallId ?? part.toolId) as string
        const error = extractToolError(part.error)
        const toolCall = this.state.toolCalls.get(id)
        if (toolCall) {
          toolCall.status = 'error'
          toolCall.error = error.message
          if (part.input !== undefined) toolCall.input = part.input
        }
        const toolName = (part.toolName as string | undefined) ?? toolCall?.name
        this.callbacks.onToolError(id, error, part.input, toolName)
        break
      }

      case 'finish': {
        // The AI SDK emits this ONCE at the end of the whole response with
        // the terminal finishReason + aggregated usage. (Per-step ends arrive
        // as 'finish-step', which we deliberately do NOT treat as terminal —
        // otherwise isFinished() would latch true after the first tool step
        // and misclassify a later-step stall as a genuine completion.)
        // Captured so the chunk-timeout finalization path can tell a genuine
        // completion (frame seen) from a soft-commit (content only).
        const finishReason = (part.finishReason as string | undefined) ?? 'stop'
        const totalUsage = part.totalUsage ?? part.usage
        this.finishResult = {
          finishReason,
          ...(totalUsage !== undefined && { totalUsage }),
        }
        break
      }

      case 'error': {
        // Use extractToolError (same helper as tool-error) so structured
        // payloads like { message: 'budget exceeded', statusCode: 429 } keep
        // their `.message` instead of stringifying to '[object Object]'.
        const error = extractToolError(part.error)
        this.callbacks.onError(error)
        break
      }

      default:
        break
    }
  }

  getToolCall(toolCallId: string): Readonly<ToolCallRecord> | undefined {
    return this.state.toolCalls.get(toolCallId)
  }

  /** True once a terminal `finish` part has been processed. (`finish-step`
   * is deliberately excluded — it fires after every tool step, not at the end
   * of the whole response.) */
  isFinished(): boolean {
    return this.finishResult !== undefined
  }

  /** The captured finishReason + usage from the terminal `finish` frame, or
   * undefined if no `finish` part has been seen yet. */
  getFinishResult(): Readonly<{ finishReason: string; totalUsage?: unknown }> | undefined {
    return this.finishResult
  }

  /** The accumulated text content. Cheaper than `getState().accumulatedContent`
   * when only the text is needed — `getState()` clones the tool-call maps. */
  getAccumulatedContent(): string {
    return this.state.accumulatedContent
  }

  get currentStep(): number {
    return this.state.currentStep
  }

  /** Snapshot of internal state. Maps and record shells are cloned, but
   * `ToolCallRecord.input` and `ToolCallRecord.output` are shallow-copied
   * by reference — mutating a nested object on a snapshot would corrupt
   * the processor's live state. The return type enforces shallow read-
   * only-ness at the type level; deep-clone the fields you intend to
   * mutate. */
  getState(): Readonly<Omit<PartProcessorState, 'toolCalls' | 'accumulatedToolInputs'>> & {
    readonly toolCalls: ReadonlyMap<string, Readonly<ToolCallRecord>>
    readonly accumulatedToolInputs: ReadonlyMap<string, string>
  } {
    const toolCalls = new Map<string, ToolCallRecord>()
    for (const [k, v] of this.state.toolCalls) {
      toolCalls.set(k, { ...v })
    }
    return {
      ...this.state,
      toolCalls,
      accumulatedToolInputs: new Map(this.state.accumulatedToolInputs),
    }
  }
}

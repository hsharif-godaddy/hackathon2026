export interface PartProcessorCallbacks {
  onTextDelta(content: string, accumulated: string): void
  onToolStart(toolCallId: string, toolName: string, step: number): void
  onToolInputDelta(toolCallId: string, delta: string, accumulated: string): void
  onToolCall(toolCallId: string, toolName: string, parsedInput: unknown): void
  onToolResult(toolCallId: string, result: unknown): void
  onToolError(toolCallId: string, error: Error): void
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

export class StreamPartProcessor {
  private state: PartProcessorState = {
    accumulatedContent: '',
    toolCalls: new Map(),
    accumulatedToolInputs: new Map(),
    currentStep: 1,
  }

  private stepHasToolCall = false

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
        this.callbacks.onToolInputDelta(id, delta, accumulated)
        break
      }

      case 'tool-call': {
        const id = (part.toolCallId ?? part.id) as string
        const toolName = part.toolName as string
        const rawInput = this.state.accumulatedToolInputs.get(id) ?? ''
        let parsedInput: unknown
        try {
          parsedInput = rawInput ? JSON.parse(rawInput) : {}
        } catch {
          parsedInput = rawInput
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
        const id = (part.toolCallId ?? part.id) as string
        const toolCall = this.state.toolCalls.get(id)
        if (toolCall) {
          toolCall.output = part.output
          toolCall.status = 'completed'
        }
        this.callbacks.onToolResult(id, part.output)
        break
      }

      case 'tool-error': {
        const id = (part.toolId ?? part.toolCallId ?? part.id) as string
        const error = part.error instanceof Error ? part.error : new Error(String(part.error))
        const toolCall = this.state.toolCalls.get(id)
        if (toolCall) {
          toolCall.status = 'error'
          toolCall.error = error.message
        }
        this.callbacks.onToolError(id, error)
        break
      }

      case 'error': {
        const error = part.error instanceof Error ? part.error : new Error(String(part.error))
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

  get currentStep(): number {
    return this.state.currentStep
  }

  getState(): PartProcessorState {
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

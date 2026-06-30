import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AgentWrapper } from '../agent-factory.js'
import type { AgentConfig } from '../types.js'
import type { ContextPipeline } from '../context-pipeline.js'
import { defaultConvertToLlm } from '../context-normalization.js'

const createMockPipeline = (): ContextPipeline => ({
  transformContext: async (input) => ({
    contextMessages: input.contextMessages,
    conversationMessages: input.conversationMessages,
    userMessage: { role: 'user' as const, content: input.userMessage },
  }),
  convertToLlm: (input) => defaultConvertToLlm(input),
})

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    ToolLoopAgent: vi.fn(),
    stepCountIs: vi.fn(function (value: number) { return { type: 'step_count', value } }),
    hasToolCall: vi.fn(function (name: string) { return { type: 'has_tool_call', value: name } }),
  }
})

interface StreamParams {
  experimental_transform?: (args: { tools: Record<string, unknown>; stopStream: () => void }) => TransformStream
  abortSignal?: AbortSignal
}

const driveErrorPart = async (params: StreamParams): Promise<void> => {
  const transform = params.experimental_transform!({ tools: {}, stopStream: () => {} })
  const writer = transform.writable.getWriter()
  const reader = transform.readable.getReader()
  const drain = (async () => { while (true) { const { done } = await reader.read(); if (done) break } })()
  await writer.write({ type: 'error', error: { message: 'content filtered', statusCode: 502 } } as any)
  await writer.close()
  await drain
}

describe('streamGenerate observe + terminal-abort wiring', () => {
  let mockAgent: { stream: ReturnType<typeof vi.fn>; generate: ReturnType<typeof vi.fn> }
  let wrapper: AgentWrapper
  let captured: StreamParams | undefined

  beforeEach(async () => {
    captured = undefined
    mockAgent = { stream: vi.fn(), generate: vi.fn() }
    const { ToolLoopAgent } = await import('ai')
    ;(ToolLoopAgent as any).mockImplementation(function () { return mockAgent })

    mockAgent.stream.mockImplementation(async (params: StreamParams) => {
      captured = params
      return {
        textStream: (async function* () {})(),
        response: Promise.resolve({ id: 'r1', timestamp: new Date(0), modelId: 'm' }),
        usage: Promise.resolve({ totalTokens: 0, promptTokens: 0, completionTokens: 0 }),
        totalUsage: Promise.resolve({ totalTokens: 0 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        steps: Promise.resolve([]),
      }
    })

    const config: AgentConfig = {
      name: 'observe-test',
      model: 'test-model' as any,
      system: 'sys',
      tools: {},
      maxSteps: 5,
      contextPipeline: createMockPipeline(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }
    wrapper = new AgentWrapper(config)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('hands the SDK an experimental_transform and a non-aborted abort signal', async () => {
    await wrapper.streamGenerate('hello', { observe: () => {} })

    expect(typeof captured?.experimental_transform).toBe('function')
    expect(captured?.abortSignal).toBeInstanceOf(AbortSignal)
    expect(captured?.abortSignal?.aborted).toBe(false)
  })

  it('forwards observed parts to the caller-supplied observe hook', async () => {
    const observed: Array<{ type: string }> = []
    await wrapper.streamGenerate('hello', { observe: (part) => { observed.push(part as { type: string }) } })

    const transform = captured!.experimental_transform!({ tools: {}, stopStream: () => {} })
    const writer = transform.writable.getWriter()
    const reader = transform.readable.getReader()
    const drain = (async () => { while (true) { const { done } = await reader.read(); if (done) break } })()
    await writer.write({ type: 'text-delta', id: '1', text: 'hi' } as any)
    await writer.close()
    await drain

    expect(observed.map((p) => p.type)).toEqual(['text-delta'])
  })

  it('aborts the SDK request when a terminal error part is observed', async () => {
    await wrapper.streamGenerate('hello', { observe: () => {} })
    expect(captured!.abortSignal!.aborted).toBe(false)

    await driveErrorPart(captured!)

    expect(captured!.abortSignal!.aborted).toBe(true)
  })

  it('surfaces the original error from getFinalResult so the caller can classify it', async () => {
    const result = await wrapper.streamGenerate('hello', { observe: () => {} })

    await driveErrorPart(captured!)

    await expect(result.getFinalResult()).rejects.toThrow('content filtered')
  })

  it('getFinalResult resolves normally when no terminal error occurs', async () => {
    const result = await wrapper.streamGenerate('hello', { observe: () => {} })
    await expect(result.getFinalResult()).resolves.toBeTruthy()
  })

  it('prefers the captured terminal error when the SDK result promises reject (catch path)', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const rejected = Promise.reject(abortError)
    rejected.catch(() => {})
    mockAgent.stream.mockImplementation(async (params: StreamParams) => {
      captured = params
      return {
        textStream: (async function* () {})(),
        response: Promise.resolve({ id: 'r1', timestamp: new Date(0), modelId: 'm' }),
        usage: rejected,
        totalUsage: rejected,
        finishReason: rejected,
        toolCalls: rejected,
        toolResults: rejected,
        steps: rejected,
      }
    })

    const result = await wrapper.streamGenerate('hello', { observe: () => {} })
    await driveErrorPart(captured!)

    // Promise.all rejects with the AbortError, but the catch surfaces the
    // captured terminal error so the caller classifies the true cause.
    await expect(result.getFinalResult()).rejects.toThrow('content filtered')
  })

  it('reuses the pipeline across retries without handing a retried attempt a pre-aborted signal', async () => {
    const abortedAtCall: boolean[] = []
    let calls = 0
    mockAgent.stream.mockImplementation(async (params: StreamParams) => {
      abortedAtCall.push(params.abortSignal!.aborted)
      calls++
      if (calls === 1) {
        throw Object.assign(new Error('rate limit exceeded'), { statusCode: 429 })
      }
      captured = params
      return {
        textStream: (async function* () {})(),
        response: Promise.resolve({ id: 'r1', timestamp: new Date(0), modelId: 'm' }),
        usage: Promise.resolve({ totalTokens: 0 }),
        totalUsage: Promise.resolve({ totalTokens: 0 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        steps: Promise.resolve([]),
      }
    })

    const retryWrapper = new AgentWrapper({
      name: 'retry-observe',
      model: 'test-model' as any,
      system: 'sys',
      tools: {},
      maxSteps: 5,
      retryConfig: { maxAttempts: 3, baseDelayMs: 1, jitter: false },
      contextPipeline: createMockPipeline(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await retryWrapper.streamGenerate('hello', { observe: () => {} })

    expect(calls).toBe(2)
    // The single pipeline signal is reused across both attempts; neither starts aborted.
    expect(abortedAtCall).toEqual([false, false])
    expect(captured!.abortSignal!.aborted).toBe(false)
  })

  it('drives the caller observe with the corrective text on a tool-validation error (mock-result path)', async () => {
    // A `toolUse.input is invalid` error means no real stream runs, so the
    // observing pipeline never fires; the mock result must drive the caller's
    // observe directly so the corrective-feedback text still reaches the SSE path.
    mockAgent.stream.mockImplementation(async () => {
      throw new Error('Provider rejected request: toolUse.input is invalid')
    })

    const observed: Array<{ type: string; text?: string }> = []
    const result = await wrapper.streamGenerate('hello', {
      observe: (part) => { observed.push(part as { type: string; text?: string }) },
    })

    expect((result as { isToolValidationError?: boolean }).isToolValidationError).toBe(true)
    // observe is driven only when getFinalResult is awaited (parity with the
    // pre-collapse textStream consumption), not at stream-construction time.
    expect(observed).toHaveLength(0)

    const final = await result.getFinalResult()

    expect(final.finishReason).toBe('error')
    expect(observed).toHaveLength(1)
    expect(observed[0]?.type).toBe('text-delta')
    expect(observed[0]?.text).toContain('toolUse.input is invalid')
  })
})

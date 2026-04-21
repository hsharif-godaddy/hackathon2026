import { describe, it, expect, vi, beforeEach } from 'vitest'

import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider'

import { createCostTrackingMiddleware } from '../usage-instrumentation-middleware.js'

const { mockRecordCost, mockCreateCostRecorder, mockCalculateCostEstimate, mockWarn } = vi.hoisted(() => ({
  mockRecordCost: vi.fn(),
  mockCreateCostRecorder: vi.fn(),
  mockCalculateCostEstimate: vi.fn(() => ({
    totalCost: 0.005,
    inputCost: 0.003,
    outputCost: 0.002,
    regularCost: 0.005,
    savings: 0,
    savingsPercentage: 0,
    currency: 'USD',
    model: 'test-model',
    provider: 'anthropic'
  })),
  mockWarn: vi.fn()
}))

vi.mock('@godaddy/agent-otel-sdk', () => ({
  createCostRecorder: () => mockCreateCostRecorder()
}))

vi.mock('../../utils/model-pricing.js', () => ({
  calculateCostEstimate: mockCalculateCostEstimate
}))

vi.mock('@airo/ai-common', async importOriginal => {
  const actual = await importOriginal<typeof import('@airo/ai-common')>()
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: mockWarn,
      error: vi.fn(),
      debug: vi.fn()
    })
  }
})

function makeUsage(overrides?: Partial<Record<string, unknown>>): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: overrides?.inputTotal as number ?? 100,
      noCache: undefined,
      cacheRead: overrides?.cacheRead as number ?? undefined,
      cacheWrite: overrides?.cacheWrite as number ?? undefined,
    },
    outputTokens: {
      total: overrides?.outputTotal as number ?? 50,
      text: undefined,
      reasoning: undefined,
    }
  }
}

function makeModel(modelId = 'claude-sonnet-4-6'): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'anthropic',
    modelId,
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  }
}

const STOP_REASON = { unified: 'stop' as const, raw: undefined }

function makeGenerateResult(usage: LanguageModelV3Usage): LanguageModelV3GenerateResult {
  return {
    content: [],
    finishReason: STOP_REASON,
    usage,
    warnings: [],
  }
}

function makeStreamResult(parts: LanguageModelV3StreamPart[]): LanguageModelV3StreamResult {
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(part)
        }
        controller.close()
      }
    })
  }
}

async function drainStream(result: LanguageModelV3StreamResult): Promise<LanguageModelV3StreamPart[]> {
  const reader = result.stream.getReader()
  const collected: LanguageModelV3StreamPart[] = []
  let done = false
  while (!done) {
    const chunk = await reader.read()
    done = chunk.done
    if (chunk.value) collected.push(chunk.value)
  }
  return collected
}

describe('usage-instrumentation-middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateCostRecorder.mockReturnValue(mockRecordCost)
  })

  describe('#wrapGenerate', () => {
    it('should record cost from generate result usage', async () => {
      const middleware = createCostTrackingMiddleware()
      const usage = makeUsage({ inputTotal: 200, outputTotal: 80 })
      const doGenerate = vi.fn().mockResolvedValue(makeGenerateResult(usage))
      const model = makeModel()

      await middleware.wrapGenerate!({ doGenerate, doStream: vi.fn(), params: {} as any, model })

      expect(mockRecordCost).toHaveBeenCalledOnce()
      expect(mockRecordCost.mock.calls[0][0]).toEqual({
        totalCost: 0.005, inputCost: 0.003, outputCost: 0.002
      })
    })

    it('should return the original result unchanged', async () => {
      const middleware = createCostTrackingMiddleware()
      const result = makeGenerateResult(makeUsage())
      const doGenerate = vi.fn().mockResolvedValue(result)

      const returned = await middleware.wrapGenerate!({
        doGenerate, doStream: vi.fn(), params: {} as any, model: makeModel()
      })

      expect(returned).toBe(result)
    })

    it('should not throw when cost recording fails', async () => {
      mockCreateCostRecorder.mockImplementationOnce(() => { throw new Error('span error') })
      const middleware = createCostTrackingMiddleware()
      const result = makeGenerateResult(makeUsage())
      const doGenerate = vi.fn().mockResolvedValue(result)

      const returned = await middleware.wrapGenerate!({
        doGenerate, doStream: vi.fn(), params: {} as any, model: makeModel()
      })

      expect(returned).toBe(result)
      expect(mockRecordCost).not.toHaveBeenCalled()
      expect(mockWarn).toHaveBeenCalledWith('usageInstrumentation.generate.error', { error: 'span error' })
    })

    it('should not record cost when estimate is zero', async () => {
      mockCalculateCostEstimate.mockReturnValueOnce({
        totalCost: 0, inputCost: 0, outputCost: 0, regularCost: 0,
        savings: 0, savingsPercentage: 0, currency: 'USD', model: 'test', provider: 'anthropic'
      })
      const middleware = createCostTrackingMiddleware()
      const doGenerate = vi.fn().mockResolvedValue(makeGenerateResult(makeUsage()))

      await middleware.wrapGenerate!({
        doGenerate, doStream: vi.fn(), params: {} as any, model: makeModel()
      })

      expect(mockRecordCost).not.toHaveBeenCalled()
    })

    it('should pass cache tokens to cost calculation', async () => {
      const middleware = createCostTrackingMiddleware()
      const usage = makeUsage({ inputTotal: 26590, outputTotal: 225, cacheRead: 26544, cacheWrite: 0 })
      const doGenerate = vi.fn().mockResolvedValue(makeGenerateResult(usage))

      await middleware.wrapGenerate!({
        doGenerate, doStream: vi.fn(), params: {} as any, model: makeModel()
      })

      expect(mockCalculateCostEstimate).toHaveBeenCalledWith(
        { inputTokens: 26590, outputTokens: 225, totalTokens: 26815, cachedInputTokensRead: 26544, cachedInputTokensWrite: 0 },
        'claude-sonnet-4-6'
      )
      expect(mockRecordCost).toHaveBeenCalledOnce()
    })
  })

  describe('#wrapStream', () => {
    it('should record cost when finish part is received', async () => {
      const middleware = createCostTrackingMiddleware()
      const usage = makeUsage({ inputTotal: 100, outputTotal: 50 })

      const parts: LanguageModelV3StreamPart[] = [
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: 'hello' },
        { type: 'text-end', id: '1' },
        { type: 'finish', usage, finishReason: STOP_REASON },
      ]
      const doStream = vi.fn().mockResolvedValue(makeStreamResult(parts))

      const result = await middleware.wrapStream!({
        doStream, doGenerate: vi.fn(), params: {} as any, model: makeModel()
      })
      await drainStream(result)

      expect(mockRecordCost).toHaveBeenCalledOnce()
      expect(mockRecordCost.mock.calls[0][0]).toEqual({
        totalCost: 0.005, inputCost: 0.003, outputCost: 0.002
      })
    })

    it('should pass all stream parts through unchanged', async () => {
      const middleware = createCostTrackingMiddleware()
      const parts: LanguageModelV3StreamPart[] = [
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: 'hello world' },
        { type: 'text-end', id: '1' },
        { type: 'finish', usage: makeUsage(), finishReason: STOP_REASON },
      ]
      const doStream = vi.fn().mockResolvedValue(makeStreamResult(parts))

      const result = await middleware.wrapStream!({
        doStream, doGenerate: vi.fn(), params: {} as any, model: makeModel()
      })
      const collected = await drainStream(result)

      expect(collected).toEqual(parts)
    })

    it('should not record cost when no finish part is received', async () => {
      const middleware = createCostTrackingMiddleware()
      const parts: LanguageModelV3StreamPart[] = [
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: 'hello' },
        { type: 'text-end', id: '1' },
      ]
      const doStream = vi.fn().mockResolvedValue(makeStreamResult(parts))

      const result = await middleware.wrapStream!({
        doStream, doGenerate: vi.fn(), params: {} as any, model: makeModel()
      })
      await drainStream(result)

      expect(mockRecordCost).not.toHaveBeenCalled()
    })

    it('should capture cost recorder before calling doStream', async () => {
      const callOrder: string[] = []
      mockCreateCostRecorder.mockImplementationOnce(() => {
        callOrder.push('createCostRecorder')
        return mockRecordCost
      })
      const doStream = vi.fn().mockImplementation(async () => {
        callOrder.push('doStream')
        return makeStreamResult([
          { type: 'finish', usage: makeUsage(), finishReason: STOP_REASON },
        ])
      })
      const middleware = createCostTrackingMiddleware()

      const result = await middleware.wrapStream!({
        doStream, doGenerate: vi.fn(), params: {} as any, model: makeModel()
      })
      await drainStream(result)

      expect(callOrder).toEqual(['createCostRecorder', 'doStream'])
    })

    it('should log warning when calculateCostEstimate throws during stream', async () => {
      mockCalculateCostEstimate.mockImplementationOnce(() => { throw new Error('pricing error') })
      const middleware = createCostTrackingMiddleware()
      const parts: LanguageModelV3StreamPart[] = [
        { type: 'finish', usage: makeUsage(), finishReason: STOP_REASON },
      ]
      const doStream = vi.fn().mockResolvedValue(makeStreamResult(parts))

      const result = await middleware.wrapStream!({
        doStream, doGenerate: vi.fn(), params: {} as any, model: makeModel()
      })
      await drainStream(result)

      expect(mockRecordCost).not.toHaveBeenCalled()
      expect(mockWarn).toHaveBeenCalledWith('usageInstrumentation.stream.error', { error: 'pricing error' })
    })

    it('should record cache tokens from streaming usage', async () => {
      const middleware = createCostTrackingMiddleware()
      const usage = makeUsage({
        inputTotal: 26590, outputTotal: 225,
        cacheRead: 26544, cacheWrite: 100
      })
      const parts: LanguageModelV3StreamPart[] = [
        { type: 'finish', usage, finishReason: STOP_REASON },
      ]
      const doStream = vi.fn().mockResolvedValue(makeStreamResult(parts))

      const result = await middleware.wrapStream!({
        doStream, doGenerate: vi.fn(), params: {} as any, model: makeModel()
      })
      await drainStream(result)

      expect(mockCalculateCostEstimate).toHaveBeenCalledWith(
        { inputTokens: 26590, outputTokens: 225, totalTokens: 26815, cachedInputTokensRead: 26544, cachedInputTokensWrite: 100 },
        'claude-sonnet-4-6'
      )
      expect(mockRecordCost).toHaveBeenCalledOnce()
    })

    it('should not record cost when estimate is zero', async () => {
      mockCalculateCostEstimate.mockReturnValueOnce({
        totalCost: 0, inputCost: 0, outputCost: 0, regularCost: 0,
        savings: 0, savingsPercentage: 0, currency: 'USD', model: 'test', provider: 'anthropic'
      })
      const middleware = createCostTrackingMiddleware()
      const parts: LanguageModelV3StreamPart[] = [
        { type: 'finish', usage: makeUsage(), finishReason: STOP_REASON },
      ]
      const doStream = vi.fn().mockResolvedValue(makeStreamResult(parts))

      const result = await middleware.wrapStream!({
        doStream, doGenerate: vi.fn(), params: {} as any, model: makeModel()
      })
      await drainStream(result)

      expect(mockRecordCost).not.toHaveBeenCalled()
    })

    it('should return unmodified stream when createCostRecorder throws', async () => {
      mockCreateCostRecorder.mockImplementationOnce(() => { throw new Error('no active span') })
      const middleware = createCostTrackingMiddleware()
      const parts: LanguageModelV3StreamPart[] = [
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: 'hello' },
        { type: 'text-end', id: '1' },
        { type: 'finish', usage: makeUsage(), finishReason: STOP_REASON },
      ]
      const streamResult = makeStreamResult(parts)
      const doStream = vi.fn().mockResolvedValue(streamResult)

      const result = await middleware.wrapStream!({
        doStream, doGenerate: vi.fn(), params: {} as any, model: makeModel()
      })
      const collected = await drainStream(result)

      expect(collected).toEqual(parts)
      expect(mockRecordCost).not.toHaveBeenCalled()
      expect(mockWarn).toHaveBeenCalledWith('usageInstrumentation.stream.recorderInit', { error: 'no active span' })
    })
  })
})

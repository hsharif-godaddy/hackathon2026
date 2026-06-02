import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APICallError } from '@ai-sdk/provider'

import { AgentWrapper } from '../agent-factory.js'
import type { AgentConfig } from '../types.js'

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>()
  const MockToolLoopAgent = vi.fn()
  return {
    ...actual,
    ToolLoopAgent: MockToolLoopAgent,
  }
})

vi.mock('@airo/ai-grants', () => ({
  grantSessionManager: {
    hasGrants: vi.fn(),
    getCurrentUserId: vi.fn(),
    requestGrantRefreshAndWait: vi.fn(),
    advanceToNextGrant: vi.fn(),
    setRefreshCallback: vi.fn(),
  },
  isGrantsExhausted: vi.fn(),
  buildLitellmMetadataFromContext: vi.fn().mockReturnValue(null),
  LlmCallSource: { UserChat: 'user_chat' },
  GrantErrorCode: { AllGrantsExhausted: 'GRANTS_ALL_EXHAUSTED' },
  GrantType: {},
  GrantFinalState: {},
}))

describe('AgentWrapper - exhausted grants refresh', function exhaustedGrantsTests() {
  let mockStream: ReturnType<typeof vi.fn>
  let agentWrapper: AgentWrapper

  const socketId = 'test-socket'
  const executionContext = { socketId, metadata: { appId: 'app-1' } }

  const agentConfig: AgentConfig = {
    name: 'test-agent',
    model: 'test-model' as any,
    system: 'You are a helpful assistant',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }

  const makeValidStream = () => ({
    textStream: (async function* stream() { yield 'response' })(),
    baseStream: null,
    usage: Promise.resolve({ totalTokens: 10, promptTokens: 5, completionTokens: 5 }),
    finishReason: Promise.resolve('stop'),
    toolCalls: Promise.resolve([]),
    toolResults: Promise.resolve([]),
  })

  beforeEach(async function setup() {
    vi.clearAllMocks()

    mockStream = vi.fn()

    const aiModule = await import('ai')
    const MockToolLoopAgent = aiModule.ToolLoopAgent as any
    MockToolLoopAgent.mockImplementation(function () { return { stream: mockStream }; })

    agentWrapper = new AgentWrapper(agentConfig)
  })

  describe('#streamGenerate - exhausted grants', function streamTests() {
    it('proceeds with stream when refresh finds a usable credit pack', async function creditPackFound() {
      const { grantSessionManager, isGrantsExhausted } = await import('@airo/ai-grants')


      vi.mocked(grantSessionManager.hasGrants).mockReturnValue(true)
      vi.mocked(isGrantsExhausted).mockReturnValue(true)
      vi.mocked(grantSessionManager.requestGrantRefreshAndWait).mockResolvedValue(true)
      vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue('airo-builder:grant:credit-pack-1')

      mockStream.mockResolvedValue(makeValidStream())

      const result = await agentWrapper.streamGenerate('test prompt', { executionContext })

      expect(grantSessionManager.requestGrantRefreshAndWait).toHaveBeenCalledWith(socketId, 10000)
      expect(mockStream).toHaveBeenCalledTimes(1)

      const chunks: string[] = []
      for await (const chunk of result.textStream) {
        chunks.push(chunk)
      }
      expect(chunks).toEqual(['response'])
    })

    it('throws BudgetExceededError when refresh times out', async function refreshTimeout() {
      const { grantSessionManager, isGrantsExhausted } = await import('@airo/ai-grants')


      vi.mocked(grantSessionManager.hasGrants).mockReturnValue(true)
      vi.mocked(isGrantsExhausted).mockReturnValue(true)
      vi.mocked(grantSessionManager.requestGrantRefreshAndWait).mockResolvedValue(false)

      await expect(
        agentWrapper.streamGenerate('test prompt', { executionContext })
      ).rejects.toThrow('All credit grants have been exhausted')

      expect(mockStream).not.toHaveBeenCalled()
    })

    it('throws BudgetExceededError when refresh returns but no grant is usable', async function refreshStillExhausted() {
      const { grantSessionManager, isGrantsExhausted } = await import('@airo/ai-grants')


      vi.mocked(grantSessionManager.hasGrants).mockReturnValue(true)
      vi.mocked(isGrantsExhausted).mockReturnValue(true)
      vi.mocked(grantSessionManager.requestGrantRefreshAndWait).mockResolvedValue(true)
      vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue(undefined)

      await expect(
        agentWrapper.streamGenerate('test prompt', { executionContext })
      ).rejects.toThrow('All credit grants have been exhausted')

      expect(mockStream).not.toHaveBeenCalled()
    })

    it('normalizes raw APICallError budget error and triggers grant fallback', async function rawAPICallErrorBudget() {
      const { grantSessionManager, isGrantsExhausted } = await import('@airo/ai-grants')

      // Pre-call: grants not exhausted, so stream is attempted

      vi.mocked(grantSessionManager.hasGrants).mockReturnValue(true)
      vi.mocked(isGrantsExhausted).mockReturnValue(false)

      // Stream throws a raw APICallError with budget exceeded pattern
      // (not a BudgetExceededError — this is what LiteLLM returns before normalization)
      const budgetAPIError = new APICallError({
        message: 'Budget has been exceeded',
        url: 'https://litellm.example.com/v1/chat/completions',
        requestBodyValues: {},
        statusCode: 400,
        responseBody: '{"error":{"message":"Budget has been exceeded! Current cost: 50.01, Max budget: 50.00","type":"budget_exceeded"}}',
        isRetryable: false,
      })
      mockStream.mockRejectedValueOnce(budgetAPIError)

      // Grant fallback: advance succeeds, second stream call works
      vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(true)
      vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue('airo-builder:grant:pack-2')
      mockStream.mockResolvedValueOnce(makeValidStream())

      const result = await agentWrapper.streamGenerate('test prompt', { executionContext })

      // Should have advanced to next grant and retried
      expect(grantSessionManager.advanceToNextGrant).toHaveBeenCalledWith(socketId)
      expect(mockStream).toHaveBeenCalledTimes(2)

      const chunks: string[] = []
      for await (const chunk of result.textStream) {
        chunks.push(chunk)
      }
      expect(chunks).toEqual(['response'])
    })

    it('throws raw APICallError budget error when no socketId', async function rawAPICallErrorNoSocket() {
      const { isGrantsExhausted } = await import('@airo/ai-grants')

      vi.mocked(isGrantsExhausted).mockReturnValue(false)

      const budgetAPIError = new APICallError({
        message: 'Budget has been exceeded',
        url: 'https://litellm.example.com/v1/chat/completions',
        requestBodyValues: {},
        statusCode: 400,
        responseBody: '{"error":{"message":"exceededbudget"}}',
        isRetryable: false,
      })
      mockStream.mockRejectedValueOnce(budgetAPIError)

      const contextWithoutSocket = { metadata: { appId: 'app-1', customerId: 'customer-1' } }

      await expect(
        agentWrapper.streamGenerate('test prompt', { executionContext: contextWithoutSocket })
      ).rejects.toThrow()
    })
  })

  describe('#streamGenerate - BMS mode skips grants', function bmsTests() {
    const bmsContext = { socketId, metadata: { appId: 'app-1', budgetServiceEnabled: true } }

    it('skips grant provisioning when budgetServiceEnabled is true', async function skipProvisioning() {
      const { grantSessionManager } = await import('@airo/ai-grants')

      vi.mocked(grantSessionManager.hasGrants).mockReturnValue(false)
      mockStream.mockResolvedValue(makeValidStream())

      await agentWrapper.streamGenerate('test prompt', { executionContext: bmsContext })

      expect(grantSessionManager.requestGrantRefreshAndWait).not.toHaveBeenCalled()
      expect(mockStream).toHaveBeenCalledTimes(1)
    })

    it('rethrows BudgetExceededError immediately in BMS mode without grant fallback', async function noFallback() {
      const { grantSessionManager, isGrantsExhausted } = await import('@airo/ai-grants')

      vi.mocked(grantSessionManager.hasGrants).mockReturnValue(true)
      vi.mocked(isGrantsExhausted).mockReturnValue(false)

      const budgetAPIError = new APICallError({
        message: 'Budget has been exceeded',
        url: 'https://api.gocode.caas.dev-gdcorp.tools/v1/messages',
        requestBodyValues: {},
        statusCode: 400,
        responseBody: '{"error":{"message":"Budget has been exceeded! Current cost: 50.01, Max budget: 50.00","type":"budget_exceeded"}}',
        isRetryable: false,
      })
      mockStream.mockRejectedValueOnce(budgetAPIError)

      await expect(
        agentWrapper.streamGenerate('test prompt', { executionContext: bmsContext })
      ).rejects.toThrow()

      expect(grantSessionManager.advanceToNextGrant).not.toHaveBeenCalled()
      expect(grantSessionManager.requestGrantRefreshAndWait).not.toHaveBeenCalled()
      expect(mockStream).toHaveBeenCalledTimes(1)
    })
  })
})

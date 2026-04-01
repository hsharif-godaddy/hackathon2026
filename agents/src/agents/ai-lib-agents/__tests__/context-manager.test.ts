import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AILibContextManager } from '../context-manager.js'

const { latestSummary, getMessageById, summaryStore, pinnedSummaryId } = vi.hoisted(() => ({
  latestSummary: { value: null as any },
  getMessageById: vi.fn().mockResolvedValue({ id: 'm1' }),
  summaryStore: new Map<string, any>(),
  pinnedSummaryId: { value: null as string | null },
}))

vi.mock('../../../database/repositories/SummaryRepository.js', () => ({
  SummaryRepository: class {
    findLatestForApp = vi.fn().mockImplementation(async () => latestSummary.value)
    findById = vi.fn().mockImplementation(async (id: string) => summaryStore.get(id) ?? null)
  }
}))

vi.mock('../../../database/repositories/index.js', () => ({
  conversationRepository: {
    getMessageById
  }
}))

vi.mock('../../../services/ConversationContextManager.js', () => ({
  ConversationContextManager: class {
    getHistoryLoader() {
      return {
        getPinnedSummaryId: () => pinnedSummaryId.value
      }
    }
  }
}))

describe('AILibContextManager', () => {
  beforeEach(() => {
    latestSummary.value = null
    pinnedSummaryId.value = null
    summaryStore.clear()
    getMessageById.mockClear()
  })

  it('injects summary as cached USER memory message (not system, for security)', async () => {
    latestSummary.value = {
      id: 'sum1',
      summaryText: '# Summary',
      operationLog: 'Edited file A',
      summaryTokenCount: 123,
      originalTokenCount: 456,
      messageRangeEnd: 'm1'
    }

    const contextManager = new AILibContextManager()
    const result = await contextManager.buildContextMessages(
      '',
      { metadata: { appId: 'app-123' } },
      { includeTemplateDescription: false, includeAppContext: false }
    )

    // SECURITY: Memory must be injected as USER message, not system
    // User-derived content should never be elevated to system prompt privilege
    const memoryMessage = result.contextMessages.find(
      (msg) => msg.role === 'user' && msg.content.includes('# Memory')
    )

    expect(memoryMessage).toBeDefined()
    expect(memoryMessage?.cachePoint).toBeUndefined()
    expect(memoryMessage?.content).toContain('# Summary')
    // Operation log is NOT included here — it's injected separately by
    // ConversationHistoryLoader to avoid duplicating content in the prompt
    expect(memoryMessage?.content).not.toContain('## Operation Log')

    // Verify it's NOT a system message
    const systemMemoryMessage = result.contextMessages.find(
      (msg) => msg.role === 'system' && msg.content.includes('# Memory')
    )
    expect(systemMemoryMessage).toBeUndefined()
  })

  describe('summary pinning in context-manager', () => {
    const makeSummary = (id: string, appId: string, text: string) => ({
      id,
      appId,
      summaryText: text,
      summaryTokenCount: 100,
      originalTokenCount: 500,
      messageRangeEnd: 'm1'
    })

    it('uses pinned summary when pinnedId is set and appId matches', async () => {
      const pinned = makeSummary('pin-1', 'app-123', '# Pinned Summary')
      summaryStore.set('pin-1', pinned)
      pinnedSummaryId.value = 'pin-1'
      // Set a different "latest" to prove pinned is preferred
      latestSummary.value = makeSummary('latest-1', 'app-123', '# Latest Summary')

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const memoryMsg = result.contextMessages.find(
        (msg) => msg.role === 'user' && msg.content.includes('# Memory')
      )
      expect(memoryMsg?.content).toContain('Pinned Summary')
      expect(memoryMsg?.content).not.toContain('Latest Summary')
    })

    it('falls back to findLatestForApp when pinned summary has mismatched appId', async () => {
      const pinned = makeSummary('pin-1', 'other-app', '# Wrong App Summary')
      summaryStore.set('pin-1', pinned)
      pinnedSummaryId.value = 'pin-1'
      latestSummary.value = makeSummary('latest-1', 'app-123', '# Correct Latest')

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const memoryMsg = result.contextMessages.find(
        (msg) => msg.role === 'user' && msg.content.includes('# Memory')
      )
      expect(memoryMsg?.content).toContain('Correct Latest')
      expect(memoryMsg?.content).not.toContain('Wrong App Summary')
    })

    it('falls back to findLatestForApp when findById returns null', async () => {
      // pinnedId is set but summary doesn't exist in store
      pinnedSummaryId.value = 'deleted-pin'
      latestSummary.value = makeSummary('latest-1', 'app-123', '# Fallback Summary')

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const memoryMsg = result.contextMessages.find(
        (msg) => msg.role === 'user' && msg.content.includes('# Memory')
      )
      expect(memoryMsg?.content).toContain('Fallback Summary')
    })
  })
})

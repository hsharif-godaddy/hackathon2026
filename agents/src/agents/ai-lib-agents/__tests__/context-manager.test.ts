import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AILibContextManager } from '../context-manager.js'

const { latestSummary, getMessageById } = vi.hoisted(() => ({
  latestSummary: { value: null as any },
  getMessageById: vi.fn().mockResolvedValue({ id: 'm1' })
}))

vi.mock('../../../database/repositories/SummaryRepository.js', () => ({
  SummaryRepository: class {
    findLatestForApp = vi.fn().mockImplementation(async () => latestSummary.value)
  }
}))

vi.mock('../../../database/repositories/index.js', () => ({
  conversationRepository: {
    getMessageById
  }
}))

describe('AILibContextManager', () => {
  beforeEach(() => {
    latestSummary.value = null
    getMessageById.mockClear()
  })

  it('injects summary as cached system memory message', async () => {
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

    const memoryMessage = result.contextMessages.find(
      (msg) => msg.role === 'system' && msg.content.includes('# Memory')
    )

    expect(memoryMessage).toBeDefined()
    expect(memoryMessage?.cachePoint?.type).toBe('ephemeral')
    expect(memoryMessage?.content).toContain('# Summary')
    expect(memoryMessage?.content).toContain('## Operation Log')
  })
})

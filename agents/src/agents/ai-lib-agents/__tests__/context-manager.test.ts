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

vi.mock('../../../services/ContextAttachmentRegistry.js', () => ({
  contextAttachmentRegistry: {
    render: vi.fn()
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

import { contextAttachmentRegistry } from '../../../services/ContextAttachmentRegistry.js'
const mockedRegistryRender = vi.mocked(contextAttachmentRegistry.render)

const { appContextResult } = vi.hoisted(() => ({
  appContextResult: {
    value: null as { stableContext?: string; secretsContext?: string; mediaSlotsContext?: string } | null
  }
}))

vi.mock('../../../services/AppContextManager.js', () => ({
  AppContextManager: class {
    generateContextMessage = vi.fn().mockImplementation(async () => appContextResult.value ?? {})
  }
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: class {
    findById = vi.fn().mockReturnValue({ id: 'app-123', path: '/tmp/test-app' })
  }
}))

describe('AILibContextManager', () => {
  beforeEach(() => {
    latestSummary.value = null
    pinnedSummaryId.value = null
    summaryStore.clear()
    getMessageById.mockClear()
    mockedRegistryRender.mockClear()
    appContextResult.value = null
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
    expect(memoryMessage?.cachePoint).toEqual({ type: 'ephemeral' })
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

  describe('vision: assetImages in formattedContexts', () => {
    it('populates formattedContexts with assetImages from a selected_assets attachment', async () => {
      const manager = new AILibContextManager()
      const fakeBase64 = `data:image/jpeg;base64,${Buffer.from('fake').toString('base64')}`

      mockedRegistryRender.mockResolvedValue({
        role: 'user' as const,
        content: 'Asset context text',
        insertionOrder: 'after_history' as const,
        assetImages: [fakeBase64]
      })

      const context = {
        metadata: { appId: 'test-app' },
        contextAttachments: [{
          type: 'selected_assets',
          data: [{
            mediaType: 'IMAGE',
            sourceType: 'upload',
            imageUrl: 'http://localhost:4000/files/uploads/test-app/img.jpg',
            filename: 'img.jpg',
            contentType: 'image/jpeg',
            size: 1024
          }],
          persistence: 'ephemeral' as const,
          renderStrategy: 'before_prompt' as const
        }]
      }

      const result = await manager.buildContextMessages('', context as any)
      expect(result.formattedContexts).toBeDefined()
      const imageContexts = result.formattedContexts!.filter(f => f.assetImages && f.assetImages.length > 0)
      expect(imageContexts).toHaveLength(1)
      expect(imageContexts[0]!.assetImages).toContain(fakeBase64)
    })

    it('does not add to formattedContexts when no assetImages in rendered attachment', async () => {
      const manager = new AILibContextManager()

      mockedRegistryRender.mockResolvedValue({
        role: 'user' as const,
        content: 'Some context',
        insertionOrder: 'after_history' as const
        // no assetImages
      })

      const context = {
        metadata: { appId: 'test-app' },
        contextAttachments: [{
          type: 'selected_assets',
          data: [{ mediaType: 'IMAGE', sourceType: 'stock', imageUrl: 'https://example.com/img.jpg' }],
          persistence: 'ephemeral' as const
        }]
      }

      const result = await manager.buildContextMessages('', context as any)
      const imageContexts = (result.formattedContexts ?? []).filter(f => f.assetImages && f.assetImages.length > 0)
      expect(imageContexts).toHaveLength(0)
    })
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

  describe('app context forwarding', () => {
    it('forwards app_context_stable as after_history user message', async () => {
      appContextResult.value = {
        stableContext: 'Package: test-app\nColor: blue'
      }

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' }, appContext: {} },
        { includeTemplateDescription: false }
      )

      const stableMsg = result.contextMessages.find(
        (msg) => msg.content.includes('Package: test-app')
      )
      expect(stableMsg).toBeDefined()
      expect(stableMsg?.role).toBe('user')
      expect(stableMsg?.insertionOrder).toBe('after_history')
    })

    it('forwards all three app context types', async () => {
      appContextResult.value = {
        stableContext: 'stable content',
        secretsContext: 'secrets content',
        mediaSlotsContext: 'media slots content'
      }

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' }, appContext: {} },
        { includeTemplateDescription: false }
      )

      const stable = result.contextMessages.find(m => m.content === 'stable content')
      const secrets = result.contextMessages.find(m => m.content === 'secrets content')
      const media = result.contextMessages.find(m => m.content === 'media slots content')

      expect(stable).toBeDefined()
      expect(secrets).toBeDefined()
      expect(media).toBeDefined()

      // All should be after_history to avoid cache invalidation
      expect(stable?.insertionOrder).toBe('after_history')
      expect(secrets?.insertionOrder).toBe('after_history')
      expect(media?.insertionOrder).toBe('after_history')

      // Ordering matters: stable before secrets before media_slots
      // (matches buildAppContextMessage push order)
      const stableIdx = result.contextMessages.indexOf(stable!)
      const secretsIdx = result.contextMessages.indexOf(secrets!)
      const mediaIdx = result.contextMessages.indexOf(media!)
      expect(stableIdx).toBeLessThan(secretsIdx)
      expect(secretsIdx).toBeLessThan(mediaIdx)
    })

    it('does not include app context when includeAppContext is false', async () => {
      appContextResult.value = {
        stableContext: 'should not appear'
      }

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' }, appContext: {} },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const stableMsg = result.contextMessages.find(
        (msg) => msg.content.includes('should not appear')
      )
      expect(stableMsg).toBeUndefined()
    })
  })
})

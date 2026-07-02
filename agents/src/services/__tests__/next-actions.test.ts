import { buildSecretsComposerSuccessUserMessage } from '@airo/shared'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  mockFindById,
  mockFindLatestForApp,
  mockGetMessagesAfterMessageId,
  mockGetRecentMessagesForApp,
  mockGetAllLists,
  mockGenerateText,
  mockGetActiveAgentContext,
  mockMemoryGet,
} = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockFindLatestForApp: vi.fn(),
  mockGetMessagesAfterMessageId: vi.fn(),
  mockGetRecentMessagesForApp: vi.fn(),
  mockGetAllLists: vi.fn(),
  mockGenerateText: vi.fn(),
  mockGetActiveAgentContext: vi.fn(),
  mockMemoryGet: vi.fn(),
}))

vi.mock('@airo/ai-lib', () => ({
  getModel: vi.fn().mockResolvedValue({}),
}))

vi.mock('ai', () => ({
  generateText: mockGenerateText,
}))

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: mockFindById,
  }; }),
}))

vi.mock('../../database/repositories/MemoryRepository.js', () => ({
  MemoryRepository: vi.fn().mockImplementation(function () { return {
    get: mockMemoryGet,
  }; }),
}))

vi.mock('../../database/repositories/ConversationRepository.js', () => ({
  ConversationRepository: vi.fn().mockImplementation(function () { return {
    getMessagesAfterMessageId: mockGetMessagesAfterMessageId,
    getRecentMessagesForApp: mockGetRecentMessagesForApp,
  }; }),
}))

vi.mock('../../database/repositories/SummaryRepository.js', () => ({
  SummaryRepository: vi.fn().mockImplementation(function () { return {
    findLatestForApp: mockFindLatestForApp,
  }; }),
}))

vi.mock('../../database/repositories/TodoListRepository.js', () => ({
  TodoListRepository: vi.fn().mockImplementation(function () { return {
    getAllLists: mockGetAllLists,
  }; }),
}))

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

// The default skill-announcements collector fans out to this singleton. Stub it so
// the existing tests see "no skills" (collector returns []) and stay unchanged.
vi.mock('../../tools/skill-tool-manager.js', () => ({
  skillToolManager: {
    collectAppAnnouncements: vi.fn().mockResolvedValue([]),
  },
}))

// The skill-suggestion merge is gated by the `appbuilder-skill-suggestions` flag,
// read from the active agent context (AsyncLocalStorage). Default the mock to ON so
// the merge tests below exercise the merge; the gating tests override it.
vi.mock('../../lib/agent-context-storage.js', () => ({
  getActiveAgentContext: mockGetActiveAgentContext,
}))

import { NextActionsService } from '../next-actions.js'

function feature(id: string, label: string, version = 1) {
  return { id, label, summary: `do ${label}`, version }
}

describe('NextActionsService', () => {
  let service: NextActionsService
  const appId = 'test-app-id'

  beforeEach(() => {
    vi.clearAllMocks()
    service = new NextActionsService()

    // Default: app exists, no summary, no todos, no custom domains
    mockFindById.mockReturnValue({ id: appId })
    mockFindLatestForApp.mockResolvedValue(null)
    mockGetRecentMessagesForApp.mockResolvedValue([])
    mockGetAllLists.mockReturnValue([])
    mockMemoryGet.mockResolvedValue({ success: true, exists: false })
    mockGenerateText.mockResolvedValue({
      text: '[{"text": "Add a contact page"}]',
      usage: { totalTokens: 100 },
    })
    // Default: skill-suggestions flag ON, so the merge runs.
    mockGetActiveAgentContext.mockReturnValue({ skillSuggestionsEnabled: true })
  })

  describe('generateNextActions', () => {
    it('should throw when app is not found', async () => {
      mockFindById.mockReturnValue(null)

      await expect(service.generateNextActions(appId)).rejects.toThrow('App not found: test-app-id')
    })

    it('should call LLM and return suggestions when no summary or messages exist', async () => {
      const result = await service.generateNextActions(appId)

      expect(result.suggestions).toEqual([{ text: 'Add a contact page' }])
      expect(mockGenerateText).toHaveBeenCalledOnce()
    })

    it('should include conversation summary in context when available', async () => {
      mockFindLatestForApp.mockResolvedValue({
        summaryText: 'User is building a portfolio site.',
        messageRangeEnd: 'msg-5',
      })
      mockGetMessagesAfterMessageId.mockResolvedValue([])

      await service.generateNextActions(appId)

      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('CONVERSATION SUMMARY')
      expect(prompt).toContain('User is building a portfolio site.')
    })

    it('should include recent messages after summary in context', async () => {
      mockFindLatestForApp.mockResolvedValue({
        summaryText: 'Summary text',
        messageRangeEnd: 'msg-5',
      })
      mockGetMessagesAfterMessageId.mockResolvedValue([
        { sender: 'user', content: 'Add a blog section' },
        { sender: 'agent', content: 'I added a blog page.' },
      ])

      await service.generateNextActions(appId)

      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('RECENT MESSAGES')
      expect(prompt).toContain('User: Add a blog section')
      expect(prompt).toContain('Assistant: I added a blog page.')
    })

    it('should include app published state in context', async () => {
      mockFindById.mockReturnValue({ id: appId, publishedUrl: 'https://example.com' })

      await service.generateNextActions(appId)

      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('Published: true')
      expect(prompt).toContain('https://example.com')
    })

    it('should include unpublished app state in context', async () => {
      mockFindById.mockReturnValue({ id: appId, publishedUrl: undefined })

      await service.generateNextActions(appId)

      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('Published: false')
    })

    it('should include todo lists in context', async () => {
      mockGetAllLists.mockReturnValue([
        {
          name: 'Design Tasks',
          items: [
            { title: 'Fix header', completed: true },
            { title: 'Add footer', completed: false },
          ],
        },
      ])

      await service.generateNextActions(appId)

      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('TODO LISTS')
      expect(prompt).toContain('Design Tasks')
      expect(prompt).toContain('Add footer')
    })

    it('should use getRecentMessagesForApp when summary has no messageRangeEnd', async () => {
      mockFindLatestForApp.mockResolvedValue({
        summaryText: 'A summary',
        messageRangeEnd: null,
      })
      mockGetRecentMessagesForApp.mockResolvedValue([
        { sender: 'agent', content: 'Here are some options for you.' },
      ])

      await service.generateNextActions(appId)

      expect(mockGetMessagesAfterMessageId).not.toHaveBeenCalled()
      expect(mockGetRecentMessagesForApp).toHaveBeenCalled()
      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('RECENT MESSAGES')
      expect(prompt).toContain('Assistant: Here are some options for you.')
    })

    it('should return empty suggestions when LLM returns empty array', async () => {
      mockGenerateText.mockResolvedValue({
        text: '[]',
        usage: { totalTokens: 50 },
      })

      const result = await service.generateNextActions(appId)

      expect(result.suggestions).toEqual([])
    })

    it('should fetch recent messages when no summary exists', async () => {
      mockFindLatestForApp.mockResolvedValue(null)
      mockGetRecentMessagesForApp.mockResolvedValue([
        { sender: 'user', content: 'Build me a trombone teaching site' },
        { sender: 'agent', content: 'Here are some name ideas. Any of these resonate?' },
      ])

      await service.generateNextActions(appId)

      expect(mockGetRecentMessagesForApp).toHaveBeenCalled()
      expect(mockGetMessagesAfterMessageId).not.toHaveBeenCalled()
      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('Assistant: Here are some name ideas. Any of these resonate?')
    })

    it('should include secrets-just-saved guidance when the latest user message saved secrets', async () => {
      mockFindLatestForApp.mockResolvedValue(null)
      mockGetRecentMessagesForApp.mockResolvedValue([
        { sender: 'user', content: buildSecretsComposerSuccessUserMessage('add', ['STRIPE_KEY']) },
        { sender: 'agent', content: 'Thanks — what should we build next?' },
      ])

      await service.generateNextActions(appId)

      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('SECRETS JUST SAVED')
    })

    it('should omit secrets-just-saved guidance when an older turn saved secrets', async () => {
      mockFindLatestForApp.mockResolvedValue(null)
      mockGetRecentMessagesForApp.mockResolvedValue([
        { sender: 'user', content: buildSecretsComposerSuccessUserMessage('add', ['STRIPE_KEY']) },
        { sender: 'agent', content: 'Thanks — what should we build next?' },
        { sender: 'user', content: 'Add a pricing page' },
        { sender: 'agent', content: 'Any of these layouts resonate?' },
      ])

      await service.generateNextActions(appId)

      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).not.toContain('SECRETS JUST SAVED')
    })

    it('should report custom domain as attached when one is connected', async () => {
      mockFindById.mockReturnValue({ id: appId, publishedUrl: 'https://example.com' })
      mockMemoryGet.mockResolvedValue({
        success: true,
        exists: true,
        value: [{ fqdn: 'mysite.com', isPrimary: true, status: 'active' }],
      })

      await service.generateNextActions(appId)

      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('Custom domain: attached')
    })

    it('should report custom domain as none when none are stored', async () => {
      mockFindById.mockReturnValue({ id: appId, publishedUrl: 'https://example.com' })
      mockMemoryGet.mockResolvedValue({ success: true, exists: false })

      await service.generateNextActions(appId)

      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('Custom domain: none')
    })

    it('should report custom domain as unknown when memory repository throws', async () => {
      mockFindById.mockReturnValue({ id: appId, publishedUrl: 'https://example.com' })
      mockMemoryGet
        .mockResolvedValueOnce({ success: true, exists: false })
        .mockRejectedValue(new Error('DB error'))

      const result = await service.generateNextActions(appId)

      expect(result.suggestions).toBeDefined()
      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).toContain('Custom domain: unknown')
    })

    it('should skip domain lookup and omit custom domain line when app is not published', async () => {
      mockFindById.mockReturnValue({ id: appId, publishedUrl: undefined })

      await service.generateNextActions(appId)

      expect(mockMemoryGet).toHaveBeenCalledTimes(1)
      const prompt = mockGenerateText.mock.calls[0][0].prompt as string
      expect(prompt).not.toContain('Custom domains')
    })

    it('should pass correct parameters to generateText', async () => {
      await service.generateNextActions(appId)

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          maxOutputTokens: 500,
          experimental_telemetry: { isEnabled: true, functionId: 'next-actions' },
        }),
      )
    })
  })

  describe('skill suggestion merge', () => {
    it('prepends skill pending capabilities (max 2) and caps the combined list at 4', async () => {
      mockGenerateText.mockResolvedValue({
        text: '[{"text":"Publish your site"},{"text":"Connect a custom domain"}]',
        usage: { totalTokens: 100 },
      })
      const collector = vi.fn().mockResolvedValue([
        feature('paid-booking', 'Charge customers when they book'),
        feature('admin-dashboard', 'Add an owner dashboard'),
        feature('customer-portal', 'Add a customer portal'),
      ])
      const svc = new NextActionsService(undefined, undefined, undefined, collector)

      const result = await svc.generateNextActions(appId)

      expect(result.suggestions).toEqual([
        { text: 'Charge customers when they book' },
        { text: 'Add an owner dashboard' },
        { text: 'Publish your site' },
        { text: 'Connect a custom domain' },
      ])
    })

    it('skips skill items already on the plan/todo list', async () => {
      mockGenerateText.mockResolvedValue({ text: '[{"text":"Publish your site"}]', usage: {} })
      mockGetAllLists.mockReturnValue([
        { name: 'Plan', items: [{ title: 'Charge customers when they book', completed: false }] },
      ])
      const collector = vi.fn().mockResolvedValue([
        feature('paid-booking', 'Charge customers when they book'),
        feature('admin-dashboard', 'Add an owner dashboard'),
      ])
      const svc = new NextActionsService(undefined, undefined, undefined, collector)

      const result = await svc.generateNextActions(appId)

      expect(result.suggestions).toEqual([
        { text: 'Add an owner dashboard' },
        { text: 'Publish your site' },
      ])
    })

    it('drops an LLM suggestion that duplicates a prepended skill item', async () => {
      mockGenerateText.mockResolvedValue({
        text: '[{"text":"Add an owner dashboard"},{"text":"Publish your site"}]',
        usage: {},
      })
      const collector = vi.fn().mockResolvedValue([feature('admin-dashboard', 'Add an owner dashboard')])
      const svc = new NextActionsService(undefined, undefined, undefined, collector)

      const result = await svc.generateNextActions(appId)

      expect(result.suggestions).toEqual([
        { text: 'Add an owner dashboard' },
        { text: 'Publish your site' },
      ])
    })

    it('leaves LLM suggestions unchanged when no skill reports capabilities', async () => {
      mockGenerateText.mockResolvedValue({ text: '[{"text":"Publish your site"}]', usage: {} })
      const collector = vi.fn().mockResolvedValue([])
      const svc = new NextActionsService(undefined, undefined, undefined, collector)

      const result = await svc.generateNextActions(appId)

      expect(result.suggestions).toEqual([{ text: 'Publish your site' }])
    })

    it('falls back to LLM suggestions when the collector throws', async () => {
      mockGenerateText.mockResolvedValue({ text: '[{"text":"Publish your site"}]', usage: {} })
      const collector = vi.fn().mockRejectedValue(new Error('boom'))
      const svc = new NextActionsService(undefined, undefined, undefined, collector)

      const result = await svc.generateNextActions(appId)

      expect(result.suggestions).toEqual([{ text: 'Publish your site' }])
    })
  })

  describe('appbuilder-skill-suggestions flag gating', () => {
    it('returns LLM suggestions only and never consults the collector when the flag is off', async () => {
      mockGetActiveAgentContext.mockReturnValue({ skillSuggestionsEnabled: false })
      mockGenerateText.mockResolvedValue({ text: '[{"text":"Publish your site"}]', usage: {} })
      const collector = vi.fn().mockResolvedValue([feature('paid-booking', 'Charge customers when they book')])
      const svc = new NextActionsService(undefined, undefined, undefined, collector)

      const result = await svc.generateNextActions(appId)

      expect(result.suggestions).toEqual([{ text: 'Publish your site' }])
      expect(collector).not.toHaveBeenCalled()
    })

    it('treats a missing agent context as flag off (LLM suggestions only)', async () => {
      mockGetActiveAgentContext.mockReturnValue(null)
      mockGenerateText.mockResolvedValue({ text: '[{"text":"Publish your site"}]', usage: {} })
      const collector = vi.fn().mockResolvedValue([feature('paid-booking', 'Charge customers when they book')])
      const svc = new NextActionsService(undefined, undefined, undefined, collector)

      const result = await svc.generateNextActions(appId)

      expect(result.suggestions).toEqual([{ text: 'Publish your site' }])
      expect(collector).not.toHaveBeenCalled()
    })

    it('merges skill capabilities when the flag is on', async () => {
      mockGetActiveAgentContext.mockReturnValue({ skillSuggestionsEnabled: true })
      mockGenerateText.mockResolvedValue({ text: '[{"text":"Publish your site"}]', usage: {} })
      const collector = vi.fn().mockResolvedValue([feature('paid-booking', 'Charge customers when they book')])
      const svc = new NextActionsService(undefined, undefined, undefined, collector)

      const result = await svc.generateNextActions(appId)

      expect(collector).toHaveBeenCalledOnce()
      expect(result.suggestions).toEqual([
        { text: 'Charge customers when they book' },
        { text: 'Publish your site' },
      ])
    })
  })

  describe('parseResponse', () => {
    // Access the private method for direct testing
    function callParseResponse(text: string) {
      return (service as any).parseResponse(text)
    }

    it('should parse a valid JSON array response', () => {
      const result = callParseResponse('[{"text": "Do something"}, {"text": "Do another thing"}]')

      expect(result).toEqual([{ text: 'Do something' }, { text: 'Do another thing' }])
    })

    it('should extract JSON array from surrounding text', () => {
      const result = callParseResponse('Here are suggestions:\n[{"text": "Action 1"}]\nEnd.')

      expect(result).toEqual([{ text: 'Action 1' }])
    })

    it('should return empty array when no JSON array is found', () => {
      const result = callParseResponse('No JSON here at all')

      expect(result).toEqual([])
    })

    it('should return empty array when parsed result is not an array', () => {
      // This branch cannot actually be reached with the current regex (which matches [...]),
      // but we test it for completeness by mocking JSON.parse behavior indirectly.
      // The regex ensures we always get an array-like string, so this is defensive code.
      const result = callParseResponse('{"text": "not an array"}')

      expect(result).toEqual([])
    })

    it('should filter out items missing the text field', () => {
      const result = callParseResponse('[{"text": "Valid"}, {"notext": true}, {"text": "Also valid"}]')

      expect(result).toEqual([{ text: 'Valid' }, { text: 'Also valid' }])
    })

    it('should filter out items where text is not a string', () => {
      const result = callParseResponse('[{"text": "Valid"}, {"text": 123}, {"text": null}]')

      expect(result).toEqual([{ text: 'Valid' }])
    })

    it('should cap results at 4 items', () => {
      const items = Array.from({ length: 6 }, (_, i) => ({ text: `Action ${i + 1}` }))
      const result = callParseResponse(JSON.stringify(items))

      expect(result).toHaveLength(4)
      expect(result[3]).toEqual({ text: 'Action 4' })
    })

    it('should return empty array on JSON parse error', () => {
      const result = callParseResponse('[{invalid json}]')

      expect(result).toEqual([])
    })

    it('should filter out null and non-object items', () => {
      const result = callParseResponse('[null, "string", 42, {"text": "Valid"}]')

      expect(result).toEqual([{ text: 'Valid' }])
    })
  })
})

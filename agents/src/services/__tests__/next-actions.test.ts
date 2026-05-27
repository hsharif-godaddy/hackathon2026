import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  mockFindById,
  mockFindLatestForApp,
  mockGetMessagesAfterMessageId,
  mockGetRecentMessagesForApp,
  mockGetAllLists,
  mockGenerateText,
} = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockFindLatestForApp: vi.fn(),
  mockGetMessagesAfterMessageId: vi.fn(),
  mockGetRecentMessagesForApp: vi.fn(),
  mockGetAllLists: vi.fn(),
  mockGenerateText: vi.fn(),
}))

vi.mock('@airo/ai-lib', () => ({
  getModel: vi.fn().mockResolvedValue({}),
}))

vi.mock('ai', () => ({
  generateText: mockGenerateText,
}))

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: mockFindById,
  })),
}))

vi.mock('../../database/repositories/ConversationRepository.js', () => ({
  ConversationRepository: vi.fn().mockImplementation(() => ({
    getMessagesAfterMessageId: mockGetMessagesAfterMessageId,
    getRecentMessagesForApp: mockGetRecentMessagesForApp,
  })),
}))

vi.mock('../../database/repositories/SummaryRepository.js', () => ({
  SummaryRepository: vi.fn().mockImplementation(() => ({
    findLatestForApp: mockFindLatestForApp,
  })),
}))

vi.mock('../../database/repositories/TodoListRepository.js', () => ({
  TodoListRepository: vi.fn().mockImplementation(() => ({
    getAllLists: mockGetAllLists,
  })),
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

import { NextActionsService } from '../next-actions.js'

describe('NextActionsService', () => {
  let service: NextActionsService
  const appId = 'test-app-id'

  beforeEach(() => {
    vi.clearAllMocks()
    service = new NextActionsService()

    // Default: app exists, no summary, no todos
    mockFindById.mockReturnValue({ id: appId })
    mockFindLatestForApp.mockResolvedValue(null)
    mockGetRecentMessagesForApp.mockResolvedValue([])
    mockGetAllLists.mockReturnValue([])
    mockGenerateText.mockResolvedValue({
      text: '[{"text": "Add a contact page"}]',
      usage: { totalTokens: 100 },
    })
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

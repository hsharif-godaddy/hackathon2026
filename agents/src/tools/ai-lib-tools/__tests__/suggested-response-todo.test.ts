import { describe, it, expect, vi } from 'vitest'

const { mockGetListById } = vi.hoisted(() => ({
  mockGetListById: vi.fn()
}))

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(() => ({
    findById: vi.fn().mockResolvedValue(null)
  }))
}))

vi.mock('../../../database/repositories/TodoListRepository.js', () => ({
  TodoListRepository: vi.fn(() => ({
    getListById: mockGetListById,
    initializeSchema: vi.fn()
  }))
}))

import { suggestedResponseAITool } from '../suggested-response.js'

function createExecutionOptions(overrides: Record<string, unknown> = {}) {
  return {
    experimental_context: {
      metadata: {
        appId: 'test-app',
        sessionId: 'test-session',
        _userMessage: 'Template gallery',
        stateManager: {
          getSelectedTodoList: vi.fn().mockReturnValue('list-1')
        },
        ...overrides
      }
    }
  }
}

const baseSuggestions = [{ text: 'Next step' }]

describe('suggestedResponse todo reminder', function suggestedResponseTodoTests() {
  it('should not include reminder when stateManager is missing', async function noStateManager() {
    const result = await (suggestedResponseAITool as any).execute(
      { question: 'What next?', suggestions: baseSuggestions },
      createExecutionOptions({ stateManager: undefined })
    )
    expect(result.message).not.toContain('ACTION REQUIRED')
  })

  it('should not include reminder when no pending items', async function noPending() {
    mockGetListById.mockReturnValue({
      id: 'list-1',
      name: 'Test',
      appId: 'test-app',
      items: [
        { id: 'item-1', title: 'Homepage', completed: true }
      ]
    })

    const result = await (suggestedResponseAITool as any).execute(
      { question: 'What next?', suggestions: baseSuggestions },
      createExecutionOptions()
    )
    expect(result.message).not.toContain('ACTION REQUIRED')
  })

  it('should include reminder with item IDs when pending items exist', async function withPending() {
    mockGetListById.mockReturnValue({
      id: 'list-1',
      name: 'Test',
      appId: 'test-app',
      items: [
        { id: 'item-1', title: 'Homepage', completed: true },
        { id: 'item-2', title: 'Template gallery', completed: false },
        { id: 'item-3', title: 'Download & share', completed: false }
      ]
    })

    const result = await (suggestedResponseAITool as any).execute(
      { question: 'What next?', suggestions: baseSuggestions },
      createExecutionOptions()
    )
    expect(result.message).toContain('ACTION REQUIRED')
    expect(result.message).toContain('item-2')
    expect(result.message).toContain('Template gallery')
    expect(result.message).toContain('item-3')
  })

  it('should not include reminder when list belongs to a different app', async function appIdMismatch() {
    mockGetListById.mockReturnValue({
      id: 'list-1',
      name: 'Test',
      appId: 'other-app',
      items: [
        { id: 'item-1', title: 'Homepage', completed: false }
      ]
    })

    const result = await (suggestedResponseAITool as any).execute(
      { question: 'What next?', suggestions: baseSuggestions },
      createExecutionOptions()
    )
    expect(result.message).not.toContain('ACTION REQUIRED')
  })

  it('should not throw when stateManager.getSelectedTodoList throws', async function stateManagerError() {
    const result = await (suggestedResponseAITool as any).execute(
      { question: 'What next?', suggestions: baseSuggestions },
      createExecutionOptions({
        stateManager: {
          getSelectedTodoList: () => { throw new Error('boom') }
        }
      })
    )
    expect(result.success).toBe(true)
    expect(result.message).not.toContain('ACTION REQUIRED')
  })
})

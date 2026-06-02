import { describe, it, expect, vi } from 'vitest'

const { mockGetListById, mockMarkItemsCompleted } = vi.hoisted(() => ({
  mockGetListById: vi.fn(),
  mockMarkItemsCompleted: vi.fn(),
}))

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () { return {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }; })
  }
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function () { return {
    findById: vi.fn().mockResolvedValue(null)
  }; })
}))

vi.mock('../../../planning/adapters/index.js', () => ({
  getTodoListStore: vi.fn(function () { return {
    getListById: mockGetListById,
    markItemsCompleted: mockMarkItemsCompleted,
  }; })
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
  it('should not warn when stateManager is missing', async function noStateManager() {
    mockMarkItemsCompleted.mockReset()
    const result = await (suggestedResponseAITool as any).execute(
      { question: 'What next?', suggestions: baseSuggestions },
      createExecutionOptions({ stateManager: undefined })
    )
    expect(result.message).not.toContain('mark_done')
    expect(mockMarkItemsCompleted).not.toHaveBeenCalled()
  })

  it('should not warn when no in-progress items', async function noPending() {
    mockMarkItemsCompleted.mockReset()
    mockGetListById.mockReturnValue({
      id: 'list-1',
      name: 'Test',
      appId: 'test-app',
      items: [
        { id: 'item-1', title: 'Homepage', completed: true, inProgress: false },
        { id: 'item-2', title: 'Settings', completed: false, inProgress: false }
      ]
    })

    const result = await (suggestedResponseAITool as any).execute(
      { question: 'What next?', suggestions: baseSuggestions },
      createExecutionOptions()
    )
    expect(result.message).not.toContain('mark_done')
    expect(mockMarkItemsCompleted).not.toHaveBeenCalled()
  })

  it('should warn when in-progress items exist', async function withPending() {
    mockMarkItemsCompleted.mockReset()
    mockGetListById.mockReturnValue({
      id: 'list-1',
      name: 'Test',
      appId: 'test-app',
      items: [
        { id: 'item-1', title: 'Homepage', completed: true, inProgress: false },
        { id: 'item-2', title: 'Template gallery', completed: false, inProgress: true },
        { id: 'item-3', title: 'Download & share', completed: false, inProgress: false }
      ]
    })

    const result = await (suggestedResponseAITool as any).execute(
      { question: 'What next?', suggestions: baseSuggestions },
      createExecutionOptions()
    )
    expect(result.message).toContain('1 in-progress todo item still open (item-2)')
    expect(result.message).toContain('mark_done')
    expect(mockMarkItemsCompleted).not.toHaveBeenCalled()
  })

  it('should not warn when list belongs to a different app', async function appIdMismatch() {
    mockMarkItemsCompleted.mockReset()
    mockGetListById.mockReturnValue({
      id: 'list-1',
      name: 'Test',
      appId: 'other-app',
      items: [
        { id: 'item-1', title: 'Homepage', completed: false, inProgress: true }
      ]
    })

    const result = await (suggestedResponseAITool as any).execute(
      { question: 'What next?', suggestions: baseSuggestions },
      createExecutionOptions()
    )
    expect(result.message).not.toContain('mark_done')
    expect(mockMarkItemsCompleted).not.toHaveBeenCalled()
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
    expect(result.message).not.toContain('mark_done')
  })
})

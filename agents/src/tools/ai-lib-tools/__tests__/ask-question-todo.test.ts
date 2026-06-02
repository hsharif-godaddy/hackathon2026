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

vi.mock('../../../planning/adapters/index.js', () => ({
  getTodoListStore: vi.fn(function () { return {
    getListById: mockGetListById,
    markItemsCompleted: mockMarkItemsCompleted,
  }; })
}))

import { askQuestionAITool } from '../ask-question.js'

function createExecutionOptions(overrides: Record<string, unknown> = {}) {
  return {
    experimental_context: {
      metadata: {
        appId: 'test-app',
        sessionId: 'test-session',
        stateManager: {
          getSelectedTodoList: vi.fn().mockReturnValue('list-1')
        },
        ...overrides
      }
    }
  }
}

const baseQuestions = [{
  question: 'What next?',
  suggestions: ['Option A']
}]

describe('askQuestion todo reminder', function askQuestionTodoTests() {
  it('should not warn when stateManager is missing', async function noStateManager() {
    mockMarkItemsCompleted.mockReset()
    const result = await (askQuestionAITool as any).execute(
      { questions: baseQuestions },
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

    const result = await (askQuestionAITool as any).execute(
      { questions: baseQuestions },
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

    const result = await (askQuestionAITool as any).execute(
      { questions: baseQuestions },
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

    const result = await (askQuestionAITool as any).execute(
      { questions: baseQuestions },
      createExecutionOptions()
    )
    expect(result.message).not.toContain('mark_done')
    expect(mockMarkItemsCompleted).not.toHaveBeenCalled()
  })

  it('should not throw when stateManager.getSelectedTodoList throws', async function stateManagerError() {
    const result = await (askQuestionAITool as any).execute(
      { questions: baseQuestions },
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

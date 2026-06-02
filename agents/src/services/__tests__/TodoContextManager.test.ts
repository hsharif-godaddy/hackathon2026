import { describe, it, expect, vi } from 'vitest'

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('../../database/repositories/TodoListRepository.js', () => {
  const mockRepo = {
    getListById: vi.fn(),
    getAllLists: vi.fn().mockReturnValue([]),
    initializeSchema: vi.fn()
  }
  return {
    TodoListRepository: vi.fn(function () { return mockRepo; }),
    __mockRepo: mockRepo
  }
})

import { getTodoContextManager } from '../TodoContextManager.js'
import { TodoListRepository } from '../../database/repositories/TodoListRepository.js'

const mockRepo = (TodoListRepository as any).__mockRepo ?? new TodoListRepository()
const manager = getTodoContextManager()

const makeContext = (appId: string) => ({ metadata: { appId } })

describe('TodoContextManager', function todoContextManagerTests() {
  describe('formatTodoList note for complete lists', function completeListNote() {
    it('should show mark_done note when items are pending', async function pendingNote() {
      mockRepo.getListById.mockReturnValue({
        id: 'list-1',
        appId: 'app-1',
        name: 'Test',
        items: [
          { id: 'i1', title: 'Homepage', completed: true, inProgress: false },
          { id: 'i2', title: 'About', completed: false, inProgress: false }
        ]
      })

      const result = await manager.generateTodoContext(makeContext('app-1') as any, 'list-1')
      expect(result).toContain('operation: "mark_done"')
      expect(result).not.toContain('All items complete')
    })

    it('should show "All items complete" note when all done', async function allCompleteNote() {
      mockRepo.getListById.mockReturnValue({
        id: 'list-1',
        appId: 'app-1',
        name: 'Test',
        items: [
          { id: 'i1', title: 'Homepage', completed: true, inProgress: false },
          { id: 'i2', title: 'About', completed: true, inProgress: false }
        ]
      })

      const result = await manager.generateTodoContext(makeContext('app-1') as any, 'list-1')
      expect(result).toContain('All items complete')
      expect(result).toContain('Do not create a new list')
      expect(result).not.toContain('operation: "mark_in_progress"')
    })

    it('should not show "All items complete" for empty list', async function emptyListNote() {
      mockRepo.getListById.mockReturnValue({
        id: 'list-1',
        appId: 'app-1',
        name: 'Test',
        items: []
      })

      const result = await manager.generateTodoContext(makeContext('app-1') as any, 'list-1')
      expect(result).toContain('No items in this list yet')
      expect(result).not.toContain('All items complete')
    })

    it('should show completed list with checkmarks instead of "Create a new list"', async function showCompletedList() {
      mockRepo.getListById.mockReturnValue({
        id: 'list-1',
        appId: 'app-1',
        name: 'Pawfect Grooming',
        items: [
          { id: 'i1', title: 'Homepage', completed: true, inProgress: false },
          { id: 'i2', title: 'Services', completed: true, inProgress: false },
          { id: 'i3', title: 'Contact', completed: true, inProgress: false }
        ]
      })

      const result = await manager.generateTodoContext(makeContext('app-1') as any, 'list-1')
      expect(result).toContain('✅ Homepage')
      expect(result).toContain('✅ Services')
      expect(result).toContain('✅ Contact')
      expect(result).toContain('3/3 complete (100%)')
      expect(result).not.toContain('Create a new list')
      expect(result).not.toContain('No active todo list')
    })
  })

  describe('sibling list warning', function siblingWarning() {
    it('should warn when another list has open items', async function otherListOpen() {
      mockRepo.getListById.mockReturnValue({
        id: 'list-1',
        appId: 'app-1',
        name: 'Kinetic Website',
        items: [
          { id: 'i1', title: 'Homepage', completed: true, inProgress: false },
          { id: 'i2', title: 'About', completed: false, inProgress: false },
        ],
      })
      mockRepo.getAllLists.mockReturnValue([
        {
          id: 'list-1',
          appId: 'app-1',
          name: 'Kinetic Website',
          items: [
            { id: 'i1', title: 'Homepage', completed: true, inProgress: false },
            { id: 'i2', title: 'About', completed: false, inProgress: false },
          ],
        },
        {
          id: 'list-2',
          appId: 'app-1',
          name: 'Homepage Build',
          items: [{ id: 'i3', title: 'Hero', completed: false, inProgress: false }],
        },
      ])

      const result = await manager.generateTodoContext(makeContext('app-1') as any, 'list-1')
      expect(result).toContain('[Other Todo Lists]')
      expect(result).toContain('Homepage Build')
      expect(result).toContain('mark_done on the currently-selected list')
    })

    it('should still show active list when sibling warning lookup fails', async function siblingLookupFailure() {
      mockRepo.getListById.mockReturnValue({
        id: 'list-1',
        appId: 'app-1',
        name: 'Kinetic Website',
        items: [
          { id: 'i1', title: 'Homepage', completed: false, inProgress: false },
        ],
      })
      mockRepo.getAllLists.mockImplementation(() => {
        throw new Error('db locked')
      })

      const result = await manager.generateTodoContext(makeContext('app-1') as any, 'list-1')
      expect(result).toContain('[Current Todo List]')
      expect(result).toContain('Kinetic Website')
      expect(result).not.toContain('No active todo list')
      expect(result).not.toContain('[Other Todo Lists]')
    })
  })
})

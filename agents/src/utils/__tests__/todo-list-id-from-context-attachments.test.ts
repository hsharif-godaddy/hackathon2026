import { describe, expect, it } from 'vitest'

import { todoListIdFromContextAttachments } from '../todo-list-id-from-context-attachments.js'

describe('todo-list-id-from-context-attachments', function packageTests() {
  describe('#todoListIdFromContextAttachments', function fnTests() {
    it('returns undefined for non-array', function nonArray() {
      expect(todoListIdFromContextAttachments(undefined)).toBeUndefined()
      expect(todoListIdFromContextAttachments(null)).toBeUndefined()
      expect(todoListIdFromContextAttachments({})).toBeUndefined()
    })

    it('returns undefined for empty array', function empty() {
      expect(todoListIdFromContextAttachments([])).toBeUndefined()
    })

    it('returns first matching todo_list_context id', function firstMatch() {
      const id = todoListIdFromContextAttachments([
        { type: 'other', data: { id: 'x' } },
        { type: 'todo_list_context', data: { id: 'list-abc' } },
        { type: 'todo_list_context', data: { id: 'list-ignored' } },
      ])
      expect(id).toBe('list-abc')
    })

    it('ignores entries without string id or empty id', function invalidEntries() {
      expect(
        todoListIdFromContextAttachments([
          { type: 'todo_list_context', data: {} },
          { type: 'todo_list_context', data: { id: '' } },
          { type: 'todo_list_context', data: { id: 123 } },
        ])
      ).toBeUndefined()
    })

    it('requires type todo_list_context', function wrongType() {
      expect(
        todoListIdFromContextAttachments([{ type: 'todo_list', data: { id: 'a' } }])
      ).toBeUndefined()
    })
  })
})

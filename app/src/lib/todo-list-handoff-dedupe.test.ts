import { beforeEach, describe, expect, it } from 'vitest'

import { claimTodoListHandoff, releaseTodoListHandoff, resetTodoListHandoffLocksForTests } from './todo-list-handoff-dedupe'

describe('todo-list-handoff-dedupe', function packageTests() {
  beforeEach(function resetLocks() {
    resetTodoListHandoffLocksForTests()
  })

  describe('#claimTodoListHandoff', function claimTests() {
    it('claims once and rejects duplicate id', function dedupes() {
      expect(claimTodoListHandoff('a')).toBe(true)
      expect(claimTodoListHandoff('a')).toBe(false)
    })

    it('allows different ids', function multipleIds() {
      expect(claimTodoListHandoff('x')).toBe(true)
      expect(claimTodoListHandoff('y')).toBe(true)
    })

    it('after release, id can be claimed again', function afterRelease() {
      expect(claimTodoListHandoff('retry')).toBe(true)
      releaseTodoListHandoff('retry')
      expect(claimTodoListHandoff('retry')).toBe(true)
    })
  })

  describe('#resetTodoListHandoffLocksForTests', function resetTests() {
    it('clears all claims', function clears() {
      expect(claimTodoListHandoff('a')).toBe(true)
      resetTodoListHandoffLocksForTests()
      expect(claimTodoListHandoff('a')).toBe(true)
    })
  })
})

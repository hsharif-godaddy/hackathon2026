import { describe, it, expect, beforeEach } from 'vitest'
import { TodoListRepository } from '../TodoListRepository.js'

describe('TodoListRepository.getCurrentIncompleteList', function getCurrentIncompleteListTests() {
  let repo: TodoListRepository

  beforeEach(function setup() {
    repo = new TodoListRepository()
  })

  it('returns null when no lists exist for the app', function noLists() {
    const result = repo.getCurrentIncompleteList('nonexistent-app')
    expect(result).toBeNull()
  })

  it('returns null when all lists are fully complete', function allComplete() {
    const list = repo.createList('Done List', 'app-complete', 'desc', [
      { title: 'Task 1', completed: true },
      { title: 'Task 2', completed: true },
    ])
    expect(list.items).toHaveLength(2)

    const result = repo.getCurrentIncompleteList('app-complete')
    expect(result).toBeNull()
  })

  it('returns the incomplete list when one exists', function returnsIncomplete() {
    repo.createList('Complete List', 'app-mixed', undefined, [
      { title: 'Done', completed: true },
    ])
    const incomplete = repo.createList('WIP List', 'app-mixed', undefined, [
      { title: 'Pending', completed: false },
    ])

    const result = repo.getCurrentIncompleteList('app-mixed')
    expect(result).not.toBeNull()
    expect(result!.id).toBe(incomplete.id)
    expect(result!.items).toHaveLength(1)
    expect(result!.items![0].completed).toBe(false)
  })

  it('returns the most recently updated incomplete list', function mostRecent() {
    const older = repo.createList('Older', 'app-multi', undefined, [
      { title: 'Old task', completed: false },
    ])
    const newer = repo.createList('Newer', 'app-multi', undefined, [
      { title: 'New task', completed: false },
    ])
    // Touch the older list to make it most recent
    repo.updateListTimestamp(older.id)

    const result = repo.getCurrentIncompleteList('app-multi')
    expect(result).not.toBeNull()
    expect(result!.id).toBe(older.id)
  })

  it('does not return lists from a different app (tenant isolation)', function tenantIsolation() {
    repo.createList('Other App List', 'app-other', undefined, [
      { title: 'Task', completed: false },
    ])

    const result = repo.getCurrentIncompleteList('app-mine')
    expect(result).toBeNull()
  })

  it('does not return stale lists (>24h old)', function staleList() {
    const list = repo.createList('Stale List', 'app-stale', undefined, [
      { title: 'Abandoned', completed: false },
    ])
    // Manually backdate the updated_at to 25 hours ago
    const db = (repo as any).db
    db.prepare(
      `UPDATE todo_lists SET updated_at = datetime('now', '-25 hours') WHERE id = ?`
    ).run(list.id)

    const result = repo.getCurrentIncompleteList('app-stale')
    expect(result).toBeNull()
  })

  it('returns a fresh list even when a stale list exists', function freshOverStale() {
    const stale = repo.createList('Stale', 'app-freshstale', undefined, [
      { title: 'Old', completed: false },
    ])
    const fresh = repo.createList('Fresh', 'app-freshstale', undefined, [
      { title: 'New', completed: false },
    ])
    // Backdate the stale list
    const db = (repo as any).db
    db.prepare(
      `UPDATE todo_lists SET updated_at = datetime('now', '-25 hours') WHERE id = ?`
    ).run(stale.id)

    const result = repo.getCurrentIncompleteList('app-freshstale')
    expect(result).not.toBeNull()
    expect(result!.id).toBe(fresh.id)
  })
})

import { randomUUID } from 'node:crypto'

import { describe, it, expect } from 'vitest'

import { todoListTool } from '../todo-list-tool.js'

function testAppId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

describe('todo-list-tool', function todoListToolTests() {
  describe('#execute', function executeTests() {
    it('should create a new todo list', async function createList() {
      const result = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Test Project',
        listDescription: 'A test todo list',
        appId: testAppId('create')
      })

      expect(result.success).toBe(true)
      expect(result.list).toBeDefined()
      expect(result.list?.name).toBe('Test Project')
      expect(result.list?.description).toBe('A test todo list')
      expect(result.list?.appId).toMatch(/^create-/)
    })

    it('should reject create_list when another list has open items', async function guardOpenList() {
      const appId = testAppId('guard-open')

      const first = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Roadmap',
        appId,
        items: [{ title: 'Homepage' }, { title: 'About' }],
      })

      const homepageId = first.list?.items?.[0].id
      await todoListTool.execute({
        operation: 'mark_done',
        itemIds: [homepageId!],
      })

      const blocked = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Homepage Build',
        appId,
        items: [{ title: 'Hero section' }],
      })

      expect(blocked.success).toBe(false)
      expect(blocked.error).toContain('Cannot create_list')
      expect(blocked.error).toContain('Roadmap')
    })

    it('should allow create_list when every existing list is complete', async function guardAllComplete() {
      const appId = testAppId('guard-done')

      const first = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Phase One',
        appId,
        items: [{ title: 'Only task' }],
      })

      const itemId = first.list?.items?.[0].id
      expect(itemId).toBeDefined()
      await todoListTool.execute({
        operation: 'mark_done',
        itemIds: [itemId as string],
      })

      const second = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Phase Two',
        appId,
        items: [{ title: 'Next task' }],
      })

      expect(second.success).toBe(true)
      expect(second.list?.name).toBe('Phase Two')
    })

    it('should add items to a todo list', async function addItems() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Feature Implementation',
        appId: testAppId('add-items')
      })

      expect(createResult.success).toBe(true)
      const listId = createResult.list?.id

      const addResult = await todoListTool.execute({
        operation: 'add_items',
        listId,
        items: [
          {
            title: 'Create database schema',
            description: 'Design and implement the database tables'
          }
        ]
      })

      expect(addResult.success).toBe(true)
      expect(addResult.items).toBeDefined()
      expect(addResult.items?.[0].title).toBe('Create database schema')
      expect(addResult.items?.[0].completed).toBe(false)
    })

    it('should mark items as done', async function markDone() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Tasks',
        appId: testAppId('mark-done'),
        items: [{ title: 'Complete task' }]
      })

      const itemId = createResult.list?.items?.[0].id

      const markResult = await todoListTool.execute({
        operation: 'mark_done',
        itemIds: [itemId!]
      })

      expect(markResult.success).toBe(true)
      expect(markResult.items?.[0].completed).toBe(true)
      expect(markResult.items?.[0].inProgress).toBe(false)
    })

    it('should mark items as in progress', async function markInProgress() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Tasks In Progress',
        appId: testAppId('mark-in-progress'),
        items: [{ title: 'Start task' }]
      })

      const itemId = createResult.list?.items?.[0].id

      const markResult = await todoListTool.execute({
        operation: 'mark_in_progress',
        itemIds: [itemId!]
      })

      expect(markResult.success).toBe(true)
      expect(markResult.items?.[0].inProgress).toBe(true)
      expect(markResult.items?.[0].completed).toBe(false)
    })

    it('should return error when mark_in_progress references missing item', async function markInProgressMissing() {
      const result = await todoListTool.execute({
        operation: 'mark_in_progress',
        itemIds: ['missing-item-id']
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should mark_in_progress valid ids when batch includes missing ids', async function markInProgressPartial() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Partial In Progress',
        appId: testAppId('partial-in-progress'),
        items: [{ title: 'Task A' }]
      })

      const itemId = createResult.list?.items?.[0].id

      const markResult = await todoListTool.execute({
        operation: 'mark_in_progress',
        itemIds: [itemId!, 'missing-item-id']
      })

      expect(markResult.success).toBe(true)
      expect(markResult.items?.[0].inProgress).toBe(true)
      expect(markResult.message).toContain('not found')
    })

    it('should batch mark_done without prior mark_in_progress', async function mergeMarkBatch() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Merge Mark Batch',
        appId: testAppId('merge-batch'),
        items: [{ title: 'Task A' }, { title: 'Task B' }]
      })

      const ids = createResult.list?.items?.map((item) => item.id) ?? []

      const markResult = await todoListTool.execute({
        operation: 'mark_done',
        itemIds: ids
      })

      expect(markResult.success).toBe(true)
      expect(markResult.items?.every((item) => item.completed)).toBe(true)
      expect(markResult.items?.every((item) => !item.inProgress)).toBe(true)
    })

    it('should return error when mark_done references missing item', async function mergeMarkMissing() {
      const result = await todoListTool.execute({
        operation: 'mark_done',
        itemIds: ['missing-item-id']
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should mark_done valid ids when batch includes missing ids', async function mergeMarkPartial() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Partial Mark',
        appId: testAppId('partial-mark'),
        items: [{ title: 'Task A' }]
      })

      const itemId = createResult.list?.items?.[0].id

      const markResult = await todoListTool.execute({
        operation: 'mark_done',
        itemIds: [itemId!, 'missing-item-id']
      })

      expect(markResult.success).toBe(true)
      expect(markResult.items?.[0].completed).toBe(true)
      expect(markResult.message).toContain('not found')
    })

    it('should list all todo lists', async function listAll() {
      const appId = testAppId('list-all')

      const first = await todoListTool.execute({
        operation: 'create_list',
        listName: 'List 1',
        appId,
        items: [{ title: 'Only task' }],
      })

      const itemId = first.list?.items?.[0].id
      expect(itemId).toBeDefined()
      await todoListTool.execute({
        operation: 'mark_done',
        itemIds: [itemId as string],
      })

      await todoListTool.execute({
        operation: 'create_list',
        listName: 'List 2',
        appId,
      })

      const result = await todoListTool.execute({
        operation: 'list_all',
        appId,
      })

      expect(result.success).toBe(true)
      expect(result.lists).toBeDefined()
      expect(result.lists!.length).toBeGreaterThanOrEqual(2)
    })

    it('should get a specific list with items', async function getList() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Project Tasks',
        appId: testAppId('get-list'),
        items: [
          { title: 'Task 1' },
          { title: 'Task 2' }
        ]
      })

      const listId = createResult.list?.id

      const getResult = await todoListTool.execute({
        operation: 'get_list',
        listId
      })

      expect(getResult.success).toBe(true)
      expect(getResult.list).toBeDefined()
      expect(getResult.list?.items?.length).toBe(2)
    })

    it('should update todo items', async function updateItem() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Updates',
        appId: testAppId('update'),
        items: [{ title: 'Original title' }]
      })

      const itemId = createResult.list?.items?.[0].id

      const updateResult = await todoListTool.execute({
        operation: 'update_items',
        updates: [{
          itemId: itemId!,
          title: 'Updated title',
          description: 'New description'
        }]
      })

      expect(updateResult.success).toBe(true)
      expect(updateResult.items?.[0].title).toBe('Updated title')
      expect(updateResult.items?.[0].description).toBe('New description')
    })

    it('should delete todo items', async function deleteItem() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Deletions',
        appId: testAppId('delete-item'),
        items: [{ title: 'To be deleted' }]
      })

      const listId = createResult.list?.id
      const itemId = createResult.list?.items?.[0].id

      const deleteResult = await todoListTool.execute({
        operation: 'delete_items',
        itemIds: [itemId!]
      })

      expect(deleteResult.success).toBe(true)

      const getResult = await todoListTool.execute({
        operation: 'get_list',
        listId
      })

      expect(getResult.list?.items?.length).toBe(0)
    })

    it('should delete todo lists', async function deleteList() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'To Delete',
        appId: testAppId('delete-list')
      })

      const listId = createResult.list?.id

      const deleteResult = await todoListTool.execute({
        operation: 'delete_list',
        listId
      })

      expect(deleteResult.success).toBe(true)

      const getResult = await todoListTool.execute({
        operation: 'get_list',
        listId
      })

      expect(getResult.success).toBe(false)
    })

    it('should create a list with items in one operation', async function createWithItems() {
      const result = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Full Project',
        listDescription: 'Project with predefined tasks',
        appId: testAppId('create-with-items'),
        items: [
          { title: 'Design schema', description: 'Create database tables' },
          { title: 'Build API', completed: false },
          { title: 'Create UI', description: 'Build frontend components', order: 3 }
        ]
      })

      expect(result.success).toBe(true)
      expect(result.list).toBeDefined()
      expect(result.list?.items?.length).toBe(3)
      expect(result.list?.items?.[0].title).toBe('Design schema')
      expect(result.list?.items?.[1].title).toBe('Build API')
      expect(result.list?.items?.[2].title).toBe('Create UI')
    })

    it('should mark multiple items as done', async function markManyDone() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Batch Tasks',
        appId: testAppId('mark-many-done'),
        items: [
          { title: 'Task 1' },
          { title: 'Task 2' },
          { title: 'Task 3' }
        ]
      })

      const itemIds = createResult.list?.items?.map(item => item.id) || []

      const markResult = await todoListTool.execute({
        operation: 'mark_done',
        itemIds: [itemIds[0], itemIds[2]]
      })

      expect(markResult.success).toBe(true)
      expect(markResult.items?.length).toBe(2)
      expect(markResult.items?.[0].completed).toBe(true)
      expect(markResult.items?.[1].completed).toBe(true)

      const getResult = await todoListTool.execute({
        operation: 'get_list',
        listId: createResult.list?.id
      })

      const completedCount = getResult.list?.items?.filter(item => item.completed).length
      expect(completedCount).toBe(2)
    })

    it('should mark multiple items as undone', async function markManyUndone() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Reset Tasks',
        appId: testAppId('mark-many-undone'),
        items: [
          { title: 'Task 1', completed: true },
          { title: 'Task 2', completed: true },
          { title: 'Task 3', completed: true }
        ]
      })

      const itemIds = createResult.list?.items?.map(item => item.id) || []

      const markResult = await todoListTool.execute({
        operation: 'mark_undone',
        itemIds: [itemIds[0], itemIds[1]]
      })

      expect(markResult.success).toBe(true)
      expect(markResult.items?.length).toBe(2)
      expect(markResult.items?.[0].completed).toBe(false)
      expect(markResult.items?.[1].completed).toBe(false)

      const getResult = await todoListTool.execute({
        operation: 'get_list',
        listId: createResult.list?.id
      })

      const pendingCount = getResult.list?.items?.filter(item => !item.completed).length
      expect(pendingCount).toBe(2)
    })
  })
})

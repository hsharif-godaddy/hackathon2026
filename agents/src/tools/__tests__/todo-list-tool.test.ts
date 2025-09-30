import { describe, it, expect } from 'vitest'
import { todoListTool } from '../todo-list-tool.js'

describe('todo-list-tool', function todoListToolTests() {
  describe('#execute', function executeTests() {
    it('should create a new todo list', async function createList() {
      const result = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Test Project',
        listDescription: 'A test todo list',
        appId: 'test-app-1'
      })

      expect(result.success).toBe(true)
      expect(result.list).toBeDefined()
      expect(result.list?.name).toBe('Test Project')
      expect(result.list?.description).toBe('A test todo list')
      expect(result.list?.appId).toBe('test-app-1')
    })

    it('should add items to a todo list', async function addItems() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Feature Implementation',
        appId: 'test-app-2'
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
        appId: 'test-app-3',
        items: [{ title: 'Complete task' }]
      })

      const itemId = createResult.list?.items?.[0].id

      const markResult = await todoListTool.execute({
        operation: 'mark_done',
        itemIds: [itemId!]
      })

      expect(markResult.success).toBe(true)
      expect(markResult.items?.[0].completed).toBe(true)
    })

    it('should list all todo lists', async function listAll() {
      await todoListTool.execute({
        operation: 'create_list',
        listName: 'List 1',
        appId: 'test-app-4'
      })

      await todoListTool.execute({
        operation: 'create_list',
        listName: 'List 2',
        appId: 'test-app-4'
      })

      const result = await todoListTool.execute({
        operation: 'list_all',
        appId: 'test-app-4'
      })

      expect(result.success).toBe(true)
      expect(result.lists).toBeDefined()
      expect(result.lists!.length).toBeGreaterThanOrEqual(2)
    })

    it('should get a specific list with items', async function getList() {
      const createResult = await todoListTool.execute({
        operation: 'create_list',
        listName: 'Project Tasks',
        appId: 'test-app-5',
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
        appId: 'test-app-6',
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
        appId: 'test-app-7',
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
        appId: 'test-app-8'
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
        appId: 'test-app-9',
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
        appId: 'test-app-10',
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
        appId: 'test-app-11',
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

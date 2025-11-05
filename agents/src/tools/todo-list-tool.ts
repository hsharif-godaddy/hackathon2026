/**
 * Todo List Tool
 * 
 * A comprehensive planning tool that allows creating and managing todo lists with SQLite storage.
 * Supports multiple lists, marking items as done, updating items, and full CRUD operations.
 */

import { TodoListRepository } from '../database/repositories/TodoListRepository.js'
import type { TodoItem, TodoList, CreateItemInput } from '../database/repositories/TodoListRepository.js'

export type { TodoItem, TodoList, CreateItemInput }
export { TodoListRepository }

export interface TodoListToolOptions {
  operation: 'create_list' | 'get_list' | 'list_all' | 'delete_list' | 'add_items' | 'update_items' | 'delete_items' | 'mark_done' | 'mark_undone' | 'show_list' | 'select_list'
  appId?: string
  listId?: string
  listName?: string
  listDescription?: string
  items?: CreateItemInput[]
  itemIds?: string[]
  updates?: Array<{ itemId: string; title?: string; description?: string; order?: number }>
  sessionId?: string
}

export interface TodoListToolResult {
  success: boolean
  message?: string
  error?: string
  list?: TodoList
  lists?: TodoList[]
  item?: TodoItem
  items?: TodoItem[]
}

/**
 * Callback for when a todo list is selected
 */
export type TodoListSelectCallback = (sessionId: string, listId: string) => void

/**
 * Todo List Tool
 */
class TodoListTool {
  private repository: TodoListRepository
  private onSelectCallback?: TodoListSelectCallback

  constructor() {
    this.repository = new TodoListRepository()
  }

  /**
   * Set callback for when a todo list is selected
   */
  setOnSelectCallback(callback: TodoListSelectCallback): void {
    this.onSelectCallback = callback
  }

  /**
   * Execute todo list operations
   */
  async execute(options: TodoListToolOptions): Promise<TodoListToolResult> {
    try {
      switch (options.operation) {
        case 'create_list':
          return this.createList(options)
        case 'get_list':
          return this.getList(options)
        case 'show_list':
          return this.showList(options)
        case 'list_all':
          return this.listAll(options)
        case 'delete_list':
          return this.deleteList(options)
        case 'add_items':
          return this.addItems(options)
        case 'update_items':
          return this.updateItems(options)
        case 'delete_items':
          return this.deleteItems(options)
        case 'mark_done':
          return this.markDone(options)
        case 'mark_undone':
          return this.markUndone(options)
        case 'select_list':
          return this.selectList(options)
        default:
          return {
            success: false,
            error: `Unknown operation: ${options.operation}`
          }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Create a new todo list
   */
  private createList(options: TodoListToolOptions): TodoListToolResult {
    if (!options.listName) {
      return {
        success: false,
        error: 'List name is required'
      }
    }

    const list = this.repository.createList(
      options.listName,
      options.appId,
      options.listDescription,
      options.items
    )

    // Auto-select the newly created list
    if (options.sessionId && this.onSelectCallback) {
      this.onSelectCallback(options.sessionId, list.id)
    }

    const itemCount = options.items?.length || 0
    const message = itemCount > 0
      ? `Created todo list: ${options.listName} with ${itemCount} item${itemCount === 1 ? '' : 's'} (now selected)`
      : `Created todo list: ${options.listName} (now selected)`

    return {
      success: true,
      message,
      list
    }
  }

  /**
   * Get a specific todo list with its items
   */
  private getList(options: TodoListToolOptions): TodoListToolResult {
    if (!options.listId) {
      return {
        success: false,
        error: 'List ID is required'
      }
    }

    const list = this.repository.getListById(options.listId)
    
    if (!list) {
      return {
        success: false,
        error: `List not found: ${options.listId}`
      }
    }

    return {
      success: true,
      list
    }
  }

  /**
   * Show a todo list with formatted display (for showing completed work)
   * Similar to get_list but with a message indicating it's being displayed
   */
  private showList(options: TodoListToolOptions): TodoListToolResult {
    if (!options.listId) {
      return {
        success: false,
        error: 'List ID is required'
      }
    }

    const list = this.repository.getListById(options.listId)
    
    if (!list) {
      return {
        success: false,
        error: `List not found: ${options.listId}`
      }
    }

    const totalItems = list.items?.length || 0
    const completedItems = list.items?.filter(item => item.completed).length || 0
    const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0

    return {
      success: true,
      message: `Showing todo list: ${list.name} (${completedItems}/${totalItems} complete - ${progress}%)`,
      list
    }
  }

  /**
   * List all todo lists
   */
  private listAll(options: TodoListToolOptions): TodoListToolResult {
    const lists = this.repository.getAllLists(options.appId)

    return {
      success: true,
      lists
    }
  }

  /**
   * Delete a todo list
   */
  private deleteList(options: TodoListToolOptions): TodoListToolResult {
    if (!options.listId) {
      return {
        success: false,
        error: 'List ID is required'
      }
    }

    const deleted = this.repository.deleteList(options.listId)

    if (!deleted) {
      return {
        success: false,
        error: `List not found: ${options.listId}`
      }
    }

    return {
      success: true,
      message: `Deleted todo list: ${options.listId}`
    }
  }

  /**
   * Add items to a todo list (batch operation)
   */
  private addItems(options: TodoListToolOptions): TodoListToolResult {
    if (!options.listId || !options.items || options.items.length === 0) {
      return {
        success: false,
        error: 'List ID and at least one item are required'
      }
    }

    const addedItems: TodoItem[] = []
    
    for (const itemInput of options.items) {
      const item = this.repository.addItem(
        options.listId,
        itemInput.title,
        itemInput.description,
        itemInput.order,
        itemInput.completed
      )
      addedItems.push(item)
    }

    return {
      success: true,
      message: `Added ${addedItems.length} item${addedItems.length === 1 ? '' : 's'}`,
      items: addedItems
    }
  }

  /**
   * Update items (batch operation)
   */
  private updateItems(options: TodoListToolOptions): TodoListToolResult {
    if (!options.updates || options.updates.length === 0) {
      return {
        success: false,
        error: 'At least one update is required'
      }
    }

    const updatedItems: TodoItem[] = []

    for (const update of options.updates) {
      const itemUpdates: { title?: string; description?: string; order?: number } = {}

      if (update.title !== undefined) {
        itemUpdates.title = update.title
      }

      if (update.description !== undefined) {
        itemUpdates.description = update.description
      }

      if (update.order !== undefined) {
        itemUpdates.order = update.order
      }

      if (Object.keys(itemUpdates).length > 0) {
        const item = this.repository.updateItem(update.itemId, itemUpdates)
        updatedItems.push(item)
      }
    }

    return {
      success: true,
      message: `Updated ${updatedItems.length} item${updatedItems.length === 1 ? '' : 's'}`,
      items: updatedItems
    }
  }

  /**
   * Delete items (batch operation)
   */
  private deleteItems(options: TodoListToolOptions): TodoListToolResult {
    if (!options.itemIds || options.itemIds.length === 0) {
      return {
        success: false,
        error: 'At least one item ID is required'
      }
    }

    let deletedCount = 0

    for (const itemId of options.itemIds) {
      if (this.repository.deleteItem(itemId)) {
        deletedCount++
      }
    }

    return {
      success: true,
      message: `Deleted ${deletedCount} item${deletedCount === 1 ? '' : 's'}`
    }
  }

  /**
   * Mark items as done (batch operation, works for single or multiple)
   */
  private markDone(options: TodoListToolOptions): TodoListToolResult {
    if (!options.itemIds || options.itemIds.length === 0) {
      return {
        success: false,
        error: 'At least one item ID is required'
      }
    }

    const items = this.repository.markItemsCompleted(options.itemIds, true)

    return {
      success: true,
      message: `Marked ${items.length} item${items.length === 1 ? '' : 's'} as done`,
      items
    }
  }

  /**
   * Mark items as not done (batch operation, works for single or multiple)
   */
  private markUndone(options: TodoListToolOptions): TodoListToolResult {
    if (!options.itemIds || options.itemIds.length === 0) {
      return {
        success: false,
        error: 'At least one item ID is required'
      }
    }

    const items = this.repository.markItemsCompleted(options.itemIds, false)

    return {
      success: true,
      message: `Marked ${items.length} item${items.length === 1 ? '' : 's'} as not done`,
      items
    }
  }

  /**
   * Select a todo list for the current session
   */
  private selectList(options: TodoListToolOptions): TodoListToolResult {
    if (!options.listId) {
      return {
        success: false,
        error: 'List ID is required'
      }
    }

    if (!options.sessionId) {
      return {
        success: false,
        error: 'Session ID is required to select a list'
      }
    }

    // Verify the list exists
    const list = this.repository.getListById(options.listId)
    if (!list) {
      return {
        success: false,
        error: `List not found: ${options.listId}`
      }
    }

    // Call the selection callback
    if (this.onSelectCallback) {
      this.onSelectCallback(options.sessionId, options.listId)
    }

    return {
      success: true,
      message: `Selected todo list: ${list.name}`,
      list
    }
  }
}

// Export singleton instance
export const todoListTool = new TodoListTool()
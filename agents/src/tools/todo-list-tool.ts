/**
 * Todo List Tool
 * 
 * A comprehensive planning tool that allows creating and managing todo lists with SQLite storage.
 * Supports multiple lists, marking items as done, updating items, and full CRUD operations.
 */

import type { TodoItem, TodoList, CreateItemInput } from '../database/repositories/TodoListRepository.js'
import { getTodoListStore } from '../planning/adapters/index.js'
import type { TodoListStore } from '../planning/interfaces/index.js'
import { workspaceScopeFromAppId } from '../memory/interfaces/scope.js'
import { logger } from '../logging/index.js'

export type { TodoItem, TodoList, CreateItemInput }

export interface TodoListToolOptions {
  operation: 'create_list' | 'get_list' | 'list_all' | 'delete_list' | 'add_items' | 'update_items' | 'delete_items' | 'mark_done' | 'mark_in_progress' | 'mark_undone' | 'show_list' | 'select_list'
  appId?: string
  listId?: string
  listName?: string
  listDescription?: string
  items?: CreateItemInput[]
  itemIds?: string[]
  updates?: Array<{ itemId: string; title?: string; description?: string; order?: number }>
  sessionId?: string
  /** Tenant customerId threaded from auth context for scope resolution */
  customerId?: string
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

/** Returns pages with unresolved SEO gaps for the given appId. */
export type SeoGapsChecker = (appId: string) => Array<{ filePath: string; missing: string[] }>

/**
 * Todo List Tool
 */
class TodoListTool {
  private onSelectCallback?: TodoListSelectCallback
  private seoGapsChecker?: SeoGapsChecker

  constructor(private store: TodoListStore = getTodoListStore()) {}

  setSeoGapsChecker(checker: SeoGapsChecker): void {
    this.seoGapsChecker = checker
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
          return await this.createList(options)
        case 'get_list':
          return await this.getList(options)
        case 'show_list':
          return await this.showList(options)
        case 'list_all':
          return await this.listAll(options)
        case 'delete_list':
          return await this.deleteList(options)
        case 'add_items':
          return await this.addItems(options)
        case 'update_items':
          return await this.updateItems(options)
        case 'delete_items':
          return await this.deleteItems(options)
        case 'mark_done':
          return await this.markDone(options)
        case 'mark_in_progress':
          return await this.markInProgress(options)
        case 'mark_undone':
          return await this.markUndone(options)
        case 'select_list':
          return await this.selectList(options)
        default:
          return {
            success: false,
            error: `Unknown operation: ${options.operation}`
          }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('todo_list.execute.failure', {
        operation: options.operation,
        appId: options.appId,
        listId: options.listId,
        error: message,
      })
      return {
        success: false,
        error: message,
      }
    }
  }

  /**
   * Create a new todo list
   */
  private async createList(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.listName) {
      return {
        success: false,
        error: 'List name is required'
      }
    }

    // Guard the scope boundary: an empty appId would produce a list that every
    // app-scoped getAllLists query filters out and may collide with other
    // empty-string-scoped data.
    if (!options.appId) {
      return {
        success: false,
        error: 'appId is required'
      }
    }

    const openListGuard = await this.openListCreateGuard(
      workspaceScopeFromAppId(options.appId, options.customerId),
    )
    if (openListGuard) {
      return openListGuard
    }

    const list = await this.store.createList(
      workspaceScopeFromAppId(options.appId, options.customerId),
      options.listName,
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
  private async getList(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.listId) {
      return {
        success: false,
        error: 'List ID is required'
      }
    }

    const list = await this.store.getListById(options.listId)

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
  private async showList(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.listId) {
      return {
        success: false,
        error: 'List ID is required'
      }
    }

    const list = await this.store.getListById(options.listId)
    
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
  private async listAll(options: TodoListToolOptions): Promise<TodoListToolResult> {
    // Same scope-boundary guard as createList — see the comment there.
    if (!options.appId) {
      return {
        success: false,
        error: 'appId is required'
      }
    }

    const lists = await this.store.getAllLists(workspaceScopeFromAppId(options.appId, options.customerId))

    return {
      success: true,
      lists
    }
  }

  /**
   * Delete a todo list
   */
  private async deleteList(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.listId) {
      return {
        success: false,
        error: 'List ID is required'
      }
    }

    const deleted = await this.store.deleteList(options.listId)

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
  private async addItems(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.listId || !options.items || options.items.length === 0) {
      return {
        success: false,
        error: 'List ID and at least one item are required'
      }
    }

    const addedItems: TodoItem[] = []
    const failures: string[] = []

    for (const itemInput of options.items) {
      try {
        const item = await this.store.addItem(
          options.listId,
          itemInput.title,
          itemInput.description,
          itemInput.order,
          itemInput.completed
        )
        addedItems.push(item)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failures.push(`Failed to add "${itemInput.title}": ${msg}`)
        logger.warn('todo_list.addItems.item_failed', {
          listId: options.listId,
          title: itemInput.title,
          error: msg,
        })
      }
    }

    if (addedItems.length === 0) {
      return {
        success: false,
        error: `All ${failures.length} item(s) failed: ${failures.join('; ')}`,
      }
    }

    const message = failures.length > 0
      ? `Added ${addedItems.length} item${addedItems.length === 1 ? '' : 's'}, ${failures.length} failed: ${failures.join('; ')}`
      : `Added ${addedItems.length} item${addedItems.length === 1 ? '' : 's'}`

    return {
      success: true,
      message,
      items: addedItems,
    }
  }

  /**
   * Update items (batch operation)
   */
  private async updateItems(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.updates || options.updates.length === 0) {
      return {
        success: false,
        error: 'At least one update is required'
      }
    }

    const updatedItems: TodoItem[] = []
    const failures: string[] = []

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
        try {
          const item = await this.store.updateItem(update.itemId, itemUpdates)
          updatedItems.push(item)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          failures.push(`Failed to update item ${update.itemId}: ${msg}`)
          logger.warn('todo_list.updateItems.item_failed', {
            itemId: update.itemId,
            error: msg,
          })
        }
      }
    }

    if (updatedItems.length === 0 && failures.length > 0) {
      return {
        success: false,
        error: `All ${failures.length} update(s) failed: ${failures.join('; ')}`,
      }
    }

    const message = failures.length > 0
      ? `Updated ${updatedItems.length} item${updatedItems.length === 1 ? '' : 's'}, ${failures.length} failed: ${failures.join('; ')}`
      : `Updated ${updatedItems.length} item${updatedItems.length === 1 ? '' : 's'}`

    return {
      success: true,
      message,
      items: updatedItems,
    }
  }

  /**
   * Delete items (batch operation)
   */
  private async deleteItems(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.itemIds || options.itemIds.length === 0) {
      return {
        success: false,
        error: 'At least one item ID is required'
      }
    }

    let deletedCount = 0
    const failures: string[] = []

    for (const itemId of options.itemIds) {
      try {
        if (await this.store.deleteItem(itemId)) {
          deletedCount++
        } else {
          failures.push(`Item ${itemId} not found`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failures.push(`Failed to delete item ${itemId}: ${msg}`)
        logger.warn('todo_list.deleteItems.item_failed', {
          itemId,
          error: msg,
        })
      }
    }

    if (deletedCount === 0 && failures.length > 0) {
      return {
        success: false,
        error: `All ${failures.length} deletion(s) failed: ${failures.join('; ')}`,
      }
    }

    const message = failures.length > 0
      ? `Deleted ${deletedCount} item${deletedCount === 1 ? '' : 's'}, ${failures.length} failed: ${failures.join('; ')}`
      : `Deleted ${deletedCount} item${deletedCount === 1 ? '' : 's'}`

    return {
      success: true,
      message,
    }
  }

  /**
   * Mark items as done (batch operation, works for single or multiple).
   */
  private async markDone(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.itemIds || options.itemIds.length === 0) {
      return {
        success: false,
        error: 'At least one item ID is required'
      }
    }

    if (this.seoGapsChecker && options.appId) {
      const gaps = this.seoGapsChecker(options.appId)
      if (gaps.length > 0) {
        const summary = gaps
          .map(({ filePath, missing }) => `${filePath}: missing ${missing.join(', ')}`)
          .join('; ')
        logger.warn('seo.markdone.blocked', { appId: options.appId, gapCount: gaps.length, summary })
        return {
          success: false,
          error: `SEO incomplete on ${gaps.length} page(s) — fix before marking done: ${summary}`,
        }
      }
    }

    const foundIds: string[] = []
    const missingIds: string[] = []
    for (const itemId of options.itemIds) {
      const item = await this.store.getItemById(itemId)
      if (!item) {
        missingIds.push(itemId)
        continue
      }
      foundIds.push(itemId)
    }

    if (foundIds.length === 0) {
      return {
        success: false,
        error: `Item(s) not found: ${missingIds.join(', ')}`
      }
    }

    const items = await this.store.markItemsCompleted(foundIds, true)

    let message = `Marked ${items.length} item${items.length === 1 ? '' : 's'} as done`
    if (missingIds.length > 0) {
      message += `; ${missingIds.length} not found: ${missingIds.join(', ')}`
    }

    return {
      success: true,
      message,
      items
    }
  }

  /**
   * Mark items as in progress (batch operation, works for single or multiple)
   */
  private async markInProgress(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.itemIds || options.itemIds.length === 0) {
      return {
        success: false,
        error: 'At least one item ID is required'
      }
    }

    const foundIds: string[] = []
    const missingIds: string[] = []
    for (const itemId of options.itemIds) {
      const item = await this.store.getItemById(itemId)
      if (!item) {
        missingIds.push(itemId)
        continue
      }
      foundIds.push(itemId)
    }

    if (foundIds.length === 0) {
      return {
        success: false,
        error: `Item(s) not found: ${missingIds.join(', ')}`
      }
    }

    const items = await this.store.markItemsInProgress(foundIds, true)

    let message = `Marked ${items.length} item${items.length === 1 ? '' : 's'} as in progress`
    if (missingIds.length > 0) {
      message += `; ${missingIds.length} not found: ${missingIds.join(', ')}`
    }

    return {
      success: true,
      message,
      items
    }
  }

  /**
   * Mark items as not done (batch operation, works for single or multiple)
   */
  private async markUndone(options: TodoListToolOptions): Promise<TodoListToolResult> {
    if (!options.itemIds || options.itemIds.length === 0) {
      return {
        success: false,
        error: 'At least one item ID is required'
      }
    }

    const items = await this.store.markItemsCompleted(options.itemIds, false)

    return {
      success: true,
      message: `Marked ${items.length} item${items.length === 1 ? '' : 's'} as not done`,
      items
    }
  }

  /**
   * Blocks create_list while any existing list still has incomplete items.
   */
  private async openListCreateGuard(
    scope: ReturnType<typeof workspaceScopeFromAppId>,
  ): Promise<TodoListToolResult | null> {
    const existingLists = await this.store.getAllLists(scope)
    const blockers: Array<{ name: string; openCount: number; openIds: string[] }> = []

    for (const existing of existingLists) {
      const openItems = existing.items?.filter((item) => !item.completed) ?? []
      if (openItems.length > 0) {
        blockers.push({
          name: existing.name,
          openCount: openItems.length,
          openIds: openItems.map((item) => item.id),
        })
      }
    }

    if (blockers.length === 0) {
      return null
    }

    const summary = blockers
      .map((b) => `"${b.name}" (${b.openCount} open)`)
      .join(', ')
    const sampleIds = blockers.flatMap((b) => b.openIds).slice(0, 8).join(', ')

    logger.warn('todo_list.create_list.blocked_open_items', {
      scope,
      blockers: blockers.map((b) => ({ name: b.name, openCount: b.openCount })),
    })

    return {
      success: false,
      error:
        `Cannot create_list while other lists have open items: ${summary}. ` +
        `mark_done every open item on the current list first` +
        (sampleIds ? ` (e.g. ${sampleIds})` : '') +
        ', or use add_items on that list instead of a nested create_list.',
    }
  }

  /**
   * Select a todo list for the current session
   */
  private async selectList(options: TodoListToolOptions): Promise<TodoListToolResult> {
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
    const list = await this.store.getListById(options.listId)
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
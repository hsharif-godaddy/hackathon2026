import { getDatabase } from '../connection.js'
import type { Database } from 'better-sqlite3'

/**
 * Todo item interface
 */
export interface TodoItem {
  id: string
  listId: string
  title: string
  description?: string
  completed: boolean
  inProgress: boolean
  order: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Input for creating a new item
 */
export interface CreateItemInput {
  title: string
  description?: string
  completed?: boolean
  order?: number
}

/**
 * Todo list interface
 */
export interface TodoList {
  id: string
  appId?: string
  name: string
  description?: string
  createdAt: Date
  updatedAt: Date
  items?: TodoItem[]
}

/**
 * Repository for managing todo lists and items
 */
export class TodoListRepository {
  private db: Database

  constructor() {
    this.db = getDatabase()
    this.initializeSchema()
  }

  /**
   * Initialize todo list schema in the database
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS todo_lists (
        id TEXT PRIMARY KEY,
        app_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS todo_items (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        completed INTEGER DEFAULT 0,
        in_progress INTEGER DEFAULT 0,
        item_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE CASCADE
      )
    `)

    try {
      this.db.exec('ALTER TABLE todo_items ADD COLUMN in_progress INTEGER DEFAULT 0')
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('duplicate column name')) {
        throw error
      }
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_todo_lists_app_id ON todo_lists(app_id);
      CREATE INDEX IF NOT EXISTS idx_todo_items_list_id ON todo_items(list_id);
      CREATE INDEX IF NOT EXISTS idx_todo_items_completed ON todo_items(completed);
      CREATE INDEX IF NOT EXISTS idx_todo_items_in_progress ON todo_items(in_progress);
    `)
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Create a new todo list
   */
  createList(name: string, appId?: string, description?: string, items?: CreateItemInput[]): TodoList {
    const id = this.generateId()
    const stmt = this.db.prepare(`
      INSERT INTO todo_lists (id, app_id, name, description)
      VALUES (?, ?, ?, ?)
    `)

    stmt.run(id, appId || null, name, description || null)

    // Add items if provided
    if (items && items.length > 0) {
      items.forEach((item, index) => {
        this.addItem(
          id,
          item.title,
          item.description,
          item.order !== undefined ? item.order : index + 1,
          item.completed
        )
      })
    }

    const list = this.getListById(id)
    if (!list) {
      throw new Error('Failed to create list')
    }

    return list
  }

  /**
   * Get a todo list by ID
   */
  getListById(listId: string): TodoList | null {
    const stmt = this.db.prepare(`
      SELECT id, app_id, name, description, created_at, updated_at
      FROM todo_lists
      WHERE id = ?
    `)

    const row = stmt.get(listId) as any

    if (!row) {
      return null
    }

    return {
      id: row.id,
      appId: row.app_id,
      name: row.name,
      description: row.description,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      items: this.getItemsByListId(row.id)
    }
  }

  /**
   * Get the most recently updated list for an app that has at least one incomplete item
   * and was updated within the last 24 hours. Returns null if all lists are fully complete,
   * no lists exist, or the only incomplete lists are stale (abandoned features).
   */
  getCurrentIncompleteList(appId: string): TodoList | null {
    const stmt = this.db.prepare(`
      SELECT tl.id, tl.app_id, tl.name, tl.description, tl.created_at, tl.updated_at
      FROM todo_lists tl
      WHERE tl.app_id = ?
        AND EXISTS (SELECT 1 FROM todo_items ti WHERE ti.list_id = tl.id AND ti.completed = 0)
        AND tl.updated_at >= datetime('now', '-24 hours')
      ORDER BY tl.updated_at DESC
      LIMIT 1
    `)

    const row = stmt.get(appId) as any
    if (!row) return null

    return {
      id: row.id,
      appId: row.app_id,
      name: row.name,
      description: row.description,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      items: this.getItemsByListId(row.id)
    }
  }

  /**
   * Get all todo lists, optionally filtered by appId
   */
  getAllLists(appId?: string): TodoList[] {
    const stmt = this.db.prepare(`
      SELECT id, app_id, name, description, created_at, updated_at
      FROM todo_lists
      ${appId ? 'WHERE app_id = ?' : ''}
      ORDER BY created_at DESC
    `)

    const rows = appId ? stmt.all(appId) : stmt.all()

    return (rows as any[]).map(row => ({
      id: row.id,
      appId: row.app_id,
      name: row.name,
      description: row.description,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      items: this.getItemsByListId(row.id)
    }))
  }

  /**
   * Delete a todo list by ID
   */
  deleteList(listId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM todo_lists WHERE id = ?')
    const result = stmt.run(listId)
    return result.changes > 0
  }

  /**
   * Update list timestamp
   */
  updateListTimestamp(listId: string): void {
    const stmt = this.db.prepare('UPDATE todo_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    stmt.run(listId)
  }

  /**
   * Add an item to a todo list
   */
  addItem(listId: string, title: string, description?: string, order?: number, completed?: boolean): TodoItem {
    // Get current max order if not specified
    if (order === undefined) {
      const maxOrderStmt = this.db.prepare('SELECT MAX(item_order) as max_order FROM todo_items WHERE list_id = ?')
      const maxOrderResult = maxOrderStmt.get(listId) as { max_order: number | null }
      order = (maxOrderResult.max_order || 0) + 1
    }

    const id = this.generateId()
    const stmt = this.db.prepare(`
      INSERT INTO todo_items (id, list_id, title, description, item_order, completed, in_progress)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `)

    stmt.run(id, listId, title, description || null, order, completed ? 1 : 0)

    this.updateListTimestamp(listId)

    const item = this.getItemById(id)
    if (!item) {
      throw new Error('Failed to create item')
    }

    return item
  }

  /**
   * Get a todo item by ID
   */
  getItemById(itemId: string): TodoItem | null {
    const stmt = this.db.prepare(`
      SELECT id, list_id, title, description, completed, in_progress, item_order, created_at, updated_at
      FROM todo_items
      WHERE id = ?
    `)

    const row = stmt.get(itemId) as any

    if (!row) {
      return null
    }

    return {
      id: row.id,
      listId: row.list_id,
      title: row.title,
      description: row.description,
      completed: row.completed === 1,
      inProgress: row.in_progress === 1,
      order: row.item_order,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }
  }

  /**
   * Get all items for a list
   */
  getItemsByListId(listId: string): TodoItem[] {
    const stmt = this.db.prepare(`
      SELECT id, list_id, title, description, completed, in_progress, item_order, created_at, updated_at
      FROM todo_items
      WHERE list_id = ?
      ORDER BY item_order ASC, created_at ASC
    `)

    const rows = stmt.all(listId) as any[]

    return rows.map(row => ({
      id: row.id,
      listId: row.list_id,
      title: row.title,
      description: row.description,
      completed: row.completed === 1,
      inProgress: row.in_progress === 1,
      order: row.item_order,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }))
  }

  /**
   * Update a todo item
   */
  updateItem(itemId: string, updates: { title?: string; description?: string; order?: number }): TodoItem {
    const updateFields: string[] = []
    const values: any[] = []

    if (updates.title !== undefined) {
      updateFields.push('title = ?')
      values.push(updates.title)
    }

    if (updates.description !== undefined) {
      updateFields.push('description = ?')
      values.push(updates.description)
    }

    if (updates.order !== undefined) {
      updateFields.push('item_order = ?')
      values.push(updates.order)
    }

    if (updateFields.length === 0) {
      throw new Error('No updates specified')
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(itemId)

    const stmt = this.db.prepare(`
      UPDATE todo_items
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `)

    const result = stmt.run(...values)

    if (result.changes === 0) {
      throw new Error(`Item not found: ${itemId}`)
    }

    const item = this.getItemById(itemId)
    if (!item) {
      throw new Error('Failed to retrieve updated item')
    }

    this.updateListTimestamp(item.listId)

    return item
  }

  /**
   * Delete a todo item
   */
  deleteItem(itemId: string): boolean {
    const item = this.getItemById(itemId)

    const stmt = this.db.prepare('DELETE FROM todo_items WHERE id = ?')
    const result = stmt.run(itemId)

    if (result.changes > 0 && item) {
      this.updateListTimestamp(item.listId)
      return true
    }

    return false
  }

  /**
   * Mark an item as completed
   */
  markItemCompleted(itemId: string, completed: boolean): TodoItem {
    const stmt = this.db.prepare(`
      UPDATE todo_items
      SET completed = ?, in_progress = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    const result = stmt.run(completed ? 1 : 0, itemId)

    if (result.changes === 0) {
      throw new Error(`Item not found: ${itemId}`)
    }

    const item = this.getItemById(itemId)
    if (!item) {
      throw new Error('Failed to retrieve item after update')
    }

    this.updateListTimestamp(item.listId)

    return item
  }

  /**
   * Reorder an item
   */
  reorderItem(itemId: string, newOrder: number): TodoItem {
    const stmt = this.db.prepare(`
      UPDATE todo_items
      SET item_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    const result = stmt.run(newOrder, itemId)

    if (result.changes === 0) {
      throw new Error(`Item not found: ${itemId}`)
    }

    const item = this.getItemById(itemId)
    if (!item) {
      throw new Error('Failed to retrieve item after reordering')
    }

    this.updateListTimestamp(item.listId)

    return item
  }

  /**
   * Mark multiple items as completed in a single operation
   */
  markItemsCompleted(itemIds: string[], completed: boolean): TodoItem[] {
    if (itemIds.length === 0) {
      return []
    }

    const placeholders = itemIds.map(() => '?').join(',')
    const stmt = this.db.prepare(`
      UPDATE todo_items
      SET completed = ?, in_progress = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
    `)

    stmt.run(completed ? 1 : 0, ...itemIds)

    // Get all updated items and update their list timestamps
    const items = itemIds
      .map(id => this.getItemById(id))
      .filter((item): item is TodoItem => item !== null)

    // Update timestamps for all affected lists
    const uniqueListIds = [...new Set(items.map(item => item.listId))]
    uniqueListIds.forEach(listId => this.updateListTimestamp(listId))

    return items
  }

  /**
   * Mark multiple items as in progress in a single operation
   */
  markItemsInProgress(itemIds: string[], inProgress: boolean): TodoItem[] {
    if (itemIds.length === 0) {
      return []
    }

    const placeholders = itemIds.map(() => '?').join(',')
    const stmt = this.db.prepare(`
      UPDATE todo_items
      SET in_progress = ?, completed = CASE WHEN ? = 1 THEN 0 ELSE completed END, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
    `)

    stmt.run(inProgress ? 1 : 0, inProgress ? 1 : 0, ...itemIds)

    const items = itemIds
      .map(id => this.getItemById(id))
      .filter((item): item is TodoItem => item !== null)

    const uniqueListIds = [...new Set(items.map(item => item.listId))]
    uniqueListIds.forEach(listId => this.updateListTimestamp(listId))

    return items
  }
}

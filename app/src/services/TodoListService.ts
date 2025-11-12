/**
 * Todo List Service
 *
 * Service for interacting with todo list API endpoints
 */

import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import type { TodoList } from '@/stores/useTodoListStore'

/**
 * Todo List Service class
 */
export class TodoListService {
  /**
   * Get all todo lists for an app
   */
  async getAllLists(appId: string): Promise<TodoList[]> {
    try {
      const url = await buildDynamicAgentUrl(`agent/todo-lists/${appId}`, appId)
      
      logger.debug('todo-list-service.get-all.begin', { appId, url })
      
      const response = await agentFetch(url, { siteId: appId })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch todo lists: ${response.status}`)
      }
      
      const data = await response.json()
      const lists = data.lists || []
      
      logger.debug('todo-list-service.get-all.success', {
        appId,
        listsCount: lists.length
      })
      
      return lists.map(this.parseList)
    } catch (error) {
      logger.error('todo-list-service.get-all.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Get the currently selected/active list for an app
   */
  async getCurrentList(appId: string): Promise<TodoList | null> {
    try {
      const url = await buildDynamicAgentUrl(`agent/todo-lists/${appId}/current`, appId)
      
      logger.debug('todo-list-service.get-current.begin', { appId, url })
      
      const response = await agentFetch(url, { siteId: appId })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch current todo list: ${response.status}`)
      }
      
      const data = await response.json()
      const list = data.list
      
      logger.debug('todo-list-service.get-current.success', {
        appId,
        hasCurrentList: !!list,
        listId: list?.id,
        listName: list?.name
      })
      
      return list ? this.parseList(list) : null
    } catch (error) {
      logger.error('todo-list-service.get-current.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Set the current active list for an app
   */
  async setCurrentList(appId: string, listId: string): Promise<TodoList> {
    try {
      const url = await buildDynamicAgentUrl(`agent/todo-lists/${appId}/current`, appId)
      
      logger.debug('todo-list-service.set-current.begin', { appId, listId, url })
      
      const response = await agentFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ listId }),
        siteId: appId
      })
      
      if (!response.ok) {
        throw new Error(`Failed to set current todo list: ${response.status}`)
      }
      
      const data = await response.json()
      const list = data.list
      
      logger.debug('todo-list-service.set-current.success', {
        appId,
        listId,
        listName: list?.name
      })
      
      return this.parseList(list)
    } catch (error) {
      logger.error('todo-list-service.set-current.failure', {
        appId,
        listId,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Parse a todo list from API response, converting date strings to Date objects
   */
  private parseList(list: any): TodoList {
    return {
      ...list,
      createdAt: new Date(list.createdAt),
      updatedAt: new Date(list.updatedAt),
      items: list.items?.map((item: any) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt)
      })) || []
    }
  }
}

/**
 * Singleton instance of TodoListService
 */
export const todoListService = new TodoListService()


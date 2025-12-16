/**
 * Todo List Store
 *
 * Manages the persistent todo list UI state including:
 * - Current active todo list data
 * - View state (closed, update, open)
 * - Auto-collapse timer for update state
 * - Tracking updated items for scroll behavior
 */

import { create } from 'zustand'

import { logger } from '@/lib/request-context'

/**
 * Todo item interface matching backend structure
 */
export interface TodoItem {
  id: string
  listId: string
  title: string
  description?: string
  completed: boolean
  order: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Todo list interface matching backend structure
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
 * View state for the persistent todo list UI
 */
export type TodoListViewState = 'closed' | 'update' | 'open'

/**
 * Todo list store state interface
 */
export interface TodoListState {
  currentList: TodoList | null
  viewState: TodoListViewState
  updatedItemIds: Set<string>
  autoCollapseTimer: NodeJS.Timeout | null

  setCurrentList: (list: TodoList | null) => void
  setViewState: (state: TodoListViewState) => void
  toggleViewState: () => void
  updateFromToolCall: (toolResult: any) => void
  showListTemporarily: (list: TodoList, duration?: number) => void
  clearUpdatedItems: () => void
  startAutoCollapseTimer: () => void
  clearAutoCollapseTimer: () => void
  reset: () => void
}

/**
 * Create the todo list store
 */
export const useTodoListStore = create<TodoListState>()((set, get) => ({
  currentList: null,
  viewState: 'closed',
  updatedItemIds: new Set<string>(),
  autoCollapseTimer: null,

  /**
   * Set the current active todo list
   */
  setCurrentList: (list) => {
    set({ currentList: list })
  },

  /**
   * Set the view state
   */
  setViewState: (state) => {
    const { clearAutoCollapseTimer } = get()
    
    // Clear any existing timer when changing state
    clearAutoCollapseTimer()
    
    set({ viewState: state })
  },

  /**
   * Toggle between closed and open states
   */
  toggleViewState: () => {
    const { viewState, clearAutoCollapseTimer } = get()
    
    // Clear any existing timer
    clearAutoCollapseTimer()
    
    if (viewState === 'closed') {
      set({ viewState: 'open' })
    } else {
      set({ viewState: 'closed' })
    }
  },

  /**
   * Show a list temporarily in open state
   * 
   * @param list - The list to display
   * @param duration - Duration in milliseconds (default: 10000)
   */
  showListTemporarily: (list, duration = 10000) => {
    const { clearAutoCollapseTimer } = get()
    
    // Clear any existing timer
    clearAutoCollapseTimer()
    
    // Set the list and open the view
    set({
      currentList: list,
      viewState: 'open',
      updatedItemIds: new Set<string>()
    })
    
    // Set timer to collapse after duration
    const timer = setTimeout(() => {
      set({
        viewState: 'closed',
        autoCollapseTimer: null
      })
    }, duration)
    
    set({ autoCollapseTimer: timer })
  },

  /**
   * Update the current list from a tool call result
   * 
   * Handles various todoList operations and updates the UI accordingly
   */
  updateFromToolCall: (toolResult) => {
    const { currentList, startAutoCollapseTimer, showListTemporarily } = get()
    
    try {
      // Parse the tool result if it's a string
      const result = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult
      
      // Handle show_list operation specially - display for 10 seconds
      if (result.operation === 'show_list' && result.list) {
        showListTemporarily(result.list, 10000)
        return
      }
      
      // Handle create_list operation specially - display for 10 seconds
      if (result.operation === 'create_list' && result.list) {
        showListTemporarily(result.list, 10000)
        return
      }
      
      // Extract the list data from various operation types
      let updatedList: TodoList | null = null
      const changedItemIds = new Set<string>()
      
      if (result.list) {
        // Operations that return the full list: get_list
        updatedList = result.list
      } else if (result.items && currentList) {
        // Operations that return affected items: add_items, update_items, mark_done, mark_undone
        result.items.forEach((item: TodoItem) => changedItemIds.add(item.id))
        
        // Update the current list with the changed items
        const updatedItems = currentList.items?.map(existingItem => {
          const changedItem = result.items.find((i: TodoItem) => i.id === existingItem.id)
          return changedItem || existingItem
        }) || []
        
        // Add any new items from add_items operation
        if (result.operation === 'add_items') {
          result.items.forEach((newItem: TodoItem) => {
            if (!updatedItems.find(item => item.id === newItem.id)) {
              updatedItems.push(newItem)
            }
          })
        }
        
        updatedList = {
          ...currentList,
          items: updatedItems,
          updatedAt: new Date()
        }
      } else if (result.operation === 'delete_items' && currentList) {
        // Handle delete_items operation
        const deletedIds = result.itemIds || []
        updatedList = {
          ...currentList,
          items: currentList.items?.filter(item => !deletedIds.includes(item.id)) || [],
          updatedAt: new Date()
        }
      }
      
      // Update the store if we have a new list
      if (updatedList) {
        set({
          currentList: updatedList,
          updatedItemIds: changedItemIds,
          viewState: changedItemIds.size > 0 ? 'update' : 'closed'
        })
        
        // Start auto-collapse timer if we have updates
        if (changedItemIds.size > 0) {
          startAutoCollapseTimer()
        }
      }
    } catch (error) {
      logger.error('todo_list_store.update_from_tool.failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  },

  /**
   * Clear the set of updated item IDs
   */
  clearUpdatedItems: () => {
    set({ updatedItemIds: new Set<string>() })
  },

  /**
   * Start the auto-collapse timer (5 seconds)
   */
  startAutoCollapseTimer: () => {
    const { clearAutoCollapseTimer } = get()
    
    // Clear any existing timer
    clearAutoCollapseTimer()
    
    // Set new timer to collapse after 5 seconds
    const timer = setTimeout(() => {
      set({
        viewState: 'closed',
        updatedItemIds: new Set<string>(),
        autoCollapseTimer: null
      })
    }, 5000)
    
    set({ autoCollapseTimer: timer })
  },

  /**
   * Clear the auto-collapse timer
   */
  clearAutoCollapseTimer: () => {
    const { autoCollapseTimer } = get()
    
    if (autoCollapseTimer) {
      clearTimeout(autoCollapseTimer)
      set({ autoCollapseTimer: null })
    }
  },

  /**
   * Reset the store to initial state
   */
  reset: () => {
    const { clearAutoCollapseTimer } = get()
    clearAutoCollapseTimer()
    
    set({
      currentList: null,
      viewState: 'closed',
      updatedItemIds: new Set<string>(),
      autoCollapseTimer: null
    })
  }
}))

/**
 * Selectors for convenient access to store state
 */
export const useCurrentList = () => useTodoListStore(state => state.currentList)
export const useViewState = () => useTodoListStore(state => state.viewState)
export const useUpdatedItemIds = () => useTodoListStore(state => state.updatedItemIds)


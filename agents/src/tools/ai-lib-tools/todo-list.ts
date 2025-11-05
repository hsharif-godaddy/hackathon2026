import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { todoListTool, TodoListToolOptions } from '../todo-list-tool.js'

/**
 * Todo List Tool for AI-Lib
 * Comprehensive planning tool with SQLite storage
 */
export const todoListAITool = createTool(
  'Create and manage todo lists for planning. CRITICAL: Mark items complete IMMEDIATELY after finishing each task - do not wait until end of workflow or git commit. Use show_list to display completed work. Use select_list to switch between todo lists. Use this to break down complex tasks and track progress in real-time.',
  z.object({
    operation: z.enum([
      'create_list',
      'get_list',
      'show_list',
      'list_all',
      'delete_list',
      'add_items',
      'update_items',
      'delete_items',
      'mark_done',
      'mark_undone',
      'select_list'
    ]).describe('The operation to perform. Use show_list to display a completed todo list. Use select_list to switch to a different list.'),
    appId: z.string().optional().describe('App ID to associate the list with (usually from context)'),
    listId: z.string().optional().describe('ID of the todo list (required for get_list, show_list, select_list, delete_list, add_items)'),
    listName: z.string().optional().describe('Name of the todo list (required for create_list)'),
    listDescription: z.string().optional().describe('Description of the todo list'),
    items: z.array(z.object({
      title: z.string().describe('Title of the item'),
      description: z.string().optional().describe('Description of the item'),
      completed: z.boolean().optional().describe('Whether the item is completed (default: false)'),
      order: z.number().optional().describe('Order/position of the item (auto-assigned if not specified)')
    })).optional().describe('Array of items - for create_list (with list) or add_items (to existing list). Can be single item or multiple.'),
    itemIds: z.array(z.string()).optional().describe('Array of item IDs - for mark_done, mark_undone, delete_items. Can be single ID or multiple.'),
    updates: z.array(z.object({
      itemId: z.string().describe('ID of the item to update'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      order: z.number().optional().describe('New order/position')
    })).optional().describe('Array of updates - for update_items operation. Can update single item or multiple.')
  }),
  async (input, context) => {
    // Get appId and sessionId from context if not provided
    const appId = input.appId || (context?.metadata?.appId as string)
    const sessionId = (context?.metadata?.sessionId as string) || (context?.sessionId as string) || ((context as any)?.socketId as string)
    
    // Pass appId and sessionId to the tool execution
    const options = {
      ...input,
      appId,
      sessionId
    } as TodoListToolOptions
    
    const result = await todoListTool.execute(options)
    
    if (!result.success) {
      throw new Error(result.error || 'Todo list operation failed')
    }

    // Return JSON for easier parsing in custom renderers
    return JSON.stringify({
      success: result.success,
      operation: input.operation,
      message: result.message,
      list: result.list,
      lists: result.lists,
      item: result.item,
      items: result.items
    }, null, 2)
  }
)

import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { todoListTool, TodoListToolOptions } from '../todo-list-tool.js'
import { customerIdFromContext } from '../../memory/interfaces/scope.js'

/**
 * Todo List Tool for AI-Lib
 * Comprehensive planning tool with SQLite storage
 */
export const todoListAITool: Tool = createTool(
  'Create and manage todo lists for planning. CRITICAL: Use ONE roadmap create_list per build — put every page/feature as items on that list; never create a parent list plus per-page sub-lists. create_list is rejected while any list for this app still has open items — mark_done those items first or use add_items on the current list. Call mark_done in the SAME TURN you finish each item — before suggestedResponse, before askQuestion, and before ending your response. Use show_list to display completed work.',
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
      'mark_in_progress',
      'mark_undone',
      'select_list'
    ]).describe('The operation to perform. Use mark_done when finished. Use mark_in_progress only when starting work you will finish in a later turn — if you use mark_in_progress, call mark_done before askQuestion or suggestedResponse in the same turn. Use show_list to display a completed todo list. Use select_list to switch to a different list.'),
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
    itemIds: z.array(z.string()).optional().describe('Array of item IDs - for mark_done, mark_in_progress, mark_undone, delete_items. Can be single ID or multiple.'),
    updates: z.array(z.object({
      itemId: z.string().describe('ID of the item to update'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      order: z.number().optional().describe('New order/position')
    })).optional().describe('Array of updates - for update_items operation. Can update single item or multiple.')
  }),
  async (input, context) => {
    // Always prefer context appId (from authenticated session) over LLM-provided appId
    const appId = (context?.metadata?.appId as string) || input.appId
    const sessionId = (context?.metadata?.sessionId as string) || (context?.sessionId as string) || ((context as any)?.socketId as string)

    // Pass appId, sessionId, and customerId (for tenant-scoped store access) to the tool execution
    const options = {
      ...input,
      appId,
      sessionId,
      customerId: customerIdFromContext(context)
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

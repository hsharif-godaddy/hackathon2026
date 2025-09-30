import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { todoListTool, TodoListToolOptions } from '../todo-list-tool.js'

/**
 * Todo List Tool for AI-Lib
 * Comprehensive planning tool with SQLite storage
 */
export const todoListAITool = createTool(
  'Create and manage todo lists for planning. CRITICAL: Mark items complete IMMEDIATELY after finishing each task - do not wait until end of workflow or git commit. Use this to break down complex tasks and track progress in real-time.',
  z.object({
    operation: z.enum([
      'create_list',
      'get_list',
      'list_all',
      'delete_list',
      'add_items',
      'update_items',
      'delete_items',
      'mark_done',
      'mark_undone'
    ]).describe('The operation to perform'),
    appId: z.string().optional().describe('App ID to associate the list with (usually from context)'),
    listId: z.string().optional().describe('ID of the todo list (required for get_list, delete_list, add_items)'),
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
    const result = await todoListTool.execute(input as TodoListToolOptions)
    
    if (!result.success) {
      throw new Error(result.error || 'Todo list operation failed')
    }

    let responseMessage = `✅ **Todo List ${input.operation.toUpperCase().replace(/_/g, ' ')}**\n`
    
    if (result.message) {
      responseMessage += `\n${result.message}`
    }

    // Format list details
    if (result.list) {
      responseMessage += `\n\n📋 **List: ${result.list.name}**`
      if (result.list.description) {
        responseMessage += `\n*${result.list.description}*`
      }
      
      if (result.list.items && result.list.items.length > 0) {
        responseMessage += `\n\n**Items:**`
        
        const completed = result.list.items.filter(item => item.completed)
        const pending = result.list.items.filter(item => !item.completed)
        
        if (pending.length > 0) {
          responseMessage += `\n\n**Pending (${pending.length}):**`
          pending.forEach((item, index) => {
            responseMessage += `\n${index + 1}. ⬜ ${item.title}`
            if (item.description) {
              responseMessage += `\n   *${item.description}*`
            }
            responseMessage += `\n   \`ID: ${item.id}\``
          })
        }
        
        if (completed.length > 0) {
          responseMessage += `\n\n**Completed (${completed.length}):**`
          completed.forEach((item, index) => {
            responseMessage += `\n${index + 1}. ✅ ~~${item.title}~~`
            if (item.description) {
              responseMessage += `\n   *${item.description}*`
            }
            responseMessage += `\n   \`ID: ${item.id}\``
          })
        }
        
        responseMessage += `\n\n**Progress:** ${completed.length}/${result.list.items.length} complete (${Math.round((completed.length / result.list.items.length) * 100)}%)`
      } else {
        responseMessage += `\n\n*No items yet*`
      }
      
      responseMessage += `\n\n\`List ID: ${result.list.id}\``
    }

    // Format multiple lists
    if (result.lists) {
      if (result.lists.length === 0) {
        responseMessage += `\n\nNo todo lists found.`
      } else {
        responseMessage += `\n\n**All Lists (${result.lists.length}):**\n`
        
        result.lists.forEach((list, index) => {
          const totalItems = list.items?.length || 0
          const completedItems = list.items?.filter(item => item.completed).length || 0
          const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0
          
          responseMessage += `\n${index + 1}. **${list.name}**`
          if (list.description) {
            responseMessage += `\n   *${list.description}*`
          }
          responseMessage += `\n   📊 Progress: ${completedItems}/${totalItems} complete (${progress}%)`
          responseMessage += `\n   \`ID: ${list.id}\``
          responseMessage += `\n`
        })
      }
    }

    // Format single item
    if (result.item) {
      responseMessage += `\n\n**Item Details:**`
      responseMessage += `\n${result.item.completed ? '✅' : '⬜'} ${result.item.title}`
      if (result.item.description) {
        responseMessage += `\n*${result.item.description}*`
      }
      responseMessage += `\n\`ID: ${result.item.id}\``
    }

    // Format multiple items (for batch operations)
    if (result.items && result.items.length > 0) {
      responseMessage += `\n\n**Affected Items (${result.items.length}):**`
      result.items.forEach((item, index) => {
        responseMessage += `\n${index + 1}. ${item.completed ? '✅' : '⬜'} ${item.title}`
        if (item.description) {
          responseMessage += `\n   *${item.description}*`
        }
        responseMessage += `\n   \`ID: ${item.id}\``
      })
    }

    return responseMessage
  }
)

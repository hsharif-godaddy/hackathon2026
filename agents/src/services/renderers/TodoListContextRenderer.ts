import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { logger } from '../../logging/index.js'
import { getTodoListStore } from '../../planning/adapters/index.js'
import type { TodoListStore } from '../../planning/interfaces/index.js'

/**
 * Todo List Context data structure
 */
export interface TodoListContextData {
  id: string
}

/**
 * Renderer for Todo List context attachments
 *
 * Renders todo list information to provide context about the current todo list
 * that should be worked on by the agent.
 */
export class TodoListContextRenderer implements ContextAttachmentRenderer<TodoListContextData> {
  constructor(private todoListStore: TodoListStore = getTodoListStore()) {}

  canHandle(type: string): boolean {
    return type === 'todo_list_context'
  }

  async render(
    attachment: ContextAttachment<TodoListContextData>,
    _userPrompt: string,
    context?: {
      appId?: string
      appPath?: string
      conversationId?: string
    }
  ): Promise<RenderedContext | null> {
    try {
      const data = attachment.data

      if (!data) {
        logger.warn('context.renderer.todo_list.no_data', {
          type: attachment.type
        })
        return null
      }

      if (!data.id) {
        logger.warn('context.renderer.todo_list.missing_required_fields', {
          type: attachment.type,
          hasId: !!data.id
        })
        return null
      }

      // Look up the todo list by ID to get the title
      let todoList
      try {
        todoList = await this.todoListStore.getListById(data.id)
      } catch (error) {
        logger.error('context.renderer.todo_list.lookup_failed', {
          type: attachment.type,
          todoListId: data.id,
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      }

      if (!todoList || todoList.appId !== context?.appId) {
        logger.warn('context.renderer.todo_list.not_found', {
          type: attachment.type,
          todoListId: data.id
        })
        return null
      }

      const content = `Build the current todo list - ${data.id} ${todoList.name}`

      logger.debug('context.renderer.todo_list.success', {
        type: attachment.type,
        todoListId: data.id,
        todoListTitle: todoList.name,
        contentLength: content.length
      })

      return {
        content,
        role: 'user',
        insertionOrder: 'after_history'
      }
    } catch (error) {
      logger.error('context.renderer.todo_list.error', {
        type: attachment.type,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  shouldPersist(attachment: ContextAttachment<TodoListContextData>): boolean {
    return attachment.persistence !== 'ephemeral'
  }
}

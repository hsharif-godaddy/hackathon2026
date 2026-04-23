import type { AgentExecutionContext } from '../base/agent.interface.js';
import { TodoListRepository } from '../database/repositories/TodoListRepository.js';
import { logger } from '../logging/index.js';

/**
 * Service for managing todo list context information for LLM conversations
 * 
 * Provides focused todo list context by showing only the currently selected
 * todo list for the session. This helps agents stay focused on the current task.
 */
export class TodoContextManager {
  private todoListRepository: TodoListRepository;

  constructor() {
    this.todoListRepository = new TodoListRepository();
  }

  /**
   * Generate todo list context message for the currently selected list
   * 
   * Always returns a message - either the selected list details or a reminder
   * that no list is active.
   * 
   * @param context - The agent execution context containing app metadata
   * @param selectedTodoListId - The ID of the currently selected todo list (optional)
   * @returns Promise<string | null> - Formatted todo context message, or null only if no appId
   */
  async generateTodoContext(
    context: AgentExecutionContext,
    selectedTodoListId?: string
  ): Promise<string | null> {
    const appId = context.metadata?.appId as string;

    if (!appId) {
      return null;
    }

    // If no specific list is selected, show a message indicating no active list
    if (!selectedTodoListId) {
      logger.debug('todo.context.no_selection', { appId });
      return '[Current Todo List]\n\nNo active todo list. Create one with todoList tool if starting a new feature.';
    }

    try {
      // Get the selected todo list
      const todoList = this.todoListRepository.getListById(selectedTodoListId);

      if (!todoList) {
        logger.warn('todo.context.list_not_found', {
          appId,
          todoListId: selectedTodoListId
        });
        return '[Current Todo List]\n\nNo active todo list. Create one with todoList tool if starting a new feature.';
      }

      // Verify the list belongs to this app
      if (todoList.appId !== appId) {
        logger.warn('todo.context.app_mismatch', {
          appId,
          todoListId: selectedTodoListId,
          listAppId: todoList.appId
        });
        return '[Current Todo List]\n\nNo active todo list. Create one with todoList tool if starting a new feature.';
      }

      // Format the todo list context (including fully complete lists so the agent knows what was built)
      const formattedContext = this.formatTodoList(todoList);

      logger.debug('todo.context.generated', {
        appId,
        todoListId: selectedTodoListId,
        listName: todoList.name,
        itemCount: todoList.items?.length || 0,
        completedCount: todoList.items?.filter((item: any) => item.completed).length || 0
      });

      return formattedContext;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('todo.context.generation_failure', {
        appId,
        todoListId: selectedTodoListId,
        error: err.message
      });
      return '[Current Todo List]\n\nNo active todo list. Create one with todoList tool if starting a new feature.';
    }
  }

  /**
   * Format a single todo list for display in context
   * 
   * @param todoList - The todo list to format
   * @returns Formatted string representation
   */
  private formatTodoList(todoList: any): string {
    const sections = [];
    
    sections.push(`[Current Todo List]`);
    sections.push('');
    sections.push(`List: ${todoList.name} (ID: ${todoList.id})`);
    
    if (todoList.description) {
      sections.push(`Description: ${todoList.description}`);
    }

    const totalItems = todoList.items?.length || 0;
    const completedItems = todoList.items?.filter((item: any) => item.completed).length || 0;
    const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    sections.push(`Progress: ${completedItems}/${totalItems} complete (${progress}%)`);
    sections.push('');

    if (todoList.items && todoList.items.length > 0) {
      const pendingItems = todoList.items.filter((item: any) => !item.completed);
      const completedItemsList = todoList.items.filter((item: any) => item.completed);

      if (pendingItems.length > 0) {
        sections.push(`Pending Items (${pendingItems.length}):`);
        pendingItems.forEach((item: any, index: number) => {
          sections.push(`  ${index + 1}. ⬜ ${item.title} (ID: ${item.id})`);
          if (item.description) {
            sections.push(`     ${item.description}`);
          }
        });
        sections.push('');
      }

      if (completedItemsList.length > 0) {
        sections.push(`Completed Items (${completedItemsList.length}):`);
        completedItemsList.forEach((item: any, index: number) => {
          sections.push(`  ${index + 1}. ✅ ${item.title}`);
        });
        sections.push('');
      }
    } else {
      sections.push('No items in this list yet.');
      sections.push('');
    }

    if (totalItems > 0 && todoList.items.some((item: any) => !item.completed)) {
      sections.push('Note: This is your active todo list. Mark items complete immediately after finishing each task using todoList tool with operation: "mark_done" and the item ID(s). Use operation: "show_list" to display your completed work.');
    } else if (totalItems > 0) {
      sections.push('Note: All items complete. Do not create a new list unless the user explicitly requests a new multi-step feature.');
    }

    return sections.join('\n');
  }

  /**
   * Get a summary of all todo lists for an app (for debugging/selection)
   * 
   * @param appId - The app ID
   * @returns Array of todo list summaries
   */
  getAllListsSummary(appId: string): Array<{
    id: string;
    name: string;
    description?: string;
    totalItems: number;
    completedItems: number;
    progress: number;
  }> {
    const todoLists = this.todoListRepository.getAllLists(appId);
    
    return todoLists.map((list: any) => {
      const totalItems = list.items?.length || 0;
      const completedItems = list.items?.filter((item: any) => item.completed).length || 0;
      const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

      return {
        id: list.id,
        name: list.name,
        description: list.description,
        totalItems,
        completedItems,
        progress
      };
    });
  }
}

const todoContextManager = new TodoContextManager();

export function getTodoContextManager(): TodoContextManager {
  return todoContextManager;
}


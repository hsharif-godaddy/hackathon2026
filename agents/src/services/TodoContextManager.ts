import type { AgentExecutionContext } from '../base/agent.interface.js';
import { getTodoListStore } from '../planning/adapters/index.js';
import type { PlanningTodoList, TodoListStore } from '../planning/interfaces/index.js';
import { workspaceScopeFromAppId } from '../memory/interfaces/scope.js';
import { logger } from '../logging/index.js';

/**
 * Service for managing todo list context information for LLM conversations
 *
 * Provides focused todo list context by showing only the currently selected
 * todo list for the session. This helps agents stay focused on the current task.
 */
export class TodoContextManager {
  constructor(private todoListStore: TodoListStore = getTodoListStore()) {}

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

    if (!selectedTodoListId) {
      logger.debug('todo.context.no_selection', { appId });
      return '[Current Todo List]\n\nNo active todo list. Create one with todoList tool if starting a new feature.';
    }

    try {
      const todoList = await this.todoListStore.getListById(selectedTodoListId);

      if (!todoList) {
        logger.warn('todo.context.list_not_found', {
          appId,
          todoListId: selectedTodoListId
        });
        return '[Current Todo List]\n\nNo active todo list. Create one with todoList tool if starting a new feature.';
      }

      if (todoList.appId !== appId) {
        logger.warn('todo.context.app_mismatch', {
          appId,
          todoListId: selectedTodoListId,
          listAppId: todoList.appId
        });
        return '[Current Todo List]\n\nNo active todo list. Create one with todoList tool if starting a new feature.';
      }

      let siblingWarning: string | null = null
      try {
        siblingWarning = await this.formatSiblingListWarning(appId, selectedTodoListId)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.warn('todo.context.sibling_warning_failure', {
          appId,
          todoListId: selectedTodoListId,
          error: err.message,
        })
      }

      const formattedContext = [
        this.formatTodoList(todoList),
        siblingWarning,
      ].filter(Boolean).join('\n');

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
  private formatTodoList(todoList: PlanningTodoList): string {
    const sections = [];

    sections.push(`[Current Todo List]`);
    sections.push('');
    sections.push(`List: ${todoList.name} (ID: ${todoList.id})`);

    if (todoList.description) {
      sections.push(`Description: ${todoList.description}`);
    }

    const items = todoList.items ?? [];
    const totalItems = items.length;
    const completedItems = items.filter(item => item.completed).length;
    const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    sections.push(`Progress: ${completedItems}/${totalItems} complete (${progress}%)`);
    sections.push('');

    if (items.length > 0) {
      const inProgressItems = items.filter(item => item.inProgress && !item.completed);
      const pendingItems = items.filter(item => !item.completed && !item.inProgress);
      const completedItemsList = items.filter(item => item.completed);

      if (inProgressItems.length > 0) {
        sections.push(`In-Progress Items (${inProgressItems.length}):`);
        inProgressItems.forEach((item, index) => {
          sections.push(`  ${index + 1}. ⏳ ${item.title} (ID: ${item.id})`);
          if (item.description) {
            sections.push(`     ${item.description}`);
          }
        });
        sections.push('');
      }

      if (pendingItems.length > 0) {
        sections.push(`Pending Items (${pendingItems.length}):`);
        pendingItems.forEach((item, index) => {
          sections.push(`  ${index + 1}. ⬜ ${item.title} (ID: ${item.id})`);
          if (item.description) {
            sections.push(`     ${item.description}`);
          }
        });
        sections.push('');
      }

      if (completedItemsList.length > 0) {
        sections.push(`Completed Items (${completedItemsList.length}):`);
        completedItemsList.forEach((item, index) => {
          sections.push(`  ${index + 1}. ✅ ${item.title}`);
        });
        sections.push('');
      }
    } else {
      sections.push('No items in this list yet.');
      sections.push('');
    }

    if (totalItems > 0 && items.some(item => !item.completed)) {
      sections.push('Note: This is your active todo list. When you finish a task, call operation: "mark_done" with its item ID(s) in the same turn. Do not create_list for sub-tasks while items here are open — use add_items or mark_done on this list. create_list is blocked until every list is complete.');
    } else if (totalItems > 0) {
      sections.push('Note: All items complete. Do not create a new list unless the user explicitly requests a new multi-step feature.');
    }

    return sections.join('\n');
  }

  private async formatSiblingListWarning(
    appId: string,
    selectedListId: string,
  ): Promise<string | null> {
    const allLists = await this.todoListStore.getAllLists(workspaceScopeFromAppId(appId));
    const othersWithOpen = allLists.filter((list) => {
      if (list.id === selectedListId) {
        return false;
      }
      return (list.items ?? []).some((item) => !item.completed);
    });

    if (othersWithOpen.length === 0) {
      return null;
    }

    const names = othersWithOpen
      .map((list) => {
        const openCount = (list.items ?? []).filter((item) => !item.completed).length;
        return `"${list.name}" (${openCount} open)`;
      })
      .join(', ');

    return [
      '[Other Todo Lists]',
      '',
      `This app also has list(s) with open items: ${names}.`,
      'Prefer mark_done on the currently-selected list above — do not create_list for per-page work while those items are open.',
    ].join('\n');
  }

  /**
   * Get the current incomplete todo list for an app.
   * Returns the most recently updated list that has at least one incomplete item,
   * or null if all lists are fully complete (or no lists exist).
   */
  async getCurrentIncompleteList(appId: string): Promise<PlanningTodoList | null> {
    return this.todoListStore.getCurrentIncompleteList(workspaceScopeFromAppId(appId));
  }

  /**
   * Get a summary of all todo lists for an app (for debugging/selection)
   *
   * @param appId - The app ID
   * @returns Array of todo list summaries
   */
  async getAllListsSummary(appId: string): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    totalItems: number;
    completedItems: number;
    progress: number;
  }>> {
    const todoLists = await this.todoListStore.getAllLists(workspaceScopeFromAppId(appId));

    return todoLists.map((list: PlanningTodoList) => {
      const totalItems = list.items?.length || 0;
      const completedItems = list.items?.filter(item => item.completed).length || 0;
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


import { TodoListRepository } from '../../../database/repositories/TodoListRepository.js';
import type {
  PlanningCreateItemInput,
  PlanningTodoItem,
  PlanningTodoList,
  TodoItemUpdatableFields,
  TodoListStore,
} from '../../interfaces/todo-list-store.js';
import type { WorkspaceScope } from '../../../memory/interfaces/scope.js';

/**
 * SQLite-backed TodoListStore adapter.
 * Delegates to TodoListRepository, resolving WorkspaceScope → appId.
 */
export class SqliteTodoListStore implements TodoListStore {
  constructor(private repo = new TodoListRepository()) {}

  async createList(scope: WorkspaceScope, name: string, description?: string, items?: PlanningCreateItemInput[]): Promise<PlanningTodoList> {
    return this.repo.createList(name, scope.appId, description, items);
  }

  async getListById(listId: string): Promise<PlanningTodoList | null> {
    return this.repo.getListById(listId);
  }

  async getAllLists(scope: WorkspaceScope): Promise<PlanningTodoList[]> {
    return this.repo.getAllLists(scope.appId);
  }

  async getCurrentIncompleteList(scope: WorkspaceScope): Promise<PlanningTodoList | null> {
    return this.repo.getCurrentIncompleteList(scope.appId);
  }

  async deleteList(listId: string): Promise<boolean> {
    return this.repo.deleteList(listId);
  }

  async updateListTimestamp(listId: string): Promise<void> {
    await this.repo.updateListTimestamp(listId);
  }

  async addItem(listId: string, title: string, description?: string, order?: number, completed?: boolean): Promise<PlanningTodoItem> {
    return this.repo.addItem(listId, title, description, order, completed);
  }

  async getItemById(itemId: string): Promise<PlanningTodoItem | null> {
    return this.repo.getItemById(itemId);
  }

  async getItemsByListId(listId: string): Promise<PlanningTodoItem[]> {
    return this.repo.getItemsByListId(listId);
  }

  async updateItem(itemId: string, updates: TodoItemUpdatableFields): Promise<PlanningTodoItem> {
    return this.repo.updateItem(itemId, updates);
  }

  async deleteItem(itemId: string): Promise<boolean> {
    return this.repo.deleteItem(itemId);
  }

  async markItemCompleted(itemId: string, completed: boolean): Promise<PlanningTodoItem> {
    return this.repo.markItemCompleted(itemId, completed);
  }

  async reorderItem(itemId: string, newOrder: number): Promise<PlanningTodoItem> {
    return this.repo.reorderItem(itemId, newOrder);
  }

  async markItemsCompleted(itemIds: string[], completed: boolean): Promise<PlanningTodoItem[]> {
    return this.repo.markItemsCompleted(itemIds, completed);
  }

  async markItemsInProgress(itemIds: string[], inProgress: boolean): Promise<PlanningTodoItem[]> {
    return this.repo.markItemsInProgress(itemIds, inProgress);
  }
}

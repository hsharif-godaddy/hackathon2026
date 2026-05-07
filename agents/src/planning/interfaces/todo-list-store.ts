import type { WorkspaceScope } from '../../memory/interfaces/scope.js';

export interface PlanningTodoItem {
  id: string;
  listId: string;
  title: string;
  description?: string;
  completed: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanningCreateItemInput {
  title: string;
  description?: string;
  completed?: boolean;
  order?: number;
}

export interface PlanningTodoList {
  id: string;
  appId?: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  items?: PlanningTodoItem[];
}

export interface TodoItemUpdatableFields {
  title?: string;
  description?: string;
  order?: number;
}

/**
 * Store for agent-managed todo/planning lists.
 * All methods are async to support remote adapters.
 */
export interface TodoListStore {
  createList(scope: WorkspaceScope, name: string, description?: string, items?: PlanningCreateItemInput[]): Promise<PlanningTodoList>;
  getListById(listId: string): Promise<PlanningTodoList | null>;
  getAllLists(scope: WorkspaceScope): Promise<PlanningTodoList[]>;
  deleteList(listId: string): Promise<boolean>;
  updateListTimestamp(listId: string): Promise<void>;

  addItem(listId: string, title: string, description?: string, order?: number, completed?: boolean): Promise<PlanningTodoItem>;
  getItemById(itemId: string): Promise<PlanningTodoItem | null>;
  getItemsByListId(listId: string): Promise<PlanningTodoItem[]>;
  updateItem(itemId: string, updates: TodoItemUpdatableFields): Promise<PlanningTodoItem>;
  deleteItem(itemId: string): Promise<boolean>;
  markItemCompleted(itemId: string, completed: boolean): Promise<PlanningTodoItem>;
  reorderItem(itemId: string, newOrder: number): Promise<PlanningTodoItem>;
  markItemsCompleted(itemIds: string[], completed: boolean): Promise<PlanningTodoItem[]>;
}

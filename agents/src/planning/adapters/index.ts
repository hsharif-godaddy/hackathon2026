import { SqliteTodoListStore } from './sqlite-todo-list-store.js';

/**
 * Singleton is initialized lazily on first access so that importing this
 * module does NOT open the SQLite database. Eager init breaks tests that
 * import store-consuming modules but never exercise the store itself.
 */
let todoListStore: SqliteTodoListStore | null = null;

export function getTodoListStore(): SqliteTodoListStore {
  if (!todoListStore) {
    todoListStore = new SqliteTodoListStore();
  }
  return todoListStore;
}

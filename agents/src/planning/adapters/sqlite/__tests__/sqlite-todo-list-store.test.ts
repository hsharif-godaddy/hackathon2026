import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SqliteTodoListStore } from '../sqlite-todo-list-store.js';
import type { WorkspaceScope } from '../../../../memory/interfaces/scope.js';

describe('SqliteTodoListStore', function storeTests() {
  const mockRepo = {
    createList: vi.fn(),
    getListById: vi.fn(),
    getAllLists: vi.fn(),
    deleteList: vi.fn(),
    updateListTimestamp: vi.fn(),
    addItem: vi.fn(),
    getItemById: vi.fn(),
    getItemsByListId: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    markItemCompleted: vi.fn(),
    reorderItem: vi.fn(),
    markItemsCompleted: vi.fn(),
  };

  const scope: WorkspaceScope = { kind: 'resolved', appId: 'app-1', customerId: 'cust-1' };
  let store: SqliteTodoListStore;

  beforeEach(function reset() {
    vi.clearAllMocks();
    store = new SqliteTodoListStore(mockRepo as any);
  });

  it('should forward createList with appId from scope', async function forwardCreate() {
    const mockList = { id: 'list-1', name: 'Test', appId: 'app-1', createdAt: new Date(), updatedAt: new Date() };
    mockRepo.createList.mockReturnValue(mockList);
    const result = await store.createList(scope, 'Test', 'desc');
    expect(result).toBe(mockList);
    expect(mockRepo.createList).toHaveBeenCalledWith('Test', 'app-1', 'desc', undefined);
  });

  it('should forward getAllLists with appId from scope', async function forwardGetAll() {
    mockRepo.getAllLists.mockReturnValue([]);
    await store.getAllLists(scope);
    expect(mockRepo.getAllLists).toHaveBeenCalledWith('app-1');
  });

  it('should forward getListById without scope', async function forwardGetById() {
    mockRepo.getListById.mockReturnValue(null);
    await store.getListById('list-1');
    expect(mockRepo.getListById).toHaveBeenCalledWith('list-1');
  });

  it('should forward addItem without scope', async function forwardAddItem() {
    const mockItem = { id: 'item-1', listId: 'list-1', title: 'Task', completed: false, order: 1, createdAt: new Date(), updatedAt: new Date() };
    mockRepo.addItem.mockReturnValue(mockItem);
    await store.addItem('list-1', 'Task', 'desc', 1, false);
    expect(mockRepo.addItem).toHaveBeenCalledWith('list-1', 'Task', 'desc', 1, false);
  });

  it('should forward updateItem without scope', async function forwardUpdate() {
    const mockItem = { id: 'item-1', listId: 'list-1', title: 'Updated', completed: false, order: 1, createdAt: new Date(), updatedAt: new Date() };
    mockRepo.updateItem.mockReturnValue(mockItem);
    await store.updateItem('item-1', { title: 'Updated' });
    expect(mockRepo.updateItem).toHaveBeenCalledWith('item-1', { title: 'Updated' });
  });

  it('should forward markItemsCompleted without scope', async function forwardBatchComplete() {
    mockRepo.markItemsCompleted.mockReturnValue([]);
    await store.markItemsCompleted(['item-1', 'item-2'], true);
    expect(mockRepo.markItemsCompleted).toHaveBeenCalledWith(['item-1', 'item-2'], true);
  });

  it('should work with local scope', async function localScope() {
    const local: WorkspaceScope = { kind: 'local', appId: 'local-app' };
    mockRepo.getAllLists.mockReturnValue([]);
    await store.getAllLists(local);
    expect(mockRepo.getAllLists).toHaveBeenCalledWith('local-app');
  });
});

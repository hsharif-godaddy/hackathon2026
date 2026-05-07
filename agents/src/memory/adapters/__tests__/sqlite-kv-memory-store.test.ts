import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SqliteKvMemoryStore } from '../sqlite-kv-memory-store.js';
import type { WorkspaceScope } from '../../interfaces/scope.js';

describe('SqliteKvMemoryStore', function storeTests() {
  const mockRepo = {
    set: vi.fn(),
    get: vi.fn(),
    listKeys: vi.fn(),
    delete: vi.fn(),
    search: vi.fn(),
    getAll: vi.fn(),
  };

  const scope: WorkspaceScope = { kind: 'resolved', appId: 'app-1', customerId: 'cust-1' };
  let store: SqliteKvMemoryStore;

  beforeEach(function reset() {
    vi.clearAllMocks();
    store = new SqliteKvMemoryStore(mockRepo as any);
  });

  it('should forward set with appId from scope', async function forwardSet() {
    mockRepo.set.mockResolvedValue({ success: true });
    await store.set(scope, 'key1', 'value1');
    expect(mockRepo.set).toHaveBeenCalledWith('app-1', 'key1', 'value1');
  });

  it('should forward get with appId from scope', async function forwardGet() {
    mockRepo.get.mockResolvedValue({ success: true, value: 'val', exists: true });
    const result = await store.get(scope, 'key1');
    expect(mockRepo.get).toHaveBeenCalledWith('app-1', 'key1');
    expect(result.exists).toBe(true);
  });

  it('should forward listKeys with appId and prefix', async function forwardList() {
    mockRepo.listKeys.mockResolvedValue({ success: true, keys: ['a', 'b'] });
    await store.listKeys(scope, 'pre');
    expect(mockRepo.listKeys).toHaveBeenCalledWith('app-1', 'pre');
  });

  it('should forward delete with appId from scope', async function forwardDelete() {
    mockRepo.delete.mockResolvedValue({ success: true });
    await store.delete(scope, 'key1');
    expect(mockRepo.delete).toHaveBeenCalledWith('app-1', 'key1');
  });

  it('should forward search with appId, term, and limit', async function forwardSearch() {
    mockRepo.search.mockResolvedValue({ success: true, results: [] });
    await store.search(scope, 'term', 5);
    expect(mockRepo.search).toHaveBeenCalledWith('app-1', 'term', 5);
  });

  it('should forward getAll with appId from scope', async function forwardGetAll() {
    mockRepo.getAll.mockResolvedValue({ success: true, memories: [] });
    await store.getAll(scope);
    expect(mockRepo.getAll).toHaveBeenCalledWith('app-1');
  });

  it('should work with local scope (no customerId)', async function localScope() {
    const local: WorkspaceScope = { kind: 'local', appId: 'local-app' };
    mockRepo.set.mockResolvedValue({ success: true });
    await store.set(local, 'k', 'v');
    expect(mockRepo.set).toHaveBeenCalledWith('local-app', 'k', 'v');
  });
});

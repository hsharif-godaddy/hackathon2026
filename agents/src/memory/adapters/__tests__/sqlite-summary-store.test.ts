import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SqliteSummaryStore } from '../sqlite-summary-store.js';
import type { WorkspaceScope } from '../../interfaces/scope.js';

describe('SqliteSummaryStore', function storeTests() {
  const mockRepo = {
    create: vi.fn(),
    findByAppId: vi.fn(),
    findById: vi.fn(),
    findByMessageRange: vi.fn(),
    findLatestForApp: vi.fn(),
    deleteByAppId: vi.fn(),
    deleteById: vi.fn(),
  };

  const scope: WorkspaceScope = { kind: 'resolved', appId: 'app-1', customerId: 'cust-1' };
  let store: SqliteSummaryStore;

  beforeEach(function reset() {
    vi.clearAllMocks();
    store = new SqliteSummaryStore(mockRepo as any);
  });

  it('should forward create with appId from scope', async function forwardCreate() {
    const summary = { summaryText: 'test', summaryTokenCount: 10, modelUsed: 'gpt-4', messageRange: { startId: 'a', endId: 'b' }, messageCount: 5, originalTokenCount: 100 };
    mockRepo.create.mockResolvedValue({ id: '1', ...summary });
    await store.create(scope, summary as any, 'conv-1');
    expect(mockRepo.create).toHaveBeenCalledWith(summary, 'app-1', 'conv-1');
  });

  it('should forward findByAppId with appId from scope', async function forwardFindByAppId() {
    mockRepo.findByAppId.mockResolvedValue([]);
    await store.findByAppId(scope);
    expect(mockRepo.findByAppId).toHaveBeenCalledWith('app-1');
  });

  it('should forward findById without scope', async function forwardFindById() {
    mockRepo.findById.mockResolvedValue(null);
    await store.findById('sum-1');
    expect(mockRepo.findById).toHaveBeenCalledWith('sum-1');
  });

  it('should forward findLatestForApp with appId from scope', async function forwardLatest() {
    mockRepo.findLatestForApp.mockResolvedValue(null);
    await store.findLatestForApp(scope);
    expect(mockRepo.findLatestForApp).toHaveBeenCalledWith('app-1');
  });

  it('should forward deleteByAppId with appId from scope', async function forwardDeleteApp() {
    mockRepo.deleteByAppId.mockResolvedValue(undefined);
    await store.deleteByAppId(scope);
    expect(mockRepo.deleteByAppId).toHaveBeenCalledWith('app-1');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  SqliteConversationLifecycleStore,
  SqliteMessageStore,
  SqliteConversationTokenStore,
} from '../sqlite-conversation-store.js';
import type { WorkspaceScope } from '../../../interfaces/scope.js';

describe('SqliteConversationLifecycleStore', function lifecycleTests() {
  const mockRepo = {
    create: vi.fn(),
    getById: vi.fn(),
    findByIds: vi.fn(),
    getByAppId: vi.fn(),
    getLatestForApp: vi.fn(),
    findByAppAndAgent: vi.fn(),
    updateTitle: vi.fn(),
    updateAgentId: vi.fn(),
    getOrCreateForApp: vi.fn(),
    delete: vi.fn(),
    getConversationsWithMessageCount: vi.fn(),
    getConversationCount: vi.fn(),
  };

  const scope: WorkspaceScope = { kind: 'resolved', appId: 'app-1', customerId: 'cust-1' };
  let store: SqliteConversationLifecycleStore;

  beforeEach(function reset() {
    vi.clearAllMocks();
    store = new SqliteConversationLifecycleStore(mockRepo as any);
  });

  it('should forward create with appId from scope', async function forwardCreate() {
    mockRepo.create.mockResolvedValue({ id: 'c1', appId: 'app-1', agentId: 'agent-1' });
    await store.create(scope, 'agent-1', 'title');
    expect(mockRepo.create).toHaveBeenCalledWith('app-1', 'agent-1', 'title', undefined);
  });

  it('should forward getByAppId with appId from scope', async function forwardGetByAppId() {
    mockRepo.getByAppId.mockResolvedValue([]);
    await store.getByAppId(scope);
    expect(mockRepo.getByAppId).toHaveBeenCalledWith('app-1');
  });

  it('should forward getById without scope', async function forwardGetById() {
    mockRepo.getById.mockResolvedValue(null);
    await store.getById('conv-1');
    expect(mockRepo.getById).toHaveBeenCalledWith('conv-1');
  });

  it('should forward getLatestForApp with appId from scope', async function forwardLatest() {
    mockRepo.getLatestForApp.mockResolvedValue(null);
    await store.getLatestForApp(scope);
    expect(mockRepo.getLatestForApp).toHaveBeenCalledWith('app-1');
  });

  it('should forward getConversationCount with appId from scope', async function forwardCount() {
    mockRepo.getConversationCount.mockResolvedValue(5);
    const count = await store.getConversationCount(scope);
    expect(count).toBe(5);
    expect(mockRepo.getConversationCount).toHaveBeenCalledWith('app-1');
  });
});

describe('SqliteMessageStore', function messageTests() {
  const mockRepo = {
    addMessage: vi.fn(),
    registerMessageAddedHook: vi.fn(),
    unregisterMessageAddedHook: vi.fn(),
    getMessageById: vi.fn(),
    updateMessageMetadata: vi.fn(),
    updateMessage: vi.fn(),
    hasMessagesForAppSync: vi.fn(),
    getMessageCount: vi.fn(),
    getMessages: vi.fn(),
    getLastUserMessage: vi.fn(),
    getMessagesPaginated: vi.fn(),
    getMessagesForHistory: vi.fn(),
    getMessagesBatch: vi.fn(),
    deleteMessage: vi.fn(),
    generateTitle: vi.fn(),
  };

  const scope: WorkspaceScope = { kind: 'local', appId: 'app-2' };
  let store: SqliteMessageStore;

  beforeEach(function reset() {
    vi.clearAllMocks();
    store = new SqliteMessageStore(mockRepo as any);
  });

  it('should forward hasMessagesForApp with appId from scope', async function forwardHas() {
    mockRepo.hasMessagesForAppSync.mockReturnValue(true);
    expect(await store.hasMessagesForApp(scope)).toBe(true);
    expect(mockRepo.hasMessagesForAppSync).toHaveBeenCalledWith('app-2');
  });

  it('should forward getMessagesForHistory without scope', async function forwardHistory() {
    mockRepo.getMessagesForHistory.mockResolvedValue([]);
    await store.getMessagesForHistory('conv-1');
    expect(mockRepo.getMessagesForHistory).toHaveBeenCalledWith('conv-1');
  });

  it('should forward generateTitle without scope', function forwardTitle() {
    mockRepo.generateTitle.mockReturnValue('Title...');
    expect(store.generateTitle('A long message')).toBe('Title...');
    expect(mockRepo.generateTitle).toHaveBeenCalledWith('A long message');
  });
});

describe('SqliteConversationTokenStore', function tokenTests() {
  const mockRepo = {
    getEstimatedTokensAfterMessageId: vi.fn(),
    getEstimatedTokensForApp: vi.fn(),
    getMessagesAfterMessageId: vi.fn(),
    getRecentMessagesForApp: vi.fn(),
    getLastMessageTimestamp: vi.fn(),
  };

  const scope: WorkspaceScope = { kind: 'resolved', appId: 'app-1', customerId: 'cust-1' };
  let store: SqliteConversationTokenStore;

  beforeEach(function reset() {
    vi.clearAllMocks();
    store = new SqliteConversationTokenStore(mockRepo as any);
  });

  it('should forward getEstimatedTokensAfterMessageId with appId from scope', async function forwardTokensAfter() {
    mockRepo.getEstimatedTokensAfterMessageId.mockResolvedValue(500);
    const result = await store.getEstimatedTokensAfterMessageId(scope, 'msg-1');
    expect(result).toBe(500);
    expect(mockRepo.getEstimatedTokensAfterMessageId).toHaveBeenCalledWith('app-1', 'msg-1');
  });

  it('should forward getEstimatedTokensForApp with appId from scope', async function forwardTokensApp() {
    mockRepo.getEstimatedTokensForApp.mockResolvedValue(1000);
    const result = await store.getEstimatedTokensForApp(scope);
    expect(result).toBe(1000);
    expect(mockRepo.getEstimatedTokensForApp).toHaveBeenCalledWith('app-1');
  });

  it('should forward getRecentMessagesForApp with appId and limit from scope', async function forwardRecent() {
    mockRepo.getRecentMessagesForApp.mockResolvedValue([{ id: 'msg-1', sender: 'agent', content: 'hello' }]);
    const result = await store.getRecentMessagesForApp(scope, 20);
    expect(result).toEqual([{ id: 'msg-1', sender: 'agent', content: 'hello' }]);
    expect(mockRepo.getRecentMessagesForApp).toHaveBeenCalledWith('app-1', 20);
  });

  it('should forward getLastMessageTimestamp without scope', async function forwardTimestamp() {
    mockRepo.getLastMessageTimestamp.mockResolvedValue('2024-01-01T00:00:00Z');
    const result = await store.getLastMessageTimestamp();
    expect(result).toBe('2024-01-01T00:00:00Z');
  });
});

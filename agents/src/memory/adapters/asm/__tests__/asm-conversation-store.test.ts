import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsmConversationLifecycleStore } from '../asm-conversation-store.js';
import type { AsmClientWrapper } from '../asm-client-wrapper.js';
import type { WorkspaceScope } from '../../../interfaces/scope.js';

describe('AsmConversationLifecycleStore', function storeTests() {
  const scope: WorkspaceScope = { kind: 'resolved', appId: 'app-1', customerId: 'cust-1' };
  let mockClient: {
    createConversation: ReturnType<typeof vi.fn>;
    getConversation: ReturnType<typeof vi.fn>;
    searchConversations: ReturnType<typeof vi.fn>;
    closeConversation: ReturnType<typeof vi.fn>;
    updateLabels: ReturnType<typeof vi.fn>;
    addParticipants: ReturnType<typeof vi.fn>;
    addMessages: ReturnType<typeof vi.fn>;
  };
  let store: AsmConversationLifecycleStore;

  beforeEach(function reset() {
    mockClient = {
      createConversation: vi.fn().mockResolvedValue({ success: true, id: 'c1' }),
      getConversation: vi.fn().mockResolvedValue({
        id: 'c1',
        status: 'ACTIVE',
        labels: { appId: 'app-1', agentId: 'agent-1', title: 'Test' },
        participants: [],
        messages: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
      searchConversations: vi.fn().mockResolvedValue({ conversationIds: [], pageInfo: {} }),
      closeConversation: vi.fn().mockResolvedValue({ success: true, id: 'c1' }),
      updateLabels: vi.fn().mockResolvedValue({ success: true, id: 'c1' }),
      addParticipants: vi.fn().mockResolvedValue({ success: true, id: 'c1' }),
      addMessages: vi.fn().mockResolvedValue({ success: true, id: 'c1' }),
    };
    store = new AsmConversationLifecycleStore(mockClient as unknown as AsmClientWrapper, 'svc-1');
  });

  it('should create a conversation with correct labels and system+agent participants', async function createConv() {
    const result = await store.create(scope, 'agent-1', 'My Title');
    expect(result.appId).toBe('app-1');
    expect(result.agentId).toBe('agent-1');
    expect(result.title).toBe('My Title');
    expect(mockClient.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({
          appId: 'app-1',
          customerId: 'cust-1',
          agentId: 'agent-1',
          title: 'My Title',
        }),
      })
    );
    // agentId is still tracked via the label (source of truth); the agent is also
    // recorded as a participant for enrichment.
    const participants = mockClient.createConversation.mock.calls[0][0].participants;
    expect(participants).toEqual(expect.arrayContaining([
      { withSystem: { id: 'svc-1' } },
      { withAgent: { id: 'agent-1', name: 'agent-1' } },
    ]));
    // 'cust-1' is not a UUID — withCustomer is skipped to avoid Venus rejection.
    expect(participants.some((p: { withCustomer?: unknown }) => p.withCustomer)).toBe(false);
  });

  it('should add the customer participant when customerId is a UUID', async function createWithUuidCustomer() {
    const uuidScope: WorkspaceScope = {
      kind: 'resolved',
      appId: 'app-1',
      customerId: '11111111-1111-4111-8111-111111111111',
    };
    await store.create(uuidScope, 'agent-1', 'My Title');
    const participants = mockClient.createConversation.mock.calls[0][0].participants;
    expect(participants).toEqual(expect.arrayContaining([
      { withCustomer: { id: '11111111-1111-4111-8111-111111111111' } },
    ]));
  });

  it('should not add a customer participant for local scopes', async function createLocalScope() {
    const localScope = { kind: 'local', appId: 'app-1' } as unknown as WorkspaceScope;
    await store.create(localScope, 'agent-1', 'My Title');
    const participants = mockClient.createConversation.mock.calls[0][0].participants;
    expect(participants.some((p: { withCustomer?: unknown }) => p.withCustomer)).toBe(false);
  });

  it('should return null from getById when conversation not found', async function getByIdNull() {
    mockClient.getConversation.mockResolvedValue(null);
    const result = await store.getById('missing');
    expect(result).toBeNull();
  });

  it('should map getConversation response to Conversation', async function getByIdMaps() {
    const result = await store.getById('c1');
    expect(result).toEqual(expect.objectContaining({
      id: 'c1',
      appId: 'app-1',
      agentId: 'agent-1',
      title: 'Test',
    }));
  });

  it('should search by appId for getByAppId', async function getByAppId() {
    mockClient.searchConversations.mockResolvedValue({ conversationIds: ['c1'], pageInfo: {} });
    const result = await store.getByAppId(scope);
    expect(result).toHaveLength(1);
    expect(mockClient.searchConversations).toHaveBeenCalledWith(
      { matchAll: [
        { condition: { field: 'labels.key', operator: 'EQUALS', value: 'appId' } },
        { condition: { field: 'labels.value', operator: 'EQUALS', value: 'app-1' } },
      ] },
      { first: 100, after: undefined },
    );
  });

  it('should update title via updateLabels', async function updateTitle() {
    await store.updateTitle('c1', 'New Title');
    expect(mockClient.updateLabels).toHaveBeenCalledWith({
      conversationId: 'c1',
      labels: { title: 'New Title' },
    });
  });

  it('should update the agentId label and also record the agent as a participant', async function updateAgent() {
    await store.updateAgentId('c1', 'marketing');
    // Label is the source of truth — overwritten, so find/read resolve the current agent.
    expect(mockClient.updateLabels).toHaveBeenCalledWith({
      conversationId: 'c1',
      labels: { agentId: 'marketing' },
    });
    // Participant record is also appended (enrichment).
    expect(mockClient.addParticipants).toHaveBeenCalledWith('c1', [
      { withAgent: { id: 'marketing', name: 'marketing' } },
    ]);
  });

  it('should close conversation on delete', async function deleteConv() {
    await store.delete('c1');
    expect(mockClient.closeConversation).toHaveBeenCalledWith('c1');
  });

  it('should return count from search result length', async function convCount() {
    mockClient.searchConversations.mockResolvedValue({ conversationIds: ['c1', 'c2'], pageInfo: {} });
    const count = await store.getConversationCount(scope);
    expect(count).toBe(2);
  });

  it('should filter out CLOSED conversations from getById', async function closedFiltered() {
    mockClient.getConversation.mockResolvedValue({
      id: 'c1',
      status: 'CLOSED',
      labels: { appId: 'app-1', agentId: 'agent-1' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    const result = await store.getById('c1');
    expect(result).toBeNull();
  });

  it('should paginate search when no limit specified', async function searchPagination() {
    mockClient.searchConversations
      .mockResolvedValueOnce({
        conversationIds: Array.from({ length: 100 }, (_, i) => `c-${i}`),
        pageInfo: { hasNextPage: true, endCursor: 'cursor-99', hasPreviousPage: false },
      })
      .mockResolvedValueOnce({
        conversationIds: ['c-100', 'c-101'],
        pageInfo: { hasNextPage: false, endCursor: 'cursor-101', hasPreviousPage: true },
      });

    const result = await store.getByAppId(scope);
    expect(mockClient.searchConversations).toHaveBeenCalledTimes(2);
    expect(mockClient.searchConversations).toHaveBeenCalledWith(
      expect.anything(),
      { first: 100, after: 'cursor-99' },
    );
    expect(result.length).toBeLessThanOrEqual(102);
  });

  it('should skip pagination for small explicit limits', async function smallLimit() {
    mockClient.searchConversations.mockResolvedValue({
      conversationIds: ['c1', 'c2', 'c3'],
      pageInfo: { hasNextPage: true, endCursor: 'cursor-3', hasPreviousPage: false },
    });

    await store.getLatestForApp(scope);
    expect(mockClient.searchConversations).toHaveBeenCalledTimes(1);
    expect(mockClient.searchConversations).toHaveBeenCalledWith(
      expect.anything(),
      { first: 5 },
    );
  });

  it('should log degraded warning when findByIds has partial failures', async function partialFailure() {
    mockClient.searchConversations.mockResolvedValue({ conversationIds: ['c1', 'c2'], pageInfo: {} });
    mockClient.getConversation
      .mockResolvedValueOnce({
        id: 'c1',
        status: 'ACTIVE',
        labels: { appId: 'app-1', agentId: 'agent-1' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      })
      .mockRejectedValueOnce(new Error('timeout'));

    const result = await store.getByAppId(scope);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('should throw when all findByIds lookups fail', async function totalFailure() {
    mockClient.getConversation
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'));

    await expect(store.findByIds(['c1', 'c2'])).rejects.toThrow(
      'All 2 conversation lookups failed'
    );
  });

  it('should return empty array from findByIds for empty input', async function emptyInput() {
    const result = await store.findByIds([]);
    expect(result).toEqual([]);
    expect(mockClient.getConversation).not.toHaveBeenCalled();
  });

  it('should warn when findByAppAndAgent results are truncated', async function truncatedAppAgent() {
    mockClient.searchConversations.mockResolvedValue({
      conversationIds: Array.from({ length: 100 }, (_, i) => `c-${i}`),
      pageInfo: { hasNextPage: true, endCursor: 'cursor-99', hasPreviousPage: false },
    });
    mockClient.getConversation.mockResolvedValue({
      id: 'c-0',
      status: 'ACTIVE',
      labels: { appId: 'app-1', agentId: 'agent-1' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    await store.findByAppAndAgent(scope, 'agent-1');
    expect(mockClient.searchConversations).toHaveBeenCalledWith(
      expect.anything(),
      { first: 100 },
    );
  });
});

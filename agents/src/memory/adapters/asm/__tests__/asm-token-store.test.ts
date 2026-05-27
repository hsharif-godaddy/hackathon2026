import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsmConversationTokenStore } from '../asm-token-store.js';
import type { AsmClientWrapper } from '../asm-client-wrapper.js';
import type { Message } from '@gd-asm/asm-client';

describe('AsmConversationTokenStore', function tokenStoreTests() {
  let mockClient: {
    getConversation: ReturnType<typeof vi.fn>;
    searchConversations: ReturnType<typeof vi.fn>;
  };
  let store: AsmConversationTokenStore;

  const scope = { kind: 'resolved' as const, appId: 'app-1', customerId: 'cust-1', siteId: 'site-1' };

  function makeMsg(id: string, text: string, type: 'USER' | 'AGENT', responseTo?: string[]): Message {
    return {
      id,
      createdAt: '2024-01-01T00:00:00Z',
      messageCreatedAt: '2024-01-01T00:00:00Z',
      contents: [{ text }],
      participant: { id: type.toLowerCase(), type },
      responseTo,
    } as unknown as Message;
  }

  beforeEach(function setup() {
    mockClient = {
      getConversation: vi.fn(),
      searchConversations: vi.fn().mockResolvedValue({ conversationIds: ['conv-1'] }),
    };
    store = new AsmConversationTokenStore(mockClient as unknown as AsmClientWrapper);
  });

  it('should return null for getLastMessageTimestamp when no messages recorded', async function noTimestamp() {
    expect(await store.getLastMessageTimestamp()).toBeNull();
  });

  it('should track timestamp via recordMessageTimestamp', async function recordTimestamp() {
    const now = new Date('2024-06-01T12:00:00Z');
    store.recordMessageTimestamp(now);
    expect(await store.getLastMessageTimestamp()).toBe('2024-06-01T12:00:00.000Z');
  });

  it('should estimate tokens after a message id using walkLinearChain', async function tokensAfter() {
    const m1 = makeMsg('m1', 'hello', 'USER');
    const m2 = makeMsg('m2', 'world', 'AGENT', ['m1']);
    const m3 = makeMsg('m3', 'thanks', 'USER', ['m2']);
    mockClient.getConversation.mockResolvedValue({
      id: 'conv-1',
      status: 'ACTIVE',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: { edges: [m1, m2, m3].map((m) => ({ cursor: m.id, node: m })) },
    });

    const tokens = await store.getEstimatedTokensAfterMessageId(scope, 'm1');
    expect(tokens).not.toBeNull();
    expect(tokens!).toBeGreaterThan(0);
  });

  it('should return null when afterMessageId is not found', async function notFound() {
    mockClient.getConversation.mockResolvedValue({
      id: 'conv-1',
      status: 'ACTIVE',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: { edges: [{ cursor: 'm1', node: makeMsg('m1', 'hi', 'USER') }] },
    });
    const tokens = await store.getEstimatedTokensAfterMessageId(scope, 'nonexistent');
    expect(tokens).toBeNull();
  });

  it('should return messages after the given id in chain order', async function messagesAfter() {
    const m1 = makeMsg('m1', 'first', 'USER');
    const m2 = makeMsg('m2', 'second', 'AGENT', ['m1']);
    const m3 = makeMsg('m3', 'third', 'USER', ['m2']);
    mockClient.getConversation.mockResolvedValue({
      id: 'conv-1',
      status: 'ACTIVE',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: { edges: [m1, m2, m3].map((m) => ({ cursor: m.id, node: m })) },
    });

    const msgs = await store.getMessagesAfterMessageId(scope, 'm1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('second');
    expect(msgs[1].content).toBe('third');
  });

  it('should return recent messages for app limited and sorted chronologically', async function recentMessages() {
    const m1 = makeMsg('m1', 'first', 'USER');
    const m2 = makeMsg('m2', 'second', 'AGENT', ['m1']);
    const m3 = makeMsg('m3', 'third', 'USER', ['m2']);
    mockClient.getConversation.mockResolvedValue({
      id: 'conv-1',
      status: 'ACTIVE',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: { edges: [m1, m2, m3].map((m) => ({ cursor: m.id, node: m })) },
    });

    const msgs = await store.getRecentMessagesForApp(scope, 2);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('second');
    expect(msgs[1].content).toBe('third');
  });

  it('should merge messages from multiple conversations sorted by time', async function recentMultiConv() {
    mockClient.searchConversations.mockResolvedValue({ conversationIds: ['conv-1', 'conv-2'] });

    const m1 = makeMsg('m1', 'conv1-first', 'USER');
    (m1 as any).messageCreatedAt = new Date('2024-01-01T00:00:00Z');
    const m2 = makeMsg('m2', 'conv1-second', 'AGENT', ['m1']);
    (m2 as any).messageCreatedAt = new Date('2024-01-01T00:02:00Z');

    const m3 = makeMsg('m3', 'conv2-first', 'USER');
    (m3 as any).messageCreatedAt = new Date('2024-01-01T00:01:00Z');
    const m4 = makeMsg('m4', 'conv2-second', 'AGENT', ['m3']);
    (m4 as any).messageCreatedAt = new Date('2024-01-01T00:03:00Z');

    mockClient.getConversation
      .mockResolvedValueOnce({
        id: 'conv-1',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        messages: { edges: [m1, m2].map((m) => ({ cursor: m.id, node: m })) },
      })
      .mockResolvedValueOnce({
        id: 'conv-2',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        messages: { edges: [m3, m4].map((m) => ({ cursor: m.id, node: m })) },
      });

    const msgs = await store.getRecentMessagesForApp(scope, 3);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content).toBe('conv2-first');
    expect(msgs[1].content).toBe('conv1-second');
    expect(msgs[2].content).toBe('conv2-second');
  });

  it('should paginate backwards when fetching messages', async function paginatedTokens() {
    const m1 = makeMsg('m1', 'hello', 'USER');
    const m2 = makeMsg('m2', 'world', 'AGENT', ['m1']);
    const m3 = makeMsg('m3', 'thanks', 'USER', ['m2']);

    mockClient.getConversation
      .mockResolvedValueOnce({
        id: 'conv-1',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        messages: {
          edges: [{ cursor: 'm2', node: m2 }, { cursor: 'm3', node: m3 }],
          pageInfo: { startCursor: 'm2', endCursor: 'm3', hasNextPage: false, hasPreviousPage: true },
        },
      })
      .mockResolvedValueOnce({
        id: 'conv-1',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        messages: {
          edges: [{ cursor: 'm1', node: m1 }],
          pageInfo: { startCursor: 'm1', endCursor: 'm1', hasNextPage: true, hasPreviousPage: false },
        },
      });

    const msgs = await store.getMessagesAfterMessageId(scope, 'm1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('world');
    expect(msgs[1].content).toBe('thanks');
    expect(mockClient.getConversation).toHaveBeenCalledTimes(2);
  });
});

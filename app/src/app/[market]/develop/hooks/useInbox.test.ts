// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockConvertConversation = vi.fn((c: unknown) => c);
vi.mock('@/lib/inbox/transforms/conversation', () => ({
  convertConversation: (...args: unknown[]) => mockConvertConversation(...args),
}));

const { sendInboxReply, getInboxConversations } = await import('./useInbox');

const BRAND_ID = '550e8400-e29b-41d4-a716-446655440000';

const mockConversationsResponse = (conversations: unknown[] = []) =>
  new Response(JSON.stringify({ conversations, page_count: 1 }), { status: 200 });

describe('sendInboxReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when brandId is missing', async () => {
    await expect(
      sendInboxReply({ brandId: '', conversationId: '123', body: 'hello' }),
    ).rejects.toThrow('Brand ID is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when conversationId is missing', async () => {
    await expect(
      sendInboxReply({ brandId: 'abc-uuid', conversationId: '', body: 'hello' }),
    ).rejects.toThrow('Conversation ID is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('posts to /api/inbox/messages with correct params', async () => {
    const mockMessage = { id: '1', conversationId: '123', body: 'hello' };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: mockMessage }), { status: 200 }),
    );

    const params = {
      brandId: '550e8400-e29b-41d4-a716-446655440000',
      conversationId: '123',
      body: 'hello',
      isInternalNote: false,
    };
    await sendInboxReply(params);

    expect(mockFetch).toHaveBeenCalledWith('/api/inbox/messages', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  });

  it('returns parsed response on success', async () => {
    const mockMessage = { id: '42', conversationId: '123', body: 'test' };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: mockMessage }), { status: 200 }),
    );

    const result = await sendInboxReply({
      brandId: '550e8400-e29b-41d4-a716-446655440000',
      conversationId: '123',
      body: 'test',
    });
    expect(result.message).toEqual(mockMessage);
  });

  it('throws with error message from response on failure', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 }),
    );

    await expect(
      sendInboxReply({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '999',
        body: 'hi',
      }),
    ).rejects.toThrow('Conversation not found');
  });

  it('throws generic error when response has no error field', async () => {
    mockFetch.mockResolvedValue(
      new Response('{}', { status: 500 }),
    );

    await expect(
      sendInboxReply({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
        body: 'hi',
      }),
    ).rejects.toThrow('Failed to send reply: 500');
  });

  it('includes optional fields when provided', async () => {
    const mockMessage = { id: '1', conversationId: '123', body: 'hi' };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: mockMessage }), { status: 200 }),
    );

    const params = {
      brandId: '550e8400-e29b-41d4-a716-446655440000',
      conversationId: '123',
      body: 'hi',
      parentMessageId: '456',
      isInternalNote: true,
      attachments: [{ id: 10 }] as Array<{ id: number } | string>,
      clientId: 'my-client-id',
    };
    await sendInboxReply(params);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.parentMessageId).toBe('456');
    expect(sentBody.isInternalNote).toBe(true);
    expect(sentBody.attachments).toEqual([{ id: 10 }]);
    expect(sentBody.clientId).toBe('my-client-id');
  });
});

describe('getInboxConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not include filter param when filter is all', async () => {
    mockFetch.mockResolvedValue(mockConversationsResponse());
    await getInboxConversations({ brandId: BRAND_ID, filter: 'all' });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.has('filter')).toBe(false);
  });

  it('includes filter param when filter is unresolved', async () => {
    mockFetch.mockResolvedValue(mockConversationsResponse());
    await getInboxConversations({ brandId: BRAND_ID, filter: 'unresolved' });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('filter')).toBe('unresolved');
  });

  it('includes filter param when filter is resolved', async () => {
    mockFetch.mockResolvedValue(mockConversationsResponse());
    await getInboxConversations({ brandId: BRAND_ID, filter: 'resolved' });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('filter')).toBe('resolved');
  });

  it('does not include filter param when filter is undefined', async () => {
    mockFetch.mockResolvedValue(mockConversationsResponse());
    await getInboxConversations({ brandId: BRAND_ID });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.has('filter')).toBe(false);
  });

  it('throws when more than 20% of conversations fail to transform', async () => {
    mockConvertConversation.mockImplementation(() => {
      throw new Error('transform failed');
    });

    const conversations = Array.from({ length: 4 }, (_, i) => ({ id: i }));
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ conversations, page_count: 1 }), { status: 200 }),
    );

    await expect(
      getInboxConversations({ brandId: BRAND_ID }),
    ).rejects.toThrow('Conversation transform failure');

    mockConvertConversation.mockImplementation((c: unknown) => c);
  });

  it('does not throw when exactly 20% of conversations fail to transform', async () => {
    let callCount = 0;
    mockConvertConversation.mockImplementation((c: unknown) => {
      callCount++;
      if (callCount === 1) throw new Error('transform failed');
      return c;
    });

    const conversations = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ conversations, page_count: 1 }), { status: 200 }),
    );

    const result = await getInboxConversations({ brandId: BRAND_ID });
    expect(result.conversations).toHaveLength(4);

    mockConvertConversation.mockImplementation((c: unknown) => c);
  });
});

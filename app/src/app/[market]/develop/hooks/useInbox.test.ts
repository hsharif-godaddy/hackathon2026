import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { sendInboxReply } = await import('./useInbox');

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

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/inbox/transforms/conversation', () => ({
  convertConversation: vi.fn((c) => ({ id: c.id?.toString() ?? '0', transformed: true })),
}));

vi.mock('@/lib/inbox/transforms/message', () => ({
  convertMessage: vi.fn((m) => ({
    id: m.id?.toString() ?? '0',
    bumpedAt: m.created_at ?? '2024-01-01T00:00:00Z',
    transformed: true,
  })),
}));

const { convertConversation } = await import('@/lib/inbox/transforms/conversation');
const { convertMessage } = await import('@/lib/inbox/transforms/message');
const { getInboxConversations, getInboxConversation, getInboxConversationMessages } = await import('./useInbox');

function makeRemoteConversation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 1, subject: 'Test', ...overrides };
}

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('getInboxConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when brandId is missing', async () => {
    await expect(
      getInboxConversations({ brandId: '' }),
    ).rejects.toThrow('Brand ID is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns pageCount from response when valid', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        conversations: [makeRemoteConversation()],
        page_count: 5,
        page_size: 30,
      }),
    );

    const result = await getInboxConversations({ brandId: 'brand-uuid' });

    expect(result.pageCount).toBe(5);
  });

  it('falls back to pageCount 1 when page_count is missing', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        conversations: [makeRemoteConversation()],
        page_size: 30,
      }),
    );

    const result = await getInboxConversations({ brandId: 'brand-uuid' });

    expect(result.pageCount).toBe(1);
  });

  it('falls back to pageCount 1 when page_count is 0', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        conversations: [makeRemoteConversation()],
        page_count: 0,
        page_size: 30,
      }),
    );

    const result = await getInboxConversations({ brandId: 'brand-uuid' });

    expect(result.pageCount).toBe(1);
  });

  it('falls back to pageCount 1 when page_count is negative', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        conversations: [makeRemoteConversation()],
        page_count: -2,
        page_size: 30,
      }),
    );

    const result = await getInboxConversations({ brandId: 'brand-uuid' });

    expect(result.pageCount).toBe(1);
  });

  it('falls back to pageSize 30 when page_size is missing', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        conversations: [makeRemoteConversation()],
        page_count: 1,
      }),
    );

    const result = await getInboxConversations({ brandId: 'brand-uuid' });

    expect(result.pageSize).toBe(30);
  });

  it('falls back to pageSize 30 when page_size is 0', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        conversations: [makeRemoteConversation()],
        page_count: 1,
        page_size: 0,
      }),
    );

    const result = await getInboxConversations({ brandId: 'brand-uuid' });

    expect(result.pageSize).toBe(30);
  });

  it('falls back to pageSize 30 when page_size is not a number', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        conversations: [makeRemoteConversation()],
        page_count: 1,
        page_size: 'abc',
      }),
    );

    const result = await getInboxConversations({ brandId: 'brand-uuid' });

    expect(result.pageSize).toBe(30);
  });

  it('uses page_size from response when valid', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        conversations: [makeRemoteConversation()],
        page_count: 1,
        page_size: 50,
      }),
    );

    const result = await getInboxConversations({ brandId: 'brand-uuid' });

    expect(result.pageSize).toBe(50);
  });

  it('silently drops conversations that fail transformation', async () => {
    const mockConvert = vi.mocked(convertConversation);
    mockConvert.mockImplementationOnce(() => ({ id: '1', transformed: true }) as never);
    mockConvert.mockImplementationOnce(() => { throw new Error('bad data'); });
    mockConvert.mockImplementationOnce(() => ({ id: '3', transformed: true }) as never);

    mockFetch.mockResolvedValue(
      makeOkResponse({
        conversations: [
          makeRemoteConversation({ id: 1 }),
          makeRemoteConversation({ id: 2 }),
          makeRemoteConversation({ id: 3 }),
        ],
        page_count: 1,
        page_size: 30,
      }),
    );

    const result = await getInboxConversations({ brandId: 'brand-uuid' });

    expect(result.conversations).toHaveLength(2);
  });

  it('throws on non-array conversations response', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ conversations: null, page_count: 1, page_size: 30 }),
    );

    await expect(
      getInboxConversations({ brandId: 'brand-uuid' }),
    ).rejects.toThrow('Invalid conversations response format');
  });

  it('appends page query param when provided', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ conversations: [], page_count: 1, page_size: 30 }),
    );

    await getInboxConversations({ brandId: 'brand-uuid', page: 3 });

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('page')).toBe('3');
  });

  it('omits page query param when not provided', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ conversations: [], page_count: 1, page_size: 30 }),
    );

    await getInboxConversations({ brandId: 'brand-uuid' });

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.has('page')).toBe(false);
  });
});

describe('getInboxConversationMessages pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns hasMore: false when total_count equals message count', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [
          { id: 1, created_at: '2024-01-01T00:00:00Z' },
          { id: 2, created_at: '2024-01-02T00:00:00Z' },
        ],
        total_count: 2,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '123',
      brandId: 'brand-uuid',
    });

    expect(result.hasMore).toBe(false);
  });

  it('returns hasMore: true when total_count exceeds message count', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [
          { id: 1, created_at: '2024-01-01T00:00:00Z' },
        ],
        total_count: 5,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '123',
      brandId: 'brand-uuid',
    });

    expect(result.hasMore).toBe(true);
  });

  it('returns until as the bumpedAt of the last message', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [
          { id: 1, created_at: '2024-01-01T00:00:00Z' },
          { id: 2, created_at: '2024-01-02T00:00:00Z' },
        ],
        total_count: 5,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '123',
      brandId: 'brand-uuid',
    });

    expect(result.until).toBe('2024-01-02T00:00:00Z');
  });

  it('returns until as undefined when no messages returned', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [],
        total_count: 0,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '123',
      brandId: 'brand-uuid',
    });

    expect(result.until).toBeUndefined();
  });

  it('returns hasMore: true with undefined until when total_count exceeds zero messages', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [],
        total_count: 5,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '123',
      brandId: 'brand-uuid',
    });

    expect(result.hasMore).toBe(true);
    expect(result.until).toBeUndefined();
  });

  it('throws when conversationId is missing', async () => {
    await expect(
      getInboxConversationMessages({ id: '', brandId: 'brand-uuid' }),
    ).rejects.toThrow('Conversation ID is required');
  });

  it('throws when brandId is missing', async () => {
    await expect(
      getInboxConversationMessages({ id: '123', brandId: '' }),
    ).rejects.toThrow('Brand ID is required');
  });
});

describe('getNextPageParam (pagination stall detection)', () => {
  const getNextPageParam = (lastPage: { hasMore: boolean; until: string | undefined; messages: unknown[] }): string | undefined => {
    if (!lastPage.hasMore) return undefined;
    if (lastPage.messages.length === 0) return undefined;
    if (!lastPage.until) return undefined;
    return lastPage.until;
  };

  it('returns undefined when hasMore is true but until is undefined (graceful stall)', () => {
    expect(getNextPageParam({ hasMore: true, until: undefined, messages: [] })).toBeUndefined();
  });

  it('returns undefined when hasMore is true but messages array is empty (no progress)', () => {
    expect(getNextPageParam({ hasMore: true, until: '2024-01-01T00:00:00Z', messages: [] })).toBeUndefined();
  });

  it('returns undefined when hasMore is false', () => {
    expect(getNextPageParam({ hasMore: false, until: undefined, messages: [] })).toBeUndefined();
  });

  it('returns the cursor when hasMore is true, until is defined, and messages are present', () => {
    expect(getNextPageParam({ hasMore: true, until: '2024-01-01T00:00:00Z', messages: [{}] })).toBe('2024-01-01T00:00:00Z');
  });
});

describe('getInboxConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when conversationId is missing', async () => {
    await expect(
      getInboxConversation({ conversationId: '', brandId: 'brand-uuid' }),
    ).rejects.toThrow('Conversation ID is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when brandId is missing', async () => {
    await expect(
      getInboxConversation({ conversationId: '123', brandId: '' }),
    ).rejects.toThrow('Brand ID is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns the transformed conversation on success', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ conversation: { id: 42, subject: 'Hello' } }),
    );

    const result = await getInboxConversation({ conversationId: '42', brandId: 'brand-uuid' });

    expect(result).toEqual({ id: '42', transformed: true });
    expect(convertConversation).toHaveBeenCalledWith({ id: 42, subject: 'Hello' });
  });

  it('throws with server error message when response is not ok', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );

    await expect(
      getInboxConversation({ conversationId: '123', brandId: 'brand-uuid' }),
    ).rejects.toThrow('Not found');
  });

  it('throws with status code when error body is not parseable', async () => {
    mockFetch.mockResolvedValue(
      new Response('invalid json', { status: 500, headers: { 'Content-Type': 'text/plain' } }),
    );

    await expect(
      getInboxConversation({ conversationId: '123', brandId: 'brand-uuid' }),
    ).rejects.toThrow('Failed to get conversation: 500');
  });

  it('throws on missing conversation field in response', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ something_else: 'data' }),
    );

    await expect(
      getInboxConversation({ conversationId: '123', brandId: 'brand-uuid' }),
    ).rejects.toThrow('Invalid conversation response format');
  });

  it('throws on null conversation field in response', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ conversation: null }),
    );

    await expect(
      getInboxConversation({ conversationId: '123', brandId: 'brand-uuid' }),
    ).rejects.toThrow('Invalid conversation response format');
  });

  it('throws with transform error message when conversion fails', async () => {
    const mockConvert = vi.mocked(convertConversation);
    mockConvert.mockImplementationOnce(() => { throw new Error('bad field X'); });

    mockFetch.mockResolvedValue(
      makeOkResponse({ conversation: { id: 99 } }),
    );

    await expect(
      getInboxConversation({ conversationId: '99', brandId: 'brand-uuid' }),
    ).rejects.toThrow('Failed to transform conversation: bad field X');
  });

  it('builds correct URL with brandId and conversationId params', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ conversation: { id: 7 } }),
    );

    await getInboxConversation({ conversationId: '7', brandId: 'my-brand' });

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe('/api/inbox/conversation');
    expect(calledUrl.searchParams.get('brandId')).toBe('my-brand');
    expect(calledUrl.searchParams.get('conversationId')).toBe('7');
  });
});

describe('getInboxConversationMessages child-threading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds children map when messages have child_count', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [
          {
            id: 10,
            created_at: '2024-01-01T00:00:00Z',
            child_count: 2,
            children: [
              { id: 11, created_at: '2024-01-01T01:00:00Z', child_count: 0 },
              { id: 12, created_at: '2024-01-01T02:00:00Z', child_count: 0 },
            ],
          },
        ],
        total_count: 1,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '100',
      brandId: 'brand-uuid',
    });

    expect(result.children).toBeDefined();
    expect(result.children!['10']).toBeDefined();
    expect(result.children!['10'].totalCount).toBe(2);
    expect(result.children!['10'].items).toHaveLength(2);
    expect(result.children!['10'].hasMore).toBe(false);
  });

  it('sets hasMore on children when child_count exceeds returned children', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [
          {
            id: 20,
            created_at: '2024-01-01T00:00:00Z',
            child_count: 5,
            children: [
              { id: 21, created_at: '2024-01-01T01:00:00Z', child_count: 0 },
            ],
          },
        ],
        total_count: 1,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '100',
      brandId: 'brand-uuid',
    });

    expect(result.children!['20'].hasMore).toBe(true);
    expect(result.children!['20'].totalCount).toBe(5);
    expect(result.children!['20'].items).toHaveLength(1);
  });

  it('returns undefined children when no messages have child_count', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [
          { id: 30, created_at: '2024-01-01T00:00:00Z', child_count: 0 },
          { id: 31, created_at: '2024-01-02T00:00:00Z', child_count: 0 },
        ],
        total_count: 2,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '100',
      brandId: 'brand-uuid',
    });

    expect(result.children).toBeUndefined();
  });

  it('handles childrenFetchData path for fetching child messages', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [
          { id: 41, created_at: '2024-01-01T01:00:00Z', parent_message_id: 40 },
          { id: 42, created_at: '2024-01-01T02:00:00Z', parent_message_id: 40 },
        ],
        total_count: 5,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '100',
      brandId: 'brand-uuid',
      childrenFetchData: {
        parentMessageId: '40',
        until: '2024-01-01T03:00:00Z',
      },
    });

    expect(result.messages).toHaveLength(0);
    expect(result.children).toBeDefined();
    expect(result.children!['40']).toBeDefined();
    expect(result.children!['40'].totalCount).toBe(5);
    expect(result.children!['40'].items).toHaveLength(2);
    expect(result.children!['40'].hasMore).toBe(true);

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('parentMessageId')).toBe('40');
    expect(calledUrl.searchParams.get('before_timestamp')).toBe('2024-01-01T03:00:00Z');
    expect(calledUrl.searchParams.has('conversationId')).toBe(false);
  });

  it('uses until from params when not fetching children', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [
          { id: 50, created_at: '2024-01-01T00:00:00Z' },
        ],
        total_count: 10,
      }),
    );

    await getInboxConversationMessages({
      id: '100',
      brandId: 'brand-uuid',
      until: '2024-06-01T00:00:00Z',
    });

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('before_timestamp')).toBe('2024-06-01T00:00:00Z');
    expect(calledUrl.searchParams.get('conversationId')).toBe('100');
  });

  it('handles recursive nested children', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({
        messages: [
          {
            id: 60,
            created_at: '2024-01-01T00:00:00Z',
            child_count: 1,
            children: [
              {
                id: 61,
                created_at: '2024-01-01T01:00:00Z',
                child_count: 1,
                children: [
                  { id: 62, created_at: '2024-01-01T02:00:00Z', child_count: 0 },
                ],
              },
            ],
          },
        ],
        total_count: 1,
      }),
    );

    const result = await getInboxConversationMessages({
      id: '100',
      brandId: 'brand-uuid',
    });

    expect(result.children!['60']).toBeDefined();
    expect(result.children!['61']).toBeDefined();
    expect(result.children!['60'].items).toHaveLength(1);
    expect(result.children!['61'].items).toHaveLength(1);
  });

  it('extracts error body on non-ok response', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    );

    await expect(
      getInboxConversationMessages({ id: '123', brandId: 'brand-uuid' }),
    ).rejects.toThrow('Forbidden');
  });

  it('falls back to status code when error body is not parseable', async () => {
    mockFetch.mockResolvedValue(
      new Response('not json', { status: 500, headers: { 'Content-Type': 'text/plain' } }),
    );

    await expect(
      getInboxConversationMessages({ id: '123', brandId: 'brand-uuid' }),
    ).rejects.toThrow('Failed to get conversation messages: 500');
  });
});

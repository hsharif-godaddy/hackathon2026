// @vitest-environment jsdom
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { Conversation } from '@/types/inbox/local/conversation';
import { UuidString } from '@/types/inbox/local/core';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockAddGrowlMessage = vi.fn();
vi.mock('@ux/growl', () => ({
  default: { addGrowlMessage: (...args: unknown[]) => mockAddGrowlMessage(...args) },
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

const { useConversationActions } = await import('./useConversationActions');

const BRAND_ID = '550e8400-e29b-41d4-a716-446655440000' as UuidString;

const makeConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: '42',
  originalChannel: 'WebChat',
  messageType: 'chat',
  category: { id: 1, name: 'Chat', slug: 'chat', type: 'WebChat' } as Conversation['category'],
  c2: [],
  lastMessage: {} as Conversation['lastMessage'],
  messageCount: 1,
  isArchived: false,
  isSpam: false,
  isStarred: false,
  isImportant: false,
  status: 'unresolved',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  bumpedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

describe('useConversationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes resolve and unresolve action handles', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

    expect(result.current.resolve).toBeDefined();
    expect(result.current.unresolve).toBeDefined();
    expect(result.current.resolve.canExecute).toBeTypeOf('function');
    expect(result.current.resolve.execute).toBeTypeOf('function');
    expect(typeof result.current.resolve.isPending).toBe('boolean');
  });

  it('resolve.canExecute returns true for unresolved conversations', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

    expect(result.current.resolve.canExecute(makeConversation({ status: 'unresolved' }))).toBe(true);
    expect(result.current.resolve.canExecute(makeConversation({ status: 'resolved' }))).toBe(false);
  });

  it('unresolve.canExecute returns true for resolved conversations', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

    expect(result.current.unresolve.canExecute(makeConversation({ status: 'resolved' }))).toBe(true);
    expect(result.current.unresolve.canExecute(makeConversation({ status: 'unresolved' }))).toBe(false);
  });

  describe('optimistic updates', () => {
    it('applies optimistic transform to conversations list cache on mutate', async () => {
      const { wrapper, queryClient } = createWrapper();
      const conversation = makeConversation({ id: '42', status: 'unresolved' });

      queryClient.setQueryData(
        ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        { conversations: [conversation], pageCount: 1 },
      );

      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['42']);
      });

      await waitFor(() => {
        const cached = queryClient.getQueryData<{ conversations: Conversation[] }>(
          ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        );
        expect(cached?.conversations[0].status).toBe('resolved');
      });
    });

    it('applies optimistic transform to individual conversation cache', async () => {
      const { wrapper, queryClient } = createWrapper();
      const conversation = makeConversation({ id: '42', status: 'unresolved' });

      queryClient.setQueryData(
        ['reamaze', 'inboxConversation', '42', BRAND_ID],
        conversation,
      );

      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['42']);
      });

      await waitFor(() => {
        const cached = queryClient.getQueryData<Conversation>(
          ['reamaze', 'inboxConversation', '42', BRAND_ID],
        );
        expect(cached?.status).toBe('resolved');
      });
    });

    it('rolls back list cache on error', async () => {
      const { wrapper, queryClient } = createWrapper();
      const conversation = makeConversation({ id: '42', status: 'unresolved' });

      queryClient.setQueryData(
        ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        { conversations: [conversation], pageCount: 1 },
      );

      mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Network error' }), { status: 500 }));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['42']);
      });

      await waitFor(() => {
        const cached = queryClient.getQueryData<{ conversations: Conversation[] }>(
          ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        );
        expect(cached?.conversations[0].status).toBe('unresolved');
      });
    });

    it('rolls back individual conversation cache on error', async () => {
      const { wrapper, queryClient } = createWrapper();
      const conversation = makeConversation({ id: '42', status: 'unresolved' });

      queryClient.setQueryData(
        ['reamaze', 'inboxConversation', '42', BRAND_ID],
        conversation,
      );

      mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Network error' }), { status: 500 }));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['42']);
      });

      await waitFor(() => {
        const cached = queryClient.getQueryData<Conversation>(
          ['reamaze', 'inboxConversation', '42', BRAND_ID],
        );
        expect(cached?.status).toBe('unresolved');
      });
    });

    it('applies unresolve optimistic transform to list cache', async () => {
      const { wrapper, queryClient } = createWrapper();
      const conversation = makeConversation({ id: '42', status: 'resolved' });

      queryClient.setQueryData(
        ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        { conversations: [conversation], pageCount: 1 },
      );

      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.unresolve.execute(['42']);
      });

      await waitFor(() => {
        const cached = queryClient.getQueryData<{ conversations: Conversation[] }>(
          ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        );
        expect(cached?.conversations[0].status).toBe('unresolved');
      });
    });

    it('applies optimistic transform to multiple conversations in a batch', async () => {
      const { wrapper, queryClient } = createWrapper();
      const conversations = [
        makeConversation({ id: '1', status: 'unresolved' }),
        makeConversation({ id: '2', status: 'unresolved' }),
        makeConversation({ id: '3', status: 'unresolved' }),
      ];

      queryClient.setQueryData(
        ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        { conversations, pageCount: 1 },
      );

      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['1', '3']);
      });

      await waitFor(() => {
        const cached = queryClient.getQueryData<{ conversations: Conversation[] }>(
          ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        );
        expect(cached?.conversations[0].status).toBe('resolved');
        expect(cached?.conversations[1].status).toBe('unresolved');
        expect(cached?.conversations[2].status).toBe('resolved');
      });
    });

    it('invalidates queries on success', async () => {
      const { wrapper, queryClient } = createWrapper();
      queryClient.setQueryData(
        ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        { conversations: [], pageCount: 1 },
      );

      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['42']);
      });

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: ['reamaze', 'inboxConversations', BRAND_ID],
          }),
        );
      });

      invalidateSpy.mockRestore();
    });

    it('shows error growl on failure', async () => {
      const { wrapper, queryClient } = createWrapper();
      queryClient.setQueryData(
        ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        { conversations: [], pageCount: 1 },
      );

      mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'fail' }), { status: 500 }));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['42']);
      });

      await waitFor(() => {
        expect(mockAddGrowlMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            emphasis: 'critical',
            title: 'builder_inbox_action_resolve_error',
          }),
        );
      });
    });

    it('shows success growl on success', async () => {
      const { wrapper, queryClient } = createWrapper();
      queryClient.setQueryData(
        ['reamaze', 'inboxConversations', BRAND_ID, undefined, undefined],
        { conversations: [], pageCount: 1 },
      );

      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['42']);
      });

      await waitFor(() => {
        expect(mockAddGrowlMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            emphasis: 'success',
            title: 'builder_inbox_action_resolve_success',
          }),
        );
      });
    });
  });

  describe('empty cache safety', () => {
    it('does not crash when executed before list data is cached', async () => {
      const { wrapper } = createWrapper();
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['42']);
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('isPending guard', () => {
    it('does not fire a second mutation while one is in-flight', async () => {
      const { wrapper } = createWrapper();
      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useConversationActions(BRAND_ID), { wrapper });

      act(() => {
        result.current.resolve.execute(['1']);
      });

      await waitFor(() => {
        expect(result.current.resolve.isPending).toBe(true);
      });

      act(() => {
        result.current.unresolve.execute(['2']);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

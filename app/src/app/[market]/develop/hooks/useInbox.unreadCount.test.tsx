// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useInboxUnreadCount } from './useInbox';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// No client-level retry override, so the hook's own retry policy governs.
function retryWrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useInboxUnreadCount', () => {
  const BRAND = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the unread count on success', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 5 }), { status: 200 }));
    const { result } = renderHook(() => useInboxUnreadCount(BRAND), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(5);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/inbox/conversations/counts');
    expect(url).toContain(`brandId=${BRAND}`);
  });

  it('coerces a missing total_count to 0', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const { result } = renderHook(() => useInboxUnreadCount(BRAND), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(0);
  });

  it('coerces a non-numeric total_count to 0', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 'lots' }), { status: 200 }));
    const { result } = renderHook(() => useInboxUnreadCount(BRAND), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(0);
  });

  it('is disabled when brandId is undefined', async () => {
    const { result } = renderHook(() => useInboxUnreadCount(undefined), { wrapper });
    // Disabled queries never fetch.
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not retry on a 4xx response', async () => {
    // A client error (e.g. 403/429) will not succeed on retry — retrying only
    // hammers the endpoint. The query should fail after exactly one request.
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));
    const { result } = renderHook(() => useInboxUnreadCount(BRAND), { wrapper: retryWrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

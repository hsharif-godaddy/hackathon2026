import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useAppPages } from './useAppPages';

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: (options: unknown) => actual.useQuery({ ...(options as Record<string, unknown>), retry: false }),
  };
});

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'https://agent.example.com/apps/app-123' }),
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useAppPages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty pages when appId is null', () => {
    const { result } = renderHook(() => useAppPages({ appId: null }), { wrapper: createWrapper() });
    expect(result.current.pages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns pages from a successful API response', async () => {
    const mockPages = [
      { slug: 'home', title: 'Home', route: '/', isBuilt: true },
      { slug: 'about', title: 'About', route: '/about', isBuilt: false },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ pages: mockPages }), { status: 200 }),
    );

    const { result } = renderHook(() => useAppPages({ appId: 'app-123' }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pages).toEqual(mockPages);
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when response.pages is not an array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ pages: 'not-an-array' }), { status: 200 }),
    );

    const { result } = renderHook(() => useAppPages({ appId: 'app-123' }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pages).toEqual([]);
  });

  it('returns error message on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );

    const { result } = renderHook(() => useAppPages({ appId: 'app-123' }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.pages).toEqual([]);
    expect(result.current.error).toContain('Not found');
  });
});

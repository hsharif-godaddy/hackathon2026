import React, { type ReactNode } from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
  AuthDismissedError: class AuthDismissedError extends Error {
    constructor() { super('Authentication dismissed'); this.name = 'AuthDismissedError'; }
  },
  AuthSessionExpiredError: class AuthSessionExpiredError extends Error {
    constructor() { super('Authentication session expired'); this.name = 'AuthSessionExpiredError'; }
  },
}));
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { useSecrets } = await import('./useSecrets');
const { appFetch } = await import('@/lib/gasket-config');

describe('useSecrets', () => {
  let queryClient: QueryClient;
  const createWrapper = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

  beforeEach(() => { vi.clearAllMocks(); });

  it('should fetch secrets successfully', async () => {
    // Mock both API calls: main secrets fetch and diff fetch
    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          appId: 'app-123',
          secrets: [
            { name: 'KEY1', value: 'val1', systemManaged: false, variants: ['preview'] },
            { name: 'KEY2', value: 'val2', systemManaged: true, variants: ['preview', 'publish'] }
          ],
          count: 2
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ added: [], updated: [], deleted: [] })
      } as Response);

    const { result } = renderHook(() => useSecrets({ appId: 'app-123', variant: 'preview' }), { wrapper: createWrapper() });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); }, { timeout: 10000 });
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('KEY1');
  });

  it('should not fetch when disabled', () => {
    const { result } = renderHook(() => useSecrets({ appId: 'app-123', variant: 'preview', enabled: false }), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should handle 404 as empty secrets', async () => {
    vi.mocked(appFetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' })
    } as Response);

    const { result } = renderHook(() => useSecrets({ appId: 'app-123', variant: 'preview' }), { wrapper: createWrapper() });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toEqual([]);
  });

  it('should handle fetch errors for non-404 status', async () => {
    vi.mocked(appFetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' })
    } as Response);

    const { result } = renderHook(() => useSecrets({ appId: 'app-123', variant: 'preview' }), { wrapper: createWrapper() });
    await waitFor(() => { expect(result.current.isError).toBe(true); }, { timeout: 3000 });
  });

  it('should fetch for preview variant', async () => {
    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ appId: 'app-123', secrets: [], count: 0 })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ added: [], updated: [], deleted: [] })
      } as Response);

    renderHook(() => useSecrets({ appId: 'app-123', variant: 'preview' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith(
        '/api/secrets/app-123/variants/preview',
        undefined,
        { authLevel: 3 }
      );
    });
  });

  it('should fetch for publish variant', async () => {
    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ appId: 'app-123', secrets: [], count: 0 })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ added: [], updated: [], deleted: [] })
      } as Response);

    renderHook(() => useSecrets({ appId: 'app-123', variant: 'publish' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith(
        '/api/secrets/app-123/variants/publish',
        undefined,
        { authLevel: 3 }
      );
    });
  });

  // Wrapper with retries ENABLED so the retry predicate's `return false` is
  // load-bearing (createWrapper's default `retry: false` would mask a broken
  // predicate — the client-level default would block retries either way).
  const createRetryWrapper = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 2 } } });
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

  it('should not retry when the user dismisses the SSO re-auth modal', async () => {
    const { AuthDismissedError } = await import('@/lib/gasket-config');
    vi.mocked(appFetch).mockRejectedValue(new AuthDismissedError());

    const { result } = renderHook(
      () => useSecrets({ appId: 'app-123', variant: 'preview' }),
      { wrapper: createRetryWrapper() }
    );

    await waitFor(() => { expect(result.current.isError).toBe(true); }, { timeout: 3000 });

    expect(appFetch).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(AuthDismissedError);
  });

  it('should not retry on 401 (preflight timeout / re-auth failure)', async () => {
    const { AuthSessionExpiredError } = await import('@/lib/gasket-config');
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized', authReason: 2 }),
    } as Response);

    const { result } = renderHook(
      () => useSecrets({ appId: 'app-123', variant: 'preview' }),
      { wrapper: createRetryWrapper() }
    );

    await waitFor(() => { expect(result.current.isError).toBe(true); }, { timeout: 3000 });

    expect(appFetch).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(AuthSessionExpiredError);
  });

  it('should include system-managed secrets', async () => {
    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          appId: 'app-123',
          secrets: [
            { name: 'USER_KEY', value: 'user', systemManaged: false, variants: ['preview'] },
            { name: 'SYSTEM_KEY', systemManaged: true, variants: ['preview', 'publish'] }
          ],
          count: 2
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ added: [], updated: [], deleted: [] })
      } as Response);

    const { result } = renderHook(() => useSecrets({ appId: 'app-123', variant: 'preview' }), { wrapper: createWrapper() });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); }, { timeout: 10000 });

    const systemSecret = result.current.data?.find(s => s.name === 'SYSTEM_KEY');
    expect(systemSecret?.systemManaged).toBe(true);
  });

  it('should fetch diff data on subsequent call', async () => {
    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          appId: 'app-123',
          secrets: [{ name: 'KEY1', value: 'val1', systemManaged: false, variants: ['preview'] }],
          count: 1
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          added: [{ name: 'NEW_KEY' }],
          updated: [],
          deleted: []
        })
      } as Response);

    renderHook(() => useSecrets({ appId: 'app-123', variant: 'preview' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith('/api/secrets/app-123/diff?source=preview&destination=publish');
    }, { timeout: 10000 });
  });

  it('should use correct query key for caching', () => {
    renderHook(() => useSecrets({ appId: 'app-123', variant: 'preview' }), { wrapper: createWrapper() });

    const queryKey = ['secrets', 'app-123', 'preview'];
    const queryState = queryClient.getQueryState(queryKey);

    // Query should be registered even if pending
    expect(queryState).toBeDefined();
  });
});

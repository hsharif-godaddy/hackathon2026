import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { useAppRename } from './useAppRename';

vi.mock('@/lib/gasket-config');
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('useAppRename', function useAppRenameTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    
    // Reset stores
    useSiteStore.setState({ sites: {}, loading: {}, error: null, _pendingRequests: {} });
    useSitesStore.setState({
      allSites: [],
      sitesById: {},
      isLoadingAll: false,
      loadingById: {},
      error: null,
      lastFetchedAll: null,
    });
    useDevelopPageStore.setState({ site: null });
  });

  it('should rename app successfully', async function renameSuccess() {
    const mockResponse = {
      id: 'app-123',
      name: 'New App Name',
      status: 'running',
    };

    vi.mocked(appFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const { result } = renderHook(useAppRename, {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      newName: 'New App Name',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(appFetch).toHaveBeenCalledWith(
      '/api/sites/app-123',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'New App Name' }),
      })
    );
  });

  it('should update all stores optimistically', async function optimisticUpdate() {
    const mockSite = {
      id: 'app-123',
      name: 'Old Name',
      status: 'running' as const,
      account_id: 'acc-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Setup initial state
    useSiteStore.setState({
      sites: { 'app-123': mockSite },
      loading: {},
      error: null,
      _pendingRequests: {},
    });
    useSitesStore.setState({
      allSites: [mockSite],
      sitesById: { 'app-123': mockSite },
      isLoadingAll: false,
      loadingById: {},
      error: null,
      lastFetchedAll: Date.now(),
    });
    useDevelopPageStore.setState({ site: mockSite });

    vi.mocked(appFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockSite, name: 'New Name' }),
    } as Response);

    const { result } = renderHook(useAppRename, {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      newName: 'New Name',
    });

    // Check optimistic updates happened immediately
    await waitFor(() => {
      const siteStoreState = useSiteStore.getState();
      expect(siteStoreState.sites['app-123']?.name).toBe('New Name');
    });

    const sitesStoreState = useSitesStore.getState();
    expect(sitesStoreState.sitesById['app-123']?.name).toBe('New Name');
    expect(sitesStoreState.allSites[0]?.name).toBe('New Name');

    const developState = useDevelopPageStore.getState();
    expect(developState.site?.name).toBe('New Name');
  });

  it('should handle rename error', async function renameError() {
    vi.mocked(appFetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    } as Response);

    const { result } = renderHook(useAppRename, {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      newName: 'New Name',
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toContain('Server error');
  });

  it('should handle network error', async function networkError() {
    vi.mocked(appFetch).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(useAppRename, {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      newName: 'New Name',
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe('Network error');
  });

  it('should only update develop store if site matches', async function conditionalDevelopUpdate() {
    const mockSite = {
      id: 'app-456',
      name: 'Different App',
      status: 'running' as const,
      account_id: 'acc-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Set develop store to different app
    useDevelopPageStore.setState({ site: mockSite });

    vi.mocked(appFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'app-123', name: 'New Name' }),
    } as Response);

    const { result } = renderHook(useAppRename, {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      newName: 'New Name',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Develop store should NOT be updated (different app)
    const developState = useDevelopPageStore.getState();
    expect(developState.site?.name).toBe('Different App');
    expect(developState.site?.id).toBe('app-456');
  });

  it('should rollback optimistic updates on error', async function rollbackOnError() {
    const mockSite = {
      id: 'app-123',
      name: 'Original Name',
      status: 'running' as const,
      account_id: 'acc-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Setup initial state
    useSiteStore.setState({
      sites: { 'app-123': mockSite },
      loading: {},
      error: null,
      _pendingRequests: {},
    });
    useSitesStore.setState({
      allSites: [mockSite],
      sitesById: { 'app-123': mockSite },
      isLoadingAll: false,
      loadingById: {},
      error: null,
      lastFetchedAll: Date.now(),
    });
    useDevelopPageStore.setState({ site: mockSite });

    // Mock API failure
    vi.mocked(appFetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    } as Response);

    const { result } = renderHook(useAppRename, {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      newName: 'New Name',
    });

    // Wait for error
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Verify stores were rolled back to original values
    const siteStoreState = useSiteStore.getState();
    expect(siteStoreState.sites['app-123']?.name).toBe('Original Name');

    const sitesStoreState = useSitesStore.getState();
    expect(sitesStoreState.sitesById['app-123']?.name).toBe('Original Name');
    expect(sitesStoreState.allSites[0]?.name).toBe('Original Name');

    const developState = useDevelopPageStore.getState();
    expect(developState.site?.name).toBe('Original Name');
  });
});


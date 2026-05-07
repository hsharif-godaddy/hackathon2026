/**
 * @vitest-environment jsdom
 */
import { type ReactNode } from 'react';
import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { usePublishSyncState } from './usePublishSyncState';

// Mock the dependencies
vi.mock('@/hooks/useDeploymentsQuery', () => ({
  useDeploymentsQuery: vi.fn(),
}));

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: vi.fn(),
}));

import { useDeploymentsQuery } from '@/hooks/useDeploymentsQuery';
import { useGitHistoryQuery } from '@/hooks/useGitHistory';

const mockUseDeploymentsQuery = vi.mocked(useDeploymentsQuery);
const mockUseGitHistoryQuery = vi.mocked(useGitHistoryQuery);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('usePublishSyncState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns hasNeverBeenPublished: true when no deployments exist', async () => {
    mockUseDeploymentsQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useDeploymentsQuery>);

    mockUseGitHistoryQuery.mockReturnValue({
      data: {
        commits: [
          { hash: 'abc123', message: 'Commit 1', author: 'test', date: '2024-01-01' },
        ],
        currentCommit: 'abc123',
        hasMore: false,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useGitHistoryQuery>);

    const { result } = renderHook(
      () => usePublishSyncState({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.hasNeverBeenPublished).toBe(true);
    expect(result.current.isInSync).toBe(false);
    expect(result.current.changesSincePublish).toBe(0);
    expect(result.current.isError).toBe(false);
  });

  it('returns isInSync: true when HEAD matches deployed commit', async () => {
    mockUseDeploymentsQuery.mockReturnValue({
      data: [
        {
          id: 'deploy-1',
          status: DeploymentStatus.DEPLOYED,
          gitHash: 'abc123',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useDeploymentsQuery>);

    mockUseGitHistoryQuery.mockReturnValue({
      data: {
        commits: [
          { hash: 'abc123', message: 'Commit 1', author: 'test', date: '2024-01-01' },
        ],
        currentCommit: 'abc123',
        hasMore: false,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useGitHistoryQuery>);

    const { result } = renderHook(
      () => usePublishSyncState({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isInSync).toBe(true);
    expect(result.current.changesSincePublish).toBe(0);
    expect(result.current.hasNeverBeenPublished).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('returns correct count when commits exist since last deploy', async () => {
    mockUseDeploymentsQuery.mockReturnValue({
      data: [
        {
          id: 'deploy-1',
          status: DeploymentStatus.DEPLOYED,
          gitHash: 'def456',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useDeploymentsQuery>);

    // Commits are ordered newest to oldest
    mockUseGitHistoryQuery.mockReturnValue({
      data: {
        commits: [
          { hash: 'abc123', message: 'Commit 3', author: 'test', date: '2024-01-03' },
          { hash: 'xyz789', message: 'Commit 2', author: 'test', date: '2024-01-02' },
          { hash: 'def456', message: 'Commit 1', author: 'test', date: '2024-01-01' },
        ],
        currentCommit: 'abc123',
        hasMore: false,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useGitHistoryQuery>);

    const { result } = renderHook(
      () => usePublishSyncState({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isInSync).toBe(false);
    expect(result.current.changesSincePublish).toBe(2); // 2 commits before the deployed one
    expect(result.current.hasNeverBeenPublished).toBe(false);
  });

  it('returns isLoading: true when deployments are loading', async () => {
    mockUseDeploymentsQuery.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useDeploymentsQuery>);

    mockUseGitHistoryQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useGitHistoryQuery>);

    const { result } = renderHook(
      () => usePublishSyncState({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('returns isLoading: true when git history is loading', async () => {
    mockUseDeploymentsQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useDeploymentsQuery>);

    mockUseGitHistoryQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useGitHistoryQuery>);

    const { result } = renderHook(
      () => usePublishSyncState({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('handles deployed commit not in current history', async () => {
    mockUseDeploymentsQuery.mockReturnValue({
      data: [
        {
          id: 'deploy-1',
          status: DeploymentStatus.DEPLOYED,
          gitHash: 'old-hash-not-in-history',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useDeploymentsQuery>);

    mockUseGitHistoryQuery.mockReturnValue({
      data: {
        commits: [
          { hash: 'abc123', message: 'Commit 2', author: 'test', date: '2024-01-02' },
          { hash: 'def456', message: 'Commit 1', author: 'test', date: '2024-01-01' },
        ],
        currentCommit: 'abc123',
        hasMore: true,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useGitHistoryQuery>);

    const { result } = renderHook(
      () => usePublishSyncState({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    // When deployed commit is not found, treat all commits as changes
    expect(result.current.isInSync).toBe(false);
    expect(result.current.changesSincePublish).toBe(2);
    expect(result.current.hasNeverBeenPublished).toBe(false);
  });

  it('ignores failed deployments', async () => {
    mockUseDeploymentsQuery.mockReturnValue({
      data: [
        {
          id: 'deploy-2',
          status: DeploymentStatus.FAILED,
          gitHash: 'abc123',
        },
        {
          id: 'deploy-1',
          status: DeploymentStatus.DEPLOYED,
          gitHash: 'def456',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useDeploymentsQuery>);

    mockUseGitHistoryQuery.mockReturnValue({
      data: {
        commits: [
          { hash: 'abc123', message: 'Commit 2', author: 'test', date: '2024-01-02' },
          { hash: 'def456', message: 'Commit 1', author: 'test', date: '2024-01-01' },
        ],
        currentCommit: 'abc123',
        hasMore: false,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useGitHistoryQuery>);

    const { result } = renderHook(
      () => usePublishSyncState({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    // Should use the successful deployment at def456, not the failed one at abc123
    expect(result.current.isInSync).toBe(false);
    expect(result.current.changesSincePublish).toBe(1);
  });

  it('respects enabled option', async () => {
    // Set up mock return values for the disabled case
    mockUseDeploymentsQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useDeploymentsQuery>);

    mockUseGitHistoryQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useGitHistoryQuery>);

    renderHook(
      () => usePublishSyncState({ appId: 'app-123', enabled: false }),
      { wrapper: createWrapper() }
    );

    // Should call the hooks with enabled: false
    expect(mockUseDeploymentsQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(mockUseGitHistoryQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it('returns isError: true when deployments query fails', async () => {
    mockUseDeploymentsQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useDeploymentsQuery>);

    mockUseGitHistoryQuery.mockReturnValue({
      data: {
        commits: [
          { hash: 'abc123', message: 'Commit 1', author: 'test', date: '2024-01-01' },
        ],
        currentCommit: 'abc123',
        hasMore: false,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useGitHistoryQuery>);

    const { result } = renderHook(
      () => usePublishSyncState({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isError).toBe(true);
    expect(result.current.isInSync).toBe(false);
    expect(result.current.changesSincePublish).toBe(0);
  });

  it('returns isError: true when git history query fails', async () => {
    mockUseDeploymentsQuery.mockReturnValue({
      data: [
        {
          id: 'deploy-1',
          status: DeploymentStatus.DEPLOYED,
          gitHash: 'abc123',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useDeploymentsQuery>);

    mockUseGitHistoryQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useGitHistoryQuery>);

    const { result } = renderHook(
      () => usePublishSyncState({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isError).toBe(true);
    expect(result.current.isInSync).toBe(false);
    expect(result.current.changesSincePublish).toBe(0);
  });
});

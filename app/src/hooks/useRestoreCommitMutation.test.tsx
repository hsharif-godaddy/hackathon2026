import React, { type ReactNode } from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appService } from '@/services/AppService';
import { useCodeSyncStore } from '@/stores/useCodeSyncStore';
import { useRestoreCommitMutation } from './useRestoreCommitMutation';

vi.mock('@/services/AppService', () => ({
  appService: {
    restoreCommit: vi.fn(),
    getGitHistory: vi.fn(),
    // useRestoreCommitMutation.onSuccess triggers useFileTreeStore.loadFiles,
    // which calls appService.getFiles. Stub it so the post-success path
    // doesn't blow up in tests that don't otherwise care about the file tree.
    getFiles: vi.fn().mockResolvedValue({ entries: [] }),
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useRestoreCommitMutation', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should restore commit successfully', async () => {
    vi.mocked(appService.restoreCommit).mockResolvedValue({
      success: true,
      message: 'restored',
      hasChanges: false,
      stashHash: null,
      notice: null,
    });
    vi.mocked(appService.getGitHistory).mockResolvedValue({
      commits: [{ hash: 'new-hash', message: 'Restored', author: 'Test', date: '2024-01-01' }],
      currentCommit: 'new-hash',
      hasMore: false,
    });

    const { result } = renderHook(() => useRestoreCommitMutation(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      commitHash: 'abc123',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(appService.restoreCommit).toHaveBeenCalledWith('app-123', 'abc123');
  });

  it('forwards an undefined commitHash for stash-only calls', async () => {
    vi.mocked(appService.restoreCommit).mockResolvedValue({
      success: true,
      message: 'stashed',
      hasChanges: true,
      stashHash: 'stash-hash',
      notice: {
        id: 'notice-1',
        role: 'user',
        content: '[system] rollback',
        createdAt: '2026-05-18T12:00:00Z',
        metadata: {
          kind: 'restore',
          commitHash: null,
          stashHash: 'stash-hash',
        },
      },
    });

    const { result } = renderHook(() => useRestoreCommitMutation(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ appId: 'app-123' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(appService.restoreCommit).toHaveBeenCalledWith('app-123', undefined);
    // Without a target commit, the post-success path should skip the
    // git-history refetch + selectCommit dance.
    expect(appService.getGitHistory).not.toHaveBeenCalled();
    expect(result.current.data?.notice?.id).toBe('notice-1');
  });

  it('refreshes the file tree and signals restore on success', async () => {
    vi.mocked(appService.restoreCommit).mockResolvedValue({
      success: true,
      message: 'restored',
      hasChanges: false,
      stashHash: null,
      notice: null,
    });

    const startVersion = useCodeSyncStore.getState().restoreVersion;

    const { result } = renderHook(() => useRestoreCommitMutation(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ appId: 'app-123' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // File tree refresh: the working tree was rewound on disk and the cached
    // tree must be invalidated; loadFiles fetches via appService.getFiles.
    await waitFor(() => {
      expect(appService.getFiles).toHaveBeenCalledWith('app-123', 5);
    });

    // Restore signal: PreviewCode subscribes to this counter so it can route
    // its open files through addConflict on the next bump.
    expect(useCodeSyncStore.getState().restoreVersion).toBe(startVersion + 1);
  });

  it('should handle restore error', async () => {
    vi.mocked(appService.restoreCommit).mockRejectedValue(new Error('Restore failed'));

    const { result } = renderHook(() => useRestoreCommitMutation(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      commitHash: 'abc123',
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

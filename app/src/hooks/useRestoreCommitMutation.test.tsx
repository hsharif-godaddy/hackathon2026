import React, { type ReactNode } from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appService } from '@/services/AppService';
import { useRestoreCommitMutation } from './useRestoreCommitMutation';

vi.mock('@/services/AppService', () => ({
  appService: {
    restoreCommit: vi.fn(),
    getGitHistory: vi.fn(),
  },
}));

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: vi.fn(() => vi.fn()),
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
    vi.mocked(appService.restoreCommit).mockResolvedValue(undefined);
    vi.mocked(appService.getGitHistory).mockResolvedValue({
      commits: [{ hash: 'new-hash', message: 'Restored', author: 'Test', date: '2024-01-01' }],
      currentCommit: 'new-hash',
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

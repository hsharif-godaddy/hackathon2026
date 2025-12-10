import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGitHistoryQuery } from './useGitHistory';
import { appService } from '@/services/AppService';
import React, { type ReactNode } from 'react';

vi.mock('@/services/AppService', () => ({
  appService: {
    getGitHistory: vi.fn(),
  },
}));

describe('useGitHistoryQuery', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch git history successfully', async () => {
    vi.mocked(appService.getGitHistory).mockResolvedValue({
      commits: [
        {
          hash: 'abc123',
          message: 'Initial commit',
          author: 'Test Author',
          date: '2024-01-01',
        },
      ],
    });

    const { result } = renderHook(
      () => useGitHistoryQuery({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].hash).toBe('abc123');
  });

  it('should not fetch when appId is empty', () => {
    const { result } = renderHook(
      () => useGitHistoryQuery({ appId: '' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should not fetch when enabled is false', () => {
    const { result } = renderHook(
      () => useGitHistoryQuery({ appId: 'app-123', enabled: false }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
  });
});

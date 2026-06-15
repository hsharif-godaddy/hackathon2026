// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { queryKeys } from '@/lib/inbox/constants/queryKeys';
import type { AutoupdateVersionPayload } from '@/types/pusher';

const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

// Capture the options passed to usePusher so the test can fire onAutoupdate.
let capturedPusherOptions: { accountId?: string; onAutoupdate?: (data: AutoupdateVersionPayload) => void } | null = null;
vi.mock('@/hooks/usePusher', () => ({
  usePusher: (options: { accountId?: string; onAutoupdate?: (data: AutoupdateVersionPayload) => void }) => {
    capturedPusherOptions = options;
    return { isConnected: false, isAuthenticating: false, error: null };
  },
}));

import { useInboxRealtime } from './useInboxRealtime';

describe('useInboxRealtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    capturedPusherOptions = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes accountId through to usePusher', () => {
    renderHook(() => useInboxRealtime({ accountId: 'acct-123' }));
    expect(capturedPusherOptions?.accountId).toBe('acct-123');
  });

  it('debounces autoupdate events into a single root invalidation', () => {
    renderHook(() => useInboxRealtime({ accountId: 'acct-123' }));

    // Fire a burst of autoupdate events.
    capturedPusherOptions?.onAutoupdate?.({ autoupdate_version: 1 });
    capturedPusherOptions?.onAutoupdate?.({ autoupdate_version: 2 });
    capturedPusherOptions?.onAutoupdate?.({ autoupdate_version: 3 });

    // Nothing fires before the debounce window elapses.
    expect(mockInvalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.all });
  });

  it('clears a pending invalidation on unmount', () => {
    const { unmount } = renderHook(() => useInboxRealtime({ accountId: 'acct-123' }));
    capturedPusherOptions?.onAutoupdate?.({ autoupdate_version: 1 });
    unmount();
    vi.advanceTimersByTime(400);
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockStore: Record<string, unknown> = {
  currentAppId: null,
  site: null,
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: any) => unknown) => selector(mockStore),
}));

import { useCollaboratorAccessCheck } from './useCollaboratorAccessCheck';

describe('useCollaboratorAccessCheck', function collaboratorAccessTests() {
  beforeEach(function setup() {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockStore.currentAppId = null;
    mockStore.site = null;
    global.fetch = vi.fn();
  });

  afterEach(function teardown() {
    vi.useRealTimers();
  });

  it('does not poll when sharedWithMe is false', function noPolling() {
    mockStore.currentAppId = 'app-1';
    mockStore.site = { sharedWithMe: false };

    renderHook(() => useCollaboratorAccessCheck());

    vi.advanceTimersByTime(60_000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not poll when currentAppId is null', function noAppId() {
    mockStore.currentAppId = null;
    mockStore.site = { sharedWithMe: true };

    renderHook(() => useCollaboratorAccessCheck());

    vi.advanceTimersByTime(60_000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('polls every 30s when sharedWithMe is true', async function polls() {
    mockStore.currentAppId = 'app-shared';
    mockStore.site = { sharedWithMe: true };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 200 });

    renderHook(() => useCollaboratorAccessCheck());

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sites?site_id=app-shared',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('sets revoked to true on 404 response', async function revoked404() {
    mockStore.currentAppId = 'app-shared';
    mockStore.site = { sharedWithMe: true };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 404 });

    const { result } = renderHook(() => useCollaboratorAccessCheck());

    expect(result.current.revoked).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current.revoked).toBe(true);
  });

  it('sets revoked to true on 403 response', async function revoked403() {
    mockStore.currentAppId = 'app-shared';
    mockStore.site = { sharedWithMe: true };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 403 });

    const { result } = renderHook(() => useCollaboratorAccessCheck());

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current.revoked).toBe(true);
  });

  it('does not set revoked on network error', async function networkError() {
    mockStore.currentAppId = 'app-shared';
    mockStore.site = { sharedWithMe: true };
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useCollaboratorAccessCheck());

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current.revoked).toBe(false);
  });

  it('stops polling after revocation is detected', async function stopsAfterRevoke() {
    mockStore.currentAppId = 'app-shared';
    mockStore.site = { sharedWithMe: true };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 404 });

    renderHook(() => useCollaboratorAccessCheck());

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('cleans up interval on unmount', async function cleanupOnUnmount() {
    mockStore.currentAppId = 'app-shared';
    mockStore.site = { sharedWithMe: true };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 200 });

    const { unmount } = renderHook(() => useCollaboratorAccessCheck());

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

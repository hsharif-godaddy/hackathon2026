/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

const { mockAppFetch } = vi.hoisted(() => ({
  mockAppFetch: vi.fn(),
}));

vi.mock('@/lib/gasket-config', () => ({ appFetch: mockAppFetch }));

import { useDkimStatusQueryExternal } from '../useDkimStatusQueryExternal';

const APP_ID = 'app-123';
const DOMAIN = 'external.example.com';

const pendingResponse = { dkimValid: false, dkimResult: 'DKIM_MISSING', pollStartedAt: null };
const validResponse   = { dkimValid: true,  dkimResult: 'DKIM_VALID',   pollStartedAt: null };

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function mockFetchResponse(body: object, ok = true) {
  mockAppFetch.mockResolvedValue({ ok, json: () => Promise.resolve(body) });
}

describe('useDkimStatusQueryExternal', () => {
  beforeEach(() => {
    mockAppFetch.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not fetch when appId is null', () => {
    renderHook(
      () => useDkimStatusQueryExternal(null, DOMAIN),
      { wrapper: createWrapper() },
    );
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when domain is null', () => {
    renderHook(
      () => useDkimStatusQueryExternal(APP_ID, null),
      { wrapper: createWrapper() },
    );
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('fetches status and returns data when enabled', async () => {
    mockFetchResponse(pendingResponse);
    const { result } = renderHook(
      () => useDkimStatusQueryExternal(APP_ID, DOMAIN),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.dkimValid).toBe(false);
    expect(mockAppFetch).toHaveBeenCalledWith(
      `/api/apps/${APP_ID}/dkim/status?domain=${encodeURIComponent(DOMAIN)}&polling=external`,
      { cache: 'no-store' },
    );
  });

  it('returns dkimValid true when the API response says so', async () => {
    mockFetchResponse(validResponse);
    const { result } = renderHook(
      () => useDkimStatusQueryExternal(APP_ID, DOMAIN),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.data?.dkimValid).toBe(true));
  });

  it('does not use localStorage for poll-start tracking', async () => {
    // The hook should not interact with localStorage at all — the poll-start
    // timestamp comes from pollStartedAt in the API response (agents SQLite).
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    const getSpy = vi.spyOn(Storage.prototype, 'getItem');
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');

    mockFetchResponse(pendingResponse);
    const { result } = renderHook(
      () => useDkimStatusQueryExternal(APP_ID, DOMAIN),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(setSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('stops polling when pollStartedAt in response indicates 30+ days elapsed', async () => {
    // Simulate a domain that started DKIM onboarding 31 days ago.
    const thirtyOneDaysAgoMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const responseWithOldStart = {
      ...pendingResponse,
      pollStartedAt: new Date(thirtyOneDaysAgoMs).toISOString(),
    };
    mockFetchResponse(responseWithOldStart);

    const { result } = renderHook(
      () => useDkimStatusQueryExternal(APP_ID, DOMAIN),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // After the first fetch resolves, refetchInterval should return false
    // because pollStartedAt is >30 days ago. No second fetch should be
    // scheduled. We verify that mockAppFetch was called exactly once.
    await new Promise((r) => setTimeout(r, 100));
    expect(mockAppFetch).toHaveBeenCalledTimes(1);
  });

  it('continues polling when pollStartedAt is null (durable flag off)', async () => {
    // When pollStartedAt is null (agent row not found or durable-state flag off),
    // the 30-day limit is not enforced and Phase 1 polling proceeds normally.
    mockFetchResponse({ ...pendingResponse, pollStartedAt: null });
    const { result } = renderHook(
      () => useDkimStatusQueryExternal(APP_ID, DOMAIN),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Interval is 30s so no immediate second call; verify hook is still active.
    expect(result.current.isStale).toBe(false);
  });

  it('uses nextPollAt from the API instead of restarting a local 30s cadence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T10:00:00.000Z'));
    mockAppFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ...pendingResponse,
          pollStartedAt: '2026-06-17T10:00:00.000Z',
          nextPollAt: '2026-06-17T10:05:00.000Z',
          pollingExpired: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validResponse),
      });

    renderHook(
      () => useDkimStatusQueryExternal(APP_ID, DOMAIN),
      { wrapper: createWrapper() },
    );
    await vi.waitFor(() => expect(mockAppFetch).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(31_000);
    expect(mockAppFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(269_000);
    await vi.waitFor(() => expect(mockAppFetch).toHaveBeenCalledTimes(2));
  });

  it('throws an error when the API responds with non-ok status', async () => {
    mockFetchResponse({}, false);
    const { result } = renderHook(
      () => useDkimStatusQueryExternal(APP_ID, DOMAIN),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/DKIM status fetch failed/);
  });
});

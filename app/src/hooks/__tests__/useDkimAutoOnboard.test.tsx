/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

const mockAppFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/gasket-config', () => ({ appFetch: mockAppFetch }));

const mockShipAnalyticsLog = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logging', () => ({ shipAnalyticsLog: mockShipAnalyticsLog }));

vi.mock('@/lib/dkim/types', () => ({
  DkimErrorCode: {
    DOMAIN_NOT_READY: 'DKIM_DOMAIN_NOT_READY',
    ONBOARD_FAILED: 'DKIM_ONBOARD_FAILED',
    OFFBOARD_FAILED: 'DKIM_OFFBOARD_FAILED',
  },
}));

import { useDkimAutoOnboard } from '../useDkimAutoOnboard';

beforeEach(() => {
  vi.clearAllMocks();
  mockAppFetch.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDkimAutoOnboard', () => {
  it('POSTs onboard when enabled with a domain', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true }));
    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/apps/aaaaaaaaaa/dkim/onboard',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ domain: 'acme.com' }) }),
    );
  });

  it('POSTs for external domains too (origin check is server-side)', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'external.com', enabled: true }));
    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/apps/aaaaaaaaaa/dkim/onboard',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ domain: 'external.com' }) }),
    );
  });

  it('does NOT POST when disabled', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: false }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('does NOT POST when appId is missing', () => {
    renderHook(() => useDkimAutoOnboard({ appId: null, domain: 'acme.com', enabled: true }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('does NOT POST when domain is missing', () => {
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: null, enabled: true }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('fires once per mount and logs network errors via shipAnalyticsLog', async () => {
    mockAppFetch.mockRejectedValue(new Error('network'));
    const { rerender } = renderHook(
      (props) => useDkimAutoOnboard(props),
      { initialProps: { appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true } },
    );
    rerender({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true });
    await act(async () => { await Promise.resolve(); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('dkim.auto-onboard.failed', expect.objectContaining({ domain: 'acme.com' }));
  });

  it('logs via shipAnalyticsLog when the onboard response is not ok', async () => {
    mockAppFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(null) });
    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true }));
    await act(async () => { await Promise.resolve(); });
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('dkim.auto-onboard.failed', expect.objectContaining({ status: 500 }));
  });

  it('retries a 5xx failure once after three minutes', async () => {
    vi.useFakeTimers();
    mockAppFetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve(null) })
      .mockResolvedValueOnce({ ok: true });

    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000 - 1); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mockAppFetch).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000); });
    expect(mockAppFetch).toHaveBeenCalledTimes(2);
  });

  it('retries a 404 DOMAIN_NOT_READY (propagation lag) once after three minutes', async () => {
    vi.useFakeTimers();
    mockAppFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ code: 'DKIM_DOMAIN_NOT_READY' }),
      })
      .mockResolvedValueOnce({ ok: true });

    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000 - 1); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mockAppFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a plain 404 without DOMAIN_NOT_READY code', async () => {
    vi.useFakeTimers();
    mockAppFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ code: 'SITE_NOT_FOUND' }),
    });

    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a permanent 403 (domain not attached)', async () => {
    vi.useFakeTimers();
    mockAppFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve(null) });

    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a permanent 400 (bad request)', async () => {
    vi.useFakeTimers();
    mockAppFetch.mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve(null) });

    renderHook(() => useDkimAutoOnboard({ appId: 'aaaaaaaaaa', domain: 'acme.com', enabled: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000); });
    expect(mockAppFetch).toHaveBeenCalledTimes(1);
  });
});

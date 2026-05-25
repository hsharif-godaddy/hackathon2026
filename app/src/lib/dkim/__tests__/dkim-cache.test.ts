import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDkimCache,getDkimStatusCached } from '../dkim-cache';
import type { DkimStatusResponse } from '../types';

const mockGetDkimStatus = vi.hoisted(() => vi.fn());
vi.mock('../mail-flow-client', () => ({
  MailFlowClient: vi.fn(() => ({ getDkimStatus: mockGetDkimStatus })),
}));

const validStatus: DkimStatusResponse = {
  dkimValid: true,
  dkimResult: 'DKIM_VALID',
};

describe('getDkimStatusCached', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearDkimCache();
    mockGetDkimStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches on first call (hard miss)', async () => {
    mockGetDkimStatus.mockResolvedValueOnce(validStatus);
    const result = await getDkimStatusCached('example.com');
    expect(result).toEqual(validStatus);
    expect(mockGetDkimStatus).toHaveBeenCalledOnce();
  });

  it('returns cached value within soft TTL (5s)', async () => {
    mockGetDkimStatus.mockResolvedValue(validStatus);
    await getDkimStatusCached('example.com');
    vi.advanceTimersByTime(4000);
    await getDkimStatusCached('example.com');
    expect(mockGetDkimStatus).toHaveBeenCalledTimes(1);
  });

  it('returns stale immediately and revalidates in background after soft TTL', async () => {
    mockGetDkimStatus.mockResolvedValue(validStatus);
    await getDkimStatusCached('example.com');
    vi.advanceTimersByTime(6000);
    const result = await getDkimStatusCached('example.com'); // returns stale immediately
    expect(result).toEqual(validStatus);
    await vi.runAllTimersAsync();
    expect(mockGetDkimStatus).toHaveBeenCalledTimes(2);
  });

  it('serves stale on fetch error within max-stale window', async () => {
    mockGetDkimStatus.mockResolvedValueOnce(validStatus);
    await getDkimStatusCached('example.com');
    vi.advanceTimersByTime(6000);
    mockGetDkimStatus.mockRejectedValueOnce(new Error('network'));
    const result = await getDkimStatusCached('example.com');
    expect(result).toEqual(validStatus);
  });

  it('throws on hard miss when fetch fails', async () => {
    mockGetDkimStatus.mockRejectedValueOnce(new Error('network'));
    await expect(getDkimStatusCached('neverloaded.com')).rejects.toThrow('network');
  });

  it('single-flights concurrent cold-miss reads for the same domain', async () => {
    // N concurrent first-paint readers must share ONE upstream call.
    // Without single-flight, each Promise.all leg would issue its own
    // mail-flow request, multiplying load by tab-count.
    let resolveUpstream: (v: typeof validStatus) => void = () => {};
    const upstream = new Promise<typeof validStatus>((resolve) => {
      resolveUpstream = resolve;
    });
    mockGetDkimStatus.mockReturnValueOnce(upstream);

    const reads = [
      getDkimStatusCached('coldmiss.com'),
      getDkimStatusCached('coldmiss.com'),
      getDkimStatusCached('coldmiss.com'),
    ];
    // All three readers are now waiting on the same in-flight promise.
    expect(mockGetDkimStatus).toHaveBeenCalledOnce();

    resolveUpstream(validStatus);
    const results = await Promise.all(reads);
    expect(results).toEqual([validStatus, validStatus, validStatus]);
    expect(mockGetDkimStatus).toHaveBeenCalledOnce();
  });

  it('single-flights concurrent stale revalidates for the same domain', async () => {
    // First read populates cache.
    mockGetDkimStatus.mockResolvedValueOnce(validStatus);
    await getDkimStatusCached('domain.com');
    expect(mockGetDkimStatus).toHaveBeenCalledTimes(1);

    // Past soft TTL → both reads return stale + trigger revalidate.
    vi.advanceTimersByTime(6000);

    // Hold the second upstream call mid-flight.
    let resolveUpstream: (v: typeof validStatus) => void = () => {};
    const upstream = new Promise<typeof validStatus>((resolve) => {
      resolveUpstream = resolve;
    });
    mockGetDkimStatus.mockReturnValueOnce(upstream);

    // Two concurrent stale reads → only ONE revalidate call, not two.
    await getDkimStatusCached('domain.com');
    await getDkimStatusCached('domain.com');

    expect(mockGetDkimStatus).toHaveBeenCalledTimes(2); // 1 cold + 1 revalidate

    resolveUpstream(validStatus);
    await vi.runAllTimersAsync();
    expect(mockGetDkimStatus).toHaveBeenCalledTimes(2); // still 2; no duplicate revalidate
  });

  it('clears the in-flight slot after a failed cold miss so retry can fire', async () => {
    mockGetDkimStatus.mockRejectedValueOnce(new Error('network'));
    await expect(getDkimStatusCached('failed.com')).rejects.toThrow('network');

    // The next call should trigger a fresh upstream fetch (not reuse the
    // rejected promise). This is what the inflight.delete in the finally
    // block guarantees.
    mockGetDkimStatus.mockResolvedValueOnce(validStatus);
    const result = await getDkimStatusCached('failed.com');
    expect(result).toEqual(validStatus);
    expect(mockGetDkimStatus).toHaveBeenCalledTimes(2);
  });
});

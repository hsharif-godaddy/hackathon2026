/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pollPublishStatus } from '../publish-polling';

vi.mock('@/lib/request-context', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

describe('pollPublishStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetchResponses(...responses: Array<{ status: number; body: unknown }>) {
    const fetchMock = vi.mocked(fetch);
    for (const r of responses) {
      fetchMock.mockResolvedValueOnce({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: () => Promise.resolve(r.body),
      } as Response);
    }
  }

  it('resolves with deployed when phase is deployed', async () => {
    mockFetchResponses(
      { status: 200, body: { phase: 'building' } },
      { status: 200, body: { phase: 'deploying', commitHash: 'abc123' } },
      { status: 200, body: { phase: 'deployed', commitHash: 'abc123', version: 'v1' } },
    );

    const promise = pollPublishStatus('http://agent', 'app-1', 'tok', { intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toEqual({ phase: 'deployed', commitHash: 'abc123', version: 'v1' });
  });

  it('resolves with failed when phase is failed', async () => {
    mockFetchResponses(
      { status: 200, body: { phase: 'failed', error: 'Build timed out', logs: ['err line'] } },
    );

    const result = await pollPublishStatus('http://agent', 'app-1', 'tok', { intervalMs: 100 });
    expect(result).toEqual({ phase: 'failed', error: 'Build timed out', logs: ['err line'], buildTimeoutSeconds: undefined });
  });

  it('resolves with timeout after deadline', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ phase: 'building' }),
    } as Response);

    const promise = pollPublishStatus('http://agent', 'app-1', 'tok', {
      intervalMs: 1000,
      timeoutMs: 3000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.phase).toBe('timeout');
  });

  it('retries on network error', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ phase: 'deployed', commitHash: 'abc', version: 'v2' }),
    } as Response);

    const promise = pollPublishStatus('http://agent', 'app-1', 'tok', { intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result.phase).toBe('deployed');
  });

  it('calls refreshToken on 401 and retries', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ phase: 'deployed', commitHash: 'x', version: 'v3' }),
    } as Response);

    const refreshToken = vi.fn().mockResolvedValue({ token: 'new-tok' });

    const promise = pollPublishStatus('http://agent', 'app-1', 'tok', {
      intervalMs: 100,
      refreshToken,
    });

    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(result.phase).toBe('deployed');
  });

  it('resolves with failed when response has no phase and no source (job evicted)', async () => {
    mockFetchResponses(
      { status: 200, body: {} },
    );

    const result = await pollPublishStatus('http://agent', 'app-1', 'tok', { intervalMs: 100 });
    expect(result.phase).toBe('failed');
    expect(result.error).toContain('agent may have restarted');
  });

  it('keeps polling when supervisor reports healthy+running (no version verification)', async () => {
    mockFetchResponses(
      { status: 200, body: { source: 'supervisor', version: 'v5', health: { status: 'healthy' }, process: { state: 'running' } } },
      { status: 200, body: { phase: 'deployed', commitHash: 'v5', version: 'v5' } },
    );

    const promise = pollPublishStatus('http://agent', 'app-1', 'tok', { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toEqual({ phase: 'deployed', commitHash: 'v5', version: 'v5' });
  });

  it('resolves with failed when supervisor reports unhealthy container', async () => {
    mockFetchResponses(
      { status: 200, body: { source: 'supervisor', version: 'v5', health: { status: 'unhealthy' }, process: { state: 'running' } } },
    );

    const result = await pollPublishStatus('http://agent', 'app-1', 'tok', { intervalMs: 100 });
    expect(result.phase).toBe('failed');
    expect(result.error).toContain('not healthy');
  });

  it('keeps polling when supervisor reports starting then healthy', async () => {
    mockFetchResponses(
      { status: 200, body: { source: 'supervisor', health: { status: 'unknown' }, process: { state: 'starting' } } },
      { status: 200, body: { source: 'supervisor', version: 'v6', health: { status: 'healthy' }, process: { state: 'running' } } },
      { status: 200, body: { phase: 'deployed', commitHash: 'v6', version: 'v6' } },
    );

    const promise = pollPublishStatus('http://agent', 'app-1', 'tok', { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result).toEqual({ phase: 'deployed', commitHash: 'v6', version: 'v6' });
  });

  it('resolves with aborted when signal fires', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ phase: 'building' }),
    } as Response);

    const controller = new AbortController();
    const promise = pollPublishStatus('http://agent', 'app-1', 'tok', {
      intervalMs: 100,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result.phase).toBe('aborted');
  });
});

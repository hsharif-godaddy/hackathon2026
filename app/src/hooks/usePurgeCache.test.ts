/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { PurgeErrorCode, PurgeStatus, usePurgeCache } from './usePurgeCache';

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

const mockAppFetch = vi.mocked((await import('@/lib/gasket-config')).appFetch);

describe('usePurgeCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with idle state', function initState() {
    const { result } = renderHook(() => usePurgeCache('test-app'));

    expect(result.current.status).toBe(PurgeStatus.IDLE);
    expect(result.current.errorCode).toBeNull();
    expect(result.current.trigger).toBeDefined();
  });

  it('should not trigger when appId is null', async function nullAppId() {
    const { result } = renderHook(() => usePurgeCache(null));

    await act(async () => {
      await result.current.trigger();
    });

    expect(mockAppFetch).not.toHaveBeenCalled();
    expect(result.current.status).toBe(PurgeStatus.IDLE);
  });

  it('should reach success when first poll returns success', async function immediateSuccess() {
    mockAppFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobId: 'purge-job-123' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 'success' }),
      } as unknown as Response);

    const { result } = renderHook(() => usePurgeCache('test-app'));

    await act(async () => {
      await result.current.trigger();
    });

    expect(mockAppFetch).toHaveBeenCalledWith('/api/apps/test-app/purge-cache', {
      method: 'POST',
    });
    expect(mockAppFetch).toHaveBeenCalledWith('/api/jobs/purge-job-123');
    expect(result.current.status).toBe(PurgeStatus.SUCCESS);
    expect(result.current.errorCode).toBeNull();
  });

  it('should handle purge trigger error response', async function triggerError() {
    mockAppFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({ error: 'App is not active' }),
    } as unknown as Response);

    const { result } = renderHook(() => usePurgeCache('test-app'));

    await act(async () => {
      await result.current.trigger();
    });

    expect(result.current.status).toBe(PurgeStatus.ERROR);
    expect(result.current.errorCode).toBe(PurgeErrorCode.TRIGGER_FAILED);
  });

  it('should handle job failure status', async function jobFailure() {
    mockAppFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobId: 'purge-job-fail' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'failure',
          errorMessage: 'CDN cache purge failed',
        }),
      } as unknown as Response);

    const { result } = renderHook(() => usePurgeCache('test-app'));

    await act(async () => {
      await result.current.trigger();
    });

    expect(result.current.status).toBe(PurgeStatus.FAILURE);
    expect(result.current.errorCode).toBe(PurgeErrorCode.JOB_FAILED);
  });

  it('should handle network error during trigger', async function networkError() {
    mockAppFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => usePurgeCache('test-app'));

    await act(async () => {
      await result.current.trigger();
    });

    expect(result.current.status).toBe(PurgeStatus.ERROR);
    expect(result.current.errorCode).toBe(PurgeErrorCode.TRIGGER_FAILED);
  });

  it('should handle poll response failure', async function pollError() {
    mockAppFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobId: 'purge-job-poll-err' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as unknown as Response);

    const { result } = renderHook(() => usePurgeCache('test-app'));

    await act(async () => {
      await result.current.trigger();
    });

    expect(result.current.status).toBe(PurgeStatus.ERROR);
    expect(result.current.errorCode).toBe(PurgeErrorCode.POLL_FAILED);
  });

  it('should return JOB_FAILED error code when job fails without errorMessage', async function defaultFailure() {
    mockAppFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobId: 'purge-job-no-msg' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 'failure' }),
      } as unknown as Response);

    const { result } = renderHook(() => usePurgeCache('test-app'));

    await act(async () => {
      await result.current.trigger();
    });

    expect(result.current.status).toBe(PurgeStatus.FAILURE);
    expect(result.current.errorCode).toBe(PurgeErrorCode.JOB_FAILED);
  });

  it('should schedule polling when job is in_progress', async function schedulesPolling() {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    mockAppFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobId: 'purge-job-progress' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 'in_progress' }),
      } as unknown as Response);

    const { result } = renderHook(() => usePurgeCache('test-app'));

    await act(async () => {
      await result.current.trigger();
    });

    await waitFor(() => {
      expect(result.current.status).toBe(PurgeStatus.POLLING);
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000);

    setTimeoutSpy.mockRestore();
  });

  it('should transition to error when MAX_POLL_DURATION_MS is exceeded', async function pollTimeout() {
    // Capture setTimeout callbacks so we can invoke them manually
    let capturedCallback: (() => void) | null = null;
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      capturedCallback = fn;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const dateNowSpy = vi.spyOn(Date, 'now');
    const startTime = 1000000;
    dateNowSpy.mockReturnValue(startTime);

    mockAppFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobId: 'purge-job-timeout' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 'in_progress' }),
      } as unknown as Response);

    const { result } = renderHook(() => usePurgeCache('test-app'));

    await act(async () => {
      await result.current.trigger();
    });

    // First poll returned in_progress and captured a setTimeout callback
    expect(capturedCallback).not.toBeNull();

    // Advance Date.now past 5-minute timeout before invoking the next poll
    dateNowSpy.mockReturnValue(startTime + 5 * 60 * 1000 + 1);

    await act(async () => {
      capturedCallback!();
    });

    expect(result.current.status).toBe(PurgeStatus.ERROR);
    expect(result.current.errorCode).toBe(PurgeErrorCode.TIMEOUT);

    setTimeoutSpy.mockRestore();
    dateNowSpy.mockRestore();
  });
});

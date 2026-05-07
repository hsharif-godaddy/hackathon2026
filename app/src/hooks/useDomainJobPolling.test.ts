/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-hooks/rules-of-hooks -- renderHook callback is the test harness */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import {
  domainJobQueryKey,
  getDomainJobPollRefetchInterval,
  parseJobResponse,
  useDomainJobPolling,
} from './useDomainJobPolling';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useDomainJobPolling', function useDomainJobPollingSuite() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockLoggerWarn.mockClear();
  });

  describe('#domainJobQueryKey', function queryKeyTests() {
    it('should normalize fqdn to trimmed lowercase', function normalizesFqdn() {
      expect(domainJobQueryKey('site-1', '  ExAmple.COM ')).toEqual([
        'domain-job',
        'site-1',
        'example.com',
      ]);
    });
  });

  describe('#parseJobResponse', function parseTests() {
    it('should read current from dynamic.current', function dynamicCurrent() {
      expect(
        parseJobResponse({
          overallStatus: 'RUNNING',
          dynamic: {
            current: {
              id: 's1',
              label: 'builder_domain_job_configuring_dns',
              status: 'RUNNING',
            },
          },
        }),
      ).toEqual({
        labelKey: 'builder_domain_job_configuring_dns',
        status: 'RUNNING',
        overallStatus: 'RUNNING',
      });
    });

    it('should read current from top-level body.current', function topLevelCurrent() {
      expect(
        parseJobResponse({
          overallStatus: 'RUNNING',
          current: {
            label: 'builder_domain_job_verifying_domain',
            status: 'RUNNING',
          },
        }),
      ).toEqual({
        labelKey: 'builder_domain_job_verifying_domain',
        status: 'RUNNING',
        overallStatus: 'RUNNING',
      });
    });

    it('should prefer dynamic.current over top-level current', function prefersDynamic() {
      expect(
        parseJobResponse({
          overallStatus: 'RUNNING',
          current: { label: 'old', status: 'RUNNING' },
          dynamic: {
            current: { label: 'builder_domain_job_starting_connection', status: 'RUNNING' },
          },
        }),
      ).toEqual({
        labelKey: 'builder_domain_job_starting_connection',
        status: 'RUNNING',
        overallStatus: 'RUNNING',
      });
    });

    it('should handle null current when job is complete', function nullCurrentComplete() {
      expect(
        parseJobResponse({
          overallStatus: 'SUCCESS',
          dynamic: { current: null, steps: [], stepDefinitions: [] },
        }),
      ).toEqual({
        labelKey: null,
        status: null,
        overallStatus: 'SUCCESS',
      });
    });
  });

  describe('#getDomainJobPollRefetchInterval', function refetchIntervalTests() {
    it('should return false when disabled', function disabled() {
      expect(getDomainJobPollRefetchInterval(false, undefined, Date.now(), Date.now())).toBe(false);
    });

    it('should return false when query is in error state', function queryError() {
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: null, status: null, overallStatus: null },
          Date.now() - 1_000,
          Date.now(),
          { hasError: true },
        ),
      ).toBe(false);
    });

    it('should return false on terminal step or overall status', function terminal() {
      const now = 1_000_000;
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: null, status: 'SUCCESS', overallStatus: 'RUNNING' },
          now - 10_000,
          now,
        ),
      ).toBe(false);
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: null, status: 'FAILED', overallStatus: 'RUNNING' },
          now - 10_000,
          now,
        ),
      ).toBe(false);
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: null, status: null, overallStatus: 'SUCCESS' },
          now - 10_000,
          now,
        ),
      ).toBe(false);
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: null, status: null, overallStatus: 'FAILED' },
          now - 10_000,
          now,
        ),
      ).toBe(false);
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: null, status: null, overallStatus: 'NOT_FOUND' },
          now - 10_000,
          now,
        ),
      ).toBe(false);
    });

    it('should keep polling for unknown non-terminal status', function unknownStatus() {
      const now = 2_000_000;
      const started = now - 10_000;
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: 'k', status: 'QUEUED', overallStatus: 'RUNNING' },
          started,
          now,
        ),
      ).toBe(5_000);
    });

    it('should use 5s then 30s after backoff threshold', function adaptive() {
      const started = 1_000_000;
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: null, status: 'RUNNING', overallStatus: 'RUNNING' },
          started,
          started + 30_000,
        ),
      ).toBe(5_000);
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: null, status: 'RUNNING', overallStatus: 'RUNNING' },
          started,
          started + 61_000,
        ),
      ).toBe(30_000);
    });

    it('should stop after max poll duration and invoke timeout callback', function maxPollDuration() {
      const onPollTimeout = vi.fn();
      const started = 1_000_000;
      const maxMs = 5 * 60 * 1000;
      expect(
        getDomainJobPollRefetchInterval(
          true,
          { labelKey: null, status: 'RUNNING', overallStatus: 'RUNNING' },
          started,
          started + maxMs,
          { maxPollDurationMs: maxMs, onPollTimeout },
        ),
      ).toBe(false);
      expect(onPollTimeout).toHaveBeenCalledWith(maxMs);
    });
  });

  describe('#useDomainJobPolling', function hookTests() {
    it('should poll while status is RUNNING', async function pollsWhileRunning() {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          overallStatus: 'RUNNING',
          dynamic: {
            current: { label: 'builder_domain_job_configuring_dns', status: 'RUNNING' },
          },
        }),
      } as Response);

      vi.useFakeTimers();

      renderHook(() => useDomainJobPolling('site-a', 'example.com', true), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await Promise.resolve();
      });
      const initialCalls = fetchMock.mock.calls.length;
      expect(initialCalls).toBeGreaterThanOrEqual(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
        await Promise.resolve();
      });

      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls);

      vi.useRealTimers();
    });

    it('should stop refetch after SUCCESS', async function stopsOnSuccess() {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          overallStatus: 'SUCCESS',
          dynamic: { current: null, steps: [], stepDefinitions: [] },
        }),
      } as Response);

      vi.useFakeTimers();

      renderHook(() => useDomainJobPolling('site-b', 'done.com', true), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should stop refetch after FAILED', async function stopsOnFailed() {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          overallStatus: 'FAILED',
          dynamic: {
            current: { label: 'builder_domain_job_configuring_dns', status: 'FAILED' },
          },
        }),
      } as Response);

      vi.useFakeTimers();

      renderHook(() => useDomainJobPolling('site-c', 'bad.com', true), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should not fetch when disabled', function disabledNoFetch() {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ overallStatus: 'RUNNING' }),
      } as Response);

      renderHook(() => useDomainJobPolling('site-d', 'x.com', false), {
        wrapper: createWrapper(),
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should treat 404 as terminal without error', async function notFoundTerminal() {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ code: 'DOMAIN_ERROR_NOT_FOUND' }),
      } as Response);

      const { result } = renderHook(() => useDomainJobPolling('site-not-found', 'gone.com', true), {
        wrapper: createWrapper(),
      });

      await act(async function settle() {
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      await waitFor(function waitForNotFound() {
        expect(result.current.overallStatus).toBe('NOT_FOUND');
        expect(result.current.error).toBe(null);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should treat SITE_NOT_FOUND 404 as error', async function siteNotFoundError() {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ code: 'SITE_NOT_FOUND' }),
      } as Response);

      const { result } = renderHook(() => useDomainJobPolling('missing-site', 'gone.com', true), {
        wrapper: createWrapper(),
      });

      await waitFor(function waitForError() {
        expect(result.current.error).not.toBe(null);
      });
      expect(result.current.overallStatus).toBe(null);
    });

    it('should surface non-404 http errors', async function non404Error() {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const { result } = renderHook(() => useDomainJobPolling('site-error', 'err.com', true), {
        wrapper: createWrapper(),
      });

      await waitFor(function waitForError() {
        expect(result.current.error).not.toBe(null);
      });
      expect(result.current.overallStatus).toBe(null);
    });

    it('should stop polling after max duration and log timeout', async function maxPollHook() {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          overallStatus: 'RUNNING',
          dynamic: {
            current: { label: 'builder_domain_job_configuring_dns', status: 'RUNNING' },
          },
        }),
      } as Response);

      vi.useFakeTimers();

      renderHook(() => useDomainJobPolling('site-timeout', 'stuck.com', true), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await Promise.resolve();
      });
      const callsAfterInitial = fetchMock.mock.calls.length;
      expect(callsAfterInitial).toBeGreaterThanOrEqual(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1_000);
        await Promise.resolve();
      });

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'domain-job-poll.timeout',
        expect.objectContaining({
          siteId: 'site-timeout',
          fqdn: 'stuck.com',
          elapsed: expect.any(Number),
        }),
      );

      const callsAfterTimeout = fetchMock.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
        await Promise.resolve();
      });
      expect(fetchMock.mock.calls.length).toBe(callsAfterTimeout);

      vi.useRealTimers();
    });
  });

});

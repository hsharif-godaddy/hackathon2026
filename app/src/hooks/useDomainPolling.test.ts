import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * @vitest-environment jsdom
 */
import { DomainStatus } from '@/lib/mgmt-airo/types';
import { renderHookWithProviders } from '@/tests/test-utils';

// Capture the refetchInterval function passed to useAppDetails so we can test it directly.
let capturedRefetchInterval: ((data: any) => number | false) | undefined;
const mockUseAppDetails = vi.fn((_siteId: string, options: any) => {
  capturedRefetchInterval = options?.refetchInterval;
  return { data: undefined, isFetched: false };
});

vi.mock('@/hooks/useAppDetails', () => ({
  useAppDetails: (...args: any[]) => mockUseAppDetails(...args),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useDomainPolling } from './useDomainPolling';

const MIN = 60_000;

function interval(data: any): number | false {
  if (!capturedRefetchInterval) throw new Error('refetchInterval not captured');
  return capturedRefetchInterval(data);
}

function makeData(domains: any[]) {
  return { domains };
}

describe('useDomainPolling', function pollingTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    capturedRefetchInterval = undefined;
  });

  describe('enabled flag', function enabledTests() {
    it('does not fetch when appId is null', function noFetchNull() {
      renderHookWithProviders(() => useDomainPolling(null));
      expect(mockUseAppDetails).toHaveBeenCalledWith(null, expect.objectContaining({ enabled: false }));
    });

    it('does not fetch when appId is undefined', function noFetchUndefined() {
      renderHookWithProviders(() => useDomainPolling(undefined));
      expect(mockUseAppDetails).toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: false }));
    });

    it('fetches when appId is provided', function fetchesWithAppId() {
      renderHookWithProviders(() => useDomainPolling('app-123'));
      expect(mockUseAppDetails).toHaveBeenCalledWith('app-123', expect.objectContaining({ enabled: true }));
    });
  });

  describe('refetchInterval — stops polling', function stopTests() {
    beforeEach(function mount() {
      renderHookWithProviders(() => useDomainPolling('app-123'));
    });

    it('returns false when data is undefined', function noDataFalse() {
      expect(interval(undefined)).toBe(false);
    });

    it('returns false when domains array is empty', function emptyFalse() {
      expect(interval(makeData([]))).toBe(false);
    });

    it('returns false when all domains are prefix type', function prefixFalse() {
      expect(interval(makeData([
        { domainType: 'prefix', status: DomainStatus.PENDING },
      ]))).toBe(false);
    });

    it('returns false for ACTIVE domain', function activeFalse() {
      expect(interval(makeData([
        { domainType: null, status: DomainStatus.ACTIVE },
      ]))).toBe(false);
    });

    it('returns false for ACTIVE domain regardless of cdnStatus', function activeFalseAnycdn() {
      // ACTIVE is terminal; cdnStatus on an ACTIVE domain is stale and ignored.
      expect(interval(makeData([
        { domainType: null, status: DomainStatus.ACTIVE, cdnStatus: 2 /* PENDING */ },
      ]))).toBe(false);
    });

    it('returns false for unknown terminal status strings from the API', function unknownStatusFalse() {
      // DomainStatus enum only has PENDING/ACTIVE/DELETING; the API can return 'error'/'failed'/etc.
      // These don't match any polling condition and must not trigger a poll.
      expect(interval(makeData([{ domainType: null, status: 'error' }]))).toBe(false);
      expect(interval(makeData([{ domainType: null, status: 'failed' }]))).toBe(false);
      expect(interval(makeData([{ domainType: null, status: 'inactive' }]))).toBe(false);
    });
  });

  describe('refetchInterval — continues polling', function continueTests() {
    beforeEach(function mount() {
      renderHookWithProviders(() => useDomainPolling('app-123'));
    });

    it('returns an interval for domain with no status (just created)', function noStatusPolls() {
      expect(interval(makeData([
        { domainType: null, status: null },
      ]))).toBeGreaterThan(0);
    });

    it('returns an interval for PENDING domain', function pendingPolls() {
      expect(interval(makeData([
        { domainType: null, status: DomainStatus.PENDING },
      ]))).toBeGreaterThan(0);
    });

    it('returns an interval for DELETING domain', function deletingPolls() {
      expect(interval(makeData([
        { domainType: null, status: DomainStatus.DELETING },
      ]))).toBeGreaterThan(0);
    });

    it('polls when at least one domain is pending alongside an active domain', function mixedPolls() {
      expect(interval(makeData([
        { domainType: null, status: DomainStatus.ACTIVE },
        { domainType: null, status: DomainStatus.PENDING },
      ]))).toBeGreaterThan(0);
    });
  });

  describe('refetchInterval — hasActiveJob override', function activeJobTests() {
    it('polls when hasActiveJob is true even if domains array is empty', function activeJobEmptyDomains() {
      renderHookWithProviders(() => useDomainPolling('app-123', { hasActiveJob: true }));
      expect(interval(makeData([]))).toBeGreaterThan(0);
    });

    it('polls when hasActiveJob is true even if data is undefined', function activeJobNoData() {
      renderHookWithProviders(() => useDomainPolling('app-123', { hasActiveJob: true }));
      expect(interval(undefined)).toBeGreaterThan(0);
    });

    it('polls when hasActiveJob is true even if all domains are terminal', function activeJobTerminalDomains() {
      renderHookWithProviders(() => useDomainPolling('app-123', { hasActiveJob: true }));
      expect(interval(makeData([
        { domainType: null, status: DomainStatus.ACTIVE },
      ]))).toBeGreaterThan(0);
    });

    it('does not poll when hasActiveJob is false and no pending domains', function noActiveJobStops() {
      renderHookWithProviders(() => useDomainPolling('app-123', { hasActiveJob: false }));
      expect(interval(makeData([
        { domainType: null, status: DomainStatus.ACTIVE },
      ]))).toBe(false);
    });

    it('resets backoff clock when hasActiveJob transitions to false', function activeJobClockReset() {
      vi.useFakeTimers();

      renderHookWithProviders(() => useDomainPolling('app-123', { hasActiveJob: true }));
      const terminal = makeData([{ domainType: null, status: DomainStatus.ACTIVE }]);

      // Advance past the first backoff stage
      vi.advanceTimersByTime(6 * 60_000);
      expect(interval(terminal)).toBe(30_000); // 5-10min stage

      // Simulate hasActiveJob toggling off — re-render with new options
      renderHookWithProviders(() => useDomainPolling('app-123', { hasActiveJob: false }));
      // Polling stops and clock resets
      expect(interval(terminal)).toBe(false);

      // Next pending domain starts fresh at 5s
      renderHookWithProviders(() => useDomainPolling('app-123', { hasActiveJob: false }));
      expect(interval(makeData([{ domainType: null, status: DomainStatus.PENDING }]))).toBe(5_000);

      vi.useRealTimers();
    });
  });

  describe('refetchInterval — backoff stages', function backoffTests() {
    it('returns 5s interval early in polling', function earlyInterval() {
      renderHookWithProviders(() => useDomainPolling('app-123'));
      expect(interval(makeData([{ domainType: null, status: DomainStatus.PENDING }]))).toBe(5_000);
    });

    it('resets clock when polling stops; next pending domain restarts at 5s', function clockReset() {
      renderHookWithProviders(() => useDomainPolling('app-123'));

      expect(interval(makeData([{ domainType: null, status: DomainStatus.ACTIVE }]))).toBe(false);
      expect(interval(makeData([{ domainType: null, status: DomainStatus.PENDING }]))).toBe(5_000);
    });

    it('uses progressively larger intervals based on elapsed time', function backoffProgresses() {
      vi.useFakeTimers();

      renderHookWithProviders(() => useDomainPolling('app-123'));
      const pending = makeData([{ domainType: null, status: DomainStatus.PENDING }]);

      expect(interval(pending)).toBe(5_000);        // 0–5 min
      vi.advanceTimersByTime(5 * MIN);
      expect(interval(pending)).toBe(30_000);       // 5–10 min
      vi.advanceTimersByTime(5 * MIN);
      expect(interval(pending)).toBe(2 * MIN);      // 10–60 min
      vi.advanceTimersByTime(50 * MIN);
      expect(interval(pending)).toBe(10 * MIN);     // 1 hr+

      vi.useRealTimers();
    });
  });
});

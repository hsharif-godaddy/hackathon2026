// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHookWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantType } from '@/types/credits';
import { useCreditThresholdEvents } from './useCreditThresholdEvents';

const mockLogImpressionInner = vi.hoisted(() => vi.fn());
const mockLogImpressionEvent = vi.hoisted(() => vi.fn(function () { return mockLogImpressionInner; }));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: mockLogImpressionEvent,
}));

const mockUseSubscription = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: mockUseSubscription,
}));

const mockUseCreditGrants = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: mockUseCreditGrants,
}));

const mockGetTotalCreditsFromGrants = vi.hoisted(() => vi.fn());
vi.mock('@/utils/credits', () => ({
  getTotalCreditsFromGrants: mockGetTotalCreditsFromGrants,
}));

function makeGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: 'grant-1',
    type: GrantType.PlanMonthly,
    creditsSpent: 0,
    creditsMax: 1000,
    isAvailable: true,
    finalState: null,
    useBefore: null,
    ...overrides,
  } as CreditGrant;
}

function setupMocks({
  subscriptionId = 'sub-abc',
  grants = [makeGrant()],
  isLoading = false,
  totalCreditsSpent = 0,
  totalCreditsMax = 1000,
}: {
  subscriptionId?: string | undefined;
  grants?: CreditGrant[] | undefined;
  isLoading?: boolean;
  totalCreditsSpent?: number;
  totalCreditsMax?: number;
} = {}) {
  mockUseSubscription.mockReturnValue({
    data: subscriptionId ? { id: subscriptionId } : undefined,
  });
  mockUseCreditGrants.mockReturnValue({ data: grants, isLoading });
  mockGetTotalCreditsFromGrants.mockReturnValue({ totalCreditsSpent, totalCreditsMax });
}

describe('useCreditThresholdEvents', function tests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // The module-level `firedThresholds` Set persists across tests in the same
  // module instance, so we reset it by forcing thresholds back above 75% first.
  afterEach(function resetModuleState() {
    setupMocks({ totalCreditsSpent: 0, totalCreditsMax: 1000 });
    renderHookWithProviders(() => useCreditThresholdEvents());
  });

  describe('no-op conditions', function noopTests() {
    it('does not fire when isLoading is true', function loadingGuard() {
      setupMocks({ isLoading: true });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });

    it('does not fire when grants are undefined', function noGrants() {
      setupMocks({ grants: undefined });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });

    it('does not fire when subscription id is undefined', function noSubscription() {
      setupMocks({ subscriptionId: undefined });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });

    it('does not fire when totalCreditsMax is zero', function zeroMax() {
      setupMocks({ totalCreditsMax: 0 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });

    it('does not fire when remaining percent is above all thresholds (e.g. 80%)', function aboveAll() {
      setupMocks({ totalCreditsSpent: 200, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });
  });

  describe('single threshold crossing', function singleThreshold() {
    it('fires credits.threshold.below75 when remaining is 74%', function below75() {
      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below75',
        { isFirstOccurrence: true }
      );
      expect(mockLogImpressionInner).toHaveBeenCalledTimes(1);
    });

    it('fires credits.threshold.below50 when remaining is 49%', function below50() {
      setupMocks({ totalCreditsSpent: 510, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(2);
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below75',
        { isFirstOccurrence: true }
      );
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below50',
        { isFirstOccurrence: true }
      );
    });

    it('fires credits.threshold.below20 when remaining is 19%', function below20() {
      setupMocks({ totalCreditsSpent: 810, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below20',
        { isFirstOccurrence: true }
      );
    });

    it('fires credits.threshold.below10 when remaining is 9%', function below10() {
      setupMocks({ totalCreditsSpent: 910, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below10',
        { isFirstOccurrence: true }
      );
    });

    it('fires credits.threshold.below5 when remaining is 4%', function below5() {
      setupMocks({ totalCreditsSpent: 960, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below5',
        { isFirstOccurrence: true }
      );
    });
  });

  describe('multi-threshold crossing in one update', function multiThreshold() {
    it('fires all crossed thresholds when jumping from 100% to 3% remaining', function jumpToLow() {
      setupMocks({ totalCreditsSpent: 970, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());

      const calledEids = (mockLogImpressionEvent.mock.calls as unknown[][]).map((call) => call[0] as string);
      expect(calledEids).toContain('credits.threshold.below75');
      expect(calledEids).toContain('credits.threshold.below50');
      expect(calledEids).toContain('credits.threshold.below20');
      expect(calledEids).toContain('credits.threshold.below10');
      expect(calledEids).toContain('credits.threshold.below5');
      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(5);
    });

    it('fires only the newly crossed thresholds across two renders', function twoRenders() {
      // First render: 74% remaining → crosses below75 only
      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      const { rerender } = renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);

      // Second render: 18% remaining → crosses below50 + below20 only
      setupMocks({ totalCreditsSpent: 820, totalCreditsMax: 1000 });
      rerender();
      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(3);

      const calledEids = (mockLogImpressionEvent.mock.calls as unknown[][]).map((call) => call[0] as string);
      expect(calledEids).toEqual([
        'credits.threshold.below75',
        'credits.threshold.below50',
        'credits.threshold.below20',
      ]);
    });

    it('does not re-fire thresholds already crossed in the same session', function noDoublefire() {
      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      const { rerender } = renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);

      // Re-render with the same spend — no new thresholds crossed
      rerender();
      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('isFirstOccurrence — persisted vs in-session', function firstOccurrence() {
    it('sets isFirstOccurrence true when localStorage has no record for the threshold', function firstEver() {
      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below75',
        { isFirstOccurrence: true }
      );
    });

    it('sets isFirstOccurrence false when threshold was already persisted in localStorage', function alreadyPersisted() {
      localStorage.setItem('airo_credit_thresholds_sub-abc', JSON.stringify([75]));
      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below75',
        { isFirstOccurrence: false }
      );
    });

    it('persists newly crossed thresholds to localStorage', function persists() {
      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());
      const stored = JSON.parse(localStorage.getItem('airo_credit_thresholds_sub-abc') ?? '[]');
      expect(stored).toContain(75);
    });

    it('accumulates multiple thresholds in localStorage across renders', function accumulates() {
      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      const { rerender } = renderHookWithProviders(() => useCreditThresholdEvents());

      setupMocks({ totalCreditsSpent: 820, totalCreditsMax: 1000 });
      rerender();

      const stored = JSON.parse(localStorage.getItem('airo_credit_thresholds_sub-abc') ?? '[]');
      expect(stored).toContain(75);
      expect(stored).toContain(50);
      expect(stored).toContain(20);
    });

    it('only marks not-yet-persisted thresholds as isFirstOccurrence true when some are already stored', function partialPersist() {
      localStorage.setItem('airo_credit_thresholds_sub-abc', JSON.stringify([75, 50]));
      // 18% remaining — crosses 75, 50, 20; 75 and 50 are already stored
      setupMocks({ totalCreditsSpent: 820, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());

      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below75',
        { isFirstOccurrence: false }
      );
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below50',
        { isFirstOccurrence: false }
      );
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below20',
        { isFirstOccurrence: true }
      );
    });
  });

  describe('reset path (credits replenished)', function resetPath() {
    it('clears in-session firedThresholds and localStorage when remaining >= 75%', function clearsOnReset() {
      localStorage.setItem('airo_credit_thresholds_sub-abc', JSON.stringify([75, 50]));

      // First render: 49% → fires below75, below50
      setupMocks({ totalCreditsSpent: 510, totalCreditsMax: 1000 });
      const { rerender } = renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(2);

      // Credits replenished: 80% remaining → reset
      setupMocks({ totalCreditsSpent: 200, totalCreditsMax: 1000 });
      rerender();
      expect(localStorage.getItem('airo_credit_thresholds_sub-abc')).toBeNull();

      // Spend back down to 74% → should fire again as first occurrence
      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      rerender();
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below75',
        { isFirstOccurrence: true }
      );
    });

    it('does not fire events on the render that triggers the reset', function noEventOnReset() {
      setupMocks({ totalCreditsSpent: 510, totalCreditsMax: 1000 });
      const { rerender } = renderHookWithProviders(() => useCreditThresholdEvents());
      const callsAfterFirst = mockLogImpressionEvent.mock.calls.length;

      setupMocks({ totalCreditsSpent: 50, totalCreditsMax: 1000 });
      rerender();
      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(callsAfterFirst);
    });

    it('respects the 75% boundary exactly (74.9% fires, 75.0% resets)', function exactBoundary() {
      // 75.0% remaining → reset path, no events
      setupMocks({ totalCreditsSpent: 250, totalCreditsMax: 1000 });
      const { rerender } = renderHookWithProviders(() => useCreditThresholdEvents());
      expect(mockLogImpressionEvent).not.toHaveBeenCalled();

      // 74.9% remaining → crosses below75
      setupMocks({ totalCreditsSpent: 251, totalCreditsMax: 1000 });
      rerender();
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below75',
        expect.anything()
      );
    });

    it('skips localStorage.removeItem when nothing was previously fired (reset path with empty state)', function resetWithNoFires() {
      const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');

      // 75% remaining on first render — reset path entered but firedThresholds is empty
      setupMocks({ totalCreditsSpent: 250, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());

      expect(removeSpy).not.toHaveBeenCalled();
    });
  });

  describe('localStorage failure fallbacks', function storageFallbacks() {
    it('still fires events when localStorage.getItem throws', function getItemThrows() {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function failGet() {
        throw new Error('QuotaExceededError');
      });

      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());

      // Event fires despite storage failure; isFirstOccurrence is true
      // because loadPersistedThresholds falls back to empty Set on error.
      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below75',
        { isFirstOccurrence: true }
      );
    });

    it('still fires events when localStorage.setItem throws', function setItemThrows() {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function failSet() {
        throw new Error('QuotaExceededError');
      });

      setupMocks({ totalCreditsSpent: 260, totalCreditsMax: 1000 });
      renderHookWithProviders(() => useCreditThresholdEvents());

      expect(mockLogImpressionEvent).toHaveBeenCalledWith(
        'credits.threshold.below75',
        { isFirstOccurrence: true }
      );
    });

    it('still resets on replenishment when localStorage.removeItem throws', function removeItemThrows() {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function failRemove() {
        throw new Error('SecurityError');
      });

      setupMocks({ totalCreditsSpent: 510, totalCreditsMax: 1000 });
      const { rerender } = renderHookWithProviders(() => useCreditThresholdEvents());

      // Should not throw; reset path swallows the error
      expect(() => {
        setupMocks({ totalCreditsSpent: 50, totalCreditsMax: 1000 });
        rerender();
      }).not.toThrow();
    });
  });
});

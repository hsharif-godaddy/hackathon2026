/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INELIGIBLE_COHORT } from '@/config/experiments';
import { useAnalytics } from '@/hooks/useAnalytics';
import { renderHookWithProviders } from '@/tests/test-utils';

const shipAnalyticsLog = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => shipAnalyticsLog(...args),
}));

const mockUseHivemind = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: (...args: unknown[]) => mockUseHivemind(...args),
}));

function clearVisitorCookie() {
  document.cookie = 'visitor=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
}

describe('useAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearVisitorCookie();
  });

  it('sends ineligible when Hivemind has no cohort', function noCohort() {
    mockUseHivemind.mockReturnValue({ cohort: undefined, data: undefined, experiment: undefined });
    const { result } = renderHookWithProviders(() =>
      useAnalytics({
        baseData: { isAuthenticated: false },
      }),
    );
    result.current.logAnalytics('homepage.view', { step: 1 });
    expect(mockUseHivemind).toHaveBeenCalledWith('');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('homepage.view', {
      isAuthenticated: false,
      step: 1,
      cohort: INELIGIBLE_COHORT,
    });
  });

  it('sends Hivemind cohort when experimentId is provided', function withCohort() {
    mockUseHivemind.mockReturnValue({ cohort: 'treatment', data: {}, experiment: undefined });
    const { result } = renderHookWithProviders(() =>
      useAnalytics({ experimentId: 'some-active-experiment' }),
    );
    result.current.logAnalytics('homepage.view', {});
    expect(mockUseHivemind).toHaveBeenCalledWith('some-active-experiment');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('homepage.view', { cohort: 'treatment' });
  });

  it('uses latest baseData after rerender', function baseDataRef() {
    mockUseHivemind.mockReturnValue({ cohort: 'c', data: undefined, experiment: undefined });
    const { result, rerender } = renderHookWithProviders(
      (props: { auth: boolean }) =>
        useAnalytics({
          baseData: { isAuthenticated: props.auth },
        }),
      { initialProps: { auth: false } },
    );
    result.current.logAnalytics('a', {});
    expect(shipAnalyticsLog).toHaveBeenLastCalledWith('a', { isAuthenticated: false, cohort: 'c' });
    rerender({ auth: true });
    result.current.logAnalytics('b', {});
    expect(shipAnalyticsLog).toHaveBeenLastCalledWith('b', { isAuthenticated: true, cohort: 'c' });
  });

  it('exposes cohort from hook', function cohortReturn() {
    mockUseHivemind.mockReturnValue({ cohort: 'original', data: undefined, experiment: undefined });
    const { result } = renderHookWithProviders(() =>
      useAnalytics({}),
    );
    expect(result.current.cohort).toBe('original');
  });

  it('includes visitorId in ship log when visitor cookie has vid', function shipVisitorId() {
    document.cookie = 'visitor=vid%3Dship-vid-id; path=/';
    mockUseHivemind.mockReturnValue({ cohort: 'c', data: {}, experiment: undefined });
    const { result } = renderHookWithProviders(() =>
      useAnalytics({}),
    );
    result.current.logAnalytics('homepage.view', {});
    expect(shipAnalyticsLog).toHaveBeenCalledWith('homepage.view', {
      cohort: 'c',
      visitorId: 'ship-vid-id',
    });
  });
});

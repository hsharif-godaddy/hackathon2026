/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { usePublishUpsellEligibility } from './usePublishUpsellEligibility';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/develop/test-app'),
}));

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(() => ({ showPaywall: true, isLoading: false, isError: false, error: null })),
}));

vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: vi.fn(() => ({ cohort: 'on', data: undefined, experiment: undefined })),
}));

async function setMocks(opts: {
  pathname?: string;
  showPaywall?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  cohort?: string | undefined;
}) {
  const nav = await import('next/navigation');
  const elig = await import('@/hooks/usePaywallEligibility');
  const hive = await import('@/hooks/useHivemind');
  vi.mocked(nav.usePathname).mockReturnValue(opts.pathname ?? '/develop/test-app');
  vi.mocked(elig.usePaywallEligibility).mockReturnValue({
    showPaywall: opts.showPaywall ?? true,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    error: null,
  });
  vi.mocked(hive.useHivemind).mockReturnValue({ cohort: opts.cohort, data: undefined, experiment: undefined });
}

describe('usePublishUpsellEligibility', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is treatment for free + develop + on cohort', async () => {
    await setMocks({ cohort: 'on' });
    const { result } = renderHook(() => usePublishUpsellEligibility());
    expect(result.current.isExperimentEligible).toBe(true);
    expect(result.current.isTreatment).toBe(true);
  });

  it('is experiment-eligible but NOT treatment for off cohort', async () => {
    await setMocks({ cohort: 'off' });
    const { result } = renderHook(() => usePublishUpsellEligibility());
    expect(result.current.isExperimentEligible).toBe(true);
    expect(result.current.isTreatment).toBe(false);
  });

  it('is not eligible for unbucketed cohort', async () => {
    await setMocks({ cohort: undefined });
    const { result } = renderHook(() => usePublishUpsellEligibility());
    expect(result.current.isExperimentEligible).toBe(false);
  });

  it('is not eligible while paywall loading', async () => {
    await setMocks({ cohort: 'on', isLoading: true });
    const { result } = renderHook(() => usePublishUpsellEligibility());
    expect(result.current.isExperimentEligible).toBe(false);
  });

  it('is not eligible on subscription error', async () => {
    await setMocks({ cohort: 'on', isError: true });
    const { result } = renderHook(() => usePublishUpsellEligibility());
    expect(result.current.isExperimentEligible).toBe(false);
  });

  it('is not eligible for paid users (showPaywall false)', async () => {
    await setMocks({ cohort: 'on', showPaywall: false });
    const { result } = renderHook(() => usePublishUpsellEligibility());
    expect(result.current.isExperimentEligible).toBe(false);
  });

  it('is not eligible on the commander path', async () => {
    await setMocks({ cohort: 'on', pathname: '/commander/test-app' });
    const { result } = renderHook(() => usePublishUpsellEligibility());
    expect(result.current.isExperimentEligible).toBe(false);
  });

  it('isOnCohort is true for on cohort even when paid (showPaywall false)', async () => {
    await setMocks({ cohort: 'on', showPaywall: false });
    const { result } = renderHook(() => usePublishUpsellEligibility());
    expect(result.current.isOnCohort).toBe(true);
    expect(result.current.isTreatment).toBe(false);
  });

  it('isOnCohort is false for off cohort and off the develop page', async () => {
    await setMocks({ cohort: 'off' });
    const { result } = renderHook(() => usePublishUpsellEligibility());
    expect(result.current.isOnCohort).toBe(false);

    await setMocks({ cohort: 'on', pathname: '/commander/test-app' });
    const { result: commander } = renderHook(() => usePublishUpsellEligibility());
    expect(commander.current.isOnCohort).toBe(false);
  });
});

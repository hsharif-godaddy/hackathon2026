/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useCombinePublishTrigger } from './useCombinePublishTrigger';

const mockLogImpressionEvent = vi.fn(() => vi.fn());
const mockShipAnalyticsLog = vi.fn();

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (...args: unknown[]) => { mockLogImpressionEvent(...args); return vi.fn(); },
}));
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}));
vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: vi.fn(() => ({ cohort: 'on' })),
}));
vi.mock('@/hooks/usePublishUpsellEligibility', () => ({
  usePublishUpsellEligibility: vi.fn(() => ({ isExperimentEligible: true, isTreatment: true, isOnCohort: false })),
}));

let mockBuildAppId: string | undefined = 'app-1';
let mockBuildComplete: boolean | undefined = true;
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ app: { id: mockBuildAppId, initialBuildComplete: mockBuildComplete } })),
}));

async function setEligible(isExperimentEligible: boolean) {
  const mod = await import('@/hooks/usePublishUpsellEligibility');
  vi.mocked(mod.usePublishUpsellEligibility).mockReturnValue({ isExperimentEligible, isTreatment: false, isOnCohort: false });
}

function setBuild(appId: string | undefined, initialBuildComplete: boolean | undefined) {
  mockBuildAppId = appId;
  mockBuildComplete = initialBuildComplete;
}

async function setCohort(cohort: string | undefined) {
  const mod = await import('@/hooks/useHivemind');
  vi.mocked(mod.useHivemind).mockReturnValue({ cohort, data: undefined, experiment: undefined });
}

describe('useCombinePublishTrigger', () => {
  beforeEach(() => { vi.clearAllMocks(); mockBuildAppId = 'app-1'; mockBuildComplete = true; });

  it('fires the trigger once when eligible, with cohort attached to both events', async () => {
    await setEligible(true);
    await setCohort('on');
    renderHook(() => useCombinePublishTrigger('app-1'));
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('develop.combine_publish.trigger', { appId: 'app-1', cohort: 'on' });
    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('develop.combine_publish.trigger', { appId: 'app-1', cohort: 'on' });
  });

  it('attaches the off cohort for the control arm', async () => {
    await setEligible(true);
    await setCohort('off');
    renderHook(() => useCombinePublishTrigger('app-1'));
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('develop.combine_publish.trigger', { appId: 'app-1', cohort: 'off' });
  });

  it('falls back to the ineligible cohort sentinel when cohort is missing', async () => {
    await setEligible(true);
    await setCohort(undefined);
    renderHook(() => useCombinePublishTrigger('app-1'));
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('develop.combine_publish.trigger', { appId: 'app-1', cohort: 'ineligible' });
  });

  it('does not re-fire on re-render for the same app', async () => {
    await setEligible(true);
    await setCohort('on');
    const { rerender } = renderHook(() => useCombinePublishTrigger('app-1'));
    rerender();
    rerender();
    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
  });

  it('re-fires when appId changes (new develop landing)', async () => {
    await setEligible(true);
    await setCohort('on');
    const { rerender } = renderHook(({ id }) => useCombinePublishTrigger(id), { initialProps: { id: 'app-1' } });
    setBuild('app-2', true);
    rerender({ id: 'app-2' });
    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(2);
    expect(mockLogImpressionEvent).toHaveBeenLastCalledWith('develop.combine_publish.trigger', { appId: 'app-2', cohort: 'on' });
  });

  it('does not fire when not eligible', async () => {
    await setEligible(false);
    renderHook(() => useCombinePublishTrigger('app-1'));
    expect(mockLogImpressionEvent).not.toHaveBeenCalled();
  });

  it('does not fire without an appId', async () => {
    await setEligible(true);
    renderHook(() => useCombinePublishTrigger(undefined));
    expect(mockLogImpressionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when the initial build is not complete', async () => {
    await setEligible(true);
    await setCohort('on');
    setBuild('app-1', false);
    renderHook(() => useCombinePublishTrigger('app-1'));
    expect(mockLogImpressionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when build-complete is unknown for the current app', async () => {
    await setEligible(true);
    await setCohort('on');
    setBuild('other-app', true); // store knows about a different app -> selector returns undefined for app-1
    renderHook(() => useCombinePublishTrigger('app-1'));
    expect(mockLogImpressionEvent).not.toHaveBeenCalled();
  });

  it('fires once the build is complete (returning or freshly-built)', async () => {
    await setEligible(true);
    await setCohort('on');
    setBuild('app-1', true);
    renderHook(() => useCombinePublishTrigger('app-1'));
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('develop.combine_publish.trigger', { appId: 'app-1', cohort: 'on' });
  });
});

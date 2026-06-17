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
vi.mock('@/hooks/usePublishUpsellEligibility', () => ({
  usePublishUpsellEligibility: vi.fn(() => ({ isExperimentEligible: true, isTreatment: true, isLoading: false })),
}));

async function setEligible(isExperimentEligible: boolean) {
  const mod = await import('@/hooks/usePublishUpsellEligibility');
  vi.mocked(mod.usePublishUpsellEligibility).mockReturnValue({ isExperimentEligible, isTreatment: false, isLoading: false });
}

describe('useCombinePublishTrigger', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fires the trigger once when eligible', async () => {
    await setEligible(true);
    renderHook(() => useCombinePublishTrigger('app-1'));
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('develop.combine_publish.trigger', { appId: 'app-1' });
    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('develop.combine_publish.trigger', { appId: 'app-1' });
  });

  it('does not re-fire on re-render for the same app', async () => {
    await setEligible(true);
    const { rerender } = renderHook(() => useCombinePublishTrigger('app-1'));
    rerender();
    rerender();
    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
  });

  it('re-fires when appId changes (new develop landing)', async () => {
    await setEligible(true);
    const { rerender } = renderHook(({ id }) => useCombinePublishTrigger(id), { initialProps: { id: 'app-1' } });
    rerender({ id: 'app-2' });
    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(2);
    expect(mockLogImpressionEvent).toHaveBeenLastCalledWith('develop.combine_publish.trigger', { appId: 'app-2' });
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
});

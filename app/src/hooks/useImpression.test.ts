// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useImpression } from './useImpression';

const mockLogImpressionInner = vi.hoisted(() => vi.fn());
const mockLogImpressionEvent = vi.hoisted(() => vi.fn(() => mockLogImpressionInner));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: mockLogImpressionEvent,
}));

describe('useImpression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls logImpressionEvent on mount', () => {
    renderHookWithProviders(() => useImpression('test.event.view'));

    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('test.event.view', undefined);
    expect(mockLogImpressionInner).toHaveBeenCalledTimes(1);
  });

  it('passes customProperties to logImpressionEvent', () => {
    const customProperties = { variant: 'original', count: 1, active: true };

    renderHookWithProviders(() => useImpression('test.event.view', { customProperties }));

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('test.event.view', customProperties);
  });

  it('only fires once across re-renders', () => {
    const { rerender } = renderHookWithProviders(() => useImpression('test.event.view'));

    rerender();
    rerender();

    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
  });

  it('does not fire when enabled is false', () => {
    renderHookWithProviders(() => useImpression('test.event.view', { enabled: false }));

    expect(mockLogImpressionEvent).not.toHaveBeenCalled();
  });

  it('fires when enabled changes from false to true', () => {
    let enabled = false;
    const { rerender } = renderHookWithProviders(() => useImpression('test.event.view', { enabled }));

    expect(mockLogImpressionEvent).not.toHaveBeenCalled();

    enabled = true;
    rerender();

    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
  });

  it('does not fire again after enabled toggles true → false → true', () => {
    let enabled = true;
    const { rerender } = renderHookWithProviders(() => useImpression('test.event.view', { enabled }));

    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);

    enabled = false;
    rerender();
    enabled = true;
    rerender();

    expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
  });
});

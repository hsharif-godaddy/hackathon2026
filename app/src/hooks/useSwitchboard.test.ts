/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    localFeatures: vi.fn(() => false),
  },
}));

describe('useSwitchboard', () => {
  beforeEach(() => {
    vi.resetModules();
    (window as unknown as { gasketData?: unknown }).gasketData = {
      switchboard: {
        'flag-true': true,
        'flag-false': false,
        'flag-not-boolean': 'yes',
      },
    };
  });

  afterEach(() => {
    delete (window as unknown as { gasketData?: unknown }).gasketData;
  });

  it('returns true when the flag is true in gasketData', async () => {
    const { useSwitchboard } = await import('./useSwitchboard');
    expect(useSwitchboard('flag-true')).toBe(true);
  });

  it('returns false when the flag is false in gasketData', async () => {
    const { useSwitchboard } = await import('./useSwitchboard');
    expect(useSwitchboard('flag-false')).toBe(false);
  });

  it('returns undefined when the flag is missing from the tree', async () => {
    const { useSwitchboard } = await import('./useSwitchboard');
    expect(useSwitchboard('missing-flag')).toBeUndefined();
  });

  it('returns undefined when the flag value is not a boolean', async () => {
    const { useSwitchboard } = await import('./useSwitchboard');
    expect(useSwitchboard('flag-not-boolean')).toBeUndefined();
  });

  it('does not throw when gasketData is missing', async () => {
    delete (window as unknown as { gasketData?: unknown }).gasketData;
    const { useSwitchboard } = await import('./useSwitchboard');
    expect(() => useSwitchboard('any-flag')).not.toThrow();
    expect(useSwitchboard('any-flag')).toBeUndefined();
  });

  it('does not throw when switchboard subtree is missing', async () => {
    (window as unknown as { gasketData?: unknown }).gasketData = {};
    const { useSwitchboard } = await import('./useSwitchboard');
    expect(() => useSwitchboard('any-flag')).not.toThrow();
    expect(useSwitchboard('any-flag')).toBeUndefined();
  });

  it('returns local override when localFeatures is enabled and flag is in override list', async () => {
    const { isFeatureEnabled } = await import('@/lib/features');
    vi.mocked(isFeatureEnabled.localFeatures).mockReturnValue(true);
    const { useSwitchboard } = await import('./useSwitchboard');
    // 'appbuilder-publish-button' is in LOCAL_FEATURE_OVERRIDES with value true
    expect(useSwitchboard('appbuilder-publish-button')).toBe(true);
    // 'app-builder-budget-service' is in LOCAL_FEATURE_OVERRIDES with value false (opt-in)
    expect(useSwitchboard('app-builder-budget-service')).toBe(false);
  });

  it('falls through to gasketData when localFeatures enabled but flag not in override list', async () => {
    const { isFeatureEnabled } = await import('@/lib/features');
    vi.mocked(isFeatureEnabled.localFeatures).mockReturnValue(true);
    const { useSwitchboard } = await import('./useSwitchboard');
    expect(useSwitchboard('flag-true')).toBe(true);
    expect(useSwitchboard('flag-false')).toBe(false);
    expect(useSwitchboard('missing-flag')).toBeUndefined();
  });

  it('getSwitchboardFlag is an alias for useSwitchboard', async () => {
    const { useSwitchboard, getSwitchboardFlag } = await import('./useSwitchboard');
    expect(getSwitchboardFlag).toBe(useSwitchboard);
    expect(getSwitchboardFlag('flag-true')).toBe(true);
  });
});

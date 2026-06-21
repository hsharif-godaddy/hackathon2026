/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('getSwitchboardFlag is an alias for useSwitchboard', async () => {
    const { useSwitchboard, getSwitchboardFlag } = await import('./useSwitchboard');
    expect(getSwitchboardFlag).toBe(useSwitchboard);
    expect(getSwitchboardFlag('flag-true')).toBe(true);
  });

});

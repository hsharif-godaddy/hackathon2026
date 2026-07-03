import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIsMobile } from '../useIsMobile';

type ChangeListener = (event: MediaQueryListEvent) => void;

/**
 * Installs a controllable `window.matchMedia` stub and returns a `setMatches`
 * helper that flips the match state and notifies subscribers (as a real
 * MediaQueryList would on a viewport change).
 */
function stubMatchMedia(initialMatches: boolean): {
  setMatches: (matches: boolean) => void;
  matchMedia: ReturnType<typeof vi.fn>;
} {
  const listeners = new Set<ChangeListener>();
  const mql: Partial<MediaQueryList> = {
    matches: initialMatches,
    addEventListener: ((_type: string, cb: ChangeListener) => {
      listeners.add(cb);
    }) as MediaQueryList['addEventListener'],
    removeEventListener: ((_type: string, cb: ChangeListener) => {
      listeners.delete(cb);
    }) as MediaQueryList['removeEventListener'],
  };
  const matchMedia = vi.fn(() => mql as MediaQueryList);
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

  return {
    matchMedia,
    setMatches: (matches: boolean) => {
      (mql as { matches: boolean }).matches = matches;
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent));
    },
  };
}

describe('useIsMobile', () => {
  afterEach(() => {
    // Remove the stub so the "matchMedia unavailable" test sees a clean global.
    delete (window as { matchMedia?: unknown }).matchMedia;
    vi.restoreAllMocks();
  });

  it('returns false when matchMedia is unavailable (SSR / first paint)', () => {
    delete (window as { matchMedia?: unknown }).matchMedia;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('reflects the initial match state after mount', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('queries the < 768px breakpoint', () => {
    const { matchMedia } = stubMatchMedia(false);
    renderHook(() => useIsMobile());
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
  });

  it('updates when the viewport crosses the breakpoint', () => {
    const { result, setMatches } = (() => {
      const ctrl = stubMatchMedia(false);
      const hook = renderHook(() => useIsMobile());
      return { ...hook, setMatches: ctrl.setMatches };
    })();

    expect(result.current).toBe(false);
    act(() => setMatches(true));
    expect(result.current).toBe(true);
    act(() => setMatches(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes the change listener on unmount', () => {
    const listeners = new Set<ChangeListener>();
    const mql: Partial<MediaQueryList> = {
      matches: false,
      addEventListener: ((_t: string, cb: ChangeListener) => listeners.add(cb)) as MediaQueryList['addEventListener'],
      removeEventListener: ((_t: string, cb: ChangeListener) => listeners.delete(cb)) as MediaQueryList['removeEventListener'],
    };
    window.matchMedia = vi.fn(() => mql as MediaQueryList) as unknown as typeof window.matchMedia;

    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});

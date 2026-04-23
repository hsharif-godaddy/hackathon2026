/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useAotPreload } from './useAotPreload';

describe('useAotPreload', () => {
  const importA = vi.fn(() => Promise.resolve({ default: {} }));
  const importB = vi.fn(() => Promise.resolve({ default: {} }));
  const importC = vi.fn(() => Promise.resolve({ default: {} }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete (globalThis as any).requestIdleCallback;
    delete (globalThis as any).cancelIdleCallback;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).requestIdleCallback;
    delete (globalThis as any).cancelIdleCallback;
  });

  describe('requestIdleCallback path', () => {
    let ricCallback: (() => void) | null;
    let mockRIC: ReturnType<typeof vi.fn>;
    let mockCIC: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      ricCallback = null;
      mockRIC = vi.fn((cb: () => void) => { ricCallback = cb; return 42; });
      mockCIC = vi.fn();
      globalThis.requestIdleCallback = mockRIC as any;
      globalThis.cancelIdleCallback = mockCIC;
    });

    it('should register an idle callback on mount', () => {
      const { unmount } = renderHookWithProviders(() => useAotPreload([importA, importB, importC]));

      expect(mockRIC).toHaveBeenCalledTimes(1);
      expect(importA).not.toHaveBeenCalled();
      unmount();
    });

    it('should invoke all import functions when idle callback fires', () => {
      const { unmount } = renderHookWithProviders(() => useAotPreload([importA, importB, importC]));

      ricCallback!();

      expect(importA).toHaveBeenCalledTimes(1);
      expect(importB).toHaveBeenCalledTimes(1);
      expect(importC).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('should cancel the idle callback on unmount', () => {
      const { unmount } = renderHookWithProviders(() => useAotPreload([importA]));

      unmount();

      expect(mockCIC).toHaveBeenCalledWith(42);
    });
  });

  describe('setTimeout fallback', () => {
    it('should fall back to setTimeout(200) when requestIdleCallback is unavailable', () => {
      renderHookWithProviders(() => useAotPreload([importA, importB]));

      expect(importA).not.toHaveBeenCalled();

      vi.advanceTimersByTime(199);
      expect(importA).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(importA).toHaveBeenCalledTimes(1);
      expect(importB).toHaveBeenCalledTimes(1);
    });

    it('should clear the timeout on unmount', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

      const { unmount } = renderHookWithProviders(() => useAotPreload([importA]));
      unmount();

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  it('should handle an empty import list without errors', () => {
    expect(() => {
      renderHookWithProviders(() => useAotPreload([]));
      vi.advanceTimersByTime(200);
    }).not.toThrow();
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useHomepageBounceTracking } from './useHomepageBounceTracking';

const mockFlushBeacon = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logging', () => ({
  ClientLogBuffer: { flushBeacon: mockFlushBeacon },
}));

function setScrollGeometry({
  scrollY,
  innerHeight,
  scrollHeight,
}: {
  scrollY: number;
  innerHeight: number;
  scrollHeight: number;
}) {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: scrollY,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: innerHeight,
  });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
}

function dispatchPageHide(persisted = false) {
  const event = new Event('pagehide') as Event & { persisted?: boolean };
  event.persisted = persisted;
  window.dispatchEvent(event);
}

describe('useHomepageBounceTracking', () => {
  let nowValue = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    nowValue = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowValue);
    setScrollGeometry({ scrollY: 0, innerHeight: 800, scrollHeight: 2000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('#pagehide bounce', () => {
    it('fires homepage.bounced with msOnPage and scrollMaxPercent when leaving early without engagement', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() => useHomepageBounceTracking(logAnalytics));

      nowValue = 3500;
      act(() => {
        dispatchPageHide();
      });

      expect(logAnalytics).toHaveBeenCalledTimes(1);
      expect(logAnalytics).toHaveBeenCalledWith('homepage.bounced', {
        msOnPage: 2500,
        scrollMaxPercent: 0,
      });
      expect(mockFlushBeacon).toHaveBeenCalledTimes(1);
    });

    it('does not fire when time on page exceeds thresholdMs', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() =>
        useHomepageBounceTracking(logAnalytics, { thresholdMs: 5000 }),
      );

      nowValue = 1000 + 5000;
      act(() => {
        dispatchPageHide();
      });

      expect(logAnalytics).not.toHaveBeenCalled();
      expect(mockFlushBeacon).not.toHaveBeenCalled();
    });

    it('does not fire twice if pagehide dispatches multiple times', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() => useHomepageBounceTracking(logAnalytics));

      nowValue = 2000;
      act(() => {
        dispatchPageHide();
        dispatchPageHide();
      });

      expect(logAnalytics).toHaveBeenCalledTimes(1);
    });

    it('fires bounce on bfcache pagehide (event.persisted === true)', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() => useHomepageBounceTracking(logAnalytics));

      nowValue = 2000;
      act(() => {
        dispatchPageHide(true);
      });

      expect(logAnalytics).toHaveBeenCalledWith(
        'homepage.bounced',
        expect.objectContaining({ msOnPage: 1000 }),
      );
      expect(mockFlushBeacon).toHaveBeenCalledTimes(1);
    });

    it('does not fire twice across a bfcache pagehide followed by a terminal pagehide', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() => useHomepageBounceTracking(logAnalytics));

      nowValue = 2000;
      act(() => {
        dispatchPageHide(true);
      });
      expect(logAnalytics).toHaveBeenCalledTimes(1);

      nowValue = 3000;
      act(() => {
        dispatchPageHide(false);
      });
      expect(logAnalytics).toHaveBeenCalledTimes(1);
    });
  });

  describe('#engagement signals', () => {
    it('does not fire after a click anywhere on the document', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() => useHomepageBounceTracking(logAnalytics));

      act(() => {
        document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      nowValue = 2000;
      act(() => {
        dispatchPageHide();
      });

      expect(logAnalytics).not.toHaveBeenCalled();
    });

    it('does not fire after focusin on the document', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() => useHomepageBounceTracking(logAnalytics));

      act(() => {
        document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      });

      nowValue = 2000;
      act(() => {
        dispatchPageHide();
      });

      expect(logAnalytics).not.toHaveBeenCalled();
    });

    it('does not fire after scrolling past the engagement threshold', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() =>
        useHomepageBounceTracking(logAnalytics, { engagementScrollPercent: 25 }),
      );

      // scrollable = 2000 - 800 = 1200; 40% = 480
      setScrollGeometry({ scrollY: 480, innerHeight: 800, scrollHeight: 2000 });
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });

      nowValue = 2000;
      act(() => {
        dispatchPageHide();
      });

      expect(logAnalytics).not.toHaveBeenCalled();
    });

    it('still fires when scrolling stays below engagement threshold, with max scroll recorded', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() =>
        useHomepageBounceTracking(logAnalytics, { engagementScrollPercent: 25 }),
      );

      // scrollable = 1200; 10% = 120
      setScrollGeometry({ scrollY: 120, innerHeight: 800, scrollHeight: 2000 });
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });

      nowValue = 2500;
      act(() => {
        dispatchPageHide();
      });

      expect(logAnalytics).toHaveBeenCalledWith('homepage.bounced', {
        msOnPage: 1500,
        scrollMaxPercent: 10,
      });
    });

    it('treats unscrollable pages (scrollHeight <= innerHeight) as 0% scrolled', () => {
      const logAnalytics = vi.fn();

      setScrollGeometry({ scrollY: 0, innerHeight: 1000, scrollHeight: 800 });

      renderHookWithProviders(() => useHomepageBounceTracking(logAnalytics));

      nowValue = 2000;
      act(() => {
        dispatchPageHide();
      });

      expect(logAnalytics).toHaveBeenCalledWith('homepage.bounced', {
        msOnPage: 1000,
        scrollMaxPercent: 0,
      });
    });
  });

  describe('#markEngaged', () => {
    it('suppresses bounce when called before pagehide', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() =>
        useHomepageBounceTracking(logAnalytics),
      );

      act(() => {
        result.current.markEngaged();
      });

      nowValue = 2000;
      act(() => {
        dispatchPageHide();
      });

      expect(logAnalytics).not.toHaveBeenCalled();
    });

    it('returns a stable reference across re-renders', () => {
      const logAnalytics = vi.fn();

      const { result, rerender } = renderHookWithProviders(() =>
        useHomepageBounceTracking(logAnalytics),
      );

      const first = result.current.markEngaged;
      rerender();
      expect(result.current.markEngaged).toBe(first);
    });
  });

  describe('#logAnalytics identity changes', () => {
    it('does not reset pageLoadAt when logAnalytics reference changes (e.g. Hivemind cohort resolve)', () => {
      const initialLog = vi.fn();
      const resolvedLog = vi.fn();

      const { rerender } = renderHookWithProviders(
        ({ log }: { log: typeof initialLog }) => useHomepageBounceTracking(log),
        { initialProps: { log: initialLog } },
      );

      // Simulate the Hivemind cohort resolving a moment after mount, swapping
      // the logAnalytics callback identity. The effect must NOT tear down and
      // re-run, which would reset pageLoadAt to this moment.
      nowValue = 2000;
      rerender({ log: resolvedLog });

      nowValue = 3500;
      act(() => {
        dispatchPageHide();
      });

      expect(initialLog).not.toHaveBeenCalled();
      expect(resolvedLog).toHaveBeenCalledTimes(1);
      expect(resolvedLog).toHaveBeenCalledWith('homepage.bounced', {
        msOnPage: 2500,
        scrollMaxPercent: 0,
      });
    });

    it('routes the bounce log through the latest logAnalytics reference', () => {
      const initialLog = vi.fn();
      const resolvedLog = vi.fn();

      const { rerender } = renderHookWithProviders(
        ({ log }: { log: typeof initialLog }) => useHomepageBounceTracking(log),
        { initialProps: { log: initialLog } },
      );

      rerender({ log: resolvedLog });

      nowValue = 2000;
      act(() => {
        dispatchPageHide();
      });

      expect(initialLog).not.toHaveBeenCalled();
      expect(resolvedLog).toHaveBeenCalledTimes(1);
    });
  });

  describe('#cleanup', () => {
    it('removes listeners on unmount', () => {
      const logAnalytics = vi.fn();

      const { unmount } = renderHookWithProviders(() =>
        useHomepageBounceTracking(logAnalytics),
      );

      unmount();

      nowValue = 2000;
      act(() => {
        dispatchPageHide();
      });

      expect(logAnalytics).not.toHaveBeenCalled();
    });
  });
});

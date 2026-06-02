/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useTextareaHoverTracking } from './useTextareaHoverTracking';

const mockFlushBeacon = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logging', () => ({
  ClientLogBuffer: { flushBeacon: mockFlushBeacon },
}));

function dispatchPageHide() {
  window.dispatchEvent(new Event('pagehide'));
}

describe('useTextareaHoverTracking', () => {
  let nowValue = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    nowValue = 1000;
    vi.spyOn(performance, 'now').mockImplementation(function () { return nowValue; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('#first_hover event', () => {
    it('fires homepage.prompt.first_hover exactly once on first mouseenter', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      nowValue = 2500;
      act(() => {
        result.current.onMouseEnter();
      });

      expect(logAnalytics).toHaveBeenCalledTimes(1);
      expect(logAnalytics).toHaveBeenCalledWith(
        'homepage.prompt.first_hover',
        { msFromPageLoad: 2500 },
        { kind: 'action', eid: 'homepage.prompt.input', action: 'hover' },
      );
    });

    it('does not re-fire first_hover on subsequent mouseenters', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      act(() => {
        result.current.onMouseEnter();
        result.current.onMouseLeave();
        result.current.onMouseEnter();
      });

      const firstHoverCalls = logAnalytics.mock.calls.filter(
        ([event]) => event === 'homepage.prompt.first_hover',
      );
      expect(firstHoverCalls).toHaveLength(1);
    });

    it('retries first_hover on a later mouseenter if logAnalytics throws on the first attempt', () => {
      let shouldThrow = true;
      const logAnalytics = vi.fn().mockImplementation(function maybeBoom() {
        if (shouldThrow) {
          throw new Error('analytics pipeline exploded');
        }
      });

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      nowValue = 1000;
      // Invoking the handler directly (not via dispatchEvent) so we can
      // assert the throw propagates — which is what surfaces the failure
      // for debugging instead of silently losing the event.
      expect(() => { result.current.onMouseEnter(); }).toThrow('analytics pipeline exploded');

      act(() => { result.current.onMouseLeave(); });

      shouldThrow = false;
      logAnalytics.mockClear();

      nowValue = 5000;
      act(() => { result.current.onMouseEnter(); });

      expect(logAnalytics).toHaveBeenCalledTimes(1);
      expect(logAnalytics).toHaveBeenCalledWith(
        'homepage.prompt.first_hover',
        { msFromPageLoad: 5000 },
        { kind: 'action', eid: 'homepage.prompt.input', action: 'hover' },
      );
    });

    it('honors custom firstHoverEvent and firstHoverEid overrides', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() =>
        useTextareaHoverTracking(logAnalytics, {
          firstHoverEvent: 'publish.prompt.first_hover',
          firstHoverEid: 'publish.prompt.input',
        }),
      );

      act(() => {
        result.current.onMouseEnter();
      });

      expect(logAnalytics).toHaveBeenCalledWith(
        'publish.prompt.first_hover',
        expect.any(Object),
        expect.objectContaining({ eid: 'publish.prompt.input' }),
      );
    });
  });

  describe('#snapshotHoverMs', () => {
    it('accumulates completed mouseenter/mouseleave pairs', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 3000;
      act(() => { result.current.onMouseLeave(); });

      nowValue = 4000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 7500;
      act(() => { result.current.onMouseLeave(); });

      let snapshot = 0;
      act(() => { snapshot = result.current.snapshotHoverMs(); });

      expect(snapshot).toBe(5500);
    });

    it('resets the counter so a second call returns 0 when no new hover occurred', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 2500;
      act(() => { result.current.onMouseLeave(); });

      let first = 0;
      let second = 0;
      act(() => {
        first = result.current.snapshotHoverMs();
        second = result.current.snapshotHoverMs();
      });

      expect(first).toBe(1500);
      expect(second).toBe(0);
    });

    it('includes the open hover session and keeps the clock running', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });

      // Snapshot mid-hover; the visitor is still over the textarea.
      nowValue = 4000;
      let first = 0;
      act(() => { first = result.current.snapshotHoverMs(); });
      expect(first).toBe(3000);

      // Additional hover after the snapshot must be captured by the next snapshot.
      nowValue = 6000;
      let second = 0;
      act(() => { second = result.current.snapshotHoverMs(); });
      expect(second).toBe(2000);
    });

    it('returns 0 when the visitor never hovered', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      let snapshot = -1;
      act(() => { snapshot = result.current.snapshotHoverMs(); });

      expect(snapshot).toBe(0);
    });

    it('ignores mouseleave when no hover session is open', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      nowValue = 5000;
      act(() => { result.current.onMouseLeave(); });

      let snapshot = -1;
      act(() => { snapshot = result.current.snapshotHoverMs(); });

      expect(snapshot).toBe(0);
    });

    it('preserves the original session start if mouseenter fires twice without a mouseleave', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      // First enter opens the session at t=1000.
      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });

      // A second enter fires at t=3000 without a preceding leave (DOM
      // reshuffling, event quirks). Must NOT reset the start to 3000 —
      // that would discard the 2000ms elapsed since the original enter.
      nowValue = 3000;
      act(() => { result.current.onMouseEnter(); });

      nowValue = 5000;
      act(() => { result.current.onMouseLeave(); });

      let snapshot = 0;
      act(() => { snapshot = result.current.snapshotHoverMs(); });

      expect(snapshot).toBe(4000);
    });
  });

  describe('#pagehide flush', () => {
    it('emits hover_time with total accumulated ms on pagehide', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 4500;
      act(() => { result.current.onMouseLeave(); });

      logAnalytics.mockClear();

      act(() => { dispatchPageHide(); });

      expect(logAnalytics).toHaveBeenCalledTimes(1);
      expect(logAnalytics).toHaveBeenCalledWith('homepage.prompt.hover_time', {
        totalHoverMs: 3500,
        trigger: 'pagehide',
      });
      expect(mockFlushBeacon).toHaveBeenCalledTimes(1);
    });

    it('closes an open hover session at pagehide so cursor-still-over-textarea is not lost', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });

      logAnalytics.mockClear();

      nowValue = 3000;
      act(() => { dispatchPageHide(); });

      expect(logAnalytics).toHaveBeenCalledWith('homepage.prompt.hover_time', {
        totalHoverMs: 2000,
        trigger: 'pagehide',
      });
    });

    it('does not emit hover_time when the visitor never hovered', () => {
      const logAnalytics = vi.fn();

      renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      act(() => { dispatchPageHide(); });

      expect(logAnalytics).not.toHaveBeenCalled();
      expect(mockFlushBeacon).not.toHaveBeenCalled();
    });

    it('does not double-count hover already consumed by an earlier snapshotHoverMs call', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      // Pre-focus hover window.
      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 3500;
      act(() => { result.current.onMouseLeave(); });

      // Focus consumes it.
      let preFocus = 0;
      act(() => { preFocus = result.current.snapshotHoverMs(); });
      expect(preFocus).toBe(2500);

      // Post-focus hover.
      nowValue = 4000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 5500;
      act(() => { result.current.onMouseLeave(); });

      logAnalytics.mockClear();

      act(() => { dispatchPageHide(); });

      expect(logAnalytics).toHaveBeenCalledWith('homepage.prompt.hover_time', {
        totalHoverMs: 1500,
        trigger: 'pagehide',
      });
    });

    it('does not emit twice if pagehide dispatches multiple times', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 2500;
      act(() => { result.current.onMouseLeave(); });

      logAnalytics.mockClear();

      act(() => {
        dispatchPageHide();
        dispatchPageHide();
      });

      const hoverTimeCalls = logAnalytics.mock.calls.filter(
        ([event]) => event === 'homepage.prompt.hover_time',
      );
      expect(hoverTimeCalls).toHaveLength(1);
    });

    it('closes the hover session on pagehide so bfcache dwell is not billed to the next snapshot', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      // Cursor is over the box at pagehide — classic bfcache setup.
      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });

      nowValue = 3000;
      act(() => { dispatchPageHide(); });

      // performance.now() continues advancing across bfcache (time origin
      // is preserved by navigation, not wall-clock). Simulate resumption
      // ~1h later. A stale hoverStartRef would credit that full hour.
      nowValue = 3000 + 60 * 60 * 1000;
      act(() => { result.current.onMouseLeave(); });

      logAnalytics.mockClear();
      mockFlushBeacon.mockClear();

      act(() => { dispatchPageHide(); });

      // No pending hover to flush — session was closed by the first pagehide.
      expect(logAnalytics).not.toHaveBeenCalled();
      expect(mockFlushBeacon).not.toHaveBeenCalled();
    });

    it('flushes the beacon even when logAnalytics throws during pagehide', () => {
      // Capture the pagehide handler so we can invoke it directly. Going
      // through window.dispatchEvent would route the throw through jsdom's
      // reportException, which vitest surfaces as an unhandled error even
      // when caught here — obscuring what we're actually asserting.
      const addSpy = vi.spyOn(window, 'addEventListener');

      const logAnalytics = vi.fn().mockImplementation(function maybeBoom(event: string) {
        // Only explode on the hover_time emission — lets first_hover
        // succeed so the pre-condition is realistic.
        if (event === 'homepage.prompt.hover_time') {
          throw new Error('analytics pipeline exploded');
        }
      });

      const { result } = renderHookWithProviders(() => useTextareaHoverTracking(logAnalytics));

      const pagehideCall = addSpy.mock.calls.find(([type]) => type === 'pagehide');
      expect(pagehideCall).toBeDefined();
      const pagehideHandler = pagehideCall![1] as EventListener;

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 2500;
      act(() => { result.current.onMouseLeave(); });

      expect(() => {
        pagehideHandler(new Event('pagehide'));
      }).toThrow('analytics pipeline exploded');

      expect(logAnalytics).toHaveBeenCalledWith(
        'homepage.prompt.hover_time',
        expect.objectContaining({ trigger: 'pagehide' }),
      );
      expect(mockFlushBeacon).toHaveBeenCalledTimes(1);

      addSpy.mockRestore();
    });

    it('honors custom hoverTimeEvent override', () => {
      const logAnalytics = vi.fn();

      const { result } = renderHookWithProviders(() =>
        useTextareaHoverTracking(logAnalytics, { hoverTimeEvent: 'publish.prompt.hover_time' }),
      );

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 2000;
      act(() => { result.current.onMouseLeave(); });

      logAnalytics.mockClear();

      act(() => { dispatchPageHide(); });

      expect(logAnalytics).toHaveBeenCalledWith(
        'publish.prompt.hover_time',
        expect.objectContaining({ trigger: 'pagehide' }),
      );
    });
  });

  describe('#logAnalytics identity changes', () => {
    it('routes pagehide through the latest logAnalytics reference without remounting the effect', () => {
      const initialLog = vi.fn();
      const resolvedLog = vi.fn();

      const { result, rerender } = renderHookWithProviders(
        ({ log }: { log: typeof initialLog }) => useTextareaHoverTracking(log),
        { initialProps: { log: initialLog } },
      );

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 2500;
      act(() => { result.current.onMouseLeave(); });

      rerender({ log: resolvedLog });

      // Only the pagehide-triggered hover_time call matters here; clear both
      // mocks so we're asserting on the pagehide emission alone.
      initialLog.mockClear();
      resolvedLog.mockClear();

      act(() => { dispatchPageHide(); });

      expect(initialLog).not.toHaveBeenCalled();
      expect(resolvedLog).toHaveBeenCalledWith(
        'homepage.prompt.hover_time',
        expect.objectContaining({ totalHoverMs: 1500, trigger: 'pagehide' }),
      );
    });
  });

  describe('#handler stability', () => {
    it('returns stable handler references across re-renders', () => {
      const logAnalytics = vi.fn();

      const { result, rerender } = renderHookWithProviders(() =>
        useTextareaHoverTracking(logAnalytics),
      );

      const firstEnter = result.current.onMouseEnter;
      const firstLeave = result.current.onMouseLeave;
      const firstSnapshot = result.current.snapshotHoverMs;

      rerender();

      expect(result.current.onMouseEnter).toBe(firstEnter);
      expect(result.current.onMouseLeave).toBe(firstLeave);
      expect(result.current.snapshotHoverMs).toBe(firstSnapshot);
    });
  });

  describe('#cleanup', () => {
    it('removes the pagehide listener on unmount', () => {
      const logAnalytics = vi.fn();

      const { result, unmount } = renderHookWithProviders(() =>
        useTextareaHoverTracking(logAnalytics),
      );

      nowValue = 1000;
      act(() => { result.current.onMouseEnter(); });
      nowValue = 2500;
      act(() => { result.current.onMouseLeave(); });

      unmount();

      logAnalytics.mockClear();
      mockFlushBeacon.mockClear();

      act(() => { dispatchPageHide(); });

      expect(logAnalytics).not.toHaveBeenCalled();
      expect(mockFlushBeacon).not.toHaveBeenCalled();
    });
  });
});

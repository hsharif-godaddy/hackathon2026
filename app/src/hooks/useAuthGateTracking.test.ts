/**
 * @vitest-environment jsdom
 */
import { type MutableRefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useAuthGateTracking } from './useAuthGateTracking';

let mockSsoCloseReason: 'success' | 'dismiss' | null = null;
let mockIsSsoLoginOpen = false;
const mockClearSsoCloseReason = vi.fn();

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: (selector: any) =>
    selector({
      isSsoLoginOpen: mockIsSsoLoginOpen,
      ssoCloseReason: mockSsoCloseReason,
      clearSsoCloseReason: mockClearSsoCloseReason,
    }),
}));

const mockFlush = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logging', () => ({
  ClientLogBuffer: { flush: mockFlush },
}));

const mockTrackMilestone = vi.fn();
vi.mock('@/lib/journeyTracker', () => ({
  JourneyTracker: {
    current: () => ({ trackMilestone: mockTrackMilestone }),
  },
}));

function createRefs(shownAt: number | null = null, prompt = 'hello') {
  return {
    authGateShownAtRef: { current: shownAt } as MutableRefObject<number | null>,
    promptTextRef: { current: prompt } as MutableRefObject<string>,
  };
}

describe('useAuthGateTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSsoCloseReason = null;
    mockIsSsoLoginOpen = false;
  });

  describe('#shown', () => {
    it('fires auth_gate_shown milestone when SSO login opens', () => {
      const logAnalytics = vi.fn();
      const refs = createRefs(Date.now(), 'test prompt');
      mockIsSsoLoginOpen = true;

      renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

      expect(mockTrackMilestone).toHaveBeenCalledWith('auth_gate_shown', {
        promptLength: 11,
      });
    });

    it('does not fire auth_gate_shown when ref is null', () => {
      const logAnalytics = vi.fn();
      const refs = createRefs(null);
      mockIsSsoLoginOpen = true;

      renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

      expect(mockTrackMilestone).not.toHaveBeenCalledWith('auth_gate_shown', expect.anything());
    });
  });

  describe('#completed', () => {
    it('fires completed event with timing data when SSO succeeds', () => {
      const logAnalytics = vi.fn();
      const refs = createRefs(Date.now() - 500, 'test prompt');
      mockSsoCloseReason = 'success';

      renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

      expect(logAnalytics).toHaveBeenCalledWith(
        'homepage.auth_gate.completed',
        expect.objectContaining({
          msFromShown: expect.any(Number),
          promptLength: 11,
        }),
        { kind: 'click', eid: 'homepage.auth.complete' },
      );
      expect(mockTrackMilestone).toHaveBeenCalledWith('auth_gate_completed', expect.objectContaining({
        msFromShown: expect.any(Number),
        promptLength: 11,
      }));
      expect(refs.authGateShownAtRef.current).toBeNull();
      expect(mockClearSsoCloseReason).toHaveBeenCalled();
    });

    it('skips analytics but still clears store when ref is null on success', () => {
      const logAnalytics = vi.fn();
      const refs = createRefs(null);
      mockSsoCloseReason = 'success';

      renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

      expect(logAnalytics).not.toHaveBeenCalled();
      expect(mockClearSsoCloseReason).toHaveBeenCalled();
    });
  });

  describe('#dismissed', () => {
    it('fires dismissed event when user closes the modal', () => {
      const logAnalytics = vi.fn();
      const refs = createRefs(Date.now() - 300, 'hi');
      mockSsoCloseReason = 'dismiss';

      renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

      expect(logAnalytics).toHaveBeenCalledWith(
        'homepage.auth_gate.dismissed',
        expect.objectContaining({
          msFromShown: expect.any(Number),
          promptLength: 2,
        }),
        { kind: 'click', eid: 'homepage.auth.dismiss' },
      );
      expect(mockTrackMilestone).toHaveBeenCalledWith('auth_gate_dismissed', expect.objectContaining({
        msFromShown: expect.any(Number),
        promptLength: 2,
      }));
      expect(refs.authGateShownAtRef.current).toBeNull();
      expect(mockClearSsoCloseReason).toHaveBeenCalled();
    });

    it('skips analytics when ref is null on dismiss', () => {
      const logAnalytics = vi.fn();
      const refs = createRefs(null);
      mockSsoCloseReason = 'dismiss';

      renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

      expect(logAnalytics).not.toHaveBeenCalled();
      expect(mockClearSsoCloseReason).toHaveBeenCalled();
    });
  });

  describe('#abandoned', () => {
    it('fires abandoned event and flushes on pagehide', () => {
      const logAnalytics = vi.fn();
      const refs = createRefs(Date.now() - 1000, 'prompt');

      renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(logAnalytics).toHaveBeenCalledWith(
        'homepage.auth_gate.abandoned',
        expect.objectContaining({
          msFromShown: expect.any(Number),
          promptLength: 6,
        }),
      );
      expect(mockTrackMilestone).toHaveBeenCalledWith('auth_gate_abandoned', expect.objectContaining({
        msFromShown: expect.any(Number),
        promptLength: 6,
      }));
      expect(refs.authGateShownAtRef.current).toBeNull();
      expect(mockFlush).toHaveBeenCalled();
    });

    it('does not fire when auth gate was not shown', () => {
      const logAnalytics = vi.fn();
      const refs = createRefs(null);

      renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(logAnalytics).not.toHaveBeenCalled();
      expect(mockFlush).not.toHaveBeenCalled();
    });

    it('does not fire twice on bfcache restore cycle', () => {
      const logAnalytics = vi.fn();
      const refs = createRefs(Date.now() - 200);

      renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(logAnalytics).toHaveBeenCalledTimes(1);

      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(logAnalytics).toHaveBeenCalledTimes(1);
    });
  });

  it('does nothing when ssoCloseReason is null', () => {
    const logAnalytics = vi.fn();
    const refs = createRefs(Date.now());
    mockSsoCloseReason = null;

    renderHookWithProviders(() => useAuthGateTracking(logAnalytics, refs));

    expect(logAnalytics).not.toHaveBeenCalled();
    expect(mockClearSsoCloseReason).not.toHaveBeenCalled();
  });
});

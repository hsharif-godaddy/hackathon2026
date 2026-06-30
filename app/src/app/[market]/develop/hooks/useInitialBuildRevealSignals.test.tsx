/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useFirstFileEditFeedbackReveal,
  useInitialBuildFirstViewTracking,
  useJtbdFeedbackRevealSignal,
} from '@/app/[market]/develop/hooks/useInitialBuildRevealSignals';
import { renderHookWithProviders } from '@/tests/test-utils';

const mockTrackFirstView = vi.fn<[], number | null>();
vi.mock('@/hooks/shared/initialBuildFunnel', () => ({
  trackFirstView: () => mockTrackFirstView(),
}));

const mockTrackMilestone = vi.fn();
vi.mock('@/lib/journeyTracker', () => ({
  JourneyTracker: {
    current: () => ({ trackMilestone: mockTrackMilestone }),
  },
}));

const APP_ID = 'app-test-1';

describe('useJtbdFeedbackRevealSignal', function hookTests() {
  beforeEach(function clearStorage() {
    window.localStorage.clear();
  });

  it('is not reveal-ready before logo JTBD milestones', function notReady() {
    const { result } = renderHookWithProviders(() => useJtbdFeedbackRevealSignal(APP_ID));

    expect(result.current.isRevealReady).toBe(false);
    expect(result.current.logoDownload).toBe(false);
    expect(result.current.logoDownstreamApply).toBe(false);
    expect(result.current.websitePublish).toBe(false);
    expect(result.current.websiteDomainConnect).toBe(false);
    expect(result.current.domainPurchase).toBe(false);
    expect(result.current.domainDownstreamConnect).toBe(false);
  });

  it('becomes reveal-ready when logoDownload is persisted', function downloadReady() {
    window.localStorage.setItem(`appbuilder-feedback-reveal:${APP_ID}:logoDownload`, 'true');
    const { result } = renderHookWithProviders(() => useJtbdFeedbackRevealSignal(APP_ID));

    expect(result.current.isRevealReady).toBe(true);
    expect(result.current.logoDownload).toBe(true);
  });

  it('becomes reveal-ready when logoDownstreamApply is persisted', function downstreamReady() {
    window.localStorage.setItem(
      `appbuilder-feedback-reveal:${APP_ID}:logoDownstreamApply`,
      'true'
    );
    const { result } = renderHookWithProviders(() => useJtbdFeedbackRevealSignal(APP_ID));

    expect(result.current.isRevealReady).toBe(true);
    expect(result.current.logoDownstreamApply).toBe(true);
  });
});

describe('useFirstFileEditFeedbackReveal', function writerTests() {
  beforeEach(function clearStorage() {
    window.localStorage.clear();
  });

  it('writes the firstFileEdit milestone that the reader gates on', function writeReadPath() {
    renderHookWithProviders(() => useFirstFileEditFeedbackReveal(true, APP_ID));

    const { result } = renderHookWithProviders(() => useJtbdFeedbackRevealSignal(APP_ID));

    expect(result.current.firstFileEdit).toBe(true);
  });

  it('does not write the milestone before the first file edit', function notSeenYet() {
    renderHookWithProviders(() => useFirstFileEditFeedbackReveal(false, APP_ID));

    const { result } = renderHookWithProviders(() => useJtbdFeedbackRevealSignal(APP_ID));

    expect(result.current.firstFileEdit).toBe(false);
  });

  it('does not write the milestone without an appId', function noAppId() {
    renderHookWithProviders(() => useFirstFileEditFeedbackReveal(true, null));

    expect(
      window.localStorage.getItem(`appbuilder-feedback-reveal:${APP_ID}:firstFileEdit`)
    ).toBeNull();
  });

  it('keeps firstFileEdit out of agent-work reveal readiness', function excludedFromActive() {
    renderHookWithProviders(() => useFirstFileEditFeedbackReveal(true, APP_ID));

    const { result } = renderHookWithProviders(() => useJtbdFeedbackRevealSignal(APP_ID));

    expect(result.current.firstFileEdit).toBe(true);
    expect(result.current.isRevealReady).toBe(false);
  });
});

describe('useInitialBuildFirstViewTracking', function firstViewTrackingTests() {
  beforeEach(function resetMocks() {
    mockTrackFirstView.mockReset();
    mockTrackFirstView.mockReturnValue(4321);
    mockTrackMilestone.mockReset();
  });

  it('fires first_view + milestones when the first file edit is seen', function fires() {
    renderHookWithProviders(() => useInitialBuildFirstViewTracking(true, APP_ID));

    expect(mockTrackFirstView).toHaveBeenCalledTimes(1);
    expect(mockTrackMilestone).toHaveBeenCalledWith('preview_generated', {
      appId: APP_ID,
      msToFirstView: 4321,
    });
    expect(mockTrackMilestone).toHaveBeenCalledWith('first_edit_made', { appId: APP_ID });
  });

  it('does not fire before the first file edit is seen', function notSeenYet() {
    renderHookWithProviders(() => useInitialBuildFirstViewTracking(false, APP_ID));

    expect(mockTrackFirstView).not.toHaveBeenCalled();
    expect(mockTrackMilestone).not.toHaveBeenCalled();
  });

  it('does not fire without an appId', function noAppId() {
    renderHookWithProviders(() => useInitialBuildFirstViewTracking(true, null));

    expect(mockTrackFirstView).not.toHaveBeenCalled();
    expect(mockTrackMilestone).not.toHaveBeenCalled();
  });

  it('fires only once across re-renders with the flag still set', function noDoubleFire() {
    const { rerender } = renderHookWithProviders(
      (props: { seen: boolean }) => useInitialBuildFirstViewTracking(props.seen, APP_ID),
      { initialProps: { seen: true } }
    );

    rerender({ seen: true });
    rerender({ seen: true });

    expect(mockTrackFirstView).toHaveBeenCalledTimes(1);
    expect(mockTrackMilestone).toHaveBeenCalledTimes(2);
  });

  it('fires once on the false→true transition', function transition() {
    const { rerender } = renderHookWithProviders(
      (props: { seen: boolean }) => useInitialBuildFirstViewTracking(props.seen, APP_ID),
      { initialProps: { seen: false } }
    );

    expect(mockTrackFirstView).not.toHaveBeenCalled();

    rerender({ seen: true });

    expect(mockTrackFirstView).toHaveBeenCalledTimes(1);
  });

  it('re-fires for a new appId without a remount', function newAppId() {
    const { rerender } = renderHookWithProviders(
      (props: { appId: string }) => useInitialBuildFirstViewTracking(true, props.appId),
      { initialProps: { appId: 'app-a' } }
    );

    expect(mockTrackFirstView).toHaveBeenCalledTimes(1);

    rerender({ appId: 'app-b' });

    expect(mockTrackFirstView).toHaveBeenCalledTimes(2);
    expect(mockTrackMilestone).toHaveBeenCalledWith('preview_generated', {
      appId: 'app-b',
      msToFirstView: 4321,
    });
  });
});

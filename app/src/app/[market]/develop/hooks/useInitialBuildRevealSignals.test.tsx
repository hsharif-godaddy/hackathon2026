/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  useFirstFileEditFeedbackReveal,
  useJtbdFeedbackRevealSignal,
} from '@/app/[market]/develop/hooks/useInitialBuildRevealSignals';
import { renderHookWithProviders } from '@/tests/test-utils';

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

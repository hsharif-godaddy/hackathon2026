'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { trackFirstView } from '@/hooks/shared/initialBuildFunnel';
import {
  type FeedbackRevealSignals,
  isFeedbackRevealReady,
} from '@/lib/initial-build-reveal';
import {
  hasFeedbackRevealMilestone,
  markFeedbackRevealMilestone,
} from '@/lib/initial-build-reveal-storage';
import { JourneyTracker } from '@/lib/journeyTracker';

export interface FeedbackRevealState extends FeedbackRevealSignals {
  isRevealReady: boolean;
}

/**
 * Persists the `firstFileEdit` reveal milestone once the initialization machine
 * reports the first meaningful file edit.
 *
 * This is the write side that gates the First-Build-Feedback survey
 * (`useFirstBuildFeedback` reads `firstFileEdit` back via
 * `useJtbdFeedbackRevealSignal`). It is intentionally separate from the JTBD
 * reveal reader: `firstFileEdit` is excluded from
 * `ACTIVE_FEEDBACK_REVEAL_MILESTONES`, so it must never contribute to
 * agent-work task-completion feedback.
 */
export function useFirstFileEditFeedbackReveal(
  hasSeenFirstFileEdit: boolean,
  appId: string | null
): void {
  useEffect(() => {
    if (!hasSeenFirstFileEdit || !appId) return;
    markFeedbackRevealMilestone(appId, 'firstFileEdit');
  }, [hasSeenFirstFileEdit, appId]);
}

/**
 * Fires the initial-build "first view" analytics + FullStory milestones at the
 * moment the building overlay drops — i.e. when the initialization machine
 * reports the first meaningful file edit (`hasSeenFirstFileEdit`).
 *
 * This is the single, authoritative anchor for time-to-first-view (TTFV).
 * `hasSeenFirstFileEdit` is maintained for every build flow — normal builds
 * (canonical `isCompletedFileEdit` on the homepage edit), the design-kit
 * parallel build (the `wizardReady` bridge, whose sub-agent edits never reach
 * the parent stream), and the auto-send/failsafe paths — so anchoring here
 * avoids re-deriving the signal from `activeStream.toolCalls`, which would miss
 * the design-kit flow and fire too early (on scaffolding rather than the page).
 *
 * `trackFirstView()` is self-guarded by the funnel's `active`/`firstViewLogged`
 * state, so a reload of a finished app (funnel not activated) emits nothing.
 * The ref is keyed on `appId` rather than a plain boolean so the milestones
 * re-fire once per app even when one build flows straight into another without
 * the component remounting (mirroring the funnel's per-appId reset).
 */
export function useInitialBuildFirstViewTracking(
  hasSeenFirstFileEdit: boolean,
  appId: string | null
): void {
  const firedForAppIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasSeenFirstFileEdit || !appId || firedForAppIdRef.current === appId) return;
    firedForAppIdRef.current = appId;

    const msToFirstView: number | null = trackFirstView();
    JourneyTracker.current()?.trackMilestone('preview_generated', { appId, msToFirstView });
    JourneyTracker.current()?.trackMilestone('first_edit_made', { appId });
  }, [hasSeenFirstFileEdit, appId]);
}

/**
 * Composes JTBD reveal signals for agent-work feedback banner triggers.
 */
export function useJtbdFeedbackRevealSignal(appId: string | null): FeedbackRevealState {
  const [persistedVersion, setPersistedVersion] = useState(0);

  useEffect(() => {
    if (!appId) return;

    function onRevealUpdated(event: Event) {
      const detail = (event as CustomEvent<{ appId?: string }>).detail;
      if (detail?.appId === appId) {
        setPersistedVersion((version) => version + 1);
      }
    }

    window.addEventListener('appbuilder:feedback-reveal-updated', onRevealUpdated);
    return () => {
      window.removeEventListener('appbuilder:feedback-reveal-updated', onRevealUpdated);
    };
  }, [appId]);

  void persistedVersion;

  const logoDownload = appId ? hasFeedbackRevealMilestone(appId, 'logoDownload') : false;
  const logoDownstreamApply = appId
    ? hasFeedbackRevealMilestone(appId, 'logoDownstreamApply')
    : false;
  const websitePublish = appId ? hasFeedbackRevealMilestone(appId, 'websitePublish') : false;
  const websiteDomainConnect = appId
    ? hasFeedbackRevealMilestone(appId, 'websiteDomainConnect')
    : false;
  const domainPurchase = appId ? hasFeedbackRevealMilestone(appId, 'domainPurchase') : false;
  const domainDownstreamConnect = appId
    ? hasFeedbackRevealMilestone(appId, 'domainDownstreamConnect')
    : false;
  const firstFileEdit = appId ? hasFeedbackRevealMilestone(appId, 'firstFileEdit') : false;

  const signals = useMemo(
    function buildSignals(): FeedbackRevealSignals {
      return {
        logoDownload,
        logoDownstreamApply,
        websitePublish,
        websiteDomainConnect,
        domainPurchase,
        domainDownstreamConnect,
        imageSelection: false,
        firstFileEdit,
      };
    },
    [
      logoDownload,
      logoDownstreamApply,
      websitePublish,
      websiteDomainConnect,
      domainPurchase,
      domainDownstreamConnect,
      firstFileEdit,
    ]
  );

  return useMemo(
    function buildState(): FeedbackRevealState {
      return {
        ...signals,
        isRevealReady: isFeedbackRevealReady(signals),
      };
    },
    [signals]
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  type FeedbackRevealSignals,
  isFeedbackRevealReady,
} from '@/lib/initial-build-reveal';
import {
  hasFeedbackRevealMilestone,
  markFeedbackRevealMilestone,
} from '@/lib/initial-build-reveal-storage';

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

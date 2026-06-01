'use client';

import { useEffect, useState } from 'react';

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
 * Composes feedback reveal signals for banner triggers.
 *
 * Today only `firstFileEdit` is active (init machine / preview reveal).
 * To add logo or image flows later:
 *   1. Call `markFeedbackRevealMilestone(appId, 'logoCreation' | 'imageSelection')` from the workflow UI
 *   2. Add the milestone to `ACTIVE_FEEDBACK_REVEAL_MILESTONES` in `initial-build-reveal.ts`
 */
export function useInitialBuildRevealSignals(
  hasSeenFirstFileEdit: boolean,
  appId: string | null
): FeedbackRevealState {
  const [persistedVersion, setPersistedVersion] = useState(0);

  useEffect(() => {
    if (!hasSeenFirstFileEdit || !appId) return;
    markFeedbackRevealMilestone(appId, 'firstFileEdit');
  }, [hasSeenFirstFileEdit, appId]);

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

  const firstFileEdit =
    hasSeenFirstFileEdit ||
    (appId ? hasFeedbackRevealMilestone(appId, 'firstFileEdit') : false);

  const signals: FeedbackRevealSignals = {
    firstFileEdit,
    logoCreation: false,
    imageSelection: false,
  };

  return {
    ...signals,
    isRevealReady: isFeedbackRevealReady(signals),
  };
}

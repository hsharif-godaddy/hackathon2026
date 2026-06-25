import { useEffect } from 'react'

import { EXPERIMENT_IDS } from '@/config/experiments'
import { useAnalytics } from '@/hooks/useAnalytics'

/**
 * App ids that have already logged the "tracker shown" impression, kept at
 * module scope so an ask-question remount (the tracker unmounts during a
 * question turn and remounts afterward) does not re-fire the impression for the
 * same app — mirroring the per-app tick store in useProgressTracker.
 */
const impressedApps: Set<string> = new Set<string>()

/**
 * Logs a one-per-app "progress tracker shown" impression, tagged with the
 * aab_progress_tracker cohort so the funnel (tracker seen → first build) can be
 * built in FullStory. Call it from the tracker's own render so the impression
 * only counts a tracker the customer actually saw.
 *
 * @param appId - Current app id; the impression fires once per app.
 */
export function useProgressTrackerImpression(appId: string): void {
  const { logAnalytics } = useAnalytics({ experimentId: EXPERIMENT_IDS.aabProgressTracker })

  useEffect(() => {
    if (impressedApps.has(appId)) {
      return
    }
    impressedApps.add(appId)
    logAnalytics(
      'progressTracker.shown',
      { appId },
      { kind: 'impression', eid: 'develop.progressTracker.shown', impressionProps: { appId } },
    )
  }, [appId, logAnalytics])
}

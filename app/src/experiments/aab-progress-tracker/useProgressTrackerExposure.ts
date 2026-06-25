import { useEffect } from 'react'

import { EXPERIMENT_IDS, INELIGIBLE_COHORT } from '@/config/experiments'
import { useAnalytics } from '@/hooks/useAnalytics'

/**
 * App ids that have already logged the experiment exposure, kept at module scope
 * so a remount (e.g. the ask-question pause toggling the first-build screen) does
 * not re-fire it for the same app.
 */
const exposedApps: Set<string> = new Set<string>()

/**
 * Logs a one-per-app `aab_progress_tracker` exposure event for BOTH cohorts
 * (treatment `on` AND control `off`) when a bucketed user reaches the first-build
 * screen. Unlike the tracker "shown" impression — which only fires for treatment
 * because control never renders the tracker — this fires symmetrically, so a
 * control-vs-treatment funnel can be built in FullStory by filtering the single
 * event on its `cohort` property (FullStory has no "NOT" filter, so a
 * treatment-only event cannot anchor a both-arms funnel on its own).
 *
 * @param appId - Current app id; the exposure fires once per app.
 * @param active - True when the first-build screen is showing (the experiment's
 *   decision point); the exposure only fires while this is true.
 */
export function useProgressTrackerExposure(appId: string, active: boolean): void {
  const { logAnalytics, cohort } = useAnalytics({ experimentId: EXPERIMENT_IDS.aabProgressTracker })

  useEffect(() => {
    if (!active || cohort === INELIGIBLE_COHORT || exposedApps.has(appId)) {
      return
    }
    exposedApps.add(appId)
    logAnalytics(
      'progressTracker.exposure',
      { appId, cohort },
      { kind: 'impression', eid: 'develop.progressTracker.exposure', impressionProps: { appId } },
    )
  }, [appId, active, cohort, logAnalytics])
}

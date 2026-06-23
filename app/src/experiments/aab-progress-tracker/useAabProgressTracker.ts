import { useEffect, useState } from 'react'

import { EXPERIMENT_IDS } from '@/config/experiments'
import { useHivemind } from '@/hooks/useHivemind'

/** localStorage key + URL query param used to force the tracker on/off for QA. */
const QA_OVERRIDE_KEY = 'aabProgressTracker'

/**
 * Whether the first-build progress tracker should render for this user
 * under the `aab_progress_tracker` Hivemind experiment.
 *
 * Treatment cohort (`on`) sees the tracker; everyone else does not.
 *
 * QA override (survives a refresh, works on localhost):
 *   - URL param:    add `?aabProgressTracker=on` to the develop URL, or
 *   - localStorage: `localStorage.setItem('aabProgressTracker', 'on')`
 *     in the console, then refresh. Use `off` to force control.
 */
export function useAabProgressTracker(): boolean {
  const { cohort } = useHivemind(EXPERIMENT_IDS.aabProgressTracker)
  const [override, setOverride] = useState<string | undefined>(undefined)

  useEffect(function readQaOverride() {
    const fromQuery = new URLSearchParams(window.location.search).get(QA_OVERRIDE_KEY)
    const next = fromQuery ?? window.localStorage.getItem(QA_OVERRIDE_KEY)
    if (next) {
      setOverride(next)
    }
  }, [])

  return (override ?? cohort) === 'on'
}

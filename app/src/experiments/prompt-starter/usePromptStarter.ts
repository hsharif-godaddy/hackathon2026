import { useEffect, useState } from 'react'

import { COHORT_ON, EXPERIMENT_IDS } from '@/config/experiments'
import { useHivemind } from '@/hooks/useHivemind'

/** localStorage key + URL query param used to force the prompt-starter experience on/off for QA. */
const QA_OVERRIDE_KEY = 'promptStarter'

/**
 * Whether the homepage prompt-starter buttons should render for this user
 * under the `prompt_starter` Hivemind experiment.
 *
 * Treatment cohort (`on`) sees the starter buttons; control (`off`) does not.
 *
 * QA override (survives a refresh, works on localhost):
 *   - URL param:    add `?promptStarter=on` to the homepage URL, or
 *   - localStorage: `localStorage.setItem('promptStarter', 'on')`
 *     in the console, then refresh. Use `off` to force control.
 */
export function usePromptStarter(): boolean {
  const { cohort } = useHivemind(EXPERIMENT_IDS.promptStarter)
  const [override, setOverride] = useState<string | undefined>(undefined)

  useEffect(function readQaOverride() {
    const fromQuery = new URLSearchParams(window.location.search).get(QA_OVERRIDE_KEY)
    const next = fromQuery ?? window.localStorage.getItem(QA_OVERRIDE_KEY)
    if (next) {
      setOverride(next)
    }
  }, [])

  return (override ?? cohort) === COHORT_ON
}

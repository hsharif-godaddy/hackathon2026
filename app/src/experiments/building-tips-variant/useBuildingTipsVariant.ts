import { useEffect, useState } from 'react'

import { EXPERIMENT_IDS, INELIGIBLE_COHORT } from '@/config/experiments'
import { packageForCohort, type TipsVariantPackage } from '@/experiments/building-tips-variant/variant-packages'
import { useHivemind } from '@/hooks/useHivemind'

/** localStorage key + URL query param used to force a variant for QA/demo. */
const QA_OVERRIDE_KEY = 'buildingTipsVariant'

/**
 * Returns the active building-tips variant package for the current user.
 *
 * The package bundles the headline (H1) i18n keys with the rotating tip
 * card IDs so both are swapped together as one experience. Falls back to
 * Variant A (control) when the user is not bucketed into the experiment.
 *
 * QA override (survives a page refresh, unlike a bare `window` property):
 *   - URL param:    add `?buildingTipsVariant=variant_b` to the develop URL, or
 *   - localStorage: `localStorage.setItem('buildingTipsVariant', 'variant_b')`
 *     in the console, then refresh.
 *
 * The override is applied in an effect (after mount) so the server-rendered
 * markup matches the first client render and React does not report a
 * hydration mismatch.
 */
export function useBuildingTipsVariant(): TipsVariantPackage {
  const { cohort } = useHivemind(EXPERIMENT_IDS.buildingTipsVariant)
  const [override, setOverride] = useState<string | undefined>(undefined)

  useEffect(function readQaOverride() {
    const fromQuery = new URLSearchParams(window.location.search).get(QA_OVERRIDE_KEY)
    const next = fromQuery ?? window.localStorage.getItem(QA_OVERRIDE_KEY)
    if (next) {
      setOverride(next)
    }
  }, [])

  return packageForCohort(override || cohort || INELIGIBLE_COHORT)
}

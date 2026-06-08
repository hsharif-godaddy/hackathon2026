import type { ReadonlyURLSearchParams } from 'next/navigation'
import { useEffect, useLayoutEffect } from 'react'

import {
  setInstrumentationAppId,
  setInstrumentationBusinessName,
  setInstrumentationCreationSource,
  setInstrumentationEntryPoint,
  setInstrumentationIntentCategory,
  setInstrumentationPlanType,
} from '@/utils/instrumentation'
import {
  readCreationSourceFromSession,
  readEntryPointFromSession,
  readIntentCategoryFromSession,
} from '@/utils/traffic-signals'

interface UseInstrumentationPrimerOptions {
  appId: string | null | undefined
  isJobId: boolean
  planType: string | null
  searchParams: ReadonlyURLSearchParams
}

/**
 * Primes instrumentation module-level state for the develop page.
 *
 * Two separate effects with distinct dependency arrays:
 * - `useLayoutEffect([appId, isJobId, planType, searchParams])` — primes context
 *   from session (entry_point is set once at site creation) and URL hints.
 * - `useEffect([appId])` — clears business_name only when appId changes.
 *   business_name is written async by the setProjectName tool-result handler
 *   and must NOT be cleared by the broader effect (which re-runs on every
 *   searchParams change while appId stays the same).
 */
export function useInstrumentationPrimer({
  appId,
  isJobId,
  planType,
  searchParams,
}: UseInstrumentationPrimerOptions): void {
  useLayoutEffect(() => {
    if (appId && !isJobId) {
      // ?siteId is only present when opening an existing app from AppCard/AppItem
      const isReturnVisit = searchParams.get('siteId') != null

      // Return visits always use fresh 'my_apps' values — sessionStorage may hold stale
      // creation-time values from a previous session on the same app.
      const entryPoint = isReturnVisit
        ? 'my_apps'
        : (readEntryPointFromSession(appId) ?? 'direct_nav')

      const creationSource = isReturnVisit
        ? 'my_apps'
        : (readCreationSourceFromSession(appId) ?? null)

      // intent_category baseline:
      // - new_build when in the creation flow (sessionStorage marker set during quick-create)
      // - edit for existing apps (My Apps return visit or direct develop navigation)
      const inCreationFlow = sessionStorage.getItem(`in-creation-flow-${appId}`) === 'true'
      const intentCategory = readIntentCategoryFromSession(appId) ?? (inCreationFlow ? 'new_build' : 'edit')

      setInstrumentationAppId(appId)
      setInstrumentationEntryPoint(entryPoint)
      setInstrumentationPlanType(planType)
      setInstrumentationCreationSource(creationSource)
      setInstrumentationIntentCategory(intentCategory)
    } else {
      setInstrumentationAppId(null)
      setInstrumentationEntryPoint(null)
      setInstrumentationPlanType(null)
      setInstrumentationCreationSource(null)
      setInstrumentationIntentCategory(null)
      setInstrumentationBusinessName(null)
    }

    return () => {
      setInstrumentationAppId(null)
      setInstrumentationEntryPoint(null)
      setInstrumentationPlanType(null)
      setInstrumentationCreationSource(null)
      setInstrumentationIntentCategory(null)
      // business_name is NOT cleared here — it is written asynchronously by the
      // setProjectName tool result handler and must survive searchParams re-runs
      // that share the same appId. It is cleared by the sibling effect below.
    }
  }, [appId, isJobId, planType, searchParams])

  // Clear business_name only when appId truly changes or page unmounts — not
  // on every searchParams update that shares the same appId.
  useEffect(() => {
    return () => { setInstrumentationBusinessName(null) }
  }, [appId])
}

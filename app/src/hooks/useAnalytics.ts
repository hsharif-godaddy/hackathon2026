import { useCallback, useRef } from 'react'

import { INELIGIBLE_COHORT } from '@/config/experiments'
import { useHivemind } from '@/hooks/useHivemind'
import { shipAnalyticsLog } from '@/lib/logging'

export interface UseAnalyticsOptions {
  experimentId: string
  baseData?: Record<string, unknown>
}

export function useAnalytics({ experimentId, baseData = {} }: UseAnalyticsOptions) {
  const baseDataRef = useRef(baseData)
  baseDataRef.current = baseData

  const { cohort } = useHivemind(experimentId)
  const cohortValue = cohort ?? INELIGIBLE_COHORT

  const logAnalytics = useCallback((event: string, data: Record<string, unknown> = {}) => {
    shipAnalyticsLog(event, {
      ...baseDataRef.current,
      ...data,
      cohort: cohortValue,
    })
  }, [cohortValue])

  return {
    cohort: cohortValue,
    logAnalytics,
  }
}

import { useCallback, useRef } from 'react'

import { INELIGIBLE_COHORT } from '@/config/experiments'
import { useHivemind } from '@/hooks/useHivemind'
import { shipAnalyticsLog } from '@/lib/logging'
import { logActionEvent, logClickEvent, logImpressionEvent } from '@/utils/instrumentation'
import { getVisitorIdFromCookie } from '@/utils/visitor-id'

export interface UseAnalyticsOptions {
  experimentId: string
  baseData?: Record<string, unknown>
}

type AnalyticsEventKind = 'action' | 'click' | 'impression'

export interface AnalyticsEidOptions {
  kind?: AnalyticsEventKind
  eid?: string
  action?: 'blur' | 'drag' | 'focus' | 'hover' | 'load' | 'scroll'
  impressionProps?: Record<string, boolean | string | number>
}

/** The `logAnalytics` callback returned by {@link useAnalytics}. */
export type LogAnalytics = (
  event: string,
  data?: Record<string, unknown>,
  options?: AnalyticsEidOptions,
) => void

export function useAnalytics({ experimentId, baseData = {} }: UseAnalyticsOptions) {
  const baseDataRef = useRef(baseData)
  baseDataRef.current = baseData

  const { cohort } = useHivemind(experimentId)
  const cohortValue = cohort ?? INELIGIBLE_COHORT

  const logAnalytics = useCallback(
    (event: string, data: Record<string, unknown> = {}, options?: AnalyticsEidOptions) => {
      const visitorId = getVisitorIdFromCookie()
      shipAnalyticsLog(event, {
        ...baseDataRef.current,
        ...data,
        cohort: cohortValue,
        ...(visitorId !== undefined ? { visitorId } : {}),
      })

      if (!options?.kind) {
        return
      }

      const eid = options.eid ?? event

      switch (options.kind) {
        case 'click':
          logClickEvent(eid)()
          break
        case 'action':
          logActionEvent({
            eid,
            action: options.action ?? 'load',
          })()
          break
        case 'impression':
          logImpressionEvent(eid, {
            ...options.impressionProps,
            cohort: cohortValue,
          })()
          break
      }
    },
    [cohortValue],
  )

  return {
    cohort: cohortValue,
    logAnalytics,
  }
}

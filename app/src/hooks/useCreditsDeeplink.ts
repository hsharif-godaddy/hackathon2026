import { useEffect, useRef } from 'react'

import {
  ACTION_PARAM,
  clearDeeplinkParam,
  type DeeplinkSource,
  resolveDeeplinkSource,
} from '@/hooks/deeplinkParams'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { shipAnalyticsLog } from '@/lib/logging'

export const CREDITS_ACTION = 'showCredits'

/**
 * Strips `?action=showCredits` and `source` from the URL without triggering navigation.
 */
export function clearCreditsDeeplinkParam(): void {
  clearDeeplinkParam(CREDITS_ACTION)
}

interface UseCreditsDeeplinkOptions {
  openCredits: (source: DeeplinkSource) => void
  enabled?: boolean
}

/**
 * Detects `?action=showCredits` and auto-opens the credits purchase modal.
 * One-shot: strips the param after triggering. Gated by `appbuilder-credits-deeplink` flag.
 */
export function useCreditsDeeplink({
  openCredits,
  enabled = true,
}: UseCreditsDeeplinkOptions): void {
  const isFeatureEnabled = useSwitchboard('appbuilder-credits-deeplink')
  const hasTriggeredRef = useRef(false)

  useEffect(() => {
    if (!enabled || !isFeatureEnabled || hasTriggeredRef.current) return
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const action = params.get(ACTION_PARAM)

    if (action !== CREDITS_ACTION) return

    hasTriggeredRef.current = true

    const source = resolveDeeplinkSource(params)

    shipAnalyticsLog('credits.deeplink.triggered', {
      source,
      page: window.location.pathname,
    })

    try {
      openCredits(source)
    } finally {
      clearCreditsDeeplinkParam()
    }
  }, [enabled, isFeatureEnabled, openCredits])
}

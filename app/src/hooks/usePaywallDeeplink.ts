import { useEffect, useRef } from 'react'

import {
  ACTION_PARAM,
  clearDeeplinkParam,
  resolveDeeplinkSource,
} from '@/hooks/deeplinkParams'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { shipAnalyticsLog } from '@/lib/logging'
import { PAYWALL_TYPE, type PaywallType } from '@/lib/paywall/shared'

export const PAYWALL_ACTION = 'showPaywall'

/**
 * Strips `?action=showPaywall` and `source` from the URL without triggering navigation.
 */
export function clearPaywallDeeplinkParam(): void {
  clearDeeplinkParam(PAYWALL_ACTION)
}

interface UsePaywallDeeplinkOptions {
  openPaywall: (source: string, type?: PaywallType, itc?: string) => void
  enabled?: boolean
}

/**
 * Detects `?action=showPaywall` and auto-opens the paywall modal.
 * One-shot: strips the param after triggering. Gated by `appbuilder-paywall-deeplink` flag.
 */
export function usePaywallDeeplink({
  openPaywall,
  enabled = true,
}: UsePaywallDeeplinkOptions): void {
  const isFeatureEnabled = useSwitchboard('appbuilder-paywall-deeplink')
  const hasTriggeredRef = useRef(false)

  useEffect(() => {
    if (!enabled || !isFeatureEnabled || hasTriggeredRef.current) return
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const action = params.get(ACTION_PARAM)

    if (action !== PAYWALL_ACTION) return

    hasTriggeredRef.current = true

    const source = resolveDeeplinkSource(params)

    shipAnalyticsLog('paywall.deeplink.triggered', {
      source,
      page: window.location.pathname,
    })

    try {
      openPaywall(source, PAYWALL_TYPE.UPGRADE)
    } finally {
      clearPaywallDeeplinkParam()
    }
  }, [enabled, isFeatureEnabled, openPaywall])
}

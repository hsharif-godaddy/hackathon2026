import { useEffect, useRef } from 'react'

import { useSwitchboard } from '@/hooks/useSwitchboard'
import { shipAnalyticsLog } from '@/lib/logging'
import { PAYWALL_TYPE, type PaywallType } from '@/lib/paywall/shared'

const ACTION_PARAM = 'action'
const PAYWALL_ACTION = 'showPaywall'

/** Allowed source values for deeplinks. Unknown sources fall back to DEEPLINK. */
const ALLOWED_SOURCES = {
  DEEPLINK: 'deeplink',
  BELL_CAMPAIGN: 'bell_campaign',
} as const

const ALLOWED_SOURCE_VALUES: Set<string> = new Set(Object.values(ALLOWED_SOURCES))


const SOURCE_PARAM = 'source'

/**
 * Strips `?action=showPaywall` and `source` from the URL without triggering navigation.
 * Only removes params if action equals 'showPaywall' to avoid affecting other action values.
 */
export function clearPaywallDeeplinkParam(): void {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams(window.location.search)
  if (params.get(ACTION_PARAM) !== PAYWALL_ACTION) return

  params.delete(ACTION_PARAM)
  params.delete(SOURCE_PARAM)
  const newSearch = params.toString()
  const hash = window.location.hash
  const newUrl = newSearch
    ? `${window.location.pathname}?${newSearch}${hash}`
    : `${window.location.pathname}${hash}`
  window.history.replaceState(null, '', newUrl)
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

    const rawSource = params.get('source') ?? ''
    const source = ALLOWED_SOURCE_VALUES.has(rawSource) ? rawSource : ALLOWED_SOURCES.DEEPLINK
    // ITC is handled by ItcInitializer — no need to extract here

    shipAnalyticsLog('paywall.deeplink.triggered', {
      source,
      page: window.location.pathname,
    })

    openPaywall(source, PAYWALL_TYPE.UPGRADE)
    clearPaywallDeeplinkParam()
  }, [enabled, isFeatureEnabled, openPaywall])
}

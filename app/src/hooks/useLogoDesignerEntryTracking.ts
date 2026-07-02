import { useEffect, useRef } from 'react'

import { LOGO_DESIGNER_TEMPLATE } from '@/app/[market]/components/types'
import { logLogoDesignerEntry } from '@/lib/logo-designer-entry'
import { getModeParam } from '@/lib/mode-param'

interface UseLogoDesignerEntryTrackingOptions {
  enabled?: boolean
}

/**
 * Fires a one-shot `homepage.logo_designer.entry` event with `entrySource: 'deeplink'`
 * when the landing page is opened with `?mode=logo-designer` (or the legacy
 * `?template=logo-designer` alias). Passive tracking
 * only: it does NOT strip the param, since it also drives the logo-mode UI. The
 * chip and suggestion-button pathways log the same event from their own handlers.
 *
 * @param enabled - Gates tracking; defaults to true. Pass false on surfaces that
 *   should not attribute deep-link entries (i.e. anywhere but the landing page).
 */
export function useLogoDesignerEntryTracking({ enabled = true }: UseLogoDesignerEntryTrackingOptions = {}): void {
  const hasTrackedRef = useRef(false)

  useEffect(() => {
    if (!enabled || hasTrackedRef.current) return
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    if (getModeParam(params) !== LOGO_DESIGNER_TEMPLATE) return

    hasTrackedRef.current = true
    logLogoDesignerEntry('deeplink')
  }, [enabled])
}

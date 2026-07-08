import { useEffect, useState } from 'react'

import { useSwitchboard } from '@/hooks/useSwitchboard'

/** localStorage key + URL query param to force the template selector on/off for QA. */
const QA_OVERRIDE_KEY = 'templateSelector'

/**
 * Whether the homepage template selector should render.
 *
 * Backed by the `appbuilder-template-selector` Switchboard flag, with a QA
 * override (survives refresh, works on localhost):
 *   - URL param:    `?templateSelector=on` (or `off`), or
 *   - localStorage: `localStorage.setItem('templateSelector', 'on')`.
 */
export function useTemplateSelector(): boolean {
  const flagEnabled: boolean | undefined = useSwitchboard('appbuilder-template-selector')
  const [override, setOverride] = useState<string | undefined>(undefined)

  useEffect(function readQaOverride(): void {
    const fromQuery: string | null = new URLSearchParams(window.location.search).get(QA_OVERRIDE_KEY)
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(QA_OVERRIDE_KEY)
    } catch {
      // storage blocked (Safari private / policy) — fall back to the Switchboard flag
    }
    const next: string | null = fromQuery ?? stored
    if (next) {
      setOverride(next)
    }
  }, [])

  if (override) {
    return override === 'on'
  }
  return flagEnabled === true
}

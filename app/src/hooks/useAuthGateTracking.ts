import { type MutableRefObject, useEffect } from 'react'

import { ClientLogBuffer } from '@/lib/logging'
import { useAuthUIStore } from '@/stores/useAuthUIStore'

type LogAnalyticsFn = (
  event: string,
  data?: Record<string, unknown>,
  options?: {
    kind?: 'action' | 'click' | 'impression'
    eid?: string
    action?: 'blur' | 'drag' | 'focus' | 'hover' | 'load' | 'scroll' | 'custom'
  },
) => void

interface AuthGateRefs {
  authGateShownAtRef: MutableRefObject<number | null>
  promptTextRef: MutableRefObject<string>
}

/**
 * Tracks SSO auth gate outcomes for the homepage funnel.
 *
 * Listens to the SSO close reason from the auth UI store and fires
 * analytics events so the full funnel is visible in Elastic:
 *
 *   homepage.auth_gate.shown  (fired by caller; CSP element action load on homepage.auth.gate)
 *       ├── homepage.auth_gate.completed   — SSO success (CSP click homepage.auth.complete)
 *       ├── homepage.auth_gate.dismissed   — modal closed (CSP click homepage.auth.dismiss)
 *       └── homepage.auth_gate.abandoned   — tab close / navigation (client log only)
 *
 * CSP rejects add_element_action with action custom; completed/dismiss use click schema instead.
 */
export function useAuthGateTracking(
  logAnalytics: LogAnalyticsFn,
  { authGateShownAtRef, promptTextRef }: AuthGateRefs,
) {
  const ssoCloseReason = useAuthUIStore((s) => s.ssoCloseReason)
  const clearSsoCloseReason = useAuthUIStore((s) => s.clearSsoCloseReason)

  useEffect(() => {
    if (ssoCloseReason == null) return

    if (ssoCloseReason === 'success') {
      if (authGateShownAtRef.current != null) {
        logAnalytics(
          'homepage.auth_gate.completed',
          {
            msFromShown: Math.round(Date.now() - authGateShownAtRef.current),
            promptLength: promptTextRef.current.length,
          },
          {
            kind: 'click',
            eid: 'homepage.auth.complete',
          },
        )
      }
      authGateShownAtRef.current = null
    } else if (ssoCloseReason === 'dismiss' && authGateShownAtRef.current != null) {
      logAnalytics(
        'homepage.auth_gate.dismissed',
        {
          msFromShown: Math.round(Date.now() - authGateShownAtRef.current),
          promptLength: promptTextRef.current.length,
        },
        {
          kind: 'click',
          eid: 'homepage.auth.dismiss',
        },
      )
      authGateShownAtRef.current = null
    }

    clearSsoCloseReason()
  }, [authGateShownAtRef, clearSsoCloseReason, logAnalytics, promptTextRef, ssoCloseReason])

  useEffect(function trackAuthGateAbandonment() {
    function onPageHide() {
      if (authGateShownAtRef.current == null) return
      logAnalytics('homepage.auth_gate.abandoned', {
        msFromShown: Math.round(Date.now() - authGateShownAtRef.current),
        promptLength: promptTextRef.current.length,
      })
      authGateShownAtRef.current = null
      ClientLogBuffer.flush()
    }

    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [authGateShownAtRef, logAnalytics, promptTextRef])
}

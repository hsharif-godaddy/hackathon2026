import { type MutableRefObject, useEffect } from 'react'

import { JourneyTracker } from '@/lib/journeyTracker'
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
 *   homepage.auth_gate.shown  (fired by caller at gate open time)
 *       ├── homepage.auth_gate.completed   — user finished SSO
 *       ├── homepage.auth_gate.dismissed   — user clicked X / closed modal
 *       └── homepage.auth_gate.abandoned   — user left the page (tab close / navigation)
 *
 * All outcomes are also sent to FullStory via JourneyTracker milestones.
 */
export function useAuthGateTracking(
  logAnalytics: LogAnalyticsFn,
  { authGateShownAtRef, promptTextRef }: AuthGateRefs,
) {
  const isSsoLoginOpen = useAuthUIStore((s) => s.isSsoLoginOpen)
  const ssoCloseReason = useAuthUIStore((s) => s.ssoCloseReason)
  const clearSsoCloseReason = useAuthUIStore((s) => s.clearSsoCloseReason)

  useEffect(function trackAuthGateShown() {
    if (isSsoLoginOpen && authGateShownAtRef.current != null) {
      JourneyTracker.current()?.trackMilestone('auth_gate_shown', {
        promptLength: promptTextRef.current.length,
      })
    }
  }, [isSsoLoginOpen, authGateShownAtRef, promptTextRef])

  useEffect(() => {
    if (ssoCloseReason == null) return

    if (ssoCloseReason === 'success') {
      if (authGateShownAtRef.current != null) {
        const msFromShown = Math.round(Date.now() - authGateShownAtRef.current)
        logAnalytics(
          'homepage.auth_gate.completed',
          {
            msFromShown,
            promptLength: promptTextRef.current.length,
          },
          {
            kind: 'click',
            eid: 'homepage.auth.complete',
          },
        )
        JourneyTracker.current()?.trackMilestone('auth_gate_completed', {
          msFromShown,
          promptLength: promptTextRef.current.length,
        })
      }
      authGateShownAtRef.current = null
    } else if (ssoCloseReason === 'dismiss' && authGateShownAtRef.current != null) {
      const msFromShown = Math.round(Date.now() - authGateShownAtRef.current)
      logAnalytics(
        'homepage.auth_gate.dismissed',
        {
          msFromShown,
          promptLength: promptTextRef.current.length,
        },
        {
          kind: 'click',
          eid: 'homepage.auth.dismiss',
        },
      )
      JourneyTracker.current()?.trackMilestone('auth_gate_dismissed', {
        msFromShown,
        promptLength: promptTextRef.current.length,
      })
      authGateShownAtRef.current = null
    }

    clearSsoCloseReason()
  }, [authGateShownAtRef, clearSsoCloseReason, logAnalytics, promptTextRef, ssoCloseReason])

  useEffect(function trackAuthGateAbandonment() {
    function onPageHide() {
      if (authGateShownAtRef.current == null) return
      const msFromShown = Math.round(Date.now() - authGateShownAtRef.current)
      logAnalytics('homepage.auth_gate.abandoned', {
        msFromShown,
        promptLength: promptTextRef.current.length,
      })
      JourneyTracker.current()?.trackMilestone('auth_gate_abandoned', {
        msFromShown,
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

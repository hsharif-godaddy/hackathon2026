import { useEffect, useRef } from 'react'
import { FlowStep } from './useSocialConnectFlowStateMachine'
import { SocialFlowAction } from '@/types/social'
import { OAUTH_TIMEOUT_MS } from '@/lib/social'

interface UseSocialOAuthTimeoutProps {
  flowStep: FlowStep
  dispatch: (action: any) => void
  timeoutMs?: number
}

/**
 * Monitors OAuth flow and dispatches timeout action if flow takes too long
 *
 * @param flowStep - Current flow step
 * @param dispatch - State machine dispatch function
 * @param timeoutMs - Timeout duration in milliseconds (default: 5 minutes)
 */
export function useSocialOAuthTimeout({
  flowStep,
  dispatch,
  timeoutMs = OAUTH_TIMEOUT_MS
}: UseSocialOAuthTimeoutProps) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (flowStep === FlowStep.Auth) {
      timeoutRef.current = setTimeout(() => {
        dispatch({ type: SocialFlowAction.OAuthTimeout })
      }, timeoutMs)
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [flowStep, dispatch, timeoutMs])
}

import { useRef } from 'react'

import { useSSEChat } from './useSSEChat'
import { useStreamingWebSocket } from './useStreamingWebSocket'
import { useSwitchboard } from './useSwitchboard'

type TransportResult = ReturnType<typeof useSSEChat> | ReturnType<typeof useStreamingWebSocket>

/**
 * Selects between WS and SSE transports based on a switchboard flag, locking
 * onto the first resolved value so the transport can't swap mid-session.
 *
 * SSE is additionally gated on BMS being enabled for the caller. Grants-mode
 * (non-BMS) users are routed to WS — WS owns the mid-stream grant-advancement
 * retry path (onBudgetExhaustedMidStream) that SSE does not port. This gate
 * is client-only; the SSE server has no corresponding BMS check.
 *
 * Both underlying hooks are mounted every render because React forbids
 * conditional hook calls; the unselected hook receives `enabled: false` and
 * short-circuits its effects so it does not allocate transports, controllers,
 * or subscriber registrations.
 */
export function useChatTransport(): TransportResult {
  const sseEnabled = useSwitchboard('app-builder-sse-transport')
  const budgetServiceEnabled = useSwitchboard('app-builder-budget-service')

  const resolvedRef = useRef<boolean | null>(null)
  if (resolvedRef.current === null) {
    if (sseEnabled !== undefined && budgetServiceEnabled !== undefined) {
      resolvedRef.current = sseEnabled === true && budgetServiceEnabled === true
    } else if (typeof window !== 'undefined') {
      // Flag absent from the loaded tree on the client — default to WS rather
      // than waiting forever. SSR renders still return undefined here and stay
      // unresolved until hydration.
      resolvedRef.current = false
    }
  }
  const resolved = resolvedRef.current !== null
  const useSSE = resolvedRef.current === true

  const sse = useSSEChat({ enabled: resolved && useSSE })
  const ws = useStreamingWebSocket({ enabled: resolved && !useSSE })

  return useSSE ? sse : ws
}

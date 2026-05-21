import { useRef } from 'react'

import { useSSEChat } from './useSSEChat'
import { useStreamingWebSocket } from './useStreamingWebSocket'
import { useSwitchboard } from './useSwitchboard'

type TransportResult = ReturnType<typeof useSSEChat> | ReturnType<typeof useStreamingWebSocket>

/**
 * Selects between WS and SSE transports based on a switchboard flag, locking
 * onto the first resolved value so the transport can't swap mid-session.
 *
 * Both underlying hooks are mounted every render because React forbids
 * conditional hook calls; the unselected hook receives `enabled: false` and
 * short-circuits its effects so it does not allocate transports, controllers,
 * or subscriber registrations.
 */
export function useChatTransport(): TransportResult {
  const sseEnabled = useSwitchboard('app-builder-sse-transport')

  const resolvedRef = useRef<boolean | null>(null)
  if (resolvedRef.current === null) {
    if (sseEnabled !== undefined) {
      resolvedRef.current = sseEnabled === true
    } else if (typeof window !== 'undefined') {
      resolvedRef.current = false
    }
  }
  const resolved = resolvedRef.current !== null
  const useSSE = resolvedRef.current === true

  const sse = useSSEChat({ enabled: resolved && useSSE })
  const ws = useStreamingWebSocket({ enabled: resolved && !useSSE })

  return useSSE ? sse : ws
}

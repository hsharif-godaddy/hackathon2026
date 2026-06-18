import { useSSEChat } from './useSSEChat'

/**
 * Chat transport entry point. SSE is the only transport; this indirection is
 * kept so call sites depend on a transport-neutral name rather than useSSEChat
 * directly. (Historically selected between WS and SSE behind a Switchboard flag;
 * the WebSocket transport was removed in AIROBUILD-2629.)
 */
export function useChatTransport({ enabled = true }: { enabled?: boolean } = {}): ReturnType<typeof useSSEChat> {
  return useSSEChat({ enabled })
}

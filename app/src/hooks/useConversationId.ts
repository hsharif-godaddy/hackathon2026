import { useEffect, useRef, useState } from 'react'

const CONVERSATION_ID_PARAM = 'conversationId'

/**
 * Reads `?conversationId=` once on mount and returns it (render-stable), then
 * strips it from the URL via history.replaceState (consume-once deep link).
 *
 * This is the GoDaddy Conversations (inbox) conversation — distinct from the
 * agent/chat `conversationId` stored per-app in a cookie elsewhere.
 *
 * Non-reactive by design — deep-link-on-load only. SSR-safe (returns null on
 * the server). Preserves all other query params and the hash. Reads
 * window.location.search directly, matching useView/useChatTabs (avoids the
 * App Router useSearchParams Suspense requirement).
 *
 * Intended for use from Inbox, which only mounts in the inbox view — so
 * the read and the strip happen only when the inbox view actually renders. If
 * inbox is unavailable (flag off / no brand), the param is left untouched.
 */
export function useConversationId(): string | null {
  const [conversationId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get(CONVERSATION_ID_PARAM) || null
  })

  const hasStrippedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || hasStrippedRef.current) return

    const params = new URLSearchParams(window.location.search)
    const raw = params.get(CONVERSATION_ID_PARAM)
    if (!raw) return // absent or empty: nothing to strip

    hasStrippedRef.current = true
    params.delete(CONVERSATION_ID_PARAM)
    const query = params.toString()
    const { pathname, hash } = window.location
    const newUrl = query ? `${pathname}?${query}${hash}` : `${pathname}${hash}`
    window.history.replaceState(null, '', newUrl)
  }, [])

  return conversationId
}

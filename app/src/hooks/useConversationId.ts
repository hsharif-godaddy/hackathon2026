import { useEffect, useState } from 'react'

import { ViewMode } from '@/app/[market]/develop/components/types'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { IntString } from '@/types/inbox/local/core'

export const CONVERSATION_ID_PARAM = 'conversationId'

const readConversationIdParam = (): IntString | null => {
  if (typeof window === 'undefined') return null
  return (new URLSearchParams(window.location.search).get(CONVERSATION_ID_PARAM) || null) as IntString | null
}

export interface UseConversationIdResult {
  activeConversationId: IntString | null
  setActiveConversationId: (conversationId: IntString | null) => void
}

/**
 * Bidirectionally syncs the `?conversationId=` URL param with the inbox's
 * active conversation, mirroring useView's store<->URL pattern.
 *
 * Invariant: `?conversationId=<id>` is present iff the develop view is INBOX
 * and a conversation is active. Selecting a conversation, returning to the
 * list, reloading, and Back/Forward all keep the param and the view in sync.
 * All writes use replaceState (the URL reflects current state without adding
 * history entries), matching useView. Reads window.location.search directly
 * and only touches `conversationId`, so it composes with the `?view=` sync
 * (other params and the hash are preserved). SSR-safe (null on the server).
 *
 * This is the GoDaddy Conversations (inbox) conversation id — distinct from the
 * agent/chat `conversationId` stored per-app in a cookie elsewhere.
 *
 * Intended for use from Inbox, which only first mounts once the develop view is
 * INBOX — so the deep-link param is left untouched while useView resolves inbox
 * availability, and is only adopted once the inbox actually renders.
 *
 * Leaving the inbox clears the active conversation, so returning to the inbox
 * always lands on the conversation list rather than reopening the last one
 * (Inbox can stay mounted across view switches in canvas-tabs mode).
 */
export function useConversationId(): UseConversationIdResult {
  const [activeConversationId, setActiveConversationId] = useState<IntString | null>(() =>
    readConversationIdParam(),
  )

  const viewMode = useDevelopPageStore((state) => state.viewMode)

  // Leaving the inbox resets to the list, so a later return does not reopen the
  // previously active conversation.
  useEffect(() => {
    if (viewMode !== ViewMode.INBOX && activeConversationId !== null) {
      setActiveConversationId(null)
    }
  }, [viewMode, activeConversationId])

  // state -> URL. Param present iff in INBOX with an active conversation.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    if (viewMode === ViewMode.INBOX && activeConversationId) {
      params.set(CONVERSATION_ID_PARAM, activeConversationId)
    } else {
      params.delete(CONVERSATION_ID_PARAM)
    }

    const query = params.toString()
    const { pathname, hash } = window.location
    const newUrl = query ? `${pathname}?${query}${hash}` : `${pathname}${hash}`
    const currentUrl = window.location.pathname + window.location.search + window.location.hash
    if (newUrl !== currentUrl) {
      window.history.replaceState(null, '', newUrl)
    }
  }, [activeConversationId, viewMode])

  // Back/forward (or any external nav): reflect the URL into state.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = (): void => setActiveConversationId(readConversationIdParam())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  return { activeConversationId, setActiveConversationId }
}

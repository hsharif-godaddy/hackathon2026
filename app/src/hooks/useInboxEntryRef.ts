import { useCallback, useEffect, useRef } from 'react'

export const INBOX_REF_PARAM = 'ref'

/**
 * Known inbox deep-link entry points. Only these values are attributed to the
 * landing impression; any other `?ref=` is treated as no entry point (but still
 * stripped from the URL). Add new entry points here as they're introduced so the
 * analytics `ref` dimension stays a closed, clean set.
 */
export const INBOX_ENTRY_REFS = ['email'] as const

export type InboxEntryRef = (typeof INBOX_ENTRY_REFS)[number]

const isInboxEntryRef = (value: string | null): value is InboxEntryRef =>
  value !== null && (INBOX_ENTRY_REFS as readonly string[]).includes(value)

const readInboxEntryRef = (): InboxEntryRef | null => {
  if (typeof window === 'undefined') return null
  const value: string | null = new URLSearchParams(window.location.search).get(INBOX_REF_PARAM)
  return isInboxEntryRef(value) ? value : null
}

export interface UseInboxEntryRefResult {
  consumeEntryRef: () => InboxEntryRef | null
}

/**
 * Captures the inbox deep-link entry-point param (`?ref=`, e.g. `ref=email`) once
 * on first client render, then strips it from the URL on mount.
 *
 * Unlike the `?view=` and `?conversationId=` syncs (useView / useConversationId),
 * which bidirectionally mirror store state, `ref` is read-once: it records how the
 * user arrived (e.g. from an email link) for the landing impression and is then
 * removed so reloads and Back/Forward don't re-trigger it. The capture is
 * allow-listed to `INBOX_ENTRY_REFS`, so an unknown/junk `ref` attributes nothing.
 * The strip only deletes `ref` (whether or not it was a known entry point) and
 * re-reads `window.location.search` at effect time, so it composes with the other
 * URL syncs (other params and the hash are preserved). SSR-safe (null on the server).
 *
 * `consumeEntryRef` returns the captured value and clears it, so the value attaches
 * to exactly one impression (the deep-link landing page — list or detail) and is not
 * re-attributed to later in-session navigation.
 */
export function useInboxEntryRef(): UseInboxEntryRefResult {
  const entryRefRef = useRef<InboxEntryRef | null>(readInboxEntryRef())

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    if (!params.has(INBOX_REF_PARAM)) return
    params.delete(INBOX_REF_PARAM)

    const query = params.toString()
    const { pathname, hash } = window.location
    const newUrl = query ? `${pathname}?${query}${hash}` : `${pathname}${hash}`
    window.history.replaceState(null, '', newUrl)
  }, [])

  const consumeEntryRef = useCallback((): InboxEntryRef | null => {
    const value: InboxEntryRef | null = entryRefRef.current
    entryRefRef.current = null
    return value
  }, [])

  return { consumeEntryRef }
}

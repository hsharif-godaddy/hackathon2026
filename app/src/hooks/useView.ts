import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

import { ViewMode } from '@/app/[market]/develop/components/types'
import { CONVERSATION_ID_PARAM } from '@/hooks/useConversationId'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

/** Per-mode availability supplied by the caller. */
export interface ViewAvailability {
  available: boolean
  resolving: boolean
}

export interface UseViewOptions {
  /**
   * Returns availability for a given view mode. For modes with no gating
   * concept, return { available: true, resolving: false }.
   */
  getViewAvailability: (mode: ViewMode) => ViewAvailability
}

/** View modes that participate in the `?view=` URL param. Inbox-only today. */
const URL_SYNCED_VIEW_MODES: ReadonlySet<ViewMode> = new Set<ViewMode>([ViewMode.INBOX])

/** Fall-back view mode when a synced deep link is invalid/unavailable. */
const DEFAULT_VIEW_MODE = ViewMode.EDIT

const VIEW_PARAM = 'view'

const buildUrl = (pathname: string, params: URLSearchParams): string => {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

const parseViewMode = (value: string | null): ViewMode | null => {
  if (value && URL_SYNCED_VIEW_MODES.has(value as ViewMode)) {
    return value as ViewMode
  }
  return null
}

/**
 * Synchronizes the `?view=` URL param with the develop store's `viewMode`.
 *
 * Mirrors useChatTabs: reads the param on mount (per-pathname init guard),
 * writes via window.history (replaceState first, pushState after) to avoid
 * Next.js navigation remounts, and re-syncs on popstate. Mode-agnostic: only
 * modes in URL_SYNCED_VIEW_MODES touch the URL. Availability gating defers the
 * fall-back decision until the caller reports the mode as resolved, so a valid
 * deep link is not stripped while async data (e.g. the inbox brand) loads.
 */
export function useView({ getViewAvailability }: UseViewOptions): void {
  const pathname = usePathname()

  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const viewInitializedForPathname = useDevelopPageStore((state) => state.viewInitializedForPathname)
  const setViewMode = useDevelopPageStore((state) => state.setViewMode)
  const markViewInitialized = useDevelopPageStore((state) => state.markViewInitialized)

  // Keep the latest availability fn for the stable popstate handler without
  // re-registering the listener whenever availability changes.
  const getAvailabilityRef = useRef(getViewAvailability)
  getAvailabilityRef.current = getViewAvailability

  // URL -> store (deep linking), guarded per-pathname. Re-runs when
  // getViewAvailability identity changes (i.e. when availability resolves).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (viewInitializedForPathname === pathname) return

    const params = new URLSearchParams(window.location.search)
    const urlMode = parseViewMode(params.get(VIEW_PARAM))

    if (urlMode) {
      const { available, resolving } = getViewAvailability(urlMode)

      // Hold: do not initialize yet so this effect re-runs once resolved.
      if (resolving) return

      if (available) {
        if (viewMode !== urlMode) {
          setViewMode(urlMode)
        }
        markViewInitialized(pathname)
        return
      }

      // Unavailable: strip the param and leave the store default in place.
      params.delete(VIEW_PARAM)
      const normalizedUrl = buildUrl(pathname, params)
      const currentUrl = window.location.pathname + window.location.search
      if (normalizedUrl !== currentUrl) {
        window.history.replaceState(null, '', normalizedUrl)
      }
      markViewInitialized(pathname)
      return
    }

    // No / invalid view param: nothing to restore, just mark initialized.
    markViewInitialized(pathname)
  }, [pathname, viewInitializedForPathname, viewMode, getViewAvailability, setViewMode, markViewInitialized])

  // store -> URL. Invariant: ?view=<mode> present iff viewMode is URL-synced.
  // Always replaceState: the URL reflects the current view without adding
  // history entries (Back/Forward is not used to move between views).
  useEffect(() => {
    if (typeof window === 'undefined' || viewInitializedForPathname !== pathname) {
      return
    }

    const params = new URLSearchParams(window.location.search)
    if (URL_SYNCED_VIEW_MODES.has(viewMode)) {
      params.set(VIEW_PARAM, viewMode)
    } else {
      params.delete(VIEW_PARAM)
    }

    // The inbox conversation deep-link param belongs only to the INBOX view.
    // Inbox (which owns setting it) can unmount on a view change, so it cannot
    // reliably strip its own param; useView is always mounted, making it the
    // reliable place to enforce "conversationId present => view is INBOX".
    if (viewMode !== ViewMode.INBOX) {
      params.delete(CONVERSATION_ID_PARAM)
    }

    const newUrl = buildUrl(pathname, params)
    const currentUrl = window.location.pathname + window.location.search
    if (newUrl !== currentUrl) {
      window.history.replaceState(null, '', newUrl)
    }
  }, [viewMode, pathname, viewInitializedForPathname])

  // Back/forward: reflect the URL's view dimension into the store.
  const handlePopState = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    const urlMode = parseViewMode(params.get(VIEW_PARAM))

    if (urlMode && getAvailabilityRef.current(urlMode).available) {
      setViewMode(urlMode)
      return
    }

    // No synced mode in the URL: only act if we're currently in one.
    if (URL_SYNCED_VIEW_MODES.has(useDevelopPageStore.getState().viewMode)) {
      setViewMode(DEFAULT_VIEW_MODE)
    }
  }, [setViewMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [handlePopState])
}

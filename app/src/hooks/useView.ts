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
  /**
   * Optional: the view mode to land on for a fresh load (no valid `?view=`
   * deep link to restore). Return `null` to keep the store default. Lets the
   * caller pick a profile-specific landing tab (e.g. the design-kit wizard
   * lands on `BRAND`) without baking policy into this generic hook. A valid
   * URL deep link always wins over this default.
   */
  resolveInitialViewMode?: () => ViewMode | null
  /**
   * Optional: hold the initial-default landing (don't apply it or mark the view
   * initialized) until the caller can decide it. Mirrors the per-mode `resolving`
   * hold below: the effect re-runs once this clears. Lets a caller defer a
   * data-dependent landing — e.g. the design-kit BRAND tab, which depends on the
   * async persisted wizard phase — so a finished app never briefly flashes the
   * wizard before we know to skip it. A valid `?view=` deep link still wins.
   */
  initialViewResolving?: boolean
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
export function useView({ getViewAvailability, resolveInitialViewMode, initialViewResolving }: UseViewOptions): void {
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

    // Land on the caller's preferred initial mode when no valid deep link
    // governs the view. A valid `?view=` deep link always wins over this.
    const applyInitialDefault = (): void => {
      const initialMode = resolveInitialViewMode?.()
      if (initialMode && viewMode !== initialMode) {
        setViewMode(initialMode)
      }
    }

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

      // Unavailable: strip the param and fall back to the initial default.
      params.delete(VIEW_PARAM)
      const normalizedUrl = buildUrl(pathname, params)
      const currentUrl = window.location.pathname + window.location.search
      if (normalizedUrl !== currentUrl) {
        window.history.replaceState(null, '', normalizedUrl)
      }
      // Hold the initial default until the caller resolves it (re-runs on clear).
      if (initialViewResolving) return
      applyInitialDefault()
      markViewInitialized(pathname)
      return
    }

    // No / invalid view param: land on the initial default. Hold it until the
    // caller resolves it (re-runs on clear) so a data-dependent landing never
    // flashes the wrong view.
    if (initialViewResolving) return
    applyInitialDefault()
    markViewInitialized(pathname)
  }, [pathname, viewInitializedForPathname, viewMode, getViewAvailability, resolveInitialViewMode, initialViewResolving, setViewMode, markViewInitialized])

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

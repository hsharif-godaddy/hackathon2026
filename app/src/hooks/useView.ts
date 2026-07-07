import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

import { CANVAS_REGISTRY, type CanvasId } from '@/app/[market]/commander/canvas/registry'
import { ViewMode } from '@/app/[market]/develop/components/types'
import { CONVERSATION_ID_PARAM } from '@/hooks/useConversationId'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
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

/**
 * Reverse of `CANVAS_REGISTRY[*].activation.viewMode`: maps a view mode back to the
 * canvas tab that owns it. Derived from the registry so it can't drift from the
 * forward mapping. Used to reconcile the commander canvas-tab state when a deep link
 * drives `viewMode` directly (which otherwise bypasses the tab strip entirely).
 */
const CANVAS_ID_BY_VIEW_MODE: ReadonlyMap<ViewMode, CanvasId> = new Map(
  Object.values(CANVAS_REGISTRY).flatMap((descriptor) =>
    descriptor.activation.viewMode ? [[descriptor.activation.viewMode, descriptor.id] as const] : [],
  ),
)

const buildUrl = (pathname: string, params: URLSearchParams): string => {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

/**
 * Reconcile the commander canvas-tab strip with a deep-linked view mode. A deep link
 * drives only the develop store's `viewMode`; without this the owning tab is never
 * opened/activated (and `setActiveCanvas` no-ops while the tab isn't open). `openCanvas`
 * both makes the tab visible and sets it active — mirroring a menu selection — and is a
 * no-op if already open. Gated on the canvas-tabs feature so nothing happens when the
 * strip isn't rendered (e.g. PaaS / flag off).
 */
const activateCanvasForViewMode = (mode: ViewMode, canvasTabsEnabled: boolean): void => {
  if (!canvasTabsEnabled) return
  const canvasId = CANVAS_ID_BY_VIEW_MODE.get(mode)
  if (canvasId) {
    useCommanderStore.getState().openCanvas(canvasId)
  }
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

  const canvasTabsEnabled = useCommanderCanvasTabsEnabled()

  // Keep the latest availability fn and flag for the stable popstate handler
  // without re-registering the listener whenever either changes.
  const getAvailabilityRef = useRef(getViewAvailability)
  getAvailabilityRef.current = getViewAvailability
  const canvasTabsEnabledRef = useRef(canvasTabsEnabled)
  canvasTabsEnabledRef.current = canvasTabsEnabled

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
        activateCanvasForViewMode(urlMode, canvasTabsEnabled)
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
  }, [pathname, viewInitializedForPathname, viewMode, getViewAvailability, setViewMode, markViewInitialized, canvasTabsEnabled])

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
      activateCanvasForViewMode(urlMode, canvasTabsEnabledRef.current)
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

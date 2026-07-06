'use client'

import type { ReactElement } from 'react'

import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { useInboxCanvasBadge } from '@/app/[market]/commander/canvas/useInboxCanvasBadge'

/**
 * A canvas badge provider is a hook that returns the corner-badge element for a
 * canvas (e.g. the inbox unresolved-count pill), or null when there is nothing
 * to show. The return type is deliberately `ReactElement | null` (not
 * `ReactNode`) so the `!= null` "has a badge?" checks are exact — a `ReactNode`
 * could be `0`/`false`/`''`, which those checks would misread as present.
 *
 * Registry shape mirrors CANVAS_ACTION_PROVIDERS, but the resolution strategy
 * differs and is load-bearing: the action host resolves a single provider via a
 * keyed remount, whereas useCanvasBadgeMap calls every provider in a loop (see
 * its doc). Do not refactor toward per-canvas resolution — it breaks the
 * rules-of-hooks guarantee that relies on this map being a compile-time constant.
 */
export type CanvasBadgeProvider = () => ReactElement | null

export const CANVAS_BADGE_PROVIDERS: Partial<Record<CanvasId, CanvasBadgeProvider>> = {
  [CanvasId.Inbox]: useInboxCanvasBadge,
}

/** Tuple form of the provider map, used to iterate providers in a stable order. */
const BADGE_PROVIDER_ENTRIES: readonly [CanvasId, CanvasBadgeProvider][] = Object.entries(
  CANVAS_BADGE_PROVIDERS,
) as [CanvasId, CanvasBadgeProvider][]

/**
 * Resolves every registered badge provider and returns a map of canvas id to
 * its badge node. Used by aggregate indicators (the overflow-menu "+" trigger
 * and the mobile canvas selector) that must know whether any hidden canvas has
 * a badge without rendering each tab.
 *
 * Iterating BADGE_PROVIDER_ENTRIES calls hooks in a loop, which is safe here
 * only because the provider registry is a compile-time constant: the set and
 * order of providers never changes across renders.
 */
export function useCanvasBadgeMap(): Partial<Record<CanvasId, ReactElement | null>> {
  const badges: Partial<Record<CanvasId, ReactElement | null>> = {}
  for (const [canvasId, useProvider] of BADGE_PROVIDER_ENTRIES) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- registry is static; order is stable
    badges[canvasId] = useProvider()
  }
  return badges
}

/** True when any of the given canvases currently has a badge to show. */
export function hasAnyCanvasBadge(
  badges: Partial<Record<CanvasId, ReactElement | null>>,
  canvasIds: readonly CanvasId[],
): boolean {
  return canvasIds.some((id) => badges[id] != null)
}

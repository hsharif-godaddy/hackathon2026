/**
 * Invalidates the React Query caches that back the media grid (appPages,
 * mediaSlotUsage, mediaManifest) so newly built pages and their images appear
 * without a manual refresh. Shared by both transports (WS + SSE). Kept
 * dependency-light to avoid a circular import with useWebSocketHelpers.
 */

import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { logger } from '@/lib/request-context'

const MEDIA_SURFACE_QUERY_KEYS = ['appPages', 'mediaSlotUsage', 'mediaManifest'] as const

// Re-invalidation delays (ms): a new page's images/usage are written to disk async and can land well after stream-complete, so widen the window to catch late writes (each pass is a no-op unless the grid is mounted).
const RETRY_DELAYS_MS = [2_000, 5_000, 9_000, 15_000, 24_000]

function invalidateMediaSurfaces(appId: string, reason: string): void {
  const client = getQueryClient()
  if (!client) {
    logger.warn('mediaSurfaceRefresh.no-query-client', { appId, reason })
    return
  }
  for (const key of MEDIA_SURFACE_QUERY_KEYS) {
    void client
      .invalidateQueries({ queryKey: [key, appId], refetchType: 'active' })
      .catch((error: unknown) => {
        logger.warn('mediaSurfaceRefresh.invalidate-failed', {
          appId,
          queryKey: key,
          reason,
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }
}

// Pending delayed-invalidation timers per app, so rapid successive calls cancel stale timers instead of stacking fetches.
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>[]>()

/**
 * Refresh the media grid surfaces after a commit completes: invalidate
 * immediately, then re-invalidate on a short schedule to catch images the agent
 * imports just after the complete event. refetchType 'active' makes every pass
 * a no-op unless the grid is mounted; successive calls cancel prior timers.
 */
export function refreshMediaSurfaces(appId: string): void {
  if (!appId) return

  const existing = pendingTimers.get(appId)
  if (existing) {
    for (const timer of existing) clearTimeout(timer)
  }

  invalidateMediaSurfaces(appId, 'immediate')

  const timers: ReturnType<typeof setTimeout>[] = []
  for (const delay of RETRY_DELAYS_MS) {
    timers.push(setTimeout(() => invalidateMediaSurfaces(appId, `delay-${delay}`), delay))
  }
  pendingTimers.set(appId, timers)
}

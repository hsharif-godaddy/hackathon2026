/**
 * Shared handling for `media_caption` events pushed from the backend after async
 * caption generation. Updates the React Query cache for the affected media slot
 * (and the manifest) so the UI reflects the caption without a navigation or manual
 * refetch.
 *
 * Ported from the WS `MediaCaptionHandler` (removed in AIROBUILD-2631); called from
 * the SSE path in useSSEChat (AIROBUILD-2680). SSE is now the only transport.
 */

import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { logger } from '@/lib/request-context'

interface MediaCaptionEventData {
  appId: string
  slotName: string
  caption: string
}

function isMediaCaptionEvent(raw: unknown): raw is MediaCaptionEventData {
  if (typeof raw !== 'object' || raw === null) return false
  const r = raw as Record<string, unknown>
  return (
    typeof r.appId === 'string' &&
    typeof r.slotName === 'string' &&
    typeof r.caption === 'string'
  )
}

export interface HandleMediaCaptionNotificationParams {
  raw: Record<string, unknown>
  clientAppId: string | null
  logPrefix: string
}

export function handleMediaCaptionNotification(params: HandleMediaCaptionNotificationParams): void {
  const { raw, clientAppId, logPrefix } = params

  if (!isMediaCaptionEvent(raw)) {
    logger.warn(`${logPrefix}.invalid-payload`, { clientAppId, received: typeof raw })
    return
  }

  const { appId, slotName, caption } = raw

  // Guard against cross-app events
  if (clientAppId && appId !== clientAppId) {
    logger.debug(`${logPrefix}.ignored`, { clientAppId, payloadAppId: appId, reason: 'appId mismatch' })
    return
  }

  logger.debug(`${logPrefix}.received`, { appId, slotName, caption })

  const queryClient = getQueryClient()
  if (!queryClient) return

  // Update the individual slot cache
  queryClient.setQueryData<MediaSlot | null>(['mediaSlot', appId, slotName], (old) => {
    if (!old) return old
    return { ...old, caption, searchQuery: old.searchQuery || caption }
  })

  // Update the manifest cache so the grid also reflects the caption
  queryClient.setQueryData<Record<string, MediaSlot> | null>(['mediaManifest', appId], (old) => {
    if (!old || !old[slotName]) return old
    const slot = old[slotName]
    return { ...old, [slotName]: { ...slot, caption, searchQuery: slot.searchQuery || caption } }
  })
}

/**
 * Handles `media_caption` events pushed from the backend after async caption generation.
 * Updates the React Query cache for the affected media slot so the UI reflects the caption
 * without requiring a page navigation or manual refetch.
 */

import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { logger } from '@/lib/request-context'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

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

export class MediaCaptionHandler implements MessageHandler {
  readonly type = 'media_caption'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    const raw = data.data
    if (!isMediaCaptionEvent(raw)) return

    const { appId, slotName, caption } = raw

    // Guard against cross-app events
    if (context.currentAppId && appId !== context.currentAppId) return

    logger.debug('media_caption.received', { appId, slotName, caption })

    const queryClient = getQueryClient()
    if (!queryClient) return

    // Update the individual slot cache
    const slotKey = ['mediaSlot', appId, slotName]
    queryClient.setQueryData<MediaSlot | null>(slotKey, (old) => {
      if (!old) return old
      return { ...old, caption, searchQuery: old.searchQuery || caption }
    })

    // Update the manifest cache so the grid also reflects the caption
    const manifestKey = ['mediaManifest', appId]
    queryClient.setQueryData<Record<string, MediaSlot> | null>(manifestKey, (old) => {
      if (!old || !old[slotName]) return old
      const slot = old[slotName]
      return { ...old, [slotName]: { ...slot, caption, searchQuery: slot.searchQuery || caption } }
    })
  }
}

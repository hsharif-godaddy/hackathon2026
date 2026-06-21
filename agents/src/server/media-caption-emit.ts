import { getSSERegistry } from './sse/registry-singleton.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'media-caption-emit' })

// Async-generated media captions are pushed to the client over SSE:
// EventStreamRegistry.sendToApp fans out a named `media_caption` event to every
// open conversation stream for this appId. The client updates the affected
// media-slot React Query cache so the UI reflects the caption without a manifest
// refetch. (The legacy Socket.IO leg was removed with the server WS stack in
// AIROBUILD-2632.)
export type MediaCaptionPayload = {
  appId: string
  slotName: string
  caption: string
}

export function emitMediaCaption(payload: MediaCaptionPayload): void {
  const { appId, slotName } = payload

  getSSERegistry()?.sendToApp(appId, 'media_caption', { ...payload })

  logger.debug('media-caption-emit.delivered', { appId, slotName })
}

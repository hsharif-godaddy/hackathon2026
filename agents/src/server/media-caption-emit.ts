import { emitToApp } from './ai-lib-websocket-server.js'
import { getSSERegistry } from './sse/registry-singleton.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'media-caption-emit' })

// Async-generated media captions are pushed to the client over both transports:
// - Socket.IO: emitToApp wraps the caption in the legacy `message` envelope the
//   WS MediaCaptionHandler dispatched on (envelope `type === 'media_caption'`, the
//   `{ appId, slotName, caption }` payload in `data`).
// - SSE: EventStreamRegistry.sendToApp fans out a named `media_caption` event to
//   every open conversation stream for this appId.
//
// Both carry the same `{ appId, slotName, caption }` payload; the client updates
// the affected media-slot React Query cache so the UI reflects the caption without
// a manifest refetch. The WS leg is removed in AIROBUILD-2632 (server WS delete),
// leaving SSE only.
export type MediaCaptionPayload = {
  appId: string
  slotName: string
  caption: string
}

export function emitMediaCaption(payload: MediaCaptionPayload): void {
  const { appId, slotName } = payload

  emitToApp(appId, 'message', { type: 'media_caption', content: '', data: payload })
  getSSERegistry()?.sendToApp(appId, 'media_caption', { ...payload })

  logger.debug('media-caption-emit.delivered', { appId, slotName })
}

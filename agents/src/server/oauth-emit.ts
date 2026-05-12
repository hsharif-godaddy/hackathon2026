import { emitToApp } from './ai-lib-websocket-server.js'
import { getSSERegistry } from './sse/registry-singleton.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'oauth-emit' })

// OAuth result is delivered over both transports:
// - Socket.IO: per-socket emit filtered by authenticated siteId (WS clients)
// - SSE: EventStreamRegistry.sendToApp fans out to every open conversation
//   stream for this appId (SSE clients). The SSE wire type is `oauth_result`
//   to match the snake_case convention of the other SSE event types.
//
// Both transports carry the same payload. The client filters by `state`
// (the OAuth nonce) regardless of transport.
export type OAuthResultPayload = {
  success: boolean
  appId: string
  state: string
  provider: string
  expiresAt?: number
  scopes?: string[]
  error?: string
  description?: string
}

export function emitOAuthResult(payload: OAuthResultPayload): void {
  const { appId } = payload
  const data = payload as unknown as Record<string, unknown>

  const wsDelivered = emitToApp(appId, 'oauth:result', payload)
  getSSERegistry()?.sendToApp(appId, 'oauth_result', data)

  // Don't log state value — it's sensitive PKCE flow state (see auth-service.ts).
  logger.info('oauth-emit.delivered', {
    appId,
    success: payload.success,
    wsDelivered,
  })
}

import { getSSERegistry } from './sse/registry-singleton.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'oauth-emit' })

// OAuth result is delivered over SSE: EventStreamRegistry.sendToApp fans out to
// every open conversation stream for this appId. The SSE wire type is
// `oauth_result` to match the snake_case convention of the other SSE event
// types. The client filters by `state` (the OAuth nonce).
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

  getSSERegistry()?.sendToApp(appId, 'oauth_result', data)

  // Don't log state value — it's sensitive PKCE flow state (see auth-service.ts).
  logger.info('oauth-emit.delivered', {
    appId,
    success: payload.success,
  })
}

import { context as otelContext, type Context } from '@opentelemetry/api'
import { createTraceContext } from '@signals/otel-sdk'
import { getSignalsContext, type SignalsContext } from '@signals/sdk'

/**
 * Shared schema id for the airo-app-builder BusinessContext attached to OTel
 * traces. Re-exported for transport adapters that extend the inherited
 * BusinessContext (see agents service WS + SSE BusinessContext extension blocks).
 * Bump in lockstep with the schema registry — every site that constructs a
 * BusinessContext for this product must reference the same version literal.
 */
export const BUSINESS_CONTEXT_SCHEMA_ID = 'urn:shared:user:business-context:/airo-app-builder/v2'

export type ChatSignalsTraceLogPrefix = 'websocket' | 'sse'

export type JwtAgentContextSubset = {
  customerId?: string
  visitorId?: string
  trafficSessionId?: string
}

export type ChatSignalsTraceLogger = {
  warn: (event: string, data: Record<string, unknown>) => void
}

function screenshotUrlsForApp(appId: string | undefined): {
  screenshotUrl?: string
  listPublishedSnapshotsUrl?: string
} {
  if (!appId) {
    return {}
  }
  const apiUrl = process.env.GODADDY_API_BASE_URL
  if (!apiUrl) {
    return {}
  }
  const isNonProd = apiUrl.includes('dev') || apiUrl.includes('test')
  const host = isNonProd
    ? 'https://console.airo-builder.test-godaddy.com'
    : 'https://console.airo-builder.godaddy.com'
  return {
    screenshotUrl: `${host}/api/screenshots/default/${encodeURIComponent(appId)}`,
    listPublishedSnapshotsUrl: `${host}/api/screenshots/publishes/${encodeURIComponent(appId)}`,
  }
}

/**
 * Signals + OTEL trace context for chat (WebSocket handshake or SSE HTTP request).
 * JWT `trafficSessionId` maps to Signals `sessionId`.
 */
export function buildChatSignalsTraceContext(options: {
  headers?: Record<string, string | string[] | undefined>
  jwtAgentContext?: JwtAgentContextSubset | null | undefined
  appId?: string | undefined
  logPrefix: ChatSignalsTraceLogPrefix
  logFields?: Record<string, string | undefined>
  logger: ChatSignalsTraceLogger
}): Context {
  const { headers, jwtAgentContext, appId, logPrefix, logFields, logger } = options
  const { screenshotUrl, listPublishedSnapshotsUrl } = screenshotUrlsForApp(appId)

  let baseSignals: SignalsContext = {}
  try {
    baseSignals = getSignalsContext(headers ? { headers } : {})
  } catch (err) {
    logger.warn(`${logPrefix}.signals.get_context_failed`, {
      ...logFields,
      error: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.stack && { errorStack: err.stack }),
    })
  }

  const signalsContext: SignalsContext = {
    ...baseSignals,
    ...(typeof jwtAgentContext?.customerId === 'string' &&
      jwtAgentContext.customerId.length > 0 && { customerId: jwtAgentContext.customerId }),
    ...(typeof jwtAgentContext?.visitorId === 'string' &&
      jwtAgentContext.visitorId.length > 0 && { visitorId: jwtAgentContext.visitorId }),
    ...(typeof jwtAgentContext?.trafficSessionId === 'string' &&
      jwtAgentContext.trafficSessionId.length > 0 && { sessionId: jwtAgentContext.trafficSessionId }),
  }

  try {
    return createTraceContext({
      signalsContext,
      ...(appId && {
        businessContext: {
          schemaId: BUSINESS_CONTEXT_SCHEMA_ID,
          data: {
            appId,
            ...(screenshotUrl && {
              defaultScreenshotUrl: screenshotUrl,
              listPublishedSnapshotsUrl,
            }),
          },
        },
      }),
    })
  } catch (err) {
    logger.warn(`${logPrefix}.signals.create_trace_context_failed`, {
      ...logFields,
      error: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.stack && { errorStack: err.stack }),
    })
    return otelContext.active()
  }
}

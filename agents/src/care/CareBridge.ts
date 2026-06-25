import { AiroCareClient, CookieAuthenticator } from '@airo-care/client'
import type { StreamMessageEvents } from '@airo-care/client'
import { errorFields, logger } from '../logging/index.js'
import { CareSessionStore } from './CareSessionStore.js'
import type { CareSession } from './CareSessionStore.js'
import { createEventQueue } from './event-queue.js'
import { translateCareEvent, terminalCompleteEvent, type BridgeEvent, type TranslateCtx } from './translator.js'
import { userFacingErrorMessage } from './errors.js'

export type { BridgeEvent } from './translator.js'

const AGENT_NAME = 'support'

// UUID v4 pattern — used to validate visitorId before interpolating into the
// Cookie header to prevent header injection via delimiter characters (`;`, `,`).
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface SupportTurnInput {
  aabConversationId: string
  visitorId: string
  message: string
  abortSignal?: AbortSignal
}

export interface CareBridge {
  streamSupportTurn(input: SupportTurnInput): AsyncIterable<BridgeEvent>
  /** Stop the background TTL sweep interval. Call on graceful shutdown. */
  dispose(): void
}

export interface CareBridgeConfig {
  baseURL: string
  executor: string
  /**
   * Test seam — production builds use the default factory which constructs
   * a real AiroCareClient with the provided visitor cookie. Tests inject
   * a fake to avoid real network calls.
   */
  clientFactory?: (visitorId: string) => AiroCareClient
}

type BuildClient = (visitorId: string) => AiroCareClient

/**
 * Build the Care bridge. Returns null when baseURL is empty so callers
 * can degrade cleanly to a "Care not configured" inline error chunk in
 * environments where Care credentials are not provisioned.
 */
export function createCareBridge(config: CareBridgeConfig): CareBridge | null {
  if (!config.baseURL) {
    logger.warn('care.bridge.disabled', { reason: 'missing_baseURL' })
    return null
  }

  const store = new CareSessionStore()

  // Background TTL sweep: remove sessions idle longer than 1 hour, checked
  // every 5 minutes. This is a process-lifetime daemon — call dispose() on
  // shutdown to clear the interval.
  const SWEEP_TTL_MS: number = 60 * 60 * 1000 // 1 hour
  const SWEEP_INTERVAL_MS: number = 5 * 60 * 1000 // 5 minutes
  const sweepInterval: ReturnType<typeof setInterval> = setInterval(() => {
    const removed: number = store.sweep(SWEEP_TTL_MS)
    const remaining: number = store.size()
    logger.info('care.session_store.swept', { removed, remaining, maxAgeMs: SWEEP_TTL_MS })
  }, SWEEP_INTERVAL_MS)
  // Prevent interval from keeping the process alive when all else has shut down.
  sweepInterval.unref()

  const buildClient: BuildClient = config.clientFactory ?? ((visitorId: string): AiroCareClient =>
    new AiroCareClient({
      baseURL: config.baseURL,
      executor: config.executor,
      authenticator: new CookieAuthenticator(`visitor=vid=${visitorId}`),
    }))

  async function* streamSupportTurn(input: SupportTurnInput): AsyncGenerator<BridgeEvent, void, void> {
    const { aabConversationId, visitorId, message, abortSignal } = input

    // Validate visitorId as UUID v4 before interpolating into the Cookie header.
    // An invalid value (empty string, non-UUID, or containing `;`/`,` delimiters)
    // would inject extra cookie pairs and is treated as a missing visitor session.
    if (!UUID_V4_RE.test(visitorId)) {
      logger.error('care.bridge.invalid_visitor_id', {
        aabConversationId,
        visitorIdLength: visitorId.length,
      })
      store.invalidate(aabConversationId)
      yield {
        type: 'chunk',
        content: 'Sorry, support is unavailable — visitor session missing. Reload and try again.',
        data: {},
        agentName: AGENT_NAME,
        conversationId: aabConversationId,
      }
      yield terminalCompleteEvent({ agentName: AGENT_NAME, conversationId: aabConversationId }, 'error')
      return
    }

    const session: CareSession = store.getOrInit(aabConversationId)
    const translateCtx: TranslateCtx = { agentName: AGENT_NAME, conversationId: aabConversationId }
    const client: AiroCareClient = buildClient(visitorId)

    if (!session.careConversationId) {
      const startedAt: number = Date.now()
      try {
        const { conversationId } = await client.createConversation({ ucid: session.ucid })
        store.setCareConversationId(aabConversationId, conversationId)
        logger.info('care.care_conversation.created', {
          aabConversationId, careConversationId: conversationId, ucid: session.ucid,
          latencyMs: Date.now() - startedAt,
        })
      } catch (err) {
        logger.error('care.care_conversation.create_failed', {
          aabConversationId, ucid: session.ucid, ...errorFields(err),
        })
        store.invalidate(aabConversationId)
        yield {
          type: 'chunk', content: userFacingErrorMessage(err), data: {},
          agentName: AGENT_NAME, conversationId: aabConversationId,
        }
        yield terminalCompleteEvent(translateCtx, 'error')
        return
      }
    }

    const careConversationId: string = session.careConversationId!
    const queue = createEventQueue<StreamMessageEvents>()
    let sawResult: boolean = false
    // terminalYielded tracks whether we have actually yielded a terminal complete
    // event to the consumer. This is set on every code path that yields one so
    // the post-loop guard emits exactly one terminal complete regardless of
    // whether sawResult was set before an abort.
    let terminalYielded: boolean = false

    const streamPromise: Promise<void> = client.streamMessage(
      { conversationId: careConversationId, input: { role: 'user', content: message } },
      (event) => {
        if (event.type === 'result') sawResult = true
        queue.push(event)
      },
      { signal: abortSignal },
    ).then(() => queue.close())
     .catch((err) => queue.fail(err))

    logger.info('care.stream.started', { aabConversationId, careConversationId })

    let deltaCount: number = 0
    const turnStart: number = Date.now()
    try {
      for await (const careEvent of queue) {
        if (abortSignal?.aborted) {
          logger.info('care.stream.aborted', {
            aabConversationId, careConversationId,
            reason: abortSignal.reason instanceof Error ? abortSignal.reason.message : String(abortSignal.reason),
          })
          break
        }
        if (careEvent.type === 'error') {
          logger.error('care.stream.error_event', {
            aabConversationId, careConversationId,
            careMessage: (careEvent as { message?: string }).message,
            fatal: (careEvent as { fatal?: boolean }).fatal,
            code: (careEvent as { code?: string }).code,
          })
        }
        const translated: BridgeEvent | null = translateCareEvent(careEvent, translateCtx)
        if (translated) {
          if (translated.type === 'chunk') deltaCount++
          yield translated
        }
        if (careEvent.type === 'result') {
          logger.info('care.stream.completed', {
            aabConversationId, careConversationId, deltaCount, durationMs: Date.now() - turnStart,
          })
          terminalYielded = true
          return  // translated already emitted complete
        }
      }
      // Stream closed without a result event (or was aborted) — emit a synthetic
      // terminal complete if we have not already yielded one.
      if (!terminalYielded) {
        if (sawResult) {
          logger.info('care.stream.completed', {
            aabConversationId, careConversationId, deltaCount, durationMs: Date.now() - turnStart,
          })
        }
        yield terminalCompleteEvent(translateCtx)
        terminalYielded = true
      }
    } catch (err) {
      if (abortSignal?.aborted) {
        // Clean caller-side termination (e.g. a follow-up message superseded this
        // turn). Don't surface an error to the user, don't invalidate the session
        // — preserve Care context for the next turn.
        logger.info('care.stream.aborted', {
          aabConversationId, careConversationId,
          reason: abortSignal.reason instanceof Error ? abortSignal.reason.message : String(abortSignal.reason),
        })
        if (!terminalYielded) {
          yield terminalCompleteEvent(translateCtx)
          terminalYielded = true
        }
      } else {
        logger.error('care.stream.errored', {
          aabConversationId, careConversationId, ...errorFields(err),
        })
        store.invalidate(aabConversationId)
        yield {
          type: 'chunk', content: userFacingErrorMessage(err), data: {},
          agentName: AGENT_NAME, conversationId: aabConversationId,
        }
        yield terminalCompleteEvent(translateCtx, 'error')
        terminalYielded = true
      }
    } finally {
      // Drain the stream promise so any rejection surfaces here instead of
      // propagating as an unhandled rejection. With @airo-care/client>=1.0.1
      // the abortSignal is forwarded to the underlying fetch, so this resolves
      // promptly on abort rather than waiting for streamTimeout.
      await streamPromise.catch(() => undefined)
    }
  }

  function dispose(): void {
    clearInterval(sweepInterval)
  }

  return { streamSupportTurn, dispose }
}

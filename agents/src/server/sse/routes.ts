import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import type { ConversationEventChannel, EventSubscriber, StreamingEvent } from '@airo/ai-transport'
import { createSSEWriter, computeRecoveryPlan, parseAgentCommand } from '@airo/ai-transport'
import { grantSessionManager, resolveBmsSubscriptionId } from '@airo/ai-grants'
import { EventStreamRegistry } from './EventStreamRegistry.js'
import { MessageExecutionService } from './MessageExecutionService.js'
import { safeFormatSSEEvent } from './sse-event-formatter.js'
import { logger, errorFields } from '../../logging/index.js'
import { validateAppOwnershipFromParam } from '../middleware/app-ownership.js'
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { isEmployeeAuthType } from '@airo/shared/auth'
import type { ConversationLifecycleStore, MessageStore } from '../../memory/interfaces/index.js'
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { BYPASS_SITE_IDS } from '../../services/features.js'
import { getSSEAgentFactory, getClientActionService } from '../ai-lib-websocket-server.js'
import { performBudgetPreCheck } from '../budget-pre-check.js'
import { getBudgetServiceClient } from '../../services/budget-service-instance.js'
import { BudgetExceededError } from '@airo/ai-common'
import { ConnectionInitializer } from '../connection-initializer.js'
import type { AgentRouterParams, AgentStateManager } from '../agent-router.js'

import { sseSessionKey } from './session-key.js'
import { asyncHandler } from '../middleware/async-handler.js'
import { mapToolCallsToUI } from '../tool-call-mapper.js'

const HEARTBEAT_INTERVAL_MS = 15_000
const RETRY_MS = 1000
const SSE_OPEN_PADDING_MIN_BYTES = 4096
const SSE_OPEN_PADDING_COMMENT = `open ${' '.repeat(SSE_OPEN_PADDING_MIN_BYTES)}`
const MAX_CONTENT_LENGTH = 100_000

interface SSERouteDeps {
  registry: EventStreamRegistry
  authenticate: (req: Request, res: Response, next: NextFunction) => void
  getEventChannel: () => ConversationEventChannel | null
  executionService?: MessageExecutionService
  resolveAgent: (params: AgentRouterParams) => string | Promise<string>
  getStateManager: () => AgentStateManager | null
  lifecycle: ConversationLifecycleStore
  messages: MessageStore
}

// Takes an injected store because the canonical middleware in
// ../middleware/app-ownership.ts resolves its own, which can't be mocked
// in tests. Pivots on authenticated siteId (not :appId) to match the
// canonical middleware's semantics.
function validateConversationOwnership(lifecycle: ConversationLifecycleStore) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const conversationId = req.params.conversationId

    if (!conversationId) {
      res.status(400).json({ error: 'conversationId is required' })
      return
    }

    const authenticatedSiteId = (req as AuthenticatedRequest).agentContext?.siteId
    if (authenticatedSiteId && !BYPASS_SITE_IDS.includes(authenticatedSiteId)) {
      const conversation = await lifecycle.getById(conversationId)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      if (conversation.appId !== authenticatedSiteId) {
        logger.error('sse.conversation.ownership_violation', {
          authenticatedSiteId,
          requestedConversationId: conversationId,
          conversationAppId: conversation.appId,
        }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] })
        res.status(403).json({ error: 'Access denied' })
        return
      }
    }

    next()
  })
}

export function createSSERoutes(deps: SSERouteDeps): Router {
  const router = Router()

  const connectionInitializer = new ConnectionInitializer(
    () => {
      const factory = getSSEAgentFactory()
      if (!factory) return null
      return {
        agents: {
          list: () => (factory.agents.list() as string[]).map((name: string) => ({
            id: name,
            name: factory.agents.get(name as any)?.getName?.() ?? name,
            description: `${name} agent`,
          })),
        },
      }
    },
    { version: '2.0' },
  )

  const convOwnership = validateConversationOwnership(deps.lifecycle)

  // POST /:appId - create or resolve conversation
  router.post('/:appId', deps.authenticate, validateAppOwnershipFromParam('appId'), asyncHandler(async (req: Request, res: Response) => {
    const appId = req.params.appId!
    const { agentId, templateId } = req.body

    try {
      const resolvedAgentId = await deps.resolveAgent({ appId, agentId, templateId })
      const customerId = (req as AuthenticatedRequest).agentContext?.customerId
      const { conversation, isNew } = await deps.lifecycle.getOrCreateForApp(workspaceScopeFromAppId(appId, customerId), resolvedAgentId)

      res.status(200).json({
        conversationId: conversation.id,
        isNew,
      })
    } catch (err) {
      logger.error('sse.conversation.create_failed', { appId, ...errorFields(err) })
      res.status(500).json({ error: 'Failed to create conversation' })
    }
  }))

  // GET /:appId/:conversationId/stream - SSE event stream
  router.get('/:appId/:conversationId/stream', deps.authenticate, validateAppOwnershipFromParam('appId'), convOwnership, asyncHandler(async (req: Request, res: Response) => {
    const appId = req.params.appId!
    const conversationId = req.params.conversationId!
    // Last-Event-Id present = polyfill resuming from a delivered cursor.
    // Absent = first open of a JS session; client has no in-memory deltas,
    // so the server must replay the full buffer to reconstruct in-progress
    // turns. Matches the WS ConnectionRecoveryManager clientHasNoState policy.
    const parsedLeid = parseInt(req.headers['last-event-id'] as string ?? '', 10)
    const hasCursor = Number.isFinite(parsedLeid) && parsedLeid >= 0
    const lastEventId = hasCursor ? parsedLeid : null
    const clientHasNoState = !hasCursor

    const writer = createSSEWriter(req, res, { logger })

    // Some edge/proxy paths buffer tiny SSE frames. Send an initial comment
    // large enough to make the response body visible before recovery events.
    writer.comment(SSE_OPEN_PADDING_COMMENT)
    writer.retry(RETRY_MS)

    const { subscriber } = deps.registry.register(conversationId, appId, writer)

    // All formatSSEEvent sites funnel through safeFormatSSEEvent. A
    // JSON.stringify throw (BigInt, circular ref) returns null instead of
    // propagating; asyncHandler cannot send an error response after SSE
    // headers are on the wire, so any escape here would strand the client.
    const writeFormatted = (
      type: string,
      payload: Record<string, unknown>,
      sequence?: number,
    ): void => {
      const text = safeFormatSSEEvent(type, payload, sequence, logger, { appId, conversationId })
      if (text) writer.write(text)
    }

    const writeStreamingEvent = (event: StreamingEvent): void => {
      writeFormatted(event.type, {
        ...event.data,
        content: event.content,
        conversationId: event.conversationId,
        agentName: event.agentName,
      }, event.sequence)
    }

    const eventChannel = deps.getEventChannel()
    let replaying = false
    const bufferedLiveEvents: StreamingEvent[] = []
    let liveSubscriber: EventSubscriber | null = null

    const replaceBufferingSubscriberWithDirect = (): void => {
      if (!eventChannel || !deps.executionService || !liveSubscriber) return
      if (typeof eventChannel.unsubscribe === 'function') {
        eventChannel.unsubscribe(conversationId, liveSubscriber.id)
      }
      liveSubscriber = null
      deps.executionService.subscribeStream(conversationId, subscriber)
    }

    const drainBufferedLiveEvents = (afterSequence: number): void => {
      const tail = bufferedLiveEvents
        .filter((event) => event.sequence > afterSequence)
        .sort((a, b) => a.sequence - b.sequence)
      for (const event of tail) {
        writeStreamingEvent(event)
      }
    }

    if (eventChannel && deps.executionService) {
      replaying = true
      liveSubscriber = {
        id: `${subscriber.id}-replay-buffer`,
        onError: (error: Error) => subscriber.onError(error),
        onEvent: async (event: StreamingEvent) => {
          if (replaying) {
            bufferedLiveEvents.push(event)
            return
          }
          await subscriber.onEvent(event)
        },
      }
      deps.executionService.subscribeStream(conversationId, liveSubscriber)
    }

    if (!eventChannel) {
      // Fresh connects now always run the recovery path, so a missing
      // event channel silently skips every recovery signal. Emit a minimal
      // recovery_status + replay_complete pair so the client still gets
      // the initialization signals it expects, and log so the misconfig
      // is diagnosable.
      logger.warn('sse.connection.no_event_channel', { appId, conversationId })
      writeFormatted('recovery_status', {
        hasBufferedEvents: false,
        bufferedCount: 0,
        bufferedEventCount: 0,
        conversationId,
        streamCompleted: false,
        error: 'event_channel_unavailable',
      })
      writeFormatted('replay_complete', { lastSequence: -1, replayedCount: 0 })
    } else {
      try {
        const plan = computeRecoveryPlan({
          conversationId,
          channel: eventChannel,
          lastDeliveredSequence: lastEventId,
          clientHasNoState,
          // execute() registers activeStreams synchronously before its first
          // awaited operation, so the answer is truthful at reconnect time.
          hasActiveStream: deps.executionService?.hasActiveStream(conversationId) === true,
        })

        // Avoids a separate HTTP round-trip for the client to reload history.
        let historyMessages: Awaited<ReturnType<typeof deps.messages.getMessagesPaginated>>['messages'] = []
        let historyHasMore = false
        let historyNextCursor: string | null = null
        if (plan.lossDetected) {
          try {
            const customerId = (req as AuthenticatedRequest).agentContext?.customerId
            const paginatedResult = await deps.messages.getMessagesPaginated(
              workspaceScopeFromAppId(appId, customerId),
              conversationId,
              { limit: 20 }
            )
            historyMessages = paginatedResult.messages
            historyHasMore = paginatedResult.hasMore
            historyNextCursor = paginatedResult.nextCursor
          } catch (err) {
            logger.warn('sse.recovery.history_load_failed', { appId, conversationId, ...errorFields(err) })
          }
        }

        // SSE-only: suppress replay for completed streams on page reload (WS has client-side dedup in TransportSupervisor).
        const shouldReplay = plan.eventsToReplay.length > 0
          && !(plan.streamCompleted && clientHasNoState)
        const replayedCount = shouldReplay ? plan.eventsToReplay.length : 0

        writeFormatted('recovery_status', {
          hasBufferedEvents: shouldReplay,
          bufferedCount: replayedCount,
          bufferedEventCount: replayedCount,
          conversationId,
          streamCompleted: plan.streamCompleted,
          lossDetected: plan.lossDetected,
          lostEventCount: plan.lostEventCount,
          recoveryMode: clientHasNoState ? 'initial' : 'delta',
          historyStreaming: historyMessages.length > 0,
          historyMessageCount: historyMessages.length,
          historyHasMore,
          historyNextCursor,
        })

        for (const msg of historyMessages) {
          const sender = msg.sender === 'agent' ? 'assistant' : msg.sender
          const metadata = plan.streamCompleted && msg.metadata?.inProgress
            ? { ...msg.metadata, inProgress: false }
            : msg.metadata

          writeFormatted('history_message', {
            data: {
              id: msg.id,
              conversationId: msg.conversationId,
              sender,
              content: msg.content,
              createdAt: msg.createdAt.toISOString(),
              ...(msg.messageType != null && { messageType: msg.messageType }),
              ...(msg.toolCalls != null && { toolCalls: mapToolCallsToUI(msg.toolCalls as any) }),
              ...(msg.segments != null && { segments: msg.segments }),
              ...(metadata != null && { metadata }),
              ...(msg.contextAttachments != null && { contextAttachments: msg.contextAttachments }),
              ...(msg.origin != null && { origin: msg.origin }),
            },
            isPagination: false,
          })
        }

        if (shouldReplay) {
          for (const event of plan.eventsToReplay) {
            writeStreamingEvent(event)
          }
        }

        replaying = false
        drainBufferedLiveEvents(plan.lastReplaySequence)
        replaceBufferingSubscriberWithDirect()

        writeFormatted('replay_complete', {
          lastSequence: plan.lastReplaySequence,
          replayedCount,
        })

        logger.info('sse.recovery.replayed', {
          appId,
          conversationId,
          lastEventId,
          recoveryMode: clientHasNoState ? 'initial' : 'delta',
          replayFromSequence: plan.replayFromSequence,
          bufferedCount: plan.eventsToReplay.length,
          replayedCount,
          streamCompleted: plan.streamCompleted,
        })
      } catch (err) {
        logger.warn('sse.recovery.failed', { appId, conversationId, ...errorFields(err) })
        writeFormatted('recovery_status', {
          hasBufferedEvents: false,
          bufferedCount: 0,
          bufferedEventCount: 0,
          conversationId,
          streamCompleted: false,
          error: 'replay_failed',
        })
        replaying = false
        drainBufferedLiveEvents(-1)
        // Without replay_complete the client's store-update buffer never
        // flushes, leaving any queued events stranded.
        writeFormatted('replay_complete', { lastSequence: -1, replayedCount: 0 })
        replaceBufferingSubscriberWithDirect()
      }
    }

    if (!deps.executionService) {
      logger.warn('sse.connection.no_execution_service', { appId, conversationId })
    }

    const initData = connectionInitializer.initialize()
    writeFormatted('initialize', {
      serverConfig: { supportsWebSocketHistory: false, supportsConnectThenAuth: false, serverVersion: initData.serverConfig.version },
      agents: initData.agents,
    })

    const heartbeat = setInterval(() => {
      if (writer.isClosed()) {
        clearInterval(heartbeat)
        return
      }
      writer.comment('heartbeat')
    }, HEARTBEAT_INTERVAL_MS)

    const cleanup = () => {
      clearInterval(heartbeat)
      deps.registry.unregister(conversationId, subscriber)
      writer.end()
    }

    req.on('close', () => {
      cleanup()
      logger.info('sse.connection.closed', { appId, conversationId })
    })
    res.on('error', (err: Error) => {
      logger.warn('sse.connection.response_error', { appId, conversationId, error: err.message })
      cleanup()
    })

    logger.info('sse.connection.opened', { appId, conversationId, lastEventId, encoding: writer.encoding })
  }))

  // GET /:appId/:conversationId/messages - paginated message history
  router.get('/:appId/:conversationId/messages', deps.authenticate, validateAppOwnershipFromParam('appId'), convOwnership, asyncHandler(async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId!
    const appId = req.params.appId!

    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100)
    const before = req.query.before as string | undefined

    try {
      const customerId = (req as AuthenticatedRequest).agentContext?.customerId
      const result = await deps.messages.getMessagesPaginated(workspaceScopeFromAppId(appId, customerId), conversationId, { limit, before })

      // If no active stream for this conversation, clear stale inProgress metadata
      // to prevent the client from falsely detecting an active stream.
      const isPagination = !!before
      const streamCompleted = !isPagination
        ? deps.executionService
          ? !deps.executionService.hasActiveStream(conversationId)
          : true
        : false

      const messages = result.messages.map((msg: any) => {
        let sender: 'user' | 'assistant'
        if (msg.sender === 'agent') {
          sender = 'assistant'
        } else if (msg.sender === 'user') {
          sender = 'user'
        } else {
          sender = 'assistant'
        }

        const metadata = streamCompleted && msg.metadata?.inProgress
          ? { ...msg.metadata, inProgress: false }
          : msg.metadata

        return {
          id: msg.id,
          conversationId: msg.conversationId,
          sender,
          content: msg.content,
          createdAt: msg.createdAt.toISOString(),
          ...(msg.messageType != null && { messageType: msg.messageType }),
          ...(msg.toolCalls != null && { toolCalls: mapToolCallsToUI(msg.toolCalls as any) }),
          ...(msg.segments != null && { segments: msg.segments }),
          ...(metadata != null && { metadata }),
          ...(msg.contextAttachments != null && { contextAttachments: msg.contextAttachments }),
          ...(msg.origin != null && { origin: msg.origin }),
        }
      })

      res.json({
        messages,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        total: result.total,
      })
    } catch (err) {
      logger.error('sse.messages.paginated.error', { conversationId, appId, ...errorFields(err) })
      res.status(500).json({ error: 'Failed to fetch messages' })
    }
  }))

  // POST /:appId/:conversationId/messages - send a message
  router.post('/:appId/:conversationId/messages', deps.authenticate, validateAppOwnershipFromParam('appId'), convOwnership, asyncHandler(async (req: Request, res: Response) => {
    const appId = req.params.appId!
    const conversationId = req.params.conversationId!
    const {
      content, agentId, agentProfile,
      templateId, modelOverride,
      visualContext, aiEditContext, aiEditContexts, selectedAssets,
      todoListContext, isActionRequest, customContext, buildErrorContext,
      uploadedFileName,
      market,
    } = req.body

    // WS permits empty content after stripping /agent markers and when the
    // prompt is carried entirely by asset/file references — mirror that here
    // so asset-only prompts reach the agent. The client (useSSEChat) already
    // refuses truly-empty submissions (no text, assets, or referenced files).
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content must be a string' })
      return
    }

    if (market !== undefined && typeof market !== 'string') {
      res.status(400).json({ error: 'market must be a string' })
      return
    }

    if (aiEditContexts !== undefined && !Array.isArray(aiEditContexts)) {
      res.status(400).json({ error: 'aiEditContexts must be an array' })
      return
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      res.status(400).json({ error: `content exceeds maximum length of ${MAX_CONTENT_LENGTH}` })
      return
    }

    const parsedAgentCommand = parseAgentCommand(content)
    if (parsedAgentCommand.hasCommand && !parsedAgentCommand.hasBody) {
      logger.info('sse.agent_override.bodyless_passthrough', { appId, conversationId, requestedAgent: parsedAgentCommand.agentId })
    }
    const effectiveContent = parsedAgentCommand.hasCommand && parsedAgentCommand.hasBody
      ? parsedAgentCommand.strippedContent ?? content
      : content
    const requestedAgentId = parsedAgentCommand.hasCommand && parsedAgentCommand.hasBody
      ? parsedAgentCommand.agentId
      : agentId

    if (!deps.executionService) {
      res.status(503).json({ error: 'Message execution not available' })
      return
    }

    const agentContext = (req as AuthenticatedRequest).agentContext

    // Derive effective subscriptionId for override detection at report time
    // Employee/test sessions get BudgetOverride values for 100% GoDaddy attribution via isBmsOverride()
    const effectiveSubscriptionId = resolveBmsSubscriptionId(
      isEmployeeAuthType(agentContext?.authType),
      agentContext?.useTestBudget === true,
      agentContext?.subscriptionId,
    )

    let bmsBudgetId: string | undefined
    let budgetSessionId: string | undefined
    try {
      const budgetResult = await performBudgetPreCheck(
        {
          budgetServiceEnabled: agentContext?.budgetServiceEnabled === true,
          subscriptionId: effectiveSubscriptionId,
          bmsBudgetId: agentContext?.bmsBudgetId,
          appId,
        },
        { getClient: getBudgetServiceClient, logger },
      )
      if (budgetResult) {
        bmsBudgetId = budgetResult.budgetId
        budgetSessionId = budgetResult.sessionId
      }
    } catch (err) {
      if (BudgetExceededError.isInstance(err)) {
        res.status(402).json({ error: (err as Error).message })
        return
      }
      logger.error('sse.budget.precheck_failed', { appId, conversationId, ...errorFields(err) })
      throw err
    }

    const sseSocketId = sseSessionKey(conversationId)

    const stateManager = deps.getStateManager()
    const resolvedAgentId = await deps.resolveAgent({
      appId, agentId: requestedAgentId, agentProfile, templateId, agentContext,
      ...(stateManager && { session: { sessionId: sseSocketId, stateManager } }),
    })

    res.status(202).json({ accepted: true })

    const siteId = agentContext?.siteId ?? 'unknown'

    // isInitialPrompt: the route has already persisted the incoming user message,
    // so a single-message conversation means this is the first prompt.
    let isInitialPrompt = false
    try {
      isInitialPrompt = (await deps.messages.getMessageCount(conversationId)) <= 1
    } catch (err) {
      logger.warn('sse.messages.isInitialPrompt.error', { conversationId, ...errorFields(err) })
    }

    deps.executionService.execute({
      appId,
      conversationId,
      content: effectiveContent,
      siteId,
      agentId: resolvedAgentId,
      agentProfile,
      templateId,
      modelOverride,
      visualContext,
      aiEditContext,
      aiEditContexts,
      selectedAssets,
      todoListContext,
      isActionRequest,
      customContext,
      buildErrorContext,
      uploadedFileName,
      bmsBudgetId,
      budgetSessionId,
      subscriptionId: effectiveSubscriptionId,
      authType: agentContext?.authType,
      market,
      requestHeaders: req.headers as Record<string, string | string[] | undefined>,
      lifecycleContext: {
        agentContext: {
          enableAssessmentAgent: agentContext?.enableAssessmentAgent,
          enableAssessmentOverride: agentContext?.enableAssessmentOverride,
          modelOverride: agentContext?.modelOverride,
          modelSelectorEnabled: agentContext?.modelSelectorEnabled,
          agentProfile: agentContext?.agentProfile,
          agentProfileSelectorEnabled: agentContext?.agentProfileSelectorEnabled,
          customerId: agentContext?.customerId,
          visitorId: agentContext?.visitorId,
          trafficSessionId: agentContext?.trafficSessionId,
          canDownload: agentContext?.canDownload,
          canPublish: agentContext?.canPublish,
          canPurchaseDomain: agentContext?.canPurchaseDomain,
          isE2S: agentContext?.isE2S,
          authType: agentContext?.authType,
          useTestBudget: agentContext?.useTestBudget,
          budgetServiceEnabled: agentContext?.budgetServiceEnabled,
          subscriptionId: agentContext?.subscriptionId,
          bmsBudgetId: agentContext?.bmsBudgetId,
          useAtlasCrawler: agentContext?.useAtlasCrawler,
          googleReviewsEnabled: agentContext?.googleReviewsEnabled,
          debugStatsEnabled: agentContext?.debugStatsEnabled,
        },
        isInitialPrompt,
      },
    }).catch(err => {
      logger.error('sse.chat.execution_failed', { appId, conversationId, ...errorFields(err) })
    })
  }))

  // POST /:appId/:conversationId/stop
  router.post('/:appId/:conversationId/stop', deps.authenticate, validateAppOwnershipFromParam('appId'), convOwnership, (req: Request, res: Response) => {
    const conversationId = req.params.conversationId!

    logger.info('sse.chat.stop', { conversationId })
    deps.executionService?.stop(conversationId)

    res.status(202).json({ accepted: true })
  })

  // POST /:appId/:conversationId/actions - client action result
  router.post('/:appId/:conversationId/actions', deps.authenticate, validateAppOwnershipFromParam('appId'), convOwnership, (req: Request, res: Response) => {
    const appId = req.params.appId!
    const conversationId = req.params.conversationId!
    const { requestId, success, result, error, errorDetails, logs, exitCode } = req.body

    if (!requestId || typeof requestId !== 'string') {
      res.status(400).json({ error: 'requestId is required' })
      return
    }

    const service = getClientActionService(sseSessionKey(conversationId))
    // Only SSEClientActionService exposes resolveAction; WS services are driven via the socket listener.
    const sseService = service && 'resolveAction' in service
      ? service as unknown as import('./SSEClientActionService.js').SSEClientActionService
      : null
    if (!sseService) {
      logger.warn('sse.client-action-result.no_service', { appId, conversationId, requestId })
      res.status(404).json({ error: 'No pending action service for this conversation' })
      return
    }

    const resolved = sseService.resolveAction({ requestId, success, result, error, errorDetails, logs, exitCode })
    if (!resolved) {
      res.status(404).json({ error: 'No pending request with this ID' })
      return
    }

    res.status(200).json({ accepted: true })
  })

  // PUT /:appId/:conversationId/grants
  router.put('/:appId/:conversationId/grants', deps.authenticate, validateAppOwnershipFromParam('appId'), convOwnership, asyncHandler(async (req: Request, res: Response) => {
    const appId = req.params.appId!
    const conversationId = req.params.conversationId!
    const { grants } = req.body

    if (!Array.isArray(grants)) {
      res.status(400).json({ error: 'grants array is required' })
      return
    }

    try {
      const sseSessionId = sseSessionKey(conversationId)
      grantSessionManager.setGrants(sseSessionId, grants)
      logger.info('sse.grant-context.set', { appId, conversationId, sessionId: sseSessionId, grantCount: grants.length })
      res.status(200).json({ accepted: true })
    } catch (err) {
      logger.error('sse.grant-context.failed', { appId, conversationId, ...errorFields(err) })
      res.status(500).json({ error: 'Failed to set grant context' })
    }
  }))

  return router
}

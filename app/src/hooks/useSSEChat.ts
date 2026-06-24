import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getMessageOriginForAuthType } from '@airo/shared/auth'

import { isParkedOnAskQuestion } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import { getFullStorySessionId } from '@/components/feedback/utils'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import type { ClientActionContext } from '@/hooks/chat/actions/types'
import {
  getConversationIdFromCookie,
  setConversationIdCookie,
} from '@/hooks/chat/useChatHelpers'
import {
  resolveUpstreamErrorStatusCode,
  sanitizeUpstreamErrorMessage,
} from '@/hooks/shared/sanitizeUpstreamErrorMessage'
import { getSwitchboardFlag } from '@/hooks/useSwitchboard'
import { agentFetch, getAgentToken } from '@/lib/agent-fetch'
import { readDesignChoiceForCurrentApp } from '@/lib/rebuild-design-choice'
import { logger } from '@/lib/request-context'
import {
  bufferStoreUpdate,
  bufferTextChunk,
  clearStoreUpdateBuffer,
  flushStoreUpdateBufferImmediate,
} from '@/services/transport/buffering/storeUpdateBuffer'
import {
  clearToolDeltaBuffer,
  scheduleToolDeltaFlush,
} from '@/services/transport/buffering/toolDeltaBuffer'
import { hasComposerSendPayload } from '@/services/transport/composerAttachments'
import type { SendMessageOptions } from '@/services/transport/messageTypes'
import { SSEQualityMonitor } from '@/services/transport/SSEQualityMonitor'
import { SSETransport } from '@/services/transport/SSETransport'
import type { SendMessageParams, TransportState } from '@/services/transport/types'
import { useResolvedBillingMode } from '@/stores/useBillingModeStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSitesStore } from '@/stores/useSitesStore'
import {
  type StreamingMessage,
  useCurrentAppId,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import type { StructuredError } from '@/types/errors'
import { logImpressionEvent, setInstrumentationIntentCategory } from '@/utils/instrumentation'
import { readIntentCategoryFromSession } from '@/utils/traffic-signals'
import { ensureFreshToken } from './github/useGitHubTokenHealth'
import { resolveMessageDefaults } from './resolveMessageDefaults'
import { handleBuildPhaseNotification } from './shared/buildPhaseNotification'
import { classifyConnectError } from './shared/classifyConnectError'
import {
  checkNewPageCreation,
  handleCommitComplete,
  incrementSessionPromptCount,
  invalidateMediaManifestIfNeeded,
  maybeFireEvalSnapshot,
  maybeShowFeedbackBanner,
  postInitialBuildEvent,
  scheduleUsageRefresh,
  trackCompletion,
  trackError,
  trackInitialBuildComplete,
  trackStepStart,
  trackToolResult,
  updateSiteTimestamp,
} from './shared/completionSideEffects'
import { isInitialBuildComplete, isInitialBuildFunnelActive } from './shared/initialBuildFunnel'
import { handleLogoNotification } from './shared/logoNotification'
import { handleMediaCaptionNotification } from './shared/mediaCaptionNotification'
import { mapToolCall, mapToolResult, mapToolStart } from './shared/toolMappers'
import { detectRebuildIntent, handleToolCallSideEffects, handleToolResultSideEffects } from './shared/toolSideEffects'
import { handleToolStartSideEffects } from './shared/toolStartSideEffects'
import { buildValidationToolCallFromEvent } from './shared/validationToolCallBuilder'
import { handleVideoNotification } from './shared/videoNotification'
import { useBudgetUpdate } from './useBudgetUpdate'
import { useGrantContext } from './useGrantContext'
import { useSwitchboard } from './useSwitchboard'
import { useTranslations } from './useTranslations'

const BROWSER_TIMEZONE: string = Intl.DateTimeFormat().resolvedOptions().timeZone

type ConnectionStatus = 'idle' | 'connecting' | 'authenticating' | 'streaming' | 'completing' | 'error'

const STREAM_UPDATE_EVENTS = new Set([
  'chunk',
  'tool_start',
  'tool_input_delta',
  'tool_call',
])

async function timeFetch<T>(promise: Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now()
  const value = await promise
  return { value, ms: Date.now() - start }
}

export function lastAssistantMessageIsComplete(messages: readonly { role: string; isComplete?: boolean }[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    // Persisted ChatMessage has no `isComplete` field; its presence (false)
    // only appears on recovered/streaming records. Absent → complete.
    return !('isComplete' in msg && msg.isComplete === false)
  }
  return false
}

function ensureSSEActiveStream(reason: string, conversationId?: string): void {
  const state = useStreamingConversationStore.getState()
  if (state.activeStream) return

  if (!conversationId) {
    logger.warn('sse.stream.active_stream.missing_conversation_id', {
      appId: state.currentAppId,
      reason,
    })
  }

  const streamingMessage: StreamingMessage = {
    id: `sse_recovered_${Date.now()}`,
    role: 'assistant',
    content: '',
    segments: [],
    toolCalls: [],
    timestamp: new Date(),
    isComplete: false,
    metadata: {
      source: 'sse_recovery',
      ...(conversationId && { conversationId }),
    },
  }

  useStreamingConversationStore.setState({
    activeStream: streamingMessage,
    streamingState: 'streaming',
    currentStep: 1,
    isLoading: true,
  })

  logger.info('sse.stream.active_stream.created', {
    appId: state.currentAppId,
    conversationId,
    reason,
  })
}

function deriveConnectionState(transportState: TransportState): { connected: boolean; status: ConnectionStatus } {
  const connected = transportState === 'connected' || transportState === 'streaming'
  const status: ConnectionStatus = (() => {
    switch (transportState) {
      case 'connected': return 'idle'
      case 'streaming': return 'streaming'
      case 'error': return 'error'
      // Idle give-up: a torn-down stream re-armed only by the next send.
      // Surface as a benign idle connection, not an error (AIROBUILD-2628).
      case 'dormant': return 'idle'
      default: return 'connecting'
    }
  })()
  return { connected, status }
}

export function useSSEChat({ enabled = true }: { enabled?: boolean } = {}) {
  // transport is kept in state (not ref) so useGrantContext sees it when the
  // async connect effect creates it — a ref mutation would not re-render and
  // the grant subscriber would remain wired to `null`.
  const [transport, setTransport] = useState<SSETransport | null>(null)
  const transportRef = useRef<SSETransport | null>(null)
  transportRef.current = transport
  const monitorRef = useRef<SSEQualityMonitor | null>(null)
  if (!monitorRef.current) {
    monitorRef.current = new SSEQualityMonitor()
  }
  const appIdRef = useRef<string | null>(null)
  const historyBatchRef = useRef<{ messages: unknown[]; isPagination: boolean } | null>(null)
  const historyBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayCompletesStreamRef = useRef(false)
  const replayDedupRef = useRef<{ active: boolean; seen: Set<number> }>({
    active: false,
    seen: new Set<number>(),
  })
  const recoveryHandshakePendingRef = useRef(false)
  const recoveryReplayActiveRef = useRef(false)
  const deferredInitialHistoryConversationIdRef = useRef<string | null>(null)
  const recoveryHistoryReplayRef = useRef<{ active: boolean; hasMore: boolean; nextCursor: string | null }>({
    active: false,
    hasMore: false,
    nextCursor: null,
  })
  // Inline recovery history can fail while live event replay still completes;
  // in that case the HTTP history result, not replay_complete, owns completion.
  const recoveryHistoryFallbackPendingRef = useRef(false)
  const currentStreamRequestIdRef = useRef<string | null>(null)
  // Set when the user clicks Stop; cleared on the next genuine send. While set,
  // a live chunk/tool event with no active stream must NOT auto-re-open the
  // stream — after a stop those events are backend stragglers (the provider
  // hasn't honored the abort yet) and re-opening would flip the composer back
  // to the Stop affordance (AIROBUILD-1235). Recovery/reconnect re-open uses a
  // separate path and is intentionally left unguarded.
  const suppressStreamReopenRef = useRef(false)

  const currentAppId = useCurrentAppId()
  const { tokenAuthType } = useAuthContext()
  const routeParams = useParams()
  const market = typeof routeParams?.market === 'string' ? routeParams.market : undefined
  const marketRef = useRef(market)
  marketRef.current = market

  const subscriptionId = useSitesStore((state) => {
    if (!currentAppId) return undefined
    return state.getSite(currentAppId)?.subscription_id
  })

  const budgetServiceEnabled = useResolvedBillingMode(currentAppId)
  const bringOverTogglesEnabled = useSwitchboard('appbuilder-rebuild-bring-over-toggles')

  const subscriptionIdRef = useRef(subscriptionId)
  subscriptionIdRef.current = subscriptionId

  const budgetServiceEnabledRef = useRef(budgetServiceEnabled)
  budgetServiceEnabledRef.current = budgetServiceEnabled

  const bringOverTogglesEnabledRef = useRef(bringOverTogglesEnabled)
  bringOverTogglesEnabledRef.current = bringOverTogglesEnabled

  const tokenAuthTypeRef = useRef(tokenAuthType)
  tokenAuthTypeRef.current = tokenAuthType

  // Captured in a ref so the onEvent handler can show localized toasts
  // without the locale being a dependency of the transport-setup effect
  // (which would tear down the SSE connection on every locale change).
  const t = useTranslations()
  const tRef = useRef(t)
  tRef.current = t

  const [transportState, setTransportState] = useState<TransportState>('disconnected')
  const [connectionError, setConnectionError] = useState<unknown>(undefined)
  const [reconnectNonce, setReconnectNonce] = useState(0)

  // Track last sendMessage options + APP_NOT_FOUND retry state. Mirrors the
  // WS ErrorHandler retry loop: APP_NOT_FOUND is common during app
  // provisioning and should not surface as a terminal error for ~30s.
  const lastResolvedSendParamsRef = useRef<SendMessageParams | null>(null)
  const appNotFoundRetryRef = useRef<{ startTime: number; count: number; timer: ReturnType<typeof setTimeout> | null }>({
    startTime: 0, count: 0, timer: null,
  })
  // Gates sendMessage after a deterministic connect failure (set together with
  // setTransportState('error')); cleared on each fresh connect and on 'connected'.
  const connectUnavailableRef = useRef(false)
  const provisioningRetryRef = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | null }>({ count: 0, timer: null })
  const clearAppNotFoundRetry = useCallback(() => {
    if (appNotFoundRetryRef.current.timer) {
      clearTimeout(appNotFoundRetryRef.current.timer)
    }
    appNotFoundRetryRef.current = { startTime: 0, count: 0, timer: null }
  }, [])

  const isConnected = transportState === 'connected' || transportState === 'streaming'

  useGrantContext({
    controller: transport,
    subscriptionId,
    isConnected,
    budgetServiceEnabled,
    enabled,
  })

  useBudgetUpdate({
    controller: transport,
    subscriptionId,
    budgetServiceEnabled,
    enabled,
  })


  useEffect(() => {
    const store = useStreamingConversationStore.getState()
    const { connected, status } = deriveConnectionState(transportState)
    const current = store.connection
    if (current?.connected !== connected || current?.status !== status) {
      store.setConnectionState({ connected, status })
    }
  }, [transportState])

  // Flush accumulated history batch into store. When `isPagination` is
  // omitted, use the mode recorded on the batch itself — this matters for
  // timer-driven flushes where the closure captures state at scheduling
  // time rather than at fire time.
  const flushHistoryBatch = useCallback((isPagination?: boolean) => {
    const batch = historyBatchRef.current
    if (!batch || batch.messages.length === 0) return

    const effectivePagination = isPagination ?? batch.isPagination

    const store = useStreamingConversationStore.getState()
    if (!store.currentAppId) return

    let mode: 'replace' | 'prepend'
    if (effectivePagination) {
      mode = 'prepend'
    } else {
      const hasExistingContent = store.messages.length > 0 || !!store.activeStream
      mode = hasExistingContent ? 'prepend' : 'replace'
    }

    store.loadAndPersistHistory({
      appId: store.currentAppId,
      rawMessages: batch.messages,
      mode,
      detectInProgress: !effectivePagination,
    })

    historyBatchRef.current = null

    if (historyBatchTimerRef.current) {
      clearTimeout(historyBatchTimerRef.current)
      historyBatchTimerRef.current = null
    }
  }, [])

  const startInitialHistoryLoad = useCallback((conversationId: string): boolean => {
    const store = useStreamingConversationStore.getState()
    const currentTransport = transportRef.current
    if (!currentTransport) {
      store.setHistoryLoadRequested(false)
      logger.warn('sse.history.load.no_transport', { appId: currentAppId, conversationId })
      return false
    }

    store.setHistoryLoadRequested(true)
    logger.info('sse.history.load', { appId: currentAppId, conversationId })
    currentTransport.loadHistory()
    return true
  }, [currentAppId])

  const releaseDeferredInitialHistoryLoad = useCallback((): boolean => {
    const deferredConversationId = deferredInitialHistoryConversationIdRef.current
    if (!deferredConversationId) return false

    deferredInitialHistoryConversationIdRef.current = null
    return startInitialHistoryLoad(deferredConversationId)
  }, [startInitialHistoryLoad])

  const requestInitialHistoryLoad = useCallback((conversationId: string | null): boolean => {
    const store = useStreamingConversationStore.getState()

    if (!conversationId) {
      if (!store.historyLoadingComplete) {
        store.setHistoryLoadingComplete(true)
      }
      return false
    }

    if (store.historyLoadingComplete || store.historyLoadRequested) return false

    const currentTransport = transportRef.current
    if (!currentTransport) return false

    if (recoveryHandshakePendingRef.current || recoveryReplayActiveRef.current) {
      deferredInitialHistoryConversationIdRef.current = conversationId
      store.setHistoryLoadRequested(true)
      logger.info('sse.history.load.deferred_for_recovery', {
        appId: currentAppId,
        conversationId,
        recoveryHandshakePending: recoveryHandshakePendingRef.current,
        recoveryReplayActive: recoveryReplayActiveRef.current,
      })
      return true
    }

    return startInitialHistoryLoad(conversationId)
  }, [currentAppId, startInitialHistoryLoad])

  // Connect/reconnect when appId changes
  useEffect(() => {
    if (!enabled || !currentAppId) return

    let cancelled = false

    async function connect() {
      const monitor = monitorRef.current
      monitor?.markConnectStart(currentAppId!)
      try {
        // Optimistically clear the app-unavailable gate for each fresh connect
        // attempt; a repeat deterministic failure re-sets it in the catch.
        connectUnavailableRef.current = false
        const [configResult, tokenResult] = await Promise.all([
          timeFetch(dynamicApiConfigService.getConfigForSite(currentAppId!)),
          timeFetch(getAgentToken(currentAppId!)),
        ])
        const config = configResult.value
        const token = tokenResult.value

        if (cancelled) return

        // Destroy previous transport if app changed
        if (transportRef.current && appIdRef.current !== currentAppId) {
          // Clear stale buffers to prevent data from old app bleeding into new app
          clearToolDeltaBuffer()
          clearStoreUpdateBuffer()
          historyBatchRef.current = null
          if (historyBatchTimerRef.current) {
            clearTimeout(historyBatchTimerRef.current)
            historyBatchTimerRef.current = null
          }
          recoveryHandshakePendingRef.current = false
          recoveryReplayActiveRef.current = false
          deferredInitialHistoryConversationIdRef.current = null
          if (provisioningRetryRef.current.timer) clearTimeout(provisioningRetryRef.current.timer)
          provisioningRetryRef.current = { count: 0, timer: null }

          transportRef.current.destroy()
          transportRef.current = null
          setTransport(null)
        }

        if (!transportRef.current) {
          const newTransport = new SSETransport({ baseUrl: config.baseUrl, qualityMonitor: monitorRef.current ?? undefined })
          transportRef.current = newTransport
          setTransport(newTransport)

          newTransport.on({
            onEvent(event) {
              const store = useStreamingConversationStore.getState()
              const type = event.type
              const eventRequestId = typeof (event.data as any)?.requestId === 'string' && (event.data as any).requestId
                ? (event.data as any).requestId as string
                : null
              if (
                replayDedupRef.current.active
                && typeof event.sequence === 'number'
              ) {
                if (replayDedupRef.current.seen.has(event.sequence)) {
                  logger.debug('sse.recovery.replay_dedup.drop', {
                    appId: store.currentAppId,
                    eventType: type,
                    sequence: event.sequence,
                  })
                  return
                }
                replayDedupRef.current.seen.add(event.sequence)
              }
              if (STREAM_UPDATE_EVENTS.has(type)) {
                // Drop post-stop stragglers instead of re-opening the stream.
                if (suppressStreamReopenRef.current && !useStreamingConversationStore.getState().activeStream) {
                  logger.debug('sse.stream.reopen_suppressed_after_stop', {
                    appId: store.currentAppId, eventType: type,
                  })
                  return
                }
                monitorRef.current?.markFirstResponse()
                if (eventRequestId) currentStreamRequestIdRef.current = eventRequestId
                ensureSSEActiveStream(type, event.conversationId)
              }

              if (type === 'server_config') {
                if (recoveryHandshakePendingRef.current) {
                  recoveryHandshakePendingRef.current = false
                  releaseDeferredInitialHistoryLoad()
                }
                useStreamingConversationStore.setState({
                  serverCapabilities: {
                    version: (event.data as any)?.serverVersion as string | undefined
                  }
                })
              } else if (type === 'agents_available') {
                const payload = event.data as any
                const rawAgents = Array.isArray(payload?.agents) ? payload.agents : []
                const agents = rawAgents
                  .map((a: any) => {
                    const id = a?.id ?? a?.name
                    if (!id) return null
                    return { id: String(id), name: String(a?.name ?? id), description: a?.description }
                  })
                  .filter(Boolean)
                store.setAgentCatalog(agents, payload?.defaultAgent ? String(payload.defaultAgent) : null)
              } else if (type === 'step_start') {
                if (eventRequestId) currentStreamRequestIdRef.current = eventRequestId
                const agentNameRaw = (event.data as any)?.agentName
                if (agentNameRaw) store.setCurrentAgentName(String(agentNameRaw))
                clearAppNotFoundRetry()
                trackStepStart()
              } else if (type === 'step_complete') {
                if ((event.data as any)?.maxStepsReached === true) {
                  logger.warn('sse.steps.max-reached', { appId: store.currentAppId })
                  store.markMaxStepsReached()
                }
              } else if (type === 'chunk') {
                bufferTextChunk(event.content ?? '')
              } else if (type === 'tool_start') {
                const tool = (event.data as any)?.tool ?? (event.data as any)?.data?.tool
                if (tool) {
                  bufferStoreUpdate(() => store.addToolStartSegment(mapToolStart(tool)))
                  handleToolStartSideEffects(tool)
                }
              } else if (type === 'tool_input_delta') {
                const data = event.data as any
                const toolId = data?.toolId ?? data?.data?.toolId
                const toolName = data?.toolName ?? data?.data?.toolName
                const delta = data?.delta ?? data?.data?.delta
                if (toolId && delta) {
                  bufferStoreUpdate(() => store.updateToolDelta(toolId, toolName ?? '', delta))
                  scheduleToolDeltaFlush()
                }
              } else if (type === 'tool_call') {
                const tool = (event.data as any)?.tool ?? (event.data as any)?.data?.tool
                if (tool) {
                  flushStoreUpdateBufferImmediate()
                  bufferStoreUpdate(() => store.addToolCallSegment(mapToolCall(tool)))
                  handleToolCallSideEffects(tool, store.currentAppId)
                }
              } else if (type === 'tool_result') {
                const tool = (event.data as any)?.tool ?? (event.data as any)?.data?.tool
                if (tool) {
                  flushStoreUpdateBufferImmediate()
                  trackToolResult(tool)
                  bufferStoreUpdate(() => store.addToolResultSegment(mapToolResult(tool)))
                  handleToolResultSideEffects(tool, store.currentAppId).catch(err => {
                    logger.warn('sse.tool_result.side_effects_failed', {
                      appId: store.currentAppId, toolName: tool?.name,
                      error: err instanceof Error ? err.message : String(err),
                    })
                  })
                }
              } else if (type === 'subagent_event') {
                const payload = event.data as { subagentToolId?: string; agent?: string; event?: string; detail?: string }
                if (payload.subagentToolId && payload.agent) {
                  store.addSubagentEvent(
                    payload.subagentToolId,
                    { event: payload.event ?? '', agent: payload.agent, detail: payload.detail ?? '' },
                  )
                }
              } else if (type === 'stream_retry') {
                // Guard only fires when BOTH event and ref requestIds are present — a retry without
                // requestId (legacy server, first conversation) intentionally bypasses to clear the UI.
                if (eventRequestId && currentStreamRequestIdRef.current && eventRequestId !== currentStreamRequestIdRef.current) {
                  logger.info('sse.stream_retry.stale_ignored', {
                    appId: store.currentAppId,
                    requestId: eventRequestId,
                    activeRequestId: currentStreamRequestIdRef.current,
                  })
                  return
                }
                if (eventRequestId) currentStreamRequestIdRef.current = eventRequestId
                flushStoreUpdateBufferImmediate()
                store.clearStreamForRetry()
              } else if (type === 'validation_message') {
                const { toolCall, isTerminal } = buildValidationToolCallFromEvent(event.data, event.content)
                flushStoreUpdateBufferImmediate()
                bufferStoreUpdate(() => store.addToolStartSegment(toolCall))
                if (isTerminal) {
                  bufferStoreUpdate(() => store.addToolResultSegment(toolCall))
                  if (store.currentAppId) ensureFreshToken(store.currentAppId, 'commit');
                }
              } else if (type === 'complete') {
                monitorRef.current?.clearSend()
                flushStoreUpdateBufferImmediate()
                store.finalizeStream(event.data)

                const completeData = event.data as any
                const traceId = typeof completeData?.traceId === 'string' && completeData.traceId ? completeData.traceId : undefined
                const observationId = typeof completeData?.observationId === 'string' && completeData.observationId ? completeData.observationId : undefined
                if (traceId && observationId) {
                  const requestId = typeof completeData?.requestId === 'string' && completeData.requestId ? completeData.requestId : undefined
                  const agentName = typeof completeData?.agentId === 'string' && completeData.agentId ? completeData.agentId : undefined
                  useDevelopPageStore.getState().setLastCompleteTraceIds({
                    traceId,
                    observationId,
                    ...(agentName && { agentName }),
                    ...(requestId && { requestId }),
                  })
                } else {
                  useDevelopPageStore.getState().setLastCompleteTraceIds(null)
                }
                const commitHash = typeof completeData?.commitHash === 'string' && completeData.commitHash.length > 0
                  ? completeData.commitHash : undefined
                const activeAppId = store.currentAppId

                // A turn that parked on an unanswered askQuestion is a pre-build
                // interview, not a completed build — even though the kit-attach
                // interview turn commits its forced-install tokens and so carries a
                // commitHash. Align the client with the server (which only marks
                // first-build on an agent git-tool commit) by not flipping
                // initialBuildComplete here, so First Build Feedback doesn't activate
                // and suppress the interview card (AIROBUILD-2665). finalizeStream has
                // already run, so the finalized assistant message is in the store.
                //
                // Gated on `appbuilder-design-kit-gallery` so the deferral is scoped
                // to the design-kit gallery feature. With the flag OFF (current prod)
                // this is always false, so trackInitialBuildComplete + postInitialBuildEvent
                // fire exactly as before — the standard design-system flow (whose first
                // build also ends on a "Do you like the design?" askQuestion, hiding the
                // composer / deferring FBF) is byte-for-byte unchanged. Matches A2/B,
                // which are likewise dormant when the gallery flag is off (AIROBUILD-2665).
                const parkedOnAskQuestion =
                  getSwitchboardFlag('appbuilder-design-kit-gallery') === true &&
                  isParkedOnAskQuestion(useStreamingConversationStore.getState().messages)

                incrementSessionPromptCount(activeAppId)
                maybeShowFeedbackBanner()
                trackCompletion(!!completeData?.usage)
                if (!parkedOnAskQuestion) {
                  trackInitialBuildComplete(commitHash)
                }

                // Reset intent_category from sessionStorage after stream ends.
                // Clears stale eager 'rebuild' if websiteRebuild wasn't called; no-op if already restored.
                if (activeAppId) {
                  setInstrumentationIntentCategory(
                    isInitialBuildFunnelActive() && !isInitialBuildComplete()
                      ? 'new_build'
                      : (readIntentCategoryFromSession(activeAppId) ?? 'edit'),
                  )
                }

                if (activeAppId) {
                  invalidateMediaManifestIfNeeded(activeAppId)

                  if (commitHash) {
                    handleCommitComplete(commitHash, activeAppId).catch(err => {
                      logger.warn('sse.complete.handle_commit_failed', {
                        appId: activeAppId, commitHash,
                        error: err instanceof Error ? err.message : String(err),
                      })
                    })
                    // Skip on a parked askQuestion turn: postInitialBuildEvent
                    // optimistically sets client initialBuildComplete=true, which would
                    // suppress the pre-build interview card via First Build Feedback
                    // (AIROBUILD-2665). handleCommitComplete still runs (commit-side
                    // effects are correct regardless).
                    if (!parkedOnAskQuestion) {
                      postInitialBuildEvent(activeAppId)
                    }
                  } else {
                    checkNewPageCreation().catch(err => {
                      logger.warn('sse.complete.check_new_page_failed', {
                        appId: activeAppId,
                        error: err instanceof Error ? err.message : String(err),
                      })
                    })
                  }

                  updateSiteTimestamp(activeAppId)
                }
                maybeFireEvalSnapshot(commitHash, activeAppId)
                scheduleUsageRefresh()
              } else if (type === 'error' || type === 'stream_error') {
                flushStoreUpdateBufferImmediate()
                const errData = event.data as any
                const errMsg = event.content ?? errData?.message ?? 'Unknown error'
                const errorType = errData?.errorType as string | undefined

                if (errorType === 'TOOL_VALIDATION_ERROR') return

                if (errorType === 'BUDGET_EXCEEDED') {
                  monitorRef.current?.clearSend()
                  logImpressionEvent('credits.budget.exceeded')()
                  store.markBudgetExceeded()
                  store.finalizeStream()
                  trackError('BUDGET_EXCEEDED')
                  return
                }

                // APP_NOT_FOUND is common during app provisioning — retry the
                // last sendMessage with exponential backoff up to ~30s, like
                // the WS ErrorHandler does, before surfacing as a hard error.
                if (errorType === 'APP_NOT_FOUND' && lastResolvedSendParamsRef.current) {
                  const retry = appNotFoundRetryRef.current
                  if (retry.startTime === 0) retry.startTime = Date.now()
                  const elapsed = Date.now() - retry.startTime
                  if (elapsed < 30_000) {
                    retry.count += 1
                    const delay = Math.min(500 * Math.pow(2, retry.count - 1), 5_000)
                    logger.warn('sse.error.app_not_found.retry', {
                      appId: currentAppId, retryCount: retry.count, delay, elapsed,
                    })
                    const pending = lastResolvedSendParamsRef.current
                    if (!pending) {
                      clearAppNotFoundRetry()
                      return
                    }
                    if (retry.timer) clearTimeout(retry.timer)
                    retry.timer = setTimeout(() => {
                      // Transport may have been torn down between the retry
                      // scheduling and this timer firing (unmount, navigation).
                      // `x?.f().catch` throws TypeError when x is nullish
                      // because `.catch` runs on `undefined`, so guard early.
                      const transport = transportRef.current
                      if (!transport) {
                        logger.warn('sse.error.app_not_found.resend_skipped', {
                          appId: currentAppId, reason: 'transport_unavailable',
                        })
                        return
                      }
                      transport.sendMessage(pending).catch(err => {
                        logger.warn('sse.error.app_not_found.resend_failed', {
                          appId: currentAppId, error: err instanceof Error ? err.message : String(err),
                        })
                      })
                    }, delay)
                    return
                  }
                  clearAppNotFoundRetry()
                }

                const structuredError: StructuredError = {
                  message: sanitizeUpstreamErrorMessage(errMsg, tRef.current),
                  type: (errorType as StructuredError['type']) ?? 'UPSTREAM_ERROR',
                  statusCode: resolveUpstreamErrorStatusCode(errMsg, errData?.statusCode),
                  timestamp: errData?.timestamp,
                  retryAttempts: errData?.retryAttempts,
                  retryReason: errData?.retryReason,
                }
                monitorRef.current?.clearSend()
                store.markUpstreamError(structuredError)
                store.finalizeStream()
                trackError(errorType)
              } else if (type === 'history_message') {
                const wrapper = event.data as any
                const isPagination = wrapper?.isPagination === true
                const msg = wrapper?.data ?? wrapper
                if (!historyBatchRef.current) {
                  historyBatchRef.current = { messages: [], isPagination }
                }
                historyBatchRef.current.messages.push(msg)

                if (historyBatchRef.current.messages.length >= 10) {
                  flushHistoryBatch()
                } else if (!historyBatchTimerRef.current) {
                  historyBatchTimerRef.current = setTimeout(() => flushHistoryBatch(), 50)
                }
              } else if (type === 'history_loaded') {
                flushHistoryBatch(false)

                if ((event.data as any)?.error) {
                  store.setHistoryLoadRequested(false)
                  logger.warn('sse.history.loaded.error', {
                    appId: store.currentAppId, error: (event.data as any).error,
                  })
                  // Leave historyLoadingComplete false so
                  // StreamingMessageList can retry and, if the retry cap is
                  // exhausted, render the explicit history-load failure state
                  // instead of treating the conversation as empty.
                  deferredInitialHistoryConversationIdRef.current = null
                  recoveryHistoryFallbackPendingRef.current = false
                  return
                }

                store.setHistoryPagination({
                  hasMore: typeof (event.data as any)?.hasMore === 'boolean' ? (event.data as any).hasMore : false,
                  nextCursor: (event.data as any)?.nextCursor ?? null,
                })
                store.setHistoryLoadingComplete(true)
                deferredInitialHistoryConversationIdRef.current = null
                recoveryHistoryFallbackPendingRef.current = false

                historyBatchRef.current = null
                if (historyBatchTimerRef.current) {
                  clearTimeout(historyBatchTimerRef.current)
                  historyBatchTimerRef.current = null
                }
              } else if (type === 'client_action') {
                const actionData = event.data as any
                const { action, params, requestId } = actionData ?? {}
                if (!action || !requestId) return

                // Every postClientActionResult goes through postActionResult so
                // we cannot silently drop the result the agent is waiting on —
                // if the POST fails, at least it gets logged.
                const postActionResult = (payload: Parameters<NonNullable<typeof transportRef.current>['postClientActionResult']>[0]) => {
                  transportRef.current?.postClientActionResult(payload).catch(err => {
                    logger.warn('sse.client_action.post_result.failed', {
                      appId: currentAppId, requestId: payload.requestId,
                      error: err instanceof Error ? err.message : String(err),
                    })
                  })
                }

                import('@/hooks/chat/actions').then(async ({ clientActionExecutors }) => {
                  const executor = clientActionExecutors[action]
                  if (!executor) {
                    postActionResult({
                      requestId, success: false, error: `Unknown action: ${action}`,
                    })
                    return
                  }

                  // SSE reverse channel for the transport-agnostic timeout-reset
                  // signal (mirrors postClientActionResult). Best-effort: an older
                  // agent without the route 404s, which the transport logs-and-ignores.
                  // Typed against the fields executors actually read in the SSE
                  // path so signature drift (e.g. resetActionTimeout) is caught at
                  // compile time. The remaining MessageContext members (socket,
                  // machine, actions, ...) don't exist over SSE; the widening to the
                  // full executor context is the one deliberate, localized cast.
                  const minimalContext: ClientActionContext = {
                    currentAppId,
                    resetActionTimeout: (rid: string) => {
                      transportRef.current?.requestClientActionTimeoutReset({ requestId: rid }).catch(err => {
                        logger.warn('sse.client_action.reset_timeout.failed', {
                          appId: currentAppId, requestId: rid,
                          error: err instanceof Error ? err.message : String(err),
                        })
                      })
                    },
                  }
                  try {
                    const result = await executor(params ?? {}, minimalContext, requestId)
                    postActionResult({ requestId, success: true, result })
                  } catch (err) {
                    const anyErr = err as { errorDetails?: string; logs?: Array<{ message: string; source?: string; timestamp?: string }>; exitCode?: number }
                    postActionResult({
                      requestId, success: false,
                      error: err instanceof Error ? err.message : String(err),
                      errorDetails: anyErr?.errorDetails,
                      logs: anyErr?.logs,
                      exitCode: anyErr?.exitCode,
                    })
                  }
                }).catch(err => {
                  postActionResult({
                    requestId, success: false,
                    error: err instanceof Error ? err.message : 'module load failed',
                  })
                })
              } else if (type === 'video') {
                // Shared with the WS VideoHandler: store update + Growl toast.
                handleVideoNotification({
                  raw: event.data,
                  clientAppId: store.currentAppId,
                  t: tRef.current,
                  logPrefix: 'sse.video',
                })
              } else if (type === 'build_phase') {
                // Shared with the WS BuildPhaseHandler: advance the design-kit wizard stepper.
                handleBuildPhaseNotification({
                  raw: event.data as Record<string, unknown>,
                  clientAppId: store.currentAppId ?? '',
                  logPrefix: 'sse.build_phase',
                })
              } else if (type === 'logo') {
                // Shared with the WS LogoHandler: store update (chat card swap),
                // mediaManifest query invalidation (Brand Book / media live refresh),
                // RELOAD_MEDIA_SLOT, and Growl toast. SSE sessions get no WS push
                // (emitToApp wsDelivered=0), so this branch is required for parity.
                handleLogoNotification({
                  raw: event.data,
                  clientAppId: store.currentAppId,
                  t: tRef.current,
                  logPrefix: 'sse.logo',
                })
              } else if (type === 'media_caption') {
                // Ported from the WS MediaCaptionHandler: patch the media-slot +
                // manifest React Query caches so a freshly generated caption shows
                // in place without a manifest refetch (AIROBUILD-2680).
                handleMediaCaptionNotification({
                  raw: event.data,
                  clientAppId: store.currentAppId,
                  logPrefix: 'sse.media_caption',
                })
              } else if (type === 'recovery_status') {
                const payload = event.data as any
                recoveryHandshakePendingRef.current = false
                recoveryReplayActiveRef.current = payload?.hasBufferedEvents === true
                replayCompletesStreamRef.current = false
                replayDedupRef.current.active = payload?.hasBufferedEvents === true
                replayDedupRef.current.seen.clear()
                const recoveryHistoryNeedsFallback = payload?.lossDetected === true
                  && payload?.historyLoadFailed === true
                  && payload?.historyMessageCount === 0
                recoveryHistoryFallbackPendingRef.current = recoveryHistoryNeedsFallback
                recoveryHistoryReplayRef.current = {
                  active: payload?.lossDetected === true && !recoveryHistoryNeedsFallback,
                  hasMore: payload?.historyHasMore === true,
                  nextCursor: typeof payload?.historyNextCursor === 'string' ? payload.historyNextCursor : null,
                }
                if (payload?.streamCompleted && !payload?.hasBufferedEvents) {
                  if (store.activeStream) {
                    store.clearActiveStream()
                  }
                  // Force history reload to pick up the completed turn.
                  if (transportRef.current) {
                    const historyConversationId = typeof payload?.conversationId === 'string'
                      ? payload.conversationId
                      : currentAppId ? getConversationIdFromCookie(currentAppId) : null
                    deferredInitialHistoryConversationIdRef.current = null
                    store.setHistoryLoadRequested(false)
                    if (historyConversationId) {
                      startInitialHistoryLoad(historyConversationId)
                    } else {
                      logger.warn('sse.history.load.noConversationId', { appId: currentAppId })
                      transportRef.current.loadHistory()
                    }
                  }
                } else if (payload?.hasBufferedEvents) {
                  ensureSSEActiveStream('recovery_status', payload?.conversationId)
                  replayCompletesStreamRef.current = payload?.streamCompleted === true
                  // Route through the transport state pipe (setTransportState
                  // → deriveConnectionState → useEffect → setConnectionState)
                  // rather than mutating the store directly from the event
                  // handler, per app/CLAUDE.md lifecycle rules.
                  setTransportState('streaming')
                } else {
                  const released = releaseDeferredInitialHistoryLoad()
                  logger.info('sse.recovery.no_buffered_events_releasing_deferred', {
                    appId: currentAppId,
                    released,
                  })
                }

                // Ambiguous recovery: server lost context; clear stale placeholder if history confirms turn finished.
                if (!payload?.hasBufferedEvents && !payload?.streamCompleted) {
                  const afterStore = useStreamingConversationStore.getState()
                  if (afterStore.activeStream && lastAssistantMessageIsComplete(afterStore.messages)) {
                    const staleStreamId = afterStore.activeStream.id
                    afterStore.clearActiveStream()
                    logger.info('sse.recovery.fallback.cleared_stale_stream', {
                      appId: currentAppId,
                      streamId: staleStreamId,
                    })
                  }
                }

                logger.info('sse.recovery.status', {
                  appId: currentAppId,
                  hasBufferedEvents: payload?.hasBufferedEvents,
                  bufferedCount: payload?.bufferedCount,
                  streamCompleted: payload?.streamCompleted,
                })

                // Buffer-loss with failed inline history: fall back to HTTP history
                // load so the client doesn't silently miss conversation data.
                // Skip when streamCompleted && !hasBufferedEvents — that branch
                // already triggers a history reload above.
                if (recoveryHistoryNeedsFallback && !(payload?.streamCompleted && !payload?.hasBufferedEvents)) {
                  logger.info('sse.recovery.history_fallback_triggered', { appId: currentAppId })
                  if (transportRef.current) {
                    store.setHistoryLoadRequested(true)
                    transportRef.current.loadHistory()
                  }
                }
              } else if (type === 'replay_complete') {
                // Flush any buffered store updates from replayed events
                flushStoreUpdateBufferImmediate()
                if (recoveryHistoryReplayRef.current.active) {
                  flushHistoryBatch(false)
                  store.setHistoryPagination({
                    hasMore: recoveryHistoryReplayRef.current.hasMore,
                    nextCursor: recoveryHistoryReplayRef.current.nextCursor,
                  })
                  store.setHistoryLoadingComplete(true)
                  store.setHistoryLoadRequested(false)
                  recoveryHistoryReplayRef.current = { active: false, hasMore: false, nextCursor: null }
                }
                replayDedupRef.current.active = false
                replayDedupRef.current.seen.clear()
                recoveryReplayActiveRef.current = false
                if (replayCompletesStreamRef.current) {
                  store.finalizeStream()
                  setTransportState('connected')
                  replayCompletesStreamRef.current = false
                }
                if (!recoveryHistoryFallbackPendingRef.current) {
                  releaseDeferredInitialHistoryLoad()
                }

                logger.info('sse.recovery.replay_complete', {
                  appId: currentAppId,
                  replayedCount: (event.data as any)?.replayedCount,
                })
              } else if (type === 'history_complete') {
                flushHistoryBatch(true)

                if ((event.data as any)?.error) {
                  logger.warn('sse.history.complete.error', {
                    appId: currentAppId, error: (event.data as any).error,
                  })
                } else {
                  store.setHistoryPagination({
                    hasMore: typeof (event.data as any)?.hasMore === 'boolean' ? (event.data as any).hasMore : false,
                    nextCursor: (event.data as any)?.nextCursor ?? null,
                  })
                }
                store.setHistoryLoadingMore(false)

                historyBatchRef.current = null
                if (historyBatchTimerRef.current) {
                  clearTimeout(historyBatchTimerRef.current)
                  historyBatchTimerRef.current = null
                }
              }
            },

            onStateChange(state) {
              if (!cancelled) {
                setTransportState(state)
                setConnectionError(undefined)

                if (state === 'connected' && currentAppId) {
                  connectUnavailableRef.current = false
                  if (provisioningRetryRef.current.timer) clearTimeout(provisioningRetryRef.current.timer)
                  provisioningRetryRef.current = { count: 0, timer: null }
                  // Fallback for reconnects or future paths that did not
                  // trigger the HTTP history load immediately after connect().
                  // The store guards below dedupe against the eager load.
                  void requestInitialHistoryLoad(getConversationIdFromCookie(currentAppId))
                }
              }
            },

            onError(error) {
              if (cancelled) return
              // 401 refresh is handled inside SSETransport (cache-bust via
              // agent-fetch + reopen). Anything surfaced here is a terminal
              // transport error for the caller to display.
              logger.warn('sse.transport.error', { appId: currentAppId, message: error.message })
              setConnectionError(error)
              monitorRef.current?.clearSend()
              // Release the UI: a terminal transport error means no `complete`
              // or `error` event will arrive to finalize the stream, so the
              // input stays disabled forever otherwise.
              const store = useStreamingConversationStore.getState()
              const hadDeferredInitialHistoryLoad = deferredInitialHistoryConversationIdRef.current !== null
              recoveryHandshakePendingRef.current = false
              recoveryReplayActiveRef.current = false
              deferredInitialHistoryConversationIdRef.current = null
              if (hadDeferredInitialHistoryLoad) {
                store.setHistoryLoadRequested(false)
              }
              replayDedupRef.current.active = false
              replayDedupRef.current.seen.clear()
              recoveryHistoryReplayRef.current = { active: false, hasMore: false, nextCursor: null }
              recoveryHistoryFallbackPendingRef.current = false
              if (store.activeStream) {
                store.clearActiveStream()
              }
              store.setIsLoading(false)
            },
          })
        }

        appIdRef.current = currentAppId!

        // Resolve or create conversation before opening stream. agentFetch
        // handles Bearer injection + cache-bust retry on 401, so we don't
        // re-roll that logic for this POST. Retry with backoff for transient
        // failures (e.g. container still starting after health check passed).
        const conversationFromCookie = getConversationIdFromCookie(currentAppId!)
        let conversationCreateMs: number | undefined
        let conversationId = conversationFromCookie
        if (!conversationId) {
          const createStart = Date.now()
          const maxRetries = 3
          let lastError: Error | null = null
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (cancelled) return
            if (attempt > 0) {
              await new Promise<void>(r => setTimeout(r, 1000 * 2 ** (attempt - 1)))
              if (cancelled) return
            }
            try {
              const createRes = await agentFetch(`${config.baseUrl}/api/conversations/${currentAppId!}`, {
                siteId: currentAppId!,
                method: 'POST',
              })
              if (createRes.ok) {
                const createData = await createRes.json()
                const id = createData.conversationId as string | undefined
                if (id) {
                  conversationId = id
                  setConversationIdCookie(currentAppId!, conversationId)
                  lastError = null
                  break
                }
                lastError = new Error('Server returned empty conversationId')
              } else {
                lastError = new Error(`Failed to create conversation: ${createRes.status}`)
              }
            } catch (err) {
              lastError = err instanceof Error ? err : new Error(String(err))
            }
            if (attempt < maxRetries) {
              logger.warn('sse.connect.conversationCreate.retry', {
                appId: currentAppId, attempt: attempt + 1, maxRetries,
                error: lastError?.message,
              })
            }
          }
          if (lastError) {
            logger.warn('sse.connect.conversationCreate.exhausted', {
              appId: currentAppId, maxRetries, error: lastError.message,
            })
            throw lastError
          }
          conversationCreateMs = Date.now() - createStart
        }
        if (cancelled) return

        recoveryHandshakePendingRef.current = true
        recoveryReplayActiveRef.current = false
        deferredInitialHistoryConversationIdRef.current = null
        monitor?.recordConnectPhases({
          configFetchMs: configResult.ms,
          tokenFetchMs: tokenResult.ms,
          ...(conversationCreateMs !== undefined && { conversationCreateMs }),
          conversationSource: conversationFromCookie ? 'cookie' : 'created',
        })
        transportRef.current.connect(currentAppId!, token, conversationId)
        // SSE history is fetched over HTTP, not through /stream. Gate the
        // initial load behind the stream recovery handshake so buffered replay
        // remains authoritative for the in-progress turn, matching WS ordering.
        void requestInitialHistoryLoad(conversationId)
      } catch (err) {
        if (cancelled) return
        const classification = classifyConnectError(err)
        logger.error('sse.connect.failed', {
          appId: currentAppId,
          classification,
          error: err instanceof Error ? err.message : String(err),
        })
        if (classification === 'deterministic') {
          // App/agent is gone — retrying cannot succeed. Surface a terminal
          // state and gate sends so the composer does not post into a dead
          // stream. The app-unavailable screen is owned by
          // useInitialization. (AIROBUILD-2628)
          connectUnavailableRef.current = true
          setConnectionError(err)
          setTransportState('error')
        } else if (classification === 'provisioning') {
          // Newly created app whose agent isn't up yet — bounded retry-until-ready.
          const retry = provisioningRetryRef.current
          if (retry.count < 3) {
            retry.count += 1
            const delay = 2000 * 2 ** (retry.count - 1)
            if (retry.timer) clearTimeout(retry.timer)
            retry.timer = setTimeout(() => {
              retry.timer = null
              setReconnectNonce((n) => n + 1)
            }, delay)
          } else {
            setConnectionError(err)
          }
        } else {
          setConnectionError(err)
        }
      }
    }

    void connect()

    return () => {
      cancelled = true
      transportRef.current?.disconnect()
      if (provisioningRetryRef.current.timer) {
        clearTimeout(provisioningRetryRef.current.timer)
        provisioningRetryRef.current.timer = null
      }
    }
  }, [enabled, currentAppId, flushHistoryBatch, releaseDeferredInitialHistoryLoad, requestInitialHistoryLoad, startInitialHistoryLoad, reconnectNonce])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      transportRef.current?.destroy()
      transportRef.current = null
      monitorRef.current?.destroy()
      monitorRef.current = null
      if (historyBatchTimerRef.current) {
        clearTimeout(historyBatchTimerRef.current)
        historyBatchTimerRef.current = null
      }
      historyBatchRef.current = null
      clearAppNotFoundRetry()
      if (provisioningRetryRef.current.timer) {
        clearTimeout(provisioningRetryRef.current.timer)
        provisioningRetryRef.current.timer = null
      }
    }
  }, [clearAppNotFoundRetry])

  const sendMessage = useCallback(async (options: SendMessageOptions) => {
    const t = transportRef.current
    const store = useStreamingConversationStore.getState()
    const activeAppId = store.currentAppId

    if (!hasComposerSendPayload(options.content, {
      selectedAssets: options.selectedAssets,
      referencedFiles: options.customContext?.referencedFiles,
    })) return

    // A genuine new turn — lift any post-stop re-open suppression so this
    // stream and its chunks are honored.
    suppressStreamReopenRef.current = false

    if (!activeAppId) {
      logger.error('sse.send_message.no_app_id', {})
      return
    }

    if (connectUnavailableRef.current) {
      logger.warn('sse.send_message.app_unavailable', { appId: activeAppId })
      store.startNewStream(options.content, options.selectedAssets, options.customContext?.referencedFiles as Array<{ path: string; content: string }> | undefined)
      store.markUpstreamError({
        message: tRef.current('builder_sse_app_unavailable', undefined, 'This app is currently unavailable. Please reload the page.'),
        type: 'APP_NOT_FOUND',
      })
      store.finalizeStream()
      store.setIsLoading(false) // clear any stale loading left by a prior in-flight send
      return
    }

    if (!t) {
      logger.error('sse.send_message.no_transport', { appId: activeAppId })
      return
    }

    const hasText = Boolean(options.content?.trim())

    store.setIsLoading(true)
    const referencedFiles = options.customContext?.referencedFiles as Array<{ path: string; content: string }> | undefined
    const origin = getMessageOriginForAuthType(tokenAuthTypeRef.current)
    const userMessageMetadata =
      options.askQuestionSkipped === true
        ? { askQuestionSkipped: true }
        : options.isActionRequest === true
          ? { isActionRequest: true }
          : undefined
    store.startNewStream(
      options.content,
      options.selectedAssets,
      referencedFiles,
      origin,
      options.uploadedFileName,
      userMessageMetadata,
    )

    // Eager rebuild intent for tool impressions this turn; skip during initial build.
    if (hasText && !isInitialBuildFunnelActive() && detectRebuildIntent(options.content)) {
      setInstrumentationIntentCategory('rebuild')
    }

    // Reset APP_NOT_FOUND retry state so a new user prompt starts with a
    // clean 30-second window. The resolved outbound payload is cached after
    // defaults are applied below.
    lastResolvedSendParamsRef.current = null
    currentStreamRequestIdRef.current = null
    clearAppNotFoundRetry()

    try {
      const [defaults, fullStorySessionId] = await Promise.all([
        resolveMessageDefaults({
          modelOverride: options.modelOverride,
          visualContext: options.visualContext,
        }),
        getFullStorySessionId(),
      ])

      // Homepage rebuild modal choice (sessionStorage). The design direction is always
      // honored (pre-flag behavior). The four bring-over toggles ride along only when the
      // flag is on; off = direction-only, exactly as before the toggles existed.
      const rebuildBringOverChoiceRaw = readDesignChoiceForCurrentApp(activeAppId) ?? undefined
      const rebuildBringOverChoice = bringOverTogglesEnabledRef.current
        ? rebuildBringOverChoiceRaw
        : undefined
      const rebuildDesignDirection = rebuildBringOverChoiceRaw?.direction

      const resolvedSendParams: SendMessageParams = {
        content: options.content,
        sessionId: activeAppId,
        userTimezone: BROWSER_TIMEZONE,
        templateId: options.templateId,
        designKitSlug: options.designKitSlug,
        modelOverride: defaults.modelOverride,
        visualContext: defaults.visualContext,
        aiEditContext: options.aiEditContext,
        aiEditContexts: options.aiEditContexts,
        selectedAssets: options.selectedAssets,
        todoListContext: options.todoListContext,
        isActionRequest: options.isActionRequest,
        customContext: options.customContext,
        rebuildBuildPageSlug: options.rebuildBuildPageSlug,
        ...(rebuildDesignDirection && { rebuildDesignDirection }),
        ...(rebuildBringOverChoice && { rebuildBringOverChoice }),
        budgetServiceEnabled: budgetServiceEnabledRef.current || undefined,
        market: marketRef.current,
        subscriptionId: subscriptionIdRef.current,
        buildErrorContext: store.buildErrorContext,
        uploadedFileName: options.uploadedFileName,
        ...(fullStorySessionId && { fullStorySessionId }),
        isEmbedded: typeof window !== 'undefined' && window.self !== window.top,
      }
      lastResolvedSendParamsRef.current = resolvedSendParams
      monitorRef.current?.markSend()
      await t.sendMessage(resolvedSendParams)
    } catch (err) {
      monitorRef.current?.clearSend()
      const s = useStreamingConversationStore.getState()

      // Detect budget exceeded (402) from SSETransport. Mirror the analytics
      // side effects of the event-path handler so both failure modes report
      // identically.
      if ((err as any)?.errorType === 'BUDGET_EXCEEDED' || (err as any)?.statusCode === 402) {
        logger.warn('sse.send_message.budget_exceeded', { appId: activeAppId })
        logImpressionEvent('credits.budget.exceeded')()
        s.markBudgetExceeded()
        s.finalizeStream()
        s.setIsLoading(false)
        trackError('BUDGET_EXCEEDED')
        return
      }

      logger.error('sse.send_message.failed', { appId: activeAppId, error: err instanceof Error ? err.message : String(err) })
      s.setIsLoading(false)
      const errMessage: string = err instanceof Error ? err.message : 'Send failed'
      s.markUpstreamError({
        message: sanitizeUpstreamErrorMessage(errMessage, tRef.current),
        type: 'UPSTREAM_ERROR',
        statusCode: resolveUpstreamErrorStatusCode(errMessage, (err as { statusCode?: number }).statusCode),
      })
      s.finalizeStream()
    }
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    monitorRef.current?.clearSend()
    // Block straggler-driven re-opens until the next send (see ref comment).
    suppressStreamReopenRef.current = true
    const ack = transportRef.current?.stopGeneration().catch(err => {
      const appId = useStreamingConversationStore.getState().currentAppId
      logger.warn('sse.stop.failed', {
        appId, error: err instanceof Error ? err.message : String(err),
      })
    }) ?? Promise.resolve()

    // Server goes silent if the turn ended; finalize locally so Stop always works.
    const store = useStreamingConversationStore.getState()
    if (store.activeStream) {
      flushStoreUpdateBufferImmediate()
      store.finalizeStream({ finishReason: 'user_stopped' })
    }

    await ack
  }, [])

  const reconnect = useCallback(async (): Promise<void> => {
    const appId = useStreamingConversationStore.getState().currentAppId
    if (!appId) return

    try {
      dynamicApiConfigService.clearCache(appId)

      const store = useStreamingConversationStore.getState()
      store.clearMessages()
      store.setHistoryLoadingComplete(false)
      store.setHistoryLoadRequested(false)

      if (transportRef.current) {
        transportRef.current.destroy()
        transportRef.current = null
        setTransport(null)
      }
      if (provisioningRetryRef.current.timer) clearTimeout(provisioningRetryRef.current.timer)
      provisioningRetryRef.current = { count: 0, timer: null }
    } catch (err) {
      logger.error('sse.reconnect.failed', { appId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setReconnectNonce((n) => n + 1)
    }
  }, [])

  const loadMore = useCallback((params?: { cursor?: string; limit?: number }): boolean => {
    const t = transportRef.current
    const store = useStreamingConversationStore.getState()
    const appId = store.currentAppId
    if (!t || !appId) return false

    // Pre-check that a conversation is actually known before paginating;
    // the transport will silently no-op otherwise.
    if (!getConversationIdFromCookie(appId)) return false

    if (params?.cursor) {
      store.setHistoryLoadingMore(true)
    } else {
      if (store.historyLoadingComplete || store.historyLoadRequested) return false
      store.setHistoryLoadRequested(true)
    }

    t.loadHistory({
      cursor: params?.cursor,
      limit: params?.limit,
    })

    return true
  }, [])

  const { status } = deriveConnectionState(transportState)

  return {
    actions: {
      send: sendMessage,
      stop,
      // No-op: there is no socket-backed background logo job to cancel on the
      // SSE transport. Kept on the useChatTransport() return shape for consumers.
      cancelLogo: async (_jobId?: string): Promise<void> => {},
      loadHistory: loadMore,
      reconnect,
    },
    connection: {
      isConnected,
      status,
      error: connectionError,
    },
    stream: {
      isStreaming: transportState === 'streaming',
    },
  }
}

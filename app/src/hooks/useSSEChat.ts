import { useCallback, useEffect, useRef, useState } from 'react'
import { getMessageOriginForAuthType } from '@airo/shared/auth'

import { useAuthContext } from '@/components/providers/AuthProvider'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import {
  getConversationIdFromCookie,
  setConversationIdCookie,
} from '@/hooks/websocket/useWebSocketHelpers'
import { agentFetch, getAgentToken } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { SSETransport } from '@/services/transport/SSETransport'
import type { TransportState } from '@/services/transport/types'
import {
  bufferStoreUpdate,
  bufferTextChunk,
  clearStoreUpdateBuffer,
  flushStoreUpdateBufferImmediate,
} from '@/services/websocket/storeUpdateBuffer'
import {
  clearToolDeltaBuffer,
  scheduleToolDeltaFlush,
} from '@/services/websocket/toolDeltaBuffer'
import { useSitesStore } from '@/stores/useSitesStore'
import {
  type StreamingMessage,
  useCurrentAppId,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import type { StructuredError } from '@/types/errors'
import { logImpressionEvent } from '@/utils/instrumentation'
import { resolveMessageDefaults } from './resolveMessageDefaults'
import {
  checkNewPageCreation,
  handleCommitComplete,
  incrementSessionPromptCount,
  invalidateMediaManifestIfNeeded,
  maybeFireEvalSnapshot,
  maybeShowFeedbackBanner,
  scheduleUsageRefresh,
  trackCompletion,
  trackError,
  trackInitialBuildComplete,
  trackStepStart,
  trackToolResult,
  updateSiteTimestamp,
} from './shared/completionSideEffects'
import { mapToolCall, mapToolResult, mapToolStart } from './shared/toolMappers'
import { handleToolCallSideEffects, handleToolResultSideEffects } from './shared/toolSideEffects'
import { buildValidationToolCallFromEvent } from './shared/validationToolCallBuilder'
import type { SendMessageOptions } from './useStreamingWebSocket'
import { useBudgetUpdate } from './websocket/useBudgetUpdate'
import { useGrantContext } from './websocket/useGrantContext'

type ConnectionStatus = 'idle' | 'connecting' | 'authenticating' | 'streaming' | 'completing' | 'error'

const STREAM_UPDATE_EVENTS = new Set([
  'chunk',
  'tool_start',
  'tool_input_delta',
  'tool_call',
])

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
  const appIdRef = useRef<string | null>(null)
  const historyBatchRef = useRef<{ messages: unknown[]; isPagination: boolean } | null>(null)
  const historyBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayCompletesStreamRef = useRef(false)

  const currentAppId = useCurrentAppId()
  const { tokenAuthType } = useAuthContext()

  const subscriptionId = useSitesStore((state) => {
    if (!currentAppId) return undefined
    return state.getSite(currentAppId)?.subscription_id
  })

  const isBudgetServiceEnabled = useSwitchboard('app-builder-budget-service') ?? false

  const subscriptionIdRef = useRef(subscriptionId)
  subscriptionIdRef.current = subscriptionId

  const isBudgetServiceEnabledRef = useRef(isBudgetServiceEnabled)
  isBudgetServiceEnabledRef.current = isBudgetServiceEnabled

  const tokenAuthTypeRef = useRef(tokenAuthType)
  tokenAuthTypeRef.current = tokenAuthType

  const [transportState, setTransportState] = useState<TransportState>('disconnected')
  const [connectionError, setConnectionError] = useState<unknown>(undefined)

  // Track last sendMessage options + APP_NOT_FOUND retry state. Mirrors the
  // WS ErrorHandler retry loop: APP_NOT_FOUND is common during app
  // provisioning and should not surface as a terminal error for ~30s.
  const lastSendOptionsRef = useRef<SendMessageOptions | null>(null)
  const appNotFoundRetryRef = useRef<{ startTime: number; count: number; timer: ReturnType<typeof setTimeout> | null }>({
    startTime: 0, count: 0, timer: null,
  })
  const clearAppNotFoundRetry = useCallback(() => {
    if (appNotFoundRetryRef.current.timer) {
      clearTimeout(appNotFoundRetryRef.current.timer)
    }
    appNotFoundRetryRef.current = { startTime: 0, count: 0, timer: null }
  }, [])

  const isConnected = transportState === 'connected' || transportState === 'streaming'

  // Grant context synchronization with agent
  // Internally checks BMS flag - disabled when BMS handles cost tracking
  useGrantContext({
    controller: transport,
    subscriptionId,
    isConnected,
    enabled,
  })

  useBudgetUpdate({
    controller: transport,
    subscriptionId,
    enabled,
  })


  useEffect(() => {
    const store = useStreamingConversationStore.getState()
    const { connected, status } = deriveConnectionState(transportState)
    const current = store.websocket
    if (current?.connected !== connected || current?.status !== status) {
      store.setWebSocketState({ connected, status })
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

  const requestInitialHistoryLoad = useCallback((conversationId: string | null): boolean => {
    const store = useStreamingConversationStore.getState()

    if (!conversationId) {
      if (!store.historyLoadingComplete) {
        store.setHistoryLoadingComplete(true)
      }
      return false
    }

    if (store.historyLoadingComplete || store.historyLoadRequested) return false

    const transport = transportRef.current
    if (!transport) return false

    store.setHistoryLoadRequested(true)
    logger.info('sse.history.load', { appId: currentAppId, conversationId })
    transport.loadHistory()
    return true
  }, [currentAppId])

  // Connect/reconnect when appId changes
  useEffect(() => {
    if (!enabled || !currentAppId) return

    let cancelled = false

    async function connect() {
      try {
        const [config, token] = await Promise.all([
          dynamicApiConfigService.getConfigForSite(currentAppId!),
          getAgentToken(currentAppId!),
        ])

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

          transportRef.current.destroy()
          transportRef.current = null
          setTransport(null)
        }

        if (!transportRef.current) {
          const newTransport = new SSETransport({ baseUrl: config.baseUrl })
          transportRef.current = newTransport
          setTransport(newTransport)

          newTransport.on({
            onEvent(event) {
              const store = useStreamingConversationStore.getState()
              const type = event.type
              if (STREAM_UPDATE_EVENTS.has(type)) {
                ensureSSEActiveStream(type, event.conversationId)
              }

              if (type === 'server_config') {
                useStreamingConversationStore.setState({
                  serverCapabilities: {
                    supportsWebSocketHistory: (event.data as any)?.supportsWebSocketHistory === true,
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
                const agentNameRaw = (event.data as any)?.agentName
                if (agentNameRaw) store.setCurrentAgentName(String(agentNameRaw))
                if (store.connectionRetry.isRetrying) store.clearConnectionRetry()
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
                if (tool) bufferStoreUpdate(() => store.addToolStartSegment(mapToolStart(tool)))
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
                  handleToolCallSideEffects(tool)
                }
              } else if (type === 'tool_result') {
                const tool = (event.data as any)?.tool ?? (event.data as any)?.data?.tool
                if (tool) {
                  flushStoreUpdateBufferImmediate()
                  trackToolResult(tool.name)
                  bufferStoreUpdate(() => store.addToolResultSegment(mapToolResult(tool)))
                  handleToolResultSideEffects(tool, store.currentAppId).catch(err => {
                    logger.warn('sse.tool_result.side_effects_failed', {
                      appId: store.currentAppId, toolName: tool?.name,
                      error: err instanceof Error ? err.message : String(err),
                    })
                  })
                }
              } else if (type === 'validation_message') {
                const { toolCall, isTerminal } = buildValidationToolCallFromEvent(event.data, event.content)
                flushStoreUpdateBufferImmediate()
                bufferStoreUpdate(() => store.addToolStartSegment(toolCall))
                if (isTerminal) {
                  bufferStoreUpdate(() => store.addToolResultSegment(toolCall))
                }
              } else if (type === 'complete') {
                flushStoreUpdateBufferImmediate()
                store.finalizeStream(event.data)

                const completeData = event.data as any
                const commitHash = typeof completeData?.commitHash === 'string' && completeData.commitHash.length > 0
                  ? completeData.commitHash : undefined
                const activeAppId = store.currentAppId

                incrementSessionPromptCount(activeAppId)
                maybeShowFeedbackBanner()
                trackCompletion(!!completeData?.usage)
                trackInitialBuildComplete(commitHash)

                if (activeAppId) {
                  invalidateMediaManifestIfNeeded(activeAppId)

                  if (commitHash) {
                    handleCommitComplete(commitHash, activeAppId).catch(err => {
                      logger.warn('sse.complete.handle_commit_failed', {
                        appId: activeAppId, commitHash,
                        error: err instanceof Error ? err.message : String(err),
                      })
                    })
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
                  logImpressionEvent('credits.budget.exceeded')()
                  store.markBudgetExceeded()
                  store.finalizeStream()
                  trackError('BUDGET_EXCEEDED')
                  return
                }

                // APP_NOT_FOUND is common during app provisioning — retry the
                // last sendMessage with exponential backoff up to ~30s, like
                // the WS ErrorHandler does, before surfacing as a hard error.
                if (errorType === 'APP_NOT_FOUND' && lastSendOptionsRef.current) {
                  const retry = appNotFoundRetryRef.current
                  if (retry.startTime === 0) retry.startTime = Date.now()
                  const elapsed = Date.now() - retry.startTime
                  if (elapsed < 30_000) {
                    retry.count += 1
                    const delay = Math.min(500 * Math.pow(2, retry.count - 1), 5_000)
                    logger.warn('sse.error.app_not_found.retry', {
                      appId: currentAppId, retryCount: retry.count, delay, elapsed,
                    })
                    const pending = lastSendOptionsRef.current
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
                      transport.sendMessage({
                        content: pending.content,
                        sessionId: currentAppId ?? 'unknown',
                        templateId: pending.templateId,
                        modelOverride: pending.modelOverride,
                        agentProfile: pending.agentProfile,
                        visualContext: pending.visualContext,
                        aiEditContext: pending.aiEditContext,
                        selectedAssets: pending.selectedAssets,
                        todoListContext: pending.todoListContext,
                        isActionRequest: pending.isActionRequest,
                        customContext: pending.customContext,
                        budgetServiceEnabled: isBudgetServiceEnabledRef.current || undefined,
                        subscriptionId: subscriptionIdRef.current,
                        buildErrorContext: undefined,
                      }).catch(err => {
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
                  message: errMsg,
                  type: (errorType as StructuredError['type']) ?? 'UPSTREAM_ERROR',
                  statusCode: errData?.statusCode,
                  timestamp: errData?.timestamp,
                }
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
                  return
                }

                store.setHistoryPagination({
                  hasMore: typeof (event.data as any)?.hasMore === 'boolean' ? (event.data as any).hasMore : false,
                  nextCursor: (event.data as any)?.nextCursor ?? null,
                })
                store.setHistoryLoadingComplete(true)

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

                import('@/hooks/websocket/actions').then(async ({ clientActionExecutors }) => {
                  const executor = clientActionExecutors[action]
                  if (!executor) {
                    postActionResult({
                      requestId, success: false, error: `Unknown action: ${action}`,
                    })
                    return
                  }

                  const minimalContext = { currentAppId } as any
                  try {
                    const result = await executor(params ?? {}, minimalContext)
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
                const videoData = event.data as any
                const videoAppId = videoData?.appId ?? store.currentAppId
                if (videoAppId) {
                  import('@/stores/useDevelopPageStore').then(({ useDevelopPageStore }) => {
                    if (videoData?.status === 'completed' && videoData?.videoUrl) {
                      useDevelopPageStore.getState().setLaunchVideoResult(videoAppId, { type: 'success', url: videoData.videoUrl })
                    } else if (videoData?.status === 'failed') {
                      useDevelopPageStore.getState().setLaunchVideoResult(videoAppId, { type: 'error', message: videoData?.error ?? 'Video generation failed' })
                    }
                  }).catch(err => {
                    // Covers chunk-load failures AND any throw from inside
                    // the .then (store teardown, future additions). Log so
                    // "video result never rendered" is diagnosable.
                    logger.warn('sse.video.store_update_failed', {
                      appId: videoAppId, status: videoData?.status,
                      error: err instanceof Error ? err.message : String(err),
                    })
                  })
                }
              } else if (type === 'recovery_status') {
                const payload = event.data as any
                replayCompletesStreamRef.current = false
                if (payload?.streamCompleted && !payload?.hasBufferedEvents) {
                  if (store.activeStream) {
                    store.clearActiveStream()
                  }
                  if (store.connectionRetry.isRetrying) {
                    store.clearConnectionRetry()
                  }
                  // Force history reload to pick up the completed turn.
                  if (transportRef.current) {
                    store.setHistoryLoadRequested(false)
                    transportRef.current.loadHistory()
                  }
                } else if (payload?.hasBufferedEvents) {
                  ensureSSEActiveStream('recovery_status', payload?.conversationId)
                  replayCompletesStreamRef.current = payload?.streamCompleted === true
                  // Route through the transport state pipe (setTransportState
                  // → deriveConnectionState → useEffect → setWebSocketState)
                  // rather than mutating the store directly from the event
                  // handler, per app/CLAUDE.md lifecycle rules.
                  setTransportState('streaming')
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
              } else if (type === 'replay_complete') {
                // Flush any buffered store updates from replayed events
                flushStoreUpdateBufferImmediate()
                if (replayCompletesStreamRef.current) {
                  store.finalizeStream()
                  setTransportState('connected')
                  replayCompletesStreamRef.current = false
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
                  // Clear pagination so stale hasMore/nextCursor from a prior
                  // page don't trigger further load attempts after a failure.
                  store.setHistoryPagination({ hasMore: false, nextCursor: null })
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
              // Release the UI: a terminal transport error means no `complete`
              // or `error` event will arrive to finalize the stream, so the
              // input stays disabled forever otherwise.
              const store = useStreamingConversationStore.getState()
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
        // re-roll that logic for this POST.
        let conversationId = getConversationIdFromCookie(currentAppId!)
        if (!conversationId) {
          const createRes = await agentFetch(`${config.baseUrl}/api/conversations/${currentAppId!}`, {
            siteId: currentAppId!,
            method: 'POST',
          })
          if (!createRes.ok) throw new Error(`Failed to create conversation: ${createRes.status}`)
          const createData = await createRes.json()
          conversationId = createData.conversationId as string
          setConversationIdCookie(currentAppId!, conversationId)
        }
        if (cancelled) return

        transportRef.current.connect(currentAppId!, token, conversationId)
        // SSE history is fetched over HTTP, not through /stream. Start it as
        // soon as the conversation is known so a broken EventSource endpoint
        // does not leave the chat transcript empty or stuck behind stream
        // initialization.
        void requestInitialHistoryLoad(conversationId)
      } catch (err) {
        if (!cancelled) {
          logger.error('sse.connect.failed', {
            appId: currentAppId,
            error: err instanceof Error ? err.message : String(err),
          })
          setConnectionError(err)
        }
      }
    }

    void connect()

    return () => {
      cancelled = true
      transportRef.current?.disconnect()
    }
  }, [enabled, currentAppId, flushHistoryBatch, requestInitialHistoryLoad])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      transportRef.current?.destroy()
      transportRef.current = null
      if (historyBatchTimerRef.current) {
        clearTimeout(historyBatchTimerRef.current)
        historyBatchTimerRef.current = null
      }
      historyBatchRef.current = null
      clearAppNotFoundRetry()
    }
  }, [clearAppNotFoundRetry])

  const sendMessage = useCallback(async (options: SendMessageOptions) => {
    const t = transportRef.current
    const activeAppId = useStreamingConversationStore.getState().currentAppId

    if (!t) {
      logger.error('sse.send_message.no_transport', { appId: activeAppId })
      return
    }

    const hasText = Boolean(options.content?.trim())
    const hasReferencedFiles = (options.customContext?.referencedFiles?.length ?? 0) > 0
    const hasSelectedAssets = (options.selectedAssets?.length ?? 0) > 0
    if (!hasText && !hasReferencedFiles && !hasSelectedAssets) return

    if (!activeAppId) {
      logger.error('sse.send_message.no_app_id', {})
      return
    }

    const store = useStreamingConversationStore.getState()
    store.setIsLoading(true)
    const referencedFiles = options.customContext?.referencedFiles as Array<{ path: string; content: string }> | undefined
    const origin = getMessageOriginForAuthType(tokenAuthTypeRef.current)
    store.startNewStream(options.content, options.selectedAssets, referencedFiles, origin)

    // Cache the options for APP_NOT_FOUND retry. Reset any prior retry state
    // so a new user prompt starts with a clean 30-second window.
    lastSendOptionsRef.current = options
    clearAppNotFoundRetry()

    try {
      const defaults = await resolveMessageDefaults({
        modelOverride: options.modelOverride,
        agentProfile: options.agentProfile,
        visualContext: options.visualContext,
      })

      await t.sendMessage({
        content: options.content,
        sessionId: activeAppId,
        templateId: options.templateId,
        modelOverride: defaults.modelOverride,
        agentProfile: defaults.agentProfile,
        visualContext: defaults.visualContext,
        aiEditContext: options.aiEditContext,
        selectedAssets: options.selectedAssets,
        todoListContext: options.todoListContext,
        isActionRequest: options.isActionRequest,
        customContext: options.customContext,
        budgetServiceEnabled: isBudgetServiceEnabledRef.current || undefined,
        subscriptionId: subscriptionIdRef.current,
        buildErrorContext: store.buildErrorContext,
      })
    } catch (err) {
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
      s.markUpstreamError({ message: err instanceof Error ? err.message : 'Send failed', type: 'UPSTREAM_ERROR' })
      s.finalizeStream()
    }
  }, [])

  const stop = useCallback(() => {
    transportRef.current?.stopGeneration().catch(err => {
      const appId = useStreamingConversationStore.getState().currentAppId
      logger.warn('sse.stop.failed', {
        appId, error: err instanceof Error ? err.message : String(err),
      })
    })

    // Server goes silent if the turn ended; finalize locally so Stop always works.
    const store = useStreamingConversationStore.getState()
    if (store.activeStream) {
      flushStoreUpdateBufferImmediate()
      store.finalizeStream({ finishReason: 'user_stopped' })
    }
  }, [])

  const reconnect = useCallback(async (): Promise<void> => {
    const t = transportRef.current
    const appId = useStreamingConversationStore.getState().currentAppId
    if (!t || !appId) return
    const conversationId = getConversationIdFromCookie(appId)
    if (!conversationId) return
    try {
      const token = await getAgentToken(appId)
      t.disconnect()
      t.connect(appId, token, conversationId)
    } catch (err) {
      logger.error('sse.reconnect.failed', { appId, error: err instanceof Error ? err.message : String(err) })
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

/**
 * Selector hooks for the streaming-first conversation store.
 * Extracted from useStreamingConversationStore.ts; re-exported from there to
 * preserve the public import surface.
 */

import { useStreamingConversationStore } from './useStreamingConversationStore'
import type { StreamingConversationState } from './useStreamingConversationStore.types'

// === SELECTORS ===

export const useMessages = () => useStreamingConversationStore(state => state.messages)
export const useActiveStream = () => useStreamingConversationStore(state => state.activeStream)

// Simple approach: remove the problematic combined selector
// Components should use useMessages and useActiveStream separately and combine with useMemo
export const useStreamingState = () => useStreamingConversationStore(state => state.streamingState)

// Memoized selector for streaming check
const isActivelyStreamingSelector = (state: StreamingConversationState) =>
  state.streamingState === 'streaming' && !!state.activeStream

export const useIsActivelyStreaming = () => useStreamingConversationStore(isActivelyStreamingSelector)

const activeRunningToolNameSelector = (state: StreamingConversationState): string | null => {
  const tools = state.activeStream?.toolCalls
  if (!tools?.length) return null
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i]!.status === 'running') return tools[i]!.name
  }
  return null
}

export const useActiveRunningToolName = () => useStreamingConversationStore(activeRunningToolNameSelector)

// Count of jobs the active running tool is awaiting — 0 unless the last running
// tool is `awaitAgents`. Returns a primitive so the selector stays referentially
// stable across unrelated store updates.
const activeAwaitAgentsCountSelector = (state: StreamingConversationState): number => {
  const tools = state.activeStream?.toolCalls
  if (!tools?.length) return 0
  for (let i = tools.length - 1; i >= 0; i--) {
    const tc = tools[i]!
    if (tc.status !== 'running') continue
    if (tc.name !== 'awaitAgents') return 0
    const jobIds = (tc.input as { jobIds?: unknown }).jobIds
    return Array.isArray(jobIds) ? jobIds.length : 0
  }
  return 0
}

export const useActiveAwaitAgentsCount = () => useStreamingConversationStore(activeAwaitAgentsCountSelector)

/**
 * Token/step usage carried on a persisted `awaitAgents` result. Mirrors the
 * backend result envelope's `usage` shape (agents `SubAgentUsage`); re-declared
 * here because the app does not depend on the agents package.
 */
export interface AwaitedJobUsage {
  modelName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  steps: number
}

/** A single job's outcome as carried in a persisted `awaitAgents` tool result. */
export interface AwaitedJobResult {
  jobId: string
  agent?: string
  title?: string
  status: 'queued' | 'running' | 'success' | 'error' | 'aborted' | 'timeout'
  summary?: string
  artifacts?: string[]
  usage?: AwaitedJobUsage
  durationMs?: number
  error?: string
}

function indexAwaitedJobs(
  map: Map<string, AwaitedJobResult>,
  toolCalls: ReadonlyArray<{ name: string; result?: Record<string, unknown> | string }> | undefined,
): void {
  if (!toolCalls) return
  for (const tc of toolCalls) {
    if (tc.name !== 'awaitAgents') continue
    const res = tc.result
    if (!res || typeof res !== 'object') continue
    const results = (res as { results?: AwaitedJobResult[] }).results
    if (!results) continue
    for (const r of results) map.set(r.jobId, r) // later/active wins
  }
}

// jobId → AwaitedJobResult index, memoized by the messages/activeStream refs so
// the O(messages × toolCalls) scan runs once per store change and is shared by
// every mounted runAgent card (O(1) lookup each), rather than re-scanning per card.
let cachedAwaitedIndex: {
  messages: StreamingConversationState['messages']
  activeStream: StreamingConversationState['activeStream']
  map: Map<string, AwaitedJobResult>
} | null = null

function getAwaitedJobIndex(state: StreamingConversationState): Map<string, AwaitedJobResult> {
  if (
    cachedAwaitedIndex &&
    cachedAwaitedIndex.messages === state.messages &&
    cachedAwaitedIndex.activeStream === state.activeStream
  ) {
    return cachedAwaitedIndex.map
  }
  const map = new Map<string, AwaitedJobResult>()
  // Oldest → newest, active stream last, so the most recent result wins.
  for (const msg of state.messages) indexAwaitedJobs(map, msg.toolCalls)
  indexAwaitedJobs(map, state.activeStream?.toolCalls)
  cachedAwaitedIndex = { messages: state.messages, activeStream: state.activeStream, map }
  return map
}

// Durable terminal status for a runAgent card after its live events are gone
// (e.g. page reload): look up the persisted awaitAgents result for this jobId.
// Returns the JobResult object reference (stable across renders), so the selector
// is referentially safe.
const awaitedJobResultSelector = (jobId: string | undefined) =>
  (state: StreamingConversationState): AwaitedJobResult | undefined =>
    jobId ? getAwaitedJobIndex(state).get(jobId) : undefined

export const useAwaitedJobResult = (jobId: string | undefined) =>
  useStreamingConversationStore(awaitedJobResultSelector(jobId))
export const useInterimStatus = () => useStreamingConversationStore(state => state.interimStatus)
export const useInputValue = () => useStreamingConversationStore(state => state.inputValue)
export const useIsLoading = () => useStreamingConversationStore(state => state.isLoading)
export const useCurrentAppId = () => useStreamingConversationStore(state => state.currentAppId)
export const useConnectionState = () => useStreamingConversationStore(state => state.connection)

// Individual action selectors to prevent infinite loops
export const useStartNewStream = () => useStreamingConversationStore(state => state.startNewStream)
export const useAppendTextSegment = () => useStreamingConversationStore(state => state.appendTextSegment)
export const useAddToolStartSegment = () => useStreamingConversationStore(state => state.addToolStartSegment)
export const useAddToolCallSegment = () => useStreamingConversationStore(state => state.addToolCallSegment)
export const useAddToolResultSegment = () => useStreamingConversationStore(state => state.addToolResultSegment)
export const useMarkMaxStepsReached = () => useStreamingConversationStore(state => state.markMaxStepsReached)
export const useMarkUpstreamError = () => useStreamingConversationStore(state => state.markUpstreamError)
export const useMarkBudgetExceeded = () => useStreamingConversationStore(state => state.markBudgetExceeded)

// Derived selector: check if the most recent message or active stream has budgetExceeded
const hasBudgetExceededSelector = (state: StreamingConversationState) => {
  if (state.activeStream?.budgetExceeded) return true
  const lastMessage = state.messages[state.messages.length - 1]
  return lastMessage?.budgetExceeded === true
}

export const useBudgetExceeded = () => useStreamingConversationStore(hasBudgetExceededSelector)
export const useFinalizeStream = () => useStreamingConversationStore(state => state.finalizeStream)
export const useAutoSendInitialMessage = () => useStreamingConversationStore(state => state.autoSendInitialMessage)

export const useSetCurrentAppId = () => useStreamingConversationStore(state => state.setCurrentAppId)
export const useSetInputValue = () => useStreamingConversationStore(state => state.setInputValue)
export const useSetIsLoading = () => useStreamingConversationStore(state => state.setIsLoading)
export const useSetAiEditContext = () => useStreamingConversationStore(state => state.setAiEditContext)
export const useSetBuildErrorContext = () => useStreamingConversationStore(state => state.setBuildErrorContext)
export const useSetDevelopmentPlan = () => useStreamingConversationStore(state => state.setDevelopmentPlan)

export const useSetStreamingState = () => useStreamingConversationStore(state => state.setStreamingState)

// History loading selectors
export const useHistoryLoadingComplete = () => useStreamingConversationStore(state => state.historyLoadingComplete)
export const useSetHistoryLoadingComplete = () => useStreamingConversationStore(state => state.setHistoryLoadingComplete)

// Queue selectors
export const useQueuedMessages = () => useStreamingConversationStore(state => state.queuedMessages)
export const useIsQueueStoppedOnError = () => useStreamingConversationStore(state => state.queueStoppedOnError)
export const useQueueLength = () => useStreamingConversationStore(state => state.queuedMessages.length)

export const useDevelopmentPlan = () => useStreamingConversationStore(state => state.developmentPlan)
export const useAiEditContext = () => useStreamingConversationStore(state => state.aiEditContext)
export const useAiEditContexts = () => useStreamingConversationStore(state => state.aiEditContexts)
export const useAddAiEditContext = () => useStreamingConversationStore(state => state.addAiEditContext)
export const useRemoveAiEditContext = () => useStreamingConversationStore(state => state.removeAiEditContext)
export const useClearAiEditContexts = () => useStreamingConversationStore(state => state.clearAiEditContexts)
export const useBuildErrorContext = () => useStreamingConversationStore(state => state.buildErrorContext)
export const useCurrentAgentName = () => useStreamingConversationStore(state => state.currentAgentName)

// Latest pinned-skill name surfaced from server metadata. Walks newest →
// oldest assistant messages and returns the first message's pinnedSkill.
// Empty string is treated as "no pin" so an explicit unpin (server emits
// '') propagates. Returns undefined when no assistant message has spoken
// to the question yet — caller treats that as "unknown, render default".
export const useLatestPinnedSkill = (): string | undefined =>
  useStreamingConversationStore(state => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i]
      if (m.role !== 'assistant') continue
      const v = m.metadata?.pinnedSkill
      if (typeof v === 'string') return v
    }
    return undefined
  })

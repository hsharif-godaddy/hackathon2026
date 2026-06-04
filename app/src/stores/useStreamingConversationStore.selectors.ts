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
export const useInputValue = () => useStreamingConversationStore(state => state.inputValue)
export const useIsLoading = () => useStreamingConversationStore(state => state.isLoading)
export const useCurrentAppId = () => useStreamingConversationStore(state => state.currentAppId)
export const useWebSocketState = () => useStreamingConversationStore(state => state.websocket)

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
export const useSetAgentCatalog = () => useStreamingConversationStore(state => state.setAgentCatalog)
export const useSetDevelopmentPlan = () => useStreamingConversationStore(state => state.setDevelopmentPlan)

export const useSetWebSocketState = () => useStreamingConversationStore(state => state.setWebSocketState)
export const useSetStreamingState = () => useStreamingConversationStore(state => state.setStreamingState)

// History loading selectors
export const useHistoryLoadingComplete = () => useStreamingConversationStore(state => state.historyLoadingComplete)
export const useSetHistoryLoadingComplete = () => useStreamingConversationStore(state => state.setHistoryLoadingComplete)

// Connection retry selectors
export const useConnectionRetry = () => useStreamingConversationStore(state => state.connectionRetry)
export const useStartConnectionRetry = () => useStreamingConversationStore(state => state.startConnectionRetry)
export const useSetEscalationTimeout = () => useStreamingConversationStore(state => state.setEscalationTimeout)
export const useClearConnectionRetry = () => useStreamingConversationStore(state => state.clearConnectionRetry)
export const useCheckStaleRetry = () => useStreamingConversationStore(state => state.checkStaleRetry)

export const useDevelopmentPlan = () => useStreamingConversationStore(state => state.developmentPlan)
export const useAiEditContext = () => useStreamingConversationStore(state => state.aiEditContext)
export const useAiEditContexts = () => useStreamingConversationStore(state => state.aiEditContexts)
export const useAddAiEditContext = () => useStreamingConversationStore(state => state.addAiEditContext)
export const useRemoveAiEditContext = () => useStreamingConversationStore(state => state.removeAiEditContext)
export const useClearAiEditContexts = () => useStreamingConversationStore(state => state.clearAiEditContexts)
export const useBuildErrorContext = () => useStreamingConversationStore(state => state.buildErrorContext)
export const useAvailableAgents = () => useStreamingConversationStore(state => state.availableAgents)
export const useDefaultAgentId = () => useStreamingConversationStore(state => state.defaultAgentId)
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

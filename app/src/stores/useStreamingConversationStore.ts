/**
 * Streaming-First Conversation Store
 *
 * Clean architecture designed for real-time AI streaming responses.
 * No backward compatibility - built for streaming from the ground up.
 */

import { create } from 'zustand'
import type { MessageOrigin } from '@airo/shared/auth'

import {
  batchSecretKey,
  secretKeyFor,
} from '@/app/[market]/develop/components/chat/secrets/keys'
import {
  loadResolvedSecretsComposerToolCallIds,
  mergeResolvedSecretsComposerToolCallIds,
  saveResolvedSecretsComposerToolCallIds,
} from '@/app/[market]/develop/components/chat/secrets/resolvedSecretsComposerStorage'
import type { AiEditContext } from '@/app/[market]/develop/components/types'
import { logger } from '@/lib/request-context'
import type { StructuredError } from '@/types/errors'
import { generateId, mergeToolCallData, normalizeConversationMessages } from './conversation-normalization'
import type {
  ChatMessage,
  StreamingConversationState,
  StreamingMessage,
  StreamSegment,
  ToolCall,
} from './useStreamingConversationStore.types'

// Re-export all store types to preserve the public import surface.
export type {
  AgentSummary,
  AppChatHistoryEntry,
  ChatMessage,
  ConnectionRetryState,
  Conversation,
  PlanItem,
  RecoveryState,
  RetryState,
  ServerCapabilities,
  StreamingConversationState,
  StreamingMessage,
  StreamSegment,
  ToolCall,
  ToolStatus,
  WebSocketState,
} from './useStreamingConversationStore.types'

// Pure conversation-normalization helpers live in ./conversation-normalization.
// Re-export the public ones to preserve the import surface.
export { mergeToolCallData, normalizeConversationMessages }

// Create the store
export const useStreamingConversationStore = create<StreamingConversationState>()((set, get) => ({
  // === INITIAL STATE ===

  messages: [],
  activeStream: null,
  streamingState: 'idle',
  currentStep: 0,
  currentAppId: null,
  inputValue: '',
  isLoading: false,
  aiEditContext: null,
  aiEditContexts: [],
  buildErrorContext: null,
  availableAgents: [],
  defaultAgentId: null,
  currentAgentName: null,
  developmentPlan: [],
  appChatHistory: {},
  websocket: {
    connected: false,
    status: 'idle'
  },
  connectionRetry: {
    isRetrying: false,
    retryStartedAt: null,
    wasStreamingOnDisconnect: false,
    disconnectSocketId: null,
    escalationTimeoutId: null
  },
  recoveryState: {
    isRecovering: false,
    expectedEvents: 0,
    receivedEvents: 0
  },
  retryState: {
    isRetrying: false,
    retryCount: 0
  },
  lastError: null,
  historyLoadRequested: false,
  historyLoadingComplete: false,
  historyHasMore: true, // Assume there might be more until we know
  historyNextCursor: null,
  historyLoadingMore: false,
  serverCapabilities: null,
  resolvedSecretsComposerToolCallIds: {},
  subagentEvents: {},

  // === CORE STREAMING ACTIONS ===

  startNewStream: (
    userMessage: string,
    selectedAssets?: any[],
    referencedFiles?: Array<{ path: string; content: string }>,
    origin?: MessageOrigin,
    uploadedFileName?: string,
    userMessageMetadata?: ChatMessage['metadata'],
  ) => {
    const userMsgId = generateId()
    const assistantMsgId = generateId()

    if (process.env.NODE_ENV === 'development') {
      logger.debug('streaming-store.start-stream', { userMessage, userMsgId, assistantMsgId, hasAssets: !!selectedAssets?.length, hasReferencedFiles: !!referencedFiles?.length })
    }

    // Add user message to completed messages
    const userChatMessage: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      ...(selectedAssets && selectedAssets.length > 0 && { selectedAssets }),
      ...(referencedFiles && referencedFiles.length > 0 && { referencedFiles }),
      ...(uploadedFileName && { uploadedFileName }),
      ...(origin && { origin }),
      ...(userMessageMetadata && { metadata: userMessageMetadata }),
    }

    // Create new streaming message for assistant
    const streamingMessage: StreamingMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      segments: [],
      toolCalls: [],
      timestamp: new Date(),
      isComplete: false,
      ...(origin && { origin })
    }

    set((state) => ({
      messages: [...state.messages, userChatMessage],
      activeStream: streamingMessage,
      streamingState: 'streaming',
      currentStep: 1,
      inputValue: '', // Clear input
      isLoading: true,
      subagentEvents: {},
    }))
  },

  addSubagentEvent: (toolId: string, event: { event: string; agent: string; detail: string }) => {
    const current = get().subagentEvents
    const existing = current[toolId] ?? []
    set({ subagentEvents: { ...current, [toolId]: [...existing, event] } })
  },

  clearSubagentEvents: () => {
    set({ subagentEvents: {} })
  },

  appendToStream: (content: string) => {
    const { activeStream } = get()
    if (!activeStream) return

    const updatedStream = {
      ...activeStream,
      content: activeStream.content + content
    }

    set({ activeStream: updatedStream })
  },

  updateStreamContent: (content: string) => {
    const { activeStream } = get()
    if (!activeStream) return

    set({
      activeStream: {
        ...activeStream,
        content: content
      }
    })
  },

  appendTextSegment: (content: string) => {
    const { activeStream } = get()
    if (!activeStream) return

    const segment: StreamSegment = {
      id: generateId(),
      type: 'text',
      content,
      timestamp: new Date()
    }

    const updatedStream = {
      ...activeStream,
      content: activeStream.content + content,
      segments: [...activeStream.segments, segment]
    }


    set({ activeStream: updatedStream })
  },

  addToolToStream: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return

    const updatedStream = {
      ...activeStream,
      toolCalls: [...activeStream.toolCalls, toolCall]
    }

    set({ activeStream: updatedStream })
  },

  addToolStartSegment: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return

    logger.debug('streaming-store.tool.start', {
      toolId: toolCall.id,
      toolName: toolCall.name
    })

    // Check if tool already exists (created early by a tool_input_delta that arrived before this tool_start)
    const existingTool = activeStream.toolCalls.find(tc => tc.id === toolCall.id)

    if (existingTool) {
      const updatedToolCalls = activeStream.toolCalls.map(tc =>
        tc.id === toolCall.id ? { ...tc, ...toolCall } : tc
      )

      const hasSegment = activeStream.segments.some(
        s => (s.type === 'tool_start' || s.type === 'tool_call') && s.toolCall?.id === toolCall.id
      )

      if (hasSegment) {
        // Segment already exists — update in place
        const updatedSegments = activeStream.segments.map(segment => {
          if ((segment.type === 'tool_start' || segment.type === 'tool_call') && segment.toolCall?.id === toolCall.id) {
            return {
              ...segment,
              content: `Starting ${toolCall.name}...`,
              toolCall: { ...segment.toolCall, ...toolCall }
            }
          }
          return segment
        })
        set({ activeStream: { ...activeStream, toolCalls: updatedToolCalls, segments: updatedSegments } })
      } else {
        // No segment yet — create one now at the correct position
        const segment: StreamSegment = {
          id: generateId(),
          type: 'tool_start',
          content: `Starting ${toolCall.name}...`,
          timestamp: new Date(),
          toolCall: { ...existingTool, ...toolCall }
        }
        set({ activeStream: { ...activeStream, toolCalls: updatedToolCalls, segments: [...activeStream.segments, segment] } })
      }
    } else {
      const segment: StreamSegment = {
        id: generateId(),
        type: 'tool_start',
        content: `Starting ${toolCall.name}...`,
        timestamp: new Date(),
        toolCall
      }

      set({
        activeStream: {
          ...activeStream,
          segments: [...activeStream.segments, segment],
          toolCalls: [...activeStream.toolCalls, toolCall]
        }
      })
    }
  },

  addToolCallSegment: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return

    // Find and update the existing tool_start segment with the input and name
    const updatedSegments = activeStream.segments.map(segment => {
      if (segment.type === 'tool_start' && segment.toolCall?.id === toolCall.id) {
        const resolvedName = toolCall.name || segment.toolCall.name
        return {
          ...segment,
          content: resolvedName !== segment.toolCall.name ? `Starting ${resolvedName}...` : segment.content,
          toolCall: {
            ...segment.toolCall,
            name: resolvedName,
            input: toolCall.input
          }
        }
      }
      return segment
    })

    // Also update the toolCall in the toolCalls array with the input and name
    const updatedToolCalls = activeStream.toolCalls.map(tc =>
      tc.id === toolCall.id ? { ...tc, name: toolCall.name || tc.name, input: toolCall.input } : tc
    )

    const updatedStream = {
      ...activeStream,
      segments: updatedSegments,
      toolCalls: updatedToolCalls
    }

    set({ activeStream: updatedStream })
  },

  addToolResultSegment: (toolCall: ToolCall) => {
    const { activeStream, messages } = get()

    logger.debug('streaming-store.tool.result', {
      toolId: toolCall.id,
      toolName: toolCall.name,
      status: toolCall.status,
      duration: toolCall.duration
    })

    // Apply to active stream only if it has this tool (otherwise treat as late result from a previous stream)
    if (activeStream?.toolCalls?.some(tc => tc.id === toolCall.id)) {
      const segment: StreamSegment = {
        id: generateId(),
        type: 'tool_result',
        content: typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result),
        timestamp: new Date(),
        toolCall
      }

      set({
        activeStream: {
          ...activeStream,
          segments: [...activeStream.segments, segment],
          toolCalls: activeStream.toolCalls.map(tc =>
            tc.id === toolCall.id ? toolCall : tc
          )
        }
      })
      return
    }

    // Race condition: tool_result arrived after finalizeStream, or belongs to a previous stream.
    // Apply the result to the most recent assistant message that has a matching tool
    // (search back in case last message is not assistant).
    let targetIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.toolCalls?.some(tc => tc.id === toolCall.id)) {
        targetIndex = i
        break
      }
    }
    if (targetIndex < 0) {
      const assistantSummary = messages
        .map((m, i) => m.role === 'assistant' ? { index: i, messageId: m.id, toolIds: m.toolCalls?.map(tc => tc.id) ?? [] } : null)
        .filter(Boolean)
      logger.warn('streaming-store.tool.result.dropped', {
        toolId: toolCall.id,
        toolName: toolCall.name,
        reason: 'no_matching_tool_in_messages',
        assistantMessagesChecked: assistantSummary
      })
      return
    }

    const lastMessage = messages[targetIndex]
    logger.info('streaming-store.tool.result.late_apply', {
      toolId: toolCall.id,
      toolName: toolCall.name,
      messageId: lastMessage.id
    })

    const resultSegment: StreamSegment = {
      id: generateId(),
      type: 'tool_result',
      content: typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result),
      timestamp: new Date(),
      toolCall
    }

    const updatedMessage: ChatMessage = {
      ...lastMessage,
      segments: [...(lastMessage.segments || []), resultSegment],
      toolCalls: lastMessage.toolCalls?.map(tc =>
        tc.id === toolCall.id ? toolCall : tc
      )
    }

    set({
      messages: [...messages.slice(0, targetIndex), updatedMessage, ...messages.slice(targetIndex + 1)]
    })
  },

  markMaxStepsReached: () => {
    const { activeStream } = get()
    if (!activeStream) return

    const updatedStream = {
      ...activeStream,
      maxStepsReached: true
    }

    set({ activeStream: updatedStream })
  },

  markUpstreamError: (error: StructuredError) => {
    const { activeStream, currentAppId } = get()
    if (!activeStream) {
      logger.error('streaming-store.mark-upstream-error.no-active-stream', {
        appId: currentAppId ?? undefined,
        message: 'No active stream to mark as error'
      })
      return
    }

    const updatedStream = {
      ...activeStream,
      upstreamError: true,
      error: error.message,
      errorType: error.type,
      errorCode: error.statusCode,
      ...(error.retryAttempts !== undefined && { retryAttempts: error.retryAttempts }),
      ...(error.retryReason && { retryReason: error.retryReason })
    }

    set({ activeStream: updatedStream })
  },

  markBudgetExceeded: () => {
    const { activeStream } = get();
    if (!activeStream) return;

    const updatedStream = {
      ...activeStream,
      budgetExceeded: true
    }

    set({ activeStream: updatedStream });
  },

  clearStreamForRetry: () => {
    const { activeStream } = get();
    if (!activeStream) return;

    set({
      activeStream: {
        ...activeStream,
        content: '',
        segments: [],
        toolCalls: [],
        budgetExceeded: false,
        upstreamError: undefined,
        error: undefined,
        errorType: undefined,
        errorCode: undefined,
        retryAttempts: undefined,
        retryReason: undefined,
        maxStepsReached: false,
      },
    });
  },

  updateToolInStream: (toolId: string, updates: Partial<ToolCall>) => {
    const { activeStream } = get()
    if (!activeStream) return

    const updatedStream = {
      ...activeStream,
      toolCalls: activeStream.toolCalls.map(tc =>
        tc.id === toolId ? { ...tc, ...updates } : tc
      )
    }

    set({ activeStream: updatedStream })
  },

  updateToolDelta: (toolId: string, toolName: string, delta: string) => {
    const { activeStream } = get()
    if (!activeStream) return

    // Check if tool exists in toolCalls array
    const existingTool = activeStream.toolCalls.find(tc => tc.id === toolId)

    // If toolName is missing/unknown, resolve from the existing toolCall entry
    let resolvedToolName = toolName
    if (existingTool && existingTool.name) {
      resolvedToolName = existingTool.name
    }

    if (!existingTool) {
      const newToolCall: ToolCall = {
        id: toolId,
        name: resolvedToolName,
        input: {},
        status: 'running',
        startTime: Date.now(),
        partialInput: delta
      }

      const updatedStream = {
        ...activeStream,
        toolCalls: [...activeStream.toolCalls, newToolCall],
      }

      set({ activeStream: updatedStream })
      return
    }

    // Tool exists - update it
    const updatedStream = {
      ...activeStream,
      toolCalls: activeStream.toolCalls.map(tc => {
        if (tc.id === toolId) {
          const currentPartial = tc.partialInput || ''
          return {
            ...tc,
            partialInput: currentPartial + delta
          }
        }
        return tc
      }),
      segments: activeStream.segments.map(segment => {
        if ((segment.type === 'tool_start' || segment.type === 'tool_call') && segment.toolCall?.id === toolId) {
          const currentPartial = segment.toolCall.partialInput || ''
          return {
            ...segment,
            toolCall: {
              ...segment.toolCall,
              partialInput: currentPartial + delta
            }
          }
        }
        return segment
      })
    }

    set({ activeStream: updatedStream })
  },

  finalizeStream: (metadata?: any) => {
    const { activeStream } = get()
    if (!activeStream) {
      // Late server `complete` after a local finalize on Stop click.
      // useStreamingWebSocket.stopGeneration() finalizes immediately so the
      // Stop button always feels responsive, but the server still runs the
      // end-of-turn squash and publishes `complete` with a real commitHash
      // moments later. Without this branch the late commitHash is dropped,
      // so Undo locks (no rollback target) and falls back to Restore.
      // Patch the commit onto the most recent assistant message that's
      // missing one, mirroring how `complete` would have set it had we
      // waited for the server.
      const lateCommitHash = typeof metadata?.commitHash === 'string' && metadata.commitHash.length > 0
        ? metadata.commitHash
        : undefined
      if (lateCommitHash) {
        set((state) => {
          const lastAssistantIdx = state.messages.findLastIndex((m) => m.role === 'assistant')
          if (lastAssistantIdx < 0) return state
          const target = state.messages[lastAssistantIdx]
          if (!target || target.commitHash) return state
          const patched: ChatMessage = {
            ...target,
            commitHash: lateCommitHash,
            metadata: { ...(target.metadata ?? {}), commitHash: lateCommitHash },
          }
          const nextMessages = state.messages.slice()
          nextMessages[lastAssistantIdx] = patched
          return { messages: nextMessages }
        })
        logger.info('streaming-store.stream.finalize.late_commit_patched', {
          commitHash: lateCommitHash,
        })
      }
      return
    }

    // Mark any tools still in 'running' state as 'incomplete'
    // This happens when the LLM hits maxOutputTokens mid-tool-call,
    // so tool-input-start fires but tool-call/tool-result never arrive
    const runningToolIds: string[] = []
    const finalizedToolCalls = activeStream.toolCalls.map(tc => {
      if (tc.status === 'running') {
        runningToolIds.push(tc.id)
        return { ...tc, status: 'incomplete' as const }
      }
      return tc
    })

    const finalizedSegments = activeStream.segments.map(segment => {
      const isToolSegment = (segment.type === 'tool_start' || segment.type === 'tool_call') &&
        segment.toolCall?.status === 'running'
      if (isToolSegment) {
        return {
          ...segment,
          toolCall: { ...segment.toolCall, status: 'incomplete' as const }
        }
      }
      return segment
    })

    if (runningToolIds.length > 0) {
      logger.warn('streaming-store.stream.finalize.incomplete_tools', {
        messageId: activeStream.id,
        incompleteToolIds: runningToolIds,
        incompleteToolCount: runningToolIds.length
      })
    }

    // Detect output token limit: LLM hit maxOutputTokens (text truncation or incomplete tools)
    const outputTokenLimitReached = metadata?.finishReason === 'length'
    // Detect connection lost: stream aborted due to disconnect grace period timeout or server shutdown.
    // 'incomplete' = server soft-committed a chunk-timeout stall: content
    // arrived but no terminal frame. Reuse the connectionLost advisory
    // ("response may be incomplete — send a follow-up"), not the red error.
    const connectionLost = metadata?.finishReason === 'aborted'
      || metadata?.finishReason === 'server_shutdown'
      || metadata?.finishReason === 'incomplete'
    // Detect user-initiated stop
    const userStopped = metadata?.finishReason === 'user_stopped'

    if (outputTokenLimitReached) {
      logger.warn('streaming-store.stream.finalize.output_limit', {
        messageId: activeStream.id,
        finishReason: metadata?.finishReason,
        incompleteToolCount: runningToolIds.length
      })
    }

    if (connectionLost) {
      logger.warn('streaming-store.stream.finalize.connection_lost', {
        messageId: activeStream.id,
        finishReason: metadata?.finishReason,
      })
    }

    if (userStopped) {
      logger.info('streaming-store.stream.finalize.user_stopped', {
        messageId: activeStream.id,
      })
    }

    // Extract usedFreeGrants from complete event metadata (both BMS and grants modes)
    const usedFreeGrants = metadata?.usedFreeGrants || false

    logger.debug('streaming-store.stream.finalize', {
      messageId: activeStream.id,
      contentLength: activeStream.content.length,
      toolCallCount: activeStream.toolCalls.length,
      segmentCount: activeStream.segments.length,
      maxStepsReached: activeStream.maxStepsReached,
      outputTokenLimitReached,
      upstreamError: activeStream.upstreamError,
      budgetExceeded: activeStream.budgetExceeded,
      usedFreeGrants,
    })

    // Convert streaming message to completed message
    const completedMessage: ChatMessage = {
      id: activeStream.id,
      role: activeStream.role,
      content: activeStream.content,
      segments: finalizedSegments,
      toolCalls: finalizedToolCalls,
      timestamp: new Date(),
      maxStepsReached: activeStream.maxStepsReached,
      outputTokenLimitReached: outputTokenLimitReached || undefined,
      connectionLost: connectionLost || undefined,
      userStopped: userStopped || undefined,
      upstreamError: activeStream.upstreamError,
      budgetExceeded: activeStream.budgetExceeded,
      usedFreeGrants,
      ...(activeStream.error && { error: activeStream.error }),
      ...(activeStream.errorType && { errorType: activeStream.errorType }),
      ...(activeStream.errorCode !== undefined && { errorCode: activeStream.errorCode }),
      ...(activeStream.retryAttempts !== undefined && { retryAttempts: activeStream.retryAttempts }),
      ...(activeStream.retryReason && { retryReason: activeStream.retryReason }),
      ...(activeStream.origin && { origin: activeStream.origin }),
      ...(metadata?.commitHash && { commitHash: metadata.commitHash }),
      metadata: {
        ...activeStream.metadata,
        ...metadata
      }
    }

    set((state) => {
      const nextMessages = state.messages.some((m) => m.id === completedMessage.id)
        ? state.messages
        : [...state.messages, completedMessage]

      return {
        messages: nextMessages,
        activeStream: null,
        streamingState: 'idle',
        isLoading: false,
      }
    })
  },

  clearActiveStream: () => {
    set({
      activeStream: null,
      streamingState: 'idle',
      isLoading: false
    })
  },

  // === APP CONTEXT ACTIONS ===

  setCurrentAppId: (appId) => {
    set((state) => {
      if (state.currentAppId === appId) {
        return state; // Same app, no-op
      }

      const newAppChatHistory = { ...state.appChatHistory };

      // Save current app's messages and active stream
      if (state.currentAppId) {
        saveResolvedSecretsComposerToolCallIds(
          state.currentAppId,
          state.resolvedSecretsComposerToolCallIds,
        );
        newAppChatHistory[state.currentAppId] = {
          messages: state.messages,
          activeStream: state.activeStream,
          resolvedSecretsComposerToolCallIds: state.resolvedSecretsComposerToolCallIds,
        };
      }

      // Clear escalation timeout when switching apps
      if (state.connectionRetry.escalationTimeoutId) {
        clearTimeout(state.connectionRetry.escalationTimeoutId);
      }

      // Get saved state for the new app (or defaults)
      const savedState = appId ? newAppChatHistory[appId] : null;
      const resolvedSecretsComposerToolCallIds = appId
        ? mergeResolvedSecretsComposerToolCallIds(
            appId,
            savedState?.resolvedSecretsComposerToolCallIds ?? {},
          )
        : {};

      return {
        currentAppId: appId,
        messages: savedState?.messages ?? [],
        activeStream: null, // Always null - let recovery determine stream state
        streamingState: 'idle' as const, // Always idle - recovery will set streaming if needed
        isLoading: false, // Always false - recovery will set loading if needed
        currentStep: 0,
        inputValue: '',
        aiEditContext: null,
        aiEditContexts: [],
        buildErrorContext: null,
        availableAgents: [],
        defaultAgentId: null,
        currentAgentName: null, // Reset agent name when switching apps
        appChatHistory: newAppChatHistory,
        websocket: { connected: false, status: 'idle' as const },
        connectionRetry: {
          isRetrying: false,
          retryStartedAt: null,
          wasStreamingOnDisconnect: false,
          disconnectSocketId: null,
          escalationTimeoutId: null
        },
        historyLoadRequested: false,
        historyLoadingComplete: false,
        // Reset pagination when switching apps
        historyHasMore: true,
        historyNextCursor: null,
        historyLoadingMore: false,
        serverCapabilities: null, // Reset capabilities when switching apps
        resolvedSecretsComposerToolCallIds,
      };
    });
  },
  setInputValue: (value) => set({ inputValue: value }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setAiEditContext: (context) => set({ aiEditContext: context }),
  addAiEditContext: (context) => {
    const number = context.number ?? get().aiEditContexts.length + 1
    const numbered = { ...context, number }
    set({ aiEditContexts: [...get().aiEditContexts, numbered] })
    return number
  },
  removeAiEditContext: (number) => {
    set({ aiEditContexts: get().aiEditContexts.filter(c => c.number !== number) })
  },
  clearAiEditContexts: () => set({ aiEditContexts: [] }),
  setBuildErrorContext: (context) => set({ buildErrorContext: context }),
  setAgentCatalog: (agents, defaultAgentId) => set({
    availableAgents: agents,
    defaultAgentId: defaultAgentId ?? null
  }),
  setCurrentAgentName: (agentName) => set({ currentAgentName: agentName }),
  setDevelopmentPlan: (plan) => set({ developmentPlan: plan }),

  // === WEBSOCKET ACTIONS ===

  setWebSocketState: (state) => {
    set((prevState) => ({
      websocket: { ...prevState.websocket, ...state }
    }))
  },

  setStreamingState: (state) => set({ streamingState: state }),

  // State machine lifecycle actions (called by StoreSyncAdapter)
  setRecoveryState: (state) => set({ recoveryState: state }),

  setRetryState: (state) => set({ retryState: state }),

  setError: (error) => set({ lastError: error }),

  startStream: (_conversationId, _messageId) => {
    set({
      streamingState: 'streaming',
      currentStep: 1,
      isLoading: true,
      // Note: Conversation/message management is handled by StreamingWebSocketController
      // This action is called by StoreSyncAdapter to sync machine state to store
    })
  },

  // History loading actions
  setHistoryLoadRequested: (requested) => set({ historyLoadRequested: requested }),
  setHistoryLoadingComplete: (complete) => set({ historyLoadingComplete: complete }),

  // History pagination actions
  setHistoryPagination: (pagination) => {
    set({
      historyHasMore: pagination.hasMore,
      historyNextCursor: pagination.nextCursor
    })
  },

  setHistoryLoadingMore: (loading) => {
    set({ historyLoadingMore: loading })
  },

  resetHistoryPagination: () => {
    set({
      historyHasMore: true,
      historyNextCursor: null,
      historyLoadingMore: false
    })
  },

  // === CONNECTION RETRY ACTIONS ===

  startConnectionRetry: (socketId: string) => {
    logger.info('streaming-store.connection-retry.start', { socketId })
    set({
      connectionRetry: {
        isRetrying: true,
        retryStartedAt: Date.now(),
        wasStreamingOnDisconnect: true,
        disconnectSocketId: socketId,
        escalationTimeoutId: null
      },
      streamingState: 'retrying'
    })
  },

  setEscalationTimeout: (timeoutId: ReturnType<typeof setTimeout>) => {
    set((state) => ({
      connectionRetry: {
        ...state.connectionRetry,
        escalationTimeoutId: timeoutId
      }
    }))
  },

  clearConnectionRetry: () => {
    const currentState = get();

    // Clear escalation timeout if active
    if (currentState.connectionRetry.escalationTimeoutId) {
      clearTimeout(currentState.connectionRetry.escalationTimeoutId);
    }

    logger.info('streaming-store.connection-retry.clear', {
      wasRetrying: currentState.connectionRetry.isRetrying,
      elapsedMs: currentState.connectionRetry.retryStartedAt
        ? Date.now() - currentState.connectionRetry.retryStartedAt
        : null
    });

    set((state) => ({
      connectionRetry: {
        isRetrying: false,
        retryStartedAt: null,
        wasStreamingOnDisconnect: false,
        disconnectSocketId: null,
        escalationTimeoutId: null
      },
      streamingState: state.activeStream ? 'streaming' : 'idle'
    }));
  },

  checkStaleRetry: () => {
    const { connectionRetry } = get()
    if (!connectionRetry.isRetrying || !connectionRetry.retryStartedAt) {
      return false
    }
    const elapsedMs = Date.now() - connectionRetry.retryStartedAt
    const CONNECTION_RETRY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
    const isStale = elapsedMs > CONNECTION_RETRY_TIMEOUT_MS
    if (isStale) {
      logger.warn('streaming-store.connection-retry.stale-detected', {
        elapsedMs,
        retryStartedAt: connectionRetry.retryStartedAt
      })
    }
    return isStale
  },

  // === UTILITY ACTIONS ===

  addCompletedMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, message]
    }))
  },

  mergeMessageMetadata: (messageId, metadataUpdates) => {
    set((state) => {
      const mergeInto = (list: ChatMessage[]) =>
        list.map((message) =>
          message.id === messageId
            ? { ...message, metadata: { ...message.metadata, ...metadataUpdates } }
            : message
        );

      const updatedMessages = mergeInto(state.messages);
      const appId = state.currentAppId;
      const cached = appId ? state.appChatHistory[appId] : undefined;

      return {
        messages: updatedMessages,
        ...(appId && cached
          ? {
              appChatHistory: {
                ...state.appChatHistory,
                [appId]: { ...cached, messages: mergeInto(cached.messages) },
              },
            }
          : {}),
      };
    });
  },

  clearMessages: () => {
    set({
      messages: [],
      activeStream: null,
      streamingState: 'idle',
      resolvedSecretsComposerToolCallIds: {},
    })
  },

  cleanup: () => {
    const currentState = get()

    // Clear escalation timeout before resetting state
    if (currentState.connectionRetry.escalationTimeoutId) {
      clearTimeout(currentState.connectionRetry.escalationTimeoutId)
    }

    set({
      messages: [],
      activeStream: null,
      streamingState: 'idle',
      currentStep: 0,
      currentAppId: null,
      inputValue: '',
      isLoading: false,
      aiEditContext: null,
      aiEditContexts: [],
      appChatHistory: {},
      websocket: { connected: false, status: 'idle' },
      connectionRetry: {
        isRetrying: false,
        retryStartedAt: null,
        wasStreamingOnDisconnect: false,
        disconnectSocketId: null,
        escalationTimeoutId: null
      },
      serverCapabilities: null,
      historyLoadRequested: false,
      historyLoadingComplete: false,
      resolvedSecretsComposerToolCallIds: {},
    });
  },

  resolveSecretsComposerToolCall: (toolCallId) => {
    set((state) => {
      const appId = state.currentAppId
      const nextIds: Record<string, true> = {
        ...state.resolvedSecretsComposerToolCallIds,
        [toolCallId]: true,
      }
      const resolvedSecretsComposerToolCallIds = appId
        ? mergeResolvedSecretsComposerToolCallIds(appId, nextIds)
        : nextIds
      if (appId) {
        saveResolvedSecretsComposerToolCallIds(appId, resolvedSecretsComposerToolCallIds)
      }
      if (!appId) {
        return { resolvedSecretsComposerToolCallIds }
      }
      const cached = state.appChatHistory[appId]
      return {
        resolvedSecretsComposerToolCallIds,
        appChatHistory: {
          ...state.appChatHistory,
          [appId]: {
            messages: cached?.messages ?? state.messages,
            activeStream: cached?.activeStream ?? state.activeStream,
            resolvedSecretsComposerToolCallIds,
          },
        },
      }
    })
  },

  cancelSecretsComposerToolCall: (toolCallId, allSecretNames) => {
    set((state) => {
      const resolvedSecretsComposerToolCallIds: Record<string, true> = {
        ...state.resolvedSecretsComposerToolCallIds,
      }
      resolvedSecretsComposerToolCallIds[batchSecretKey(toolCallId)] = true
      for (const secretName of allSecretNames) {
        const secretKey = secretKeyFor(toolCallId, secretName)
        resolvedSecretsComposerToolCallIds[secretKey] = true
      }
      const appId = state.currentAppId
      const merged = appId
        ? mergeResolvedSecretsComposerToolCallIds(appId, resolvedSecretsComposerToolCallIds)
        : resolvedSecretsComposerToolCallIds
      if (appId) {
        saveResolvedSecretsComposerToolCallIds(appId, merged)
      }
      if (!appId) {
        return { resolvedSecretsComposerToolCallIds: merged }
      }
      const cached = state.appChatHistory[appId]
      return {
        resolvedSecretsComposerToolCallIds: merged,
        appChatHistory: {
          ...state.appChatHistory,
          [appId]: {
            messages: cached?.messages ?? state.messages,
            activeStream: cached?.activeStream ?? state.activeStream,
            resolvedSecretsComposerToolCallIds: merged,
          },
        },
      }
    })
  },

  // === UTILITY FUNCTIONS ===

  getMessageCount: () => {
    const { messages, activeStream } = get()
    return messages.length + (activeStream ? 1 : 0)
  },

  // Auto-send initial message for new apps
  autoSendInitialMessage: (message: string, appId: string) => {
    const state = get()

    // Only auto-send if we have no messages for this app and we're not currently loading
    const hasNoMessages = state.messages.length === 0 && !state.activeStream
    const isCorrectApp = state.currentAppId === appId
    const isNotLoading = !state.isLoading && state.streamingState === 'idle'

    if (hasNoMessages && isCorrectApp && isNotLoading && message.trim()) {
      // Set the input value and trigger the send
      set({ inputValue: message.trim() })
      return true
    }

    return false
  },

  // === UNIFIED HISTORY PERSISTENCE ===

  /**
   * Unified action for persisting history to both messages and appChatHistory
   * Used by HTTP loaders and WebSocket handlers to maintain consistency
   */
  persistHistory: (params: {
    appId: string
    messages: ChatMessage[]
    activeStream?: StreamingMessage | null
    mode: 'replace' | 'append' | 'prepend'
  }) => {
    const { appId, messages, activeStream = null, mode } = params

    set((state) => {
      let updatedMessages: ChatMessage[]

      switch (mode) {
        case 'replace':
          updatedMessages = messages
          break
        case 'append': {
          const existingIds = new Set(state.messages.map((m) => m.id))
          updatedMessages = [...state.messages, ...messages.filter((m) => !existingIds.has(m.id))]
          break
        }
        case 'prepend': {
          // Deduplicate by ID before sorting — state may already contain some of these
          // messages if appChatHistory was restored or a recovery overlapped with pagination
          const existingIds = new Set(state.messages.map((m) => m.id))
          const newMessages = messages.filter((m) => !existingIds.has(m.id))
          updatedMessages = [...newMessages, ...state.messages].sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
          )
          break
        }
      }

      const resolvedSecretsComposerToolCallIds = mergeResolvedSecretsComposerToolCallIds(
        appId,
        state.resolvedSecretsComposerToolCallIds,
      )
      saveResolvedSecretsComposerToolCallIds(appId, resolvedSecretsComposerToolCallIds)

      return {
        messages: updatedMessages,
        resolvedSecretsComposerToolCallIds,
        appChatHistory: {
          ...state.appChatHistory,
          [appId]: {
            messages: updatedMessages,
            activeStream: activeStream ?? state.activeStream,
            resolvedSecretsComposerToolCallIds,
          },
        },
      }
    })

    logger.debug('streaming-store.history-persisted', {
      appId,
      messageCount: messages.length,
      totalMessages: get().messages.length,
      mode
    })
  },

  /**
   * Unified action for normalizing and persisting history
   * Handles in-progress message detection and extraction
   */
  loadAndPersistHistory: (params: {
    appId: string
    rawMessages: any[]
    mode: 'replace' | 'append' | 'prepend'
    detectInProgress?: boolean
  }) => {
    const { appId, rawMessages, mode, detectInProgress = false } = params
    const normalized = normalizeConversationMessages(rawMessages)

    let messages = normalized
    let activeStream: StreamingMessage | null = null
    // Skip hydration when a live stream is already accumulating chunks: SSE
    // recovery's clearActiveStream + reload-history sequence races with
    // startNewStream when the user prompts during recovery, and overwriting
    // the live activeStream would erase the in-flight response.
    const liveActiveStream = get().activeStream

    if (detectInProgress && normalized.length > 0) {
      const lastMsg = normalized[normalized.length - 1]
      const isInProgress = lastMsg.role === 'assistant' &&
        (lastMsg.metadata as any)?.inProgress === true

      if (isInProgress) {
        messages = normalized.slice(0, -1)

        if (liveActiveStream) {
          // Persisted in-progress placeholder ids are server-generated;
          // live activeStream ids are client-generated (`generateId()` in
          // `startNewStream`). They systematically diverge for the SAME
          // logical turn. The ids-match path is rare; the divergent path
          // is the common race shape — log warn so any unexpected
          // divergence (e.g. a stranded prior-session placeholder) is
          // visible in production rather than masked at debug.
          const idsMatch = lastMsg.id === liveActiveStream.id
          const logFn = idsMatch ? logger.debug : logger.warn
          logFn('streaming-store.in-progress-skipped', {
            messageId: lastMsg.id,
            liveStreamId: liveActiveStream.id,
            idsMatch,
            reason: 'live_active_stream_present'
          })
        } else {
          activeStream = {
            id: lastMsg.id,
            role: 'assistant',
            content: lastMsg.content || '',
            segments: lastMsg.segments || [],
            toolCalls: lastMsg.toolCalls || [],
            timestamp: lastMsg.timestamp,
            isComplete: false,
            origin: lastMsg.origin,
          }

          logger.debug('streaming-store.in-progress-detected', {
            messageId: activeStream.id,
            contentLength: activeStream.content.length
          })
        }
      }
    }

    get().persistHistory({
      appId,
      messages,
      activeStream,
      mode
    })

    // If we detected an in-progress message, also update the streaming state
    if (activeStream) {
      set({
        activeStream,
        streamingState: 'streaming',
        isLoading: true,
      })
    }
  },
}))

// === SELECTORS ===
// Re-exported from ./useStreamingConversationStore.selectors to preserve the
// public import surface.
export * from './useStreamingConversationStore.selectors'

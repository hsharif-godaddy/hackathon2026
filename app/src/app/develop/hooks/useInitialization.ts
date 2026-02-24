import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useMachine } from '@xstate/react'

import { getConversationIdFromCookie } from '@/hooks/websocket/useWebSocketHelpers'
import { logger } from '@/lib/request-context'
import { AgentService } from '@/services/AgentService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { cleanupSiteCreationStore, useSiteCreationStore } from '@/stores/useSiteCreationStore'
import type { Site } from '@/stores/useSitesStore'
import {
  normalizeConversationMessages,
  useHistoryLoadingComplete,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import { AppErrorCode } from '@/types/error-codes'
import {
  getPhaseFromState,
  getSubPhaseFromState,
  initializationMachine,
  type InitializationMachineSnapshot,
} from './initializationMachine'

/**
 * Helper to get initialJobId from sessionStorage
 *
 * @param appId - The app ID to look up
 * @returns The initial job ID or null if not found
 */
function getInitialJobIdFromStorage(appId: string | null): string | null {
  if (typeof window === 'undefined' || !appId) return null
  return sessionStorage.getItem(`initial-job-id-${appId}`)
}

/**
 * Helper to check if initial prompt is pending
 *
 * @param initialJobId - The initial job ID to check
 * @param appId - The app ID to check (for rebuild mode)
 * @returns True if initial prompt is pending
 */
function checkHasInitialPrompt(initialJobId: string | null, appId: string | null): boolean {
  if (typeof window === 'undefined') return false

  // Check with initialJobId first (normal creation flow)
  if (initialJobId) {
    const hasPromptPending = sessionStorage.getItem(`initial-prompt-pending-${initialJobId}`) === 'true'
    const inCreationFlow = sessionStorage.getItem(`in-creation-flow-${initialJobId}`) === 'true'
    if (hasPromptPending && inCreationFlow) return true
  }

  // Also check with appId (for rebuild mode where we navigate directly to appId)
  if (appId) {
    const hasPromptPending = sessionStorage.getItem(`initial-prompt-pending-${appId}`) === 'true'
    const inCreationFlow = sessionStorage.getItem(`in-creation-flow-${appId}`) === 'true'
    if (hasPromptPending && inCreationFlow) return true
  }

  return false
}

function getStoredInitialPrompt(initialJobId: string | null, appId: string | null): string | null {
  if (typeof window === 'undefined') return null
  if (initialJobId) {
    const prompt = sessionStorage.getItem(`initial-prompt-text-${initialJobId}`)
    if (prompt) return prompt
  }
  if (appId) {
    return sessionStorage.getItem(`initial-prompt-text-${appId}`)
  }
  return null
}

/**
 * Check if this is a rebuild mode prompt that should be used as-is
 *
 * @param initialJobId - The initial job ID to check
 * @param appId - The app ID to check
 * @returns True if this is a rebuild mode prompt
 */
function isRebuildModePrompt(initialJobId: string | null, appId: string | null): boolean {
  if (typeof window === 'undefined') return false
  if (initialJobId && sessionStorage.getItem(`rebuild-mode-prompt-${initialJobId}`) === 'true') {
    return true
  }
  if (appId && sessionStorage.getItem(`rebuild-mode-prompt-${appId}`) === 'true') {
    return true
  }
  return false
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Main initialization phases
 */
export type InitializationPhase =
  | 'idle'
  | 'checking-creation'
  | 'creating'
  | 'initializing-page'
  | 'loading-history'
  | 'ready'
  | 'error'

/**
 * Sub-phases within the 'ready' state for finer-grained tracking
 */
export type InitializationSubPhase =
  | 'waiting-for-websocket'    // WebSocket not connected yet
  | 'websocket-connected'       // Connected, ready to send initial prompt
  | 'waiting-for-first-edit'    // Initial prompt sent, waiting for AI to create first files
  | 'active'                    // Normal operation (first edit seen or no initial prompt)

/**
 * Context object containing all raw state needed for UI decisions
 */
export interface InitializationContext {
  // IDs
  appId: string | null
  initialJobId: string | null
  isJobId: boolean

  // Data state (from stores)
  site: Site | null
  hasConversationHistory: boolean

  // Connection state (from WebSocket store)
  isWebSocketConnected: boolean

  // Interaction state (from streaming store)
  isStreamingMessage: boolean
  hasSeenFirstFileEdit: boolean

  // Initial creation flow
  hasInitialPrompt: boolean
  initialPromptSent: boolean
  initialPromptText: string | null
  isRebuildModePrompt: boolean
}

/**
 * Computed UI state - all UI decisions are made here
 */
export interface InitializationUIState {
  // Chat pane
  showChatLoader: boolean
  chatLoaderPhase: 'initializing' | 'deploying' | 'verifying-agent'
  chatLoaderError: string | null
  canInteractWithChat: boolean

  // Preview pane
  showPreviewLoader: boolean
  previewLoaderMessage: string

  // Auto-send
  shouldAutoSendPrompt: boolean
  autoSendPromptText: string | null

  // Error handling
  hasError: boolean
  errorMessage: string | null
  canRetry: boolean

  // Analytics/debugging - kebab-case strings for external consumers
  phase: InitializationPhase
  subPhase: InitializationSubPhase | null
}

/**
 * Actions that can be performed on the initialization state
 */
export interface InitializationActions {
  /**
   * Retry initialization after an error
   */
  retry: () => void

  /**
   * Cancel initialization and return to home
   */
  cancel: () => void

  /**
   * Mark that the initial prompt has been sent
   */
  markInitialPromptSent: () => void

  /**
   * Mark that the first file edit has been seen
   */
  markFirstFileEditSeen: () => void
}

/**
 * Parameters for useInitialization hook
 */
export interface UseInitializationParams {
  appId: string | null
  isJobId: boolean
}

/**
 * Return type for useInitialization hook
 */
export interface UseInitializationReturn {
  // State machine
  phase: InitializationPhase
  subPhase: InitializationSubPhase | null
  isReady: boolean

  // Error states
  siteNotFound: boolean

  // Context (raw state)
  context: InitializationContext

  // Computed UI state (derived)
  ui: InitializationUIState

  // Actions
  actions: InitializationActions

  // Legacy compatibility (deprecated - will be removed in future)
  /** @deprecated Use ui.showChatLoader instead */
  showCreationLoader: boolean
  /** @deprecated Use ui.chatLoaderError instead */
  creationError: string | null
  retryCount: number
  maxRetries: number
  /** @deprecated Use actions.retry instead */
  onRetry: () => void
  /** @deprecated Use actions.cancel instead */
  onCancel: () => void
  initialJobId: string | null
}

// ============================================================================
// PURE COMPUTATION FUNCTIONS
// ============================================================================

/**
 * Compute all UI state from machine state and context
 * This is a pure function with no side effects
 */
function computeUIState(
  state: InitializationMachineSnapshot,
  context: InitializationContext,
  creationError: string | null,
  isActiveCreationSession: boolean
): InitializationUIState {
  // Chat loader logic
  const showChatLoader =
    state.matches('checkingCreation') ||
    state.matches('creating') ||
    (state.matches('initializingPage') && context.hasInitialPrompt) ||
    (state.matches('loadingHistory') && context.hasInitialPrompt) ||
    (state.matches({ ready: 'waitingForWebSocket' }) && context.hasInitialPrompt && !context.initialPromptSent) ||
    (state.matches('error') && context.hasInitialPrompt)

  const chatLoaderPhase: 'initializing' | 'deploying' | 'verifying-agent' =
    state.matches('creating') ? 'deploying' :
      (state.matches({ ready: 'waitingForWebSocket' }) || state.matches('error')) ? 'verifying-agent' :
        'initializing'

  // Preview loader logic - show overlay if in creation flow and haven't seen first edit
  // Covers loadingHistory and early ready sub-phases to prevent iframe from being
  // visible/interactable when server becomes ready before agent makes first file edit
  const showPreviewLoader =
    isActiveCreationSession &&
    context.hasInitialPrompt &&
    !context.hasSeenFirstFileEdit &&
    (
      // During ready phase with WebSocket coordination
      state.matches({ ready: 'waitingForWebSocket' }) ||
      state.matches({ ready: 'websocketConnected' }) ||
      state.matches({ ready: 'waitingForFirstEdit' }) ||
      // During loadingHistory phase (before ready)
      state.matches('loadingHistory')
    )

  // Auto-send logic
  const shouldAutoSendPrompt =
    state.matches({ ready: 'websocketConnected' }) &&
    context.hasInitialPrompt &&
    !context.initialPromptSent &&
    context.isWebSocketConnected

  // Interaction logic
  const canInteractWithChat =
    (state.matches({ ready: 'websocketConnected' }) ||
      state.matches({ ready: 'waitingForFirstEdit' }) ||
      state.matches({ ready: 'active' })) &&
    context.isWebSocketConnected

  // Error logic
  const hasError = state.matches('error') || !!creationError

  // Generate kebab-case phase/subPhase strings for analytics/external API
  const phase = getPhaseFromState(state)
  const subPhase = getSubPhaseFromState(state)
  const uiPhase = mapMachinePhaseToUIPhase(phase)
  const uiSubPhase = mapMachineSubPhaseToUISubPhase(subPhase)

  return {
    showChatLoader,
    chatLoaderPhase,
    chatLoaderError: creationError,
    canInteractWithChat,

    showPreviewLoader,
    previewLoaderMessage: 'The AI agent is building your app...',

    shouldAutoSendPrompt,
    autoSendPromptText: context.initialPromptText,

    hasError,
    errorMessage: creationError || 'Initialization failed',
    canRetry: state.matches('error'),

    // Expose phase/subPhase for analytics and debugging
    phase: uiPhase,
    subPhase: uiSubPhase,
  }
}

/**
 * Map XState machine phases to UI phases
 */
function mapMachinePhaseToUIPhase(machinePhase: string): InitializationPhase {
  const mapping: Record<string, InitializationPhase> = {
    'idle': 'idle',
    'checkingCreation': 'checking-creation',
    'creating': 'creating',
    'initializingPage': 'initializing-page',
    'loadingHistory': 'loading-history',
    'ready': 'ready',
    'error': 'error',
  }
  return mapping[machinePhase] || 'idle'
}

/**
 * Map XState machine sub-phases to UI sub-phases
 */
function mapMachineSubPhaseToUISubPhase(machineSubPhase: string | null): InitializationSubPhase | null {
  if (!machineSubPhase) return null
  const mapping: Record<string, InitializationSubPhase> = {
    'waitingForWebSocket': 'waiting-for-websocket',
    'websocketConnected': 'websocket-connected',
    'waitingForFirstEdit': 'waiting-for-first-edit',
    'active': 'active',
  }
  return mapping[machineSubPhase] || null
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Enhanced initialization hook that orchestrates the entire develop page lifecycle
 *
 * This hook manages:
 * - Site creation flow (job → app conversion)
 * - Page data loading
 * - Conversation history loading
 * - WebSocket connection tracking
 * - Initial prompt auto-send
 * - All UI state derivation
 *
 * @param params - Hook parameters
 * @returns Initialization state, context, UI state, and actions
 *
 * @example
 * ```typescript
 * const init = useInitialization({ appId, isJobId })
 *
 * // Check if should show loader
 * if (init.ui.showChatLoader) {
 *   return <ChatPaneLoader phase={init.ui.chatLoaderPhase} />
 * }
 *
 * // Auto-send prompt when ready
 * if (init.ui.shouldAutoSendPrompt) {
 *   sendMessage(init.ui.autoSendPromptText)
 *   init.actions.markInitialPromptSent()
 * }
 * ```
 */
export function useInitialization({ appId, isJobId }: UseInitializationParams): UseInitializationReturn {
  const router = useRouter()

  // -------------------------------------------------------------------------
  // XState Machine
  // -------------------------------------------------------------------------
  const [state, send] = useMachine(initializationMachine, {
    input: {
      appId,
      isJobId,
      hasInitialPrompt: checkHasInitialPrompt(getInitialJobIdFromStorage(appId), appId),
    },
  })

  // Track initialization and app IDs
  const initializingAppIdRef = useRef<string | null>(null)
  const previousAppIdRef = useRef<string | null>(appId)
  const [siteNotFound, setSiteNotFound] = useState(false)

  // Unique token to prevent cross-app promise contamination (Issue 1.1 + 3.1)
  // Regenerated on RESET to invalidate all pending async operations
  const initializationTokenRef = useRef<symbol>(Symbol('init'))

  // Track which job ID generated which realAppId (Issue 2.1)
  // Prevents false positive job→app conversion detection
  const jobIdToRealAppIdRef = useRef<{ jobId: string; realAppId: string } | null>(null)

  // AbortController for HTTP history loading cancellation (Issue 3.2)
  const historyAbortControllerRef = useRef<AbortController | null>(null)

  // -------------------------------------------------------------------------
  // STORE SUBSCRIPTIONS (Read-only)
  // -------------------------------------------------------------------------

  // Site creation (internal) - realAppId needed early for RESET logic
  const realAppId = useSiteCreationStore((state) => state.realAppId)

  // Reset machine when navigating between DIFFERENT apps (not job→app transition)
  useEffect(() => {
    if (!appId || !previousAppIdRef.current || appId === previousAppIdRef.current) {
      previousAppIdRef.current = appId
      return
    }

    // Don't reset if this is the job→app conversion (same logical app)
    // Check that realAppId matches AND this is the specific job that created it
    const isJobToAppConversion =
      realAppId &&
      realAppId === appId &&
      jobIdToRealAppIdRef.current?.jobId === previousAppIdRef.current &&
      jobIdToRealAppIdRef.current?.realAppId === appId

    if (isJobToAppConversion) {
      previousAppIdRef.current = appId
      return
    }

    // This is a navigation to a truly different app - reset and clear stale state
    send({ type: 'RESET' })
    initializingAppIdRef.current = null
    initializationTokenRef.current = Symbol('init') // Invalidate all pending operations
    historyAbortControllerRef.current?.abort() // Cancel any pending HTTP history loading
    historyAbortControllerRef.current = null
    jobIdToRealAppIdRef.current = null // Clear job→app mapping

    previousAppIdRef.current = appId
  }, [appId, realAppId, send])

  // Track if we're in an active creation flow for THIS page session
  const isActiveCreationSession = useRef(false)

  // Reset isActiveCreationSession flag on navigation (Issue 9.2)
  useEffect(() => {
    isActiveCreationSession.current = false
  }, [appId])

  // Timeout for history loading
  const historyLoadingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Last assistant message id we sent STREAM_COMPLETE_WITHOUT_FIRST_EDIT for (avoid duplicate sends)
  const streamCompleteWithoutEditSentForRef = useRef<string | null>(null)

  // Site creation (internal) - continued
  const creationPhase = useSiteCreationStore((state) => state.phase)
  const creationError = useSiteCreationStore((state) => state.error)
  const retryCount = useSiteCreationStore((state) => state.retryCount)
  const maxRetries = useSiteCreationStore((state) => state.maxRetries)
  const initializeSite = useSiteCreationStore((state) => state.initializeSite)
  const retryCreation = useSiteCreationStore((state) => state.retry)

  // Page data
  const site = useDevelopPageStore((state) => state.site)
  const loadingPhase = useDevelopPageStore((state) => state.loadingPhase)
  const initializePage = useDevelopPageStore((state) => state.initializePage)

  // Streaming/WebSocket
  const isWebSocketConnected = useStreamingConversationStore((state) => state.websocket.connected)
  const webSocketError = useStreamingConversationStore((state) => state.websocket.error)
  const isStreamingMessage = useStreamingConversationStore((state) => state.isLoading)
  const messages = useStreamingConversationStore((state) => state.messages)
  const activeStream = useStreamingConversationStore((state) => state.activeStream)
  const historyLoadingComplete = useHistoryLoadingComplete()
  const serverCapabilities = useStreamingConversationStore((state) => state.serverCapabilities)

  // -------------------------------------------------------------------------
  // DERIVED STATE (Context)
  // -------------------------------------------------------------------------

  // Get current initialJobId from machine context or sessionStorage
  const initialJobId = state.context.initialJobId || getInitialJobIdFromStorage(appId)

  const context: InitializationContext = {
    appId,
    initialJobId,
    isJobId,
    site,
    hasConversationHistory: messages.length > 0,
    isWebSocketConnected,
    isStreamingMessage,
    hasSeenFirstFileEdit: state.context.hasSeenFirstFileEdit,
    // Use machine context as source of truth (not sessionStorage)
    // Machine context persists after prompt is sent, sessionStorage keys are cleared
    hasInitialPrompt: state.context.hasInitialPrompt,
    initialPromptSent: state.context.initialPromptSent,
    // For rebuild mode, prioritize sessionStorage prompt over site.initial_prompt
    initialPromptText: isRebuildModePrompt(initialJobId, appId)
      ? getStoredInitialPrompt(initialJobId, appId)
      : (site?.initial_prompt ?? getStoredInitialPrompt(initialJobId, appId)),
    isRebuildModePrompt: isRebuildModePrompt(initialJobId, appId),
  }

  // -------------------------------------------------------------------------
  // COMPUTED UI STATE
  // -------------------------------------------------------------------------

  const ui = computeUIState(
    state,
    context,
    creationError,
    isActiveCreationSession.current
  )

  // -------------------------------------------------------------------------
  // EFFECTS: XState Machine Integration
  // -------------------------------------------------------------------------

  // Set the active creation session flag
  useEffect(() => {
    if (context.hasInitialPrompt && !isActiveCreationSession.current) {
      isActiveCreationSession.current = true
    }
  }, [context.hasInitialPrompt])

  // Sync site.initial_prompt to sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (site?.initial_prompt && site.id) {
      if (isRebuildModePrompt(initialJobId, site.id)) {
        return
      }
      const storageKey = `initial-prompt-text-${site.id}`
      const existingValue = sessionStorage.getItem(storageKey)
      if (existingValue !== site.initial_prompt) {
        sessionStorage.setItem(storageKey, site.initial_prompt)
      }
    }
  }, [site?.initial_prompt, site?.id, initialJobId])

  // Store initialJobId in sessionStorage
  useEffect(() => {
    if (isJobId && appId) {
      sessionStorage.setItem(`in-creation-flow-${appId}`, 'true')
    }
  }, [appId, isJobId])

  // EFFECT: Initialize on mount
  useEffect(() => {
    if (!appId) return

    // Reset store when navigating to regular app
    if (!isJobId && realAppId) {
      useSiteCreationStore.getState().reset()
    }

    // Hydrate hasInitialPrompt from sessionStorage for post-RESET re-initialization
    const hydratedHasInitialPrompt = checkHasInitialPrompt(initialJobId, appId)

    if (isJobId) {
      send({ type: 'START_CHECKING_CREATION', appId, isJobId, hasInitialPrompt: hydratedHasInitialPrompt })
    } else {
      send({ type: 'SKIP_TO_PAGE_INIT', appId, hasInitialPrompt: hydratedHasInitialPrompt })
    }
  }, [appId, isJobId, realAppId, initialJobId, send])

  // EFFECT: Trigger creation when in checkingCreation phase
  useEffect(() => {
    const phase = getPhaseFromState(state)
    if (phase === 'checkingCreation' && appId) {
      // Always start creation for job IDs - prompt text is optional
      const initialPromptText = getStoredInitialPrompt(appId, appId) || ''
      initializeSite(appId)
      send({ type: 'START_CREATING', jobId: appId, initialPromptText })
    }
  }, [state, appId, initializeSite, send])

  // EFFECT: Monitor creation store and send events to machine
  useEffect(() => {
    const phase = getPhaseFromState(state)
    if (phase !== 'creating') return

    if (creationPhase === 'complete' && realAppId) {
      // Track which job ID created which realAppId (Issue 2.1)
      if (appId && isJobId) {
        jobIdToRealAppIdRef.current = { jobId: appId, realAppId }
      }
      send({ type: 'CREATION_SUCCEEDED', realAppId })
    } else if (creationPhase === 'error' && creationError) {
      send({ type: 'CREATION_FAILED', error: creationError })
    }
  }, [state, creationPhase, creationError, realAppId, appId, isJobId, send])

  // EFFECT: Update URL when we get real app ID
  useEffect(() => {
    const phase = getPhaseFromState(state)
    if (phase === 'creating' && realAppId && realAppId !== appId) {
      const jobId = appId
      sessionStorage.setItem(`initial-job-id-${realAppId}`, jobId)
      const initialPromptText = sessionStorage.getItem(`initial-prompt-text-${jobId}`)
      if (initialPromptText) {
        sessionStorage.setItem(`initial-prompt-text-${realAppId}`, initialPromptText)
      }
      router.replace(`/develop/${realAppId}`, { scroll: false })
    }
  }, [state, realAppId, appId, router])

  // EFFECT: Hydrate machine context when appId changes post-creation (job→app transition)
  // This ensures machine context.appId and context.isJobId are updated after router navigation
  useEffect(() => {
    const phase = getPhaseFromState(state)
    // Only hydrate if we're past the creation phase and appId doesn't match context
    if (phase !== 'idle' && phase !== 'checkingCreation' && appId && state.context.appId !== appId) {
      logger.debug('initialization.hydrate', {
        oldAppId: state.context.appId,
        newAppId: appId,
        isJobId,
        message: 'Hydrating machine context after appId change'
      })
      send({ type: 'HYDRATE_APP', appId, isJobId })
    }
  }, [state, appId, isJobId, send])

  // EFFECT: Initialize page data
  useEffect(() => {
    const phase = getPhaseFromState(state)
    if (phase !== 'initializingPage') return

    if (!appId || initializingAppIdRef.current === appId) return

    const effectiveAppId = realAppId || appId
    initializingAppIdRef.current = effectiveAppId
    const currentToken = initializationTokenRef.current // Capture current token

    setSiteNotFound(false)

    initializePage(effectiveAppId)
      .then(() => {
        // Only send event if token hasn't changed (no navigation/reset occurred)
        if (initializingAppIdRef.current === effectiveAppId && initializationTokenRef.current === currentToken) {
          send({ type: 'PAGE_DATA_LOADED' })
        }
      })
      .catch(error => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('initialization.page.error', { appId: effectiveAppId, error: errorMessage })

        // Only send error if token hasn't changed (no navigation/reset occurred)
        if (initializingAppIdRef.current !== effectiveAppId || initializationTokenRef.current !== currentToken) {
          return
        }

        if (errorMessage === AppErrorCode.SITE_NOT_FOUND) {
          setSiteNotFound(true)
          return
        }

        send({ type: 'PAGE_DATA_FAILED', error: errorMessage })
      })
  }, [state, appId, realAppId, initializePage, send])

  // EFFECT: Wait for server capabilities or timeout, then decide WebSocket vs HTTP
  useEffect(() => {
    const phase = getPhaseFromState(state)
    if (phase !== 'loadingHistory' || !appId || loadingPhase !== 'ready') return

    const effectiveAppId = realAppId || appId

    // Case 1: Server explicitly supports WebSocket history
    if (serverCapabilities?.supportsWebSocketHistory === true) {
      logger.debug('initialization.history.websocket', {
        appId: effectiveAppId,
        message: 'Server supports WebSocket history, waiting for history_complete'
      })
      return
    }

    // Case 2: HTTP fallback for old agents
    const reason = serverCapabilities === null
      ? 'no_server_config'
      : serverCapabilities.supportsWebSocketHistory === false
        ? 'explicit_false'
        : 'field_missing'

    logger.info('initialization.history.http_fallback', {
      appId: effectiveAppId,
      reason,
      message: `Using HTTP fallback for conversation history (reason: ${reason})`
    })

    // Create AbortController for this history loading operation (Issue 3.2)
    const abortController = new AbortController()
    historyAbortControllerRef.current = abortController
    triggerHttpFallback(effectiveAppId, abortController.signal)

    return () => {
      // Cleanup: abort if effect re-runs
      abortController.abort()
    }
  }, [state, appId, realAppId, loadingPhase, serverCapabilities])

  // Helper function to trigger HTTP fallback for old agents
  const triggerHttpFallback = async (effectiveAppId: string, signal: AbortSignal) => {
    // Check if already aborted
    if (signal.aborted) return

    // Get conversationId from cookie
    let conversationId = getConversationIdFromCookie(effectiveAppId)

    // Validate conversationId format (must be a UUID)
    if (conversationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
      logger.warn('initialization.history.invalid_conversation_id', {
        appId: effectiveAppId,
        conversationId,
        message: 'Invalid conversationId format in cookie, ignoring'
      })
      conversationId = null
    }

    const agentService = AgentService.getInstance()

    // If no conversationId, try to get the latest conversation
    const loadHistory = async () => {
      try {
        if (signal.aborted) return null

        if (!conversationId) {
          logger.debug('initialization.history.finding_latest', {
            appId: effectiveAppId,
            message: 'No conversationId, fetching latest conversation'
          })
          const latestConversation = await agentService.getLatestConversation(effectiveAppId)

          if (signal.aborted) return null

          if (latestConversation) {
            conversationId = latestConversation.id
            logger.info('initialization.history.latest_found', {
              appId: effectiveAppId,
              conversationId
            })
          } else {
            logger.debug('initialization.history.no_conversations', {
              appId: effectiveAppId,
              message: 'No conversations exist for this app'
            })
            return null
          }
        }

        // Load conversation messages
        if (conversationId) {
          if (signal.aborted) return null
          const conversationDetail = await agentService.getConversation(effectiveAppId, conversationId)
          return conversationDetail.messages
        }

        return null
      } catch (error) {
        // Re-throw to be caught by outer catch
        throw error
      }
    }

    try {
      const messages = await loadHistory()

      // Check if aborted after async operation
      if (signal.aborted) return

      if (messages) {
        // Normalize messages and populate store
        const normalized = normalizeConversationMessages(messages)
        useStreamingConversationStore.setState({
          messages: normalized,
          historyLoadingComplete: true
        })
        logger.info('initialization.history.http_success', {
          appId: effectiveAppId,
          messageCount: normalized.length,
          conversationId
        })
      } else {
        // No history to load
        useStreamingConversationStore.setState({ historyLoadingComplete: true })
      }
    } catch (error) {
      // Don't process errors if operation was aborted
      if (signal.aborted) return
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Differentiate error types for better debugging
      const is404 = errorMessage.includes('404')
      const isAuth = errorMessage.includes('401') || errorMessage.includes('403')
      const isNetwork = errorMessage.includes('fetch') || errorMessage.includes('network')

      const errorContext = {
        appId: effectiveAppId,
        error: errorMessage,
        conversationId,
        errorType: is404 ? 'not_found' : isAuth ? 'auth_error' : isNetwork ? 'network_error' : 'unknown'
      }

      if (is404) {
        logger.warn('initialization.history.http_not_found', {
          ...errorContext,
          message: 'Conversation not found, likely deleted or never existed'
        })
      } else if (isAuth) {
        logger.error('initialization.history.http_auth_error', {
          ...errorContext,
          message: 'Authentication/authorization error loading conversation history'
        })
      } else if (isNetwork) {
        logger.error('initialization.history.http_network_error', {
          ...errorContext,
          message: 'Network error loading conversation history'
        })
      } else {
        logger.error('initialization.history.http_failed', errorContext)
      }

      // Mark as complete anyway to unblock initialization
      useStreamingConversationStore.setState({ historyLoadingComplete: true })
    }
  }

  // EFFECT: Wait for history loading to complete
  useEffect(() => {
    const phase = getPhaseFromState(state)
    if (phase !== 'loadingHistory' || !historyLoadingComplete) return

    const effectiveAppId = realAppId || appId

    logger.debug('initialization.history.complete', {
      appId: effectiveAppId,
      message: 'WebSocket history loading complete'
    })

    // Clear timeout
    if (historyLoadingTimeoutRef.current) {
      clearTimeout(historyLoadingTimeoutRef.current)
      historyLoadingTimeoutRef.current = null
    }

    if (initializingAppIdRef.current !== effectiveAppId) {
      return
    }

    send({ type: 'HISTORY_LOADED', hasHistory: messages.length > 0 })
  }, [state, historyLoadingComplete, appId, realAppId, messages.length, send])

  // EFFECT: Set timeout for history loading (30 seconds)
  useEffect(() => {
    const phase = getPhaseFromState(state)
    if (phase !== 'loadingHistory' || !appId || loadingPhase !== 'ready') return

    const effectiveAppId = realAppId || appId

    // Clear any existing timeout
    if (historyLoadingTimeoutRef.current) {
      clearTimeout(historyLoadingTimeoutRef.current)
    }

    // Set 30-second timeout
    historyLoadingTimeoutRef.current = setTimeout(() => {
      logger.warn('initialization.history.timeout', {
        appId: effectiveAppId,
        message: 'History loading timed out after 30s, proceeding without history'
      })

      if (initializingAppIdRef.current !== effectiveAppId) {
        return
      }

      send({ type: 'HISTORY_TIMEOUT' })
    }, 30000)

    return () => {
      if (historyLoadingTimeoutRef.current) {
        clearTimeout(historyLoadingTimeoutRef.current)
        historyLoadingTimeoutRef.current = null
      }
    }
  }, [state, appId, realAppId, loadingPhase, send])

  // EFFECT: Handle WebSocket errors during history loading
  useEffect(() => {
    const phase = getPhaseFromState(state)
    if (phase !== 'loadingHistory' || !webSocketError) return

    const effectiveAppId = realAppId || appId

    logger.error('initialization.history.websocket_error', {
      appId: effectiveAppId,
      errorType: webSocketError.type,
      message: 'WebSocket error during history loading, proceeding without history'
    })

    // Clear timeout
    if (historyLoadingTimeoutRef.current) {
      clearTimeout(historyLoadingTimeoutRef.current)
      historyLoadingTimeoutRef.current = null
    }

    if (initializingAppIdRef.current !== effectiveAppId) {
      return
    }

    if (webSocketError.type === 'APP_NOT_FOUND') {
      return
    }

    send({ type: 'HISTORY_TIMEOUT' })
  }, [state, webSocketError, appId, realAppId, send])

  // EFFECT: Track WebSocket connection state
  useEffect(() => {
    const phase = getPhaseFromState(state)
    const subPhase = getSubPhaseFromState(state)
    if (phase !== 'ready') return

    if (isWebSocketConnected && subPhase === 'waitingForWebSocket') {
      send({ type: 'WEBSOCKET_CONNECTED' })
    } else if (!isWebSocketConnected && subPhase === 'websocketConnected') {
      send({ type: 'WEBSOCKET_DISCONNECTED' })
    }
  }, [state, isWebSocketConnected, send])

  // EFFECT: Auto-exit creation flow (edge case for reconnection)
  useEffect(() => {
    const phase = getPhaseFromState(state)
    if (phase !== 'ready' || !context.hasInitialPrompt || context.initialPromptSent || !isWebSocketConnected) {
      return
    }

    if (isActiveCreationSession.current) {
      return
    }

    // Don't auto-exit during job→app ID transition
    // If we're transitioning from a job ID to real app ID, the appId will change
    // but we should not clear the sessionStorage keys yet
    if (realAppId && realAppId !== appId) {
      return
    }

    logger.info('initialization.auto-exit-creation', { appId })

    if (context.initialJobId) {
      sessionStorage.removeItem(`initial-prompt-pending-${context.initialJobId}`)
      sessionStorage.removeItem(`in-creation-flow-${context.initialJobId}`)
    }

    send({ type: 'PROMPT_SENT' })
  }, [state, context.hasInitialPrompt, context.initialPromptSent, isWebSocketConnected, context.initialJobId, appId, realAppId, send])

  // EFFECT: Handle WebSocket errors
  useEffect(() => {
    if (webSocketError?.type === 'APP_NOT_FOUND') {
      setSiteNotFound(true)
    }
  }, [webSocketError])

  // EFFECT: Track first file edit
  // Note: FileEdit tool calls complete successfully even if no files changed (git hook handles commits)
  // This is intentionally permissive - we want to clear the overlay when the agent starts working,
  // even if the first attempt doesn't result in changes
  useEffect(() => {
    if (state.context.hasSeenFirstFileEdit) return

    const completedFileEdit = activeStream?.toolCalls.find(
      tc => (tc.name === 'textEditor' || tc.name === 'fileEdit') &&
           tc.status === 'completed' &&
           !tc.error
    )

    if (completedFileEdit) {
      send({ type: 'FIRST_FILE_EDIT_SEEN' })
    }
  }, [state.context.hasSeenFirstFileEdit, activeStream, send])

  // EFFECT: When stream completes with incomplete tools only (e.g. token limit),
  // transition to active so the "Building your App" overlay hides and the user sees the preview.
  // For other cases (error, no tools) we keep old behaviour: overlay stays until 5-min timeout.
  useEffect(() => {
    if (!state.matches({ ready: 'waitingForFirstEdit' })) {
      streamCompleteWithoutEditSentForRef.current = null
      return
    }
    if (state.context.hasSeenFirstFileEdit) return
    if (!state.context.hasInitialPrompt) return
    if (activeStream !== null) return

    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant) return
    if (streamCompleteWithoutEditSentForRef.current === lastAssistant.id) return

    const hasCompletedFileEdit = lastAssistant.toolCalls?.some(
      tc => tc.name === 'fileEdit' && tc.status === 'completed' && !tc.error
    )
    if (hasCompletedFileEdit) return

    // Only fileEdit and terminalCommand can indicate "stream done but user may still see a first edit":
    // they are the tools that modify workspace (files/shell). Other tools (e.g. read_file, list_dir)
    // don't justify hiding the "waiting for first edit" overlay.
    const hasIncompleteFileEditOrTerminal = lastAssistant.toolCalls?.some(
      tc => tc.status === 'incomplete' && (tc.name === 'fileEdit' || tc.name === 'terminalCommand')
    )
    if (!hasIncompleteFileEditOrTerminal) return

    streamCompleteWithoutEditSentForRef.current = lastAssistant.id
    logger.info('initialization.stream_complete_without_first_edit', {
      messageId: lastAssistant.id,
      incompleteToolNames: lastAssistant.toolCalls?.filter(tc => tc.status === 'incomplete').map(tc => tc.name) ?? [],
    })
    send({ type: 'STREAM_COMPLETE_WITHOUT_FIRST_EDIT' })
  }, [state, activeStream, messages, send])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isJobId) {
        cleanupSiteCreationStore()
      }

      // Clear history loading timeout
      if (historyLoadingTimeoutRef.current) {
        clearTimeout(historyLoadingTimeoutRef.current)
        historyLoadingTimeoutRef.current = null
      }
    }
  }, [isJobId])

  // -------------------------------------------------------------------------
  // ACTIONS
  // -------------------------------------------------------------------------

  const actions: InitializationActions = {
    retry: () => {
      retryCreation()
      send({ type: 'RETRY_CREATION' })
    },

    cancel: () => {
      cleanupSiteCreationStore()
      router.push('/')
    },

    markInitialPromptSent: () => {
      send({ type: 'PROMPT_SENT' })
      if (initialJobId) {
        sessionStorage.removeItem(`initial-prompt-pending-${initialJobId}`)
        sessionStorage.removeItem(`in-creation-flow-${initialJobId}`)
        sessionStorage.removeItem(`initial-prompt-text-${initialJobId}`)
      }
      if (appId) {
        sessionStorage.removeItem(`initial-prompt-text-${appId}`)
      }
    },

    markFirstFileEditSeen: () => {
      send({ type: 'FIRST_FILE_EDIT_SEEN' })
    },
  }

  // Legacy handlers for backward compatibility
  const handleCancel = () => actions.cancel()
  const handleRetry = () => actions.retry()

  // -------------------------------------------------------------------------
  // LOGGING (State transitions)
  // -------------------------------------------------------------------------

  useEffect(() => {
    logger.debug('initialization.state', {
      phase: ui.phase,
      subPhase: ui.subPhase,
      isReady: ui.phase === 'ready' && ui.subPhase === 'active',
      context: {
        appId,
        isWebSocketConnected,
        hasInitialPrompt: context.hasInitialPrompt,
        initialPromptSent: context.initialPromptSent,
        hasSeenFirstFileEdit: context.hasSeenFirstFileEdit,
        isRebuildModePrompt: context.isRebuildModePrompt,
      },
      ui: {
        showChatLoader: ui.showChatLoader,
        showPreviewLoader: ui.showPreviewLoader,
        shouldAutoSendPrompt: ui.shouldAutoSendPrompt,
        canInteractWithChat: ui.canInteractWithChat,
      }
    })
  }, [
    ui.phase,
    ui.subPhase,
    appId,
    isWebSocketConnected,
    context.hasInitialPrompt,
    context.initialPromptSent,
    context.hasSeenFirstFileEdit,
    ui.showChatLoader,
    ui.showPreviewLoader,
    ui.shouldAutoSendPrompt,
    ui.canInteractWithChat,
    context.isRebuildModePrompt,
  ])

  // -------------------------------------------------------------------------
  // RETURN API
  // -------------------------------------------------------------------------

  return {
    phase: ui.phase,
    subPhase: ui.subPhase,
    isReady: ui.phase === 'ready' && ui.subPhase === 'active',
    siteNotFound,
    context,
    ui,
    actions,

    // Legacy compatibility (deprecated)
    showCreationLoader: ui.phase === 'checking-creation' || ui.phase === 'creating',
    creationError,
    retryCount,
    maxRetries,
    onRetry: handleRetry,
    onCancel: handleCancel,
    initialJobId,
  }
}

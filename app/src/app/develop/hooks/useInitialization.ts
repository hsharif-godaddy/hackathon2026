import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { logger } from '@/lib/request-context'
import { getConversationIdFromCookie } from '@/hooks/websocket/useWebSocketHelpers'
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
 * Compute all UI state from the current phase, subPhase, and context
 * This is a pure function with no side effects
 *
 * @param phase - Current initialization phase
 * @param subPhase - Current sub-phase (if in ready state)
 * @param context - Current context state
 * @param creationError - Error from site creation (if any)
 * @param isActiveCreationSession - Whether this page session is part of initial creation
 * @returns Computed UI state
 */
function computeUIState(
  phase: InitializationPhase,
  subPhase: InitializationSubPhase | null,
  context: InitializationContext,
  creationError: string | null,
  isActiveCreationSession: boolean
): InitializationUIState {

  // Chat loader logic - show during initial creation flow, when waiting for websocket, or on error with jobId
  const showChatLoader =
    phase === 'checking-creation' ||
    phase === 'creating' ||
    (phase === 'initializing-page' && context.hasInitialPrompt) || // Only show during page init if it's a new app
    (phase === 'loading-history' && context.hasInitialPrompt) || // Only show during history load if it's a new app
    (phase === 'ready' && subPhase === 'waiting-for-websocket' && context.hasInitialPrompt && !context.initialPromptSent) ||
    (phase === 'error' && context.hasInitialPrompt) // Show error/retry screen for failed new app creation

  const chatLoaderPhase: 'initializing' | 'deploying' | 'verifying-agent' =
    phase === 'creating' ? 'deploying' :
      (subPhase === 'waiting-for-websocket' || phase === 'error') ? 'verifying-agent' :
        'initializing'

  // Preview loader logic - show from when we're ready to send initial prompt until first file edit
  // This overlay sits on top of PreviewPane's internal "Starting Server" loader
  // Uses isActiveCreationSession (not hasInitialPrompt) because sessionStorage is cleared after prompt is sent
  const showPreviewLoader =
    phase === 'ready' &&
    isActiveCreationSession &&
    !context.hasSeenFirstFileEdit &&
    (subPhase === 'websocket-connected' || subPhase === 'waiting-for-first-edit')

  // Auto-send logic - trigger when websocket connects and we have a prompt
  const shouldAutoSendPrompt =
    phase === 'ready' &&
    subPhase === 'websocket-connected' &&
    context.hasInitialPrompt &&
    !context.initialPromptSent &&
    context.isWebSocketConnected

  // Interaction logic - can interact when ready and websocket connected
  const canInteractWithChat =
    phase === 'ready' &&
    subPhase !== 'waiting-for-websocket' &&
    context.isWebSocketConnected

  // Error logic
  const hasError = phase === 'error' || !!creationError

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
    canRetry: phase === 'error',
  }
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
  // LOCAL STATE (State Machine)
  // -------------------------------------------------------------------------
  const [phase, setPhase] = useState<InitializationPhase>('idle')
  const [subPhase, setSubPhase] = useState<InitializationSubPhase | null>(null)
  const hasInitialized = useRef(false)
  const initializingAppIdRef = useRef<string | null>(null)

  // Initialize initialJobId from sessionStorage on mount
  const [initialJobId, setInitialJobId] = useState<string | null>(() => {
    return getInitialJobIdFromStorage(appId)
  })

  // Track initial creation flow state
  const [initialPromptSent, setInitialPromptSent] = useState(false)
  const [hasSeenFirstFileEdit, setHasSeenFirstFileEdit] = useState(false)
  const [siteNotFound, setSiteNotFound] = useState(false);

  // Track if we're in an active creation flow for THIS page session
  // This is set to true when we detect hasInitialPrompt on mount, and persists in memory
  // even after sessionStorage is cleared (for showing preview loader until first edit)
  const isActiveCreationSession = useRef(false)

  // Timeout for history loading to prevent indefinite hanging
  const historyLoadingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // -------------------------------------------------------------------------
  // STORE SUBSCRIPTIONS (Read-only)
  // -------------------------------------------------------------------------

  // Site creation (internal)
  const creationPhase = useSiteCreationStore((state) => state.phase)
  const creationError = useSiteCreationStore((state) => state.error)
  const retryCount = useSiteCreationStore((state) => state.retryCount)
  const maxRetries = useSiteCreationStore((state) => state.maxRetries)
  const realAppId = useSiteCreationStore((state) => state.realAppId)
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

  const context: InitializationContext = {
    appId,
    initialJobId,
    isJobId,
    site,
    hasConversationHistory: messages.length > 0,
    isWebSocketConnected,
    isStreamingMessage,
    hasSeenFirstFileEdit,
    hasInitialPrompt: checkHasInitialPrompt(initialJobId, appId),
    initialPromptSent,
    // For rebuild mode, prioritize sessionStorage prompt over site.initial_prompt
    initialPromptText: isRebuildModePrompt(initialJobId, appId) 
      ? getStoredInitialPrompt(initialJobId, appId) 
      : (site?.initial_prompt ?? getStoredInitialPrompt(initialJobId, appId)),
    isRebuildModePrompt: isRebuildModePrompt(initialJobId, appId),
  }

  // -------------------------------------------------------------------------
  // COMPUTED UI STATE (Memoized to prevent render loops)
  // -------------------------------------------------------------------------

  const ui = useMemo(
    () => computeUIState(
      phase,
      subPhase,
      context,
      creationError,
      isActiveCreationSession.current
    ),
    [ /* eslint-disable-line react-hooks/exhaustive-deps */
      phase,
      subPhase,
      creationError,
      context,
      appId,
      initialJobId,
      isJobId,
      site,
      messages.length,
      isWebSocketConnected,
      isStreamingMessage,
      hasSeenFirstFileEdit,
      initialPromptSent,
    ]
  )

  // -------------------------------------------------------------------------
  // STATE MACHINE EFFECTS (Existing + New)
  // -------------------------------------------------------------------------

  // Set the active creation session flag when we detect hasInitialPrompt
  // This persists in memory even after sessionStorage is cleared
  useEffect(() => {
    if (context.hasInitialPrompt && !isActiveCreationSession.current) {
      isActiveCreationSession.current = true
    }
  }, [context.hasInitialPrompt, appId, initialJobId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (site?.initial_prompt && site.id) {
      // DON'T overwrite sessionStorage if we're in rebuild mode
      // In rebuild mode, the frontend generates a detailed prompt that should be used
      // instead of the backend's stored initial_prompt
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

  // Store initialJobId when first appId is received or when route changes
  // This captures the original job ID for sessionStorage key lookups, persisting across route changes
  useEffect(() => {
    // If we have a job ID, store it in sessionStorage and state
    if (isJobId && appId) {
      if (appId !== initialJobId) {
        setInitialJobId(appId)
        // Set the creation flow flag when we first see a jobId
        sessionStorage.setItem(`in-creation-flow-${appId}`, 'true')
      }
      return
    }

    // If we have a real app ID, try to get the job ID from sessionStorage
    if (!isJobId && appId) {
      const storedJobId = getInitialJobIdFromStorage(appId)
      if (storedJobId && storedJobId !== initialJobId) {
        setInitialJobId(storedJobId)
      }
    }
  }, [appId, isJobId, initialJobId])

  // Reset initialization flag when appId changes
  // This ensures that when transitioning from job ID → real app ID,
  // the initialization flow (initializePage + loadConversationHistory) runs for the new appId
  useEffect(() => {
    hasInitialized.current = false
  }, [appId])

  // Step 1: Check if this is a new site creation
  useEffect(() => {
    if (!appId) {
      setPhase('idle')
      setSubPhase(null)
      return
    }


    // Reset realAppId from site creation store when navigating to a regular app
    if (!isJobId && realAppId) {
      useSiteCreationStore.getState().reset()
    }

    if (isJobId) {
      setPhase('checking-creation')
      setSubPhase(null)
    } else {
      // Existing site, skip creation phase
      setPhase('initializing-page')
      setSubPhase(null)
    }
  }, [appId, isJobId, realAppId])

  // Step 2: Handle site creation flow
  useEffect(() => {
    if (phase === 'checking-creation' && appId) {
      initializeSite(appId)
      setPhase('creating')
    }
  }, [phase, appId, initializeSite])

  // Step 3: Update URL when we get real app ID
  useEffect(() => {
    if (phase === 'creating' && realAppId && realAppId !== appId) {
      // This ensures we can retrieve the job ID after the component remounts
      const jobId = appId // appId is the job ID at this point
      sessionStorage.setItem(`initial-job-id-${realAppId}`, jobId)
      const initialPromptText = sessionStorage.getItem(`initial-prompt-text-${jobId}`)
      if (initialPromptText) {
        sessionStorage.setItem(`initial-prompt-text-${realAppId}`, initialPromptText)
      }
      router.replace(`/develop/${realAppId}`, { scroll: false })
    }
  }, [phase, realAppId, appId, router])

  // Step 4: Wait for creation to complete, then initialize page
  useEffect(() => {
    if (phase === 'creating' && creationPhase === 'complete') {
      setPhase('initializing-page')
    }
  }, [phase, creationPhase, appId])

  // Step 5: Initialize page (loads site data, websocket, and history)
  // NOTE: initializePage handles WebSocket and conversation loading internally
  useEffect(() => {
    if (phase === 'initializing-page' && appId && !hasInitialized.current) {
      const effectiveAppId = realAppId || appId
      hasInitialized.current = true
      initializingAppIdRef.current = effectiveAppId

      // Reset error states before starting new initialization
      setSiteNotFound(false)

      initializePage(effectiveAppId)
        .then(() => {
          // Only proceed if we're still on the same appId (handles rapid navigation)
          if (initializingAppIdRef.current === effectiveAppId) {
            setPhase('loading-history')
          }
        })
        .catch(error => {
          const errorMessage = error instanceof Error ? error.message : String(error)
          logger.error('initialization.page.error', { appId: effectiveAppId, error: errorMessage })

          // Only update state if we're still on the same appId
          if (initializingAppIdRef.current !== effectiveAppId) {
            return
          }

          if (errorMessage === AppErrorCode.SITE_NOT_FOUND) {
            setSiteNotFound(true);
            return
          }

          setPhase('error')
          setSubPhase(null)
        })
    }
  }, [phase, appId, realAppId, initializePage, router])

  // Step 6: Wait for page loading to complete, then wait for WebSocket history to load
  // History is now loaded via WebSocket (not HTTP) during connection/recovery
  // Step 6a: Wait for server capabilities or timeout, then decide WebSocket vs HTTP
  useEffect(() => {
    if (phase === 'loading-history' && appId && loadingPhase === 'ready') {
      const effectiveAppId = realAppId || appId

      // Case 1: Server explicitly supports WebSocket history
      if (serverCapabilities?.supportsWebSocketHistory === true) {
        logger.debug('initialization.history.websocket', {
          appId: effectiveAppId,
          message: 'Server supports WebSocket history, waiting for history_complete'
        })
        // WebSocket history loading is handled by HistoryMessageHandler and HistoryCompleteHandler
        return
      }

      // Case 2: Server doesn't support WebSocket history (false, undefined, or null)
      // - false: Agent explicitly indicates no support (Jan 13+ with historyProvider undefined)
      // - undefined: Agent sends server_config without supportsWebSocketHistory field (Jan 7 - Jan 13)
      // - null: No server_config received at all (pre-Dec 30, 2025)
      // All cases require HTTP fallback
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
      triggerHttpFallback(effectiveAppId)
      return
    }
  }, [phase, appId, realAppId, loadingPhase, serverCapabilities])

  // Helper function to trigger HTTP fallback for old agents
  const triggerHttpFallback = async (effectiveAppId: string) => {
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
        if (!conversationId) {
          logger.debug('initialization.history.finding_latest', {
            appId: effectiveAppId,
            message: 'No conversationId, fetching latest conversation'
          })
          const latestConversation = await agentService.getLatestConversation(effectiveAppId)
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
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Differentiate error types for better debugging
      const is404 = errorMessage.includes('404')
      const isAuth = errorMessage.includes('401') || errorMessage.includes('403')
      const isNetwork = errorMessage.includes('fetch') || errorMessage.includes('network')

      const logLevel = is404 ? 'warn' : 'error'
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

  // Step 7: Wait for history loading to complete (via WebSocket)
  useEffect(() => {
    if (phase === 'loading-history' && historyLoadingComplete) {
      const effectiveAppId = realAppId || appId

      logger.debug('initialization.history.complete', {
        appId: effectiveAppId,
        message: 'WebSocket history loading complete'
      })

      // Clear timeout if history completes normally
      if (historyLoadingTimeoutRef.current) {
        clearTimeout(historyLoadingTimeoutRef.current)
        historyLoadingTimeoutRef.current = null
      }

      // Only proceed if we're still on the same appId
      if (initializingAppIdRef.current !== effectiveAppId) {
        return
      }

      setPhase('ready')
      // Determine initial subPhase based on context
      if (context.hasInitialPrompt && !context.initialPromptSent) {
        setSubPhase('waiting-for-websocket')
      } else {
        setSubPhase('active')
      }
    }
  }, [phase, historyLoadingComplete, appId, realAppId, context.hasInitialPrompt, context.initialPromptSent])

  // Step 7a: Set timeout for history loading (30 seconds)
  useEffect(() => {
    if (phase === 'loading-history' && appId && loadingPhase === 'ready') {
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

        // Only proceed if we're still on the same appId
        if (initializingAppIdRef.current !== effectiveAppId) {
          return
        }

        // Proceed to ready state even without history
        setPhase('ready')
        if (context.hasInitialPrompt && !context.initialPromptSent) {
          setSubPhase('waiting-for-websocket')
        } else {
          setSubPhase('active')
        }
      }, 30000) // 30 seconds

      return () => {
        if (historyLoadingTimeoutRef.current) {
          clearTimeout(historyLoadingTimeoutRef.current)
          historyLoadingTimeoutRef.current = null
        }
      }
    }
  }, [phase, appId, realAppId, loadingPhase, context.hasInitialPrompt, context.initialPromptSent])

  // Step 7b: Handle WebSocket errors during history loading
  useEffect(() => {
    if (phase === 'loading-history' && webSocketError) {
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

      // Only proceed if we're still on the same appId
      if (initializingAppIdRef.current !== effectiveAppId) {
        return
      }

      // Handle APP_NOT_FOUND specially - already handled by other effect
      if (webSocketError.type === 'APP_NOT_FOUND') {
        return
      }

      // For other errors, proceed to ready state with degraded functionality
      setPhase('ready')
      if (context.hasInitialPrompt && !context.initialPromptSent) {
        setSubPhase('waiting-for-websocket')
      } else {
        setSubPhase('active')
      }
    }
  }, [phase, webSocketError, appId, realAppId, context.hasInitialPrompt, context.initialPromptSent])

  // NEW: Track WebSocket connection state transitions
  useEffect(() => {
    if (phase !== 'ready') return

    if (isWebSocketConnected) {
      if (subPhase === 'waiting-for-websocket') {
        setSubPhase('websocket-connected')
      }
    } else {
      // Only show loader if we're in initial creation flow
      if (context.hasInitialPrompt && !context.initialPromptSent) {
        if (subPhase !== 'waiting-for-websocket') {
          setSubPhase('waiting-for-websocket')
        }
      }
    }
  }, [phase, subPhase, isWebSocketConnected, context.hasInitialPrompt, context.initialPromptSent, appId])

  // Auto-exit creation flow when app is demonstrably ready
  // NOTE: This should NOT run during an active creation session where we want to send the initial prompt
  // Only runs for edge cases like navigation away and back, or reconnection scenarios
  useEffect(() => {
    if (phase !== 'ready' || !context.hasInitialPrompt || context.initialPromptSent || !isWebSocketConnected) {
      return
    }

    // Don't auto-exit if we're in an active creation session - let the auto-send handle it
    if (isActiveCreationSession.current) {
      return
    }

    logger.info('initialization.auto-exit-creation', { appId })

    if (context.initialJobId) {
      sessionStorage.removeItem(`initial-prompt-pending-${context.initialJobId}`)
      sessionStorage.removeItem(`in-creation-flow-${context.initialJobId}`)
    }

    setInitialPromptSent(true)
    setSubPhase('active')
  }, [phase, context.hasInitialPrompt, context.initialPromptSent, isWebSocketConnected, context.initialJobId, appId])

  // Handle WebSocket errors - set siteNotFound for inline error display
  useEffect(() => {
    if (webSocketError?.type === 'APP_NOT_FOUND') {
      setSiteNotFound(true)
    }
  }, [webSocketError, appId])

  // NEW: Track first file edit
  useEffect(() => {
    if (hasSeenFirstFileEdit) return

    const completedFileEdit = activeStream?.toolCalls.find(
      tc => tc.name === 'fileEdit' && tc.status === 'completed' && !tc.error
    )

    if (completedFileEdit) {
      setHasSeenFirstFileEdit(true)
    }
  }, [activeStream, hasSeenFirstFileEdit, appId])

  // Transition to active after first file edit
  useEffect(() => {
    if (subPhase === 'waiting-for-first-edit' && context.hasSeenFirstFileEdit) {
      setSubPhase('active')
    }
  }, [subPhase, context.hasSeenFirstFileEdit, appId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isJobId) {
        cleanupSiteCreationStore()
      }
      hasInitialized.current = false

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
      setPhase('checking-creation')
      setSubPhase(null)
      retryCreation()
    },

    cancel: () => {
      cleanupSiteCreationStore()
      router.push('/')
    },

    markInitialPromptSent: () => {
      setInitialPromptSent(true)
      setSubPhase('waiting-for-first-edit')
      if (initialJobId) {
        // Clear both flags - creation flow is complete once message is sent
        sessionStorage.removeItem(`initial-prompt-pending-${initialJobId}`)
        sessionStorage.removeItem(`in-creation-flow-${initialJobId}`)
        sessionStorage.removeItem(`initial-prompt-text-${initialJobId}`)
      }
      if (appId) {
        sessionStorage.removeItem(`initial-prompt-text-${appId}`)
      }
    },

    markFirstFileEditSeen: () => {
      setHasSeenFirstFileEdit(true)
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
      phase,
      subPhase,
      isReady: phase === 'ready' && subPhase === 'active',
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
    phase,
    subPhase,
    appId,
    isWebSocketConnected,
    context.hasInitialPrompt,
    context.initialPromptSent,
    context.hasSeenFirstFileEdit,
    ui.showChatLoader,
    ui.showPreviewLoader,
    ui.shouldAutoSendPrompt,
    ui.canInteractWithChat
  ])

  // Debug logging specifically for preview loader state (only when hasInitialPrompt is true)
  useEffect(() => {
    if (!context.hasInitialPrompt) return

    logger.debug('initialization.preview-loader.state', {
      showPreviewLoader: ui.showPreviewLoader,
      phase,
      subPhase,
      hasSeenFirstFileEdit: context.hasSeenFirstFileEdit,
      conditions: {
        phaseReady: phase === 'ready',
        correctSubPhase: subPhase === 'websocket-connected' || subPhase === 'waiting-for-first-edit',
        notSeenEdit: !context.hasSeenFirstFileEdit
      }
    })
  }, [
    phase,
    subPhase,
    context.hasInitialPrompt,
    context.hasSeenFirstFileEdit,
    ui.showPreviewLoader
  ])

  // -------------------------------------------------------------------------
  // RETURN API
  // -------------------------------------------------------------------------

  return {
    phase,
    subPhase,
    isReady: phase === 'ready' && subPhase === 'active',
    siteNotFound,
    context,
    ui,
    actions,

    // Legacy compatibility (deprecated)
    showCreationLoader: phase === 'checking-creation' || phase === 'creating',
    creationError,
    retryCount,
    maxRetries,
    onRetry: handleRetry,
    onCancel: handleCancel,
    initialJobId,
  }
}

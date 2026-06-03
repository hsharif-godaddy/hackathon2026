import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useMachine } from '@xstate/react'

import { getStoredUploadedFiles } from '@/lib/quick-create'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { cleanupSiteCreationStore, useSiteCreationStore } from '@/stores/useSiteCreationStore'
import type { Site } from '@/stores/useSitesStore'
import {
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import { useTodoListStore } from '@/stores/useTodoListStore'
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

// Cross-session re-send guard: site.initial_prompt persists forever in mgmt-airo, so on
// refresh the BFF response is identical to a first-time DPP redirect. See PR #3925.
const AUTO_SENT_FLAG_PREFIX = 'initial-prompt-auto-sent-'

function getInitialPromptAutoSentFlag(appId: string | null): boolean {
  if (typeof window === 'undefined' || !appId) return false
  try {
    return localStorage.getItem(`${AUTO_SENT_FLAG_PREFIX}${appId}`) === 'true'
  } catch (err) {
    logger.warn('develop-page.auto-sent-flag.read-failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

function setInitialPromptAutoSentFlag(appId: string | null): void {
  if (typeof window === 'undefined' || !appId) return
  try {
    localStorage.setItem(`${AUTO_SENT_FLAG_PREFIX}${appId}`, 'true')
  } catch (err) {
    logger.warn('develop-page.auto-sent-flag.write-failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Site-aware hydration predicate for cold external redirects (DPP). Each gate guards a
// distinct regression — see docs/plans/2026-05-25-dpp-hydration-race-creation-handoff-bypass.md.
export function shouldHydrateInitialPromptFromSite(
  appId: string | null,
  hasInitialPromptInContext: boolean,
  site: Site | null,
  realAppId: string | null,
): boolean {
  if (!appId) return false
  if (hasInitialPromptInContext) return false
  if (!isSiteForCurrentApp(site, appId, realAppId)) return false
  if (!site.initial_prompt) return false
  if (getInitialPromptAutoSentFlag(site.id)) return false
  return true
}

// Conversation-history gate. fromCreationHandoff bypasses historyLoadingComplete because
// the URL flip resets it on a single non-reconnecting WS. See plan doc for the race
// matrix and why the previous !hasConversationCookie short-circuit (PR #4074) was racy.
export function shouldFireSiteAwareHydration(
  historyLoadingComplete: boolean,
  hasMessages: boolean,
  fromCreationHandoff: boolean = false,
): boolean {
  if (hasMessages) return false
  if (fromCreationHandoff) return true
  if (!historyLoadingComplete) return false
  return true
}

// In-session creation handoff signal. The ref is wiped by the loading.tsx Suspense remount
// on URL flip jobId→realAppId, so the sessionStorage marker is the cross-remount fallback.
// Either branch alone must keep the bypass live — a regression that drops one would silently
// re-introduce the deadlock for whichever path it covers.
export function isInCreationHandoff(
  appId: string | null,
  jobIdToRealAppId: { realAppId: string | null } | null,
): boolean {
  if (!appId) return false
  if (jobIdToRealAppId?.realAppId === appId) return true
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(`initial-job-id-${appId}`) !== null
}

// Storage side-effects of markInitialPromptSent. Extracted for unit-testability.
export function applyMarkInitialPromptSentEffects(
  initialJobId: string | null,
  appId: string | null,
): void {
  if (typeof window === 'undefined') return
  if (initialJobId) {
    sessionStorage.removeItem(`initial-prompt-pending-${initialJobId}`)
    sessionStorage.removeItem(`in-creation-flow-${initialJobId}`)
    sessionStorage.removeItem(`initial-prompt-text-${initialJobId}`)
    sessionStorage.removeItem(`initial-template-${initialJobId}`)
    sessionStorage.removeItem(`initial-upload-file-${initialJobId}`)
    sessionStorage.removeItem(`initial-upload-files-${initialJobId}`)
  }
  if (appId) {
    sessionStorage.removeItem(`initial-prompt-text-${appId}`)
    sessionStorage.removeItem(`initial-template-${appId}`)
    sessionStorage.removeItem(`initial-upload-file-${appId}`)
    sessionStorage.removeItem(`initial-upload-files-${appId}`)
    // Clear the creation-handoff marker so subsequent same-tab reloads rely on the strict gate.
    sessionStorage.removeItem(`initial-job-id-${appId}`)
    setInitialPromptAutoSentFlag(appId)
  }
}

// True when sessionStorage flags are set (home flow) OR site.initial_prompt is populated
// for the current app and the auto-sent guard is unset (cold external redirect).
export function checkHasInitialPrompt(
  initialJobId: string | null,
  appId: string | null,
  site: Site | null,
  realAppId: string | null,
): boolean {
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

  // Site-aware fallback for cold external redirects, gated by the cross-session re-send guard.
  if (
    isSiteForCurrentApp(site, appId, realAppId) &&
    !!site.initial_prompt &&
    !getInitialPromptAutoSentFlag(site.id)
  ) {
    return true
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

function getStoredTemplateId(initialJobId: string | null, appId: string | null): string | null {
  if (typeof window === 'undefined') return null
  if (initialJobId) {
    const tmpl = sessionStorage.getItem(`initial-template-${initialJobId}`)
    if (tmpl) return tmpl
  }
  if (appId) {
    return sessionStorage.getItem(`initial-template-${appId}`)
  }
  return null
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
  templateId: string | null
  uploadedFiles: Array<{ name: string; content: string; isDesignMd: boolean; isZip?: boolean; isUiKit?: boolean; isAppImport?: boolean; isImage?: boolean }>

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
// FILE EDIT DETECTION HELPERS (exported for testing)
// ============================================================================

const FILE_EDIT_TOOLS = new Set(['str_replace_based_edit_tool', 'textEditor', 'fileEdit'])

/** Check if a tool call is a completed, non-view file edit */
export function isCompletedFileEdit(tc: { name: string; status: string; error?: string; input?: Record<string, unknown> }): boolean {
  if (!FILE_EDIT_TOOLS.has(tc.name) || tc.status !== 'completed' || tc.error) return false
  if (tc.input?.command === 'view') return false
  return true
}

/** Extract file paths from a tool call input, handling all known shapes */
export function getEditPaths(tc: { input?: Record<string, unknown> }): string[] {
  if (!tc.input) return []
  const paths: string[] = []
  if (typeof tc.input.path === 'string') paths.push(tc.input.path)
  if (typeof tc.input.file_path === 'string') paths.push(tc.input.file_path)
  if (Array.isArray(tc.input.operations)) {
    for (const op of tc.input.operations) {
      if (op && typeof op === 'object' && typeof (op as Record<string, unknown>).path === 'string') {
        paths.push((op as Record<string, unknown>).path as string)
      }
    }
  }
  return paths
}

/**
 * Check if the loaded site corresponds to the app we're currently viewing.
 *
 * The `useDevelopPageStore.site` is a global zustand store that persists across
 * navigations — when you leave one app and open another, the old site object is
 * still in memory until `initializePage` replaces it. During the jobId stage of
 * a newly-created app (before job→app conversion completes) the store can hold
 * the *previous* app's site, whose `initial_prompt` must NOT be shown for the
 * new app.
 *
 * `realAppId` is safe to consult here because `useSiteCreationStore.reset()`
 * clears it both (a) when navigating to a real app page (`!isJobId && realAppId`
 * effect) and (b) at the start of every new creation via `initializeSite`. So
 * by the time we're rendering a new creation flow it cannot leak from a prior
 * session in normal use.
 *
 * Type-predicate signature lets the caller drop optional chaining on `site`
 * inside the `true` branch.
 *
 * Exported for testing.
 */
export function isSiteForCurrentApp<T extends { id: string }>(
  site: T | null | undefined,
  appId: string | null,
  realAppId: string | null,
): site is T {
  if (!site) return false
  if (appId && site.id === appId) return true
  if (realAppId && site.id === realAppId) return true
  return false
}

/**
 * Clear stale streaming state and todo list when navigating to an app the
 * streaming store does not currently track. Without this, the job-id stage of
 * a second creation briefly shows the previous app's NBAs and todo list before
 * `initializePage` runs.
 *
 * Returns true when a reset occurred. Exported for testing.
 */
export function resetStaleAppContext(
  streamingStore: { currentAppId: string | null; setCurrentAppId: (id: string) => void },
  todoListStore: { reset: () => void },
  appId: string,
): boolean {
  if (streamingStore.currentAppId === appId) return false
  streamingStore.setCurrentAppId(appId)
  todoListStore.reset()
  return true
}

/**
 * True when a temporary job route should be replaced with its resolved app id.
 * The creation state machine can leave `creating` before React runs URL-sync
 * effects, so this predicate intentionally depends on URL identity rather than
 * machine phase.
 *
 * Exported for testing.
 */
export function shouldReplaceJobRoute(appId: string | null, isJobId: boolean, realAppId: string | null): boolean {
  return Boolean(isJobId && appId && realAppId && realAppId !== appId)
}

/**
 * True from the moment a creation flow begins (sessionStorage flag set on the
 * homepage) until the auto-send actually starts streaming. Covers the job-id
 * stage and the post-switch waitingForWebSocket → first-chunk window, letting
 * `ChatInput` render a disabled stop button instead of a misleading send
 * button before the stream actually starts.
 *
 * Dropping `!initialPromptSent` would keep this true after the first prompt
 * completes, leaving the stop button stuck visible. Exported for testing.
 */
export function deriveIsAwaitingStream(
  hasInitialPrompt: boolean,
  initialPromptSent: boolean,
  isStreaming: boolean,
): boolean {
  return hasInitialPrompt && !initialPromptSent && !isStreaming
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
      state.matches('checkingCreation') ||
      state.matches('creating') ||
      state.matches('initializingPage') ||
      state.matches({ ready: 'waitingForWebSocket' }) ||
      state.matches({ ready: 'websocketConnected' }) ||
      state.matches({ ready: 'waitingForFirstEdit' })
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
    templateId: getStoredTemplateId(context.initialJobId, context.appId),
    uploadedFiles: getStoredUploadedFiles(context.initialJobId, context.appId),

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
  // First-render hydration: site/realAppId are not yet read here (see below),
  // so we pass null. The site-aware branch is picked up later by the dedicated
  // effect that watches `site.initial_prompt` and dispatches HYDRATE_APP.
  const [state, send] = useMachine(initializationMachine, {
    input: {
      appId,
      isJobId,
      hasInitialPrompt: checkHasInitialPrompt(getInitialJobIdFromStorage(appId), appId, null, null),
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

  // Track if we're in an active creation flow for THIS page session.
  //
  // Synced to context.hasInitialPrompt and re-synced on appId change (DPP
  // job ID → real app ID URL flip). The previous two-effect form (reset on
  // appId change, set-only on hasInitialPrompt change) had a stale-ref race:
  // on URL flip the appId effect cleared the ref to false, but
  // hasInitialPrompt was unchanged across the flip (the machine context
  // persists), so the second effect skipped — leaving the ref false for
  // the rest of the session. That hid showPreviewLoader, so the bare
  // template iframe was visible while the agent worked.
  const isActiveCreationSession = useRef(false)
  useEffect(() => {
    isActiveCreationSession.current = state.context.hasInitialPrompt
  }, [appId, state.context.hasInitialPrompt])

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
  const initializePage = useDevelopPageStore((state) => state.initializePage)

  // Streaming/WebSocket
  const isWebSocketConnected = useStreamingConversationStore((state) => state.websocket.connected)
  const webSocketError = useStreamingConversationStore((state) => state.websocket.error)
  const isStreamingMessage = useStreamingConversationStore((state) => state.isLoading)
  const messages = useStreamingConversationStore((state) => state.messages)
  const activeStream = useStreamingConversationStore((state) => state.activeStream)
  const historyLoadingComplete = useStreamingConversationStore((state) => state.historyLoadingComplete)
  // -------------------------------------------------------------------------
  // DERIVED STATE (Context)
  // -------------------------------------------------------------------------

  // Get current initialJobId from machine context or sessionStorage
  const initialJobId = state.context.initialJobId || getInitialJobIdFromStorage(appId)

  // Only trust site.initial_prompt when the loaded site matches the current app.
  // The site store persists across navigations, so during the jobId stage of a NEW
  // app it can still hold the previous app's data (and prompt). Without this guard,
  // the freshly-stored sessionStorage prompt for the new job would be shadowed by
  // the stale site.initial_prompt until the page initialization replaces it.
  const sitePromptForCurrentApp = isSiteForCurrentApp(site, appId, realAppId)
    ? site.initial_prompt
    : null

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
      : (sitePromptForCurrentApp ?? getStoredInitialPrompt(initialJobId, appId)),
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

    // Clear stale streaming state (messages, NBAs, activeStream) and todo list
    // from a previously-viewed app the moment we land on a new URL. Without
    // this, the job-id stage of a second creation briefly shows the first
    // app's NBAs and todo list before initializePage runs.
    const streamingStoreState = useStreamingConversationStore.getState()
    const previousAppId = streamingStoreState.currentAppId
    const wasReset = resetStaleAppContext(
      streamingStoreState,
      useTodoListStore.getState(),
      appId,
    )
    if (wasReset) {
      logger.info('initialization.stale-app-context.reset', { previousAppId, appId })
    }

    // Reset store when navigating to regular app
    if (!isJobId && realAppId) {
      useSiteCreationStore.getState().reset()
    }

    // Hydrate hasInitialPrompt from sessionStorage + site for post-RESET re-initialization
    const hydratedHasInitialPrompt = checkHasInitialPrompt(initialJobId, appId, site, realAppId)

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
    if (shouldReplaceJobRoute(appId, isJobId, realAppId)) {
      const jobId = appId
      sessionStorage.setItem(`initial-job-id-${realAppId}`, jobId)
      const initialPromptText = sessionStorage.getItem(`initial-prompt-text-${jobId}`)
      if (initialPromptText) {
        sessionStorage.setItem(`initial-prompt-text-${realAppId}`, initialPromptText)
      }
      router.replace(`/develop/${realAppId}`, { scroll: false })
    }
  }, [realAppId, appId, isJobId, router])

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

  // Site-aware hydration for cold external redirects (DPP). See plan doc for the gate matrix.
  useEffect(() => {
    if (!appId) return
    const fromCreationHandoff = isInCreationHandoff(appId, jobIdToRealAppIdRef.current)
    if (!shouldFireSiteAwareHydration(historyLoadingComplete, messages.length > 0, fromCreationHandoff)) return
    if (!shouldHydrateInitialPromptFromSite(appId, state.context.hasInitialPrompt, site, realAppId)) return
    send({ type: 'HYDRATE_APP', appId, isJobId, hasInitialPrompt: true })
  }, [appId, isJobId, realAppId, site, state.context.hasInitialPrompt, historyLoadingComplete, messages.length, send])

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

  // EFFECT: Track first meaningful file edit for the "big reveal"
  // During initial build the agent sets up fonts, colors, header, footer before building the page.
  // We wait for a page file edit (src/pages/) or suggestedResponse (after any edit) to reveal,
  // so the user sees the finished page rather than intermediate scaffolding.
  useEffect(() => {
    if (state.context.hasSeenFirstFileEdit) return

    const toolCalls = activeStream?.toolCalls ?? []

    // Reveal on homepage file edit (src/pages/index)
    const hasPageFileEdit = toolCalls.some(
      tc => isCompletedFileEdit(tc) && getEditPaths(tc).some(p => p.includes('src/pages/index'))
    )

    // Reveal on suggestedResponse if any file edit has already completed
    const hasAnyFileEdit = toolCalls.some(tc => isCompletedFileEdit(tc))
    const hasSuggestedResponse = toolCalls.some(
      tc => tc.name === 'suggestedResponse' && tc.status === 'completed'
    )

    if (hasPageFileEdit || (hasAnyFileEdit && hasSuggestedResponse)) {
      send({ type: 'FIRST_FILE_EDIT_SEEN' })
    }
  }, [state.context.hasSeenFirstFileEdit, activeStream, send])

  // EFFECT: Reset failsafe timeout on agent activity
  // When the agent is actively working (new tool calls, new text segments), reset the 5-min
  // failsafe so it only fires after 5 minutes of *inactivity*, not 5 minutes total.
  // We track segments.length because it changes on both new tool calls AND new text content,
  // covering long-running tools and streaming text that don't change toolCalls.length.
  const lastActivitySegmentCountRef = useRef(0)
  const isWaitingForFirstEdit = state.matches({ ready: 'waitingForFirstEdit' })
  useEffect(() => {
    if (!isWaitingForFirstEdit) {
      lastActivitySegmentCountRef.current = 0
      return
    }

    const segmentCount = activeStream?.segments?.length ?? 0
    if (segmentCount > 0 && segmentCount !== lastActivitySegmentCountRef.current) {
      lastActivitySegmentCountRef.current = segmentCount
      send({ type: 'AGENT_ACTIVITY' })
    }
  }, [isWaitingForFirstEdit, activeStream?.segments?.length, send])

  // EFFECT: Reset failsafe timeout on user interaction with askQuestion widget
  // The agent goes quiet while it waits for the user to answer multi-step
  // askQuestion flows, so segment-count tracking above never fires and the
  // 5-min failsafe can dismiss the "Building" overlay mid-flow. Any consumer
  // (currently AskQuestionToolRenderer) dispatches `airo:user-activity` on
  // step advance / back / submit, and we treat that the same as agent
  // activity: re-enter `waitingForFirstEdit` to reset the `after` timer.
  useEffect(() => {
    if (!isWaitingForFirstEdit) return
    const onUserActivity = () => {
      send({ type: 'AGENT_ACTIVITY' })
    }
    window.addEventListener('airo:user-activity', onUserActivity)
    return () => {
      window.removeEventListener('airo:user-activity', onUserActivity)
    }
  }, [isWaitingForFirstEdit, send])

  // EFFECT: When stream completes with incomplete tools only (e.g. token limit),
  // transition to active so the "Building your App" overlay hides and the user sees the preview.
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
      tc => isCompletedFileEdit(tc)
    )
    if (hasCompletedFileEdit) return

    // File edit tools and terminalCommand can indicate "stream done but user may still see a first edit":
    // they are the tools that modify workspace (files/shell). Other tools (e.g. read_file, list_dir)
    // don't justify hiding the "waiting for first edit" overlay.
    const hasIncompleteFileEditOrTerminal = lastAssistant.toolCalls?.some(
      tc => tc.status === 'incomplete' && (FILE_EDIT_TOOLS.has(tc.name) || tc.name === 'terminalCommand')
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
      applyMarkInitialPromptSentEffects(initialJobId, appId)
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

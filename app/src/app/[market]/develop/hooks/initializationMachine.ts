/**
 * XState Initialization State Machine
 *
 * Manages the entire develop page initialization lifecycle including:
 * - Site creation flow (job → app conversion)
 * - Page data loading
 * - Conversation history loading
 * - WebSocket connection tracking
 * - Initial prompt auto-send coordination
 * - Preview overlay management
 *
 * Architecture:
 * - Hierarchical states: main phases + ready sub-phases
 * - Guards: conditional transitions (isJobId, hasInitialPrompt, etc.)
 * - Actions: context updates (assign), logging
 * - Type-safe events for all state transitions
 *
 * External effects (handled by hook):
 * - API calls (site creation, page loading)
 * - Store synchronization
 * - sessionStorage management
 * - Router navigation
 */

import { type ActorRefFrom, assign, setup, type SnapshotFrom } from 'xstate'

import { logger } from '@/lib/request-context'

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Timeout for waiting for first file edit after prompt is sent
 * If agent crashes or never responds, transition to active after this timeout
 */
const FIRST_EDIT_TIMEOUT_MS = 600000 // 10 minutes

// ============================================================================
// TYPES
// ============================================================================

/**
 * Machine context - all data needed for state transitions
 */
export interface InitializationMachineContext {
  // IDs
  appId: string | null
  initialJobId: string | null
  realAppId: string | null

  // Flags
  isJobId: boolean
  hasInitialPrompt: boolean
  initialPromptSent: boolean
  hasSeenFirstFileEdit: boolean

  // Data
  initialPromptText: string | null

  // Error tracking
  error: string | null
  retryCount: number
  maxRetries: number
}

/**
 * Machine events - all possible state transitions
 */
export type InitializationMachineEvent =
  // Initialization triggers
  | { type: 'START_CHECKING_CREATION'; appId: string; isJobId: boolean; hasInitialPrompt?: boolean }
  | { type: 'SKIP_TO_PAGE_INIT'; appId: string; hasInitialPrompt?: boolean }

  // Context hydration (for job→app transition or site-loaded initial-prompt sync)
  | { type: 'HYDRATE_APP'; appId: string; isJobId: boolean; hasInitialPrompt?: boolean }

  // Creation flow
  | { type: 'START_CREATING'; jobId: string; initialPromptText: string }
  | { type: 'CREATION_SUCCEEDED'; realAppId: string }
  | { type: 'CREATION_FAILED'; error: string }
  | { type: 'RETRY_CREATION' }

  // Page initialization
  | { type: 'PAGE_DATA_LOADED' }
  | { type: 'PAGE_DATA_FAILED'; error: string }

  // WebSocket coordination
  | { type: 'WEBSOCKET_CONNECTED' }
  | { type: 'WEBSOCKET_DISCONNECTED' }

  // Prompt flow
  | { type: 'PROMPT_SENT' }

  // Agent activity
  | { type: 'FIRST_FILE_EDIT_SEEN' }
  // Stream finished but no successful file edit (e.g. due to incomplete tool calls like token limit) - hide building overlay
  | { type: 'STREAM_COMPLETE_WITHOUT_FIRST_EDIT' }
  // Agent is actively working (new tool calls, streaming) - resets failsafe timeout
  | { type: 'AGENT_ACTIVITY' }

  // Error recovery
  | { type: 'FATAL_ERROR'; error: string }
  | { type: 'RESET' }

// ============================================================================
// MACHINE DEFINITION
// ============================================================================

export const initializationMachine = setup({
  types: {
    context: {} as InitializationMachineContext,
    events: {} as InitializationMachineEvent,
    input: {} as {
      appId: string | null
      isJobId: boolean
      hasInitialPrompt: boolean
    },
  },

  actions: {
    // Context updates
    setAppId: assign({
      appId: ({ event }) => {
        if (
          event.type === 'START_CHECKING_CREATION' ||
          event.type === 'SKIP_TO_PAGE_INIT' ||
          event.type === 'HYDRATE_APP'
        ) {
          return event.appId
        }
        return null
      },
      isJobId: ({ event }) => {
        if (event.type === 'START_CHECKING_CREATION' || event.type === 'HYDRATE_APP') {
          return event.isJobId
        }
        return false
      },
      hasInitialPrompt: ({ event, context }) => {
        // Re-hydrate hasInitialPrompt from event if provided (for post-RESET initialization)
        if (event.type === 'START_CHECKING_CREATION' || event.type === 'SKIP_TO_PAGE_INIT') {
          return event.hasInitialPrompt ?? context.hasInitialPrompt
        }
        // HYDRATE_APP can promote false → true when site loads with initial_prompt
        // (e.g. cold external redirect like DPP). It must not clear hasInitialPrompt
        // after PROMPT_SENT, so we only honour an explicit true value.
        if (event.type === 'HYDRATE_APP') {
          return event.hasInitialPrompt === true ? true : context.hasInitialPrompt
        }
        return context.hasInitialPrompt
      },
    }),

    setJobId: assign({
      initialJobId: ({ event }) => {
        if (event.type === 'START_CREATING') {
          return event.jobId
        }
        return null
      },
    }),

    setRealAppId: assign({
      realAppId: ({ event }) => {
        if (event.type === 'CREATION_SUCCEEDED') {
          return event.realAppId
        }
        return null
      },
    }),

    setInitialPrompt: assign({
      hasInitialPrompt: ({ event }) => {
        // Set to true for any START_CREATING event, even if prompt is empty
        // The creation flow itself is what matters, not the prompt text
        if (event.type === 'START_CREATING') {
          return true
        }
        return false
      },
      initialPromptText: ({ event }) => {
        if (event.type === 'START_CREATING') {
          return event.initialPromptText || null
        }
        return null
      },
    }),

    markPromptSent: assign({
      initialPromptSent: true,
    }),

    markFirstFileEditSeen: assign({
      hasSeenFirstFileEdit: true,
    }),

    setError: assign({
      error: ({ event }) => {
        if (
          event.type === 'CREATION_FAILED' ||
          event.type === 'PAGE_DATA_FAILED' ||
          event.type === 'FATAL_ERROR'
        ) {
          return event.error
        }
        return null
      },
    }),

    clearError: assign({
      error: null,
    }),

    incrementRetryCount: assign({
      retryCount: ({ context }) => context.retryCount + 1,
    }),

    resetRetryCount: assign({
      retryCount: 0,
    }),

    // Logging actions
    logTransition: ({ context, event }) => {
      logger.info('initialization.transition', {
        event: event.type,
        appId: context.appId,
        isJobId: context.isJobId,
        hasInitialPrompt: context.hasInitialPrompt,
      })
    },

    logError: ({ context, event }) => {
      if (
        event.type === 'CREATION_FAILED' ||
        event.type === 'PAGE_DATA_FAILED' ||
        event.type === 'FATAL_ERROR'
      ) {
        logger.error('initialization.error', {
          event: event.type,
          error: event.error,
          appId: context.appId,
          retryCount: context.retryCount,
        })
      }
    },

    logFirstEditTimeout: ({ context }) => {
      logger.warn('initialization.first_edit.timeout', {
        appId: context.appId,
        message: 'Timeout waiting for first file edit after 10 minutes, proceeding to active state',
      })
    },

    // Reset all context to initial values
    resetContext: assign({
      appId: null,
      initialJobId: null,
      realAppId: null,
      isJobId: false,
      hasInitialPrompt: false,
      initialPromptSent: false,
      hasSeenFirstFileEdit: false,
      initialPromptText: null,
      error: null,
      retryCount: 0,
    }),
  },

  guards: {
    isJobId: ({ context }) => context.isJobId,

    hasInitialPrompt: ({ context }) => context.hasInitialPrompt,

    canRetry: ({ context }) => context.retryCount < context.maxRetries,

    hasSeenFirstFileEdit: ({ context }) => context.hasSeenFirstFileEdit,
  },
}).createMachine({
  id: 'initialization',
  initial: 'idle',

  context: ({ input }) => ({
    appId: input?.appId ?? null,
    initialJobId: null,
    realAppId: null,
    isJobId: input?.isJobId ?? false,
    hasInitialPrompt: input?.hasInitialPrompt ?? false,
    initialPromptSent: false,
    hasSeenFirstFileEdit: false,
    initialPromptText: null,
    error: null,
    retryCount: 0,
    maxRetries: 3,
  }),

  states: {
    // -------------------------------------------------------------------------
    // IDLE - Initial state
    // -------------------------------------------------------------------------
    idle: {
      on: {
        START_CHECKING_CREATION: {
          target: 'checkingCreation',
          actions: ['setAppId', 'logTransition'],
        },
        SKIP_TO_PAGE_INIT: {
          target: 'initializingPage',
          actions: ['setAppId', 'logTransition'],
        },
      },
    },

    // -------------------------------------------------------------------------
    // CHECKING CREATION - Determine if job needs conversion
    // -------------------------------------------------------------------------
    checkingCreation: {
      on: {
        START_CREATING: {
          target: 'creating',
          actions: ['setJobId', 'setInitialPrompt', 'logTransition'],
        },
        SKIP_TO_PAGE_INIT: {
          target: 'initializingPage',
          actions: ['logTransition'],
        },
      },
    },

    // -------------------------------------------------------------------------
    // CREATING - Converting job to app
    // -------------------------------------------------------------------------
    creating: {
      on: {
        CREATION_SUCCEEDED: {
          target: 'initializingPage',
          actions: ['setRealAppId', 'resetRetryCount', 'logTransition'],
        },
        CREATION_FAILED: [
          {
            guard: 'canRetry',
            target: 'creating',
            actions: ['setError', 'incrementRetryCount', 'logError'],
          },
          {
            target: 'error',
            actions: ['setError', 'logError'],
          },
        ],
        RETRY_CREATION: {
          target: 'creating',
          actions: ['clearError', 'logTransition'],
        },
      },
    },

    // -------------------------------------------------------------------------
    // INITIALIZING PAGE - Loading page data
    // -------------------------------------------------------------------------
    initializingPage: {
      on: {
        PAGE_DATA_LOADED: {
          target: 'ready',
          actions: ['logTransition'],
        },
        PAGE_DATA_FAILED: {
          target: 'error',
          actions: ['setError', 'logError'],
        },
      },
    },

    // -------------------------------------------------------------------------
    // READY - App ready, manage WebSocket/prompt coordination
    // -------------------------------------------------------------------------
    ready: {
      type: 'compound',
      initial: 'determiningSubPhase',

      states: {
        // Determine initial sub-phase based on context
        determiningSubPhase: {
          always: [
            {
              guard: 'hasInitialPrompt',
              target: 'waitingForWebSocket',
            },
            {
              target: 'active',
            },
          ],
        },

        // Waiting for WebSocket to connect
        waitingForWebSocket: {
          on: {
            WEBSOCKET_CONNECTED: {
              target: 'websocketConnected',
              actions: ['logTransition'],
            },
            // Self-transition: if the auto-send catch fires after the socket has already
            // dropped (PROMPT_SENT racing with WEBSOCKET_DISCONNECTED), still flip
            // initialPromptSent so deriveIsAwaitingStream releases the chat input lock.
            // No target: stay disconnected; on reconnect, shouldAutoSendPrompt is false
            // because initialPromptSent is now true, so no double-send.
            PROMPT_SENT: {
              actions: ['markPromptSent', 'logTransition'],
            },
          },
        },

        // WebSocket connected, ready to send prompt
        websocketConnected: {
          on: {
            PROMPT_SENT: {
              target: 'waitingForFirstEdit',
              actions: ['markPromptSent', 'logTransition'],
            },
            FIRST_FILE_EDIT_SEEN: {
              target: 'active',
              actions: ['markPromptSent', 'markFirstFileEditSeen', 'logTransition'],
            },
            WEBSOCKET_DISCONNECTED: {
              target: 'waitingForWebSocket',
              actions: ['logTransition'],
            },
          },
        },

        // Prompt sent, waiting for agent to make first file edit
        // INTENTIONAL: No escape hatch for errors/disconnects - overlay stays visible to hide
        // template app unless FIRST_FILE_EDIT_SEEN, 10-min timeout, or (narrowly) incomplete tool.
        waitingForFirstEdit: {
          // Safety timeout to prevent infinite hang (Issue 4.2)
          // If agent crashes or never responds, transition to active after timeout
          // The timeout resets on AGENT_ACTIVITY (re-enter resets the `after` delay)
          after: {
            [FIRST_EDIT_TIMEOUT_MS]: {
              target: 'active',
              actions: ['markFirstFileEditSeen', 'logFirstEditTimeout'],
            },
          },
          on: {
            FIRST_FILE_EDIT_SEEN: {
              target: 'active',
              actions: ['markFirstFileEditSeen', 'logTransition'],
            },
            // Only when stream ends with incomplete tool (e.g. token limit). Not for errors/disconnects.
            STREAM_COMPLETE_WITHOUT_FIRST_EDIT: {
              target: 'active',
              actions: ['logTransition'],
            },
            // Agent is actively working - re-enter to reset the failsafe timeout
            // Intentionally no logTransition: fires on every new segment and would spam logs
            AGENT_ACTIVITY: {
              target: 'waitingForFirstEdit',
              reenter: true,
            },
          },
        },

        // Normal active state
        active: {
          type: 'final',
        },
      },
    },

    // -------------------------------------------------------------------------
    // ERROR - Fatal error state
    // -------------------------------------------------------------------------
    error: {
      on: {
        RETRY_CREATION: {
          target: 'creating',
          guard: 'canRetry',
          actions: ['clearError', 'logTransition'],
        },
        RESET: {
          target: 'idle',
          actions: ['resetContext', 'logTransition'],
        },
      },
    },
  },

  on: {
    // Global context hydration (for job→app transition)
    HYDRATE_APP: {
      actions: ['setAppId', 'logTransition'],
    },
    // Global error transition from any state
    FATAL_ERROR: {
      target: '.error',
      actions: ['setError', 'logError'],
    },
    // Global reset transition from any state (for navigation between apps)
    RESET: {
      target: '.idle',
      actions: ['resetContext', 'logTransition'],
    },
  },
})

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type InitializationMachineActor = ActorRefFrom<typeof initializationMachine>
export type InitializationMachineSnapshot = SnapshotFrom<typeof initializationMachine>

/**
 * Helper to extract phase from machine state
 */
export function getPhaseFromState(state: InitializationMachineSnapshot): string {
  if (typeof state.value === 'string') {
    return state.value
  }
  // Handle nested states (e.g., { ready: 'waitingForWebSocket' })
  return Object.keys(state.value)[0]
}

/**
 * Helper to extract sub-phase from machine state
 */
export function getSubPhaseFromState(state: InitializationMachineSnapshot): string | null {
  if (typeof state.value === 'object' && 'ready' in state.value) {
    return state.value.ready as string
  }
  return null
}

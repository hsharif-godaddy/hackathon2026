/**
 * XState Archive Restore State Machine
 *
 * Manages the cold-archive restore lifecycle for an app:
 * - Initial archive-status check
 * - Auto or manual restore trigger
 * - POST /archive-restore mutation
 * - Polling archive-status until it flips to restored
 * - Timeout + failure/retry handling
 *
 * Scope: drive archive-status from "archived" -> "restored". Does NOT resume
 * the variant lifecycle (paused -> running); a separate hibernation hook does that
 * after archiveRestoreComplete flips true.
 *
 * External effects (handled by hook):
 * - archive-status query (react-query)
 * - POST /archive-restore mutation (react-query)
 * - startPollingForServer
 * - invalidateQueries on completion
 */

import { type ActorRefFrom, assign, setup, type SnapshotFrom } from 'xstate'

import { logger } from '@/lib/request-context'

/** mgmt-airo does not advance airo-restore-app job rows; completion is driven by archive-status. */
const RESTORE_WAIT_TIMEOUT_MS = 30 * 60 * 1000

export interface ArchiveRestoreMachineContext {
  appId: string | null
  jobId: string | null
  autoRestore: boolean
  error: string | null
}

export type ArchiveRestoreMachineEvent =
  | { type: 'START'; appId: string; autoRestore: boolean }
  | { type: 'STATUS_NEEDS_RESTORE' }
  | { type: 'STATUS_NOT_ARCHIVED' }
  | { type: 'STATUS_RESTORED' }
  | { type: 'STATUS_ERROR'; error: string }
  | { type: 'TRIGGER_RESTORE' }
  | { type: 'RESTORE_SUCCEEDED'; jobId: string }
  | { type: 'RESTORE_FAILED'; error: string }
  | { type: 'RESTORE_CANCELLED' }
  | { type: 'RESET' }

export const archiveRestoreMachine = setup({
  types: {
    context: {} as ArchiveRestoreMachineContext,
    events: {} as ArchiveRestoreMachineEvent,
    input: {} as { appId: string | null; autoRestore: boolean },
  },

  actions: {
    applyStart: assign({
      appId: ({ event }) => (event.type === 'START' ? event.appId : null),
      autoRestore: ({ event, context }) =>
        event.type === 'START' ? event.autoRestore : context.autoRestore,
      error: null,
      jobId: null,
    }),

    setJobId: assign({
      jobId: ({ event }) => (event.type === 'RESTORE_SUCCEEDED' ? event.jobId : null),
    }),

    setError: assign({
      error: ({ event }) => {
        if (event.type === 'RESTORE_FAILED' || event.type === 'STATUS_ERROR') {
          return event.error
        }
        return null
      },
    }),

    setTimeoutError: assign({
      error: 'Restore did not complete: archive-status did not report restored in time',
    }),

    clearError: assign({
      error: null,
    }),

    // Disable auto-restore so RESTORE_CANCELLED doesn't immediately loop back
    // into restoring via the `shouldAutoRestore` always-transition on needsRestore.
    disableAutoRestore: assign({
      autoRestore: false,
    }),

    resetContext: assign({
      appId: null,
      jobId: null,
      autoRestore: false,
      error: null,
    }),

    logTransition: ({ context, event }) => {
      logger.debug('app-archive-restore.transition', {
        event: event.type,
        appId: context.appId,
      })
    },

    logError: ({ context, event }) => {
      if (event.type === 'RESTORE_FAILED' || event.type === 'STATUS_ERROR') {
        logger.error('app-archive-restore.error', {
          event: event.type,
          appId: context.appId,
          error: event.error,
        })
      }
    },

    logAutoRestore: ({ context }) => {
      logger.info('app-archive-restore.auto-triggered', {
        appId: context.appId,
      })
    },

    logTimeout: ({ context }) => {
      logger.warn('app-archive-restore.archive-wait.timeout', {
        appId: context.appId,
        jobId: context.jobId,
        message: 'archive-status did not report restored within timeout',
      })
    },
  },

  guards: {
    shouldAutoRestore: ({ context }) => context.autoRestore,
  },

  delays: {
    RESTORE_WAIT_TIMEOUT: RESTORE_WAIT_TIMEOUT_MS,
  },
}).createMachine({
  id: 'archiveRestore',
  initial: 'idle',

  context: ({ input }) => ({
    appId: input?.appId ?? null,
    jobId: null,
    autoRestore: input?.autoRestore ?? false,
    error: null,
  }),

  states: {
    idle: {
      on: {
        START: {
          target: 'checkingStatus',
          actions: ['applyStart', 'logTransition'],
        },
      },
    },

    checkingStatus: {
      on: {
        STATUS_NEEDS_RESTORE: {
          target: 'needsRestore',
          actions: ['logTransition'],
        },
        STATUS_NOT_ARCHIVED: {
          target: 'notArchived',
          actions: ['logTransition'],
        },
        // Initial status errors are treated as graceful "not archived" to avoid
        // blocking the develop page on transient network issues. The hook decides.
      },
    },

    needsRestore: {
      // Auto-restore: eventless transition on entry, guarded by autoRestore input
      always: {
        guard: 'shouldAutoRestore',
        target: 'restoring',
        actions: ['logAutoRestore', 'logTransition'],
      },
      on: {
        TRIGGER_RESTORE: {
          target: 'restoring',
          actions: ['clearError', 'logTransition'],
        },
        // canRestore retracted by backend (compliance hold / admin action) while
        // the user is on the restore screen. Exit rather than leaving them stuck
        // indefinitely with a non-functional Restore button.
        STATUS_NOT_ARCHIVED: {
          target: 'notArchived',
          actions: ['logTransition'],
        },
      },
    },

    restoring: {
      initial: 'triggering',
      states: {
        triggering: {
          on: {
            RESTORE_SUCCEEDED: {
              target: 'waitingForStatus',
              actions: ['setJobId', 'logTransition'],
            },
            RESTORE_FAILED: {
              target: '#archiveRestore.failed',
              actions: ['setError', 'logError'],
            },
            // Sent when the user dismisses the SSO re-auth modal or the
            // preflight returns 401. Return to needsRestore so the UI renders
            // the restore button again — retry without a page reload.
            RESTORE_CANCELLED: {
              target: '#archiveRestore.needsRestore',
              actions: ['clearError', 'disableAutoRestore', 'logTransition'],
            },
          },
        },
        waitingForStatus: {
          // RESTORE_CANCELLED is not handled here: this state is only entered after
          // RESTORE_SUCCEEDED, meaning the POST already completed. Auth errors are
          // only thrown by appFetch during the POST (postArchiveRestore), not by
          // the archive-status poll, so RESTORE_CANCELLED cannot fire in this sub-state.
          after: {
            RESTORE_WAIT_TIMEOUT: {
              target: '#archiveRestore.failed',
              actions: ['setTimeoutError', 'logTimeout'],
            },
          },
          on: {
            STATUS_RESTORED: {
              target: '#archiveRestore.complete',
              actions: ['logTransition'],
            },
            STATUS_ERROR: {
              target: '#archiveRestore.failed',
              actions: ['setError', 'logError'],
            },
          },
        },
      },
    },

    notArchived: {
      type: 'final',
    },

    complete: {
      type: 'final',
    },

    failed: {
      on: {
        TRIGGER_RESTORE: {
          target: 'restoring',
          actions: ['clearError', 'logTransition'],
        },
      },
    },
  },

  on: {
    RESET: {
      target: '.idle',
      actions: ['resetContext', 'logTransition'],
    },
  },
})

export type ArchiveRestoreMachineActor = ActorRefFrom<typeof archiveRestoreMachine>
export type ArchiveRestoreMachineSnapshot = SnapshotFrom<typeof archiveRestoreMachine>

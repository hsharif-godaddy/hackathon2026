import { create } from 'zustand'

import { logger } from '@/lib/request-context'

/** Hard cap on pages built in one batch (cost guardrail). Adjustable. */
export const REBUILD_BATCH_CAP = 5

/** How many times the driver re-dispatches a page whose send never started a turn
 *  (transport no-op, e.g. socket reconnecting) before the batch gives up. */
export const MAX_SEND_ATTEMPTS = 3

type Phase = 'awaiting-send' | 'sent' | 'in-turn'

interface RebuildBuildQueueState {
  slugs: string[]
  cursor: number
  status: 'idle' | 'running'
  phase: Phase
  /** Send attempts for the current page; reset when a turn starts or the cursor advances. */
  attempts: number
  /** Start a batch (truncated to the cap). No-op if empty. */
  enqueue: (slugs: string[]) => void
  /** The driver calls this right after it sends the current slug's message. */
  markSent: () => void
  /** The driver feeds stream-busy transitions here; this is the state machine. */
  onProcessingChange: (isProcessing: boolean) => void
  /** Watchdog hook: a dispatched send never started a turn — retry, then give up. */
  onSendStalled: () => void
  /** Cancel the batch (in-flight turn finishes naturally; nothing more is sent). */
  stop: () => void
}

const IDLE = {
  slugs: [] as string[],
  cursor: 0,
  status: 'idle' as const,
  phase: 'awaiting-send' as const,
  attempts: 0,
}

export const useRebuildBuildQueue = create<RebuildBuildQueueState>((set, get) => ({
  ...IDLE,

  enqueue: (slugs) => {
    // Don't clobber an in-flight batch. The selector hides its Build UI while
    // running and returns null when it isn't the last message, so this is
    // unreachable today — but guarding here keeps the invariant local to the
    // store rather than relying on the UI, and avoids mis-attributing the
    // in-flight turn's completion to a freshly-replaced batch.
    if (get().status === 'running') {
      logger.warn('rebuild.queue.enqueue_ignored_while_running', { requested: slugs.length })
      return
    }
    const capped = slugs.slice(0, REBUILD_BATCH_CAP)
    if (capped.length === 0) return
    if (slugs.length > capped.length) {
      logger.warn('rebuild.queue.enqueue_truncated', { requested: slugs.length, cap: REBUILD_BATCH_CAP })
    }
    set({ slugs: capped, cursor: 0, status: 'running', phase: 'awaiting-send', attempts: 0 })
  },

  markSent: () => {
    if (get().status === 'running' && get().phase === 'awaiting-send') set({ phase: 'sent' })
  },

  onProcessingChange: (isProcessing) => {
    const { status, phase, cursor, slugs } = get()
    if (status !== 'running') return
    // A turn started while we hadn't sent yet ⇒ the user sent something manually ⇒ cancel.
    if (phase === 'awaiting-send' && isProcessing) {
      logger.info('rebuild.queue.cancelled_manual_interjection', { cursor, total: slugs.length })
      set({ ...IDLE })
      return
    }
    // Our sent turn started — clear the per-page attempt counter.
    if (phase === 'sent' && isProcessing) { set({ phase: 'in-turn', attempts: 0 }); return }
    // Our turn finished ⇒ advance (or finish).
    if (phase === 'in-turn' && !isProcessing) {
      const next = cursor + 1
      if (next >= slugs.length) set({ ...IDLE })
      else set({ cursor: next, phase: 'awaiting-send', attempts: 0 })
    }
  },

  onSendStalled: () => {
    const { status, phase, attempts, cursor, slugs } = get()
    // Stale watchdog: the turn already started (in-turn) or the batch ended. Ignore.
    if (status !== 'running' || phase !== 'sent') return
    const nextAttempts = attempts + 1
    if (nextAttempts >= MAX_SEND_ATTEMPTS) {
      // Don't freeze silently: give up the batch so the user can retry from the selector.
      logger.warn('rebuild.queue.send_stalled_giving_up', { slug: slugs[cursor], attempts: nextAttempts })
      set({ ...IDLE })
    } else {
      // Re-arm the send (the driver re-dispatches when phase is 'awaiting-send' and idle).
      logger.warn('rebuild.queue.send_stalled_retrying', { slug: slugs[cursor], attempt: nextAttempts })
      set({ phase: 'awaiting-send', attempts: nextAttempts })
    }
  },

  stop: () => set({ ...IDLE }),
}))

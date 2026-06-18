/**
 * RAF Scheduler
 *
 * Shared scheduling utility that batches callbacks using requestAnimationFrame
 * with a setTimeout fallback. Multiple calls within the same frame are
 * deduplicated. Used by both toolDeltaBuffer and storeUpdateBuffer.
 */

import { logger } from '@/lib/request-context'

const RAF_FALLBACK_DELAY_MS = 16 // ~60fps frame duration for setTimeout fallback

export interface RAFScheduler {
  /** Schedule a flush on the next animation frame. Deduplicates multiple calls. */
  schedule: () => void
  /** Cancel any pending scheduled flush and flush immediately. */
  flushImmediate: () => void
  /** Cancel any pending scheduled flush without invoking the callback. */
  cancel: () => void
}

/**
 * Creates a RAF-based scheduler that deduplicates flush requests.
 *
 * @param flush - The callback to invoke on each scheduled frame
 * @param domain - Logging domain prefix for error messages
 */
export function createRAFScheduler(flush: () => void, domain: string): RAFScheduler {
  let flushScheduled = false
  let rafId: number | null = null
  let usedRaf = false

  function flushImmediate(): void {
    if (rafId !== null) {
      if (usedRaf) {
        window.cancelAnimationFrame(rafId)
      } else {
        clearTimeout(rafId)
      }
      rafId = null
      usedRaf = false
    }
    flushScheduled = false
    flush()
  }

  function schedule(): void {
    if (flushScheduled) {
      return
    }

    flushScheduled = true

    const runFlush = () => {
      try {
        rafId = null
        flushScheduled = false
        flush()
      } catch (error) {
        logger.error(`websocket.${domain}.flush_execution_error`, {
          message: 'Failed to execute scheduled flush',
          error: error instanceof Error ? error.message : String(error),
        })
        rafId = null
        flushScheduled = false
        // Attempt immediate fallback flush
        try {
          flush()
        } catch (fallbackError) {
          logger.error(`websocket.${domain}.flush_fallback_error`, {
            message: 'Fallback flush also failed',
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          })
        }
      }
    }

    // Try requestAnimationFrame with fallback to setTimeout
    try {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        rafId = window.requestAnimationFrame(runFlush)
        usedRaf = true
      } else {
        rafId = setTimeout(runFlush, RAF_FALLBACK_DELAY_MS) as unknown as number
        usedRaf = false
      }
    } catch (schedulingError) {
      logger.error(`websocket.${domain}.flush_scheduling_error`, {
        message: 'Failed to schedule flush, attempting immediate fallback',
        error: schedulingError instanceof Error ? schedulingError.message : String(schedulingError),
      })
      rafId = null
      flushScheduled = false
      try {
        flush()
      } catch (fallbackError) {
        logger.error(`websocket.${domain}.flush_immediate_fallback_error`, {
          message: 'Immediate fallback flush failed',
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        })
      }
    }
  }

  function cancel(): void {
    if (rafId !== null) {
      if (usedRaf) {
        window.cancelAnimationFrame(rafId)
      } else {
        clearTimeout(rafId)
      }
      rafId = null
      usedRaf = false
    }
    flushScheduled = false
  }

  return { schedule, flushImmediate, cancel }
}

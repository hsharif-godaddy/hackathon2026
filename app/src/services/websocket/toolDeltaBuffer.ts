/**
 * Tool Delta Buffer (Module-Level Utility)
 *
 * Manages buffering and batched flushing of tool input deltas outside of React.
 * Accumulates streaming tool inputs and flushes them in batches using requestAnimationFrame
 * for optimal UI update performance.
 *
 * This module owns the buffer state and flush scheduling. The React hook
 * (`useToolDeltaBuffer`) is a thin wrapper that exposes this via refs for
 * backward compatibility.
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

const RAF_FALLBACK_DELAY_MS = 16 // ~60fps frame duration for setTimeout fallback

export interface ToolDeltaEntry {
  name: string
  delta: string
  hasExplicitName: boolean
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const toolDeltaBuffer: Map<string, ToolDeltaEntry> = new Map()
let flushScheduled = false
let rafId: number | null = null
let usedRaf = false

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the shared module-level buffer map.
 */
export function getToolDeltaBuffer(): Map<string, ToolDeltaEntry> {
  return toolDeltaBuffer
}

/**
 * Flush buffered tool deltas to the store.
 *
 * Retrieves `updateToolDelta` from the Zustand store at call time so that no
 * stale closure can reference an outdated function.
 */
function flushToolDeltaBuffer(): void {
  if (toolDeltaBuffer.size === 0) {
    return
  }

  const updateToolDeltaFn = useStreamingConversationStore.getState().updateToolDelta
  if (!updateToolDeltaFn) {
    logger.warn('websocket.tool_delta.flush_unavailable', {
      message: 'Tool delta buffer cleared without update function - user-facing output lost',
      bufferedToolCount: toolDeltaBuffer.size,
      toolIds: Array.from(toolDeltaBuffer.keys()),
    })
    toolDeltaBuffer.clear()
    return
  }

  try {
    // hasExplicitName is only needed while accumulating, so we ignore it during flush.
    toolDeltaBuffer.forEach(({ name, delta }, toolId) => {
      if (delta.length > 0) {
        updateToolDeltaFn(toolId, name, delta)
      }
    })

    toolDeltaBuffer.clear()
  } catch (error) {
    logger.error('websocket.tool_delta.flush_error', {
      message: 'Failed to flush tool delta buffer',
      error: error instanceof Error ? error.message : String(error),
      bufferedToolCount: toolDeltaBuffer.size,
      toolIds: Array.from(toolDeltaBuffer.keys()),
    })
    // Clear buffer even on error to prevent permanent stuck state
    toolDeltaBuffer.clear()
  }
}

/**
 * Immediately flush all buffered tool deltas.
 * Cancels any pending scheduled flush to prevent duplicate flushes.
 */
export function flushToolDeltaBufferImmediate(): void {
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
  flushToolDeltaBuffer()
}

/**
 * Schedule a batched flush using requestAnimationFrame.
 * Multiple calls within the same frame are deduplicated.
 */
export function scheduleToolDeltaFlush(): void {
  if (flushScheduled) {
    return
  }

  flushScheduled = true

  const runFlush = () => {
    try {
      rafId = null
      flushScheduled = false
      flushToolDeltaBuffer()
    } catch (error) {
      logger.error('websocket.tool_delta.flush_execution_error', {
        message: 'Failed to execute scheduled flush',
        error: error instanceof Error ? error.message : String(error),
      })
      // Reset flag to allow future flush attempts
      rafId = null
      flushScheduled = false
      // Attempt immediate fallback flush
      try {
        flushToolDeltaBuffer()
      } catch (fallbackError) {
        logger.error('websocket.tool_delta.flush_fallback_error', {
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
    logger.error('websocket.tool_delta.flush_scheduling_error', {
      message: 'Failed to schedule flush, attempting immediate fallback',
      error: schedulingError instanceof Error ? schedulingError.message : String(schedulingError),
    })
    // Reset flag and attempt immediate flush as fallback
    rafId = null
    flushScheduled = false
    try {
      flushToolDeltaBuffer()
    } catch (fallbackError) {
      logger.error('websocket.tool_delta.flush_immediate_fallback_error', {
        message: 'Immediate fallback flush failed',
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      })
    }
  }
}

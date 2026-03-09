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
import { createRAFScheduler } from './rafScheduler'

export interface ToolDeltaEntry {
  name: string
  delta: string
  hasExplicitName: boolean
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const toolDeltaBuffer: Map<string, ToolDeltaEntry> = new Map()

// ---------------------------------------------------------------------------
// Flush logic
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Scheduler (shared RAF utility)
// ---------------------------------------------------------------------------

const scheduler = createRAFScheduler(flushToolDeltaBuffer, 'tool_delta')

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
 * Immediately flush all buffered tool deltas.
 * Cancels any pending scheduled flush to prevent duplicate flushes.
 */
export const flushToolDeltaBufferImmediate = scheduler.flushImmediate

/**
 * Schedule a batched flush using requestAnimationFrame.
 * Multiple calls within the same frame are deduplicated.
 */
export const scheduleToolDeltaFlush = scheduler.schedule

/**
 * Discard all pending tool deltas without flushing.
 * Cancels any scheduled RAF flush.
 * Used on app switch to prevent stale data from bleeding into the new app.
 */
export function clearToolDeltaBuffer(): void {
  scheduler.cancel()
  toolDeltaBuffer.clear()
}

/**
 * Tool Delta Buffer Hook
 *
 * Manages buffering and batched flushing of tool input deltas.
 * Accumulates streaming tool inputs and flushes them in batches using requestAnimationFrame
 * for optimal UI update performance.
 */

import { type MutableRefObject,useCallback, useEffect, useRef } from 'react'

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

const RAF_FALLBACK_DELAY_MS = 16 // ~60fps frame duration for setTimeout fallback

export interface ToolDeltaEntry {
  name: string
  delta: string
  hasExplicitName: boolean
}

export interface UseToolDeltaBufferReturn {
  /**
   * Buffer for accumulating tool input deltas
   */
  toolDeltaBufferRef: MutableRefObject<Map<string, ToolDeltaEntry>>

  /**
   * Schedule a batched flush of tool deltas (uses requestAnimationFrame)
   */
  scheduleToolDeltaFlush: () => void

  /**
   * Immediately flush all buffered tool deltas
   */
  flushToolDeltaBufferImmediate: () => void
}

/**
 * Hook for managing tool input delta buffering and flushing
 */
export function useToolDeltaBuffer(): UseToolDeltaBufferReturn {
  const toolDeltaBufferRef = useRef<Map<string, ToolDeltaEntry>>(new Map())
  // hasExplicitName prevents later deltas that omit a tool name from overwriting a previously captured explicit name.
  const toolDeltaFlushScheduledRef = useRef<boolean>(false)
  const rafIdRef = useRef<number | null>(null)
  const updateToolDeltaRef = useRef(useStreamingConversationStore.getState().updateToolDelta)

  // Keep updateToolDelta ref in sync with store
  useEffect(() => {
    const unsubscribe = useStreamingConversationStore.subscribe((state) => {
      updateToolDeltaRef.current = state.updateToolDelta
    })

    return () => {
      unsubscribe()
    }
  }, [])

  /**
   * Flush buffered tool deltas to the store
   */
  const flushToolDeltaBuffer = useCallback(() => {
    if (toolDeltaBufferRef.current.size === 0) {
      return
    }

    const updateToolDeltaFn = updateToolDeltaRef.current
    if (!updateToolDeltaFn) {
      logger.warn('websocket.tool_delta.flush_unavailable', {
        message: 'Tool delta buffer cleared without update function - user-facing output lost',
        bufferedToolCount: toolDeltaBufferRef.current.size,
        toolIds: Array.from(toolDeltaBufferRef.current.keys()),
      })
      toolDeltaBufferRef.current.clear()
      return
    }

    try {
      // hasExplicitName is only needed while accumulating, so we ignore it during flush.
      toolDeltaBufferRef.current.forEach(({ name, delta }, toolId) => {
        if (delta.length > 0) {
          updateToolDeltaFn(toolId, name, delta)
        }
      })

      toolDeltaBufferRef.current.clear()
    } catch (error) {
      logger.error('websocket.tool_delta.flush_error', {
        message: 'Failed to flush tool delta buffer',
        error: error instanceof Error ? error.message : String(error),
        bufferedToolCount: toolDeltaBufferRef.current.size,
        toolIds: Array.from(toolDeltaBufferRef.current.keys()),
      })
      // Clear buffer even on error to prevent permanent stuck state
      toolDeltaBufferRef.current.clear()
    }
  }, [])

  /**
   * Immediately flush buffered tool deltas
   * Cancels any pending scheduled flush to prevent duplicate flushes
   */
  const flushToolDeltaBufferImmediate = useCallback(() => {
    if (rafIdRef.current !== null) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafIdRef.current)
      } else {
        clearTimeout(rafIdRef.current)
      }
      rafIdRef.current = null
    }
    toolDeltaFlushScheduledRef.current = false
    flushToolDeltaBuffer()
  }, [flushToolDeltaBuffer])

  /**
   * Schedule a batched flush using requestAnimationFrame
   * Multiple calls within the same frame are deduplicated
   */
  const scheduleToolDeltaFlush = useCallback(() => {
    if (toolDeltaFlushScheduledRef.current) {
      return
    }

    toolDeltaFlushScheduledRef.current = true

    const runFlush = () => {
      try {
        rafIdRef.current = null
        toolDeltaFlushScheduledRef.current = false
        flushToolDeltaBuffer()
      } catch (error) {
        logger.error('websocket.tool_delta.flush_execution_error', {
          message: 'Failed to execute scheduled flush',
          error: error instanceof Error ? error.message : String(error),
        })
        // Reset flag to allow future flush attempts
        rafIdRef.current = null
        toolDeltaFlushScheduledRef.current = false
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
        rafIdRef.current = window.requestAnimationFrame(runFlush)
      } else {
        rafIdRef.current = setTimeout(runFlush, RAF_FALLBACK_DELAY_MS) as unknown as number
      }
    } catch (schedulingError) {
      logger.error('websocket.tool_delta.flush_scheduling_error', {
        message: 'Failed to schedule flush, attempting immediate fallback',
        error: schedulingError instanceof Error ? schedulingError.message : String(schedulingError),
      })
      // Reset flag and attempt immediate flush as fallback
      rafIdRef.current = null
      toolDeltaFlushScheduledRef.current = false
      try {
        flushToolDeltaBuffer()
      } catch (fallbackError) {
        logger.error('websocket.tool_delta.flush_immediate_fallback_error', {
          message: 'Immediate fallback flush failed',
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        })
      }
    }
  }, [flushToolDeltaBuffer])

  return {
    toolDeltaBufferRef,
    scheduleToolDeltaFlush,
    flushToolDeltaBufferImmediate,
  }
}

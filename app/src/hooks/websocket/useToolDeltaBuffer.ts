/**
 * Tool Delta Buffer Hook
 *
 * Thin React wrapper around the module-level tool delta buffer utility.
 * Provides a ref-like API for backward compatibility while delegating all
 * buffer logic to `toolDeltaBuffer.ts`.
 */

import { type MutableRefObject, useMemo } from 'react'

import {
  flushToolDeltaBufferImmediate,
  getToolDeltaBuffer,
  scheduleToolDeltaFlush,
  type ToolDeltaEntry,
} from '@/services/websocket/toolDeltaBuffer'

export type { ToolDeltaEntry } from '@/services/websocket/toolDeltaBuffer'

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
 * Hook for managing tool input delta buffering and flushing.
 *
 * The actual buffer and flush logic live in the module-level utility
 * (`services/websocket/toolDeltaBuffer.ts`). This hook simply wraps the
 * shared buffer in a ref-like object so callers that depend on
 * `toolDeltaBufferRef.current` continue to work unchanged.
 */
export function useToolDeltaBuffer(): UseToolDeltaBufferReturn {
  // Wrap the module-level Map in a ref-shaped object so that
  // `toolDeltaBufferRef.current` points at the shared buffer.
  const toolDeltaBufferRef = useMemo<MutableRefObject<Map<string, ToolDeltaEntry>>>(
    () => ({ current: getToolDeltaBuffer() }),
    [],
  )

  return {
    toolDeltaBufferRef,
    scheduleToolDeltaFlush,
    flushToolDeltaBufferImmediate,
  }
}

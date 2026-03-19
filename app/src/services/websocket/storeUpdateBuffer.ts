/**
 * Store Update Buffer
 *
 * Buffers hot-path Zustand store updates (text chunks, tool segments) and
 * flushes them in a single requestAnimationFrame callback. This prevents
 * React Error #185 ("Cannot update a component while rendering a different
 * component") by ensuring store notifications happen outside of render.
 *
 * Uses a single ordered queue to preserve the exact arrival order of text
 * chunks and tool segment actions. Adjacent text entries are coalesced
 * during flush to minimize store updates while maintaining correctness.
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { createRAFScheduler } from './rafScheduler'

// ---------------------------------------------------------------------------
// Queue entry types
// ---------------------------------------------------------------------------

type QueueEntry =
  | { kind: 'text'; content: string }
  | { kind: 'update'; fn: () => void }

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const queue: QueueEntry[] = []

// ---------------------------------------------------------------------------
// Flush logic
// ---------------------------------------------------------------------------

function flushStoreUpdateBuffer(): void {
  if (queue.length === 0) {return}

  const entries = queue.splice(0)

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    try {
      if (entry.kind === 'text') {
        // Coalesce adjacent text entries (array + join to avoid O(n²) string concat)
        const textChunks: string[] = [entry.content]
        while (i + 1 < entries.length && entries[i + 1].kind === 'text') {
          i++
          textChunks.push((entries[i] as { kind: 'text'; content: string }).content)
        }
        useStreamingConversationStore.getState().appendTextSegment(textChunks.join(''))
      } else {
        entry.fn()
      }
    } catch (error) {
      logger.error('websocket.store_update.flush_entry_error', {
        message: 'Failed to flush buffered store update',
        kind: entry.kind,
        error: error instanceof Error ? error.message : String(error),
        remainingEntries: entries.length - i - 1,
      })
      // Continue processing remaining entries
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const scheduler = createRAFScheduler(flushStoreUpdateBuffer, 'store_update')

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Buffer a text chunk for coalesced flushing.
 * Adjacent text chunks within one frame are concatenated into a single
 * `appendTextSegment` call while preserving order relative to tool actions.
 */
export function bufferTextChunk(content: string): void {
  queue.push({ kind: 'text', content })
  scheduler.schedule()
}

/**
 * Queue an arbitrary store update for batched flushing.
 * Replayed in arrival order, interleaved correctly with text chunks.
 */
export function bufferStoreUpdate(fn: () => void): void {
  queue.push({ kind: 'update', fn })
  scheduler.schedule()
}

/**
 * Immediately flush all pending text chunks and queued updates.
 * Cancels any scheduled RAF flush. Must be called before `finalizeStream`
 * to ensure all buffered data reaches the store.
 */
export const flushStoreUpdateBufferImmediate = scheduler.flushImmediate

/**
 * Discard all pending updates without flushing.
 * Cancels any scheduled RAF flush.
 * Used on app switch to prevent stale data from bleeding into the new app.
 */
export function clearStoreUpdateBuffer(): void {
  scheduler.cancel()
  queue.length = 0
}

/**
 * Reset internal state. Intended for tests only.
 * @internal
 */
export function _resetForTesting(): void {
  scheduler.cancel()
  queue.length = 0
}

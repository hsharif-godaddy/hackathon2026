/**
 * Synthetic restore notice exchanged between the UI and the agents service
 * when the user rolls the working tree back out-of-band — either the chat
 * Undo button (stash-only mid-stream / on a dirty tree, or rewind to the
 * previous commit on a clean tree) or the per-prompt / version-history
 * Restore button (rewind to a specific commit).
 *
 * The agents route (`POST /apps/:id/git/restore`) persists a status message
 * whose `metadata.kind === RESTORE`, and the UI uses `isRestoreMetadata` to
 * recognize it on read.
 *
 * This file is the single source of truth for the discriminant and the
 * metadata shape. Both ends import from here so a typo on either side fails
 * to compile instead of silently falling through to the wrong renderer or
 * wrong agent-visible content.
 */

export const RESTORE = 'restore' as const

/**
 * Shape persisted into `conversation_messages.metadata` by the restore route.
 * The UI reads `kind` to recognise the message and renders the rollback card.
 *
 * - `commitHash` — HEAD after the operation. The restored commit when a
 *   target was supplied; otherwise the post-checkout HEAD (typically `main`)
 *   for stash-only undos.
 * - `stashHash` — set whenever the working tree had uncommitted changes that
 *   were stashed before the rollback, regardless of whether a target commit
 *   was supplied. Absent (or null) on a clean tree.
 * - `restoredCommitHash` — set when the caller supplied a target commit
 *   (per-prompt Restore / version-history). Absent on the stash-only undo
 *   path where there is no rewind target.
 */
export interface RestoreActionMetadata {
  kind: typeof RESTORE
  commitHash: string | null
  stashHash?: string | null
  restoredCommitHash?: string | null
}

/**
 * Type guard: narrows unknown message metadata to `RestoreActionMetadata`.
 * Accepts `unknown` so UI callers can hand in `ChatMessage['metadata']` or raw
 * parsed JSON without casting — a structural check verifies shape at runtime.
 */
export function isRestoreMetadata(
  metadata: unknown
): metadata is RestoreActionMetadata {
  if (!metadata || typeof metadata !== 'object') return false
  const m = metadata as {
    kind?: unknown
    commitHash?: unknown
    stashHash?: unknown
    restoredCommitHash?: unknown
  }
  if (m.kind !== RESTORE) return false
  if (m.commitHash !== null && typeof m.commitHash !== 'string') return false
  if (m.stashHash !== undefined && m.stashHash !== null && typeof m.stashHash !== 'string') return false
  // noinspection RedundantIfStatementJS - Easier to add new branches with an explicit check than to remember to update a single compound condition
  if (m.restoredCommitHash !== undefined && m.restoredCommitHash !== null && typeof m.restoredCommitHash !== 'string') return false
  return true
}

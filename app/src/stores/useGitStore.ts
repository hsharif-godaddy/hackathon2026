import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'

/**
 * Git Store - Manages commit selection state
 * 
 * This store handles client-side state for git operations:
 * - Which commit is currently selected (by hash)
 * - Loading state during commit sync operations
 * - Errors during commit operations
 * 
 * Note: The actual commit data comes from React Query (useGitHistoryQuery).
 * This store only stores the selected commit hash and provides actions
 * to change the selection.
 */
interface GitStore {
  /**
   * Map of appId to selected commit hash
   * Stores only the hash, not the full commit object
   */
  selectedCommitHashByApp: Record<string, string | null>

  /** Per-app LIFO of pre-undo cursor SHAs for Redo. In-memory only. */
  redoStackByApp: Record<string, string[]>

  /** SHA the user views — diverges from HEAD because `/git/restore` writes a forward Restore commit. */
  undoCursorByApp: Record<string, string>

  /**
   * Whether a commit selection/sync operation is in progress
   */
  isSelectingCommit: boolean

  /**
   * Error message if commit selection failed
   */
  commitSelectionError: string | null
  
  /**
   * Select a commit and sync the app to that commit.
   *
   * Resolves with `{ pageHint, modulePath }`:
   *  - `pageHint` — a route path for the page that received the largest diff
   *    in that commit (filename-derived), or `null` if no page was touched.
   *  - `modulePath` — the source file the hint came from. Forwarded to
   *    dev-tools so it can re-resolve via the live route registry when the
   *    filename heuristic misses (skill-installed pages).
   *
   * Callers use these to steer the preview iframe so it doesn't 404.
   *
   * @param appId - Application ID
   * @param commitHash - Git commit hash to sync to
   *
   * @example
   * ```typescript
   * const selectCommit = useGitStore((state) => state.selectCommit)
   * const { pageHint } = await selectCommit('app-123', 'abc123def456')
   * ```
   */
  selectCommit: (appId: string, commitHash: string) => Promise<{ pageHint: string | null; modulePath: string | null }>
  
  /**
   * Clear any commit selection error
   */
  setCommitSelectionError: (error: string | null) => void

  /**
   * Set the selected commit hash without triggering a checkout
   * Lightweight state update for hydration from server state
   *
   * @param appId - Application ID
   * @param commitHash - Git commit hash to set as selected
   *
   * @example
   * ```typescript
   * const setSelectedCommitHash = useGitStore((state) => state.setSelectedCommitHash)
   * setSelectedCommitHash('app-123', 'abc123def456')
   * ```
   */
  setSelectedCommitHash: (appId: string, commitHash: string) => void

  /**
   * Get the selected commit hash for an app
   *
   * @param appId - Application ID
   * @returns Selected commit hash or null if none selected
   *
   * @example
   * ```typescript
   * const getSelectedCommitHash = useGitStore((state) => state.getSelectedCommitHash)
   * const hash = getSelectedCommitHash('app-123')
   * ```
   */
  getSelectedCommitHash: (appId: string) => string | null

  pushRedo: (appId: string, commitHash: string) => void
  popRedo: (appId: string) => string | null
  clearRedoStack: (appId: string) => void
  getRedoStack: (appId: string) => string[]
  setUndoCursor: (appId: string, commitHash: string) => void
  getUndoCursor: (appId: string) => string | null

  /** Clear selection state, redo stack, and undo cursor for an app. */
  clearAppState: (appId: string) => void

  /**
   * Return to main branch (latest commit)
   * Checks out main branch and updates selection to latest commit
   *
   * @param appId - Application ID
   * @param latestCommitHash - Hash of the latest commit to set as selected
   */
  returnToMain: (appId: string, latestCommitHash: string) => Promise<void>
}

export const useGitStore = create<GitStore>()(
  devtools(
    immer((set, get) => ({
      selectedCommitHashByApp: {},
      redoStackByApp: {},
      undoCursorByApp: {},
      isSelectingCommit: false,
      commitSelectionError: null,
      
      selectCommit: async (appId, commitHash) => {
        set({ isSelectingCommit: true, commitSelectionError: null })

        logger.info('git-store.select-commit.start', {
          appId,
          commitHash: commitHash.substring(0, 7),
        })

        try {
          // Perform the checkout operation
          const { pageHint, modulePath } = await appService.checkoutCommit(appId, commitHash)

          // Update selection state
          set((state) => {
            state.selectedCommitHashByApp[appId] = commitHash
            state.isSelectingCommit = false
          })

          logger.info('git-store.select-commit.success', {
            appId,
            commitHash: commitHash.substring(0, 7),
            pageHint,
            modulePath,
          })

          // Steer the preview iframe to the page that received the largest
          // diff in this commit so it doesn't land on the dev-tools 404 when
          // the user's current path didn't exist yet at that commit.
          // PreviewPane listens for this event.
          //
          // Dispatch even when `pageHint` is null as long as we have a
          // `modulePath`: dev-tools can still resolve via its route registry
          // (skill-installed pages mount at non-filename paths). PreviewPane
          // only suppresses dispatch when both are missing.
          if ((pageHint || modulePath) && typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent<{ appId: string; path: string | null; modulePath: string | null }>(
                'preview-navigate-after-checkout',
                {
                  detail: { appId, path: pageHint, modulePath },
                }
              )
            )
          }

          return { pageHint, modulePath }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to checkout commit'
          
          logger.error('git-store.select-commit.error', {
            appId,
            commitHash: commitHash.substring(0, 7),
            error: errorMessage,
          })
          
          set({ 
            commitSelectionError: errorMessage, 
            isSelectingCommit: false 
          })
          
          throw error
        }
      },
      
      setCommitSelectionError: (error) => {
        set({ commitSelectionError: error })
      },

      setSelectedCommitHash: (appId, commitHash) => {
        set((state) => {
          state.selectedCommitHashByApp[appId] = commitHash
          // Note: Direct mutation is safe here because immer middleware (line 95)
          // converts this to an immutable update behind the scenes
        })
      },

      getSelectedCommitHash: (appId) => {
        return get().selectedCommitHashByApp[appId] ?? null
      },

      pushRedo: (appId, commitHash) => {
        set((state) => {
          if (!state.redoStackByApp[appId]) state.redoStackByApp[appId] = []
          state.redoStackByApp[appId].push(commitHash)
        })
      },

      popRedo: (appId) => {
        const stack = get().redoStackByApp[appId]
        const popped = stack && stack.length > 0 ? stack[stack.length - 1] : null
        if (!popped) return null
        set((state) => {
          state.redoStackByApp[appId]?.pop()
        })
        return popped
      },

      clearRedoStack: (appId) => {
        set((state) => {
          delete state.redoStackByApp[appId]
        })
      },

      getRedoStack: (appId) => {
        return get().redoStackByApp[appId] ?? []
      },

      setUndoCursor: (appId, commitHash) => {
        set((state) => {
          state.undoCursorByApp[appId] = commitHash
        })
      },

      getUndoCursor: (appId) => {
        return get().undoCursorByApp[appId] ?? null
      },

      clearAppState: (appId) => {
        set((state) => {
          delete state.selectedCommitHashByApp[appId]
          delete state.redoStackByApp[appId]
          delete state.undoCursorByApp[appId]
        })
      },

      returnToMain: async (appId, latestCommitHash) => {
        set({ isSelectingCommit: true, commitSelectionError: null })

        try {
          await appService.returnToMainBranch(appId)

          set((state) => {
            state.selectedCommitHashByApp[appId] = latestCommitHash
            state.isSelectingCommit = false
          })

          logger.info('git-store.return-to-main.success', {
            appId,
            commitHash: latestCommitHash.substring(0, 7),
          })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to return to main'

          logger.error('git-store.return-to-main.error', {
            appId,
            error: errorMessage,
          })

          set({
            commitSelectionError: errorMessage,
            isSelectingCommit: false
          })
        }
      },
    })),
    { name: 'GitStore' }
  )
)


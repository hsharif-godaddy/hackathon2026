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
  
  /**
   * Whether a commit selection/sync operation is in progress
   */
  isSelectingCommit: boolean
  
  /**
   * Error message if commit selection failed
   */
  commitSelectionError: string | null
  
  /**
   * Select a commit and sync the app to that commit
   * 
   * @param appId - Application ID
   * @param commitHash - Git commit hash to sync to
   * @returns Promise that resolves when sync completes
   * 
   * @example
   * ```typescript
   * const selectCommit = useGitStore((state) => state.selectCommit)
   * await selectCommit('app-123', 'abc123def456')
   * ```
   */
  selectCommit: (appId: string, commitHash: string) => Promise<void>
  
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

  /**
   * Clear selection state for an app (cleanup)
   *
   * @param appId - Application ID
   */
  clearAppState: (appId: string) => void
}

export const useGitStore = create<GitStore>()(
  devtools(
    immer((set, get) => ({
      selectedCommitHashByApp: {},
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
          await appService.checkoutCommit(appId, commitHash)
          
          // Update selection state
          set((state) => {
            state.selectedCommitHashByApp[appId] = commitHash
            state.isSelectingCommit = false
          })
          
          logger.info('git-store.select-commit.success', {
            appId,
            commitHash: commitHash.substring(0, 7),
          })
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

      clearAppState: (appId) => {
        set((state) => {
          delete state.selectedCommitHashByApp[appId]
        })
      },
    })),
    { name: 'GitStore' }
  )
)


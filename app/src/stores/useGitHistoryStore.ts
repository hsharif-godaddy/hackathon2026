import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { appService } from '@/services/AppService'

// Constants
const CACHE_DURATION_MS = 30 * 1000 // 30 seconds
const MAX_RETRY_ATTEMPTS = 4
const RETRY_DELAYS = [0, 2000, 4000, 8000] // Progressive delays in milliseconds

interface GitCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

interface GitHistoryStore {
  // State per appId
  commitsByApp: Record<string, GitCommit[]>
  loadingByApp: Record<string, boolean>
  errorByApp: Record<string, string | null>
  lastLoadedByApp: Record<string, number>
  
  // Actions
  loadGitHistory: (appId: string, forceReload?: boolean) => Promise<void>
  refreshGitHistory: (appId: string) => Promise<void>
  clearGitHistory: (appId: string) => void
  
  // Getters
  getCommits: (appId: string) => GitCommit[]
  isLoading: (appId: string) => boolean
  getError: (appId: string) => string | null
}

export const useGitHistoryStore = create<GitHistoryStore>()(
  immer((set, get) => ({
    // Initial state
    commitsByApp: {},
    loadingByApp: {},
    errorByApp: {},
    lastLoadedByApp: {},
    
    // Load git history for a specific app
    loadGitHistory: async (appId: string, forceReload = false) => {
      if (!appId) return
      
      const { loadingByApp, commitsByApp, lastLoadedByApp } = get()
      
      // Don't load if already loading, unless forcing
      if (loadingByApp[appId] && !forceReload) {
        return
      }

      // Don't load if recently loaded, unless forcing
      const lastLoaded = lastLoadedByApp[appId]
      const cacheExpiry = Date.now() - CACHE_DURATION_MS
      if (!forceReload && lastLoaded && lastLoaded > cacheExpiry && commitsByApp[appId]?.length > 0) {
        return
      }

      set((state) => {
        state.loadingByApp[appId] = true
        state.errorByApp[appId] = null
      })


      // Smart retry logic - longer delays for newer apps that might not be ready
      let attempts = 0

      while (attempts < MAX_RETRY_ATTEMPTS) {
        attempts++

        try {

          // Add delay before attempt (except first)
          if (attempts > 1) {
            const delay = RETRY_DELAYS[attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1]
            await new Promise(resolve => setTimeout(resolve, delay))
          }

          const { commits: loadedCommits } = await appService.getGitHistory(appId)
          
          set((state) => {
            state.commitsByApp[appId] = loadedCommits || []
            state.loadingByApp[appId] = false
            state.errorByApp[appId] = null
            state.lastLoadedByApp[appId] = Date.now()
          })
          
          return

        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err) || 'Unknown error'

          // Don't retry certain permanent errors
          if (errorMessage.includes('404') || 
              errorMessage.includes('403') || 
              errorMessage.includes('not found') ||
              errorMessage.includes('Not a git repository')) {
            set((state) => {
              state.errorByApp[appId] = errorMessage
              state.loadingByApp[appId] = false
            })
            break
          }
        }
      }

      // All attempts failed
      set((state) => {
        state.loadingByApp[appId] = false
        state.commitsByApp[appId] = [] // Set empty array to indicate we tried but failed
      })
    },

    // Force refresh git history
    refreshGitHistory: async (appId: string) => {
      await get().loadGitHistory(appId, true)
    },

    // Clear git history for a specific app
    clearGitHistory: (appId: string) => {
      set((state) => {
        delete state.commitsByApp[appId]
        delete state.loadingByApp[appId]
        delete state.errorByApp[appId]
        delete state.lastLoadedByApp[appId]
      })
    },

    // Getters
    getCommits: (appId: string) => {
      return get().commitsByApp[appId] || []
    },

    isLoading: (appId: string) => {
      return get().loadingByApp[appId] || false
    },

    getError: (appId: string) => {
      return get().errorByApp[appId] || null
    }
  }))
)

// Cleanup function to call on unmount
export const cleanupGitHistoryStore = (appId?: string) => {
  const store = useGitHistoryStore.getState()
  if (appId) {
    store.clearGitHistory(appId)
  } else {
    // Clear all if no specific appId provided
    useGitHistoryStore.setState({
      commitsByApp: {},
      loadingByApp: {},
      errorByApp: {},
      lastLoadedByApp: {}
    })
  }
}
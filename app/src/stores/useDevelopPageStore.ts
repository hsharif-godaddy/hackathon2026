import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { appService } from '@/services/AppService'

interface GitCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

interface DevelopPageStore {
  // UI states
  viewMode: 'preview' | 'code'
  previewViewMode: 'desktop' | 'mobile'
  isSelectMode: boolean
  expandedPlan: boolean
  chatPaneWidth: number
  
  // UI loading indicators
  isRestarting: boolean
  hasUnsavedChanges: boolean
  isCheckingApp: boolean
  isStartingApp: boolean
  
  // Version history UI
  isVersionHistoryOpen: boolean
  selectedCommit: GitCommit | null
  commitHistory: GitCommit[]
  isLoadingCommits: boolean
  
  // UI setters
  setViewMode: (mode: 'preview' | 'code') => void
  setPreviewViewMode: (mode: 'desktop' | 'mobile') => void
  setIsSelectMode: (selectMode: boolean) => void
  setExpandedPlan: (expanded: boolean) => void
  setChatPaneWidth: (width: number) => void
  setHasUnsavedChanges: (hasChanges: boolean) => void
  setIsVersionHistoryOpen: (open: boolean) => void
  setSelectedCommit: (commit: GitCommit | null) => void
  
  // Coordinated actions (call domain stores + manage UI state)
  restartApp: (appId: string, appStoreRestartApp: (appId: string) => Promise<void>) => Promise<void>
  ensureAppIsRunning: (appId: string, appStoreEnsureAppIsRunning: (appId: string) => Promise<{ success: boolean; action?: string; message?: string }>) => Promise<void>
  fetchCommitHistory: (appId: string) => Promise<void>
  selectCommit: (appId: string, commit: GitCommit | null) => Promise<void>
  
  // UI helpers
  toggleSelectMode: () => void
  toggleExpandedPlan: () => void
  toggleVersionHistory: (appId?: string) => void
  handleViewModeChange: (newMode: 'preview' | 'code', hasUnsavedChanges: boolean) => void
}

export const useDevelopPageStore = create<DevelopPageStore>()(
  immer((set, get) => ({
    // Initial UI state
    viewMode: 'preview',
    previewViewMode: 'desktop',
    isSelectMode: false,
    expandedPlan: false,
    chatPaneWidth: 400,
    isRestarting: false,
    hasUnsavedChanges: false,
    isCheckingApp: false,
    isStartingApp: false,
    isVersionHistoryOpen: false,
    selectedCommit: null,
    commitHistory: [],
    isLoadingCommits: false,
    
    // UI setters
    setViewMode: (mode) => set((state) => { state.viewMode = mode }),
    setPreviewViewMode: (mode) => set((state) => { state.previewViewMode = mode }),
    setIsSelectMode: (selectMode) => set((state) => { state.isSelectMode = selectMode }),
    setExpandedPlan: (expanded) => set((state) => { state.expandedPlan = expanded }),
    setChatPaneWidth: (width) => set((state) => { state.chatPaneWidth = width }),
    setHasUnsavedChanges: (hasChanges) => set((state) => { state.hasUnsavedChanges = hasChanges }),
    setIsVersionHistoryOpen: (open) => set((state) => { state.isVersionHistoryOpen = open }),
    setSelectedCommit: (commit) => set((state) => { state.selectedCommit = commit }),
    
    // Coordinated actions
    restartApp: async (appId: string, appStoreRestartApp: (appId: string) => Promise<void>) => {
      if (get().isRestarting) return
      
      set((state) => { state.isRestarting = true })
      
      try {
        // Call the actual business logic from useAppStore 
        await appStoreRestartApp(appId)
        
        // Wait for completion feedback
        await new Promise(resolve => setTimeout(resolve, 5000))
        
      } catch (error) {
        console.error('❌ Error restarting server:', error)
        throw error
      } finally {
        set((state) => { state.isRestarting = false })
      }
    },
    
    ensureAppIsRunning: async (appId: string, appStoreEnsureAppIsRunning: (appId: string) => Promise<{ success: boolean; action?: string; message?: string }>) => {
      set((state) => { state.isCheckingApp = true })
      
      try {
        // Call the actual business logic from useAppStore
        const data = await appStoreEnsureAppIsRunning(appId)
        
        if (data.action === 'rebuild' || data.action === 'start') {
          set((state) => { state.isStartingApp = true })
          console.log(`🔄 App is being ${data.action === 'rebuild' ? 'rebuilt' : 'started'}...`)
          
          // Wait for the action to complete
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          set((state) => { state.isStartingApp = false })
        }
      } catch (error) {
        console.error('Error ensuring app is running:', error)
      } finally {
        set((state) => {
          state.isCheckingApp = false
          state.isStartingApp = false
        })
      }
    },
    
    fetchCommitHistory: async (appId: string) => {
      set((state) => { state.isLoadingCommits = true })
      
      try {
        // Retry logic for git history - apps might not be ready immediately
        let attempts = 0
        const maxAttempts = 3
        const baseDelay = 2000 // Start with 2 seconds
        
        while (attempts < maxAttempts) {
          try {
            const { commits } = await appService.getGitHistory(appId)
            set((state) => { state.commitHistory = commits || [] })
            console.log(`✅ Git history loaded: ${commits?.length || 0} commits for app ${appId}`)
            return // Success, exit retry loop
          } catch (err: unknown) {
            attempts++
            console.log(`⚠️ Git history attempt ${attempts}/${maxAttempts} failed for app ${appId}:`, (err as Error)?.message)
            
            // Don't retry on certain error codes that won't resolve with time
            if ((err as Error)?.message?.includes('404') || (err as Error)?.message?.includes('403')) {
              console.log(`🚫 App ${appId} not found or forbidden, stopping git history retries`)
              break
            }
            
            if (attempts < maxAttempts) {
              const delay = baseDelay * attempts
              console.log(`⏳ Retrying git history for ${appId} in ${delay}ms...`)
              await new Promise(resolve => setTimeout(resolve, delay))
            }
          }
        }
        
        // If all attempts failed, set empty history (don't crash the app)
        console.log(`❌ All git history attempts failed for app ${appId}, using empty history`)
        set((state) => { state.commitHistory = [] })
        
      } catch (err) {
        console.error(`Error loading commit history for app ${appId}:`, err)
        set((state) => { state.commitHistory = [] })
      } finally {
        set((state) => { state.isLoadingCommits = false })
      }
    },
    
    selectCommit: async (appId: string, commit: GitCommit | null) => {
      try {
        if (commit === null) {
          // Return to latest (main branch)
          await appService.returnToMainBranch(appId)
          set((state) => { state.selectedCommit = null })
          console.log('✅ Returned to main branch')
          return
        }
        
        console.log(`🔍 Viewing commit ${commit.shortHash}: "${commit.message}" (${commit.date})`)
        console.log('⚠️ Note: Changes requested after this will be made on latest commit, not the viewed commit')
        
        // Checkout specific commit
        await appService.checkoutCommit(appId, commit.hash)
        set((state) => { state.selectedCommit = commit })
        console.log(`✅ Checked out commit ${commit.shortHash}`)
        
      } catch (error) {
        console.error('❌ Error selecting commit:', error)
        throw error
      }
    },
    
    // UI helpers
    toggleSelectMode: () => {
      const newSelectMode = !get().isSelectMode
      set((state) => { state.isSelectMode = newSelectMode })
      
      // Send message to preview iframe to toggle select mode
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'TOGGLE_SELECT_MODE',
          data: { isSelectMode: newSelectMode }
        }, '*')
      }
    },
    
    toggleExpandedPlan: () => {
      set((state) => { state.expandedPlan = !state.expandedPlan })
    },
    
    toggleVersionHistory: (appId?: string) => {
      const newIsVersionHistoryOpen = !get().isVersionHistoryOpen
      set((state) => { state.isVersionHistoryOpen = newIsVersionHistoryOpen })
      
      // If opening the history, refresh the commits
      if (newIsVersionHistoryOpen && appId) {
        get().fetchCommitHistory(appId)
      }
    },
    
    handleViewModeChange: (newMode: 'preview' | 'code', hasUnsavedChanges: boolean) => {
      const { viewMode } = get()
      
      if (hasUnsavedChanges && viewMode === 'code' && newMode === 'preview') {
        const confirmed = window.confirm(
          'You have unsaved changes in the code editor. Switching to preview will keep your changes, but they won\'t be reflected in the preview until saved. Continue?'
        )
        if (!confirmed) return
      }
      
      set((state) => { state.viewMode = newMode })
    }
  }))
)
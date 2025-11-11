import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { postMessageToIframe } from '@/utils/postMessage'
import { appService, type App } from '@/services/AppService'
import { type Site, useSitesStore } from '@/stores/useSitesStore'
import { ViewMode, PreviewViewMode, ChatTab, SettingsSection } from '@/app/develop/components/types'
import { logger } from '@/lib/request-context'
import { logImpressionEvent } from '@/utils/instrumentation'

interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
}

// Options sheet tab types
export enum OptionsSheetTab {
  HISTORY = 'history'
}

// Loading phases for proper sequencing
type LoadingPhase = 'idle' | 'loading-app' | 'loading-site' | 'loading-conversations' | 'ready'

interface DevelopPageStore {
  // UI states
  activeChatTab: ChatTab
  viewMode: ViewMode
  previewViewMode: PreviewViewMode
  isSelectMode: boolean
  expandedPlan: boolean
  chatPaneWidth: number
  isChatPaneCollapsed: boolean
  isMobile: boolean

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
  isSelectingCommit: boolean

  // Options sheet UI
  openOptionsSheet: OptionsSheetTab | null

  // Feedback modal UI
  openFeedbackId: string | null

  // Settings section UI
  activeSettingsSection: SettingsSection

  // Publish status UI (per-app state keyed by appId)
  publishStates: Record<string, {
    isPublishing: boolean
    publishError: boolean
    lastPublishedCommitHash: string | null
    deploymentsRefetch: (() => Promise<any>) | null
    deploymentInProgressId: string | null
    showSuccessAlert: boolean
  }>

  // Page loading orchestration
  loadingPhase: LoadingPhase
  currentAppId: string | null
  app: App | null
  site: Site | null
  loadingError: string | null
  autoSendTriggered: boolean

  // UI setters
  setActiveChatTab: (tab: ChatTab) => void
  setViewMode: (mode: ViewMode) => void
  setPreviewViewMode: (mode: PreviewViewMode) => void
  setIsSelectMode: (selectMode: boolean) => void
  setExpandedPlan: (expanded: boolean) => void
  setChatPaneWidth: (width: number) => void
  setIsChatPaneCollapsed: (collapsed: boolean) => void
  setHasUnsavedChanges: (hasChanges: boolean) => void
  setIsMobile: (isMobile: boolean) => void
  setIsVersionHistoryOpen: (open: boolean) => void
  setSelectedCommit: (commit: GitCommit | null) => void
  setOpenOptionsSheet: (sheet: OptionsSheetTab | null) => void

  // Feedback modal actions
  openFeedbackModal: (feedbackId: string) => void
  closeFeedbackModal: () => void

  // Settings section actions
  setActiveSettingsSection: (section: SettingsSection) => void

  // Publish status actions (per-app)
  setIsPublishing: (appId: string, isPublishing: boolean) => void
  setPublishError: (appId: string, hasError: boolean) => void
  setLastPublishedCommitHash: (appId: string, commitHash: string | null) => void
  setDeploymentsRefetch: (appId: string, refetch: (() => Promise<any>) | null) => void
  setDeploymentInProgressId: (appId: string, deploymentId: string | null) => void
  setPublishSuccess: (appId: string, showSuccess: boolean) => void
  dismissPublishSuccess: (appId: string) => void
  clearPublishStatus: (appId: string) => void
  getPublishState: (appId: string) => {
    isPublishing: boolean
    publishError: boolean
    lastPublishedCommitHash: string | null
    deploymentsRefetch: (() => Promise<any>) | null
    deploymentInProgressId: string | null
    showSuccessAlert: boolean
  }

  // Page loading orchestration
  initializePage: (appId: string) => Promise<void>
  evaluateInitialActions: () => Promise<void>
  resetForNewApp: (appId: string) => void

  // Coordinated actions (call domain stores + manage UI state)
  restartApp: (appId: string, appStoreRestartApp: (appId: string) => Promise<void>) => Promise<void>
  ensureAppIsRunning: (appId: string, appStoreEnsureAppIsRunning: (appId: string) => Promise<{ success: boolean; action?: string; message?: string }>) => Promise<void>
  fetchCommitHistory: (appId: string) => Promise<void>
  selectCommit: (appId: string, commit: GitCommit | null) => Promise<void>

  // UI helpers
  toggleSelectMode: () => void
  toggleExpandedPlan: () => void
  toggleChatPaneCollapse: () => void
  toggleVersionHistory: (appId?: string) => void
  handleViewModeChange: (newMode: ViewMode, hasUnsavedChanges: boolean) => void
  initializeMobileDetection: () => () => void
}

export const useDevelopPageStore = create<DevelopPageStore>()(
  devtools(
    immer((set, get) => ({
    // Initial UI state
    activeChatTab: ChatTab.CHAT,
    viewMode: ViewMode.PREVIEW,
    previewViewMode: PreviewViewMode.DESKTOP,
    isSelectMode: false,
    expandedPlan: false,
    chatPaneWidth: 400,
    isChatPaneCollapsed: false,
    isMobile: false,
    isRestarting: false,
    hasUnsavedChanges: false,
    isCheckingApp: false,
    isStartingApp: false,
    isVersionHistoryOpen: false,
    selectedCommit: null,
    commitHistory: [],
    isLoadingCommits: false,
    openOptionsSheet: null,
    isSelectingCommit: false, // Track commit selection state

    // Feedback modal state
    openFeedbackId: null,

    // Settings section state
    activeSettingsSection: SettingsSection.DATABASE,

    // Publish status state (per-app, keyed by appId)
    publishStates: {},

    // Page loading orchestration state
    loadingPhase: 'idle',
    currentAppId: null,
    app: null,
    site: null,
    loadingError: null,
    autoSendTriggered: false,

    // UI setters
    setActiveChatTab: (tab) => set((state) => { state.activeChatTab = tab }),
    setViewMode: (mode) => set((state) => { state.viewMode = mode }),
    setPreviewViewMode: (mode) => set((state) => { state.previewViewMode = mode }),
    setIsSelectMode: (selectMode) => set((state) => { state.isSelectMode = selectMode }),
    setExpandedPlan: (expanded) => set((state) => { state.expandedPlan = expanded }),
    setChatPaneWidth: (width) => set((state) => { state.chatPaneWidth = width }),
    setIsChatPaneCollapsed: (collapsed) => set((state) => { state.isChatPaneCollapsed = collapsed }),
    setHasUnsavedChanges: (hasChanges) => set((state) => { state.hasUnsavedChanges = hasChanges }),
    setIsMobile: (isMobile) => set((state) => {
      state.isMobile = isMobile
      // Reset activeTab when switching between mobile/desktop to ensure proper layout
      if (state.activeChatTab !== ChatTab.CHAT) {
        state.activeChatTab = ChatTab.CHAT
      }
    }),
    setIsVersionHistoryOpen: (open) => set((state) => { state.isVersionHistoryOpen = open }),
    setSelectedCommit: (commit) => set((state) => { state.selectedCommit = commit }),
    setOpenOptionsSheet: (sheet) => set((state) => { state.openOptionsSheet = sheet }),

    // Feedback modal actions
    openFeedbackModal: (feedbackId: string) => {
      // Check if feedback modal has been shown before using feedback ID
      const localStorageKey = `airo-feedback-shown:${feedbackId}`
      const hasShownFeedback = typeof window !== 'undefined'
        ? localStorage.getItem(localStorageKey) === 'true'
        : false

      if (hasShownFeedback) {
        return
      }

      logger.info('feedback.modal.opened', {
        message: 'Feedback modal opened',
        feedbackId
      })

      logImpressionEvent('feedback.modal.opened')();

      // Mark as shown in localStorage with feedback ID
      if (typeof window !== 'undefined') {
        localStorage.setItem(localStorageKey, 'true')
      }

      set((state) => {
        state.openFeedbackId = feedbackId
      })
    },
    closeFeedbackModal: () => {
      const currentFeedbackId = get().openFeedbackId
      logger.info('feedback.modal.closed', {
        message: 'Feedback modal closed',
        feedbackId: currentFeedbackId
      })
      logImpressionEvent('feedback.modal.closed')();
      set((state) => {
        state.openFeedbackId = null
      })
    },

    // Settings section actions
    setActiveSettingsSection: (section) => set((state) => { state.activeSettingsSection = section }),

    // Publish status actions (per-app)
    getPublishState: (appId: string) => {
      const state = get().publishStates[appId];
      return state || {
        isPublishing: false,
        publishError: false,
        lastPublishedCommitHash: null,
        deploymentsRefetch: null,
        deploymentInProgressId: null,
        showSuccessAlert: false,
      };
    },
    setIsPublishing: (appId: string, isPublishing: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = {
          isPublishing: false,
          publishError: false,
          lastPublishedCommitHash: null,
          deploymentsRefetch: null,
          deploymentInProgressId: null,
          showSuccessAlert: false,
        };
      }
      state.publishStates[appId].isPublishing = isPublishing;
    }),
    setPublishError: (appId: string, hasError: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = {
          isPublishing: false,
          publishError: false,
          lastPublishedCommitHash: null,
          deploymentsRefetch: null,
          deploymentInProgressId: null,
          showSuccessAlert: false,
        };
      }
      state.publishStates[appId].publishError = hasError;
    }),
    setLastPublishedCommitHash: (appId: string, commitHash: string | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = {
          isPublishing: false,
          publishError: false,
          lastPublishedCommitHash: null,
          deploymentsRefetch: null,
          deploymentInProgressId: null,
          showSuccessAlert: false,
        };
      }
      state.publishStates[appId].lastPublishedCommitHash = commitHash;
    }),
    setDeploymentsRefetch: (appId: string, refetch: (() => Promise<any>) | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = {
          isPublishing: false,
          publishError: false,
          lastPublishedCommitHash: null,
          deploymentsRefetch: null,
          deploymentInProgressId: null,
          showSuccessAlert: false,
        };
      }
      state.publishStates[appId].deploymentsRefetch = refetch;
    }),
    setDeploymentInProgressId: (appId: string, deploymentId: string | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = {
          isPublishing: false,
          publishError: false,
          lastPublishedCommitHash: null,
          deploymentsRefetch: null,
          deploymentInProgressId: null,
          showSuccessAlert: false,
        };
      }
      state.publishStates[appId].deploymentInProgressId = deploymentId;
    }),
    setPublishSuccess: (appId: string, showSuccess: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = {
          isPublishing: false,
          publishError: false,
          lastPublishedCommitHash: null,
          deploymentsRefetch: null,
          deploymentInProgressId: null,
          showSuccessAlert: false,
        };
      }
      state.publishStates[appId].showSuccessAlert = showSuccess;
      state.publishStates[appId].isPublishing = false;
      state.publishStates[appId].publishError = false;
    }),
    dismissPublishSuccess: (appId: string) => set((state) => {
      if (state.publishStates[appId]) {
        state.publishStates[appId].showSuccessAlert = false;
      }
    }),
    clearPublishStatus: (appId: string) => set((state) => {
      if (state.publishStates[appId]) {
        state.publishStates[appId].isPublishing = false;
        state.publishStates[appId].publishError = false;
        state.publishStates[appId].showSuccessAlert = false;
        // Keep lastPublishedCommitHash and deploymentsRefetch for retry functionality
      }
    }),



    // Page loading orchestration
    resetForNewApp: (appId: string) => {
      logger.debug('develop-store.reset', { message: 'Resetting develop page store for new app', appId })
      set((state) => {
        state.currentAppId = appId
        state.loadingPhase = 'idle'
        state.app = null
        state.site = null
        state.loadingError = null
        state.autoSendTriggered = false
        state.selectedCommit = null
        state.commitHistory = []
        state.hasUnsavedChanges = false
        state.openOptionsSheet = null
      })
    },

    initializePage: async (appId: string) => {
      const state = get()

      // Prevent duplicate initialization
      if (state.currentAppId === appId && state.loadingPhase !== 'idle') {
        logger.debug('develop-store.skip-init', { message: 'Page already initializing/initialized', appId })
        return
      }

      logger.info('develop-store.init.start', { message: 'Starting page initialization', appId })

      // Stop any ongoing site creation polling to prevent overlapping requests
      const { useSiteCreationStore } = await import('./useSiteCreationStore')
      const creationStore = useSiteCreationStore.getState()
      if (creationStore.siteId === appId || creationStore.realAppId === appId) {
        logger.info('develop-store.init.cleanup-creation-polling', {
          message: 'Stopping site creation polling to prevent overlapping requests',
          creationSiteId: creationStore.siteId,
          creationRealAppId: creationStore.realAppId,
          developAppId: appId
        })
        creationStore.cleanup()
      }

      // Reset streaming conversation store before mounting components
      const { useStreamingConversationStore } = await import('./useStreamingConversationStore')
      const streamingStore = useStreamingConversationStore.getState()
      logger.debug('develop-store.init.reset-streaming', {
        message: 'Resetting streaming store for new app',
        oldAppId: streamingStore.currentAppId,
        newAppId: appId
      })
      streamingStore.setCurrentAppId(appId)

      get().resetForNewApp(appId)

      try {
        // Phase 1: Load app data
        set((state) => { state.loadingPhase = 'loading-app' })
        logger.debug('develop-store.init.loading-app', { message: 'Loading app data' })

        const [appData] = await Promise.all([
          appService.getApp(appId),
          appService.getConfig(appId)
        ])

        set((state) => {
          state.app = appData.app
        })
        logger.info('develop-store.init.app-loaded', { message: 'App data loaded', appName: appData.app.name })

        // Phase 2: Load site data
        set((state) => { state.loadingPhase = 'loading-site' })
        logger.debug('develop-store.init.loading-site', { message: 'Loading site data' })

        const siteStore = useSitesStore.getState()
        const site = await siteStore.fetchSite(appId)

        set((state) => {
          state.site = site
        })
        logger.info('develop-store.init.site-loaded', { message: 'Site data loaded', siteName: site?.name || 'unknown' })

        // Phase 3: Load conversations with proper context
        set((state) => { state.loadingPhase = 'loading-conversations' })
        logger.debug('develop-store.init.loading-conversations', { message: 'Loading conversations' })

        // Legacy conversation initialization removed - streaming architecture handles this differently
        logger.debug('develop-store.init.conversations-skipped', { message: 'Legacy conversation init skipped' })
        logger.info('develop-store.init.conversations-loaded', { message: 'Conversations loaded' })

        // Phase 4: Evaluate initial actions (auto-send, etc.)
        set((state) => { state.loadingPhase = 'ready' })
        await get().evaluateInitialActions()

        logger.info('develop-store.init.complete', { message: 'Page initialization complete', appId })

      } catch (error) {
        logger.error('develop-store.init.failure', { message: 'Page initialization failed', error: error instanceof Error ? error.message : String(error) })
        set((state) => {
          state.loadingPhase = 'idle'
          state.loadingError = error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    },

    evaluateInitialActions: async () => {
      const state = get()
      const { app, site } = state

      logger.debug('develop-store.initial-actions.evaluate', {
        message: 'Evaluating initial actions',
        hasApp: !!app,
        hasSite: !!site,
        hasInitialPrompt: !!site?.initial_prompt,
        siteStatus: site?.status,
        initialBuildComplete: app?.initialBuildComplete
      })

      // Auto-send is now handled directly in the develop page component
      // This method is kept for future initial actions that might be needed
      logger.info('develop-store.initial-actions.complete', {
        message: 'Initial actions evaluation complete - auto-send handled by page component'
      })
    },

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
        logger.error('develop-store.restart.failure', { message: 'Error restarting server', error: error instanceof Error ? error.message : String(error) })
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
          logger.info('develop-store.app-action', { message: `App is being ${data.action === 'rebuild' ? 'rebuilt' : 'started'}`, action: data.action })

          // Wait for the action to complete
          await new Promise(resolve => setTimeout(resolve, 1000))

          set((state) => { state.isStartingApp = false })
        }
      } catch (error) {
        logger.error('develop-store.ensure-running.failure', { message: 'Error ensuring app is running', error: error instanceof Error ? error.message : String(error) })
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
            logger.info('develop-store.git-history.loaded', { message: 'Git history loaded', commits: commits?.length || 0, appId })
            return // Success, exit retry loop
          } catch (err: unknown) {
            attempts++
            logger.warn('develop-store.git-history.attempt-failed', { message: 'Git history attempt failed', attempt: attempts, maxAttempts, appId, error: (err as Error)?.message })

            // Don't retry on certain error codes that won't resolve with time
            if ((err as Error)?.message?.includes('404') || (err as Error)?.message?.includes('403')) {
              logger.warn('develop-store.git-history.stopped', { message: 'App not found or forbidden, stopping git history retries', appId })
              break
            }

            if (attempts < maxAttempts) {
              const delay = baseDelay * attempts
              logger.info('develop-store.git-history.retry', { message: 'Retrying git history', appId, delay })
              await new Promise(resolve => setTimeout(resolve, delay))
            }
          }
        }

        // If all attempts failed, set empty history (don't crash the app)
        logger.warn('develop-store.git-history.all-attempts-failed', { message: 'All git history attempts failed, using empty history', appId })
        set((state) => { state.commitHistory = [] })

      } catch (err) {
        logger.error('develop-store.git-history.error', { message: 'Error loading commit history', appId, error: err instanceof Error ? err.message : String(err) })
        set((state) => { state.commitHistory = [] })
      } finally {
        set((state) => { state.isLoadingCommits = false })
      }
    },

    selectCommit: async (appId: string, commit: GitCommit | null) => {
      // Prevent concurrent commit selections
      const state = get();
      if (state.isSelectingCommit) {
        logger.info('develop-store.commit-selection.skip', { message: 'Commit selection already in progress, skipping' });
        return;
      }

      set((state) => { state.isSelectingCommit = true });

      try {
        if (commit === null) {
          // Return to latest (main branch)
          logger.info('develop-store.commit-selection.return-main', { message: 'Returning to main branch' });
          await appService.returnToMainBranch(appId)
          set((state) => { state.selectedCommit = null })
          logger.info('develop-store.commit-selection.return-main-success', { message: 'Returned to main branch' })
          return
        }

        logger.info('develop-store.commit-selection.view', {
          message: 'Viewing commit',
          commitHash: commit.hash.substring(0, 7),
          commitMessage: commit.message,
          date: commit.date
        })
        logger.warn('develop-store.commit-selection.note', { message: 'Changes requested after this will be made on latest commit, not the viewed commit' })

        // Checkout specific commit
        logger.info('develop-store.commit-selection.checkout', { message: 'Checking out commit', commitHash: commit.hash.substring(0, 7) });
        await appService.checkoutCommit(appId, commit.hash)
        set((state) => { state.selectedCommit = commit })
        logger.info('develop-store.commit-selection.checkout-success', { message: 'Checked out commit', commitHash: commit.hash.substring(0, 7) })

      } catch (error) {
        logger.error('develop-store.commit-selection.error', { message: 'Error selecting commit', error: error instanceof Error ? error.message : String(error) })
        throw error
      } finally {
        set((state) => { state.isSelectingCommit = false });
      }
    },

    // UI helpers
    toggleSelectMode: () => {
      const newSelectMode = !get().isSelectMode
      set((state) => { state.isSelectMode = newSelectMode })

      // Send message to preview iframe to toggle select mode
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        postMessageToIframe(iframe, {
          type: 'TOGGLE_SELECT_MODE',
          data: { isSelectMode: newSelectMode }
        })
      }
    },

    toggleExpandedPlan: () => {
      set((state) => { state.expandedPlan = !state.expandedPlan })
    },

    toggleChatPaneCollapse: () => {
      set((state) => { state.isChatPaneCollapsed = !state.isChatPaneCollapsed })
    },

    toggleVersionHistory: (appId?: string) => {
      const newIsVersionHistoryOpen = !get().isVersionHistoryOpen
      set((state) => { state.isVersionHistoryOpen = newIsVersionHistoryOpen })

      // If opening the history, refresh the commits
      if (newIsVersionHistoryOpen && appId) {
        get().fetchCommitHistory(appId)
      }
    },

    handleViewModeChange: (newMode: ViewMode, hasUnsavedChanges: boolean) => {
      const { viewMode } = get()

      if (hasUnsavedChanges && viewMode === ViewMode.CODE && newMode === ViewMode.PREVIEW) {
        const confirmed = window.confirm(
          'You have unsaved changes in the code editor. Switching to preview will keep your changes, but they won\'t be reflected in the preview until saved. Continue?'
        )
        if (!confirmed) return
      }

      set((state) => { state.viewMode = newMode })
    },

    initializeMobileDetection: () => {
      const checkMobile = () => {
        const newIsMobile = window.innerWidth < 768 // md breakpoint
        get().setIsMobile(newIsMobile)
      }

      checkMobile()
      window.addEventListener('resize', checkMobile)

      return () => window.removeEventListener('resize', checkMobile)
    }
  })),
    { name: 'DevelopPageStore' }
  )
)

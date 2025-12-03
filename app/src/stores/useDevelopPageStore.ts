import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { postMessageToIframe } from '@/utils/postMessage'
import { appService, type App } from '@/services/AppService'
import { type Site, useSitesStore } from '@/stores/useSitesStore'
import { ViewMode, PreviewViewMode, ChatTab, SettingsSection } from '@/app/develop/components/types'
import { logger } from '@/lib/request-context'
import { logImpressionEvent } from '@/utils/instrumentation'

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
  isPreviewVisible: boolean

  // UI loading indicators
  isRestarting: boolean
  hasUnsavedChanges: boolean
  isCheckingApp: boolean
  isStartingApp: boolean

  // Version history UI
  isVersionHistoryOpen: boolean

  // Feedback modal UI
  openFeedbackId: string | null

  // Settings section UI
  activeSettingsSection: SettingsSection

  // Tour UI
  showIntroTour: boolean

  // Publish status UI (per-app state keyed by appId)
  publishStates: Record<string, {
    isPublishing: boolean
    publishError: boolean
    buildErrorDetails: { error: string; details: string; exitCode?: number } | null
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
  setIsPreviewVisible: (visible: boolean) => void

  // Feedback modal actions
  openFeedbackModal: (feedbackId: string) => void
  closeFeedbackModal: () => void

  // Settings section actions
  setActiveSettingsSection: (section: SettingsSection) => void

  // Tour actions
  setShowIntroTour: (show: boolean) => void
  checkAndTriggerIntroTour: (appId: string) => void

  // Publish status actions (per-app)
  setIsPublishing: (appId: string, isPublishing: boolean) => void
  setPublishError: (appId: string, hasError: boolean) => void
  setBuildErrorDetails: (appId: string, errorDetails: { error: string; details: string; exitCode?: number } | null) => void
  setLastPublishedCommitHash: (appId: string, commitHash: string | null) => void
  setDeploymentsRefetch: (appId: string, refetch: (() => Promise<any>) | null) => void
  setDeploymentInProgressId: (appId: string, deploymentId: string | null) => void
  setPublishSuccess: (appId: string, showSuccess: boolean) => void
  dismissPublishSuccess: (appId: string) => void
  clearPublishStatus: (appId: string) => void
  getPublishState: (appId: string) => {
    isPublishing: boolean
    publishError: boolean
    buildErrorDetails: { error: string; details: string; exitCode?: number } | null
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

  // UI helpers
  toggleSelectMode: () => void
  toggleExpandedPlan: () => void
  toggleChatPaneCollapse: () => void
  toggleVersionHistory: () => void
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
    isPreviewVisible: false,
    isRestarting: false,
    hasUnsavedChanges: false,
    isCheckingApp: false,
    isStartingApp: false,
    isVersionHistoryOpen: false,

    // Feedback modal state
    openFeedbackId: null,

    // Settings section state
    activeSettingsSection: SettingsSection.DOMAIN,

    // Tour state
    showIntroTour: false,

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
      // Only reset tab if we're actually transitioning between mobile/desktop
      const wasTransition = state.isMobile !== isMobile
      const wasMobileGoingToDesktop = state.isMobile === true && isMobile === false

      state.isMobile = isMobile

      // Reset activeTab when switching between mobile/desktop to ensure proper layout
      if (wasTransition && state.activeChatTab !== ChatTab.CHAT) {
        state.activeChatTab = ChatTab.CHAT
      }

      // Reset chatPaneWidth when going from mobile to desktop to prevent layout issues
      if (wasMobileGoingToDesktop) {
        state.chatPaneWidth = 400 // Reset to default width
      }
    }),
    setIsVersionHistoryOpen: (open) => set((state) => { state.isVersionHistoryOpen = open }),
    setIsPreviewVisible: (visible) => set((state) => { state.isPreviewVisible = visible }),

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

    // Tour actions
    setShowIntroTour: (show: boolean) => set((state) => {
      state.showIntroTour = show
    }),

    /**
     * Check if intro tour should be shown for this app and trigger it if appropriate
     * Tour is shown only once for the first site creation
     *
     * @param appId - The app ID to check
     */
    checkAndTriggerIntroTour: (appId: string) => {
      // Check global localStorage to see if user has EVER seen the tour (safety check)
      const globalTourKey = 'airo-intro-tour-shown'
      const hasEverSeenTour = typeof window !== 'undefined' && localStorage.getItem(globalTourKey) === 'true'

      if (hasEverSeenTour) {
        return
      }

      // Check if user has multiple sites - only show tour for first site
      const totalSites = useSitesStore.getState().getTotalSites()
      if (totalSites > 1) {
        return
      }

      // Mark globally that tour has been shown
      if (typeof window !== 'undefined') {
        localStorage.setItem(globalTourKey, 'true')
      }

      // Show the tour with a small delay to ensure UI is fully rendered
      setTimeout(() => {
        set((state) => {
          state.showIntroTour = true
        })
      }, 1000)
    },

    // Publish status actions (per-app)
    getPublishState: (appId: string) => {
      const state = get().publishStates[appId];
      return state || {
        isPublishing: false,
        publishError: false,
        buildErrorDetails: null,
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
          buildErrorDetails: null,
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
          buildErrorDetails: null,
          lastPublishedCommitHash: null,
          deploymentsRefetch: null,
          deploymentInProgressId: null,
          showSuccessAlert: false,
        };
      }
      state.publishStates[appId].publishError = hasError;
    }),
    setBuildErrorDetails: (appId: string, errorDetails: { error: string; details: string; exitCode?: number } | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = {
          isPublishing: false,
          publishError: false,
          buildErrorDetails: null,
          lastPublishedCommitHash: null,
          deploymentsRefetch: null,
          deploymentInProgressId: null,
          showSuccessAlert: false,
        };
      }
      state.publishStates[appId].buildErrorDetails = errorDetails;
    }),
    setLastPublishedCommitHash: (appId: string, commitHash: string | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = {
          isPublishing: false,
          publishError: false,
          buildErrorDetails: null,
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
          buildErrorDetails: null,
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
          buildErrorDetails: null,
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
          buildErrorDetails: null,
          lastPublishedCommitHash: null,
          deploymentsRefetch: null,
          deploymentInProgressId: null,
          showSuccessAlert: false,
        };
      }
      state.publishStates[appId].showSuccessAlert = showSuccess;
      state.publishStates[appId].isPublishing = false;
      state.publishStates[appId].publishError = false;
      state.publishStates[appId].buildErrorDetails = null;
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
        state.publishStates[appId].buildErrorDetails = null;
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
        state.hasUnsavedChanges = false
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

    toggleVersionHistory: () => {
      const newIsVersionHistoryOpen = !get().isVersionHistoryOpen
      set((state) => { state.isVersionHistoryOpen = newIsVersionHistoryOpen })
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

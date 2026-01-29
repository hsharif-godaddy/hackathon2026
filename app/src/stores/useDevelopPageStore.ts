import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { DEFAULT_MOBILE_DEVICE, DEFAULT_TABLET_DEVICE } from '@/app/develop/components/preview/devicePresets'
import { PreviewViewMode,ViewMode } from '@/app/develop/components/types'
import { logger } from '@/lib/request-context'
import { type App,appService } from '@/services/AppService'
import { type Site, useSitesStore } from '@/stores/useSitesStore'
import { logImpressionEvent } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'

// Loading phases for proper sequencing
type LoadingPhase = 'idle' | 'loading-app' | 'loading-site' | 'loading-conversations' | 'ready'

// Helper to load go-live status from .airo/live.json (defaults to false for sync init)
const loadGoLiveStatus = (appId: string): { hasGoneLive: boolean; wentLiveAt: string | null } => {
  // Return default for initialization - actual status will be loaded async
  return { hasGoneLive: false, wentLiveAt: null }
}

// Helper to load go-live status from .airo/live.json via API (async version)
const loadGoLiveStatusAsync = async (appId: string): Promise<{ hasGoneLive: boolean; wentLiveAt: string | null }> => {
  if (typeof window === 'undefined') {
    return { hasGoneLive: false, wentLiveAt: null }
  }

  try {
    const { agentFetch } = await import('@/lib/agent-fetch');
    const { dynamicApiConfigService } = await import('@/config/dynamic-api');

    const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);
    if (!apiConfig.agentUrl) {
      logger.warn('develop-store.load-go-live-status.no-agent-url', { appId });
      return { hasGoneLive: false, wentLiveAt: null };
    }

    const response = await agentFetch(`${apiConfig.agentUrl}/apps/${appId}/go-live-status`, {
      siteId: appId,
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Failed to load go-live status: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      hasGoneLive: data.hasGoneLive ?? false,
      wentLiveAt: data.wentLiveAt ?? null
    };
  } catch (error) {
    logger.error('develop-store.load-go-live-status.failure', { appId, error: String(error) });
    return { hasGoneLive: false, wentLiveAt: null };
  }
}

// Helper to save go-live status to .airo/live.json via API
const saveGoLiveStatus = async (appId: string) => {
  if (typeof window === 'undefined') return;

  try {
    const { agentFetch } = await import('@/lib/agent-fetch');
    const { dynamicApiConfigService } = await import('@/config/dynamic-api');
    const { regenerateToken } = await import('@/lib/jwt-regeneration');

    // Regenerate token with canPublish permission
    await regenerateToken({ siteId: appId, force: true });

    const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);
    if (!apiConfig.agentUrl) {
      logger.error('develop-store.save-go-live-status.no-agent-url', { appId });
      return;
    }

    const response = await agentFetch(`${apiConfig.agentUrl}/apps/${appId}/mark-gone-live`, {
      siteId: appId,
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Failed to save go-live status: ${response.statusText}`);
    }

    const result = await response.json();
    logger.info('develop-store.save-go-live-status.success', {
      appId,
      hasGoneLive: result.hasGoneLive,
      wentLiveAt: result.wentLiveAt
    });
  } catch (error) {
    logger.error('develop-store.save-go-live-status.failure', { appId, error: String(error) });
  }
}

// Helper to create default publish state
const createDefaultPublishState = (appId: string) => {
  const goLiveStatus = loadGoLiveStatus(appId);
  return {
    isPublishing: false,
    publishError: false,
    buildErrorDetails: null,
    lastPublishedCommitHash: null,
    deploymentsRefetch: null,
    deploymentInProgressId: null,
    showSuccessAlert: false,
    showPaywallModal: false,
    hasGoneLive: goLiveStatus.hasGoneLive,
    wentLiveAt: goLiveStatus.wentLiveAt,
    showGoLiveModal: false,
    goLiveModalStep: null as 'confirm' | 'qa' | 'security-results' | 'republish' | 'video' | 'marketing' | null,
    securityScanResults: null,
    launchVideoUrl: null,
  };
}

interface DevelopPageStore {
  // UI states
  viewMode: ViewMode
  previewViewMode: PreviewViewMode
  selectedDeviceId: string
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
  isPollingEntitlements: boolean

  // Version history UI
  isVersionHistoryOpen: boolean

  // Feedback modal UI
  openFeedbackId: string | null

  // Tour UI
  showIntroTour: boolean

  // Asset Manager UI
  isAssetManagerOpen: boolean

  // Upgrade Modal UI
  showUpgradeModal: boolean
  upgradeModalSource: string | null

  // Publish status UI (per-app state keyed by appId)
  publishStates: Record<string, {
    isPublishing: boolean
    publishError: boolean
    buildErrorDetails: { error: string; details: string; exitCode?: number } | null
    lastPublishedCommitHash: string | null
    deploymentsRefetch: (() => Promise<any>) | null
    deploymentInProgressId: string | null
    showSuccessAlert: boolean
    showPaywallModal: boolean
    // Go Live modal state
    hasGoneLive: boolean
    wentLiveAt: string | null
    showGoLiveModal: boolean
    goLiveModalStep: 'confirm' | 'qa' | 'security-results' | 'republish' | 'video' | 'marketing' | null
    securityScanResults: any | null
    launchVideoUrl: string | null
  }>

  // Page loading orchestration
  loadingPhase: LoadingPhase
  currentAppId: string | null
  app: App | null
  site: Site | null
  loadingError: string | null
  autoSendTriggered: boolean

  // UI setters
  setViewMode: (mode: ViewMode) => void
  setPreviewViewMode: (mode: PreviewViewMode) => void
  setSelectedDeviceId: (deviceId: string) => void
  setIsSelectMode: (selectMode: boolean) => void
  setExpandedPlan: (expanded: boolean) => void
  setChatPaneWidth: (width: number) => void
  setIsChatPaneCollapsed: (collapsed: boolean) => void
  setHasUnsavedChanges: (hasChanges: boolean) => void
  setIsMobile: (isMobile: boolean) => void
  setIsVersionHistoryOpen: (open: boolean) => void
  setIsPreviewVisible: (visible: boolean) => void
  setIsPollingEntitlements: (isPolling: boolean) => void

  // Feedback modal actions
  openFeedbackModal: (feedbackId: string) => void
  closeFeedbackModal: () => void

  // Tour actions
  setShowIntroTour: (show: boolean) => void
  checkAndTriggerIntroTour: (appId: string) => void

  // Asset Manager actions
  setIsAssetManagerOpen: (open: boolean) => void

  // Upgrade Modal actions
  openUpgradeModal: (source: string) => void
  closeUpgradeModal: () => void

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
  setShowPaywallModal: (appId: string, show: boolean) => void
  getPublishState: (appId: string) => {
    isPublishing: boolean
    publishError: boolean
    buildErrorDetails: { error: string; details: string; exitCode?: number } | null
    lastPublishedCommitHash: string | null
    deploymentsRefetch: (() => Promise<any>) | null
    deploymentInProgressId: string | null
    showSuccessAlert: boolean
    hasGoneLive: boolean
    wentLiveAt: string | null
    showGoLiveModal: boolean
    goLiveModalStep: 'confirm' | 'qa' | 'security-results' | 'republish' | 'video' | 'marketing' | null
    securityScanResults: any | null
    launchVideoUrl: string | null
  }

  // Go Live modal actions
  setShowGoLiveModal: (appId: string, show: boolean) => void
  setGoLiveModalStep: (appId: string, step: 'confirm' | 'qa' | 'security-results' | 'republish' | 'video' | 'marketing' | null) => void
  setSecurityScanResults: (appId: string, results: any | null) => void
  setLaunchVideoUrl: (appId: string, url: string | null) => void
  markAsGoneLive: (appId: string) => Promise<void>
  hasGoneLive: (appId: string) => boolean

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
    viewMode: ViewMode.PREVIEW,
    previewViewMode: PreviewViewMode.DESKTOP,
    selectedDeviceId: 'full',
    isSelectMode: false,
    expandedPlan: false,
    chatPaneWidth: 415,
    isChatPaneCollapsed: false,
    isMobile: false,
    isPreviewVisible: false,
    isRestarting: false,
    hasUnsavedChanges: false,
    isCheckingApp: false,
    isStartingApp: false,
    isPollingEntitlements: false,
    isVersionHistoryOpen: false,

    // Feedback modal state
    openFeedbackId: null,

    // Tour state
    showIntroTour: false,

    // Asset Manager state
    isAssetManagerOpen: false,

    // Upgrade Modal state
    showUpgradeModal: false,
    upgradeModalSource: null,

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
    setViewMode: (mode) => set((state) => { state.viewMode = mode }),
    setPreviewViewMode: (mode) => set((state) => {
      state.previewViewMode = mode
      // Set default device when switching modes
      if (mode === PreviewViewMode.DESKTOP) {
        state.selectedDeviceId = 'full'
      } else if (mode === PreviewViewMode.TABLET) {
        state.selectedDeviceId = DEFAULT_TABLET_DEVICE
      } else if (mode === PreviewViewMode.MOBILE) {
        state.selectedDeviceId = DEFAULT_MOBILE_DEVICE
      }
    }),
    setSelectedDeviceId: (deviceId) => set((state) => { state.selectedDeviceId = deviceId }),
    setIsSelectMode: (selectMode) => set((state) => { state.isSelectMode = selectMode }),
    setExpandedPlan: (expanded) => set((state) => { state.expandedPlan = expanded }),
    setChatPaneWidth: (width) => set((state) => { state.chatPaneWidth = width }),
    setIsChatPaneCollapsed: (collapsed) => set((state) => { state.isChatPaneCollapsed = collapsed }),
    setHasUnsavedChanges: (hasChanges) => set((state) => { state.hasUnsavedChanges = hasChanges }),
    setIsPollingEntitlements: (isPolling) => set((state) => { state.isPollingEntitlements = isPolling }),
    setIsMobile: (isMobile) => set((state) => {
      const wasMobileGoingToDesktop = state.isMobile === true && isMobile === false
      state.isMobile = isMobile
      if (wasMobileGoingToDesktop) {
        state.chatPaneWidth = 400
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
    checkAndTriggerIntroTour: () => {
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

      set((state) => {
        state.showIntroTour = true
      })
    },

    // Asset Manager actions
    setIsAssetManagerOpen: (open: boolean) => set((state) => {
      state.isAssetManagerOpen = open
    }),

    // Upgrade Modal actions
    openUpgradeModal: (source: string) => set((state) => {
      state.showUpgradeModal = true
      state.upgradeModalSource = source
    }),
    closeUpgradeModal: () => set((state) => {
      state.showUpgradeModal = false
      state.upgradeModalSource = null
    }),

    // Publish status actions (per-app)
    getPublishState: (appId: string) => {
      const state = get().publishStates[appId];
      return state || createDefaultPublishState(appId);
    },
    setIsPublishing: (appId: string, isPublishing: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].isPublishing = isPublishing;
    }),
    setPublishError: (appId: string, hasError: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].publishError = hasError;
    }),
    setBuildErrorDetails: (appId: string, errorDetails: { error: string; details: string; exitCode?: number } | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].buildErrorDetails = errorDetails;
    }),
    setLastPublishedCommitHash: (appId: string, commitHash: string | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].lastPublishedCommitHash = commitHash;

      // Persist to localStorage for recovery after page refresh
      if (typeof window !== 'undefined') {
        const storageKey = `airo-last-published-commit-${appId}`;
        if (commitHash) {
          localStorage.setItem(storageKey, commitHash);
        } else {
          localStorage.removeItem(storageKey);
        }
      }
    }),
    setDeploymentsRefetch: (appId: string, refetch: (() => Promise<any>) | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].deploymentsRefetch = refetch;
    }),
    setDeploymentInProgressId: (appId: string, deploymentId: string | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].deploymentInProgressId = deploymentId;
    }),
    setPublishSuccess: (appId: string, showSuccess: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
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
    setShowPaywallModal: (appId: string, show: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].showPaywallModal = show;
    }),

    // Page loading orchestration
    resetForNewApp: (appId: string) => {
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
        return
      }

      // Stop any ongoing site creation polling to prevent overlapping requests
      const { useSiteCreationStore } = await import('./useSiteCreationStore')
      const creationStore = useSiteCreationStore.getState()
      if (creationStore.siteId === appId || creationStore.realAppId === appId) {
        creationStore.cleanup()
      }

      // Reset streaming conversation store before mounting components
      const { useStreamingConversationStore } = await import('./useStreamingConversationStore')
      const streamingStore = useStreamingConversationStore.getState()
      streamingStore.setCurrentAppId(appId)

      get().resetForNewApp(appId)

      try {
        // Phase 1: Load app data
        set((state) => { state.loadingPhase = 'loading-app' })

        const [appData] = await Promise.all([
          appService.getApp(appId),
          appService.getConfig(appId)
        ])

        set((state) => {
          state.app = appData.app
        })

        // Phase 2: Load site data
        set((state) => { state.loadingPhase = 'loading-site' })

        const siteStore = useSitesStore.getState()
        const site = await siteStore.fetchSite(appId)

        set((state) => {
          state.site = site
        })

        // Load go-live status from .airo/live.json
        const goLiveStatus = await loadGoLiveStatusAsync(appId);
        set((state) => {
          if (!state.publishStates[appId]) {
            state.publishStates[appId] = createDefaultPublishState(appId);
          }
          state.publishStates[appId].hasGoneLive = goLiveStatus.hasGoneLive;
          state.publishStates[appId].wentLiveAt = goLiveStatus.wentLiveAt;
        });

        // Phase 3: Load conversations with proper context
        set((state) => { state.loadingPhase = 'loading-conversations' })

        // Legacy conversation initialization removed - streaming architecture handles this differently

        // Phase 4: Evaluate initial actions (auto-send, etc.)
        set((state) => { state.loadingPhase = 'ready' })
        await get().evaluateInitialActions()

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        logger.error('develop-store.init.failure', { error: errorMessage })

        set((state) => {
          state.loadingPhase = 'idle'
          state.loadingError = errorMessage
        })
        throw error
      }
    },

    evaluateInitialActions: async () => {
      // Auto-send is now handled directly in the develop page component
      // This method is kept for future initial actions that might be needed
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
        logger.error('develop-store.restart.failure', {
          error: error instanceof Error ? error.message : String(error)
        })
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

          // Wait for the action to complete
          await new Promise(resolve => setTimeout(resolve, 1000))

          set((state) => { state.isStartingApp = false })
        }
      } catch (error) {
        logger.error('develop-store.ensure-running.failure', {
          error: error instanceof Error ? error.message : String(error)
        })
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
    },

    // Go Live modal actions
    setShowGoLiveModal: (appId: string, show: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].showGoLiveModal = show;
      if (!show) {
        // Reset modal state when closing
        state.publishStates[appId].goLiveModalStep = null;
        state.publishStates[appId].securityScanResults = null;
        state.publishStates[appId].launchVideoUrl = null;
      }
    }),

    setGoLiveModalStep: (appId: string, step: 'confirm' | 'qa' | 'security-results' | 'republish' | 'video' | 'marketing' | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].goLiveModalStep = step;
    }),

    setSecurityScanResults: (appId: string, results: any | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].securityScanResults = results;
    }),

    setLaunchVideoUrl: (appId: string, url: string | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState(appId);
      }
      state.publishStates[appId].launchVideoUrl = url;
    }),

    markAsGoneLive: async (appId: string) => {
      const timestamp = new Date().toISOString();

      // Update state optimistically
      set((state) => {
        if (!state.publishStates[appId]) {
          state.publishStates[appId] = createDefaultPublishState(appId);
        }
        state.publishStates[appId].hasGoneLive = true;
        state.publishStates[appId].wentLiveAt = timestamp;
      });

      // Persist to .airo/live.json via API
      await saveGoLiveStatus(appId);

      logger.info('go-live.completed', {
        appId,
        wentLiveAt: timestamp
      });
    },

    hasGoneLive: (appId: string) => {
      const state = get().publishStates[appId];
      if (state) {
        return state.hasGoneLive;
      }
      // Check localStorage if not in state
      const goLiveStatus = loadGoLiveStatus(appId);
      return goLiveStatus.hasGoneLive;
    }
  })),
    { name: 'DevelopPageStore' }
  )
)

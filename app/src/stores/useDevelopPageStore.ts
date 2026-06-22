import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { isDesignKitWizardProfile } from '@/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile'
import { DEFAULT_DESKTOP_DEVICE, DEFAULT_MOBILE_DEVICE, DEFAULT_TABLET_DEVICE } from '@/app/[market]/develop/components/preview/devicePresets'
import { ChatTab, IframeMessageType, MobileMode, PreviewViewMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types'
import type { LogoSessionLogo } from '@/app/[market]/develop/components/widgets/logo-utils'
import type { FeedbackCategory } from '@/components/feedback/types'
import { getSwitchboardFlag, getSwitchboardValue } from '@/hooks/useSwitchboard'
import type { SiteInfo } from '@/lib/control-plane/types'
import { logger } from '@/lib/request-context'
import { type App, appService } from '@/services/AppService'
import { type Site, useSitesStore } from '@/stores/useSitesStore'
import { SubscriptionPlan } from '@/types/credits'
import type { BusMediaDeletePayload, BusUnsupportedFeature } from '@/utils/eventBus'
import { logImpressionEvent } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'

// Loading phases for proper sequencing
type LoadingPhase = 'idle' | 'loading-app' | 'loading-site' | 'loading-conversations' | 'ready'

/** OTel trace/span IDs captured from complete events, used to correlate
 * app-generation feedback submissions to Langfuse traces and observations.
 * `agentName` carries the raw agent that produced the turn (e.g. "InitialAgent");
 * consumers prefix with the repo's canonical `airo-app-builder-` scope when
 * they need the full agentId. Optional because historical turns may have
 * emitted complete events before this field was wired through. */
export interface TraceIds {
  traceId: string
  observationId: string
  agentName?: string
  requestId?: string
}

// Chat pane width constants
export const DEFAULT_CHAT_PANE_WIDTH = 415
const WIDE_CHAT_PANE_WIDTH = 640 - 24 // 640px - 24px (12px left + 12px right padding)

// Settings sections that require wider panel
const WIDE_SETTINGS_SECTIONS: SettingsSection[] = [
  SettingsSection.BACKUPS,
  SettingsSection.DATABASE,
  SettingsSection.DOMAIN,
  SettingsSection.MARKETING,
  SettingsSection.SECRETS,
]

// Chat tabs that require wider panel
const WIDE_CHAT_TABS: ChatTab[] = [
  ChatTab.ANALYTICS,
]

// Helper to load go-live status from .airo/live.json (defaults to false for sync init)
const loadGoLiveStatus = (): { hasGoneLive: boolean; wentLiveAt: string | null } => {
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

// Publish limit modal data type
interface PublishLimitData {
  plan: SubscriptionPlan | undefined;
  currentCount: number;
  limit: number | null;
  publishedApps: SiteInfo[];
}

export type LaunchVideoResult =
  | { type: 'success'; url: string }
  | { type: 'error'; message: string }

export interface LogoJobResult {
  jobId: string
  status: 'completed' | 'failed' | 'cancelled'
  slots: string[]
  error?: string
  logo?: LogoSessionLogo
  /** True when some logo layouts could not be saved to their slots even though
   *  generation succeeded (e.g. a user-modified slot was skipped). */
  slotSaveFailed?: boolean
  /** Layout names whose slots were not updated (carried from the backend event). */
  failedLayouts?: string[]
}

export interface DomainJobInProgress {
  fqdn: string
  startedAt: number
  /** Job status from modify-domains API (`status` field). */
  jobStatus?: string
}

// Helper to create default publish state
const createDefaultPublishState = () => {
  const goLiveStatus = loadGoLiveStatus();
  return {
    isPublishing: false,
    publishError: false,
    buildErrorDetails: null,
    lastPublishedCommitHash: null,
    deploymentsRefetch: null,
    deploymentInProgressId: null,
    showSuccessAlert: false,
    showPaywallModal: false,
    showPublishLimitModal: false,
    publishLimitData: null as PublishLimitData | null,
    showFirstPublishCongrats: false,
    firstPublishDeployPending: false,
    publishPopoverRequestNonce: 0,
    hasGoneLive: goLiveStatus.hasGoneLive,
    wentLiveAt: goLiveStatus.wentLiveAt,
    showGoLiveModal: false,
    goLiveModalDismissed: false,
    goLiveModalStep: null as 'confirm' | 'select-features' | 'qa' | 'security-results' | 'republish' | 'video' | 'select-marketing' | null,
    securityScanResults: null,
    launchVideoResult: null,
    // Feature selections
    featureSelections: null as { qa: boolean; security: boolean; video: boolean; marketing: boolean } | null,
    marketingSelections: null as { seo: boolean; socialPosts: boolean; blogPost: boolean } | null,
    showPostPublishFeatureSelection: false,
    postPublishFeatureSelectionNonce: 0,
    isSecurityAnalysisRunning: false,
    seoRegressionAlert: null,
    previewUnsupportedFeatureWarnings: {} as Partial<Record<BusUnsupportedFeature, true>>,
    securityAnalysisResult: null as 'safe' | 'issues' | null,
    // Agent-initiated publish confirmation (human-in-the-loop gate). Only the agent's
    // publish path consults this; the UI Publish button uses usePublishApp and bypasses it.
    agentPublishConfirmation: 'idle' as 'idle' | 'pending' | 'approved' | 'cancelled',
  };
}

interface DevelopPageStore {
  // UI states
  viewMode: ViewMode
  docsPath: string | null
  docsReloadToken: number
  previewReloadToken: number
  previewNavigatePath: string | null
  mobileMode: MobileMode
  previewViewMode: PreviewViewMode
  selectedDeviceId: string
  isEditModeEnabled: boolean
  isMultiSelectEnabled: boolean
  expandedPlan: boolean
  chatPaneWidth: number
  originalChatPaneWidth: number | null
  isChatPaneCollapsed: boolean
  isMobile: boolean
  isPreviewVisible: boolean
  isMobileInlineEditActive: boolean

  // Tab state (stored in memory, synced to URL)
  activeChatTab: ChatTab
  activeSettingsSection: SettingsSection
  chatTabsInitializedForPathname: string | null

  // View-mode URL sync guard (initialized from URL in useView)
  viewInitializedForPathname: string | null

  // UI loading indicators
  isRestarting: boolean
  hasUnsavedChanges: boolean

  // Model override (per-project). `selectedModel` is the live selection for the
  // current app; `modelByAppId` is the persisted per-app memory so the choice
  // survives a browser reload (the selector is internal/operator-gated).
  // Note: an entry is added per app a non-default model is chosen for and only
  // removed on clear-to-default (never on app deletion), so the map grows
  // unbounded in principle — negligible given the gating and tiny entries, but
  // revisit (prune on app deletion) if the selector ever ships broadly.
  selectedModel: string | null
  modelByAppId: Record<string, string>

  // Conversations brand ID
  conversationsBrandId: string | null

  // Inbox
  inboxBrandId: string | null
  inboxAccountId: string | null

  // Version history UI
  isVersionHistoryOpen: boolean

  // Feedback modal UI
  openFeedbackId: string | null
  feedbackOrigin: string | null
  feedbackInitialStep: FeedbackCategory | null

  // Feedback banner UI
  showFeedbackBanner: boolean
  showResponseFeedbackThanksBanner: boolean
  responseFeedbackThanksBannerTimeoutId: ReturnType<typeof setTimeout> | null

  // App-generation feedback (thumbs up/down on first app generation)
  /** Updated on every WS 'complete' event so the trigger can snapshot the latest IDs. */
  lastCompleteTraceIds: TraceIds | null
  /** Snapshot taken the moment the banner opens — pinned through submit. */
  appGenerationFeedbackTraceIds: TraceIds | null
  showAppGenerationFeedbackBanner: boolean
  appGenerationFeedbackSubmitted: boolean

  // Agent-work feedback (thumbs up/down on how the agent performed)
  agentWorkFeedbackAgentId: string | null
  agentWorkFeedbackTraceIds: TraceIds | null
  agentWorkFeedbackRevealMilestone: string | null
  showAgentWorkFeedbackBanner: boolean
  agentWorkFeedbackSubmitted: boolean

  // Tour UI
  showIntroTour: boolean

  // Asset Manager UI
  isAssetManagerOpen: boolean

  // Pending media-element delete (hover-bar delete → confirmation modal).
  // Set by the DELETE_MEDIA_ELEMENT bus handler; cleared on cancel/confirm.
  pendingMediaDelete: BusMediaDeletePayload | null


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
    // Publish limit modal state
    showPublishLimitModal: boolean
    publishLimitData: PublishLimitData | null
    showFirstPublishCongrats: boolean
    firstPublishDeployPending: boolean
    publishPopoverRequestNonce: number
    // Go Live modal state
    hasGoneLive: boolean
    wentLiveAt: string | null
    showGoLiveModal: boolean
    goLiveModalDismissed: boolean
    goLiveModalStep: 'confirm' | 'select-features' | 'qa' | 'security-results' | 'republish' | 'video' | 'select-marketing' | null
    securityScanResults: any | null
    launchVideoResult: LaunchVideoResult | null
    featureSelections: { qa: boolean; security: boolean; video: boolean; marketing: boolean } | null
    marketingSelections: { seo: boolean; socialPosts: boolean; blogPost: boolean } | null
    showPostPublishFeatureSelection: boolean
    postPublishFeatureSelectionNonce: number
    isSecurityAnalysisRunning: boolean
    seoRegressionAlert: {
      scoreDelta: number;
      currentScore: number;
      regressions: Array<{ path: string; newIssues: string[] }>;
    } | null
    previewUnsupportedFeatureWarnings: Partial<Record<BusUnsupportedFeature, true>>
    securityAnalysisResult: 'safe' | 'issues' | null
    // Agent-initiated publish confirmation: 'pending' shows the approval modal;
    // 'approved'/'cancelled' are read by the awaiting publishAction, then reset to 'idle'.
    agentPublishConfirmation: 'idle' | 'pending' | 'approved' | 'cancelled'
  }>

  domainJobsInProgress: Record<string, DomainJobInProgress>
  setDomainJobInProgress: (appId: string, job: DomainJobInProgress) => void
  clearDomainJobInProgress: (appId: string) => void

  /** Per-app, per-jobId logo results. Keyed by appId → jobId → result so that
   *  concurrent/sequential jobs each retain their own entry (a second job no longer
   *  overwrites the first card's result). */
  logoJobResults: Record<string, Record<string, LogoJobResult>>
  setLogoJobResult: (appId: string, result: LogoJobResult) => void

  // Page loading orchestration
  loadingPhase: LoadingPhase
  currentAppId: string | null
  app: App | null
  site: Site | null
  loadingError: string | null
  autoSendTriggered: boolean

  // UI setters
  setViewMode: (mode: ViewMode) => void
  setDocsPath: (path: string | null) => void
  openDoc: (path: string) => void
  openPreviewPage: (path: string) => void
  setMobileMode: (mode: MobileMode) => void
  setPreviewViewMode: (mode: PreviewViewMode) => void
  setSelectedDeviceId: (deviceId: string) => void
  setIsEditModeEnabled: (enabled: boolean) => void
  setIsMultiSelectEnabled: (enabled: boolean) => void
  setExpandedPlan: (expanded: boolean) => void
  setChatPaneWidth: (width: number) => void
  setIsChatPaneCollapsed: (collapsed: boolean) => void
  setHasUnsavedChanges: (hasChanges: boolean) => void
  setSelectedModel: (model: string | null) => void
  setConversationsBrandId: (brandId: string | null) => void
  setInboxBrandId: (brandId: string | null) => void
  setInboxAccountId: (accountId: string | null) => void
  setIsMobile: (isMobile: boolean) => void
  setIsVersionHistoryOpen: (open: boolean) => void
  setIsPreviewVisible: (visible: boolean) => void
  toggleMobileInlineEdit: () => void
  // Tab setters
  setActiveChatTab: (tab: ChatTab) => void
  setActiveSettingsSection: (section: SettingsSection) => void
  markChatTabsInitialized: (pathname: string) => void
  markViewInitialized: (pathname: string) => void

  // Feedback modal actions
  openFeedbackModal: (feedbackId: string, origin?: string, initialStep?: FeedbackCategory) => void
  closeFeedbackModal: () => void

  // Feedback banner actions
  setShowFeedbackBanner: (show: boolean) => void
  showResponseFeedbackThanksBannerTemporarily: () => void
  dismissResponseFeedbackThanksBanner: () => void

  // App-generation feedback actions
  setLastCompleteTraceIds: (ids: TraceIds | null) => void
  setShowAppGenerationFeedbackBanner: (show: boolean, ids: TraceIds | null) => void
  markAppGenerationFeedbackSubmitted: () => void

  // Agent-work feedback actions
  setShowAgentWorkFeedbackBanner: (
    show: boolean,
    agentId: string | null,
    traceIds?: TraceIds | null,
    revealMilestone?: string | null
  ) => void
  markAgentWorkFeedbackSubmitted: () => void

  // Tour actions
  setShowIntroTour: (show: boolean) => void
  checkAndTriggerIntroTour: () => void

  // Asset Manager actions
  setIsAssetManagerOpen: (open: boolean) => void

  // Pending media-element delete action
  setPendingMediaDelete: (payload: BusMediaDeletePayload | null) => void


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
  setSeoRegressionAlert: (appId: string, alert: { scoreDelta: number; currentScore: number; regressions: Array<{ path: string; newIssues: string[] }> } | null) => void
  dismissSeoRegressionAlert: (appId: string) => void
  addPreviewUnsupportedFeatureWarning: (appId: string, feature: BusUnsupportedFeature) => void
  clearPreviewUnsupportedFeatureWarnings: (appId: string) => void
  setShowPaywallModal: (appId: string, show: boolean) => void
  setShowPublishLimitModal: (appId: string, show: boolean, data?: PublishLimitData) => void
  setShowFirstPublishCongrats: (appId: string, show: boolean) => void
  setFirstPublishDeployPending: (appId: string, pending: boolean) => void
  requestPublishPopoverOpen: (appId: string) => void
  // Agent-initiated publish confirmation (human-in-the-loop gate)
  requestAgentPublishConfirmation: (appId: string) => void
  resolveAgentPublishConfirmation: (appId: string, approved: boolean) => void
  resetAgentPublishConfirmation: (appId: string) => void
  getPublishState: (appId: string) => {
    isPublishing: boolean
    publishError: boolean
    buildErrorDetails: { error: string; details: string; exitCode?: number } | null
    lastPublishedCommitHash: string | null
    deploymentsRefetch: (() => Promise<any>) | null
    deploymentInProgressId: string | null
    showSuccessAlert: boolean
    showPublishLimitModal: boolean
    publishLimitData: PublishLimitData | null
    showFirstPublishCongrats: boolean
    firstPublishDeployPending: boolean
    publishPopoverRequestNonce: number
    hasGoneLive: boolean
    wentLiveAt: string | null
    showGoLiveModal: boolean
    goLiveModalDismissed: boolean
    goLiveModalStep: 'confirm' | 'select-features' | 'qa' | 'security-results' | 'republish' | 'video' | 'select-marketing' | null
    securityScanResults: any | null
    launchVideoResult: LaunchVideoResult | null
    featureSelections: { qa: boolean; security: boolean; video: boolean; marketing: boolean } | null
    marketingSelections: { seo: boolean; socialPosts: boolean; blogPost: boolean } | null
    showPostPublishFeatureSelection: boolean
    postPublishFeatureSelectionNonce: number
    isSecurityAnalysisRunning: boolean
    seoRegressionAlert: {
      scoreDelta: number;
      currentScore: number;
      regressions: Array<{ path: string; newIssues: string[] }>;
    } | null
    previewUnsupportedFeatureWarnings: Partial<Record<BusUnsupportedFeature, true>>
    securityAnalysisResult: 'safe' | 'issues' | null
    agentPublishConfirmation: 'idle' | 'pending' | 'approved' | 'cancelled'
  }

  // Go Live modal actions
  setShowGoLiveModal: (appId: string, show: boolean) => void
  setGoLiveModalStep: (appId: string, step: 'confirm' | 'select-features' | 'qa' | 'security-results' | 'republish' | 'video' | 'select-marketing' | null) => void
  setSecurityScanResults: (appId: string, results: any | null) => void
  setLaunchVideoResult: (appId: string, result: LaunchVideoResult | null) => void
  setFeatureSelections: (appId: string, selections: { qa: boolean; security: boolean; video: boolean; marketing: boolean }) => void
  setMarketingSelections: (appId: string, selections: { seo: boolean; socialPosts: boolean; blogPost: boolean }) => void
  markAsGoneLive: (appId: string) => Promise<void>
  hasGoneLive: (appId: string) => boolean
  setPostPublishFeatureSelection: (appId: string, show: boolean) => void
  setSecurityAnalysisRunning: (appId: string, isRunning: boolean) => void
  setSecurityAnalysisResult: (appId: string, result: 'safe' | 'issues' | null) => void
  acquireSecurityAnalysisLock: (appId: string) => boolean

  // Page loading orchestration
  initializePage: (appId: string) => Promise<void>
  evaluateInitialActions: () => Promise<void>
  resetForNewApp: (appId: string) => void

  // Coordinated actions (call domain stores + manage UI state)
  restartApp: (appId: string, appStoreRestartApp: (appId: string) => Promise<void>) => Promise<void>

  // UI helpers
  toggleEditMode: () => void
  toggleExpandedPlan: () => void
  toggleChatPaneCollapse: () => void
  toggleVersionHistory: () => void
  handleViewModeChange: (newMode: ViewMode, hasUnsavedChanges: boolean) => void
  handleMobileModeChange: (newMode: MobileMode) => void
  initializeMobileDetection: () => () => void
}

export const useDevelopPageStore = create<DevelopPageStore>()(
  devtools(
    persist(immer((set, get) => ({
    // Initial UI state
    viewMode: ViewMode.EDIT,
    docsPath: null,
    docsReloadToken: 0,
    previewReloadToken: 0,
    previewNavigatePath: null,
    mobileMode: MobileMode.TOOLS,
    previewViewMode: PreviewViewMode.DESKTOP,
    selectedDeviceId: DEFAULT_DESKTOP_DEVICE,
    isEditModeEnabled: true,
    isMultiSelectEnabled: false,
    expandedPlan: false,
    chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
    originalChatPaneWidth: null,
    isChatPaneCollapsed: false,
    isMobile: false,
    isPreviewVisible: false,
    isMobileInlineEditActive: false,
    isRestarting: false,
    hasUnsavedChanges: false,
    selectedModel: null,
    modelByAppId: {},
    conversationsBrandId: null,
    inboxBrandId: null,
    inboxAccountId: null,
    isVersionHistoryOpen: false,

    // Tab state (initialized from URL in useChatTabs)
    activeChatTab: ChatTab.CHAT,
    activeSettingsSection: SettingsSection.PROJECT,
    chatTabsInitializedForPathname: null,
    viewInitializedForPathname: null,

    // Feedback modal state
    openFeedbackId: null,
    feedbackOrigin: null,
    feedbackInitialStep: null,

    // Feedback banner state
    showFeedbackBanner: false,
    showResponseFeedbackThanksBanner: false,
    responseFeedbackThanksBannerTimeoutId: null,

    // App-generation feedback state
    lastCompleteTraceIds: null,
    appGenerationFeedbackTraceIds: null,
    showAppGenerationFeedbackBanner: false,
    appGenerationFeedbackSubmitted: false,

    // Agent-work feedback state
    agentWorkFeedbackAgentId: null,
    agentWorkFeedbackTraceIds: null,
    agentWorkFeedbackRevealMilestone: null,
    showAgentWorkFeedbackBanner: false,
    agentWorkFeedbackSubmitted: false,

    // Tour state
    showIntroTour: false,

    // Asset Manager state
    isAssetManagerOpen: false,

    // Pending media-element delete state
    pendingMediaDelete: null,


    // Publish status state (per-app, keyed by appId)
    publishStates: {},

    domainJobsInProgress: {},
    logoJobResults: {},

    // Page loading orchestration state
    loadingPhase: 'idle',
    currentAppId: null,
    app: null,
    site: null,
    loadingError: null,
    autoSendTriggered: false,

    // UI setters
    setViewMode: (mode) => set((state) => { state.viewMode = mode }),
    setDocsPath: (path) => set((state) => { state.docsPath = path }),
    openDoc: (path) => set((state) => {
      state.docsPath = path
      state.viewMode = ViewMode.DOCS
      state.docsReloadToken += 1
    }),
    openPreviewPage: (path) => set((state) => {
      state.previewNavigatePath = path
      state.viewMode = ViewMode.PREVIEW
      state.previewReloadToken += 1
    }),
    setMobileMode: (mode) => set((state) => { state.mobileMode = mode }),
    setPreviewViewMode: (mode) => set((state) => {
      state.previewViewMode = mode
      // Set default device when switching modes
      if (mode === PreviewViewMode.DESKTOP) {
        state.selectedDeviceId = DEFAULT_DESKTOP_DEVICE
      } else if (mode === PreviewViewMode.TABLET) {
        state.selectedDeviceId = DEFAULT_TABLET_DEVICE
      } else if (mode === PreviewViewMode.MOBILE) {
        state.selectedDeviceId = DEFAULT_MOBILE_DEVICE
      }
    }),
    setSelectedDeviceId: (deviceId) => set((state) => { state.selectedDeviceId = deviceId }),
    setIsEditModeEnabled: (enabled) => set((state) => { state.isEditModeEnabled = enabled }),
    setIsMultiSelectEnabled: (enabled) => set((state) => { state.isMultiSelectEnabled = enabled }),
    setExpandedPlan: (expanded) => set((state) => { state.expandedPlan = expanded }),
    setChatPaneWidth: (width) => set((state) => { state.chatPaneWidth = width }),
    setIsChatPaneCollapsed: (collapsed) => set((state) => { state.isChatPaneCollapsed = collapsed }),
    setHasUnsavedChanges: (hasChanges) => set((state) => { state.hasUnsavedChanges = hasChanges }),
    setSelectedModel: (model) => set((state) => {
      state.selectedModel = model
      // Remember the choice per app so it survives a reload. No-op until an
      // app is loaded (currentAppId is set by resetForNewApp).
      if (state.currentAppId) {
        if (model) {
          state.modelByAppId[state.currentAppId] = model
        } else {
          delete state.modelByAppId[state.currentAppId]
        }
      }
    }),
    setConversationsBrandId: (brandId) => set((state) => { state.conversationsBrandId = brandId }),
    setInboxBrandId: (brandId) => set((state) => { state.inboxBrandId = brandId }),
    setInboxAccountId: (accountId) => set((state) => { state.inboxAccountId = accountId }),
    setIsMobile: (isMobile) => {
      const { isMobile: wasMobile, viewMode } = get()

      set((state) => {
        const wasMobileGoingToDesktop = state.isMobile === true && isMobile === false
        state.isMobile = isMobile
        if (wasMobileGoingToDesktop) {
          state.chatPaneWidth = 400
        }
      })

      // Mobile UI doesn't support ViewMode.EDIT, so coerce to PREVIEW first,
      // then switch the mobile UI to TOOLS.
      const enteringMobile = !wasMobile && isMobile
      if (enteringMobile && viewMode === ViewMode.EDIT) {
        set((state) => {
          state.viewMode = ViewMode.PREVIEW
          state.isEditModeEnabled = false
        })
        get().handleMobileModeChange(MobileMode.TOOLS)
      }
    },
    setIsVersionHistoryOpen: (open) => {
      set((state) => { state.isVersionHistoryOpen = open })
      // Lock viewMode to PREVIEW while history is open so users can't edit
      // a historical snapshot. false: skip unsaved-changes confirm — same
      // pattern as handleMobileModeChange.
      if (open && get().viewMode !== ViewMode.PREVIEW) {
        get().handleViewModeChange(ViewMode.PREVIEW, false)
      }
    },
    setIsPreviewVisible: (visible) => set((state) => { state.isPreviewVisible = visible }),

    toggleMobileInlineEdit: () => {
      const newState = !get().isMobileInlineEditActive
      set((state) => {
        state.isMobileInlineEditActive = newState
        // Keep isEditModeEnabled in sync so other code checking edit-mode state
        // (e.g., sendEditMessage, multiSelectMode syncing) sees the correct value
        state.isEditModeEnabled = newState
      })

      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        if (newState) {
          // Turning ON: enable edit mode
          postMessageToIframe(iframe, { type: IframeMessageType.EDIT_MODE_ENABLED })
        } else {
          // Turning OFF: clear selection and disable edit mode
          postMessageToIframe(iframe, { type: 'CLEAR_SELECTION' })
          postMessageToIframe(iframe, { type: IframeMessageType.EDIT_MODE_DISABLED })
        }
      }
    },

    // Tab setters
    setActiveChatTab: (tab) => set((state) => {
      const wasInSettings = state.activeChatTab === ChatTab.SETTINGS
      const wasInWideTab = WIDE_CHAT_TABS.includes(state.activeChatTab)
      const enteringSettings = !wasInSettings && tab === ChatTab.SETTINGS
      const leavingSettings = wasInSettings && tab !== ChatTab.SETTINGS
      const enteringWideTab = !wasInWideTab && WIDE_CHAT_TABS.includes(tab)
      const leavingWideTab = wasInWideTab && !WIDE_CHAT_TABS.includes(tab)

      state.activeChatTab = tab

      // Handle entering Settings tab
      if (enteringSettings) {
        const isWideSection = WIDE_SETTINGS_SECTIONS.includes(state.activeSettingsSection)
        if (isWideSection) {
          // Entering wide settings section
          if (state.originalChatPaneWidth === null) {
            state.originalChatPaneWidth = state.chatPaneWidth
          }
          state.chatPaneWidth = WIDE_CHAT_PANE_WIDTH
        } else if (wasInWideTab && state.originalChatPaneWidth !== null) {
          // Entering non-wide settings section from a wide tab - restore
          state.chatPaneWidth = state.originalChatPaneWidth
          state.originalChatPaneWidth = null
        }
      }
      // Handle leaving Settings tab
      else if (leavingSettings && state.originalChatPaneWidth !== null && !enteringWideTab) {
        state.chatPaneWidth = state.originalChatPaneWidth
        state.originalChatPaneWidth = null
      }
      // Handle entering wide chat tab (e.g., Analytics)
      else if (enteringWideTab && !enteringSettings) {
        if (state.originalChatPaneWidth === null) {
          state.originalChatPaneWidth = state.chatPaneWidth
        }
        state.chatPaneWidth = WIDE_CHAT_PANE_WIDTH
      }
      // Handle leaving wide chat tab
      else if (leavingWideTab && !enteringSettings && state.originalChatPaneWidth !== null) {
        state.chatPaneWidth = state.originalChatPaneWidth
        state.originalChatPaneWidth = null
      }
    }),
    setActiveSettingsSection: (section) => set((state) => {
      const isWideSection = WIDE_SETTINGS_SECTIONS.includes(section)
      const wasWideSection = WIDE_SETTINGS_SECTIONS.includes(state.activeSettingsSection)
      const inSettingsTab = state.activeChatTab === ChatTab.SETTINGS

      state.activeSettingsSection = section

      if (inSettingsTab) {
        if (isWideSection && !wasWideSection) {
          if (state.originalChatPaneWidth === null) {
            state.originalChatPaneWidth = state.chatPaneWidth
          }
          state.chatPaneWidth = WIDE_CHAT_PANE_WIDTH
        } else if (!isWideSection && wasWideSection && state.originalChatPaneWidth !== null) {
          state.chatPaneWidth = state.originalChatPaneWidth
          state.originalChatPaneWidth = null
        }
      }
    }),
    markChatTabsInitialized: (pathname) => set((state) => { state.chatTabsInitializedForPathname = pathname }),
    markViewInitialized: (pathname) => set((state) => { state.viewInitializedForPathname = pathname }),

    // Feedback modal actions
    openFeedbackModal: (feedbackId: string, origin?: string, initialStep?: FeedbackCategory) => {
      // Check if feedback modal has been shown before using feedback ID
      const localStorageKey = `airo-feedback-shown:${feedbackId}`
      let hasShownFeedback = false
      if (typeof window !== 'undefined') {
        try {
          hasShownFeedback = localStorage.getItem(localStorageKey) === 'true'
        } catch (err) {
          // Storage unavailable (private browsing, sandboxed iframe, corrupted storage).
          // Treat as "not shown" so the modal still appears.
          logger.warn('feedback.modal.storage.read_failed', {
            feedbackId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      if (hasShownFeedback) {
        return
      }

      logImpressionEvent('feedback.modal.opened')();

      // Mark as shown — non-fatal if storage is unavailable
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(localStorageKey, 'true')
        } catch (err) {
          logger.warn('feedback.modal.storage.write_failed', {
            feedbackId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      set((state) => {
        state.openFeedbackId = feedbackId
        state.feedbackOrigin = origin ?? null
        state.feedbackInitialStep = initialStep ?? null
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
        state.feedbackOrigin = null
        state.feedbackInitialStep = null
      })
    },

    // Feedback banner actions
    setShowFeedbackBanner: (show: boolean) => set((state) => {
      state.showFeedbackBanner = show
    }),
    showResponseFeedbackThanksBannerTemporarily: () => {
      set((state) => {
        if (state.responseFeedbackThanksBannerTimeoutId !== null) {
          clearTimeout(state.responseFeedbackThanksBannerTimeoutId)
          state.responseFeedbackThanksBannerTimeoutId = null
        }
        state.showResponseFeedbackThanksBanner = true
      })

      const timeoutId = setTimeout(() => {
        set((state) => {
          state.showResponseFeedbackThanksBanner = false
          state.responseFeedbackThanksBannerTimeoutId = null
        })
      }, 3000)

      set((state) => {
        state.responseFeedbackThanksBannerTimeoutId = timeoutId
      })
    },
    dismissResponseFeedbackThanksBanner: () => {
      set((state) => {
        if (state.responseFeedbackThanksBannerTimeoutId !== null) {
          clearTimeout(state.responseFeedbackThanksBannerTimeoutId)
          state.responseFeedbackThanksBannerTimeoutId = null
        }
        state.showResponseFeedbackThanksBanner = false
      })
    },

    // App-generation feedback actions
    setLastCompleteTraceIds: (ids: TraceIds | null) => set((state) => {
      state.lastCompleteTraceIds = ids
    }),
    setShowAppGenerationFeedbackBanner: (show: boolean, ids: TraceIds | null) => set((state) => {
      state.showAppGenerationFeedbackBanner = show
      state.appGenerationFeedbackTraceIds = show ? ids : null
    }),
    markAppGenerationFeedbackSubmitted: () => set((state) => {
      state.appGenerationFeedbackSubmitted = true
      state.showAppGenerationFeedbackBanner = false
    }),

    // Agent-work feedback actions
    setShowAgentWorkFeedbackBanner: (show, agentId, traceIds = null, revealMilestone = null) => set((state) => {
      state.showAgentWorkFeedbackBanner = show
      state.agentWorkFeedbackAgentId = show ? agentId : null
      state.agentWorkFeedbackTraceIds = show ? traceIds : null
      state.agentWorkFeedbackRevealMilestone = show ? revealMilestone : null
    }),
    markAgentWorkFeedbackSubmitted: () => set((state) => {
      state.agentWorkFeedbackSubmitted = true
      state.showAgentWorkFeedbackBanner = false
      state.agentWorkFeedbackAgentId = null
      state.agentWorkFeedbackTraceIds = null
      state.agentWorkFeedbackRevealMilestone = null
    }),

    // Tour actions
    setShowIntroTour: (show: boolean) => set((state) => {
      state.showIntroTour = show
    }),

    /**
     * Check if intro tour should be shown for this app and trigger it if appropriate
     * Tour is shown only once for the first site creation
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

    setPendingMediaDelete: (payload: BusMediaDeletePayload | null) => set((state) => {
      state.pendingMediaDelete = payload
    }),


    // Publish status actions (per-app)
    getPublishState: (appId: string) => {
      const state = get().publishStates[appId];
      return state || createDefaultPublishState();
    },
    setIsPublishing: (appId: string, isPublishing: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].isPublishing = isPublishing;
      if (isPublishing) {
        state.publishStates[appId].showPostPublishFeatureSelection = false;
      }
    }),
    setPublishError: (appId: string, hasError: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].publishError = hasError;
    }),
    setBuildErrorDetails: (appId: string, errorDetails: { error: string; details: string; exitCode?: number } | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].buildErrorDetails = errorDetails;
    }),
    setLastPublishedCommitHash: (appId: string, commitHash: string | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
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
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].deploymentsRefetch = refetch;
    }),
    setDeploymentInProgressId: (appId: string, deploymentId: string | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].deploymentInProgressId = deploymentId;
    }),

    setDomainJobInProgress: (appId: string, job: DomainJobInProgress) => set((state) => {
      state.domainJobsInProgress[appId] = job;
    }),

    clearDomainJobInProgress: (appId: string) => set((state) => {
      delete state.domainJobsInProgress[appId];
    }),
    setPublishSuccess: (appId: string, showSuccess: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
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
    setSeoRegressionAlert: (appId: string, alert) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].seoRegressionAlert = alert;
    }),
    dismissSeoRegressionAlert: (appId: string) => set((state) => {
      if (state.publishStates[appId]) {
        state.publishStates[appId].seoRegressionAlert = null;
      }
    }),
    addPreviewUnsupportedFeatureWarning: (appId: string, feature: BusUnsupportedFeature) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].previewUnsupportedFeatureWarnings[feature] = true;
    }),
    clearPreviewUnsupportedFeatureWarnings: (appId: string) => set((state) => {
      if (state.publishStates[appId]) {
        state.publishStates[appId].previewUnsupportedFeatureWarnings = {};
      }
    }),
    setShowPaywallModal: (appId: string, show: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].showPaywallModal = show;
    }),
    setShowPublishLimitModal: (appId: string, show: boolean, data?: PublishLimitData) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].showPublishLimitModal = show;
      state.publishStates[appId].publishLimitData = show && data ? data : null;
    }),
    setShowFirstPublishCongrats: (appId: string, show: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].showFirstPublishCongrats = show;
    }),
    setFirstPublishDeployPending: (appId: string, pending: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].firstPublishDeployPending = pending;
    }),
    requestPublishPopoverOpen: (appId: string) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].publishPopoverRequestNonce += 1;
    }),
    requestAgentPublishConfirmation: (appId: string) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].agentPublishConfirmation = 'pending';
    }),
    resolveAgentPublishConfirmation: (appId: string, approved: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].agentPublishConfirmation = approved ? 'approved' : 'cancelled';
    }),
    resetAgentPublishConfirmation: (appId: string) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].agentPublishConfirmation = 'idle';
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
        // Restore the per-app model override (persisted) rather than clearing it,
        // so a reload or app-switch keeps the user's selection. Falls back to
        // null (system default) for apps with no saved choice.
        state.selectedModel = state.modelByAppId[appId] ?? null
        state.feedbackInitialStep = null
        state.docsPath = null

        // Reset viewMode to PREVIEW unless a brand-first flow already governs the
        // tab. Two flows land on (and must stay on) the "Logo & Brand" (BRAND) tab:
        //   - the logo-designer template — its effect sets ViewMode.BRAND before
        //     this runs, and
        //   - the design-kit wizard profile — useView.resolveInitialViewMode lands
        //     it on BRAND (gated on the appbuilder-agent-profile Switchboard value).
        // Blindly overriding either causes the "Logo & Brand" tab to flash then
        // switch to Preview during the create flow's jobId→realAppId re-init.
        const jobId = typeof window !== 'undefined'
          ? sessionStorage.getItem(`initial-job-id-${appId}`)
          : null
        const template = jobId
          ? sessionStorage.getItem(`initial-template-${jobId}`)
          : null
        const isDesignKitWizard = isDesignKitWizardProfile(
          getSwitchboardValue('appbuilder-agent-profile')
        )
        if (template !== 'logo-designer' && !isDesignKitWizard) {
          state.viewMode = ViewMode.PREVIEW
          // Keep isEditModeEnabled in sync with the PREVIEW viewMode. Otherwise a
          // freshly-built app lands on the Preview toggle while the iframe still
          // receives EDIT_MODE_ENABLED on IFRAME_READY and shows the hover bar.
          state.isEditModeEnabled = false
        }
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

        // Load go-live status from .airo/live.json only if feature is enabled
        const isGoLiveEnabled = getSwitchboardFlag('appbuilder-go-live') === true;

        if (isGoLiveEnabled) {
          const goLiveStatus = await loadGoLiveStatusAsync(appId);
          set((state) => {
            if (!state.publishStates[appId]) {
              state.publishStates[appId] = createDefaultPublishState();
            }
            state.publishStates[appId].hasGoneLive = goLiveStatus.hasGoneLive;
            state.publishStates[appId].wentLiveAt = goLiveStatus.wentLiveAt;
          });
        }

        // Phase 3: Load conversations with proper context
        set((state) => { state.loadingPhase = 'loading-conversations' })

        // Legacy conversation initialization removed - streaming architecture handles this differently

        // Phase 4: Evaluate initial actions (auto-send, etc.)
        set((state) => { state.loadingPhase = 'ready' })
        await get().evaluateInitialActions()

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        logger.error('develop-store.init.failure', { appId, error: errorMessage })

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
          appId,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      } finally {
        set((state) => { state.isRestarting = false })
      }
    },

    // UI helpers
    toggleEditMode: () => {
      const newEditMode = !get().isEditModeEnabled
      set((state) => { state.isEditModeEnabled = newEditMode })

      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        postMessageToIframe(iframe, { type: newEditMode ? IframeMessageType.EDIT_MODE_ENABLED : IframeMessageType.EDIT_MODE_DISABLED })
        if (get().isMultiSelectEnabled) {
          postMessageToIframe(iframe, { type: newEditMode ? 'MULTI_SELECT_ENABLED' : 'MULTI_SELECT_DISABLED' })
        }
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
      get().setIsVersionHistoryOpen(newIsVersionHistoryOpen)
    },

    handleViewModeChange: (newMode: ViewMode, hasUnsavedChanges: boolean) => {
      const { viewMode } = get()

      if (hasUnsavedChanges && viewMode === ViewMode.CODE && newMode !== ViewMode.CODE) {
        const confirmed = window.confirm(
          'You have unsaved changes in the code editor. Switching to preview will keep your changes, but they won\'t be reflected in the preview until saved. Continue?'
        )
        if (!confirmed) return
      }

      // Sync edit mode with view mode: EDIT enables it, anything else disables it
      const editModeEnabled = newMode === ViewMode.EDIT
      if (get().isEditModeEnabled !== editModeEnabled) {
        set((state) => { state.isEditModeEnabled = editModeEnabled })
        const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
        if (iframe) {
          postMessageToIframe(iframe, { type: editModeEnabled ? IframeMessageType.EDIT_MODE_ENABLED : IframeMessageType.EDIT_MODE_DISABLED })
          if (get().isMultiSelectEnabled) {
            postMessageToIframe(iframe, { type: editModeEnabled ? 'MULTI_SELECT_ENABLED' : 'MULTI_SELECT_DISABLED' })
          }
        }
      }

      set((state) => { state.viewMode = newMode })
    },

    handleMobileModeChange: (newMode: MobileMode) => {
      const { viewMode } = get()
      set((state) => { state.mobileMode = newMode })
      // Mobile UI doesn't support ViewMode.EDIT (ChatToolbar only shows PREVIEW/CODE)
      if (newMode === MobileMode.PREVIEW && viewMode === ViewMode.EDIT) {
        // false: unsaved-changes confirm in handleViewModeChange only runs when leaving ViewMode.CODE
        get().handleViewModeChange(ViewMode.PREVIEW, false)
      }
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
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].showGoLiveModal = show;
      if (!show) {
        state.publishStates[appId].goLiveModalDismissed = true;
        state.publishStates[appId].goLiveModalStep = null;
        state.publishStates[appId].securityScanResults = null;
        state.publishStates[appId].launchVideoResult = null;
        state.publishStates[appId].featureSelections = null;
        state.publishStates[appId].marketingSelections = null;
      }
    }),

    setGoLiveModalStep: (appId: string, step: 'confirm' | 'select-features' | 'qa' | 'security-results' | 'republish' | 'video' | 'select-marketing' | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].goLiveModalStep = step;
    }),

    setSecurityScanResults: (appId: string, results: any | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].securityScanResults = results;
    }),

    setLaunchVideoResult: (appId: string, result: LaunchVideoResult | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].launchVideoResult = result;
    }),

    setLogoJobResult: (appId: string, result: LogoJobResult) => set((state) => {
      state.logoJobResults[appId] ??= {};
      state.logoJobResults[appId][result.jobId] = result;
    }),

    setFeatureSelections: (appId: string, selections: { qa: boolean; security: boolean; video: boolean; marketing: boolean }) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].featureSelections = selections;
    }),

    setMarketingSelections: (appId: string, selections: { seo: boolean; socialPosts: boolean; blogPost: boolean }) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].marketingSelections = selections;
    }),

    markAsGoneLive: async (appId: string) => {
      const timestamp = new Date().toISOString();

      // Update state optimistically
      set((state) => {
        if (!state.publishStates[appId]) {
          state.publishStates[appId] = createDefaultPublishState();
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
      const goLiveStatus = loadGoLiveStatus();
      return goLiveStatus.hasGoneLive;
    },

    setPostPublishFeatureSelection: (appId: string, show: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].showPostPublishFeatureSelection = show;
      if (show) {
        state.publishStates[appId].postPublishFeatureSelectionNonce += 1;
      }
    }),

    setSecurityAnalysisRunning: (appId: string, isRunning: boolean) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].isSecurityAnalysisRunning = isRunning;
    }),

    setSecurityAnalysisResult: (appId: string, result: 'safe' | 'issues' | null) => set((state) => {
      if (!state.publishStates[appId]) {
        state.publishStates[appId] = createDefaultPublishState();
      }
      state.publishStates[appId].securityAnalysisResult = result;
    }),

    acquireSecurityAnalysisLock: (appId: string): boolean => {
      let acquired = false;
      set((state) => {
        if (!state.publishStates[appId]) {
          state.publishStates[appId] = createDefaultPublishState();
        }
        if (!state.publishStates[appId].isSecurityAnalysisRunning) {
          state.publishStates[appId].isSecurityAnalysisRunning = true;
          acquired = true;
        }
      });
      return acquired;
    },
  })), {
    name: 'airo-builder.develop-page-store.v1',
    // Persist only the per-app model memory; all other UI/session state stays
    // transient and out of localStorage.
    partialize: (state) => ({ modelByAppId: state.modelByAppId }),
  }),
    { name: 'DevelopPageStore' }
  )
)


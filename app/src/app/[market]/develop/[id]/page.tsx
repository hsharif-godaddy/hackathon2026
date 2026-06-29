'use client'

import { AnimatePresence, motion } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Growl from '@ux/growl'

import { CommanderShell } from '@/app/[market]/commander/components/CommanderShell'
import { BuilderLayout } from '@/app/[market]/commander/types'
import ChatPane from '@/app/[market]/develop/components/chat/ChatPane'
import ChatPaneLoader, { ImageReloadLoaderPhase, ResumeLoaderPhase } from '@/app/[market]/develop/components/chat/ChatPaneLoader'
import ChatToolbar from '@/app/[market]/develop/components/chat/ChatToolbar'
import DevelopSkeleton from '@/app/[market]/develop/components/DevelopSkeleton'
import DevelopHeader from '@/app/[market]/develop/components/layout/Header'
import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { DevelopCreditsModal, PaywallErrorFallback, RenewalPollingModal, UpgradePollingModal } from '@/app/[market]/develop/components/paywall'
import { CdsEsmPreload } from '@/app/[market]/develop/components/paywall/CdsEsmPreload'
import BrandBookView from '@/app/[market]/develop/components/preview/brand-book'
import { DesignKitChatHeader } from '@/app/[market]/develop/components/preview/design-kit-wizard/DesignKitChatHeader'
import { DesignKitWizard } from '@/app/[market]/develop/components/preview/design-kit-wizard/DesignKitWizard'
import { useIsDesignKitWizardProfile } from '@/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile'
import { isDesignKitInitialViewResolving, resolveDesignKitInitialView } from '@/app/[market]/develop/components/preview/design-kit-wizard/landing'
import PreviewPane, { type PublishSnapshotRequestDetail } from '@/app/[market]/develop/components/preview/PreviewPane'
import ResizableDivider from '@/app/[market]/develop/components/ResizableDivider'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { buildEditModeEnabledMessage, ChatTab, IframeMessageType, MobileMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types'
import { handlePreviewRefresh, useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { clearExpiredWidgetStates } from '@/app/[market]/develop/components/widgets'
import { sendPendingAutoSendMessage } from '@/app/[market]/develop/hooks/sendPendingAutoSendMessage'
import { useAgentWorkFeedbackTrigger } from '@/app/[market]/develop/hooks/useAgentWorkFeedbackTrigger'
import { useAppGenerationFeedbackTrigger } from '@/app/[market]/develop/hooks/useAppGenerationFeedbackTrigger'
import { useChatPaneLoadingState } from '@/app/[market]/develop/hooks/useChatPaneLoadingState'
import { useDevToolsBusBindings } from '@/app/[market]/develop/hooks/useDevToolsBusBindings'
import { useDevToolsSpeechBridge } from '@/app/[market]/develop/hooks/useDevToolsSpeechBridge'
import { useEvalSnapshotCapture } from '@/app/[market]/develop/hooks/useEvalSnapshotCapture'
import { useInboxRealtime } from '@/app/[market]/develop/hooks/useInboxRealtime'
import { useInitialBuildRevealSignals } from '@/app/[market]/develop/hooks/useInitialBuildRevealSignals'
import { deriveIsAwaitingStream, useInitialization } from '@/app/[market]/develop/hooks/useInitialization'
import { usePublishSnapshotCapture } from '@/app/[market]/develop/hooks/usePublishSnapshotCapture'
import { broadcast as broadcastProcessingState } from '@/app/[market]/develop/utils/iframeProcessingState'
import { mutatesFiles } from '@/app/[market]/develop/utils/mutatesFiles'
import { showEditApplyFailureGrowl } from '@/app/[market]/develop/utils/showEditApplyFailureGrowl'
import { ProtectedRoute } from '@/components/auth'
import ErrorBoundary from '@/components/ErrorBoundary'
import { FEEDBACK_ID } from '@/components/feedback/utils'
import { UpgradeModal } from '@/components/upgrade/UpgradeModal'
import { buildDynamicApiUrl, dynamicApiConfigService } from '@/config/dynamic-api'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { SWITCHBOARD_APPBUILDER_CMS_INLINE_EDIT, SWITCHBOARD_APPBUILDER_COMMANDER } from '@/config/switchboard-flags'
import { ChatProvider } from '@/contexts/ChatContext'
import { prefetchGitRemoteConfig } from '@/hooks/github/useGitRemoteConfig'
import { activateInitialBuildFunnel, trackFirstView } from '@/hooks/shared/initialBuildFunnel'
import { useAotPreload } from '@/hooks/useAotPreload'
import { useAppArchiveRestore } from '@/hooks/useAppArchiveRestore'
import { useAppDetails } from '@/hooks/useAppDetails'
import { useAppHibernation } from '@/hooks/useAppHibernation'
import { useBrandData } from '@/hooks/useBrandData'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useChatTransport } from '@/hooks/useChatTransport'
import { useCombinePublishTrigger } from '@/hooks/useCombinePublishTrigger'
import { useCreditsDeeplinkWithStore } from '@/hooks/useCreditsDeeplinkWithStore'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useHivemind } from '@/hooks/useHivemind'
import { useImageReadiness } from '@/hooks/useImageReadiness'
import { useInboxAccount } from '@/hooks/useInboxAccount'
import { usePaywallDeeplinkWithStore } from '@/hooks/usePaywallDeeplinkWithStore'
import { useSettingsNotifications } from '@/hooks/useSettingsNotifications'
import { prefetchSubscription, useSubscription } from '@/hooks/useSubscription'
import { useIsRenewalPolling } from '@/hooks/useSubscriptionRenewal'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useSyncResponsiveState } from '@/hooks/useSyncResponsiveState'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsUpgradePolling } from '@/hooks/useUpgradePurchase'
import { useView, type ViewAvailability } from '@/hooks/useView'
import { useVisitedTabs } from '@/hooks/useVisitedTabs'
import { agentFetch } from '@/lib/agent-fetch'
import { JourneyTracker } from '@/lib/journeyTracker'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import {
  hasAutoSwitchedLogoDesignerPreview,
  isLogoDesignerApp,
  markAutoSwitchedLogoDesignerPreview,
  markLogoDesignerApp,
} from '@/lib/logo-designer-preview-switch-storage'
import { getEffectivePlan, PAYWALL_ITC } from '@/lib/paywall/shared'
import { logger } from '@/lib/request-context'
import { clearSettingsNotification } from '@/lib/settings-notifications-storage'
import { claimTodoListHandoff, releaseTodoListHandoff } from '@/lib/todo-list-handoff-dedupe'
import { cn } from '@/lib/utils'
import { appService, type ElementDeletePayload, type FormatOverrideUpdateData, gitHistoryFailureHttpStatus } from '@/services/AppService'
import { todoListService } from '@/services/TodoListService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { useSecurityQuickFixHandoffStore } from '@/stores/useSecurityQuickFixHandoffStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { useSiteStore } from '@/stores/useSiteStore'
import {
  useActiveStream,
  useAddAiEditContext,
  useAutoSendInitialMessage,
  useHistoryLoadingComplete,
  useIsActivelyStreaming,
  useIsLoading,
  useMessages,
  useSetAiEditContext,
  useSetInputValue,
  useStreamingConversationStore
} from '@/stores/useStreamingConversationStore'
import { useTodoListStore } from '@/stores/useTodoListStore'
import { useWizardStore } from '@/stores/useWizardStore'
import type { RuntimeErrorData } from '@/types/runtime-error'
import { type BusFormatOverrideUpdatePayload, type BusMediaDeletePayload, registerTrackEventBus } from '@/utils/eventBus'
import { logAiroHQEvent, logClickEvent, logImpressionEvent } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'
import {
  buildFormatOverrideReplyMessage,
  parseFormatOverrideUpdateData,
  readFormatOverrideCommitId,
} from './formatOverrideBridge'
import { useInstrumentationPrimer } from '../hooks/useInstrumentationPrimer'

registerTrackEventBus()

// Lazy-load features that are conditionally rendered or behind user interaction
const AnalyticsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/Analytics/AnalyticsPanel'), { loading: () => <SettingsLoadingState fullPage /> })
const AppIntroTour = dynamic(() => import('@/app/[market]/develop/components/tour/AppIntroTour').then(m => ({ default: m.AppIntroTour })), { ssr: false })
const AppNotFound = dynamic(() => import('@/app/[market]/develop/components/AppNotFound'))
const MediaPanel = dynamic(() => import('@/app/[market]/develop/components/media/MediaPanel'), { loading: () => <PanelSkeleton panelType={ChatTab.MEDIAS} /> })
const PostPublishGoLiveModal = dynamic(() => import('@/components/layout/PostPublishGoLiveModal'))
const AgentPublishConfirmationModal = dynamic(() => import('@/components/layout/AgentPublishConfirmationModal'))
const MediaDeleteConfirmationModal = dynamic(() => import('@/app/[market]/develop/components/media/MediaDeleteConfirmationModal').then(m => ({ default: m.MediaDeleteConfirmationModal })))
const VersionHistory = dynamic(() => import('@/app/[market]/develop/components/VersionHistory'), { loading: () => <PanelSkeleton panelType={ChatTab.HISTORY} className="p-2 sm:p-0" /> })

// Lazy-loaded but preloaded on idle after mount
// We do them AOT to avoid skeleton/loader flashes - purely UX and non-blocking.
const importFeedback = () => import('@/components/feedback/Feedback').then(m => ({ default: m.Feedback }))
const importFirstPublishCongratsModal = () => import('@/components/layout/FirstPublishCongratsModal')
const importPublishLimitModal = () => import('@/components/layout/PublishLimitModal')
const importSettingsView = () => import('@/app/[market]/develop/components/settings/SettingsView')
const Feedback = dynamic(importFeedback)
const FirstPublishCongratsModal = dynamic(importFirstPublishCongratsModal)
const PublishLimitModal = dynamic(importPublishLimitModal)
// Loading fallback is still needed so React.lazy gets a local Suspense boundary if the preload hasn't finished.
const SettingsView = dynamic(importSettingsView, { loading: () => <SettingsLoadingState fullPage /> })

const aotImports = [importFeedback, importFirstPublishCongratsModal, importPublishLimitModal, importSettingsView]

function DevelopPageContent({ layout: layoutProp }: { layout?: BuilderLayout }) {
  const t = useTranslations();
  const commanderEnabled: boolean | undefined = useSwitchboard(SWITCHBOARD_APPBUILDER_COMMANDER)
  const layout: BuilderLayout = layoutProp ?? (commanderEnabled ? BuilderLayout.Commander : BuilderLayout.Develop)
  const searchParams = useSearchParams()
  const todoListIdParam = searchParams.get('todoListId')
  const router = useRouter()
  const appId = useAppIdFromParams()
  const isJobId = searchParams.get('type') === 'job'
  const { data: subscription } = useSubscription()
  const planType = getEffectivePlan(subscription?.plan, subscription?.hadAiroPlus) ?? null

  useCombinePublishTrigger(appId);

  useInstrumentationPrimer({ appId, isJobId, planType, searchParams });

  const queryClient = useQueryClient()
  useEffect(() => {
    prefetchSubscription(queryClient)
  }, [queryClient])

  useAotPreload(aotImports)

  // Unified initialization hook - handles all sequencing and UI state
  const init = useInitialization({ appId, isJobId })

  // Shows the "happy with how your app looks?" banner on the first app
  // generation complete. Localstorage-gated per-app; fires at most once.
  const initialBuildReveal = useInitialBuildRevealSignals(
    init.context.hasSeenFirstFileEdit,
    appId
  )
  useAppGenerationFeedbackTrigger(initialBuildReveal.isRevealReady)
  useAgentWorkFeedbackTrigger(initialBuildReveal)

  // Check for venture home logo to airo builder experiment
  const { cohort: ventureHomeLogoCohort } = useHivemind(EXPERIMENT_IDS.ventureHomeLogo);
  const isVentureHomeLogo = ventureHomeLogoCohort === 'on';

  // Default to Brand Book tab for logo-designer template. Also persist a
  // per-app localStorage marker because `init.ui.templateId` is cleared from
  // sessionStorage the moment the first prompt is sent — downstream effects
  // (the Brand → Preview auto-switch below) can't rely on reading it later.
  const isBrandBookEnabled = useSwitchboard('appbuilder-brandbook');
  useEffect(() => {
    if (init.ui.templateId === 'logo-designer' && (isBrandBookEnabled || isVentureHomeLogo)) {
      if (appId) markLogoDesignerApp(appId)
      useDevelopPageStore.getState().setViewMode(ViewMode.BRAND)
    }
  }, [init.ui.templateId, isBrandBookEnabled, isVentureHomeLogo, appId])

  const brandViewFiredRef = useRef(false)
  useEffect(() => {
    if (brandViewFiredRef.current) return
    if (!appId || !isLogoDesignerApp(appId)) return
    brandViewFiredRef.current = true
    logImpressionEvent('develop.brand.view', {
      appId,
      flow: 'logo-designer',
    })()
  }, [appId])

  // The design-kit wizard lives in the "Logo & Brand" (BRAND) tab. Resolved here
  // (rather than at its original site below) because the logo-designer auto-switch
  // effect just below also consumes it: an app that is BOTH a logo-designer template
  // AND on the design-kit profile must not have its BRAND tab yanked to Preview by
  // the wizard's own file writes (showcase HTML, brand-tokens.css).
  const showDesignKitWizard = useIsDesignKitWizardProfile()

  // Immersive design-kit flow (AIROBUILD-2855): a chat-driven phase machine
  // (gathering → brand → website → ready). Pre-reveal (any phase but 'ready') we
  // hide the develop-page chrome so only the chat + wizard overlay show.
  const wizardPhase = useWizardStore((s) => s.phaseByApp[appId])

  // The immersive wizard is for the *initial build only*. A finished build persists
  // `wizard.phase === 'ready'` (the agent emits it after the builders complete —
  // AIROBUILD-2871), so reloading a finished app must land in the normal builder, not
  // replay "Building your website". Read the persisted phase here (page level) so the
  // *landing* decision below knows it before the wizard mounts — the wizard's own
  // `useWizardPhase` only hydrates the store once it's on BRAND, which is too late.
  // Gated on the wizard profile so non-design-kit apps issue no brand-data fetch.
  // `data`+`isLoading` come from one hook instance (same commit), so the landing reads
  // a settled phase with no hydration race. `isLoading` defaults false when disabled.
  const { data: designKitBrandData, isLoading: designKitBrandLoading } = useBrandData(
    appId,
    { enabled: showDesignKitWizard },
  )
  const designKitBuildFinished: boolean = designKitBrandData?.wizard?.phase === 'ready'

  // Logo-designer handoff → website build: switch Brand → Preview when the
  // first page file edit lands. localStorage-gated per appId so a reload after
  // we've already switched once doesn't re-hijack a tab the user has since
  // moved off of. Yields to manual navigation away from Brand.
  useEffect(() => {
    if (!appId) return
    if (!isLogoDesignerApp(appId)) return
    // A design-kit-wizard session lives in BRAND and writes files itself (showcase
    // HTML, brand-tokens.css); don't let that first edit auto-switch it to Preview.
    if (showDesignKitWizard) return
    if (!init.context.hasSeenFirstFileEdit) return
    if (hasAutoSwitchedLogoDesignerPreview(appId)) return

    markAutoSwitchedLogoDesignerPreview(appId)
    const { viewMode: currentViewMode, setViewMode } = useDevelopPageStore.getState()
    if (currentViewMode === ViewMode.BRAND) {
      setViewMode(ViewMode.PREVIEW)
    }
  }, [init.context.hasSeenFirstFileEdit, appId, showDesignKitWizard])

  // Hibernation handling - auto-resume when app is hibernated
  const appDetails = useAppDetails(appId);
  // Cold-archive restore runs before hibernation resume (suppressForColdArchive) so we never POST /resume while archive-status is unknown or restore is in flight.
  const archiveRestore = useAppArchiveRestore(appId, !isJobId, true);
  const suppressHibernationForArchive =
    archiveRestore.archiveGatePending ||
    archiveRestore.isArchivedForRestore ||
    archiveRestore.isRestoringFromArchive ||
    archiveRestore.archiveRestoreFailed;
  const hibernation = useAppHibernation(appDetails.data, appId, true, suppressHibernationForArchive);

  // Image readiness - runs after hibernation resolves or immediately for non-hibernated apps.
  // hasInitialPrompt is hydrated from sessionStorage on each RESET; it becomes false within
  // the same page session once the initial prompt is sent and the sessionStorage keys clear.
  const imageReadiness = useImageReadiness(hibernation, appId, init.context.hasInitialPrompt, archiveRestore);

  // Log when resume completes - history will be loaded via WebSocket
  useEffect(() => {
    if (hibernation.resumeComplete && appId) {
      logger.info('app-hibernation.post-resume-ready', {
        appId,
        message: 'Resume complete, WebSocket will stream history'
      });
    }
  }, [hibernation.resumeComplete, appId, archiveRestore.archiveRestoreComplete]);

  // Gate the Conversations account read + async backfill polling behind the same flag as the
  // inbox UI, so non-inbox users issue no inbox-account requests. Passing undefined disables both
  // queries inside the hook until the flag resolves true.
  const isInboxEnabled = useSwitchboard('app-builder-inbox-button')

  // Fetch inbox account data early and sync to store
  const { brandId, accountId, isLoading: isLoadingAccount } = useInboxAccount(isInboxEnabled ? appId : undefined)
  const setInboxBrandId = useDevelopPageStore((state) => state.setInboxBrandId)
  const setInboxAccountId = useDevelopPageStore((state) => state.setInboxAccountId)

  useEffect(() => {
    setInboxBrandId(brandId)
    setInboxAccountId(accountId)
  }, [brandId, accountId, setInboxBrandId, setInboxAccountId])

  // Single Pusher subscription for the whole builder session, so the inbox
  // unresolved badge stays fresh even when the inbox view is closed. Gated on the
  // feature flag so non-inbox users open no connection.
  //
  // Realtime requires accountId (the channel is presence-admin-account-${id}),
  // which for legacy apps is backfilled asynchronously after brandId resolves.
  // During that window — and for apps with no Reamaze account at all — there is
  // no socket, and the badge degrades to its initial fetch + refetchOnWindowFocus.
  // That still works because the count endpoint is keyed on brandId, not accountId.
  // `?? undefined` keeps the loading-state `null` out of the string-typed option.
  useInboxRealtime({ accountId: isInboxEnabled ? accountId ?? undefined : undefined })
  const isSecurityScanUiEnabled = useSwitchboard('appbuilder-security-scan-ui') === true
  const getViewAvailability = useCallback(
    (mode: ViewMode): ViewAvailability => {
      if (mode === ViewMode.INBOX) {
        return { available: Boolean(isInboxEnabled && brandId), resolving: isLoadingAccount }
      }
      return { available: true, resolving: false }
    },
    [isInboxEnabled, brandId, isLoadingAccount]
  )
  // Land an *in-progress* design-kit session on the BRAND tab (the immersive flow).
  // A finished build (phase 'ready') returns null so it lands in the normal builder —
  // never replaying the wizard. The persisted phase loads async, so hold the landing
  // (initialViewResolving) until brand-data settles; otherwise a finished app would
  // briefly flash the wizard before we know to skip it. A fresh create (initial prompt
  // still pending) is known in-progress up front and lands immediately, no wait.
  const resolveInitialViewMode = useCallback(
    (): ViewMode | null => resolveDesignKitInitialView(showDesignKitWizard, designKitBuildFinished),
    [showDesignKitWizard, designKitBuildFinished]
  )
  const initialViewResolving: boolean =
    isDesignKitInitialViewResolving(showDesignKitWizard, init.context.hasInitialPrompt, designKitBrandLoading)
  useView({ getViewAvailability, resolveInitialViewMode, initialViewResolving })

  // Eval snapshot capture - captures screenshot on first build completion
  const { triggerEvalSnapshot, handleEvalViewportScreenshot } = useEvalSnapshotCapture({ appId })

  // Publish snapshot capture - captures screenshot after each successful publish
  const { upload: uploadPublishSnapshot } = usePublishSnapshotCapture()
  const pendingPublishSnapshotRef = useRef(false)
  const handlePublishSnapshot = useCallback(
    (screenshotDataUrl: string, detail: PublishSnapshotRequestDetail) => {
      void uploadPublishSnapshot(screenshotDataUrl, detail)
      // Defer reset to a microtask so page.tsx's own message handler still
      // sees the ref as true when it fires synchronously after PreviewPane's.
      void Promise.resolve().then(() => { pendingPublishSnapshotRef.current = false })
    },
    [uploadPublishSnapshot]
  )
  useEffect(() => {
    function markPending() { pendingPublishSnapshotRef.current = true }
    window.addEventListener('publish-snapshot-request', markPending)
    return () => window.removeEventListener('publish-snapshot-request', markPending)
  }, [])

  // Server polling store - only used for cleanup on unmount
  // Note: Server polling lifecycle is managed by PreviewPane component
  const cleanupServerPolling = useServerPollingStore((state) => state.cleanup)

  // Streaming conversation store - for messages and active stream
  const messages = useMessages()
  const activeStream = useActiveStream()
  const setInputValue = useSetInputValue()
  const setAiEditContext = useSetAiEditContext()
  const addAiEditContext = useAddAiEditContext()
  const isMultiElementSelect = useSwitchboard('appbuilder-multi-element-select')
  const cmsInlineEditEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_CMS_INLINE_EDIT) ?? false
  const isIntroTourEnabled = useSwitchboard('appbuilder-intro-tour')
  const isGitHubSyncEnabled = useSwitchboard('appbuilder-github-sync')
  const showUnsupportedFeatureWarning = useSwitchboard('appbuilder-preview-unsupported-feature-warnings') === true
  const autoSendInitialMessage = useAutoSendInitialMessage()
  const ws = useChatTransport({ enabled: imageReadiness.isReady })
  const isLoading = useIsLoading()
  const isStreaming = useIsActivelyStreaming()
  const isAwaitingStream = deriveIsAwaitingStream(
    init.context.hasInitialPrompt,
    init.context.initialPromptSent,
    isStreaming,
  )

  // After cold-archive restore the WebSocket controller and dynamic-api cache hold the
  // pre-archive agent_url, and the chat store's historyLoadingComplete flag is still true
  // from the original page load — so AgentsAvailableHandler's emitLoadHistoryIfNeeded
  // short-circuits and the chat keeps rendering stale pre-archive messages.
  //
  // useAppArchiveRestore calls startPollingForServer on mutation success, so by the time
  // archiveRestoreComplete flips true the server-health poller is already running.
  // Wait for isServerReady (agent HTTP health passing) then force-refetch the site record
  // before reconnecting — useSiteStore caches indefinitely and may still hold
  // status=stopped. fetchSite(force=true) primes the cache with the current status so
  // DynamicApiConfigService.getConfigForSite does not throw "agent is not ready yet".
  //
  // We intentionally do NOT wait for hibernation.resumeComplete here: after archive
  // restore the variant may be in RELOADING state (not PAUSED+HIBERNATION), so
  // checkHibernated returns false, useAppHibernation short-circuits, and resumeComplete
  // never becomes true.
  const isServerReadyForAppId = useServerPollingStore((state) =>
    appId ? state.servers.get(appId)?.server?.isReady ?? false : false
  )
  const hasReconnectedAfterArchiveRef = useRef(false)
  useEffect(() => {
    hasReconnectedAfterArchiveRef.current = false
  }, [appId])
  useEffect(() => {
    if (!appId) return
    if (!archiveRestore.archiveRestoreComplete) return
    if (!isServerReadyForAppId) return
    if (hasReconnectedAfterArchiveRef.current) return
    hasReconnectedAfterArchiveRef.current = true
    void (async () => {
      try {
        await useSiteStore.getState().fetchSite(appId, true)
      } catch (error) {
        logger.warn('develop.post_archive_restore.site_refetch_failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      await ws.actions.reconnect()
    })()
  }, [
    appId,
    archiveRestore.archiveRestoreComplete,
    isServerReadyForAppId,
    ws.actions.reconnect,
  ])

  const viewMode = useDevelopPageStore((state) => state.viewMode)
  // Hide develop chrome (header + divider, full-width chat) while the immersive
  // design-kit flow runs in the BRAND tab; reveal normally once phase is 'ready'.
  const hideDevelopChrome = showDesignKitWizard && viewMode === ViewMode.BRAND && wizardPhase !== 'ready'
  // Once a vibe is chosen the chat docks to a left sidebar and the wizard panel
  // ("Building Your Brand" / "Building your website") animates in on the right.
  // `gathering` keeps the centered immersive chat (chat is full-width, no panel).
  const chatDockedLeft = hideDevelopChrome && (wizardPhase === 'brand' || wizardPhase === 'website')
  const chatPaneWidth = useDevelopPageStore((state) => state.chatPaneWidth)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const mobileMode = useDevelopPageStore((state) => state.mobileMode)
  const { activeChatTab, setActiveChatTab, activeSettingsSection } = useChatTabs()
  const { sections: notifiedSettingsSections } = useSettingsNotifications(isSecurityScanUiEnabled ? appId : undefined)

  // Visiting a Settings sub-section clears its "action needed" dot (session-scoped).
  // Generic across sections; notifiedSettingsSections in deps also catches a notification
  // that arrives while the user is already viewing that section.
  useEffect(() => {
    if (!appId) return
    if (activeChatTab === ChatTab.SETTINGS && notifiedSettingsSections.has(activeSettingsSection)) {
      clearSettingsNotification(appId, activeSettingsSection)
    }
  }, [appId, activeChatTab, activeSettingsSection, notifiedSettingsSections])

  const isPreviewVisible = useDevelopPageStore((state) => state.isPreviewVisible)
  const loadingPhase = useDevelopPageStore((state) => state.loadingPhase)
  const openFeedbackId = useDevelopPageStore((state) => state.openFeedbackId)
  const feedbackOrigin = useDevelopPageStore((state) => state.feedbackOrigin)
  const feedbackInitialStep = useDevelopPageStore((state) => state.feedbackInitialStep)
  const showIntroTour = useDevelopPageStore((state) => state.showIntroTour)

  const setChatPaneWidth = useDevelopPageStore((state) => state.setChatPaneWidth)
  const closeFeedbackModal = useDevelopPageStore((state) => state.closeFeedbackModal)
  const setIsPreviewVisible = useDevelopPageStore((state) => state.setIsPreviewVisible)
  const setShowIntroTour = useDevelopPageStore((state) => state.setShowIntroTour)
  const checkAndTriggerIntroTour = useDevelopPageStore((state) => state.checkAndTriggerIntroTour)
  const site = useDevelopPageStore((state) => state.site);
  const isAssetManagerOpen = useDevelopPageStore((state) => state.isAssetManagerOpen);
  const setIsAssetManagerOpen = useDevelopPageStore((state) => state.setIsAssetManagerOpen);
  const pendingMediaDelete = useDevelopPageStore((state) => state.pendingMediaDelete);
  const setPendingMediaDelete = useDevelopPageStore((state) => state.setPendingMediaDelete);
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal);
  const upgradeModalSource = usePaywallStore((state) => state.upgradeModalSource);
  const closeUpgradeModal = usePaywallStore((state) => state.closeUpgradeModal);
  const creditsModalSource = usePaywallStore((state) => state.creditsModalSource);
  const closeCreditsModal = usePaywallStore((state) => state.closeCreditsModal);
  const isUpgradePolling = useIsUpgradePolling();
  const isRenewalPolling = useIsRenewalPolling();
  const publishLimitModalState = useDevelopPageStore((state) =>
    appId ? state.publishStates[appId] : undefined
  );
  const showPublishLimitModal = publishLimitModalState?.showPublishLimitModal ?? false;
  const publishLimitData = publishLimitModalState?.publishLimitData;
  const setShowPublishLimitModal = useDevelopPageStore((state) => state.setShowPublishLimitModal);
  const setShowPaywallModal = useDevelopPageStore((state) => state.setShowPaywallModal);

  usePaywallDeeplinkWithStore({ enabled: loadingPhase === 'ready' });
  useCreditsDeeplinkWithStore({ enabled: loadingPhase === 'ready' });

  useEffect(() => {
    if (isGitHubSyncEnabled && loadingPhase === 'ready' && appId) {
      prefetchGitRemoteConfig(queryClient, appId)
    }
  }, [isGitHubSyncEnabled, loadingPhase, appId, queryClient])

  useEffect(() => {
    const openPublish = searchParams.get('openPublish')
    if (loadingPhase !== 'loading-conversations' && loadingPhase !== 'ready') return
    if (!appId || isJobId) return
    if (useDevelopPageStore.getState().currentAppId !== appId) return
    if (!openPublish) return
    const timerId = window.setTimeout(() => {
      const state = useDevelopPageStore.getState()
      if (state.currentAppId !== appId) return
      logClickEvent('preview_header.publish.button', { appId })()
      state.requestPublishPopoverOpen(appId)
      const url = new URL(window.location.href)
      url.searchParams.delete('openPublish')
      window.history.replaceState({}, '', url)
    }, 0)
    return () => window.clearTimeout(timerId)
  }, [loadingPhase, appId, isJobId, searchParams])

  const gitHistoryQuery = useGitHistoryQuery({
    appId: appId || '',
    enabled: loadingPhase === 'ready' && !!appId && !!site?.agent_url
  });


  const postArchiveGitRecoveryKey = appId ? `airo_post_archive_git_${appId}` : '';

  useEffect(() => {
    if (!appId || !postArchiveGitRecoveryKey) return;
    if (!archiveRestore.archiveRestoreComplete) return;
    try {
      sessionStorage.setItem(postArchiveGitRecoveryKey, '1');
    } catch {
      // ignore
    }
  }, [appId, archiveRestore.archiveRestoreComplete, postArchiveGitRecoveryKey]);

  useEffect(() => {
    if (!appId || !postArchiveGitRecoveryKey) return;
    if (loadingPhase !== 'ready') return;
    if (!gitHistoryQuery.isError || !gitHistoryQuery.error) return;

    const status = gitHistoryFailureHttpStatus(gitHistoryQuery.error);

    let pendingPostArchive = false;
    try {
      pendingPostArchive = sessionStorage.getItem(postArchiveGitRecoveryKey) === '1';
    } catch {
      return;
    }

    if (status !== 400 && status !== 404) {
      if (pendingPostArchive || archiveRestore.archiveRestoreComplete) {
        logger.warn('develop.git_history.reload_skip', {
          appId,
          resolvedStatus: status,
          errorMessage:
            gitHistoryQuery.error instanceof Error
              ? gitHistoryQuery.error.message
              : String(gitHistoryQuery.error),
        });
      }
      return;
    }

    if (!pendingPostArchive && !archiveRestore.archiveRestoreComplete) return;

    const reloadKey = `airo_develop_git_reload_${appId}`;
    try {
      if (sessionStorage.getItem(reloadKey)) return;
      sessionStorage.setItem(reloadKey, '1');
    } catch {
      return;
    }

    logger.info('develop.git_history.reload_once', {
      appId,
      status,
      message: 'Reloading once after cold-archive restore so git history bootstrap fresh',
    });

    window.location.reload();
  }, [
    appId,
    postArchiveGitRecoveryKey,
    loadingPhase,
    archiveRestore.archiveRestoreComplete,
    gitHistoryQuery.isError,
    gitHistoryQuery.error
  ]);

  useEffect(() => {
    if (!appId || !postArchiveGitRecoveryKey) return;
    if (!gitHistoryQuery.isSuccess) return;
    try {
      sessionStorage.removeItem(postArchiveGitRecoveryKey);
    } catch {
      // ignore
    }
  }, [appId, postArchiveGitRecoveryKey, gitHistoryQuery.isSuccess]);

  useEffect(function syncAppId() {
    if (appId) {
      JourneyTracker.setAppId(appId)
    }
  }, [appId])

  // Local state (only what's not in stores)
  const isEditModeEnabled = useDevelopPageStore((state) => state.isEditModeEnabled)
  // Optimistic mobile tab state for instant transitions
  const [optimisticMobileTab, setOptimisticMobileTab] = useState<ChatTab>(activeChatTab)
  const visitedTabs = useVisitedTabs(optimisticMobileTab)
  const securityQuickFixFailCountRef = useRef<Map<string, number>>(new Map())
  const [securityHandoffRetryNonce, setSecurityHandoffRetryNonce] = useState(0)

  // Sync switchboard flag into store and send multi-select state to iframe
  useEffect(() => {
    const enabled = Boolean(isMultiElementSelect)
    useDevelopPageStore.getState().setIsMultiSelectEnabled(enabled)
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe && isEditModeEnabled) {
      if (enabled) {
        const contexts = useStreamingConversationStore.getState().aiEditContexts
        const nextNumber = contexts.reduce((max, c) => Math.max(max, c.number ?? 0), 0)
        postMessageToIframe(iframe, { type: 'MULTI_SELECT_ENABLED', data: { nextNumber } })
      } else {
        postMessageToIframe(iframe, { type: 'MULTI_SELECT_DISABLED' })
      }
    }
  }, [isMultiElementSelect, isEditModeEnabled])

  // Sync optimistic state with URL state
  useEffect(() => {
    setOptimisticMobileTab(activeChatTab)
  }, [activeChatTab])

  // Store last known iframe state for restoration
  const lastIframeState = useRef<{
    url?: string
    scrollPosition?: { x: number; y: number }
  }>({})
  const pendingAutoSendRef = useRef<string | null>(null)
  const autoSendInFlightRef = useRef(false)
  const [isCreateFlowSession, setIsCreateFlowSession] = useState(false)
  const [isDeletingMedia, setIsDeletingMedia] = useState(false)
  const [mediaDeleteError, setMediaDeleteError] = useState<string | null>(null)
  const prevShowChatLoaderRef = useRef(init.ui.showChatLoader)
  const previewInitializedRef = useRef(false)
  const firstEditTrackedRef = useRef(false)
  const previewMilestoneTrackedRef = useRef(false)
  const historyLoadingComplete = useHistoryLoadingComplete()

  const { loadingMessage: chatLoadingMessage } =
    useChatPaneLoadingState({
      initUi: init.ui,
      isCreateFlowSession,
      archiveRestore,
      hibernation,
      imageReadiness,
    })

  const scheduleMicrotask = useCallback((task: () => void | Promise<void>) => {
    if (typeof window === 'undefined') {
      void task()
      return
    }

    // Prefer microtask scheduling to avoid background-tab throttling (rAF pauses in hidden tabs).
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(() => {
        void task()
      })
      return
    }

    void Promise.resolve().then(() => task())
  }, [])

  const sendEditModeMessage = useCallback((enabled: boolean) => {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe) {
      if (enabled) {
        postMessageToIframe(iframe, buildEditModeEnabledMessage(cmsInlineEditEnabled))
      } else {
        postMessageToIframe(iframe, { type: IframeMessageType.EDIT_MODE_DISABLED })
      }
      // Send multi-select mode state alongside edit mode
      if (useDevelopPageStore.getState().isMultiSelectEnabled) {
        const contexts = useStreamingConversationStore.getState().aiEditContexts
        const nextNumber = contexts.reduce((max, c) => Math.max(max, c.number ?? 0), 0)
        postMessageToIframe(iframe, { type: enabled ? 'MULTI_SELECT_ENABLED' : 'MULTI_SELECT_DISABLED', data: { nextNumber } })
      }
    }
  }, [cmsInlineEditEnabled])

  // Speech-to-text bridge for the dev-tools Quick Edit bar. The iframe can't
  // install react-speech-recognition, so the parent owns recognition and
  // forwards listening/transcript state via postMessage. See `useDevToolsSpeechBridge`.
  const speechBridge = useDevToolsSpeechBridge()

  // Funnel event: Track when chat loader hides (user can now see chat)
  // Only during create flow from homepage
  useEffect(() => {
    const wasShowing = prevShowChatLoaderRef.current
    const isShowing = init.ui.showChatLoader

    if (wasShowing && !isShowing && appId && isCreateFlowSession) {
      shipAnalyticsLog('funnel.chat_loader.hidden', {
        appId,
        phase: init.phase,
        subPhase: init.subPhase,
      })
    }

    prevShowChatLoaderRef.current = isShowing
  }, [init.ui.showChatLoader, appId, init.phase, init.subPhase, isCreateFlowSession])

  useEffect(() => {
    logImpressionEvent('develop.page.view')();
    logAiroHQEvent({
      category: 'impression',
      recommendation_task: 'builder_develop_page_view',
      recommendation_type: 'navigation'
    })();

    clearExpiredWidgetStates();
  }, [])

  // Funnel event: Track that user reached the develop page
  // Separate effect with [appId] dep so it fires even if appId resolves after initial render.
  // useRef guard ensures it fires at most once per page mount.
  const hasFiredDevelopPageLoaded = useRef(false)
  useEffect(() => {
    if (appId && !hasFiredDevelopPageLoaded.current) {
      hasFiredDevelopPageLoaded.current = true
      // Check session storage directly because isCreateFlowSession is not yet set at mount time
      const hasInitialPrompt = sessionStorage.getItem(`initial-prompt-pending-${appId}`) !== null;
      shipAnalyticsLog('funnel.develop_page.loaded', {
        appId,
        source: hasInitialPrompt ? 'quick-create' : 'direct-nav',
      });
    }
  }, [appId])

  // Sync responsive state (isMobile) with store using useMediaQuery
  useSyncResponsiveState()

  // All initialization is now handled by useInitialization hook

  // Update document title with site name
  useEffect(() => {
    if (site?.name) {
      document.title = `${site.name} - ${t('builder_develop_title')}`
    }
  }, [site?.name, t])

  // State logging moved to useInitialization hook to prevent render loop

  // Handle todoListId query parameter: strip URL only after send succeeds so retries still see the param
  useEffect(() => {
    if (!todoListIdParam) {
      return
    }
    if (!claimTodoListHandoff(todoListIdParam)) {
      return
    }

    const stripTodoListIdFromUrl = function stripTodoListIdFromUrl() {
      const newSearchParams = new URLSearchParams(window.location.search)
      newSearchParams.delete('todoListId')
      const newUrl = newSearchParams.toString()
        ? `${window.location.pathname}?${newSearchParams.toString()}`
        : window.location.pathname
      router.replace(newUrl)
    }

    const restoreTodoListIdInUrl = function restoreTodoListIdInUrl() {
      const newSearchParams = new URLSearchParams(window.location.search)
      if (newSearchParams.get('todoListId') === todoListIdParam) {
        return
      }
      newSearchParams.set('todoListId', todoListIdParam)
      router.replace(`${window.location.pathname}?${newSearchParams.toString()}`)
    }

    const handleTodoListContext = async function securityTodoHandoff() {
      try {
        if (appId) {
          try {
            const list = await todoListService.setCurrentList(appId, todoListIdParam)
            useTodoListStore.getState().setCurrentList(list)
          } catch (err) {
            logger.warn('develop.todo_context.set_current.failed', {
              appId,
              todoListId: todoListIdParam,
              error: err instanceof Error ? err.message : String(err)
            })
          }
        }
        const message = 'Fix my selected Security Vulnerabilities.'
        await ws.actions.send({
          content: message,
          todoListContext: { id: todoListIdParam }
        })
        setActiveChatTab(ChatTab.CHAT)
        securityQuickFixFailCountRef.current.delete(todoListIdParam)
        useSecurityQuickFixHandoffStore.getState().markHandoffComplete()
        stripTodoListIdFromUrl()
      } catch (error) {
        releaseTodoListHandoff(todoListIdParam)
        restoreTodoListIdInUrl()
        const fails = (securityQuickFixFailCountRef.current.get(todoListIdParam) ?? 0) + 1
        securityQuickFixFailCountRef.current.set(todoListIdParam, fails)
        logger.error('develop.todo_context.send.failed', {
          todoListId: todoListIdParam,
          error: error instanceof Error ? error.message : String(error),
          attempt: fails
        })
        if (fails < 3) {
          Growl.addGrowlMessage({
            id: 'security-quick-fix-send-failed',
            title: t('builder_develop_security_quick_fix_error_title', undefined, 'Unable to send fix request'),
            children: t('builder_develop_security_quick_fix_error_description', undefined, 'Something went wrong. Retrying…'),
            emphasis: 'critical',
            lifetime: 5000
          })
          setSecurityHandoffRetryNonce(function bumpNonce(n) {
            return n + 1
          })
        } else {
          securityQuickFixFailCountRef.current.delete(todoListIdParam)
          stripTodoListIdFromUrl()
          Growl.addGrowlMessage({
            id: 'security-quick-fix-give-up',
            title: t('builder_develop_security_quick_fix_give_up_title', undefined, 'Security fix unavailable'),
            children: t('builder_develop_security_quick_fix_give_up_description', undefined, 'Open Security settings and try Quick Fix again.'),
            emphasis: 'critical',
            lifetime: 7000
          })
        }
      }
    }

    void handleTodoListContext()
  }, [todoListIdParam, router, appId, ws.actions.send, securityHandoffRetryNonce, setActiveChatTab, t])

  // Cleanup WebSocket connections on unmount
  useEffect(() => {
    return () => {
      cleanupServerPolling()
    }
  }, [cleanupServerPolling])

  // WebSocket and conversation history are now initialized by useInitialization hook

  // Determine initial preview visibility based on persisted state or loaded history
  useEffect(() => {
    if (previewInitializedRef.current) return
    if (loadingPhase !== 'ready' || !appId) return

    const storageKey = `airo-preview-visible-${appId}`
    const savedState = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null

    if (savedState !== null) {
      setIsPreviewVisible(JSON.parse(savedState))
      previewInitializedRef.current = true
      return
    }

    if (!historyLoadingComplete) return

    const hasHistory = messages.length > 0
    setIsPreviewVisible(hasHistory)
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(hasHistory))
    }
    previewInitializedRef.current = true
  }, [loadingPhase, appId, messages.length, setIsPreviewVisible, historyLoadingComplete])

  // Note: Server polling is managed by PreviewPane component
  // PreviewPane owns its server state and polling lifecycle

  const isProcessing = isLoading || isStreaming
  const isProcessingRef = useRef(isProcessing)
  isProcessingRef.current = isProcessing

  const isMutatingFiles = useMemo(
    () => !!activeStream?.toolCalls?.some(mutatesFiles),
    [activeStream?.toolCalls],
  )

  useEffect(() => {
    broadcastProcessingState(isProcessing)
  }, [isProcessing])

  // Runtime errors thrown inside the preview iframe are handled entirely
  // by `AiroErrorBoundary` in the app template: it shows its own overlay
  // (suppressed while the agent is actively processing), and when the user
  // clicks "Ask Airo to Fix Code" it posts an `error-fix-user-requested`
  // message that we forward to the agent here.
  const sendUserRequestedFix = useCallback((errorData: RuntimeErrorData) => {
    const { message, name, stack, componentStack, url, timestamp } = errorData
    const promptText = t('builder_develop_fix_runtime_error', undefined, 'Please analyze and fix this runtime error.')
    scheduleMicrotask(() => {
      void ws.actions.send({
        content: promptText,
        aiEditContext: null,
        isActionRequest: false,
        customContext: {
          type: 'runtime_error',
          data: { message, name, stack, componentStack, url, timestamp },
          persistence: 'ephemeral',
          source: 'error-boundary'
        }
      })
    })
  }, [scheduleMicrotask, ws.actions, t])

  // Triggered from the builder-side PreviewError surface when vite is
  // crash-looping or the iframe failed to load. Mirrors sendUserRequestedFix
  // but originates from the builder rather than the iframe overlay, since
  // the iframe couldn't load to surface its own overlay.
  const sendPreviewFixRequest = useCallback(() => {
    if (isProcessingRef.current) {
      logger.info('develop-page.preview-fix-request.skipped-processing', { appId })
      return
    }
    const promptText = t(
      'builder_develop_fix_preview',
      undefined,
      "My preview isn't working — it's either not loading or failing to start. Please check the container logs and fix the issue."
    )
    scheduleMicrotask(() => {
      void ws.actions.send({
        content: promptText,
        aiEditContext: null,
        isActionRequest: false,
        customContext: {
          type: 'preview_fix',
          data: { appId, timestamp: Date.now() },
          persistence: 'ephemeral',
          source: 'preview-error-button',
        }
      })
    })
  }, [scheduleMicrotask, ws.actions, t, appId])

  const handleScreenshotUpload = useCallback(async (screenshotDataUrl: string) => {
    if (!appId) return

    logger.info('develop-page.screenshot.upload.start', { appId })

    try {
      // Convert data URL to Blob
      const response = await fetch(screenshotDataUrl)
      const blob = await response.blob()

      // Create FormData and append the blob
      const formData = new FormData()
      formData.append('screenshot', blob, 'screenshot.png')

      // Build correct API URL with site context
      const apiUrl = await buildDynamicApiUrl('screenshot', appId)

      // Upload to agents API using agentFetch with authentication
      const uploadResponse = await agentFetch(apiUrl, {
        method: 'POST',
        body: formData,
        siteId: appId
      })

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`)
      }

      logger.info('develop-page.screenshot.upload.success', { appId })
    } catch (error) {
      logger.error('develop-page.screenshot.upload.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [appId])

  const handleAutoImportMediaSlot = useCallback(async (
    imageUrl: string,
    devContext: Record<string, unknown> | undefined,
    imageAlt: string | undefined,
    imageType: string | undefined,
    openEditor?: boolean
  ) => {
    if (!appId) return

    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

      if (!apiConfig.agentUrl) {
        throw new Error('Agent URL not available')
      }

      const response = await fetch(
        `${apiConfig.agentUrl}/media/${appId}/slots/import`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenResult.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ imageUrl, devContext, imageAlt, imageType }),
        }
      )

      if (!response.ok) {
        throw new Error(`Import failed: ${response.status}`)
      }

      const result = await response.json()
      if (result.success && result.slotPath) {
        useMediaSlotDialogStore.getState().navigateToSlot(result.slotPath, openEditor ? { openEditor: true } : undefined)
        const develop = useDevelopPageStore.getState()
        develop.setActiveChatTab(ChatTab.MEDIAS)
        if (develop.isMobile) {
          develop.handleMobileModeChange(MobileMode.TOOLS)
        }
      }
    } catch (error) {
      logger.error('develop-page.auto-import-media-slot.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
      Growl.addGrowlMessage({
        id: 'auto-import-media-slot-error',
        title: t('builder_common_error_generic', undefined, 'Something went wrong. Please try again.'),
        children: t('builder_common_retry', undefined, 'Please try again.'),
        emphasis: 'critical',
        lifetime: 5000,
      })
    }
  }, [appId, t])

  const sendTextUpdate = useCallback(async (textData: { selector: string; preciseSelector?: string; oldText: string; newText: string; newHtml?: string; devContext: Record<string, unknown> }) => {
    if (!appId) return

    logger.info('develop-page.text-update.begin', {
      appId,
      selector: textData.selector,
      oldTextLength: textData.oldText?.length || 0,
      newTextLength: textData.newText?.length || 0,
      hasDevContext: !!textData.devContext,
      hasFileName: !!(textData.devContext && textData.devContext.fileName),
      hasComponentName: !!(textData.devContext && textData.devContext.componentName)
    })

    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null

    try {
      const result = await appService.updateText(appId, textData)
      if (result?.success) {
        logger.info('develop-page.text-update.success', { appId })
        if (iframe) postMessageToIframe(iframe, { type: 'TEXT_EDIT_SUCCEEDED' })
      } else {
        logger.error('develop-page.text-update.failed', { appId })
        showEditApplyFailureGrowl(t)
        if (iframe) postMessageToIframe(iframe, 'code' in result ? { type: 'TEXT_EDIT_FAILED', code: result.code } : { type: 'TEXT_EDIT_FAILED' })
      }
    } catch (error) {
      logger.error('develop-page.text-update.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
      showEditApplyFailureGrowl(t)
      if (iframe) postMessageToIframe(iframe, { type: 'TEXT_EDIT_FAILED' })
    }
  }, [appId, t])

  const sendTextFix = useCallback(async (data: { requestId?: string; oldText: string }) => {
    if (!appId) return

    const { requestId, oldText } = data
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null

    logger.info('develop-page.text-fix.begin', {
      appId,
      requestId,
      textLength: oldText?.length || 0,
    })

    try {
      const result = await appService.fixText(appId, { oldText })
      if (result?.success) {
        logger.info('develop-page.text-fix.success', { appId, requestId, changed: result.data.changed })
        if (iframe) postMessageToIframe(iframe, {
          type: 'TEXT_FIX_RESULT',
          requestId,
          data: result.data,
        })
      } else {
        logger.error('develop-page.text-fix.failed', { appId, requestId })
        if (iframe) postMessageToIframe(iframe, { type: 'TEXT_FIX_FAILED', requestId })
      }
    } catch (error) {
      logger.error('develop-page.text-fix.error', {
        appId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      if (iframe) postMessageToIframe(iframe, { type: 'TEXT_FIX_FAILED', requestId })
    }
  }, [appId])

  const sendStyleUpdate = useCallback(async (styleData: { commitId?: string; selector: string; property: string; value: string; newClassName: string; elementInfo: Record<string, unknown> }) => {
    if (!appId) return

    logger.info('develop-page.style-update.begin', { appId, property: styleData.property, value: styleData.value })

    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
    // Echo the commitId back so the iframe-side listener can correlate this
    // reply to the specific in-flight commit it's waiting on. Prevents
    // cross-talk when multiple style commits are in flight (e.g. drag-end
    // immediately followed by a swatch click).
    const commitId = styleData.commitId

    try {
      const result = await appService.updateStyle(appId, styleData as Parameters<typeof appService.updateStyle>[1]) as { success?: boolean }
      if (result?.success) {
        logger.info('develop-page.style-update.success', { appId })
        if (iframe) postMessageToIframe(iframe, { type: 'STYLE_EDIT_SUCCEEDED', commitId })
      } else {
        logger.error('develop-page.style-update.failed', { appId })
        showEditApplyFailureGrowl(t)
        if (iframe) postMessageToIframe(iframe, { type: 'STYLE_EDIT_FAILED', commitId })
      }
    } catch (error) {
      logger.error('develop-page.style-update.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
      showEditApplyFailureGrowl(t)
      if (iframe) postMessageToIframe(iframe, { type: 'STYLE_EDIT_FAILED', commitId })
    }
  }, [appId, t])

  const sendFormatOverrideUpdate = useCallback(async (data: BusFormatOverrideUpdatePayload) => {
    if (!appId) return

    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
    const formatData: FormatOverrideUpdateData | null = parseFormatOverrideUpdateData(data)

    if (!formatData) {
      logger.warn('develop-page.format-override.malformed', { appId })
      if (iframe) {
        const commitId = readFormatOverrideCommitId(data)
        postMessageToIframe(iframe, buildFormatOverrideReplyMessage(commitId, {
          success: false,
          error: 'malformed payload',
        }))
      }
      return
    }

    const commitId = formatData.commitId

    logger.info('develop-page.format-override.begin', {
      appId,
      devId: formatData.devId,
      sourceKind: formatData.target.sourceKind,
    })

    try {
      const result = await appService.updateFormatOverride(appId, formatData)
      logger.info('develop-page.format-override.complete', { appId, success: result.success })
      if (iframe) postMessageToIframe(iframe, buildFormatOverrideReplyMessage(commitId, result))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('develop-page.format-override.error', { appId, error: errorMessage })
      if (iframe) {
        postMessageToIframe(iframe, buildFormatOverrideReplyMessage(commitId, {
          success: false,
          error: errorMessage,
        }))
      }
    }
  }, [appId])

  const sendElementDelete = useCallback(async (payload: BusMediaDeletePayload) => {
    if (!appId) {
      logger.warn('develop-page.media-delete.skipped-no-app')
      throw new Error('Cannot delete element: no appId')
    }

    logger.info('develop-page.media-delete.begin', { appId, isVideo: payload.isVideo })

    const devContext = payload.elementInfo.devContext ?? payload.devContext
    const elementDeletePayload: ElementDeletePayload = {
      selector: payload.selector,
      preciseSelector: payload.preciseSelector,
      isVideo: payload.isVideo,
      elementInfo: {
        tagName: payload.elementInfo.tagName,
        className: payload.elementInfo.className,
        id: payload.elementInfo.id,
        dataId: payload.elementInfo.dataId,
        selector: payload.elementInfo.selector,
        devContext: {
          fileName: devContext?.fileName ?? '',
          componentName: devContext?.componentName ?? '',
          lineNumber: devContext?.lineNumber ?? 0,
          devId: devContext?.devId,
        },
      },
    }

    const result = await appService.deleteElement(appId, elementDeletePayload)
    if (result?.success) {
      logger.info('develop-page.media-delete.success', { appId })
      // Reload the preview so the removed element disappears.
      handlePreviewRefresh({ lastIframeState })
    } else {
      logger.error('develop-page.media-delete.failed', { appId })
      throw new Error('Element delete did not succeed')
    }
  }, [appId])

  // Listen for file edit tool completions to show preview
  useEffect(() => {
    if (!appId || !activeStream) return

    // Check if any fileEdit tool calls have completed successfully
    const completedFileEdit = activeStream.toolCalls.find(
      toolCall => toolCall.name === 'fileEdit' &&
        toolCall.status === 'completed' &&
        !toolCall.error
    )

    if (completedFileEdit) {
      if (!firstEditTrackedRef.current) {
        firstEditTrackedRef.current = true
        JourneyTracker.current()?.trackMilestone('first_edit_made', { appId })
      }

      if (!isPreviewVisible) {
        setIsPreviewVisible(true)

        if (!previewMilestoneTrackedRef.current) {
          previewMilestoneTrackedRef.current = true
          const msToFirstView: number | null = trackFirstView()
          JourneyTracker.current()?.trackMilestone('preview_generated', { appId, msToFirstView })
        }

        init.actions.markFirstFileEditSeen()
        const storageKey = `airo-preview-visible-${appId}`
        if (typeof window !== 'undefined') {
          localStorage.setItem(storageKey, 'true')
        }
      }
    }
  }, [appId, activeStream, isPreviewVisible, setIsPreviewVisible, init.actions])

  // Listen for eval snapshot trigger from CompleteHandler
  useEffect(() => {
    const handler = () => triggerEvalSnapshot()
    window.addEventListener('eval-snapshot-trigger', handler)
    return () => window.removeEventListener('eval-snapshot-trigger', handler)
  }, [triggerEvalSnapshot])

  // Listen for messages from preview iframe — all cross-iframe message
  // types route through the typed eventBus inside this hook.
  useDevToolsBusBindings({
    appId,
    cmsInlineEditEnabled,
    isProcessingRef,
    pendingPublishSnapshotRef,
    lastIframeState,
    sendTextUpdate,
    sendTextFix,
    sendStyleUpdate,
    sendFormatOverrideUpdate,
    sendUserRequestedFix,
    sendEditModeMessage,
    isEditModeEnabled,
    setAiEditContext,
    addAiEditContext,
    setIsAssetManagerOpen,
    setInputValue,
    scheduleMicrotask,
    handleScreenshotUpload,
    handleEvalViewportScreenshot,
    handleAutoImportMediaSlot,
    speechBridge,
    t,
    wsSend: ws.actions.send,
    showUnsupportedFeatureWarning,
  })
  // Warn user before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        event.preventDefault()
        event.returnValue = t('builder_create_unload_warning')
        return t('builder_create_unload_warning')
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges, t])

  // activeChatTab and activeSettingsSection are driven directly by URL parameters via useChatTabs

  // Handle URL message parameter - simplified logic
  useEffect(() => {
    if (loadingPhase !== 'ready') return

    const message = searchParams.get('message')
    // Only auto-fill if there's no conversation history (check messages instead of conversations)
    if (message && messages.length === 0) {
      const decodedMessage = decodeURIComponent(message)
      setInputValue(decodedMessage)

      // Auto-send and clear URL
      scheduleMicrotask(() => {
        const url = new URL(window.location.href)
        url.searchParams.delete('message')
        router.replace(url.pathname + url.search, { scroll: false })
      })
    }
  }, [loadingPhase, searchParams, messages.length, router, setInputValue, scheduleMicrotask])

  // Handle auto-send initial message for new apps (driven by init.ui.shouldAutoSendPrompt).
  // Do not gate the whole effect on shouldAutoSendPrompt: after a WebSocket disconnect the init
  // machine returns to waitingForWebSocket so shouldAutoSendPrompt is false, but pendingAutoSendRef
  // may still hold the prompt (e.g. React StrictMode remount). The send branch must still run once
  // the socket is connected again.
  useEffect(() => {
    if (!appId) return
    if (searchParams.get('message')) return // Don't auto-send if there's a URL message

    if (init.ui.shouldAutoSendPrompt && init.ui.autoSendPromptText && !pendingAutoSendRef.current) {
      // FQDN preamble for external-entry redirects (e.g. DPP); home-flow doesn't set fqdn.
      const fqdn = typeof site?.fqdn === 'string' ? site.fqdn.toLowerCase() : undefined
      const firstMessage = fqdn
        ? `This site is for ${fqdn}. ${init.ui.autoSendPromptText}`
        : init.ui.autoSendPromptText
      const wasTriggered = autoSendInitialMessage(firstMessage, appId)

      if (wasTriggered) {
        pendingAutoSendRef.current = firstMessage
        setIsCreateFlowSession(true)
        logger.info('develop-page.auto-send.triggered', {
          message: 'Auto-sending initial message for new app',
          appId,
          hasFqdn: !!fqdn,
          promptPreview: firstMessage.substring(0, 50) + '...'
        })

        // Funnel event: Initial prompt sent from client - correlate with APM using appId
        shipAnalyticsLog('funnel.initial_prompt.sent', {
          appId,
          promptLength: firstMessage.length,
        })

        activateInitialBuildFunnel(appId)

        JourneyTracker.current()?.trackMilestone('onboarding_started', { appId })
        if (init.ui.templateId && init.ui.templateId !== 'default') {
          JourneyTracker.current()?.trackMilestone('template_selected', { appId, templateId: init.ui.templateId })
        }
      } else if (messages.length > 0) {
        init.actions.markInitialPromptSent()
      }
    }

    if (
      pendingAutoSendRef.current &&
      ws.connection.isConnected &&
      !autoSendInFlightRef.current
    ) {
      autoSendInFlightRef.current = true
      const messageToSend = pendingAutoSendRef.current

      void sendPendingAutoSendMessage({
        messageToSend,
        appId,
        jobId: init.initialJobId,
        templateId: init.ui.templateId ?? null,
        uploadedFiles: init.ui.uploadedFiles ?? null,
        designKitSlug: init.ui.designKitSlug ?? null,
        send: ws.actions.send,
        setInputValue,
        markInitialPromptSent: init.actions.markInitialPromptSent,
        markFirstFileEditSeen: init.actions.markFirstFileEditSeen,
        onSettled: () => {
          pendingAutoSendRef.current = null
          autoSendInFlightRef.current = false
        },
      })
    }
  }, [
    init.ui.shouldAutoSendPrompt,
    init.ui.autoSendPromptText,
    init.ui.templateId,
    init.ui.designKitSlug,
    searchParams,
    autoSendInitialMessage,
    ws.actions.send,
    appId,
    init.actions,
    ws.connection.isConnected,
    messages.length,
    setInputValue,
    site,
  ])

  useEffect(() => {
    if (loadingPhase !== 'ready' || !init.initialJobId) return

    const nameRegistrationKey = `name-registration-pending-${init.initialJobId}`
    const flagExists = sessionStorage.getItem(nameRegistrationKey) === 'true'

    if (flagExists) {
      logger.info('app.develop.page.cleanup-flag', {
        message: 'Cleaning up name registration flag (name already set during verification)',
        initialJobId: init.initialJobId
      })
      sessionStorage.removeItem(nameRegistrationKey)
    }
  }, [loadingPhase, init.initialJobId])

  const handlePanelResize = useCallback((newWidth: number) => {
    setChatPaneWidth(newWidth)
  }, [setChatPaneWidth])

  // Check and trigger intro tour after first message completes
  useEffect(() => {
    if (!isIntroTourEnabled) return
    if (!appId || !init.isReady) return

    // Trigger tour when we have at least one message and no active stream
    if (messages.length > 0 && !activeStream) {
      checkAndTriggerIntroTour()
    }
  }, [isIntroTourEnabled, appId, init.isReady, messages.length, activeStream, checkAndTriggerIntroTour])

  if (init.siteNotFound) {
    return (
      <div className="h-[calc(100dvh-var(--dark-release-banner-h,0px))] flex flex-col">
        <DevelopHeader onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })} />
        <AppNotFound />
      </div>
    )
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files') && !isAssetManagerOpen) {
      setIsAssetManagerOpen(true);
    }
  };

  const isLayoutRtl =
    typeof document !== 'undefined' && document.documentElement.dir === 'rtl'

  return (
    <ChatProvider sendMessage={ws.actions.send} loadHistory={ws.actions.loadHistory} stopGeneration={ws.actions.stop} cancelLogoGeneration={ws.actions.cancelLogo}>
      <div
        className={cn("absolute inset-0 flex flex-col overflow-hidden bg-develop-bg", {
          "ios-fixed-container": isMobile
        })}
        style={isMobile ? {
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        } : undefined}
        onDragEnter={handleDragEnter}
      >
        <PostPublishGoLiveModal appId={appId} />
        {layout === BuilderLayout.Commander ? (
          <CommanderShell
            appId={appId}
            isMobile={isMobile}
            chatPaneNode={
              <ChatPane
                sendMessage={ws.actions.send}
                stopGeneration={ws.actions.stop}
                isCreateFlowSession={isCreateFlowSession}
                hasInitialPrompt={init.context.hasInitialPrompt}
                isAwaitingStream={isAwaitingStream}
                initialPromptText={init.context.initialPromptText}
                loadingMessage={chatLoadingMessage}
                layout={layout}
                onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
              />
            }
            previewPaneNode={
              <PreviewPane
                onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                isMutatingFiles={isMutatingFiles}
                isProcessing={isProcessing}
                showBuildingOverlay={init.ui.showPreviewLoader && viewMode !== ViewMode.BRAND}
                isHibernated={hibernation.isHibernated}
                isResuming={hibernation.isResuming}
                resumeFailed={hibernation.resumeFailed}
                onRetryResume={() => hibernation.resume()}
                archiveGatePending={archiveRestore.archiveGatePending}
                archiveResumeFailed={archiveRestore.archiveRestoreFailed}
                onRetryArchiveRestore={() => archiveRestore.restoreFromArchive()}
                showArchiveResumeMessage={
                  archiveRestore.isArchivedForRestore || archiveRestore.isRestoringFromArchive
                }
                isImageReloading={imageReadiness.isImageUpdating}
                imageReloadFailed={!!imageReadiness.error}
                onRetryImageReload={() => imageReadiness.retry()}
                isMobile={isMobile}
                onPublishSnapshot={handlePublishSnapshot}
                onAskAiroToFix={sendPreviewFixRequest}
                chatLoadingMessage={chatLoadingMessage}
              />
            }
          />
        ) : (
          <>
        {hideDevelopChrome
          ? <DesignKitChatHeader />
          : <DevelopHeader onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })} />}

        {/* Desktop Layout */}
        {!isMobile && (
          <div className="relative h-full w-full overflow-hidden">
            {/* Sidebar (Chat, History, Settings menu) */}
            <motion.div
              className="absolute top-0 start-0 bottom-0 isolate"
              animate={{
                // Only the non-immersive, collapsed pane slides off-screen. In the
                // immersive design-kit mode the chat fills the row and is centered
                // below, so it stays at x:0 (the minimal header has no expand control).
                x: !hideDevelopChrome && isChatPaneCollapsed
                  ? (isLayoutRtl ? chatPaneWidth + 16 : -(chatPaneWidth + 16))
                  : 0,
                // gathering: chat fills the row (centered below). Once docked (brand/
                // website) it narrows to the sidebar width so the wizard panel takes
                // the rest of the row.
                width: hideDevelopChrome && !chatDockedLeft ? '100%' : chatPaneWidth
              }}
              transition={{
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1]
              }}
              style={{
                pointerEvents: !hideDevelopChrome && isChatPaneCollapsed ? 'none' : 'auto'
              }}
            >
              {/* Centered, constrained column for the gathering (full-width) immersive
                  chat; once docked left the chat fills the narrow sidebar with its own
                  horizontal padding (ChatPane drops `md:ps-2` when its toolbar is hidden,
                  so add it back here). The always-present wrapper keeps ChatPane mounted
                  across phase changes. */}
              <div className={cn('h-full w-full', hideDevelopChrome && !chatDockedLeft && 'mx-auto max-w-3xl', chatDockedLeft && 'px-3')}>
                <ChatPane
                  sendMessage={ws.actions.send}
                  stopGeneration={ws.actions.stop}
                  isCreateFlowSession={isCreateFlowSession}
                  hasInitialPrompt={init.context.hasInitialPrompt}
                  isAwaitingStream={isAwaitingStream}
                  initialPromptText={init.context.initialPromptText}
                  loadingMessage={chatLoadingMessage}
                  layout={layout}
                  hideToolbar={hideDevelopChrome}
                  onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                />
              </div>
            </motion.div>

            {/* Resizable Divider */}
            {!isChatPaneCollapsed && !hideDevelopChrome && (
              <ResizableDivider
                onResize={handlePanelResize}
                minLeftWidth={300}
                minRightWidth={Math.max(600, typeof window !== 'undefined' ? window.innerWidth * 0.5 : 600)}
                style={{
                  insetInlineStart: `${chatPaneWidth + 10}px`
                }}
              />
            )}

            {/* Content (Preview, Settings, Code, and the BRAND wizard overlay). During
                `gathering` the chat is full-width and this area is pushed fully off-screen
                (insetInlineStart 100%). Once a vibe is chosen (brand/website) it animates
                in beside the docked chat to render the wizard panel. PreviewPane stays
                MOUNTED throughout, just off-screen, until the flow reveals at 'ready'. */}
            <motion.div
              className="absolute top-0 end-0 bottom-0 flex flex-col"
              initial={false}
              animate={{
                insetInlineStart: hideDevelopChrome
                  ? (chatDockedLeft ? chatPaneWidth + 16 : '100%')
                  : isChatPaneCollapsed ? 8 : chatPaneWidth + 16
              }}
              transition={{
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1]
              }}
            >
              {/* Content area - takes remaining space after banner */}
              <div className="flex-1 relative min-h-0 isolate">
                {/* Preview/Code View */}
                <div
                  id="preview-pane-container"
                  className="absolute inset-0 flex flex-col isolate"
                >
                  <PreviewPane
                    onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                    isMutatingFiles={isMutatingFiles}
                    isProcessing={isProcessing}
                    showBuildingOverlay={init.ui.showPreviewLoader && viewMode !== ViewMode.BRAND}
                    isHibernated={hibernation.isHibernated}
                    isResuming={hibernation.isResuming}
                    resumeFailed={hibernation.resumeFailed}
                    onRetryResume={() => hibernation.resume()}
                    archiveGatePending={archiveRestore.archiveGatePending}
                    archiveResumeFailed={archiveRestore.archiveRestoreFailed}
                    onRetryArchiveRestore={() => archiveRestore.restoreFromArchive()}
                    showArchiveResumeMessage={
                      archiveRestore.isArchivedForRestore || archiveRestore.isRestoringFromArchive
                    }
                    isImageReloading={imageReadiness.isImageUpdating}
                    imageReloadFailed={!!imageReadiness.error}
                    onRetryImageReload={() => imageReadiness.retry()}
                    isMobile={false}
                    onPublishSnapshot={handlePublishSnapshot}
                    onAskAiroToFix={sendPreviewFixRequest}
                    chatLoadingMessage={chatLoadingMessage}
                  />
                </div>
                {/* Brand overlay (Brand Book, or the design-kit wizard when the app is on
                    the design-kit profile) — mounted here (a stable parent) rather than inside
                    PreviewPane so it is NOT torn down and re-mounted when PreviewPane flips
                    between its preview-server readiness branches mid-generation. PreviewPane
                    keeps the underlying preview/code mounted-but-inert while BRAND is active. */}
                {/* When we leave BRAND (e.g. the design-kit reveal flips to Preview),
                    fade the overlay out so the finished site underneath is revealed with
                    a soft crossfade rather than a hard cut. `initial={false}` keeps the
                    entrance unchanged — only the exit animates. */}
                <AnimatePresence>
                  {viewMode === ViewMode.BRAND && (
                    <motion.div
                      className="absolute inset-0 z-20 overflow-hidden rounded-lg md:rounded-b-none"
                      data-testid="brand-book-overlay"
                      initial={false}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.45, ease: 'easeOut' }}
                    >
                      {showDesignKitWizard
                        ? <DesignKitWizard appId={appId} />
                        : <BrandBookView appId={appId} />}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        )}

        {/* Mobile Layout */}
        {isMobile && (
          <div className="relative h-full w-full overflow-hidden">
            <div className="absolute top-0 left-0 right-0 bottom-8 flex flex-col">
              {init.ui.showChatLoader ? (
                <ChatPaneLoader
                  phase={init.ui.chatLoaderPhase}
                  error={init.ui.chatLoaderError}
                  retryCount={init.retryCount}
                  maxRetries={init.maxRetries}
                  onRetry={init.actions.retry}
                  onCancel={init.actions.cancel}
                />
              ) : hibernation.isHibernated || hibernation.isResuming ? (
                <ChatPaneLoader
                  phase={ResumeLoaderPhase.RESUMING}
                  error={null}
                  retryCount={0}
                  maxRetries={0}
                  onRetry={() => {}}
                  onCancel={() => {}}
                />
              ) : imageReadiness.isChecking ? (
                <ChatPaneLoader
                  phase={ImageReloadLoaderPhase.CHECKING_IMAGES}
                  error={null}
                  retryCount={0}
                  maxRetries={0}
                  onRetry={() => {}}
                  onCancel={() => router.push('/')}
                />
              ) : imageReadiness.isImageUpdating || imageReadiness.error ? (
                <ChatPaneLoader
                  phase={ImageReloadLoaderPhase.UPDATING_IMAGES}
                  error={imageReadiness.error}
                  retryCount={0}
                  maxRetries={1}
                  onRetry={() => imageReadiness.retry()}
                  onCancel={() => router.push('/')}
                />
              ) : (
                <>
                  {/* Content area - takes remaining space after banner */}
                  <div className="flex-1 relative min-h-0">
                    {/* Preview Tab */}
                    <div
                      className="absolute inset-0 flex flex-col transition-opacity duration-150 isolate"
                      style={{
                        opacity: mobileMode === MobileMode.PREVIEW ? 1 : 0,
                        pointerEvents: mobileMode === MobileMode.PREVIEW ? 'auto' : 'none',
                        willChange: 'opacity'
                      }}
                    >
                      <PreviewPane
                        onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                        isMutatingFiles={isMutatingFiles}
                        isProcessing={isProcessing}
                        showBuildingOverlay={init.ui.showPreviewLoader && viewMode !== ViewMode.BRAND}
                        isHibernated={hibernation.isHibernated}
                        isResuming={hibernation.isResuming}
                        resumeFailed={hibernation.resumeFailed}
                        onRetryResume={() => hibernation.resume()}
                        archiveGatePending={archiveRestore.archiveGatePending}
                        archiveResumeFailed={archiveRestore.archiveRestoreFailed}
                        onRetryArchiveRestore={() => archiveRestore.restoreFromArchive()}
                        showArchiveResumeMessage={
                          archiveRestore.isArchivedForRestore || archiveRestore.isRestoringFromArchive
                        }
                        isImageReloading={imageReadiness.isImageUpdating}
                        imageReloadFailed={!!imageReadiness.error}
                        onRetryImageReload={() => imageReadiness.retry()}
                        isMobile={true}
                        onPublishSnapshot={handlePublishSnapshot}
                        onAskAiroToFix={sendPreviewFixRequest}
                        chatLoadingMessage={chatLoadingMessage}
                      />
                    </div>

                    {/* Chat Tab */}
                    <div
                      className="absolute inset-0 flex flex-col overflow-hidden transition-opacity duration-150"
                      style={{
                        opacity: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.CHAT ? 1 : 0,
                        pointerEvents: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.CHAT ? 'auto' : 'none',
                        willChange: 'opacity'
                      }}
                    >
                      <ChatPane
                        sendMessage={ws.actions.send}
                        stopGeneration={ws.actions.stop}
                        isCreateFlowSession={isCreateFlowSession}
                        hasInitialPrompt={init.context.hasInitialPrompt}
                        isAwaitingStream={isAwaitingStream}
                        initialPromptText={init.context.initialPromptText}
                        loadingMessage={chatLoadingMessage}
                        layout={layout}
                        onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                      />
                    </div>

                    {/* History Tab - Mount on first visit, then CSS-hide to preserve state */}
                    {(optimisticMobileTab === ChatTab.HISTORY || visitedTabs.has(ChatTab.HISTORY)) && (
                      <div
                        className="absolute inset-0 flex flex-col overflow-y-auto transition-opacity duration-150"
                        style={{
                          opacity: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.HISTORY ? 1 : 0,
                          pointerEvents: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.HISTORY ? 'auto' : 'none',
                          willChange: 'opacity'
                        }}
                      >
                        <VersionHistory />
                      </div>
                    )}

                    {/* Media Tab - Mount on first visit, then CSS-hide to preserve state */}
                    {(optimisticMobileTab === ChatTab.MEDIAS || visitedTabs.has(ChatTab.MEDIAS)) && (
                      <div
                        className="absolute inset-0 flex flex-col overflow-hidden transition-opacity duration-150"
                        style={{
                          opacity: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.MEDIAS ? 1 : 0,
                          pointerEvents: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.MEDIAS ? 'auto' : 'none',
                          willChange: 'opacity'
                        }}
                      >
                        <MediaPanel />
                      </div>
                    )}

                    {/* Analytics Tab - Mount on first visit, then CSS-hide to preserve state */}
                    {(optimisticMobileTab === ChatTab.ANALYTICS || visitedTabs.has(ChatTab.ANALYTICS)) && (
                      <div
                        className="absolute inset-0 flex flex-col overflow-y-auto transition-opacity duration-150"
                        style={{
                          opacity: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.ANALYTICS ? 1 : 0,
                          pointerEvents: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.ANALYTICS ? 'auto' : 'none',
                          willChange: 'opacity'
                        }}
                      >
                        <AnalyticsPanel />
                      </div>
                    )}

                    {/* Settings Tab - Mount on first visit, then CSS-hide to preserve state */}
                    {(optimisticMobileTab === ChatTab.SETTINGS || visitedTabs.has(ChatTab.SETTINGS)) && (
                      <div
                        className="absolute inset-0 flex flex-col transition-opacity duration-150"
                        style={{
                          opacity: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.SETTINGS ? 1 : 0,
                          pointerEvents: mobileMode === MobileMode.TOOLS && optimisticMobileTab === ChatTab.SETTINGS ? 'auto' : 'none',
                          willChange: 'opacity'
                        }}
                      >
                        <SettingsView />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            {!hideDevelopChrome && (
              <ChatToolbar
                className="fixed bottom-1 left-0 right-0"
                onBeforeTabChange={setOptimisticMobileTab}
                optimisticActiveTab={optimisticMobileTab}
                onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
              />
            )}
          </div>
        )}
          </>
        )}

        {openFeedbackId === FEEDBACK_ID && (
          <Feedback
            feedbackId={FEEDBACK_ID}
            onClose={closeFeedbackModal}
            onSubmitSuccess={closeFeedbackModal}
            origin={feedbackOrigin || undefined}
            initialStep={feedbackInitialStep ?? undefined}
          />
        )}

        <AppIntroTour
          show={showIntroTour}
          onClose={() => setShowIntroTour(false)}
        />

        {pendingMediaDelete && (
          <MediaDeleteConfirmationModal
            isVideo={pendingMediaDelete.isVideo}
            imageUrl={pendingMediaDelete.imageUrl}
            alt={pendingMediaDelete.alt}
            isDeleting={isDeletingMedia}
            error={mediaDeleteError}
            onCancel={() => {
              setPendingMediaDelete(null)
              setMediaDeleteError(null)
            }}
            onConfirm={async () => {
              setIsDeletingMedia(true)
              setMediaDeleteError(null)
              try {
                await sendElementDelete(pendingMediaDelete)
                setPendingMediaDelete(null)
              } catch (error) {
                logger.error('develop-page.media-delete.error', {
                  appId,
                  error: error instanceof Error ? error.message : String(error),
                })
                setMediaDeleteError(t('builder_media_delete_error', undefined, 'Failed to delete. Please try again.'))
              } finally {
                setIsDeletingMedia(false)
              }
            }}
          />
        )}

        <Growl />

        {isUpgradePolling && <UpgradePollingModal />}
        {isRenewalPolling && <RenewalPollingModal />}

        <ErrorBoundary
          fallback={(error) => (
            <PaywallErrorFallback
              error={error}
              onClose={() => {
                closeUpgradeModal()
                closeCreditsModal()
              }}
              source={upgradeModalSource ?? creditsModalSource ?? 'paywall'}
              component="PaywallErrorBoundary"
            />
          )}
        >
          <UpgradeModal analyticsData={{ appId }} />
          {appId && <DevelopCreditsModal appId={appId} />}
          {appId && <FirstPublishCongratsModal appId={appId} />}
          {appId && <AgentPublishConfirmationModal appId={appId} />}
        </ErrorBoundary>
        <ErrorBoundary fallback={() => null}>
          <CdsEsmPreload />
        </ErrorBoundary>

        {showPublishLimitModal && publishLimitData && appId && (
          <PublishLimitModal
            plan={publishLimitData.plan}
            currentCount={publishLimitData.currentCount}
            limit={publishLimitData.limit}
            publishedApps={publishLimitData.publishedApps}
            onClose={() => {
              setShowPublishLimitModal(appId, false)
              setShowPaywallModal(appId, false)
              shipAnalyticsLog('publish.limit.modal.dismissed', {
                appId,
                plan: publishLimitData.plan,
              })
            }}
            onUpgrade={() => {
              setShowPublishLimitModal(appId, false)
              openUpgradeModal('publish_limit.upgrade_plan', PAYWALL_ITC.UPGRADE)
              shipAnalyticsLog('publish.limit.modal.upgrade_clicked', {
                appId,
                plan: publishLimitData.plan,
              })
            }}
          />
        )}
      </div>
    </ChatProvider>
  )
}

export default function Develop({ layout }: { layout?: BuilderLayout } = {}) {
  return (
    <ProtectedRoute loadingFallback={<DevelopSkeleton isFallback={true} />}>
      <Suspense fallback={<DevelopSkeleton isFallback={true} />}>
        <DevelopPageContent layout={layout} />
      </Suspense>
    </ProtectedRoute>
  );
}

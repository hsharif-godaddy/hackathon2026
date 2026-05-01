'use client'

import { motion } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Growl from '@ux/growl'

import ChatPane from '@/app/[market]/develop/components/chat/ChatPane'
import ChatPaneLoader, { ImageReloadLoaderPhase, ResumeLoaderPhase } from '@/app/[market]/develop/components/chat/ChatPaneLoader'
import ChatToolbar from '@/app/[market]/develop/components/chat/ChatToolbar'
import DevelopSkeleton from '@/app/[market]/develop/components/DevelopSkeleton'
import DevelopHeader from '@/app/[market]/develop/components/layout/Header'
import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { DevelopCreditsModal, PaywallErrorFallback, RenewalPollingModal, UpgradeContainer, UpgradePollingModal } from '@/app/[market]/develop/components/paywall'
import PreviewPane, { type PublishSnapshotRequestDetail } from '@/app/[market]/develop/components/preview/PreviewPane'
import ResizableDivider from '@/app/[market]/develop/components/ResizableDivider'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { ChatTab, IframeMessageType, MobileMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types'
import { extractNewPageRoute, handlePreviewRefresh, navigatePreviewToRoute, requestPreviewScreenshot, useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { clearExpiredWidgetStates } from '@/app/[market]/develop/components/widgets'
import { sendPendingAutoSendMessage } from '@/app/[market]/develop/hooks/sendPendingAutoSendMessage'
import { useChatPaneLoadingState } from '@/app/[market]/develop/hooks/useChatPaneLoadingState'
import { useEvalSnapshotCapture } from '@/app/[market]/develop/hooks/useEvalSnapshotCapture'
import { deriveIsAwaitingStream, useInitialization } from '@/app/[market]/develop/hooks/useInitialization'
import { usePublishSnapshotCapture } from '@/app/[market]/develop/hooks/usePublishSnapshotCapture'
import { broadcast as broadcastProcessingState, handle as handleProcessingState } from '@/app/[market]/develop/utils/iframeProcessingState'
import { ProtectedRoute } from '@/components/auth'
import ErrorBoundary from '@/components/ErrorBoundary'
import { FEEDBACK_ID } from '@/components/feedback/utils'
import { buildDynamicApiUrl, dynamicApiConfigService } from '@/config/dynamic-api'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { useAotPreload } from '@/hooks/useAotPreload'
import { useAppArchiveRestore } from '@/hooks/useAppArchiveRestore'
import { useAppDetails } from '@/hooks/useAppDetails'
import { useAppHibernation } from '@/hooks/useAppHibernation'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useChatTransport } from '@/hooks/useChatTransport'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useHivemind } from '@/hooks/useHivemind'
import { useImageReadiness } from '@/hooks/useImageReadiness'
import { prefetchSubscription } from '@/hooks/useSubscription'
import { useIsRenewalPolling } from '@/hooks/useSubscriptionRenewal'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useSyncResponsiveState } from '@/hooks/useSyncResponsiveState'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsUpgradePolling } from '@/hooks/useUpgradePurchase'
import { useVisitedTabs } from '@/hooks/useVisitedTabs'
import { agentFetch } from '@/lib/agent-fetch'
import { JourneyTracker } from '@/lib/journeyTracker'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { logger } from '@/lib/request-context'
import { claimTodoListHandoff, releaseTodoListHandoff } from '@/lib/todo-list-handoff-dedupe'
import { cn } from '@/lib/utils'
import { appService, gitHistoryFailureHttpStatus } from '@/services/AppService'
import { todoListService } from '@/services/TodoListService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { useSecurityQuickFixHandoffStore } from '@/stores/useSecurityQuickFixHandoffStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { useSiteStore } from '@/stores/useSiteStore'
import {
  useActiveStream,
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
import type { RuntimeErrorData } from '@/types/runtime-error'
import { logAiroHQEvent, logImpressionEvent, setInstrumentationAppId } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'

// Lazy-load features that are conditionally rendered or behind user interaction
const AnalyticsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/Analytics/AnalyticsPanel'), { loading: () => <SettingsLoadingState fullPage /> })
const AppIntroTour = dynamic(() => import('@/app/[market]/develop/components/tour/AppIntroTour').then(m => ({ default: m.AppIntroTour })), { ssr: false })
const AppNotFound = dynamic(() => import('@/app/[market]/develop/components/AppNotFound'))
const MediaPanel = dynamic(() => import('@/app/[market]/develop/components/media/MediaPanel'), { loading: () => <PanelSkeleton panelType={ChatTab.MEDIAS} /> })
const PostPublishGoLiveModal = dynamic(() => import('@/components/layout/PostPublishGoLiveModal'))
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

function DevelopPageContent() {
  const t = useTranslations();
  const searchParams = useSearchParams()
  const todoListIdParam = searchParams.get('todoListId')
  const router = useRouter()
  const appId = useAppIdFromParams()
  const isJobId = searchParams.get('type') === 'job'

  // Only set once the route carries a real app id (job creation URLs use a UUID in :id until replace)
  useLayoutEffect(() => {
    if (appId && !isJobId) {
      setInstrumentationAppId(appId);
    } else {
      setInstrumentationAppId(null);
    }

    return () => {
      setInstrumentationAppId(null);
    };
  }, [appId, isJobId]);

  const queryClient = useQueryClient()
  useEffect(() => {
    prefetchSubscription(queryClient)
  }, [queryClient])

  useAotPreload(aotImports)

  // Unified initialization hook - handles all sequencing and UI state
  const init = useInitialization({ appId, isJobId })

  // Check for venture home logo to airo builder experiment
  const { cohort: ventureHomeLogoCohort } = useHivemind(EXPERIMENT_IDS.ventureHomeLogo);
  const isVentureHomeLogo = ventureHomeLogoCohort === 'on';

  // Default to Brand Book tab for logo-designer template
  const isBrandBookEnabled = useSwitchboard('appbuilder-brandbook');
  useEffect(() => {
    if (init.ui.templateId === 'logo-designer' && (isBrandBookEnabled || isVentureHomeLogo)) {
      useDevelopPageStore.getState().setViewMode(ViewMode.BRAND)
    }
  }, [init.ui.templateId, isBrandBookEnabled, isVentureHomeLogo])

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
  const autoSendInitialMessage = useAutoSendInitialMessage()
  const ws = useChatTransport()
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

  const chatPaneWidth = useDevelopPageStore((state) => state.chatPaneWidth)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const mobileMode = useDevelopPageStore((state) => state.mobileMode)
  const { activeChatTab, setActiveChatTab } = useChatTabs()
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
  const showUpgradeModal = useDevelopPageStore((state) => state.showUpgradeModal);
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal);
  const upgradeModalSource = useDevelopPageStore((state) => state.upgradeModalSource);
  const upgradeModalItc = useDevelopPageStore((state) => state.upgradeModalItc);
  const closeUpgradeModal = useDevelopPageStore((state) => state.closeUpgradeModal);
  const creditsModalSource = useDevelopPageStore((state) => state.creditsModalSource);
  const closeCreditsModal = useDevelopPageStore((state) => state.closeCreditsModal);
  const isUpgradePolling = useIsUpgradePolling();
  const isRenewalPolling = useIsRenewalPolling();
  const publishLimitModalState = useDevelopPageStore((state) =>
    appId ? state.publishStates[appId] : undefined
  );
  const showPublishLimitModal = publishLimitModalState?.showPublishLimitModal ?? false;
  const publishLimitData = publishLimitModalState?.publishLimitData;
  const setShowPublishLimitModal = useDevelopPageStore((state) => state.setShowPublishLimitModal);
  const setShowPaywallModal = useDevelopPageStore((state) => state.setShowPaywallModal);

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
      postMessageToIframe(iframe, { type: enabled ? IframeMessageType.EDIT_MODE_ENABLED : IframeMessageType.EDIT_MODE_DISABLED })
    }
  }, [])

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
    setInputValue(t('builder_develop_fix_runtime_error', undefined, 'Please analyze and fix this runtime error.'))
    scheduleMicrotask(() => {
      void ws.actions.send({
        content: 'Please analyze and fix this runtime error.',
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
  }, [scheduleMicrotask, setInputValue, ws.actions, t])

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
    imageType: string | undefined
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
        useMediaSlotDialogStore.getState().navigateToSlot(result.slotPath)
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

  const sendTextUpdate = useCallback(async (textData: { selector: string; oldText: string; newText: string; devContext: Record<string, unknown> }) => {
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
      const result = await appService.updateText(appId, textData) as { success?: boolean }
      if (result?.success) {
        logger.info('develop-page.text-update.success', { appId })
        if (iframe) postMessageToIframe(iframe, { type: 'TEXT_EDIT_SUCCEEDED' })
      } else {
        logger.error('develop-page.text-update.failed', { appId })
        if (iframe) postMessageToIframe(iframe, { type: 'TEXT_EDIT_FAILED' })
      }
    } catch (error) {
      logger.error('develop-page.text-update.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
      if (iframe) postMessageToIframe(iframe, { type: 'TEXT_EDIT_FAILED' })
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
          JourneyTracker.current()?.trackMilestone('preview_generated', { appId })
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

  // Listen for messages from preview iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Handle messages from iframe or from same window (for websocket events)
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      const isFromIframe = iframe && event.source === iframe.contentWindow
      const isFromSameWindow = event.source === window

      if (!isFromIframe && !isFromSameWindow) return

      switch (event.data.type) {
        case 'TEXT_UPDATED':
          logger.info('develop-page.text-updated-from-iframe', { appId })
          sendTextUpdate(event.data.data)
          break
        case 'EDIT_WITH_AI':
          setAiEditContext(event.data.data)
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT)
          logger.info('develop-page.ai-edit-requested', { appId })
          break
        case 'CLEAR_AI_EDIT_CONTEXT':
          setAiEditContext(null)
          break
        case 'REPLACE_IMAGE': {
          const replaceImageContext = {
            ...event.data.data,
            isImageReplacement: true
          }

          logger.info('develop-page.image-replace-requested', {
            appId,
            imageType: event.data.data?.imageInfo?.type
          })

          // Set context and open the image manager modal
          setAiEditContext(replaceImageContext)
          setIsAssetManagerOpen(true)
          break
        }
        case 'SCROLL_POSITION_UPDATE': {
          // Handle real-time scroll position updates from iframe and store for restoration
          const newScrollPos = {
            x: event.data.scrollX || 0,
            y: event.data.scrollY || 0
          }
          lastIframeState.current.scrollPosition = newScrollPos
          break
        }
        case 'VISUAL_CONTEXT_RESPONSE':
          // Handle visual context response which includes scroll position
          if (event.data.context && event.data.context.scroll_position) {
            lastIframeState.current.scrollPosition = event.data.context.scroll_position
            lastIframeState.current.url = event.data.context.page
          }
          break
        case 'URL_CHANGE':
          // Handle URL changes in iframe (navigation)
          lastIframeState.current.url = event.data.url
          break
        case 'MESSAGE_COMPLETE': {
          // Capture message data now so the microtask uses a stable snapshot
          // rather than reading store state that could shift before it runs.
          const { messages: completedMessages } = useStreamingConversationStore.getState()
          const completedMessage = completedMessages[completedMessages.length - 1]
          const toolCallsAtCompletion = completedMessage?.role === 'assistant'
            ? (completedMessage.toolCalls ?? [])
            : []

          scheduleMicrotask(() => {
            const newPageRoute = toolCallsAtCompletion.length
              ? extractNewPageRoute(toolCallsAtCompletion)
              : null

            if (newPageRoute) {
              logger.info('develop-page.preview.navigate-to-new-page', { appId, route: newPageRoute })
              lastIframeState.current.url = newPageRoute
              lastIframeState.current.scrollPosition = { x: 0, y: 0 }
              requestPreviewScreenshot()
              navigatePreviewToRoute(newPageRoute)
            } else {
              handlePreviewRefresh({ lastIframeState })
            }
          })
          break
        }
        case 'error-fix-request': {
          // Auto-sent by AiroErrorBoundary on every caught error. Purely
          // informational: we forward the payload to the agents' runtime-
          // error buffer so the post-stream validator can pick it up on
          // the next turn. The overlay itself is owned by the iframe.
          if (!event.data.errorData) break
          const errorData = event.data.errorData as RuntimeErrorData
          logger.info('develop-page.error-fix-request', {
            appId,
            errorName: errorData.name,
            errorMessage: errorData.message,
            hasStack: !!errorData.stack,
            hasComponentStack: !!errorData.componentStack,
            cycleId: errorData.cycleId
          })
          // Fire-and-forget: a dropped POST just means the next turn won't
          // auto-continue on this error; the user can still click "Ask
          // Airo to Fix" on the iframe overlay.
          void (async () => {
            try {
              const url = await buildDynamicApiUrl('runtime-errors', appId)
              await agentFetch(url, {
                method: 'POST',
                siteId: appId,
                body: JSON.stringify(errorData)
              })
            } catch (err) {
              logger.warn('develop-page.runtime-error.forward.failed', {
                appId,
                error: err instanceof Error ? err.message : String(err)
              })
            }
          })()
          break
        }
        case 'error-platform-report': {
          // Sent by AiroErrorBoundary when an error originated inside
          // dev-tools platform code (top stack frame in /dev-tools/src|dist/).
          // The overlay is suppressed iframe-side for these because the
          // agent can't edit platform files. We log for Loki visibility
          // but do NOT forward to the runtime-error buffer — otherwise
          // the post-stream validator would hand the agent an error it
          // cannot fix, wasting turns.
          const raw = event.data.errorData as Partial<RuntimeErrorData> | undefined
          if (!raw || typeof raw.message !== 'string' || typeof raw.name !== 'string') {
            // Don't log the raw payload — it comes from the iframe and
            // can carry large stack strings or PII-bearing error
            // messages. Log a safe summary so regressions in the
            // sender are still diagnosable.
            logger.warn('develop-page.error-platform-report.malformed', {
              appId,
              receivedType: typeof raw,
              receivedKeys: raw && typeof raw === 'object' ? Object.keys(raw as object).join(',') : undefined
            })
            break
          }
          logger.warn('develop-page.error-platform-report', {
            appId,
            errorName: raw.name,
            errorMessage: raw.message,
            hasStack: !!raw.stack,
            hasComponentStack: !!raw.componentStack,
            cycleId: raw.cycleId
          })
          break
        }
        case 'runtime-errors-cycle': {
          // Auto-sent by the iframe's dev-tools client on every Vite HMR
          // boundary and on module init. Announces that the preview has
          // entered a new render generation; forward it to the server
          // so the runtime-error buffer can evict entries from the
          // superseded generation. This is the core defense against
          // the "mid-turn transient error becomes a ghost" class of
          // bug — see `agents/src/services/runtime-error-buffer.ts`.
          const rawCycleId = (event.data as { cycleId?: unknown }).cycleId
          if (typeof rawCycleId !== 'number' || !Number.isFinite(rawCycleId)) break
          const cycleId = rawCycleId
          void (async () => {
            try {
              const url = await buildDynamicApiUrl('runtime-errors/cycle', appId)
              await agentFetch(url, {
                method: 'POST',
                siteId: appId,
                body: JSON.stringify({ cycleId })
              })
            } catch (err) {
              // Fire-and-forget: a dropped cycle POST means the buffer
              // may briefly retain entries from a prior render. The
              // next successful cycle POST (on the next HMR) evicts
              // them.
              logger.warn('develop-page.runtime-errors-cycle.forward.failed', {
                appId,
                cycleId,
                error: err instanceof Error ? err.message : String(err)
              })
            }
          })()
          break
        }
        case 'error-fix-user-requested': {
          if (!event.data.errorData) break
          // The iframe overlay hides its button while the agent is
          // processing, but a slow `AGENT_PROCESSING_STATE` broadcast
          // could let a stray click through. Drop it rather than kicking
          // off a concurrent chat send that would collide with the
          // in-flight stream.
          if (isProcessingRef.current) {
            logger.info('develop-page.error-fix-user-requested.skipped-processing', { appId })
            break
          }
          const errorData = event.data.errorData as RuntimeErrorData
          logger.info('develop-page.error-fix-user-requested', {
            appId,
            errorName: errorData.name,
            errorMessage: errorData.message,
          })
          sendUserRequestedFix(errorData)
          break
        }
        case 'request-processing-state':
          handleProcessingState('request-processing-state', iframe, isProcessingRef.current)
          break
        case 'build-page-request':
          if (isProcessingRef.current) {
            logger.info('develop-page.build-page-request.skipped-processing', { appId })
            handleProcessingState('build-page-request', iframe, true)
            break
          }
          if (event.data.pathToBuild) {
            logger.info('develop-page.build-page-request', {
              appId,
              pathToBuild: event.data.pathToBuild
            })
            const messageContent = `The page at path ${event.data.pathToBuild} doesn't exist yet, please build it with appropriate content.`;
            setInputValue(messageContent);
            scheduleMicrotask(() => {
              void ws.actions.send({
                content: messageContent,
                aiEditContext: null
              })
            })
          }
          break
        case 'build-error-fix-request':
          if (isProcessingRef.current) {
            logger.info('develop-page.build-error-fix-request.skipped-processing', { appId })
            break
          }
          // Handle build error fix requests from the publish alert
          if (event.data.errorMessage && event.data.errorDetails) {
            logger.info('develop-page.build-error-fix-request', {
              appId,
              errorMessage: event.data.errorMessage,
              hasDetails: !!event.data.errorDetails,
              exitCode: event.data.exitCode,
            })

            const messageContent = 'Please analyze and fix this publish failure.';
            setInputValue(messageContent);
            // Pass build error data directly via customContext (same pattern as runtime error handler)
            scheduleMicrotask(() => {
              void ws.actions.send({
                content: messageContent,
                aiEditContext: null,
                isActionRequest: false,
                customContext: {
                  type: 'build_error',
                  data: {
                    error: event.data.errorMessage,
                    details: event.data.errorDetails,
                    exitCode: event.data.exitCode
                  },
                  persistence: 'ephemeral',
                  source: 'publish-failure'
                }
              })
            })
          }
          break
        case 'SCREENSHOT_RESPONSE':
          // Handle screenshot response from iframe
          if (event.data.screenshot) {
            handleScreenshotUpload(event.data.screenshot)
          }
          break
        case 'VIEWPORT_SCREENSHOT_RESPONSE':
          if (pendingPublishSnapshotRef.current) {
            // PreviewPane handles the publish path; reset boolean via microtask
            // so this handler's guard fires before the reset settles.
            void Promise.resolve().then(() => { pendingPublishSnapshotRef.current = false })
          } else if (event.data.screenshot) {
            handleEvalViewportScreenshot(event.data.screenshot)
          }
          break
        case 'OPEN_MEDIA_SLOT_DIALOG':
          // Navigate the Media tab panel to the requested slot
          if (event.data.slotName && appId) {
            useMediaSlotDialogStore.getState().navigateToSlot(event.data.slotName)
            const develop = useDevelopPageStore.getState()
            develop.setActiveChatTab(ChatTab.MEDIAS)
            if (develop.isMobile) {
              develop.handleMobileModeChange(MobileMode.TOOLS)
            }
          }
          break
        case 'OPEN_IMAGE_EDITOR':
          // Navigate the Media tab panel to the requested slot and open image editor
          if (event.data.slotName && appId) {
            useMediaSlotDialogStore.getState().navigateToSlot(event.data.slotName, { openEditor: true })
            const develop = useDevelopPageStore.getState()
            develop.setActiveChatTab(ChatTab.MEDIAS)
            if (develop.isMobile) {
              develop.handleMobileModeChange(MobileMode.TOOLS)
            }
          }
          break
        case 'IFRAME_READY':
          sendEditModeMessage(isEditModeEnabled)
          break
        case 'AUTO_IMPORT_MEDIA_SLOT': {
          const { imageUrl, devContext, imageAlt, imageType } = event.data
          if (!imageUrl || !appId) break
          void handleAutoImportMediaSlot(imageUrl, devContext, imageAlt, imageType)
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [sendTextUpdate, setAiEditContext, ws.actions.send, setInputValue, handleScreenshotUpload, handleEvalViewportScreenshot, setIsAssetManagerOpen, appId, scheduleMicrotask, sendEditModeMessage, isEditModeEnabled, handleAutoImportMediaSlot, sendUserRequestedFix])
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
      const wasTriggered = autoSendInitialMessage(init.ui.autoSendPromptText, appId)

      if (wasTriggered) {
        pendingAutoSendRef.current = init.ui.autoSendPromptText
        setIsCreateFlowSession(true)
        logger.info('develop-page.auto-send.triggered', {
          message: 'Auto-sending initial message for new app',
          appId,
          promptPreview: init.ui.autoSendPromptText.substring(0, 50) + '...'
        })

        // Funnel event: Initial prompt sent from client - correlate with APM using appId
        shipAnalyticsLog('funnel.initial_prompt.sent', {
          appId,
          promptLength: init.ui.autoSendPromptText.length,
        })

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
        templateId: init.ui.templateId ?? null,
        send: ws.actions.send,
        setInputValue,
        markInitialPromptSent: init.actions.markInitialPromptSent,
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
    searchParams,
    autoSendInitialMessage,
    ws.actions.send,
    appId,
    init.actions,
    ws.connection.isConnected,
    messages.length,
    setInputValue,
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
    if (!appId || !init.isReady) return

    // Trigger tour when we have at least one message and no active stream
    if (messages.length > 0 && !activeStream) {
      checkAndTriggerIntroTour()
    }
  }, [appId, init.isReady, messages.length, activeStream, checkAndTriggerIntroTour])

  if (init.siteNotFound) {
    return (
      <div className="h-screen flex flex-col">
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
    <WebSocketProvider sendMessage={ws.actions.send} loadHistory={ws.actions.loadHistory}>
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
        <DevelopHeader onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })} />

        {/* Desktop Layout */}
        {!isMobile && (
          <div className="relative h-full w-full overflow-hidden">
            {/* Sidebar (Chat, History, Settings menu) */}
            <motion.div
              className="absolute top-0 start-0 bottom-0 isolate"
              animate={{
                x: isChatPaneCollapsed
                  ? (isLayoutRtl ? chatPaneWidth + 16 : -(chatPaneWidth + 16))
                  : 0,
                width: chatPaneWidth
              }}
              transition={{
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1]
              }}
              style={{
                pointerEvents: isChatPaneCollapsed ? 'none' : 'auto'
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
              />
            </motion.div>

            {/* Resizable Divider */}
            {!isChatPaneCollapsed && (
              <ResizableDivider
                onResize={handlePanelResize}
                minLeftWidth={300}
                minRightWidth={Math.max(600, typeof window !== 'undefined' ? window.innerWidth * 0.5 : 600)}
                style={{
                  insetInlineStart: `${chatPaneWidth + 10}px`
                }}
              />
            )}

            {/* Content (Preview, Settings, Code) */}
            <motion.div
              className="absolute top-0 end-0 bottom-0 flex flex-col"
              initial={false}
              animate={{
                insetInlineStart: isChatPaneCollapsed ? 8 : chatPaneWidth + 16
              }}
              transition={{
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1]
              }}
            >
              <PostPublishGoLiveModal appId={appId} />

              {/* Content area - takes remaining space after banner */}
              <div className="flex-1 relative min-h-0">
                {/* Preview/Code View */}
                <div
                  id="preview-pane-container"
                  className="absolute inset-0 flex flex-col isolate"
                >
                  <PreviewPane
                    onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                    showBuildingOverlay={init.ui.showPreviewLoader}
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
                  />
                </div>
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
                  <PostPublishGoLiveModal appId={appId} />

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
                        showBuildingOverlay={init.ui.showPreviewLoader}
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
            <ChatToolbar
              className="fixed bottom-1 left-0 right-0"
              onBeforeTabChange={setOptimisticMobileTab}
              optimisticActiveTab={optimisticMobileTab}
              onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
            />
          </div>
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
          {showUpgradeModal && (
            <UpgradeContainer
              source={upgradeModalSource ?? 'unknown'}
              itc={upgradeModalItc ?? undefined}
              onSuccessClick={closeUpgradeModal}
              onClose={() => {
                const source = upgradeModalSource ?? 'unknown'
                closeUpgradeModal()
                shipAnalyticsLog(`${source}.dismissed`, { appId })
              }}
              onErrorClick={() => {
                const source = upgradeModalSource ?? 'unknown'
                closeUpgradeModal()
                shipAnalyticsLog(`${source}.error`, { appId })
              }}
            />
          )}

          {appId && <DevelopCreditsModal appId={appId} />}
          {appId && <FirstPublishCongratsModal appId={appId} />}
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
    </WebSocketProvider>
  )
}

export default function Develop() {
  return (
    <ProtectedRoute loadingFallback={<DevelopSkeleton isFallback={true} />}>
      <Suspense fallback={<DevelopSkeleton isFallback={true} />}>
        <DevelopPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}

'use client'

import clsx from 'clsx'
import { animate, AnimatePresence, motion, useMotionValue } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIntl } from 'react-intl'
import { Loader } from '@airo-ux/loader'
import Button from '@ux/button'

import { useLatestNBAs } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import DomainBar from '@/app/[market]/develop/components/layout/DomainBar'
import BrandBookView from '@/app/[market]/develop/components/preview/brand-book'
import { getDevicePreset } from '@/app/[market]/develop/components/preview/devicePresets'
import PreviewCode from '@/app/[market]/develop/components/preview/PreviewCode'
import PreviewError from '@/app/[market]/develop/components/preview/PreviewError'
import PreviewLoadingState from '@/app/[market]/develop/components/preview/PreviewLoadingState'
import PreviewSkeleton from '@/app/[market]/develop/components/preview/PreviewSkeleton'
import StatusPill from '@/app/[market]/develop/components/preview/StatusPill'
import ThinkingIndicator from '@/app/[market]/develop/components/ThinkingIndicator'
import Tips from '@/app/[market]/develop/components/tips/Tips'
import { MobileMode, PreviewViewMode, ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import ErrorBoundary from '@/components/ErrorBoundary'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { COHORT_OFF, COHORT_ON, EXPERIMENT_IDS, INELIGIBLE_COHORT } from '@/config/experiments'
import { isInitialBuildComplete, isInitialBuildFunnelActive } from '@/hooks/shared/initialBuildFunnel'
import { useHivemind } from '@/hooks/useHivemind'
import { useImpression } from '@/hooks/useImpression'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { postMessageToIframe } from '@/utils/postMessage'

const DomainPanel = dynamic(
  () => import('@/app/[market]/develop/components/settings/DomainPanel'),
  { ssr: false, loading: () => <PreviewSkeleton testId="domain-panel-skeleton" /> },
)

// Timing constants for iframe lifecycle management
const REFRESH_DEBOUNCE_MS = 500 // Debounce rapid refresh requests
const PROCESSING_OVERLAY_FALLBACK_MS = 3000
const STATE_RESTORE_FALLBACK_MS = 3000 // Fallback timeout if iframe doesn't send ready signal
const SCROLL_LISTENER_OPTIONS = { capture: true, passive: true } as const
/** Eval snapshot: IFRAME_READY means the iframe has registered its message listener; HMR-only builds use fallback */
const EVAL_SNAPSHOT_IFRAME_FALLBACK_MS = 8000
// Bootstrap-race recovery (Layer 3): if the iframe doesn't post
// IFRAME_READY within this window after the server is ready, force a
// re-mount with a fresh `key`. Capped at MAX_IFRAME_BOOTSTRAP_RETRIES
// to avoid an infinite loop on permanent failures (e.g. third-party
// cookie blocking with no share-token fallback).
const IFRAME_BOOTSTRAP_RETRY_MS = 3000
const MAX_IFRAME_BOOTSTRAP_RETRIES = 3

/**
 * Restore iframe state (URL and scroll position) via postMessage.
 * The preview iframe is always cross-origin, so direct contentWindow access is not possible.
 *
 * @param iframe - The iframe element to restore state on
 * @param state - The state to restore containing url and scrollPosition
 */
export function restoreIframeState(
  iframe: HTMLIFrameElement,
  state: { url?: string; scrollPosition?: { x: number; y: number } }
) {
  if (!state.url && !state.scrollPosition) {
    return
  }

  try {
    postMessageToIframe(iframe, {
      type: 'RESTORE_STATE_AFTER_REFRESH',
      url: state.url,
      scrollPosition: state.scrollPosition
    })
  } catch (error) {
    logger.error('preview-pane.state-restore.failure', {
      message: 'Failed to restore state',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export interface PublishSnapshotRequestDetail {
  appId: string
  deploymentId: string | undefined
  commitHash: string
}

interface PreviewPaneProps {
  onPreviewRefresh: () => void
  isMobile?: boolean
  isMutatingFiles?: boolean
  isProcessing?: boolean
  showBuildingOverlay?: boolean
  isCreationFlow?: boolean
  isHibernated?: boolean
  isResuming?: boolean
  resumeFailed?: boolean
  onRetryResume?: () => void
  archiveGatePending?: boolean
  archiveResumeFailed?: boolean
  onRetryArchiveRestore?: () => void
  showArchiveResumeMessage?: boolean
  isImageReloading?: boolean
  imageReloadFailed?: boolean
  onRetryImageReload?: () => void
  onPublishSnapshot?: (screenshotDataUrl: string, detail: PublishSnapshotRequestDetail) => void
  onAskAiroToFix?: () => void
}

export default function PreviewPane({
  onPreviewRefresh,
  isMobile = false,
  isMutatingFiles = false,
  isProcessing = false,
  showBuildingOverlay = false,
  isCreationFlow = false,
  isHibernated = false,
  isResuming = false,
  resumeFailed = false,
  onRetryResume,
  archiveGatePending = false,
  archiveResumeFailed = false,
  onRetryArchiveRestore,
  showArchiveResumeMessage = false,
  isImageReloading = false,
  imageReloadFailed = false,
  onRetryImageReload,
  onPublishSnapshot,
  onAskAiroToFix,
}: PreviewPaneProps) {
  const t = useTranslations();
  const intl = useIntl();
  const isDomainBarEnabled = useSwitchboard('appbuilder-domain-bar');
  const isTopLevelDomainEnabled = useSwitchboard('appbuilder-domain-top-level');
  /** Switchboard: translucent creation overlay + edit chip behavior. */
  const isPreviewEnhancedOverlaysEnabled =
    useSwitchboard('appbuilder-preview-enhanced-overlays') === true;
  const isBuildOverlayQuestionMessageEnabled =
    useSwitchboard('appbuilder-build-overlay-question-message') === true;
  const { cohort: buildOverlayCohort } = useHivemind(EXPERIMENT_IDS.buildOverlayQuestion);

  const latestNBA = useLatestNBAs();
  const isAwaitingAskQuestion =
    isBuildOverlayQuestionMessageEnabled && buildOverlayCohort === COHORT_ON && latestNBA?.source === 'askQuestion';

  const isExposureEligible =
    isBuildOverlayQuestionMessageEnabled &&
    (buildOverlayCohort === COHORT_ON || buildOverlayCohort === COHORT_OFF) &&
    latestNBA?.source === 'askQuestion';

  // Funnel state is non-reactive (module-level); latestNBA re-renders ensure freshness here.
  useImpression('develop.initialBuild.overlayQuestion', {
    enabled: isExposureEligible && isInitialBuildFunnelActive() && !isInitialBuildComplete(),
    customProperties: { cohort: buildOverlayCohort ?? INELIGIBLE_COHORT },
  });

  const getServerState = useServerPollingStore((state) => state.getServerState)
  const isPollingServer = useServerPollingStore((state) => state.isPollingServer)
  const startPollingForServer = useServerPollingStore((state) => state.startPollingForServer)
  const stopPollingForServer = useServerPollingStore((state) => state.stopPollingForServer)

  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const selectedDeviceId = useDevelopPageStore((state) => state.selectedDeviceId)
  const setPreviewViewMode = useDevelopPageStore((state) => state.setPreviewViewMode)
  const mobileMode = useDevelopPageStore((state) => state.mobileMode)
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange)
  // Get device dimensions from preset
  const selectedDevice = getDevicePreset(selectedDeviceId)
  const isFullSize = previewViewMode === PreviewViewMode.DESKTOP || selectedDeviceId === 'full'
  const deviceWidth = selectedDevice?.width || 0
  const deviceHeight = selectedDevice?.height || 0

  // Calculate vertical margin based on device height (shorter devices get more margin)
  // Range: 4px (my-1) for tallest (1366px) to 24px (my-6) for shortest (667px)
  const minHeight = 667
  const maxHeight = 1366
  const minMargin = 4
  const maxMargin = 32
  const clampedHeight = Math.max(minHeight, Math.min(maxHeight, deviceHeight))
  const deviceVerticalMargin = Math.round(
    maxMargin - ((clampedHeight - minHeight) / (maxHeight - minHeight)) * (maxMargin - minMargin)
  )

  const appId = useAppIdFromParams()

  useEffect(() => {
    if (isMobile) {
      setPreviewViewMode(PreviewViewMode.MOBILE)
    } else {
      setPreviewViewMode(PreviewViewMode.DESKTOP)
    }
  }, [isMobile, setPreviewViewMode])

  const serverState = getServerState(appId)
  const previewUrl = serverState?.isReady ? serverState.url : null

  // Iframe state
  const [iframeError, setIframeError] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  // Bootstrap-race recovery: tracks whether the iframe has signalled
  // IFRAME_READY (which only fires when the preview app's own script
  // loads — NOT when the iframe was 307'd to the builder or blocked by
  // frame-ancestors CSP). If the signal doesn't arrive within
  // IFRAME_BOOTSTRAP_RETRY_MS, bump iframeKey to force a re-mount; by
  // then the bootstrap retry in useServerPollingStore should have
  // settled and the new mount picks up the cookie.
  const [iframeBootstrapped, setIframeBootstrapped] = useState(false)
  // Separate auto-retry counter so manual retries (handleManualRetry)
  // don't exhaust the auto-retry budget — the manual retry resets this
  // and gives the user another 3 auto-attempts.
  const [bootstrapRetryCount, setBootstrapRetryCount] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewShellRef = useRef<HTMLDivElement>(null)

  // State preservation for iframe navigation and scroll position
  const [pendingStateRestore, setPendingStateRestore] = useState<{
    url?: string
    scrollPosition?: { x: number; y: number }
  } | null>(null)
  const [isWaitingForIframeReady, setIsWaitingForIframeReady] = useState(false)

  // Track fallback timer to ensure proper cleanup (from PR #1054)
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null)
  // Use ref for isWaitingForIframeReady to avoid stale closures in timeout
  const isWaitingForIframeReadyRef = useRef(false)
  // Use ref for attemptStateRestoration to avoid circular dependency
  const attemptStateRestorationRef = useRef<(() => void) | null>(null)

  // Track message handler timers for proper cleanup (from PR #1056)
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)
  const processingOverlayFallbackTimerRef = useRef<NodeJS.Timeout | null>(null)
  const scrollRestoreTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingEvalFullHeightRef = useRef(false)
  const evalFullHeightFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showProcessingOverlay, setShowProcessingOverlay] = useState(false)
  const [editingChipPosition, setEditingChipPosition] = useState<{
    left: number
    top: number
  } | null>(null)
  const [isPortalReady, setIsPortalReady] = useState(false)
  const prevIsProcessingRef = useRef(isProcessing)
  const prevIsMutatingFilesRef = useRef(isMutatingFiles)
  const processingOverlayHydratedRef = useRef(false)
  const dismissProcessingOverlayRef = useRef(() => {})

  const dismissProcessingOverlay = useCallback(function dismissProcessingOverlay() {
    setShowProcessingOverlay(false)
    if (processingOverlayFallbackTimerRef.current !== null) {
      clearTimeout(processingOverlayFallbackTimerRef.current)
      processingOverlayFallbackTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    dismissProcessingOverlayRef.current = dismissProcessingOverlay
  }, [dismissProcessingOverlay])

  useEffect(() => {
    if (typeof document === 'undefined') return
    setIsPortalReady(true)
  }, [])

  const updateEditingChipPosition = useCallback(function updateEditingChipPosition() {
    if (!previewShellRef.current) {
      setEditingChipPosition(null)
      return
    }

    const { left, width, bottom } = previewShellRef.current.getBoundingClientRect()
    setEditingChipPosition({
      top: bottom - 64,
      left: left + (width / 2),
    })
  }, [])

  useEffect(() => {
    const shouldTrackEditingChipPosition = Boolean(
      !isMobile &&
      isPortalReady &&
      isPreviewEnhancedOverlaysEnabled &&
      showProcessingOverlay &&
      !showBuildingOverlay
    )

    if (!shouldTrackEditingChipPosition) {
      setEditingChipPosition(null)
      return
    }

    updateEditingChipPosition()

    if (!previewShellRef.current) return
    const resizeObserver = new ResizeObserver(function handleResize() {
      updateEditingChipPosition()
    })
    resizeObserver.observe(previewShellRef.current)

    function handleWindowResize() {
      updateEditingChipPosition()
    }

    function handleWindowScroll() {
      updateEditingChipPosition()
    }

    window.addEventListener('resize', handleWindowResize)
    window.addEventListener('scroll', handleWindowScroll, SCROLL_LISTENER_OPTIONS)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleWindowResize)
      window.removeEventListener('scroll', handleWindowScroll, SCROLL_LISTENER_OPTIONS)
    }
  }, [
    isPortalReady,
    isMobile,
    isPreviewEnhancedOverlaysEnabled,
    showBuildingOverlay,
    showProcessingOverlay,
    updateEditingChipPosition,
  ])

  // Track previous viewMode to determine animation direction
  const previousViewModeRef = useRef<ViewMode>(viewMode)

  // Motion values for smooth animation control
  const previewOpacity = useMotionValue(1)
  const codeOpacity = useMotionValue(0)

  // Animate fade based on viewMode transition
  useEffect(() => {
    const previous = previousViewModeRef.current
    const current = viewMode

    if (previous === current) return

    // Brand uses an overlay (server ready) or early return (not ready) -- snap opacities
    if (current === ViewMode.BRAND || previous === ViewMode.BRAND) {
      previewOpacity.set(current !== ViewMode.CODE && current !== ViewMode.BRAND ? 1 : 0)
      codeOpacity.set(current === ViewMode.CODE ? 1 : 0)
      previousViewModeRef.current = current
      return
    }

    // Skip animation on mobile for better performance and UX
    if (isMobile) {
      if (current === ViewMode.CODE) {
        previewOpacity.set(0)
        codeOpacity.set(1)
      } else {
        previewOpacity.set(1)
        codeOpacity.set(0)
      }
      previousViewModeRef.current = current
      return
    }

    if (current === ViewMode.CODE) {
      animate(previewOpacity, 0, { duration: 0.25, ease: [0.4, 0, 0.2, 1] })
      animate(codeOpacity, 1, { duration: 0.3, ease: [0.4, 0, 0.2, 1], delay: 0.15 })
    } else {
      animate(codeOpacity, 0, { duration: 0.25, ease: [0.4, 0, 0.2, 1] })
      animate(previewOpacity, 1, { duration: 0.3, ease: [0.4, 0, 0.2, 1], delay: 0.15 })
    }

    previousViewModeRef.current = current
  }, [viewMode, previewOpacity, codeOpacity, isMobile])

  // Sync ref with state to avoid stale closures
  useEffect(() => {
    isWaitingForIframeReadyRef.current = isWaitingForIframeReady
  }, [isWaitingForIframeReady])

  useEffect(() => {
    if (showBuildingOverlay) {
      dismissProcessingOverlayRef.current()
    }
  }, [showBuildingOverlay])

  useEffect(() => {
    if (!processingOverlayHydratedRef.current) {
      processingOverlayHydratedRef.current = true
      prevIsProcessingRef.current = isProcessing
      prevIsMutatingFilesRef.current = isMutatingFiles

      // Activate immediately if mounting into an active mutation state
      if (isProcessing && isMutatingFiles && !showBuildingOverlay && isPreviewEnhancedOverlaysEnabled) {
        setShowProcessingOverlay(true)
      }
      return
    }

    const prevP = prevIsProcessingRef.current
    const prevM = prevIsMutatingFilesRef.current

    if (!showBuildingOverlay && isPreviewEnhancedOverlaysEnabled) {
      const processingBecameTrue = !prevP && isProcessing
      const mutatingBecameTrue = !prevM && isMutatingFiles
      // 1) processing false → true while mutating already true
      const activateOnProcessingWhileMutating =
        processingBecameTrue && isMutatingFiles && prevM
      // 2) mutating false → true while processing already true
      const activateOnMutatingWhileProcessing =
        mutatingBecameTrue && isProcessing && prevP
      // Same tick: both became true (prevP and prevM were false)
      const activateOnBothBecameTrue = processingBecameTrue && mutatingBecameTrue

      const shouldActivate =
        isProcessing &&
        isMutatingFiles &&
        (activateOnProcessingWhileMutating ||
          activateOnMutatingWhileProcessing ||
          activateOnBothBecameTrue)

      if (shouldActivate) {
        setShowProcessingOverlay(true)
      }
    }

    prevIsProcessingRef.current = isProcessing
    prevIsMutatingFilesRef.current = isMutatingFiles
  }, [isProcessing, isMutatingFiles, showBuildingOverlay, isPreviewEnhancedOverlaysEnabled])

  useEffect(() => {
    if (!isPreviewEnhancedOverlaysEnabled) {
      return
    }
    if (isProcessing) {
      if (processingOverlayFallbackTimerRef.current !== null) {
        clearTimeout(processingOverlayFallbackTimerRef.current)
        processingOverlayFallbackTimerRef.current = null
      }
      return
    }
    if (!showProcessingOverlay) return

    processingOverlayFallbackTimerRef.current = setTimeout(function processingOverlayFallback() {
      processingOverlayFallbackTimerRef.current = null
      setShowProcessingOverlay(false)
    }, PROCESSING_OVERLAY_FALLBACK_MS)

    return () => {
      if (processingOverlayFallbackTimerRef.current !== null) {
        clearTimeout(processingOverlayFallbackTimerRef.current)
        processingOverlayFallbackTimerRef.current = null
      }
    }
  }, [isProcessing, showProcessingOverlay, isPreviewEnhancedOverlaysEnabled])

  useEffect(() => {
    if (!isPreviewEnhancedOverlaysEnabled) {
      dismissProcessingOverlayRef.current()
    }
  }, [isPreviewEnhancedOverlaysEnabled])

  // Cleanup fallback timer on unmount
  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current)
        fallbackTimerRef.current = null
      }
      if (processingOverlayFallbackTimerRef.current !== null) {
        clearTimeout(processingOverlayFallbackTimerRef.current)
        processingOverlayFallbackTimerRef.current = null
      }
    }
  }, [])

  // Server polling lifecycle - PreviewPane owns its server state.
  // The store prevents duplicate polling if multiple components try to poll
  // the same appId.
  //
  // Gate: skip polling while the image is reloading. During an on-demand
  // image upgrade, two containers serve simultaneously for ~30-90s — the
  // OLD one being torn down and the NEW one starting up. Bootstrapping
  // during this window can hit the OLD container's binary, which may
  // lack the cookie-setting code path that the NEW container has, leaving
  // the user with no `preview_auth` cookie and a 307'd iframe. By gating
  // on isImageReloading, polling only fires once the cutover is complete
  // and all requests route to the new container. useImageReadiness owns
  // the orchestration during the reload window.
  useEffect(() => {
    if (!appId) return
    if (isImageReloading) return

    startPollingForServer(appId)

    return () => {
      stopPollingForServer(appId)
    }
  }, [appId, isImageReloading, startPollingForServer, stopPollingForServer])

  // Track if we've already requested a screenshot for this app
  const screenshotRequestedRef = useRef<string | null>(null)

  // Request screenshot capture from iframe if no screenshot exists
  const requestScreenshotIfMissing = useCallback(async () => {
    if (!appId || screenshotRequestedRef.current === appId) return

    try {
      const apiUrl = await buildDynamicApiUrl('screenshot', appId)
      const response = await agentFetch(apiUrl, { method: 'GET', siteId: appId })

      if (response.status === 404 && iframeRef.current?.contentWindow) {
        screenshotRequestedRef.current = appId
        logger.info('preview-pane.screenshot.requesting', { appId })
        postMessageToIframe(iframeRef.current, { type: 'REQUEST_SCREENSHOT' })
      }
    } catch (error) {
      logger.warn('preview-pane.screenshot.request.error', { message: 'Failed to request screenshot', error: error instanceof Error ? error.message : String(error) })
    }
  }, [appId])

  // Handle iframe load and restore scroll position if pending
  const handleIframeLoad = useCallback(() => {
    setIframeError(false)

    // Check if screenshot exists and request one if missing
    requestScreenshotIfMissing()

    // Clear any existing fallback timer before starting a new one
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }

    // Check if we have scroll position to restore and URL matches
    if (pendingStateRestore?.scrollPosition && iframeRef.current) {
      // Check if the current iframe URL matches the saved URL
      try {
        const currentUrl = new URL(iframeRef.current.src)
        const savedUrl = pendingStateRestore.url ? new URL(pendingStateRestore.url) : null

        // Only restore if URLs match (same pathname and search params)
        if (savedUrl && currentUrl.pathname === savedUrl.pathname && currentUrl.search === savedUrl.search) {
          // Set waiting state and start fallback timer
          setIsWaitingForIframeReady(true)

          // Fallback timeout in case iframe doesn't send ready signal
          fallbackTimerRef.current = setTimeout(() => {
            if (isWaitingForIframeReadyRef.current && attemptStateRestorationRef.current) {
              logger.warn('preview-pane.iframe.timeout', { message: 'Iframe ready timeout, attempting state restoration anyway' })
              attemptStateRestorationRef.current()
            }
            fallbackTimerRef.current = null
          }, STATE_RESTORE_FALLBACK_MS)
        } else {
          logger.debug('preview-pane.state-restore.url-mismatch', { message: 'URL mismatch, clearing pending state restoration' })
          setPendingStateRestore(null)
        }
      } catch (error) {
        logger.warn('preview-pane.state-restore.parse-error', { message: 'Failed to parse URLs for state restoration', error: error instanceof Error ? error.message : String(error) })
        setPendingStateRestore(null)
      }
    }
  }, [pendingStateRestore, requestScreenshotIfMissing]) // attemptStateRestoration removed to avoid circular dependency

  // Attempt to restore iframe state (scroll position, etc.)
  const attemptStateRestoration = useCallback(() => {
    if (!pendingStateRestore?.scrollPosition || !iframeRef.current) return

    // Double-check URL match before restoration
    try {
      const currentUrl = new URL(iframeRef.current.src)
      const savedUrl = pendingStateRestore.url ? new URL(pendingStateRestore.url) : null

      if (!savedUrl || currentUrl.pathname !== savedUrl.pathname || currentUrl.search !== savedUrl.search) {
        logger.debug('preview-pane.state-restore.abort', { message: 'URL mismatch during restoration, aborting' })
        setPendingStateRestore(null)
        setIsWaitingForIframeReady(false)
        return
      }
    } catch (error) {
      logger.warn('preview-pane.state-restore.validation-error', { message: 'Failed to validate URLs during restoration', error: error instanceof Error ? error.message : String(error) })
      setPendingStateRestore(null)
      setIsWaitingForIframeReady(false)
      return
    }

    restoreIframeState(iframeRef.current, pendingStateRestore)

    // Clear pending state and waiting flag
    setPendingStateRestore(null)
    setIsWaitingForIframeReady(false)
  }, [pendingStateRestore])

  // Sync ref with callback to avoid circular dependency
  useEffect(() => {
    attemptStateRestorationRef.current = attemptStateRestoration
  }, [attemptStateRestoration])

  useEffect(() => {
    function clearEvalFullHeightFallback() {
      if (evalFullHeightFallbackTimerRef.current !== null) {
        clearTimeout(evalFullHeightFallbackTimerRef.current)
        evalFullHeightFallbackTimerRef.current = null
      }
    }

    function deliverEvalFullHeightRequest(reason: string) {
      if (!iframeRef.current?.contentWindow) {
        logger.warn('preview.eval-snapshot.skipped', { reason, message: 'iframe contentWindow unavailable' })
        return
      }
      postMessageToIframe(iframeRef.current, {
        type: 'REQUEST_VIEWPORT_SCREENSHOT',
      })
      logger.info('preview.eval-snapshot.posted', { reason })
    }

    function handleEvalSnapshotRequest() {
      pendingEvalFullHeightRef.current = true
      clearEvalFullHeightFallback()
      evalFullHeightFallbackTimerRef.current = setTimeout(function evalSnapshotFallback() {
        evalFullHeightFallbackTimerRef.current = null
        if (!pendingEvalFullHeightRef.current) return
        deliverEvalFullHeightRequest('fallback-timeout')
        // Intentionally do NOT clear pendingEvalFullHeightRef here.
        // If the iframe wasn't ready when the fallback fired (DevelopmentMode still mounting),
        // the IFRAME_READY handler will catch it and send again. The flag is only cleared
        // when VIEWPORT_SCREENSHOT_RESPONSE is actually received.
      }, EVAL_SNAPSHOT_IFRAME_FALLBACK_MS)
    }

    window.addEventListener('eval-snapshot-request', handleEvalSnapshotRequest)
    return () => {
      window.removeEventListener('eval-snapshot-request', handleEvalSnapshotRequest)
      clearEvalFullHeightFallback()
      pendingEvalFullHeightRef.current = false
    }
  }, [])

  const pendingPublishSnapshotRef = useRef<PublishSnapshotRequestDetail | null>(null)
  const pendingPublishFullHeightRef = useRef(false)
  const onPublishSnapshotRef = useRef(onPublishSnapshot)
  useEffect(() => { onPublishSnapshotRef.current = onPublishSnapshot }, [onPublishSnapshot])
  const publishSnapshotFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const publishSnapshotDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const publishSnapshotIframeReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function clearPublishFallback() {
      if (publishSnapshotFallbackTimerRef.current !== null) {
        clearTimeout(publishSnapshotFallbackTimerRef.current)
        publishSnapshotFallbackTimerRef.current = null
      }
    }

    function deliverPublishSnapshotRequest() {
      pendingPublishFullHeightRef.current = true
      if (!iframeRef.current?.contentWindow) {
        logger.info('preview.publish-snapshot.deferred', {
          appId: pendingPublishSnapshotRef.current?.appId,
          message: 'iframe not ready, will retry on IFRAME_READY',
        })
        return
      }
      postMessageToIframe(iframeRef.current, { type: 'REQUEST_VIEWPORT_SCREENSHOT' })
      logger.info('preview.publish-snapshot.posted', {
        appId: pendingPublishSnapshotRef.current?.appId,
        deploymentId: pendingPublishSnapshotRef.current?.deploymentId,
      })

      publishSnapshotFallbackTimerRef.current = setTimeout(function publishSnapshotFallback() {
        publishSnapshotFallbackTimerRef.current = null
        if (!pendingPublishFullHeightRef.current) return
        // Re-deliver if iframe still hasn't responded — IFRAME_READY will catch it if reloading
        if (iframeRef.current?.contentWindow) {
          postMessageToIframe(iframeRef.current, { type: 'REQUEST_VIEWPORT_SCREENSHOT' })
          logger.info('preview.publish-snapshot.posted', { reason: 'fallback-timeout', appId: pendingPublishSnapshotRef.current?.appId })
        }
      }, EVAL_SNAPSHOT_IFRAME_FALLBACK_MS)
    }

    function handlePublishSnapshotRequest(event: Event) {
      const detail = (event as CustomEvent<PublishSnapshotRequestDetail>).detail
      pendingPublishSnapshotRef.current = detail
      clearPublishFallback()
      if (publishSnapshotDelayTimerRef.current !== null) {
        clearTimeout(publishSnapshotDelayTimerRef.current)
      }
      // Delay to let the iframe reload with freshly published content
      publishSnapshotDelayTimerRef.current = setTimeout(function publishSnapshotDelay() {
        publishSnapshotDelayTimerRef.current = null
        deliverPublishSnapshotRequest()
      }, 2000)
    }

    window.addEventListener('publish-snapshot-request', handlePublishSnapshotRequest)
    return () => {
      window.removeEventListener('publish-snapshot-request', handlePublishSnapshotRequest)
      clearPublishFallback()
      if (publishSnapshotDelayTimerRef.current !== null) {
        clearTimeout(publishSnapshotDelayTimerRef.current)
        publishSnapshotDelayTimerRef.current = null
      }
      if (publishSnapshotIframeReadyTimerRef.current !== null) {
        clearTimeout(publishSnapshotIframeReadyTimerRef.current)
        publishSnapshotIframeReadyTimerRef.current = null
      }
      pendingPublishSnapshotRef.current = null
      pendingPublishFullHeightRef.current = false
    }
  }, [])

  // Listen for file save events and preview refresh requests to auto-refresh preview
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const fromPreviewIframe =
        iframeRef.current?.contentWindow != null && event.source === iframeRef.current.contentWindow

      if (event.data?.type === 'VIEWPORT_SCREENSHOT_RESPONSE' && fromPreviewIframe) {
        const pendingPublish = pendingPublishSnapshotRef.current
        if (pendingPublish) {
          // Always clear pending state — even if screenshot is missing — to avoid
          // permanently blocking eval captures when the iframe returns an empty response.
          pendingPublishFullHeightRef.current = false
          if (publishSnapshotFallbackTimerRef.current !== null) {
            clearTimeout(publishSnapshotFallbackTimerRef.current)
            publishSnapshotFallbackTimerRef.current = null
          }
          pendingPublishSnapshotRef.current = null
          if (event.data.screenshot && onPublishSnapshotRef.current) {
            onPublishSnapshotRef.current(event.data.screenshot, pendingPublish)
          }
        } else {
          pendingEvalFullHeightRef.current = false
          if (evalFullHeightFallbackTimerRef.current !== null) {
            clearTimeout(evalFullHeightFallbackTimerRef.current)
            evalFullHeightFallbackTimerRef.current = null
          }
        }
      }

      if (event.data?.type === 'CLEAR_AI_EDIT_CONTEXT' && fromPreviewIframe) {
        // Dev-tool dismissed (user clicked outside selected element).
        // Treat this as "selection cleared" only; do not directly disable
        // mobile inline edit mode here, otherwise the parent UI becomes
        // desynchronized from the iframe's actual edit-mode state.
        return
      }

      if (event.data?.type === 'IFRAME_READY' && fromPreviewIframe) {
        // Mark bootstrap complete: this signal only arrives if the
        // preview app's own script ran, which means the iframe didn't
        // end up on a builder-redirect or CSP-block.
        setIframeBootstrapped(true)

        // Send devtools translations to iframe
        // Filter and send only keys starting with "devtools_"
        const allMessages = intl.messages || {}
        const devtoolsTranslations: Record<string, string> = {}
        const droppedKeys: string[] = []

        Object.keys(allMessages).forEach((key) => {
          if (key.startsWith('devtools_')) {
            const value = allMessages[key]
            // ICU messages (plurals, selectors) arrive as MessageFormatElement[]
            // For dev-tools, all strings are guaranteed to be plain text (no ICU syntax)
            if (typeof value === 'string') {
              devtoolsTranslations[key] = value
            } else {
              // MessageFormatElement[] from ICU - materialize via formatMessage
              devtoolsTranslations[key] = intl.formatMessage({ id: key })
              droppedKeys.push(key)
            }
          }
        })

        if (droppedKeys.length > 0) {
          logger.warn('preview-pane.devtools-translations.non-string-value', {
            totalMessageCount: Object.keys(allMessages).length,
            droppedKeys,
          })
        }

        if (Object.keys(devtoolsTranslations).length > 0 && iframeRef.current) {
          postMessageToIframe(iframeRef.current, {
            type: 'DEVTOOLS_TRANSLATIONS',
            translations: devtoolsTranslations,
          })
          logger.debug('preview-pane.devtools-translations.sent', {
            count: Object.keys(devtoolsTranslations).length,
          })
        } else {
          logger.warn('preview-pane.devtools-translations.empty', {
            totalMessageCount: Object.keys(allMessages).length,
          })
        }

        // Reset mobile inline edit state when iframe reloads.
        // Must reset both flags to stay in sync with page.tsx's sendEditModeMessage(isEditModeEnabled).
        const currentEditState = useDevelopPageStore.getState().isMobileInlineEditActive
        if (currentEditState) {
          useDevelopPageStore.setState({
            isMobileInlineEditActive: false,
            isEditModeEnabled: false,
          })
        }

        if (isWaitingForIframeReady) {
          logger.debug('preview-pane.iframe.ready', { message: 'Iframe ready signal received, restoring state immediately' })
          if (attemptStateRestorationRef.current) {
            attemptStateRestorationRef.current()
          }
        }
        if (pendingEvalFullHeightRef.current && iframeRef.current) {
          // Wait a bit more for content to fully render after IFRAME_READY
          // IFRAME_READY means the script is loaded, but React might still be hydrating/rendering
          setTimeout(() => {
            if (iframeRef.current) {
              postMessageToIframe(iframeRef.current, {
                type: 'REQUEST_VIEWPORT_SCREENSHOT',
              })
              logger.info('preview.eval-snapshot.posted', { reason: 'iframe-ready' })
            }
          }, 1000) // 1 second delay to let React hydrate and render content
          pendingEvalFullHeightRef.current = false
          if (evalFullHeightFallbackTimerRef.current !== null) {
            clearTimeout(evalFullHeightFallbackTimerRef.current)
            evalFullHeightFallbackTimerRef.current = null
          }
        }
        if (pendingPublishFullHeightRef.current && iframeRef.current) {
          if (publishSnapshotIframeReadyTimerRef.current !== null) {
            clearTimeout(publishSnapshotIframeReadyTimerRef.current)
          }
          publishSnapshotIframeReadyTimerRef.current = setTimeout(function publishSnapshotIframeReady() {
            publishSnapshotIframeReadyTimerRef.current = null
            if (!pendingPublishSnapshotRef.current || !iframeRef.current) return
            postMessageToIframe(iframeRef.current, { type: 'REQUEST_VIEWPORT_SCREENSHOT' })
            logger.info('preview.publish-snapshot.posted', { reason: 'iframe-ready', appId: pendingPublishSnapshotRef.current.appId })
          }, 1000)
          pendingPublishFullHeightRef.current = false
          if (publishSnapshotFallbackTimerRef.current !== null) {
            clearTimeout(publishSnapshotFallbackTimerRef.current)
            publishSnapshotFallbackTimerRef.current = null
          }
        }
        return
      }

      if (
        (event.data?.type === 'file-saved' || event.data?.type === 'preview-refresh') &&
        serverState?.isReady
      ) {
        if (event.origin !== window.location.origin || event.source !== window) {
          return
        }
        // Store state to restore if provided
        if (event.data.preserveState) {
          setPendingStateRestore(event.data.preserveState)
        }

        // Clear any existing timers from previous message events
        // Both timers need clearing: refresh timer (immediate) and scroll timer (nested inside refresh)
        // If a previous event created both timers and this new event arrives, we want to cancel both
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current)
        }
        if (scrollRestoreTimerRef.current) {
          clearTimeout(scrollRestoreTimerRef.current)
        }

        // Debounce refreshes to avoid too many reloads
        refreshTimerRef.current = setTimeout(() => {
          if (iframeRef.current) {
            const iframeSrc = iframeRef.current.src
            iframeRef.current.src = iframeSrc
            dismissProcessingOverlayRef.current()

            // If we have state to restore, do it after iframe loads
            if (event.data.preserveState) {
              scrollRestoreTimerRef.current = setTimeout(() => {
                if (iframeRef.current) {
                  restoreIframeState(iframeRef.current, event.data.preserveState)
                }
                scrollRestoreTimerRef.current = null
              }, 500) // Wait for iframe to load
            }
          }
          refreshTimerRef.current = null
        }, REFRESH_DEBOUNCE_MS)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      // Clean up any pending timers
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      if (scrollRestoreTimerRef.current) {
        clearTimeout(scrollRestoreTimerRef.current)
        scrollRestoreTimerRef.current = null
      }
    }
  }, [serverState?.isReady, isWaitingForIframeReady])

  // Bootstrap-race recovery: if the iframe hasn't signalled IFRAME_READY
  // within the timeout, the most likely cause is the preview_auth cookie
  // wasn't set yet when the iframe first hit the preview origin (race
  // between the bootstrap fetch in useServerPollingStore and the iframe
  // mount). dev-supervisor 307'd to the builder, the iframe followed,
  // CSP frame-ancestors blocks the inner frame from rendering — net result
  // is a blank iframe that never sends IFRAME_READY.
  //
  // Re-mount with a fresh key after the timeout. By the second mount,
  // the bootstrap-fetch retry has settled and the cookie is in the
  // browser, so the new iframe load picks it up via Cookie header.
  // Cap retries to avoid an infinite loop if the failure is permanent
  // (e.g. third-party-cookie blocking with no share-token fallback).
  useEffect(() => {
    if (!previewUrl || !serverState?.isReady) return
    if (iframeBootstrapped) return
    if (bootstrapRetryCount >= MAX_IFRAME_BOOTSTRAP_RETRIES) return

    const timer = setTimeout(() => {
      logger.warn('preview-pane.iframe.bootstrap-timeout', {
        message: 'Iframe did not signal IFRAME_READY within timeout, remounting',
        appId,
        attempt: bootstrapRetryCount + 1,
      })
      setBootstrapRetryCount((prev) => prev + 1)
      setIframeKey((prev) => prev + 1)
    }, IFRAME_BOOTSTRAP_RETRY_MS)

    return () => clearTimeout(timer)
  }, [previewUrl, serverState?.isReady, iframeBootstrapped, bootstrapRetryCount, appId])

  // Reset bootstrap flag whenever the iframe is re-keyed (forced re-mount)
  // or the URL changes — otherwise the previous "bootstrapped" state would
  // leak across attempts and the retry timer wouldn't fire.
  useEffect(() => {
    setIframeBootstrapped(false)
  }, [iframeKey, previewUrl])

  // Reset the auto-retry budget on URL change. Without this, an app that
  // exhausted its retry budget on a previous allocation URL would skip
  // auto-recovery on the new URL — e.g. a server restart hands out a
  // fresh preview_url, but bootstrapRetryCount is still at MAX from the
  // old URL's failed attempts. The new URL deserves a fresh budget.
  // Note: this is keyed only on previewUrl, NOT on iframeKey, because
  // iframeKey changes ARE the auto-retries themselves — resetting the
  // counter on every iframeKey bump would create an infinite loop.
  useEffect(() => {
    setBootstrapRetryCount(0)
  }, [previewUrl])

  const handleManualRetry = () => {
    logger.info('preview-pane.retry', { message: 'Manual retry - restarting server polling', appId })
    // Restart polling to recover from server errors
    // This is the only place PreviewPane manages polling (for error recovery)
    // Normal polling lifecycle is managed by parent component
    stopPollingForServer(appId)
    startPollingForServer(appId)
    setIframeError(false)
    setIframeKey(prev => prev + 1)
    // Reset the auto-retry budget so the user gets another full set of
    // auto-recovery attempts after their explicit refresh.
    setBootstrapRetryCount(0)
  }

  const handleIframeError = () => {
    logger.warn('preview-pane.iframe.error', { message: 'Iframe error', appId })
    setIframeError(true)
  }

  if (archiveGatePending) {
    return (
      <PreviewSkeleton testId="develop-preview-archive-gate" />
    )
  }

  if (archiveResumeFailed) {
    return (
      <div data-testid="develop-preview-archive-restore-failed">
        <PreviewError
          title={t('builder_preview_archive_restore_failed_title')}
          error={t('builder_preview_archive_restore_failed_message')}
          buttonText={t('builder_common_try_again')}
          buttonOnClick={onRetryArchiveRestore || onPreviewRefresh}
        />
      </div>
    )
  }

  // Show error state when resume failed
  if (resumeFailed && viewMode !== ViewMode.BRAND && viewMode !== ViewMode.DOMAIN) {
    return (
      <PreviewError
        title={t('builder_preview_resume_failed_title')}
        error={t('builder_preview_resume_failed_message')}
        buttonText={t('builder_common_try_again')}
        buttonOnClick={onRetryResume || onPreviewRefresh}
      />
    )
  }

  if (showArchiveResumeMessage) {
    return (
      <PreviewLoadingState
        message={t('builder_preview_archive_restore_message')}
        description={t('builder_preview_archive_restore_description')}
        isMobile={isMobile}
        testId="develop-preview-archive-restoring"
      />
    )
  }

  // Show restarting message when app is hibernated or resuming
  if ((isHibernated || isResuming) && viewMode !== ViewMode.BRAND && viewMode !== ViewMode.DOMAIN) {
    return <PreviewLoadingState message={t('builder_preview_resuming_message')} isMobile={isMobile} />
  }

  if (imageReloadFailed && viewMode !== ViewMode.BRAND && viewMode !== ViewMode.DOMAIN) {
    return (
      <PreviewError
        title={t('builder_preview_image_reload_failed_title')}
        error={t('builder_preview_image_reload_failed_message')}
        buttonText={t('builder_common_try_again')}
        buttonOnClick={onRetryImageReload || onPreviewRefresh}
      />
    )
  }

  if (isImageReloading && viewMode !== ViewMode.BRAND && viewMode !== ViewMode.DOMAIN) {
    return <PreviewLoadingState message={t('builder_preview_image_reloading_message')} isMobile={isMobile} />
  }

  if (viewMode === ViewMode.DOMAIN && isTopLevelDomainEnabled) {
    return (
      <div className="h-full flex flex-col pr-1 md:pr-2.5 pl-1">
        <div className="relative h-full overflow-auto rounded-lg md:rounded-b-none border bg-intents-ux-box-backgroundColor">
          <div className="mx-auto max-w-[960px] p-6">
            <ErrorBoundary>
              <DomainPanel />
            </ErrorBoundary>
          </div>
        </div>
      </div>
    )
  }

  // Brand Book uses its own API and doesn't depend on the preview server.
  // When the preview server IS ready, Brand renders as an overlay layer in
  // the success block so that PreviewCode stays mounted and preserves state
  // (open file tabs, search). This fallback only fires before server readiness.
  if (viewMode === ViewMode.BRAND && !(previewUrl && serverState?.isReady)) {
    return (
      <div className="h-full flex flex-col pr-1 md:pr-2.5 pl-1">
        <div className="inset-0 relative h-full">
          <div className="flex flex-col items-center justify-center h-full bg-intents-ux-boxLowContrast-backgroundColor rounded-lg md:rounded-b-none">
            <div className="flex flex-col h-full w-full bg-intents-ux-boxLowContrast-backgroundColor relative rounded-lg md:rounded-b-none">
              <div className="relative w-full h-full overflow-hidden rounded-lg md:rounded-b-none">
                <BrandBookView appId={appId} />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!serverState || (isPollingServer(appId) && !serverState.isReady)) {
    let loadingMessage: string;
    if (showBuildingOverlay && isAwaitingAskQuestion) {
      loadingMessage = t('builder_preview_question_title', undefined, 'Action needed to continue');
    } else if (showBuildingOverlay) {
      loadingMessage = t('builder_preview_building_app');
    } else {
      loadingMessage = t('builder_preview_loading_app');
    }
    return <PreviewLoadingState message={loadingMessage} isMobile={isMobile} />
  }

  // Error state when server failed — show "Ask Airo to fix" alongside "Try Again"
  // for any failure surface the user reaches here, including BFF/network errors
  // (status='error' from the polling catch block) and the crash-loop escalation.
  // The user can't easily tell which path triggered the error UI, and Airo can
  // investigate broadly via the viewLogs tool even when the root cause turns
  // out to be infra-side.
  if (serverState?.status === 'failed' || serverState?.status === 'error') {
    return (
      <PreviewError
        title={t('builder_preview_server_error')}
        error={serverState.error || t('builder_preview_server_error_text')}
        buttonText={t('builder_common_try_again')}
        buttonOnClick={handleManualRetry}
        secondaryButtonText={onAskAiroToFix ? t('builder_preview_ask_airo_to_fix') : undefined}
        secondaryButtonOnClick={onAskAiroToFix}
        secondaryButtonDisabled={isProcessing}
      />
    )
  }

  // Cookie verification failed - browser is blocking cookies needed for preview auth
  if (serverState?.cookieVerified === false && serverState.url) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4" data-testid="preview-cookie-blocked">
        <h3 className="text-lg font-semibold mb-1">{t('builder_preview_error_title')}</h3>
        <p className="text-sm mb-2 text-center max-w-md">
          {t('builder_preview_cookie_blocked_text', undefined, 'Your browser is blocking cookies needed to display the preview. This can happen in incognito mode or when third-party cookies are disabled.')}
        </p>
        <div className="flex gap-2 items-center">
          <Button
            onClick={handleManualRetry}
            design="tertiary"
            text={t('builder_common_try_again')}
          />
          <a
            href={serverState.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline text-intents-ux-link-color"
          >
            {t('builder_preview_open_new_tab', undefined, 'Open preview in new tab')}
          </a>
        </div>
      </div>
    )
  }

  // Error state when iframe fails to load
  if (iframeError && previewUrl) {
    return (
      <PreviewError
        title={t('builder_preview_error_title')}
        error={t('builder_preview_error_text')}
        buttonText={t('builder_preview_error_button')}
        buttonOnClick={handleManualRetry}
        secondaryButtonText={onAskAiroToFix ? t('builder_preview_ask_airo_to_fix') : undefined}
        secondaryButtonOnClick={onAskAiroToFix}
        secondaryButtonDisabled={isProcessing}
      />
    )
  }

  // Success state - show the preview
  if (previewUrl && serverState?.isReady) {
    const isPreviewSurfaceVisible = viewMode !== ViewMode.CODE && viewMode !== ViewMode.BRAND
    const showEditingChip = Boolean(
      !isMobile &&
      isPreviewEnhancedOverlaysEnabled &&
      isPreviewSurfaceVisible &&
      !showBuildingOverlay &&
      showProcessingOverlay &&
      editingChipPosition
    )
    return (
      <div className="h-full flex flex-col pr-e md:pe-2.5 ps-1">
        <div className="inset-0 relative h-full">
          <div className="flex flex-col items-center justify-center h-full bg-intents-ux-boxLowContrast-backgroundColor rounded-lg md:rounded-b-none">
            <div className="flex flex-col h-full w-full bg-intents-ux-boxLowContrast-backgroundColor relative rounded-lg md:rounded-b-none">
              {/* Crossfade Animation Container */}
              <div className="relative w-full h-full overflow-hidden">
                {/* Brand View - rendered as overlay to preserve code/preview state */}
                {viewMode === ViewMode.BRAND && (
                  <div
                    className="absolute inset-0 w-full h-full z-10 rounded-lg md:rounded-b-none overflow-hidden"
                  >
                    <BrandBookView appId={appId} />
                  </div>
                )}

                {/* Preview View (DomainBar + iframe) */}
                <motion.div
                  className="absolute inset-0 w-full h-full flex flex-col"
                  style={{
                    opacity: previewOpacity,
                    pointerEvents: viewMode === ViewMode.CODE || viewMode === ViewMode.BRAND ? 'none' : 'auto'
                  }}
                >
                  {/* Domain Bar - only show in Preview mode when no alert banner is visible */}
                  {isDomainBarEnabled && (
                    <div className="px-1 md:px-2">
                      <DomainBar />
                    </div>
                  )}

                  <div className="flex-1 flex items-center justify-center pb-1 md:pb-0 px-1 md:px-0">
                    <div
                      ref={previewShellRef}
                      className={clsx(
                        'relative border rounded-lg md:rounded-b-none bg-intents-ux-boxLowContrast-backgroundColor overflow-hidden', {
                          'w-full h-full': isFullSize || isMobile,
                          'my-auto': !isFullSize && !isMobile
                        }
                      )}
                      style={!isFullSize && !isMobile ? {
                        width: `${deviceWidth}px`,
                        height: `min(${deviceHeight}px, calc(100% - ${deviceVerticalMargin * 2}px))`
                      } : undefined}
                    >
                      <iframe
                        key={iframeKey}
                        ref={iframeRef}
                        id="preview-iframe"
                        data-testid="preview-iframe"
                        src={previewUrl}
                        className="w-full h-full border rounded-lg md:rounded-b-none"
                        onError={handleIframeError}
                        onLoad={handleIframeLoad}
                        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-top-navigation-by-user-activation"
                        title={t('builder_preview_preview_for', { appId })}
                        aria-hidden={viewMode === ViewMode.CODE || viewMode === ViewMode.BRAND || showBuildingOverlay ? 'true' : undefined}
                        tabIndex={viewMode === ViewMode.CODE || viewMode === ViewMode.BRAND || showBuildingOverlay ? -1 : undefined}
                        inert={viewMode === ViewMode.CODE || viewMode === ViewMode.BRAND || showBuildingOverlay ? true : undefined}
                      />
                    </div>
                  </div>

                  {/* Thinking/editing indicator for mobile preview mode */}
                  {isMobile &&
                    mobileMode === MobileMode.PREVIEW &&
                    !showBuildingOverlay &&
                    (isPreviewEnhancedOverlaysEnabled ? (isProcessing || isMutatingFiles) : isProcessing) && (
                    <div
                      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 cursor-pointer"
                      onClick={() => handleMobileModeChange(MobileMode.TOOLS)}
                      role="button"
                      tabIndex={0}
                      aria-label={t('devtools_open')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleMobileModeChange(MobileMode.TOOLS)
                        }
                      }}
                    >
                      {isPreviewEnhancedOverlaysEnabled ? (
                        <StatusPill
                          data-testid="preview-mobile-status-pill"
                          label={
                            isMutatingFiles
                              ? t('builder_preview_editing', undefined, 'Editing…')
                              : t('builder_agent_thinking', undefined, 'Thinking…')
                          }
                        />
                      ) : (
                        <div className="bg-intents-ux-box-backgroundColor rounded-full px-2 pt-0.5 pb-0 shadow-lg border">
                          <ThinkingIndicator active={true} inline={true} />
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>

                {/* Code View */}
                <motion.div
                  className="absolute inset-0 w-full h-full"
                  style={{
                    opacity: codeOpacity,
                    pointerEvents: viewMode !== ViewMode.CODE ? 'none' : 'auto'
                  }}
                  aria-hidden={viewMode !== ViewMode.CODE ? 'true' : undefined}
                  inert={viewMode !== ViewMode.CODE || undefined}
                >
                  <PreviewCode appId={appId} />
                </motion.div>
              </div>

              {showBuildingOverlay && (
                <div
                  className={clsx(
                    'absolute inset-0 rounded-lg',
                    isPreviewEnhancedOverlaysEnabled
                      ? 'bg-intents-ux-boxLowContrastOverlay-backgroundColor backdrop-blur-sm'
                      : 'bg-intents-ux-boxLowContrast-backgroundColor'
                  )}
                >
                  {isAwaitingAskQuestion ? (
                    <Tips
                      buildingMessage={t(
                        'builder_preview_question_title',
                        undefined,
                        'Action needed to continue',
                      )}
                      staticTipTitle={t(
                        'builder_preview_question_heading',
                        undefined,
                        'Answer a few questions',
                      )}
                      staticTipDescription={t(
                        'builder_preview_question_paragraph',
                        undefined,
                        'Answer the questions in chat so we can tailor this for you. We’ll build as you go.',
                      )}
                    />
                  ) : (
                    <Tips buildingMessage={t('builder_preview_building_app')} />
                  )}
                </div>
              )}
              {isPortalReady && createPortal(
                <AnimatePresence>
                  {showEditingChip && editingChipPosition && (
                    <motion.div
                      key="preview-editing-chip"
                      data-testid="preview-editing-chip"
                      className="fixed z-50"
                      style={{
                        left: editingChipPosition.left,
                        top: editingChipPosition.top,
                      }}
                      initial={{ opacity: 0, x: '-50%', y: -4 }}
                      animate={{ opacity: 1, x: '-50%', y: 0 }}
                      exit={{ opacity: 0, x: '-50%', y: -4, transition: { duration: 0.25 } }}
                      transition={{ duration: 0.175 }}
                    >
                      <StatusPill
                        label={t('builder_preview_editing', undefined, 'Editing…')}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>,
                document.body
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Fallback loading state
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <Loader
        title={t('builder_preview_loading_title')}
        description={t('builder_preview_loading_text')}
      />
    </div>
  )
}

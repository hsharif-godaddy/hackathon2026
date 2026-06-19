'use client'

import clsx from 'clsx'
import { animate, motion, useMotionValue } from 'framer-motion'
import dynamic from 'next/dynamic'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIntl } from 'react-intl'
import { Loader } from '@airo-ux/loader'
import { Thinker } from '@airo-ux/pattern-library/chat/thinker'
import { Canvas } from '@airo-ux/pattern-library/surfaces/canvas'
import Button from '@ux/button'

import { useLatestNBAs } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import { useThinkerIndicator } from '@/app/[market]/develop/components/chat/useThinkerIndicator'
import { useThinkerLabel } from '@/app/[market]/develop/components/chat/useThinkerLabel'
import DomainBar from '@/app/[market]/develop/components/layout/DomainBar'
import { getDevicePreset, isFullWidthDevice } from '@/app/[market]/develop/components/preview/devicePresets'
import Inbox from '@/app/[market]/develop/components/preview/inbox/Inbox'
import { useCanvasStatusLabel } from '@/app/[market]/develop/components/preview/useCanvasStatusLabel'
const DocsView = lazy(() => import('@/app/[market]/develop/components/preview/DocsView'))
import PreviewCode from '@/app/[market]/develop/components/preview/PreviewCode'
import PreviewError from '@/app/[market]/develop/components/preview/PreviewError'
import PreviewLoadingState from '@/app/[market]/develop/components/preview/PreviewLoadingState'
import PreviewSkeleton from '@/app/[market]/develop/components/preview/PreviewSkeleton'
import Tips from '@/app/[market]/develop/components/tips/Tips'
import { MobileMode, PreviewViewMode, ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useFirstBuildEstimateImpression } from '@/app/[market]/develop/hooks/useFirstBuildEstimateImpression'
import ErrorBoundary from '@/components/ErrorBoundary'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { EXPERIMENT_IDS, INITIAL_AGENT_V3_COHORT } from '@/config/experiments'
import { useBuildingTipsVariant } from '@/experiments/building-tips-variant/useBuildingTipsVariant'
import { isInitialBuildComplete, isInitialBuildFunnelActive } from '@/hooks/shared/initialBuildFunnel'
import { useHivemind } from '@/hooks/useHivemind'
import { useImpression } from '@/hooks/useImpression'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { useCommanderCanvasTabsEnabled } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { postMessageToIframe } from '@/utils/postMessage'

const DomainPanel = dynamic(
  () => import('@/app/[market]/develop/components/settings/DomainPanel'),
  { ssr: false, loading: () => <PreviewSkeleton testId="domain-panel-skeleton" /> },
)

// Minutes shown by the first-build time-estimate pill.
const FIRST_BUILD_ESTIMATE_MINUTES: number = 5

// Timing constants for iframe lifecycle management
const REFRESH_DEBOUNCE_MS = 500 // Debounce rapid refresh requests
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
// Evidence-based recovery (flagged via `appbuilder-preview-evidence-recovery`):
// cold-start-realistic delay before we even *probe* whether a missing
// IFRAME_READY is a real auth-block vs a slow-but-healthy load. A cold
// container (no vite dep-optimization cache) routinely needs longer than the
// legacy 3s to download + hydrate + lazy-mount dev-tools and post IFRAME_READY,
// so the legacy timer false-positives and remounts a healthy load — making it
// slower and producing the "loaded N times in quick succession" symptom.
// Matches EVAL_SNAPSHOT_IFRAME_FALLBACK_MS (8000).
const IFRAME_BOOTSTRAP_PROBE_DELAY_MS = 8000

/**
 * Restore iframe state (URL and scroll position) via postMessage.
 * The preview iframe is always cross-origin, so direct contentWindow access is not possible.
 *
 * `modulePath` is the source file for which we want to land on the
 * registered route — used by dev-tools to resolve via its live React Router
 * registry when the filename heuristic in `url` would miss (skill-installed
 * pages mount at non-filename paths). Dev-tools prefers the resolved route
 * over `url` when both are present.
 *
 * @param iframe - The iframe element to restore state on
 * @param state - The state to restore containing url, scrollPosition, modulePath
 */
export function restoreIframeState(
  iframe: HTMLIFrameElement,
  state: {
    url?: string
    scrollPosition?: { x: number; y: number }
    modulePath?: string
  }
) {
  if (!state.url && !state.scrollPosition && !state.modulePath) {
    return
  }

  try {
    postMessageToIframe(iframe, {
      type: 'RESTORE_STATE_AFTER_REFRESH',
      url: state.url,
      scrollPosition: state.scrollPosition,
      modulePath: state.modulePath,
    })
  } catch (error) {
    logger.error('preview-pane.state-restore.failure', {
      message: 'Failed to restore state',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Compare two preview URLs for route equality while ignoring the bootstrap
 * `airoShareToken` query param. The iframe `src` carries that param (the BFF
 * appends it in /api/servers/[id] so the cross-site preview authenticates via
 * the URL instead of a third-party cookie that Safari ITP drops), but the
 * customer app reports its own URL — which may not include the token. A raw
 * `search` comparison would then spuriously differ and silently skip
 * post-refresh scroll restoration, so strip the token from both sides first.
 */
function isSamePreviewRoute(a: URL, b: URL): boolean {
  const searchWithoutShareToken = (u: URL): string => {
    const params = new URLSearchParams(u.search)
    params.delete('airoShareToken')
    return params.toString()
  }
  return a.pathname === b.pathname && searchWithoutShareToken(a) === searchWithoutShareToken(b)
}

function isWebKit(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /AppleWebKit/.test(ua) && !/Chrome\//.test(ua)
}

/**
 * Probe the preview origin's /airo/auth-check endpoint to detect whether the
 * cross-site preview is failing auth (ITP-partitioned cookie). dev-supervisor's
 * JWT middleware signals this with a direct 401/403 — the prior 307→builder
 * path is gone (see PR #4578, dev-supervisor/internal/auth/middleware.go
 * `serveLoginPage`). auth-check sends CORS headers, so a 401/403 is readable
 * directly. Any other response (or a CORS rejection) falls through to `false`.
 * `redirect:'manual'` is retained defensively so the probe never silently
 * follows an unexpected redirect to the builder and reports a misleading status.
 *
 * Do NOT add `mode: 'no-cors'` here: the Fetch spec requires redirect:'follow'
 * under no-cors, and WebKit/Safari enforces it by throwing "No-Cors mode
 * requires follow redirect mode". That throw was caught below and made this
 * probe always return false on Safari — the exact browser the Storage Access
 * fallback targets — so the fallback never triggered.
 */
async function probePreviewAuth(previewUrl: string): Promise<boolean> {
  try {
    const u = new URL(previewUrl)
    const res = await fetch(u.origin + '/airo/auth-check', {
      method: 'HEAD',
      credentials: 'include',
      redirect: 'manual',
      cache: 'no-store',
    })
    // A 401/403 from dev-supervisor's JWT middleware means the preview is auth-blocked.
    return res.status === 401 || res.status === 403
  } catch (err) {
    // Network error, CORS rejection, or abort. Treat as "not conclusively blocked"
    // so we don't remount on a transient failure — but log so probe errors are
    // distinguishable from a genuine clean response in Loki.
    logger.debug('preview-pane.probe.error', {
      message: 'probePreviewAuth threw; treating as not-blocked',
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/**
 * Build the dev-supervisor Storage Access bootstrap URL for a preview origin.
 * When Safari ITP blocks the cross-site preview cookie, the embedded app's
 * sub-resources are auth-blocked (401) and it never loads. Pointing the iframe at this page
 * lets the user grant cookie access via `document.requestStorageAccess()` (a
 * one-tap gesture *inside* the iframe — the only context the API accepts),
 * after which it redirects back to `previewUrl` with the cookie now usable.
 * The original path+query (including airoShareToken) is passed as a
 * SAME-ORIGIN relative `redirect` so the bootstrap returns to exactly where
 * the iframe was headed.
 */
function buildStorageAccessUrl(previewUrl: string): string {
  const u = new URL(previewUrl)
  const redirectPath = `${u.pathname}${u.search}`
  const bootstrap = new URL('/airo/storage-access', u.origin)
  bootstrap.searchParams.set('redirect', redirectPath)
  return bootstrap.toString()
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
  const thinkerLabel = useThinkerLabel()
  const canvasStatusLabel = useCanvasStatusLabel(isMutatingFiles, isProcessing)
  const thinkerIndicator = useThinkerIndicator()
  const intl = useIntl();
  const isDomainBarEnabled = useSwitchboard('appbuilder-domain-bar');
  const isTopLevelDomainEnabled = useSwitchboard('appbuilder-domain-top-level');
  const isInboxEnabled = useSwitchboard('app-builder-inbox-button');
  const isBrandBookEnabled = useSwitchboard('appbuilder-brandbook') === true;
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled();
  /** Switchboard: translucent creation overlay + edit chip behavior. */
  const isPreviewEnhancedOverlaysEnabled = useSwitchboard('appbuilder-preview-enhanced-overlays') === true;
  const isEditModeCueEnabled = useSwitchboard('appbuilder-edit-mode-cue') === true;
  /**
   * Switchboard: evidence-based iframe recovery. When on, a missing
   * IFRAME_READY no longer blindly remounts the iframe on a 3s timer.
   * Instead we (a) treat the early IFRAME_BOOTING beacon as proof the app's
   * own JS is executing (so the frame isn't auth-blocked), and (b) only
   * remount when an auth probe confirms a 401/403 auth block (dev-supervisor
   * since #4578). Manual refresh also routes through a single key-tracked
   * remount.
   */
  const isEvidenceRecoveryEnabled = useSwitchboard('appbuilder-preview-evidence-recovery') === true;

  const latestNBA = useLatestNBAs();
  const isAwaitingAskQuestion = latestNBA?.source === 'askQuestion';

  useImpression('develop.initialBuild.overlayQuestion', {
    enabled: isAwaitingAskQuestion && isInitialBuildFunnelActive() && !isInitialBuildComplete(),
  });

  const getServerState = useServerPollingStore((state) => state.getServerState)
  const isPollingServer = useServerPollingStore((state) => state.isPollingServer)
  const startPollingForServer = useServerPollingStore((state) => state.startPollingForServer)
  const stopPollingForServer = useServerPollingStore((state) => state.stopPollingForServer)

  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const isEditModeEnabled = useDevelopPageStore((state) => state.isEditModeEnabled)
  const selectedDeviceId = useDevelopPageStore((state) => state.selectedDeviceId)
  const setPreviewViewMode = useDevelopPageStore((state) => state.setPreviewViewMode)
  const mobileMode = useDevelopPageStore((state) => state.mobileMode)
  const isMobileInlineEditActive = useDevelopPageStore((state) => state.isMobileInlineEditActive)
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange)
  const inboxBrandId = useDevelopPageStore((state) => state.inboxBrandId)
  // Get device dimensions from preset
  const selectedDevice = getDevicePreset(selectedDeviceId)
  const isFullSize = previewViewMode === PreviewViewMode.DESKTOP || isFullWidthDevice(selectedDeviceId)
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

  const isBuildTimeEstimateFlagOn = useSwitchboard('appbuilder-build-time-estimate') === true
  const { cohort: initialAgentCohort } = useHivemind(EXPERIMENT_IDS.initialAgent)
  const isBuildTimeEstimateEnabled =
    isBuildTimeEstimateFlagOn || initialAgentCohort === INITIAL_AGENT_V3_COHORT

  const isFirstBuildScreen = showBuildingOverlay && !isAwaitingAskQuestion
  const buildEstimateMinutes =
    isFirstBuildScreen && isBuildTimeEstimateEnabled ? FIRST_BUILD_ESTIMATE_MINUTES : null

  const markBuildEstimateShown = useFirstBuildEstimateImpression(appId)

  const buildingTipsVariant = useBuildingTipsVariant()

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
  // Set true between a refresh trigger and the iframe's load event — drives an opacity fade.
  const [isReloading, setIsReloading] = useState(false)
  // Bootstrap-race recovery: tracks whether the iframe has signalled
  // IFRAME_READY (which only fires when the preview app's own script
  // loads — NOT when dev-supervisor serves its 401 login page instead of the
  // app, or the frame is blocked by frame-ancestors CSP). If the signal
  // doesn't arrive within
  // IFRAME_BOOTSTRAP_RETRY_MS, bump iframeKey to force a re-mount; by
  // then the bootstrap retry in useServerPollingStore should have
  // settled and the new mount picks up the cookie.
  const [iframeBootstrapped, setIframeBootstrapped] = useState(false)
  // Evidence-recovery signal (only meaningful when isEvidenceRecoveryEnabled):
  // `iframeBooting` — the preview app posted its early IFRAME_BOOTING beacon,
  // proving its own JS is executing (so the frame was NOT 307'd / CSP-blocked).
  // While booting we never remount; we still wait for IFRAME_READY for the full
  // handshake. The iframe's native onLoad is deliberately NOT used as a health
  // signal — dev-supervisor's 401 login page also fires onLoad, so only the
  // auth probe can distinguish a slow-but-healthy load from an auth-blocked one.
  const [iframeBooting, setIframeBooting] = useState(false)
  // Separate auto-retry counter so manual retries (handleManualRetry)
  // don't exhaust the auto-retry budget — the manual retry resets this
  // and gives the user another 3 auto-attempts.
  const [bootstrapRetryCount, setBootstrapRetryCount] = useState(0)
  const [isAuthBlocked, setIsAuthBlocked] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewShellRef = useRef<HTMLDivElement>(null)
  const hasMountedBrandRef = useRef(false)
  const hasMountedDomainRef = useRef(false)
  const hasMountedInboxRef = useRef(false)
  if (viewMode === ViewMode.BRAND) hasMountedBrandRef.current = true
  if (viewMode === ViewMode.DOMAIN) hasMountedDomainRef.current = true
  if (viewMode === ViewMode.INBOX) hasMountedInboxRef.current = true

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
  const scrollRestoreTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingEvalFullHeightRef = useRef(false)
  const evalFullHeightFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [editingChipPosition, setEditingChipPosition] = useState<{
    left: number
    top: number
  } | null>(null)
  const [isPortalReady, setIsPortalReady] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') return
    setIsPortalReady(true)
  }, [])

  const updateEditingChipPosition = useCallback(function updateEditingChipPosition() {
    if (!previewShellRef.current) {
      setEditingChipPosition(null)
      return
    }

    const { left, top, width } = previewShellRef.current.getBoundingClientRect()
    setEditingChipPosition({
      top: top + 16,
      left: left + (width / 2),
    })
  }, [])

  useEffect(() => {
    const shouldTrackEditingChipPosition = Boolean(
      !isMobile &&
      isPortalReady &&
      isPreviewEnhancedOverlaysEnabled &&
      (isProcessing || isMutatingFiles) &&
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
    isMutatingFiles,
    isProcessing,
    isPortalReady,
    isMobile,
    isPreviewEnhancedOverlaysEnabled,
    showBuildingOverlay,
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

  // Cleanup fallback timer on unmount
  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current)
        fallbackTimerRef.current = null
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
  // the user with no `preview_auth` cookie and an auth-blocked (401) iframe. By gating
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
    setIsReloading(false)

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

        // Only restore if URLs match (same pathname and search params,
        // ignoring the bootstrap airoShareToken on the iframe src).
        if (savedUrl && isSamePreviewRoute(currentUrl, savedUrl)) {
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

      if (!savedUrl || !isSamePreviewRoute(currentUrl, savedUrl)) {
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

  // After a git checkout, useGitStore dispatches `preview-navigate-after-checkout`
  // with the page that was being worked on at that commit (largest diff in
  // src/pages/). Steer the iframe there so it doesn't land on the dev-tools
  // 404 when the user's current path didn't exist yet at the older commit.
  //
  // We use `restoreIframeState` so dev-tools drives React Router via
  // originalPushState + popstate instead of swapping `iframe.src`. The src
  // swap works but produces a visible iframe reload flash; this path updates
  // the route in-place and lets the post-checkout Vite HMR apply over it.
  //
  // `modulePath` is forwarded so dev-tools can re-resolve via its live route
  // registry when the filename-derived `path` would miss (e.g. skill pages
  // mounted at non-filename routes). Dev-tools prefers the resolved route.
  //
  // If the iframe hasn't bootstrapped yet (post-checkout HMR may have torn
  // it down), we stash the hint in a ref and re-apply on IFRAME_READY rather
  // than dropping it on the floor.
  const pendingCheckoutHintRef = useRef<{
    path: string | null
    modulePath: string | null
  } | null>(null)

  const applyCheckoutHint = useCallback(
    (hint: { path: string | null; modulePath: string | null }) => {
      const iframe = iframeRef.current
      if (!iframe) return false
      restoreIframeState(iframe, {
        url: hint.path ?? undefined,
        modulePath: hint.modulePath ?? undefined,
        scrollPosition: { x: 0, y: 0 },
      })
      return true
    },
    []
  )

  useEffect(() => {
    function handleNavigateAfterCheckout(event: Event) {
      const detail = (event as CustomEvent<{
        appId: string
        path: string | null
        modulePath: string | null
      }>).detail
      if (!detail || detail.appId !== appId) return
      const hint = { path: detail.path, modulePath: detail.modulePath }
      // Try once; if the iframe hasn't bootstrapped yet (e.g. checkout-driven
      // HMR is in flight), stash for the IFRAME_READY handler to replay.
      if (!iframeBootstrapped || !applyCheckoutHint(hint)) {
        pendingCheckoutHintRef.current = hint
      }
    }
    window.addEventListener('preview-navigate-after-checkout', handleNavigateAfterCheckout)
    return () => {
      window.removeEventListener('preview-navigate-after-checkout', handleNavigateAfterCheckout)
    }
  }, [appId, applyCheckoutHint, iframeBootstrapped])

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

      if (event.data?.type === 'IFRAME_BOOTING' && fromPreviewIframe) {
        // Early lifecycle beacon: the preview app's own entry script is
        // executing, so the iframe was NOT 307'd to the builder / CSP-blocked.
        // Suppress evidence-based remount immediately (long before the late
        // IFRAME_READY handshake), while still waiting for IFRAME_READY for
        // the full handshake (translations, state restore, etc.).
        setIframeBooting(true)
        return
      }

      if (event.data?.type === 'IFRAME_READY' && fromPreviewIframe) {
        // Mark bootstrap complete: this signal only arrives if the
        // preview app's own script ran, which means the iframe didn't
        // end up on a builder-redirect or CSP-block.
        setIframeBootstrapped(true)

        // Drain any pending checkout hint that arrived before the iframe
        // had a message listener installed. Clearing the ref unconditionally
        // keeps the pending hint at most one cycle old.
        const pendingHint = pendingCheckoutHintRef.current
        pendingCheckoutHintRef.current = null
        if (pendingHint) {
          applyCheckoutHint(pendingHint)
        }

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
          setIsReloading(true)
          if (isEvidenceRecoveryEnabled) {
            // Single key-tracked remount: one load, one recovery cycle. The
            // remount resets the bootstrap/booting/loaded flags (see reset
            // effect) so the bootstrap logic treats this as a fresh attempt
            // rather than racing a parallel forced re-mount against an
            // in-place `src` reassignment. `pendingStateRestore` (set above
            // from event.data.preserveState) is replayed by handleIframeLoad
            // once the new iframe loads.
            setIframeKey((prev) => prev + 1)
          } else if (iframeRef.current) {
            const iframeSrc = iframeRef.current.src
            iframeRef.current.src = iframeSrc

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
  }, [serverState?.isReady, isWaitingForIframeReady, applyCheckoutHint, isEvidenceRecoveryEnabled])

  // Bootstrap-race recovery: if the iframe hasn't signalled IFRAME_READY
  // within the timeout, the most likely cause is the preview_auth cookie
  // wasn't set yet when the iframe first hit the preview origin (race
  // between the bootstrap fetch in useServerPollingStore and the iframe
  // mount). dev-supervisor serves its 401 login page instead of the preview
  // app, so the app's own script never runs — net result is an iframe that
  // never sends IFRAME_READY.
  //
  // Re-mount with a fresh key after the timeout. By the second mount,
  // the bootstrap-fetch retry has settled and the cookie is in the
  // browser, so the new iframe load picks it up via Cookie header.
  // Cap retries to avoid an infinite loop if the failure is permanent
  // (e.g. third-party-cookie blocking with no share-token fallback).
  useEffect(() => {
    // Legacy path: blind 3s timer that remounts on any missing IFRAME_READY.
    // Superseded by the evidence-based effect below when the flag is on.
    if (isEvidenceRecoveryEnabled) return
    if (!previewUrl || !serverState?.isReady) return
    // When the cross-site cookie is ITP-blocked (cookieVerified=false) we
    // deliberately render the dev-supervisor /airo/storage-access bootstrap in
    // place of the preview app (see the cookieVerified===false branch in the
    // render below). isReady is still true in that state — the vite health
    // check passes even when the cookie is partitioned — so without this guard
    // recovery runs against the bootstrap. That page never posts IFRAME_READY
    // by design, so recovery would mistake it for a failed boot and remount it
    // every IFRAME_BOOTSTRAP_RETRY_MS, reloading the "Enable preview" prompt out
    // from under the user and stomping the one-tap requestStorageAccess()
    // gesture. Recovery targets the preview-app iframe only; skip it while the
    // Storage Access bootstrap owns the iframe.
    if (serverState?.cookieVerified === false) return
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
  }, [isEvidenceRecoveryEnabled, previewUrl, serverState?.isReady, serverState?.cookieVerified, iframeBootstrapped, bootstrapRetryCount, appId])

  // Evidence-based bootstrap recovery (flagged). Unlike the legacy timer, a
  // missing IFRAME_READY does NOT imply "broken": a cold-but-healthy preview
  // is merely slow to post it. We wait IFRAME_BOOTSTRAP_PROBE_DELAY_MS, then
  // probe the preview origin — and only remount when the probe positively
  // confirms an auth-block (401/403 from dev-supervisor's JWT middleware).
  // A clean probe means "slow but healthy" → leave the iframe alone so its
  // in-flight load can finish (a remount would abort and restart it). The
  // early IFRAME_BOOTING beacon short-circuits the probe entirely. Probing
  // is bounded by the retry budget.
  //
  // cookieVerified===false guard (mirrors the legacy effect): when ITP has
  // partitioned the cookie, the polling store deliberately renders the
  // /airo/storage-access bootstrap in place of the preview app. isReady is
  // still true in that state, so without this guard the probe would fire
  // every 8s, get a 401 (cookie not sent), remount on every probe window,
  // and burn the full retry budget — leaving no recovery budget for the real
  // iframe after the user taps "Enable preview". Skip while the Storage
  // Access bootstrap owns the iframe.
  //
  // IFRAME_BOOTING + no IFRAME_READY (booting-then-stalled): once iframeBooting
  // is set, this effect exits early forever. A deliberately non-recovering
  // decision: a remount won't fix a deterministic hydration crash, and the
  // in-iframe error overlay surfaces more useful information. The WebKit
  // storage-access fallback (gated on bootstrapRetryCount>=MAX) cannot fire
  // either — this is an accepted trade-off for the BOOTING→stalled case.
  useEffect(() => {
    if (!isEvidenceRecoveryEnabled) return
    if (!previewUrl || !serverState?.isReady) return
    if (iframeBootstrapped) return            // full IFRAME_READY handshake done
    if (iframeBooting) return                 // app JS executing → not auth-blocked (see booting-stalled note above)
    if (serverState?.cookieVerified === false) return  // Storage Access bootstrap owns the iframe
    if (bootstrapRetryCount >= MAX_IFRAME_BOOTSTRAP_RETRIES) return

    let active = true
    const timer = setTimeout(async () => {
      const blocked = await probePreviewAuth(previewUrl)
      if (!active) return
      if (blocked) {
        logger.warn('preview-pane.iframe.bootstrap-timeout', {
          message: 'Auth probe confirmed 401/403 auth block; remounting iframe',
          appId,
          attempt: bootstrapRetryCount + 1,
          reason: 'auth-redirect',
        })
        setBootstrapRetryCount((prev) => prev + 1)
        setIframeKey((prev) => prev + 1)
      } else {
        logger.info('preview-pane.iframe.bootstrap-slow', {
          message: 'Preview slow to signal readiness; auth probe returned clean (no 401/403) — not remounting',
          appId,
          attempt: bootstrapRetryCount + 1,
        })
        // Consume a slot so probing stays bounded; the iframe is left mounted
        // to finish loading.
        setBootstrapRetryCount((prev) => prev + 1)
      }
    }, IFRAME_BOOTSTRAP_PROBE_DELAY_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [isEvidenceRecoveryEnabled, previewUrl, serverState?.isReady, serverState?.cookieVerified, iframeBootstrapped, iframeBooting, bootstrapRetryCount, appId])

  // Reset bootstrap flags whenever the iframe is re-keyed (forced re-mount)
  // or the URL changes — otherwise the previous "bootstrapped" state would
  // leak across attempts and the retry timer wouldn't fire.
  useEffect(() => {
    setIframeBootstrapped(false)
    setIframeBooting(false)
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
    setIsAuthBlocked(false)
  }, [previewUrl])

  // When bootstrap retries are exhausted on WebKit, probe the preview origin
  // to confirm the failure is auth-related (a 401/403 from dev-supervisor) before showing the
  // Storage Access fallback. Non-auth failures (app crash, slow startup) won't
  // trigger the fallback UI.
  useEffect(() => {
    if (iframeBootstrapped) return
    if (bootstrapRetryCount < MAX_IFRAME_BOOTSTRAP_RETRIES) return
    if (!previewUrl || !isWebKit()) return

    let cancelled = false
    probePreviewAuth(previewUrl).then((blocked) => {
      if (!cancelled) setIsAuthBlocked(blocked)
    })
    return () => { cancelled = true }
  }, [iframeBootstrapped, bootstrapRetryCount, previewUrl])

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
    setIsReloading(false)
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
  if (resumeFailed && viewMode !== ViewMode.BRAND && viewMode !== ViewMode.DOMAIN && viewMode !== ViewMode.INBOX && viewMode !== ViewMode.DOCS) {
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
  if ((isHibernated || isResuming) && viewMode !== ViewMode.BRAND && viewMode !== ViewMode.DOMAIN && viewMode !== ViewMode.INBOX && viewMode !== ViewMode.DOCS) {
    return <PreviewLoadingState message={t('builder_preview_resuming_message')} isMobile={isMobile} />
  }

  if (imageReloadFailed && viewMode !== ViewMode.BRAND && viewMode !== ViewMode.DOMAIN && viewMode !== ViewMode.INBOX && viewMode !== ViewMode.DOCS) {
    return (
      <PreviewError
        title={t('builder_preview_image_reload_failed_title')}
        error={t('builder_preview_image_reload_failed_message')}
        buttonText={t('builder_common_try_again')}
        buttonOnClick={onRetryImageReload || onPreviewRefresh}
      />
    )
  }

  if (isImageReloading && viewMode !== ViewMode.BRAND && viewMode !== ViewMode.DOMAIN && viewMode !== ViewMode.INBOX && viewMode !== ViewMode.DOCS) {
    return <PreviewLoadingState message={t('builder_preview_image_reloading_message')} isMobile={isMobile} />
  }

  if (viewMode === ViewMode.DOCS) {
    return (
      <div className="h-full flex flex-col pr-1 md:pr-2.5 pl-1">
        <div className="relative h-full overflow-auto rounded-lg md:rounded-b-none border bg-intents-ux-box-backgroundColor">
          <ErrorBoundary>
            <Suspense fallback={null}>
              <DocsView appId={appId} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  // With canvas-tabs flag on AND the preview server ready, skip the DOMAIN/INBOX
  // early returns so the success-state branch can mount these surfaces as overlays
  // alongside Preview/Code/Brand. Switching tabs then becomes a visibility toggle
  // instead of a remount.
  const canvasTabsOverlayMode = Boolean(isCanvasTabsEnabled && previewUrl && serverState?.isReady)

  if (viewMode === ViewMode.DOMAIN && isTopLevelDomainEnabled && !canvasTabsOverlayMode) {
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

  if (isInboxEnabled && inboxBrandId && viewMode === ViewMode.INBOX && !canvasTabsOverlayMode) {
    return (
      <div className="h-full flex flex-col pr-1 md:pr-2.5 pl-1">
        <div className="relative h-full overflow-auto rounded-lg md:rounded-b-none border bg-intents-ux-box-backgroundColor">
          <Inbox brandId={inboxBrandId} />
        </div>
      </div>
    )
  }

  // Brand Book is rendered as a persistent overlay by the develop page (a stable
  // parent), NOT here — so it is not torn down when this component switches between
  // its server-readiness branches during generation. While BRAND is active this
  // component still renders the preview/code underneath (mounted-but-inert), so
  // tab/iframe state is preserved; the parent overlay covers it.
  if (!serverState || (isPollingServer(appId) && !serverState.isReady)) {
    let loadingMessage: string;
    if (showBuildingOverlay && isAwaitingAskQuestion) {
      loadingMessage = t('builder_preview_question_title', undefined, 'Action needed to continue');
    } else if (showBuildingOverlay) {
      loadingMessage = t(buildingTipsVariant.buildingAppMessageKey, undefined, buildingTipsVariant.buildingAppDefaultMessage);
    } else {
      loadingMessage = t(buildingTipsVariant.loadingAppMessageKey, undefined, buildingTipsVariant.loadingAppDefaultMessage);
    }
    return <PreviewLoadingState message={loadingMessage} isMobile={isMobile} timeEstimateMinutes={buildEstimateMinutes} onTimeEstimateShown={markBuildEstimateShown} />
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

  // Cookie verification failed - browser is blocking cookies needed for preview auth.
  // On WebKit/Safari this is ITP partitioning the cross-site cookie (it exists but
  // isn't sent third-party), NOT a missing session. Rather than dead-ending on a
  // "Try Again" that just re-verifies and re-fails, render the dev-supervisor
  // Storage Access bootstrap in-pane: it requests access on a one-tap gesture and
  // reloads into the preview (carrying the airoShareToken) with the cookie now
  // usable — so the preview loads on the same screen as the chat.
  if (serverState?.cookieVerified === false && serverState.url) {
    if (isWebKit()) {
      return (
        <div className="h-full w-full" data-testid="preview-cookie-blocked-storage-access">
          {/*
            Stable key (NOT iframeKey): the Storage Access bootstrap has its own
            lifecycle — it redirects itself into the preview app once the user
            grants access. Keying it to iframeKey would let a remount reload the
            "Enable preview" prompt and discard the post-grant navigation.
            Bootstrap-race recovery is also disabled in this state (see the
            cookieVerified===false guard on the recovery effect above).
          */}
          <iframe
            key="storage-access-bootstrap"
            ref={iframeRef}
            id="preview-iframe"
            data-testid="preview-iframe"
            src={buildStorageAccessUrl(serverState.url)}
            className={`w-full h-full border rounded-lg md:rounded-b-none transition-opacity duration-150 ${
              isReloading ? 'opacity-70' : 'opacity-100'
            }`}
            onError={handleIframeError}
            onLoad={handleIframeLoad}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-top-navigation-by-user-activation allow-storage-access-by-user-activation"
            title={t('builder_preview_preview_for', { appId })}
          />
        </div>
      )
    }
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
    // Storage Access fallback: only activate when all three conditions hold:
    // 1. iframe never signalled IFRAME_READY after retries exhausted
    // 2. We're on WebKit (Safari ITP is the only browser that blocks this way)
    // 3. A probe confirmed the preview origin returns 401/403 (auth blocked)
    const storageAccessFallback =
      !iframeBootstrapped && bootstrapRetryCount >= MAX_IFRAME_BOOTSTRAP_RETRIES && isAuthBlocked
    const iframeSrc = storageAccessFallback ? buildStorageAccessUrl(previewUrl) : previewUrl
    const showEditingChip = Boolean(
      !isMobile &&
      isPreviewEnhancedOverlaysEnabled &&
      isPreviewSurfaceVisible &&
      !showBuildingOverlay &&
      (isProcessing || isMutatingFiles) &&
      editingChipPosition
    )
    // Edit-mode awareness cue (appbuilder-edit-mode-cue): a persistent frame + tab on the
    // canvas while the user is editing — distinct from the transient processing chip above.
    // Desktop edits via viewMode EDIT; mobile via the inline-edit toggle (the bottom pencil).
    const showEditModeCue = Boolean(
      isEditModeCueEnabled &&
      !showBuildingOverlay &&
      (
        (!isMobile && viewMode === ViewMode.EDIT) ||
        (isMobile && isMobileInlineEditActive)
      )
    )
    return (
      <div className="h-full flex flex-col pr-e md:pe-2.5 ps-1">
        <div className="inset-0 relative h-full">
          <div className="flex flex-col items-center justify-center h-full bg-intents-ux-boxLowContrast-backgroundColor rounded-lg md:rounded-b-none">
            <div className="flex flex-col h-full w-full bg-intents-ux-boxLowContrast-backgroundColor relative rounded-lg md:rounded-b-none">
              {/* Crossfade Animation Container */}
              <div className="relative w-full h-full overflow-hidden">
                {/* Brand View is rendered as a persistent overlay by the develop page
                    (see page.tsx) so it survives this component's readiness branch
                    switches. The preview/code below stays mounted-but-inert under it. */}

                {/* Domain canvas overlay (canvas-tabs flag only). */}
                {isCanvasTabsEnabled && isTopLevelDomainEnabled && hasMountedDomainRef.current && (
                  <div
                    aria-hidden={viewMode !== ViewMode.DOMAIN}
                    inert={viewMode !== ViewMode.DOMAIN || undefined}
                    className={clsx(
                      'absolute inset-0 w-full h-full z-10 rounded-lg md:rounded-b-none overflow-auto bg-intents-ux-box-backgroundColor border transition-opacity duration-200',
                      viewMode === ViewMode.DOMAIN
                        ? 'opacity-100 pointer-events-auto'
                        : 'opacity-0 pointer-events-none',
                    )}
                  >
                    <div className="mx-auto max-w-[960px] p-6">
                      <ErrorBoundary>
                        <DomainPanel />
                      </ErrorBoundary>
                    </div>
                  </div>
                )}

                {isCanvasTabsEnabled && isInboxEnabled && inboxBrandId && hasMountedInboxRef.current && (
                  <div
                    aria-hidden={viewMode !== ViewMode.INBOX}
                    inert={viewMode !== ViewMode.INBOX || undefined}
                    className={clsx(
                      'absolute inset-0 w-full h-full z-10 rounded-lg md:rounded-b-none overflow-auto bg-intents-ux-box-backgroundColor border transition-opacity duration-200',
                      viewMode === ViewMode.INBOX
                        ? 'opacity-100 pointer-events-auto'
                        : 'opacity-0 pointer-events-none',
                    )}
                  >
                    <Inbox brandId={inboxBrandId} />
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
                        'relative border border-b-0 rounded-lg md:rounded-b-none bg-intents-ux-boxLowContrast-backgroundColor overflow-hidden transition-shadow duration-200', {
                          'w-full h-full': isFullSize || isMobile,
                          'my-auto': !isFullSize && !isMobile,
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
                        src={iframeSrc}
                        className={`w-full h-full border rounded-lg md:rounded-b-none transition-opacity duration-150 ${
                          isReloading ? 'opacity-70' : 'opacity-100'
                        }`}
                        onError={handleIframeError}
                        onLoad={handleIframeLoad}
                        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-top-navigation-by-user-activation allow-storage-access-by-user-activation"
                        title={t('builder_preview_preview_for', { appId })}
                        aria-hidden={viewMode === ViewMode.CODE || viewMode === ViewMode.BRAND || showBuildingOverlay ? 'true' : undefined}
                        tabIndex={viewMode === ViewMode.CODE || viewMode === ViewMode.BRAND || showBuildingOverlay ? -1 : undefined}
                        inert={viewMode === ViewMode.CODE || viewMode === ViewMode.BRAND || showBuildingOverlay ? true : undefined}
                      />
                      {/* Shimmering accent frame for Edit mode. A masked gradient ring whose
                          color is driven by currentColor (Proud Purple 200 via
                          text-light-purple-solid), with a light band sweeping along it. */}
                      {showEditModeCue && (
                        <div
                          aria-hidden="true"
                          className="edit-mode-shimmer-border pointer-events-none absolute inset-0 z-10 rounded-lg md:rounded-b-none text-light-purple-solid"
                        />
                      )}
                      {/* Edit-mode tab — fused to the canvas border (frame-accent color) so it
                          reads as frame chrome, not floating content. In-flow inside the shell,
                          so no portal or position tracking. Anchored to the border nearest the
                          edit control: top-right on desktop (toggle up top), bottom-right on
                          mobile (pencil in the bottom toolbar). Hidden while the transient
                          processing chip is up. */}
                      {showEditModeCue && !showEditingChip && (
                        <div
                          data-testid="preview-edit-mode-chip"
                          className={clsx(
                            'edit-mode-chip-shimmer pointer-events-none absolute right-4 z-20 flex items-center px-2 py-0.5 shadow-sm text-sm font-medium leading-none whitespace-nowrap',
                            isMobile ? 'bottom-0 rounded-t-xmd' : 'top-0 rounded-b-xmd',
                          )}
                        >
                          <span className="relative z-[1] text-ai-dark">
                            {t('builder_edit_mode_chip', undefined, 'Edit mode')}
                          </span>
                        </div>
                      )}
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
                        <Canvas.Status
                          data-testid="preview-mobile-status-pill"
                          label={canvasStatusLabel}
                        />
                      ) : (
                        <div className="bg-intents-ux-box-backgroundColor rounded-full px-2 pt-0.5 pb-0 shadow-lg border">
                          <Thinker label={thinkerLabel} indicator={thinkerIndicator} />
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
                  data-testid="preview-building-overlay"
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
                    <Tips
                      buildingMessage={t(
                        buildingTipsVariant.buildingAppMessageKey,
                        undefined,
                        buildingTipsVariant.buildingAppDefaultMessage,
                      )}
                      timeEstimateMinutes={buildEstimateMinutes}
                      onTimeEstimateShown={markBuildEstimateShown}
                    />
                  )}
                </div>
              )}
              {isPortalReady && showEditingChip && editingChipPosition && createPortal(
                <motion.div
                  key="preview-editing-chip"
                  data-testid="preview-editing-chip"
                  className="fixed"
                  style={{
                    left: editingChipPosition.left,
                    top: editingChipPosition.top,
                  }}
                  initial={{ opacity: 0, x: '-50%', y: -4 }}
                  animate={{ opacity: 1, x: '-50%', y: 0 }}
                  transition={{ duration: 0.175 }}
                >
                  <Canvas.Status label={canvasStatusLabel} />
                </motion.div>,
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

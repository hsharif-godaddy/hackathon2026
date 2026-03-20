'use client'

import clsx from 'clsx'
import { animate, motion, useMotionValue } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader } from '@airo-ux/loader'
import Alert from '@ux/alert'
import Button from '@ux/button'

import { getDevicePreset } from '@/app/develop/components/preview/devicePresets'
import PreviewCode from '@/app/develop/components/preview/PreviewCode'
import PreviewError from '@/app/develop/components/preview/PreviewError'
import PreviewHeader from '@/app/develop/components/preview/PreviewHeader'
import Tips from '@/app/develop/components/tips/Tips'
import { PreviewViewMode, ViewMode } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useRestoreCommitMutation } from '@/hooks/useRestoreCommitMutation'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitStore } from '@/stores/useGitStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { postMessageToIframe } from '@/utils/postMessage'

// Timing constants for iframe lifecycle management
const REFRESH_DEBOUNCE_MS = 500 // Debounce rapid refresh requests
const STATE_RESTORE_FALLBACK_MS = 3000 // Fallback timeout if iframe doesn't send ready signal
/** Eval snapshot: IFRAME_READY means the iframe has registered its message listener; HMR-only builds use fallback */
const EVAL_SNAPSHOT_IFRAME_FALLBACK_MS = 8000

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

interface PreviewPaneProps {
  onPreviewRefresh: () => void
  isMobile?: boolean
  showBuildingOverlay?: boolean
  fixingOverlayMessage?: string | null
  isHibernated?: boolean
  isResuming?: boolean
  resumeFailed?: boolean
  onRetryResume?: () => void
  isImageReloading?: boolean
  imageReloadFailed?: boolean
  onRetryImageReload?: () => void
}

export default function PreviewPane({
  onPreviewRefresh,
  isMobile = false,
  showBuildingOverlay = false,
  fixingOverlayMessage = null,
  isHibernated = false,
  isResuming = false,
  resumeFailed = false,
  onRetryResume,
  isImageReloading = false,
  imageReloadFailed = false,
  onRetryImageReload,
}: PreviewPaneProps) {
  const t = useTranslations();

  const getServerState = useServerPollingStore((state) => state.getServerState)
  const isPollingServer = useServerPollingStore((state) => state.isPollingServer)
  const startPollingForServer = useServerPollingStore((state) => state.startPollingForServer)
  const stopPollingForServer = useServerPollingStore((state) => state.stopPollingForServer)

  const restoreMutation = useRestoreCommitMutation();

  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const selectedDeviceId = useDevelopPageStore((state) => state.selectedDeviceId)
  const setPreviewViewMode = useDevelopPageStore((state) => state.setPreviewViewMode)
  const isPollingEntitlements = useDevelopPageStore((state) => state.isPollingEntitlements)

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

  const appId = useAppIdFromParams();
  const isPublishing = useDevelopPageStore((state) =>
    appId ? (state.publishStates?.[appId]?.isPublishing ?? false) : false
  );

  // Get selected commit hash from git store
  const selectedCommitHash = useGitStore((state) => appId ? state.getSelectedCommitHash(appId) : null)

  // Get commits to determine if selected commit is the latest
  const { data } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  });
  // Memoize commits to prevent unnecessary recalculations from array reference changes
  const commits = useMemo(() => data?.commits || [], [data?.commits])

  // Derive selected commit object from hash
  const selectedCommit = useMemo(() => {
    if (!selectedCommitHash || !commits.length) return null
    return commits.find(c => c.hash === selectedCommitHash) ?? null
  }, [selectedCommitHash, commits]);

  useEffect(() => {
    if (isMobile) {
      setPreviewViewMode(PreviewViewMode.MOBILE)
    } else {
      setPreviewViewMode(PreviewViewMode.DESKTOP)
    }
  }, [isMobile, setPreviewViewMode])

  const serverState = getServerState(appId)
  const previewUrl = serverState?.isReady ? serverState.url : null

  const latestCommit = commits.length > 0 ? commits[0] : null
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)

  const isViewingHistoricalCommit = selectedCommit && latestCommit && selectedCommit.hash !== latestCommit.hash && isVersionHistoryOpen

  // Iframe state
  const [iframeError, setIframeError] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

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

  // Track previous viewMode to determine flip direction
  const previousViewModeRef = useRef<ViewMode>(viewMode)

  // Motion values for smooth animation control
  const rotateY = useMotionValue(0)
  const scale = useMotionValue(1)

  // Calculate rotation angle and animate scale based on viewMode transition
  useEffect(() => {
    const previous = previousViewModeRef.current
    const current = viewMode

    if (previous === current) return

    // Skip animation on mobile for better performance and UX
    if (isMobile) {
      const targetRotation = current === ViewMode.CODE ? 180 : 0
      rotateY.set(targetRotation)
      scale.set(1)
      previousViewModeRef.current = current
      return
    }

    const targetRotation = current === ViewMode.CODE ? 180 : 0

    // Animate rotation
    animate(rotateY, targetRotation, {
      duration: 0.5,
      ease: [0.4, 0, 0.2, 1]
    })

    // Animate scale: 1 -> 0.92 -> 1 (scale down at midpoint, scale back up at end)
    animate(scale, [1, 0.85, 1], {
      duration: 0.5,
      ease: "easeOut",
      times: [0, 0.5, 1]
    })

    previousViewModeRef.current = current
  }, [viewMode, rotateY, scale, isMobile])

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

  // Server polling lifecycle - PreviewPane owns its server state
  // The store prevents duplicate polling if multiple components try to poll the same appId
  useEffect(() => {
    if (!appId) return

    startPollingForServer(appId)

    return () => {
      stopPollingForServer(appId)
    }
  }, [appId, startPollingForServer, stopPollingForServer])

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

  // Listen for file save events and preview refresh requests to auto-refresh preview
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const fromPreviewIframe =
        iframeRef.current?.contentWindow != null && event.source === iframeRef.current.contentWindow

      if (event.data?.type === 'VIEWPORT_SCREENSHOT_RESPONSE' && fromPreviewIframe) {
        pendingEvalFullHeightRef.current = false
        if (evalFullHeightFallbackTimerRef.current !== null) {
          clearTimeout(evalFullHeightFallbackTimerRef.current)
          evalFullHeightFallbackTimerRef.current = null
        }
      }

      if (event.data?.type === 'IFRAME_READY' && fromPreviewIframe) {
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
        return
      }

      if ((event.data.type === 'file-saved' || event.data.type === 'preview-refresh') && serverState?.isReady) {
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
            iframeRef.current.src = iframeRef.current.src

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

  const handleManualRetry = () => {
    logger.info('preview-pane.retry', { message: 'Manual retry - restarting server polling', appId })
    // Restart polling to recover from server errors
    // This is the only place PreviewPane manages polling (for error recovery)
    // Normal polling lifecycle is managed by parent component
    stopPollingForServer(appId)
    startPollingForServer(appId)
    setIframeError(false)
    setIframeKey(prev => prev + 1)
  }

  function handleRestoreConfirm() {
    if (!selectedCommit) return

    restoreMutation.mutate(
      { appId, commitHash: selectedCommit.hash },
      {
        onSuccess: () => {
          logger.info('preview-pane.restore.success', {
            message: 'Successfully restored commit',
            appId,
            commitHash: selectedCommit.hash.substring(0, 7)
          })
        },
        onError: (error) => {
          logger.error('preview-pane.restore.error', {
            message: 'Failed to restore commit',
            appId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    )
  }

  const handleIframeError = () => {
    logger.warn('preview-pane.iframe.error', { message: 'Iframe error', appId })
    setIframeError(true)
  }

  // Show error state when resume failed
  if (resumeFailed) {
    return (
      <PreviewError
        title={t('builder_preview_resume_failed_title')}
        error={t('builder_preview_resume_failed_message')}
        buttonText={t('builder_common_try_again')}
        buttonOnClick={onRetryResume || onPreviewRefresh}
      />
    )
  }

  // Show restarting message when app is hibernated or resuming
  if (isHibernated || isResuming) {
    return <Tips buildingMessage={t('builder_preview_resuming_message')} />
  }

  if (imageReloadFailed) {
    return (
      <PreviewError
        title={t('builder_preview_image_reload_failed_title')}
        error={t('builder_preview_image_reload_failed_message')}
        buttonText={t('builder_common_try_again')}
        buttonOnClick={onRetryImageReload || onPreviewRefresh}
      />
    )
  }

  if (isImageReloading) {
    return <Tips buildingMessage={t('builder_preview_image_reloading_message')} />
  }

  if (isPollingEntitlements) {
    // We don't want to show tips when polling entitlements
    return <Tips buildingMessage={t('builder_preview_updating_suscription')} showTips={false} />
  }

  // Don't show building overlay here - it should overlay the iframe below, not replace it
  // Only block rendering if server is not ready yet
  if (!serverState || (isPollingServer(appId) && !serverState.isReady)) {
    // Show building overlay message if in creation flow, otherwise show server loading
    const loadingMessage = showBuildingOverlay
      ? t('builder_preview_building_app')
      : t('builder_preview_loading_app')
    return <Tips buildingMessage={loadingMessage} />
  }

  // Error state when server failed
  if (serverState?.status === 'failed' || serverState?.status === 'error') {
    return (
      <PreviewError
        title={t('builder_preview_server_error')}
        error={serverState.error || t('builder_preview_server_error_text')}
        buttonText={t('builder_common_try_again')}
        buttonOnClick={handleManualRetry}
      />
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
      />
    )
  }

  // Success state - show the preview
  if (previewUrl && serverState?.isReady) {
    return (
      <div className="h-full flex flex-col">
        {isViewingHistoricalCommit && !isPublishing && (
          <div className="mx-1 my-1 md:mx-2 md:my-0">
            <Alert
              emphasis="info"
              actions={
                <Button
                  design="secondary"
                  size="sm"
                  onClick={handleRestoreConfirm}
                  disabled={restoreMutation.isPending}
                  title={t('builder_preview_git_title')}
                >
                  {restoreMutation.isPending ? t('builder_preview_error_restoring') : t('builder_preview_error_restore')}
                </Button>
              }
            >
              {t('builder_preview_git_text')}
            </Alert>
          </div>
        )}

        <div className={clsx(
          "inset-0 relative h-full", {
            "p-2": !isMobile
          }
        )}>
          <div className={clsx(
            "flex flex-col items-center justify-center h-full bg-intents-ux-boxLowContrast-backgroundColor", {
              "rounded-lg border": !isMobile
            }
          )}>
            <div
              className={clsx(
                "flex flex-col h-full w-full bg-intents-ux-boxLowContrast-backgroundColor relative", {
                  "rounded-lg p-1.5": !isMobile,
                  "p-0": isMobile
                }
              )}
            >
              <PreviewHeader onPreviewRefresh={onPreviewRefresh} isMobile={isMobile} />

              {/* 3D Flip Card Container */}
              <div className="relative w-full h-full overflow-hidden" style={{ transformStyle: 'preserve-3d' }}>
                <motion.div
                  className="relative w-full h-full"
                  style={{
                    transformStyle: 'preserve-3d',
                    rotateY,
                    scale
                  }}
                >
                  {/* Front Face - Preview (iframe) */}
                  <div
                    className="absolute inset-0 w-full h-full flex items-center justify-center pb-1 md:pb-0 px-2 md:px-0"
                    style={{
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden'
                    }}
                  >
                    <div
                      className={clsx(
                        "relative transition-all duration-300 ease-in-out", {
                          "w-full h-full": isFullSize || isMobile,
                          "border shadow-lg": !isFullSize && !isMobile,
                          "my-auto": !isFullSize && !isMobile
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
                        className="w-full h-full border rounded-md"
                        onError={handleIframeError}
                        onLoad={handleIframeLoad}
                        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-top-navigation-by-user-activation"
                        title={t('builder_preview_preview_for', { appId })}
                        aria-hidden={viewMode === ViewMode.CODE || showBuildingOverlay ? 'true' : undefined}
                        tabIndex={viewMode === ViewMode.CODE || showBuildingOverlay ? -1 : undefined}
                        // Type assertion needed: `inert` is a standard HTML attribute but not yet in React types
                        {...(viewMode === ViewMode.CODE || showBuildingOverlay ? { inert: '' as unknown as boolean } : {})}
                      />
                    </div>
                  </div>

                  {/* Back Face - Code Editor */}
                  <div
                    className="absolute inset-0 w-full h-full"
                    style={{
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)'
                    }}
                    aria-hidden={viewMode === ViewMode.PREVIEW ? 'true' : undefined}
                    {...(viewMode === ViewMode.PREVIEW ? { inert: '' as unknown as boolean } : {})}
                  >
                    <PreviewCode appId={appId} />
                  </div>
                </motion.div>
              </div>

              {/* Building overlay - hides template app AND controls until agent makes changes
                   INTENTIONAL: Stays visible if agent never edits (errors, timeouts, etc.)
                   The vanilla template is an implementation detail that shouldn't be visible */}
              {showBuildingOverlay && (
                <div className="absolute inset-0 z-50 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg">
                  <Tips buildingMessage={t('builder_preview_building_app')} />
                </div>
              )}
              {fixingOverlayMessage && (
                <div className="absolute inset-0 z-50 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg">
                  <Tips buildingMessage={fixingOverlayMessage} />
                </div>
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

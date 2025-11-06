'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import clsx from 'clsx'
import { ClockIcon } from '@heroicons/react/24/outline'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { useGitHistoryStore } from '@/stores/useGitHistoryStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { postMessageToIframe } from '@/utils/postMessage'
import PreviewError from './PreviewError'
import Button from '@ux/button'
import { logger } from '@/lib/request-context'
import PreviewHeader from './PreviewHeader'
import PreviewCode from './PreviewCode'
import { ViewMode, PreviewViewMode } from '../types'

// Timing constants for iframe lifecycle management
const REFRESH_DEBOUNCE_MS = 500 // Debounce rapid refresh requests
const STATE_RESTORE_FALLBACK_MS = 3000 // Fallback timeout if iframe doesn't send ready signal

interface PreviewPaneProps {
  onPreviewRefresh: () => void
  isMobile?: boolean
}

export default function PreviewPane({onPreviewRefresh, isMobile = false}: PreviewPaneProps) {
  const {
    getServerState,
    startPollingForServer,
    stopPollingForServer,
    isPollingServer
  } = useServerPollingStore()

  const {
    isRestoring,
    restoreCommit,
    refreshGitHistory,
    getCommits
  } = useGitHistoryStore()

  const {
    previewViewMode,
    viewMode,
    setPreviewViewMode,
    selectedCommit
  } = useDevelopPageStore()

  const appId = useAppIdFromParams()
  const restoring = isRestoring(appId)

  useEffect(() => {
    if (isMobile) {
      setPreviewViewMode(PreviewViewMode.MOBILE)
    }
  }, [isMobile, setPreviewViewMode])

  const serverState = getServerState(appId)
  const previewUrl = serverState?.isReady ? serverState.url : null

  // Get commits to determine if selected commit is the latest
  const commits = getCommits(appId)
  const latestCommit = commits.length > 0 ? commits[0] : null
  const isViewingHistoricalCommit = selectedCommit && latestCommit && selectedCommit.hash !== latestCommit.hash

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

  // Start polling when component mounts
  useEffect(() => {
    if (!appId) return

    logger.info('preview-pane.polling.start', { message: 'Starting server polling', appId })
    startPollingForServer(appId)

    return () => {
      logger.info('preview-pane.polling.stop', { message: 'Stopping server polling', appId })
      stopPollingForServer(appId)
    }
  }, [appId, startPollingForServer, stopPollingForServer])

  // Handle iframe load and restore scroll position if pending
  const handleIframeLoad = useCallback(() => {
    setIframeError(false)

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
          const fallbackTimer = setTimeout(() => {
            if (isWaitingForIframeReady) {
              logger.warn('preview-pane.iframe.timeout', { message: 'Iframe ready timeout, attempting state restoration anyway' })
              attemptStateRestoration()
            }
          }, STATE_RESTORE_FALLBACK_MS)

          // Clear timer when component unmounts or state changes
          return () => clearTimeout(fallbackTimer)
        } else {
          logger.debug('preview-pane.state-restore.url-mismatch', { message: 'URL mismatch, clearing pending state restoration' })
          setPendingStateRestore(null)
        }
      } catch (error) {
        logger.warn('preview-pane.state-restore.parse-error', { message: 'Failed to parse URLs for state restoration', error: error instanceof Error ? error.message : String(error) })
        setPendingStateRestore(null)
      }
    }
  }, [appId, pendingStateRestore, isWaitingForIframeReady]) // eslint-disable-line react-hooks/exhaustive-deps

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

    try {
      // Try to access iframe content and restore scroll position
      const contentWindow = iframeRef.current.contentWindow

      if (contentWindow && pendingStateRestore.scrollPosition) {
        contentWindow.scrollTo(
          pendingStateRestore.scrollPosition.x,
          pendingStateRestore.scrollPosition.y
        )
      }
    } catch (error) {
      // If direct access fails (cross-origin), try postMessage as fallback
      try {
        const restoreMessage = {
          type: 'RESTORE_STATE_AFTER_REFRESH',
          url: pendingStateRestore.url,
          scrollPosition: pendingStateRestore.scrollPosition
        }
        postMessageToIframe(iframeRef.current, restoreMessage)
      } catch (postMessageError) {
        logger.error('preview-pane.state-restore.failure', { message: 'Failed to restore state', error: postMessageError instanceof Error ? postMessageError.message : String(postMessageError) })
      }
    }

    // Clear pending state and waiting flag
    setPendingStateRestore(null)
    setIsWaitingForIframeReady(false)
  }, [pendingStateRestore])

  // Listen for file save events and preview refresh requests to auto-refresh preview
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Handle iframe ready signal for immediate state restoration
      if (event.data.type === 'IFRAME_READY' && isWaitingForIframeReady) {
        logger.debug('preview-pane.iframe.ready', { message: 'Iframe ready signal received, restoring state immediately' })
        attemptStateRestoration()
        return
      }

      if ((event.data.type === 'file-saved' || event.data.type === 'preview-refresh') && serverState?.isReady) {
        // Store state to restore if provided
        if (event.data.preserveState) {
          setPendingStateRestore(event.data.preserveState)
        }

        // Debounce refreshes to avoid too many reloads
        setTimeout(() => {
          if (iframeRef.current) {
            iframeRef.current.src = iframeRef.current.src

            // If we have scroll position to restore, do it after iframe loads
            if (event.data.preserveState?.scrollPosition) {
              setTimeout(() => {
                try {
                  const contentWindow = iframeRef.current?.contentWindow
                  if (contentWindow) {
                    contentWindow.scrollTo(
                      event.data.preserveState.scrollPosition.x,
                      event.data.preserveState.scrollPosition.y
                    )
                  }
                } catch (error) {
                  // Cross-origin, try postMessage
                  if (iframeRef.current) {
                    postMessageToIframe(iframeRef.current, {
                      type: 'RESTORE_STATE_AFTER_REFRESH',
                      scrollPosition: event.data.preserveState.scrollPosition
                    })
                  }
                }
              }, 500) // Wait for iframe to load
            }
          }
        }, REFRESH_DEBOUNCE_MS)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [serverState?.isReady, isWaitingForIframeReady, attemptStateRestoration])

  const handleManualRetry = () => {
    logger.info('preview-pane.retry', { message: 'Manual retry for server', appId })
    // Restart polling for this server
    stopPollingForServer(appId)
    startPollingForServer(appId)
    setIframeError(false)
    setIframeKey(prev => prev + 1)
  }

  const handleRestoreConfirm = async () => {
    if (!selectedCommit) return

    const success = await restoreCommit(appId, selectedCommit.hash)

    if (success) {
      refreshGitHistory(appId)
    }
  }

  const handleIframeError = () => {
    logger.warn('preview-pane.iframe.error', { message: 'Iframe error', appId })
    setIframeError(true)
  }

  // Loading state while polling
  if (!serverState || (isPollingServer(appId) && !serverState.isReady)) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <ClockIcon className="w-8 h-8 animate-spin mb-4" />
        <h3 className="text-lg font-semibold mb-2">Starting Server</h3>
        <p className="text-sm mb-2">
          {serverState?.status === 'pending'
            ? 'Waiting for server to start...'
            : serverState?.status === 'running'
            ? serverState.url && !serverState.healthCheckPassed
              ? 'Server is starting, waiting for it to accept connections...'
              : 'Server is running, verifying readiness...'
            : 'Checking server status...'}
        </p>
        <p className="text-xs text-center max-w-md">
          This usually takes 30-60 seconds for the first load.
        </p>
        {serverState?.url && !serverState.healthCheckPassed && (
          <p className="text-xs text-center max-w-md mt-2 text-gray-500">
            Preview URL: {serverState.url}
          </p>
        )}
      </div>
    )
  }

  // Error state when server failed
  if (serverState?.status === 'failed' || serverState?.status === 'error') {
    return (
      <PreviewError
        title="Server Error"
        error={serverState.error || 'The server encountered an error and could not start.'}
        buttonText="Try Again"
        buttonOnClick={handleManualRetry}
      />
    )
  }

  // Error state when iframe fails to load
  if (iframeError && previewUrl) {
    return (
      <PreviewError
        title="Preview Error"
        error="The preview could not load. This might be a temporary issue."
        buttonText="Reload Preview"
        buttonOnClick={handleManualRetry}
      />
    )
  }

  // Success state - show the preview
  if (previewUrl && serverState?.isReady) {
    return (
      <div className="h-full flex flex-col">
        {isViewingHistoricalCommit && (
          <div className="bg-intents-ux-feedbackInfo-feedbackColor rounded p-2 mx-4">
            <div className="flex items-center items-space-between w-full">
              <span className="font-mono px-2 text-sm py-1 rounded mr-2 grow">
                This is a preview of a previous version of the app.
              </span>
              <Button
                design="control"
                size="sm"
                onClick={handleRestoreConfirm}
                disabled={restoring}
                title="Restore files from this commit"
              >
                {restoring ? 'Restoring...' : `Restore to ${selectedCommit ? selectedCommit.hash.substring(0, 7) : 'this commit'}`}
              </Button>
            </div>
          </div>
        )}

        <div className={clsx(
          "inset-0 relative h-full", {
            "p-4": !isMobile
          }
        )}>
          <div className={clsx(
            "flex flex-col items-center justify-center h-full  bg-intents-ux-boxLowContrast-backgroundColor ", {
              "rounded-lg shadow-lg": !isMobile
            }
          )}>
            <div className={clsx(
              "flex flex-col h-full bg-intents-ux-boxLowContrast-backgroundColor transition-all duration-300 ease-in-out", {
                "w-[430px] mx-auto my-4 max-h-[980px]": previewViewMode === PreviewViewMode.MOBILE && viewMode === ViewMode.PREVIEW && !isMobile,
                "w-full": previewViewMode === PreviewViewMode.DESKTOP || viewMode === ViewMode.CODE || isMobile,
                "rounded-lg shadow-lg p-3 border": !isMobile,
                "p-0": isMobile
              }
            )}>
              <PreviewHeader onPreviewRefresh={onPreviewRefresh} isMobile={isMobile} />
              {viewMode === ViewMode.PREVIEW && (
                <iframe
                  key={iframeKey}
                  ref={iframeRef}
                  id="preview-iframe"
                  src={previewUrl}
                  className="w-full h-full md:border md:rounded-md"
                  onError={handleIframeError}
                  onLoad={handleIframeLoad}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-top-navigation-by-user-activation"
                  title={`Preview for ${appId}`}
                />
              )}
              {viewMode === ViewMode.CODE && (
                <PreviewCode appId={appId} />
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
      <ClockIcon className="w-8 h-8 animate-spin mb-4" />
      <h3 className="text-lg font-semibold mb-2">Loading Preview</h3>
      <p className="text-sm">Preparing your application preview...</p>
    </div>
  )
}

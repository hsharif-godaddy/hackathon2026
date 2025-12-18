'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useMemo,useRef, useState } from 'react'
import { Loader } from '@airo-ux/loader'
import Button from '@ux/button'

import PreviewCode from '@/app/develop/components/preview/PreviewCode'
import PreviewError from '@/app/develop/components/preview/PreviewError'
import PreviewHeader from '@/app/develop/components/preview/PreviewHeader'
import Tips from '@/app/develop/components/tips/Tips'
import { PreviewViewMode,ViewMode } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useRestoreCommitMutation } from '@/hooks/useRestoreCommitMutation'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitStore } from '@/stores/useGitStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { postMessageToIframe } from '@/utils/postMessage'

// Timing constants for iframe lifecycle management
const REFRESH_DEBOUNCE_MS = 500 // Debounce rapid refresh requests
const STATE_RESTORE_FALLBACK_MS = 3000 // Fallback timeout if iframe doesn't send ready signal

interface PreviewPaneProps {
  onPreviewRefresh: () => void
  isMobile?: boolean
  showBuildingOverlay?: boolean
  isHibernated?: boolean
  isResuming?: boolean
  resumeFailed?: boolean
  onRetryResume?: () => void
}

export default function PreviewPane({
  onPreviewRefresh,
  isMobile = false,
  showBuildingOverlay = false,
  isHibernated = false,
  isResuming = false,
  resumeFailed = false,
  onRetryResume,
}: PreviewPaneProps) {
  const t = useTranslations();

  const getServerState = useServerPollingStore((state) => state.getServerState)
  const startPollingForServer = useServerPollingStore((state) => state.startPollingForServer)
  const stopPollingForServer = useServerPollingStore((state) => state.stopPollingForServer)
  const isPollingServer = useServerPollingStore((state) => state.isPollingServer)

  const restoreMutation = useRestoreCommitMutation();

  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const setPreviewViewMode = useDevelopPageStore((state) => state.setPreviewViewMode)
  const isPollingEntitlements = useDevelopPageStore((state) => state.isPollingEntitlements)

  const appId = useAppIdFromParams();

  // Get selected commit hash from git store
  const selectedCommitHash = useGitStore((state) => appId ? state.getSelectedCommitHash(appId) : null)

  // Get commits to determine if selected commit is the latest
  const { data: commits = [] } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  });

  // Derive selected commit object from hash
  const selectedCommit = useMemo(() => {
    if (!selectedCommitHash || !commits.length) return null
    return commits.find(c => c.hash === selectedCommitHash) ?? null
  }, [selectedCommitHash, commits]);

  useEffect(() => {
    if (isMobile) {
      setPreviewViewMode(PreviewViewMode.MOBILE)
    }
  }, [isMobile, setPreviewViewMode])

  const serverState = getServerState(appId)
  const previewUrl = serverState?.isReady ? serverState.url : null

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

    startPollingForServer(appId)

    return () => {
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

  if (isPollingEntitlements) {
    // We don't want to show tips when polling entitlements
    return <Tips buildingMessage={t('builder_preview_updating_suscription')} showTips={false} />
  }

  if (showBuildingOverlay) {
    return <Tips buildingMessage={t('builder_preview_building_app')} />
  }

  if (!serverState || (isPollingServer(appId) && !serverState.isReady)) {
    return <Tips buildingMessage={t('builder_preview_loading_app')} />
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
        {isViewingHistoricalCommit && (
          <div className="bg-intents-ux-feedbackInfo-feedbackColor rounded pl-1 pr-2 py-1 mx-1 my-1 md:mx-2 md:my-0">
            <div className="flex items-center items-space-between w-full">
              <span className="font-mono px-1 text-sm py-0.5 rounded mr-1 grow">
                {t('builder_preview_git_text')}
              </span>
              <Button
                design="secondary"
                size="sm"
                onClick={handleRestoreConfirm}
                disabled={restoreMutation.isPending}
                title={t('builder_preview_git_title')}
              >
                {restoreMutation.isPending
                  ? t('builder_preview_error_restoring')
                  : `${t('builder_preview_error_restore_to')} ${selectedCommit ? selectedCommit.hash.substring(0, 7) : t('builder_preview_error_this_commit')}`
                }
              </Button>
            </div>
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
            <div className={clsx(
              "flex flex-col h-full bg-intents-ux-boxLowContrast-backgroundColor transition-all duration-300 ease-in-out", {
                "w-[430px] mx-auto my-2 max-h-[980px]": previewViewMode === PreviewViewMode.MOBILE && viewMode === ViewMode.PREVIEW && !isMobile,
                "w-full": previewViewMode === PreviewViewMode.DESKTOP || viewMode === ViewMode.CODE || isMobile,
                "border shadow-lg": previewViewMode === PreviewViewMode.MOBILE && viewMode === ViewMode.PREVIEW && !isMobile,
                "rounded-lg p-1.5": !isMobile,
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
                  title={t('builder_preview_preview_for', { appId })}
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
      <Loader
        title={t('builder_preview_loading_title')}
        description={t('builder_preview_loading_text')}
      />
    </div>
  )
}

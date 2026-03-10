'use client'

import { motion } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Growl from '@ux/growl'

import AppNotFound from '@/app/develop/components/AppNotFound'
import ChatPane from '@/app/develop/components/chat/ChatPane'
import ChatPaneLoader, { ResumeLoaderPhase } from '@/app/develop/components/chat/ChatPaneLoader'
import ChatToolbar from '@/app/develop/components/chat/ChatToolbar'
import { MediaSlotDialog } from '@/app/develop/components/media/MediaSlotDialog'
import { DevelopCreditsModal, SinglePlanUpgradeContainer } from '@/app/develop/components/paywall'
import PreviewPane from '@/app/develop/components/preview/PreviewPane'
import ResizableDivider from '@/app/develop/components/ResizableDivider'
import SettingsView from '@/app/develop/components/settings/SettingsView'
import { AppIntroTour } from '@/app/develop/components/tour/AppIntroTour'
import { ChatTab } from '@/app/develop/components/types'
import { extractNewPageRoute, handlePreviewRefresh, navigatePreviewToRoute, requestPreviewScreenshot, useAppIdFromParams } from '@/app/develop/components/utils'
import VersionHistory from '@/app/develop/components/VersionHistory'
import { clearExpiredWidgetStates } from '@/app/develop/components/widgets'
import { useInitialization } from '@/app/develop/hooks/useInitialization'
import { ProtectedRoute } from '@/components/auth'
import { Feedback } from '@/components/feedback/Feedback'
import { FEEDBACK_ID } from '@/components/feedback/utils'
import Header from '@/components/layout/Header'
import PostPublishGoLiveModal from '@/components/layout/PostPublishGoLiveModal'
import PublishLimitModal from '@/components/layout/PublishLimitModal'
import PublishStatusAlert from '@/components/layout/PublishStatusAlert'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { useAppDetails } from '@/hooks/useAppDetails'
import { useAppHibernation } from '@/hooks/useAppHibernation'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { usePageTiming } from '@/hooks/usePageTiming'
import { usePaywallPrefetch } from '@/hooks/usePaywallPrefetch'
import { useRumAppContext } from '@/hooks/useRumAppContext'
import { useStreamingWebSocket } from '@/hooks/useStreamingWebSocket'
import { useSyncResponsiveState } from '@/hooks/useSyncResponsiveState'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { cn } from '@/lib/utils'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
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
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'

function DevelopPageContent() {
  const t = useTranslations();
  const searchParams = useSearchParams()
  const router = useRouter()
  const appId = useAppIdFromParams()
  const isJobId = searchParams.get('type') === 'job'
  const { getUserInfo } = useAuthContext()

  const customerId = useMemo(() => getUserInfo()?.customerId, [getUserInfo])

  useRumAppContext({ appId, customerId })

  // Prefetch paywall data early for faster eligibility checks
  usePaywallPrefetch()

  // Unified initialization hook - handles all sequencing and UI state
  const init = useInitialization({ appId, isJobId })

  // Hibernation handling - auto-resume when app is hibernated
  const appDetails = useAppDetails(appId);
  const hibernation = useAppHibernation(appDetails.data, appId, true);

  // Log when resume completes - history will be loaded via WebSocket
  useEffect(() => {
    if (hibernation.resumeComplete && appId) {
      logger.info('app-hibernation.post-resume-ready', {
        appId,
        message: 'Resume complete, WebSocket will stream history'
      });
    }
  }, [hibernation.resumeComplete, appId]);

  // Server polling store - only used for cleanup on unmount
  // Note: Server polling lifecycle is managed by PreviewPane component
  const cleanupServerPolling = useServerPollingStore((state) => state.cleanup)

  // Streaming conversation store - for messages and active stream
  const messages = useMessages()
  const activeStream = useActiveStream()
  const setInputValue = useSetInputValue()
  const setAiEditContext = useSetAiEditContext()
  const autoSendInitialMessage = useAutoSendInitialMessage()
  const { sendMessage, loadMoreHistory, webSocketState } = useStreamingWebSocket()
  const isLoading = useIsLoading()
  const isStreaming = useIsActivelyStreaming()

  const chatPaneWidth = useDevelopPageStore((state) => state.chatPaneWidth)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const { activeChatTab } = useChatTabs()
  const isPreviewVisible = useDevelopPageStore((state) => state.isPreviewVisible)
  const loadingPhase = useDevelopPageStore((state) => state.loadingPhase)
  const openFeedbackId = useDevelopPageStore((state) => state.openFeedbackId)
  const showIntroTour = useDevelopPageStore((state) => state.showIntroTour)

  const setChatPaneWidth = useDevelopPageStore((state) => state.setChatPaneWidth)
  const setIsSelectMode = useDevelopPageStore((state) => state.setIsSelectMode)
  const closeFeedbackModal = useDevelopPageStore((state) => state.closeFeedbackModal)
  const setIsPreviewVisible = useDevelopPageStore((state) => state.setIsPreviewVisible)
  const setShowIntroTour = useDevelopPageStore((state) => state.setShowIntroTour)
  const checkAndTriggerIntroTour = useDevelopPageStore((state) => state.checkAndTriggerIntroTour)
  const site = useDevelopPageStore((state) => state.site);
  const isAssetManagerOpen = useDevelopPageStore((state) => state.isAssetManagerOpen);
  const setIsAssetManagerOpen = useDevelopPageStore((state) => state.setIsAssetManagerOpen);
  const showUpgradeModal = useDevelopPageStore((state) => state.showUpgradeModal);
  const upgradeModalSource = useDevelopPageStore((state) => state.upgradeModalSource);
  const upgradeModalItc = useDevelopPageStore((state) => state.upgradeModalItc);
  const closeUpgradeModal = useDevelopPageStore((state) => state.closeUpgradeModal);
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal);
  const publishLimitModalState = useDevelopPageStore((state) =>
    appId ? state.publishStates[appId] : undefined
  );
  const showPublishLimitModal = publishLimitModalState?.showPublishLimitModal ?? false;
  const publishLimitData = publishLimitModalState?.publishLimitData;
  const setShowPublishLimitModal = useDevelopPageStore((state) => state.setShowPublishLimitModal);
  const setShowPaywallModal = useDevelopPageStore((state) => state.setShowPaywallModal);

  useGitHistoryQuery({
    appId: appId || '',
    enabled: loadingPhase === 'ready' && !!appId && !!site?.agent_url
  })

  // Track page timing with RUM
  usePageTiming('develop-page', appId)

  // Local state (only what's not in stores)
  const [selectedElement, setSelectedElement] = useState<unknown>(null)
  // Optimistic mobile tab state for instant transitions
  const [optimisticMobileTab, setOptimisticMobileTab] = useState<ChatTab>(activeChatTab)
  // Track preview updates for mobile notification
  const [hasPreviewUpdate, setHasPreviewUpdate] = useState(false)
  // Track when an error fix request is in progress to show the fixing overlay
  const [isFixingError, setIsFixingError] = useState(false)
  const isFixingErrorRef = useRef(false)
  const isProcessingRef = useRef(false)

  // Sync optimistic state with URL state
  useEffect(() => {
    setOptimisticMobileTab(activeChatTab)
  }, [activeChatTab])

  // Track when streaming completes to show preview update indicator
  const prevIsStreamingRef = useRef(isStreaming)
  const prevMessagesCountRef = useRef(messages.length)
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current
    const prevMessagesCount = prevMessagesCountRef.current
    prevIsStreamingRef.current = isStreaming
    prevMessagesCountRef.current = messages.length

    // When streaming stops, check if any files were edited in the new messages
    if (wasStreaming && !isStreaming && isMobile && messages.length > prevMessagesCount) {
      // Only check messages added during this stream
      const newMessages = messages.slice(prevMessagesCount)
      const hadFileEdits = newMessages.some(msg =>
        msg.role === 'assistant' &&
        msg.toolCalls?.some(
          toolCall => toolCall.name === 'fileEdit' &&
                      toolCall.status === 'completed' &&
                      !toolCall.error
        )
      )

      if (hadFileEdits) {
        setHasPreviewUpdate(true)
      }
    }
  }, [isStreaming, isMobile, messages])

  // Clear preview update indicator when user navigates to preview
  useEffect(() => {
    if (optimisticMobileTab === ChatTab.PREVIEW) {
      setHasPreviewUpdate(false)
    }
  }, [optimisticMobileTab])

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
  const historyLoadingComplete = useHistoryLoadingComplete()

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

  // Handle todoListId query parameter
  useEffect(() => {
    const todoListId = searchParams.get('todoListId')
    if (todoListId) {
      const handleTodoListContext = async () => {
        try {
          // Send message with todo list context
          const message = 'Fix my selected Security Vulnerabilities.'
          await sendMessage(message, undefined, undefined, { id: todoListId })
        } catch (error) {
          logger.error('develop.todo_context.send.failed', {
            todoListId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      handleTodoListContext()

      // Remove the todoListId from the URL
      const newSearchParams = new URLSearchParams(searchParams.toString())
      newSearchParams.delete('todoListId')

      const newUrl = newSearchParams.toString()
        ? `${window.location.pathname}?${newSearchParams.toString()}`
        : window.location.pathname

      router.replace(newUrl)
    }
  }, [searchParams, router, appId, sendMessage])

  // Cleanup WebSocket connections and batched updates on unmount
  useEffect(() => {
    return () => {
      // Legacy cleanupMessageService removed - streaming architecture handles its own cleanup
      cleanupServerPolling()
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current)
      }
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

  // Batching state for style updates
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingUpdateRef = useRef<{ selector: string; property: string; value: string; newClassName: string; newStyle?: string } | null>(null)
  const isFirstUpdateRef = useRef(true)
  const isProcessing = isLoading || isStreaming

  // Keep refs in sync so the message handler can read current values without being a dependency
  isFixingErrorRef.current = isFixingError
  isProcessingRef.current = isProcessing

  // Reset fixing overlay when the agent finishes processing
  const prevIsProcessingRef = useRef(isProcessing)
  useEffect(() => {
    const wasProcessing = prevIsProcessingRef.current
    prevIsProcessingRef.current = isProcessing

    if (wasProcessing && !isProcessing) {
      setIsFixingError(false)
      isFixingErrorRef.current = false
    }
  }, [isProcessing])

  // Fallback: if isFixingError is set but isProcessing never becomes true
  // (e.g. sendMessage silently fails), reset after a short window
  useEffect(() => {
    if (!isFixingError || isProcessing) return
    const timeout = setTimeout(() => {
      if (!isProcessingRef.current) {
        setIsFixingError(false)
        isFixingErrorRef.current = false
      }
    }, 5000)
    return () => clearTimeout(timeout)
  }, [isFixingError, isProcessing])

  const sendStyleUpdate = useCallback(async (styleData: { selector: string; property: string; value: string; newClassName: string; newStyle?: string }) => {
    if (!appId) return

    try {
      const result = await appService.updateStyles(appId, { /* eslint-disable-line @typescript-eslint/no-unused-vars */
        ...styleData,
        elementInfo: selectedElement
      })
      logger.info('develop-page.style-update.success', {
        appId,
        selector: styleData.selector,
        property: styleData.property
      })
    } catch (error) {
      logger.error('develop-page.style-update.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [appId, selectedElement])

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

    try {
      const result = await appService.updateText(appId, textData) /* eslint-disable-line @typescript-eslint/no-unused-vars */
      logger.info('develop-page.text-update.success', { appId })
    } catch (error) {
      logger.error('develop-page.text-update.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [appId])

  const handleStyleUpdate = useCallback(async (styleData: { selector: string; property: string; value: string; newClassName: string; newStyle?: string }) => {
    if (!appId) return

    // Send first update immediately
    if (isFirstUpdateRef.current) {
      isFirstUpdateRef.current = false
      await sendStyleUpdate(styleData)
      return
    }

    // Store the most recent update
    pendingUpdateRef.current = styleData

    // Clear existing timeout
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current)
    }

    // Set new timeout to send the batched update
    batchTimeoutRef.current = setTimeout(async () => {
      if (pendingUpdateRef.current) {
        await sendStyleUpdate(pendingUpdateRef.current)
        pendingUpdateRef.current = null
        isFirstUpdateRef.current = true // Reset for next batch
      }
    }, 5000)
  }, [appId, sendStyleUpdate])

  // Listen for file edit tool completions to show preview
  useEffect(() => {
    if (!appId || !activeStream) return

    // Check if any fileEdit tool calls have completed successfully
    const completedFileEdit = activeStream.toolCalls.find(
      toolCall => toolCall.name === 'fileEdit' &&
        toolCall.status === 'completed' &&
        !toolCall.error
    )

    if (completedFileEdit && !isPreviewVisible) {
      // First successful file edit - show preview and mark it
      setIsPreviewVisible(true)
      init.actions.markFirstFileEditSeen()
      const storageKey = `airo-preview-visible-${appId}`
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, 'true')
      }
    }
  }, [appId, activeStream, isPreviewVisible, setIsPreviewVisible, init.actions])

  // Listen for messages from preview iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Handle messages from iframe or from same window (for websocket events)
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      const isFromIframe = iframe && event.source === iframe.contentWindow
      const isFromSameWindow = event.source === window

      if (!isFromIframe && !isFromSameWindow) return

      switch (event.data.type) {
        case 'ELEMENT_SELECTED':
          setSelectedElement(event.data.data)
          setIsSelectMode(false)
          logger.info('develop-page.element-selected', {
            appId,
            selector: event.data.data?.selector
          })
          break
        case 'STYLE_UPDATED':
          logger.info('develop-page.style-updated-from-iframe', { appId })
          handleStyleUpdate(event.data.data)
          break
        case 'TEXT_UPDATED':
          logger.info('develop-page.text-updated-from-iframe', { appId })
          sendTextUpdate(event.data.data)
          break
        case 'EDIT_WITH_AI':
          setAiEditContext(event.data.data)
          logger.info('develop-page.ai-edit-requested', { appId })
          break
        case 'REPLACE_IMAGE':
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
        case 'SCROLL_POSITION_UPDATE':
          // Handle real-time scroll position updates from iframe and store for restoration
          const newScrollPos = {
            x: event.data.scrollX || 0,
            y: event.data.scrollY || 0
          }
          lastIframeState.current.scrollPosition = newScrollPos
          break
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
        case 'error-fix-request':
          if (isFixingErrorRef.current) break
          // Agent is already working — don't interrupt with a second message
          if (isProcessingRef.current) {
            logger.info('develop-page.error-fix-request.skipped-processing', { appId })
            break
          }
          isFixingErrorRef.current = true
          setIsFixingError(true)
          // Handle runtime error fix requests from AiroErrorBoundary (new format with errorData)
          if (event.data.errorData) {
            const { message, name, stack, componentStack, url, timestamp } = event.data.errorData as import('@/types/runtime-error').RuntimeErrorData
            logger.info('develop-page.error-fix-request', {
              appId,
              errorName: name,
              errorMessage: message,
              hasStack: !!stack,
              hasComponentStack: !!componentStack
            })

            setInputValue('Please analyze and fix this runtime error.')

            scheduleMicrotask(() => {
              void sendMessage(
                'Please analyze and fix this runtime error.',
                null, // aiEditContext
                undefined, // selectedAssets
                null, // todoListContext
                false, // isActionRequest
                {
                  type: 'runtime_error',
                  data: {
                    message,
                    name,
                    stack,
                    componentStack,
                    url,
                    timestamp
                  },
                  persistence: 'ephemeral',
                  source: 'error-boundary'
                }
              )
            })
          }
          // Handle legacy compile error fix requests (old format with errorMessage string)
          else if (event.data.errorMessage) {
            logger.info('develop-page.error-fix-request.legacy', {
              appId,
              errorMessage: event.data.errorMessage
            })
            setInputValue(`Please fix this error: ${event.data.errorMessage}`)
            scheduleMicrotask(() => {
              void sendMessage(`Please fix this error: ${event.data.errorMessage}`, null)
            })
          }
          break
        case 'build-page-request':
          if (isProcessingRef.current) {
            logger.info('develop-page.build-page-request.skipped-processing', { appId })
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
              void sendMessage(messageContent, null)
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
              void sendMessage(
                messageContent,
                null, // aiEditContext
                undefined, // selectedAssets
                null, // todoListContext
                false, // isActionRequest
                {
                  type: 'build_error',
                  data: {
                    error: event.data.errorMessage,
                    details: event.data.errorDetails,
                    exitCode: event.data.exitCode
                  },
                  persistence: 'ephemeral',
                  source: 'publish-failure'
                }
              )
            })
          }
          break
        case 'SCREENSHOT_RESPONSE':
          // Handle screenshot response from iframe
          if (event.data.screenshot) {
            handleScreenshotUpload(event.data.screenshot)
          }
          break
        case 'OPEN_MEDIA_SLOT_DIALOG':
          // Handle request to open media slot dialog from dev-tools
          if (event.data.slotName && appId) {
            useMediaSlotDialogStore.getState().openDialog(appId, event.data.slotName)
          }
          break
        case 'error-fix-resolved':
          setIsFixingError(false)
          isFixingErrorRef.current = false
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleStyleUpdate, sendTextUpdate, setAiEditContext, setIsSelectMode, sendMessage, setInputValue, handleScreenshotUpload, setIsAssetManagerOpen, appId, scheduleMicrotask])
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

  // Handle auto-send initial message for new apps (driven by init.ui.shouldAutoSendPrompt)
  useEffect(() => {
    if (!init.ui.shouldAutoSendPrompt || !init.ui.autoSendPromptText || !appId) return
    if (searchParams.get('message')) return // Don't auto-send if there's a URL message

    if (!pendingAutoSendRef.current) {
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
      }
    }

    if (
      pendingAutoSendRef.current &&
      webSocketState.connected &&
      !autoSendInFlightRef.current
    ) {
      autoSendInFlightRef.current = true
      const messageToSend = pendingAutoSendRef.current

      const sendPendingMessage = async () => {
        try {
          await sendMessage(messageToSend, null)
          pendingAutoSendRef.current = null
          init.actions.markInitialPromptSent()
        } catch (error) {
          logger.error('develop-page.auto-send.failed', {
            error: error instanceof Error ? error.message : String(error),
            appId
          })
        } finally {
          autoSendInFlightRef.current = false
        }
      }

      void sendPendingMessage()
    }
  }, [
    init.ui.shouldAutoSendPrompt,
    init.ui.autoSendPromptText,
    searchParams,
    autoSendInitialMessage,
    sendMessage,
    appId,
    init.actions,
    webSocketState.connected
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
      checkAndTriggerIntroTour(appId)
    }
  }, [appId, init.isReady, messages.length, activeStream, checkAndTriggerIntroTour])

  if (init.siteNotFound) {
    return (
      <div className="h-screen flex flex-col">
        <Header location="develop" />
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

  return (
    <WebSocketProvider sendMessage={sendMessage} loadMoreHistory={loadMoreHistory}>
      <div
        // Switch from fixed to absolute to support PresentationCentral delegation/browser deprecation banners
        className={cn("absolute inset-0 flex flex-col overflow-hidden bg-develop-bg", {
          "ios-fixed-container": isMobile
        })}
        style={isMobile ? {
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        } : undefined}
        onDragEnter={handleDragEnter}
      >
        <Header location="develop" />

        {/* Desktop Layout */}
        {!isMobile && (
          <div className="relative h-full w-full overflow-hidden">
            {/* Sidebar (Chat, History, Settings menu) */}
            <motion.div
              className="absolute top-2 left-2 bottom-2"
              animate={{
                x: isChatPaneCollapsed ? -(chatPaneWidth + 16) : 0,
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
              ) : (
                <ChatPane
                  sendMessage={sendMessage}
                  isCreateFlowSession={isCreateFlowSession}
                />
              )}
            </motion.div>

            {/* Resizable Divider */}
            {!isChatPaneCollapsed && (
              <ResizableDivider
                onResize={handlePanelResize}
                minLeftWidth={300}
                minRightWidth={Math.max(600, typeof window !== 'undefined' ? window.innerWidth * 0.5 : 600)}
                style={{
                  left: `${chatPaneWidth + 15}px`
                }}
              />
            )}

            {/* Content (Preview, Settings, Code) */}
            <motion.div
              className="absolute top-2 right-2 bottom-2 flex flex-col"
              animate={{
                left: isChatPaneCollapsed ? 8 : chatPaneWidth + 16
              }}
              transition={{
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1]
              }}
            >
              <PublishStatusAlert />
              <PostPublishGoLiveModal appId={appId} />

              {/* Content area - takes remaining space after banner */}
              <div className="flex-1 relative min-h-0">
                {/* Preview/Code View */}
                <div
                  id="preview-pane-container"
                  className="absolute inset-0 flex flex-col transition-opacity duration-150"
                  style={{
                    opacity: activeChatTab !== ChatTab.SETTINGS ? 1 : 0,
                    pointerEvents: activeChatTab !== ChatTab.SETTINGS ? 'auto' : 'none',
                  }}
                >
                  <PreviewPane
                    onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                    showBuildingOverlay={init.ui.showPreviewLoader}
                    fixingOverlayMessage={isFixingError ? t('builder_preview_fixing_error') : null}
                    isHibernated={hibernation.isHibernated}
                    isResuming={hibernation.isResuming}
                    resumeFailed={hibernation.resumeFailed}
                    onRetryResume={() => hibernation.resume()}
                    isMobile={false}
                  />
                </div>

                {/* Settings View */}
                <div
                  className="absolute inset-0 flex flex-col transition-opacity duration-150"
                  style={{
                    opacity: activeChatTab === ChatTab.SETTINGS ? 1 : 0,
                    pointerEvents: activeChatTab === ChatTab.SETTINGS ? 'auto' : 'none',
                  }}
                >
                  <SettingsView />
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
              ) : (
                <>
                  <PublishStatusAlert />
                  <PostPublishGoLiveModal appId={appId} />

                  {/* Content area - takes remaining space after banner */}
                  <div className="flex-1 relative min-h-0">
                    {/* Preview Tab */}
                    <div
                      className="absolute inset-0 flex flex-col transition-opacity duration-150"
                      style={{
                        opacity: optimisticMobileTab === ChatTab.PREVIEW ? 1 : 0,
                        pointerEvents: optimisticMobileTab === ChatTab.PREVIEW ? 'auto' : 'none',
                        willChange: 'opacity'
                      }}
                    >
                      <PreviewPane
                        onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                        showBuildingOverlay={init.ui.showPreviewLoader}
                        fixingOverlayMessage={isFixingError ? t('builder_preview_fixing_error') : null}
                        isHibernated={hibernation.isHibernated}
                        isResuming={hibernation.isResuming}
                        resumeFailed={hibernation.resumeFailed}
                        onRetryResume={() => hibernation.resume()}
                        isMobile={true}
                      />
                    </div>

                    {/* Chat Tab */}
                    <div
                      className="absolute inset-0 flex flex-col overflow-hidden transition-opacity duration-150"
                      style={{
                        opacity: optimisticMobileTab === ChatTab.CHAT ? 1 : 0,
                        pointerEvents: optimisticMobileTab === ChatTab.CHAT ? 'auto' : 'none',
                        willChange: 'opacity'
                      }}
                    >
                      <ChatPane
                        sendMessage={sendMessage}
                        isCreateFlowSession={isCreateFlowSession}
                      />
                    </div>

                    {/* History Tab */}
                    <div
                      className="absolute inset-0 flex flex-col overflow-y-auto transition-opacity duration-150"
                      style={{
                        opacity: optimisticMobileTab === ChatTab.HISTORY ? 1 : 0,
                        pointerEvents: optimisticMobileTab === ChatTab.HISTORY ? 'auto' : 'none',
                        willChange: 'opacity'
                      }}
                    >
                      <VersionHistory />
                    </div>

                    {/* Settings Tab */}
                    <div
                      className="absolute inset-0 flex flex-col transition-opacity duration-150"
                      style={{
                        opacity: optimisticMobileTab === ChatTab.SETTINGS ? 1 : 0,
                        pointerEvents: optimisticMobileTab === ChatTab.SETTINGS ? 'auto' : 'none',
                        willChange: 'opacity'
                      }}
                    >
                      <SettingsView />
                    </div>
                  </div>
                </>
              )}
            </div>
            <ChatToolbar
              className="fixed bottom-1 left-0 right-0"
              isProcessing={isProcessing}
              onBeforeTabChange={setOptimisticMobileTab}
              optimisticActiveTab={optimisticMobileTab}
              hasPreviewUpdate={hasPreviewUpdate}
            />
          </div>
        )}

        {openFeedbackId === FEEDBACK_ID && (
          <Feedback
            feedbackId={FEEDBACK_ID}
            onClose={closeFeedbackModal}
            onSubmitSuccess={closeFeedbackModal}
          />
        )}

        <AppIntroTour
          show={showIntroTour}
          onClose={() => setShowIntroTour(false)}
        />

        <MediaSlotDialog />
        <Growl />

        {showUpgradeModal && (
          <SinglePlanUpgradeContainer
            source={upgradeModalSource ?? 'unknown'}
            itc={upgradeModalItc ?? undefined}
            onSuccessClick={() => {
              closeUpgradeModal()
            }}
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
              openUpgradeModal('publish_limit')
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
  const t = useTranslations();
  return (
    <ProtectedRoute
      unauthorizedMessage={t('builder_develop_protected_route')}
    >
      <Suspense fallback={<div>{t('builder_develop_loading')}</div>}>
        <DevelopPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}

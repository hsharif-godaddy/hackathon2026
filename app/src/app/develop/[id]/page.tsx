'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import PublishStatusAlert from '@/components/layout/PublishStatusAlert'
import ChatPane from '@/app/develop/components/chat/ChatPane'
import PreviewPane from '@/app/develop/components/preview/PreviewPane'
import ResizableDivider from '@/app/develop/components/ResizableDivider'
import SettingsView from '@/app/develop/components/settings/SettingsView'
import { ChatTab, SettingsSection } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { ProtectedRoute } from '@/components/auth'
import { useStreamingWebSocket } from '@/hooks/useStreamingWebSocket'
import { usePageTiming } from '@/hooks/usePageTiming'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { appService } from '@/services/AppService'
import {
  useConversations,
  useSetInputValue,
  useSetAiEditContext,
  useSetBuildErrorContext,
  useAutoSendInitialMessage,
  useMessages,
  useActiveStream
} from '@/stores/useStreamingConversationStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'
import { handlePreviewRefresh } from '@/app/develop/components/utils'
import { logger } from '@/lib/request-context'
import { Feedback } from '@/components/feedback/Feedback'
import { agentFetch } from '@/lib/agent-fetch'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import ChatPaneLoader from '@/app/develop/components/chat/ChatPaneLoader'
import { useInitialization } from '@/app/develop/hooks/useInitialization'

// Delay to allow conversation history messages to load before checking if preview should be visible
// This ensures we have accurate message count when determining initial preview visibility
const MESSAGE_LOAD_DELAY_MS = 100

function DevelopPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const appId = useAppIdFromParams()
  const isJobId = searchParams.get('type') === 'job'

  // Unified initialization hook - handles all sequencing and UI state
  const init = useInitialization({ appId, isJobId })

  const { data: isPublishButtonEnabled } = useSwitchboard('appbuilder-publish-button');

  // Server polling store - unified server status management
  const startPollingForServer = useServerPollingStore((state) => state.startPollingForServer)
  const stopPollingForServer = useServerPollingStore((state) => state.stopPollingForServer)
  const cleanupServerPolling = useServerPollingStore((state) => state.cleanup)

  // Streaming conversation store - for conversations and messages
  const conversations = useConversations()
  const messages = useMessages()
  const activeStream = useActiveStream()
  const setInputValue = useSetInputValue()
  const setAiEditContext = useSetAiEditContext()
  const setBuildErrorContext = useSetBuildErrorContext()
  const autoSendInitialMessage = useAutoSendInitialMessage()
  const { sendMessage } = useStreamingWebSocket()

  const chatPaneWidth = useDevelopPageStore((state) => state.chatPaneWidth)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const activeChatTab = useDevelopPageStore((state) => state.activeChatTab)
  const isPreviewVisible = useDevelopPageStore((state) => state.isPreviewVisible)
  const loadingPhase = useDevelopPageStore((state) => state.loadingPhase)
  const site = useDevelopPageStore((state) => state.site)
  const openFeedbackId = useDevelopPageStore((state) => state.openFeedbackId)
  
  const setChatPaneWidth = useDevelopPageStore((state) => state.setChatPaneWidth)
  const setIsSelectMode = useDevelopPageStore((state) => state.setIsSelectMode)
  const initializeMobileDetection = useDevelopPageStore((state) => state.initializeMobileDetection)
  const closeFeedbackModal = useDevelopPageStore((state) => state.closeFeedbackModal)
  const setActiveSettingsSection = useDevelopPageStore((state) => state.setActiveSettingsSection)
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab)
  const setIsPreviewVisible = useDevelopPageStore((state) => state.setIsPreviewVisible)

  useGitHistoryQuery({
    appId: appId || '',
    enabled: loadingPhase === 'ready' && !!appId && !!site?.agent_url
  })

  // Track page timing with RUM
  usePageTiming('develop-page', appId)

  // Local state (only what's not in stores)
  const [selectedElement, setSelectedElement] = useState<unknown>(null)

  // Store last known iframe state for restoration
  const lastIframeState = useRef<{
    url?: string
    scrollPosition?: { x: number; y: number }
  }>({})

  useEffect(() => {
    logImpressionEvent('develop.page.view')();
    logAiroHQEvent({
      category: 'impression',
      recommendation_task: 'builder_develop_page_view',
      recommendation_type: 'navigation'
    })();
  }, [])

  // Initialize mobile detection
  useEffect(() => {
    const cleanup = initializeMobileDetection()
    return cleanup
  }, [initializeMobileDetection])

  // All initialization is now handled by useInitialization hook

  // Update document title with site name
  useEffect(() => {
    if (site?.name) {
      document.title = `${site.name} - Develop - Airo App Builder`
    }
  }, [site?.name])

  // State logging moved to useInitialization hook to prevent render loop

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

  // Determine initial preview visibility based on localStorage and conversation history
  useEffect(() => {
    if (loadingPhase !== 'ready' || !appId) return

    // Check localStorage first
    const storageKey = `airo-preview-visible-${appId}`
    const savedState = localStorage.getItem(storageKey)

    if (savedState !== null) {
      // Use saved state
      setIsPreviewVisible(JSON.parse(savedState))
    } else {
      // No saved state - check conversation history
      // Wait a bit for messages to load, then check
      const timer = setTimeout(() => {
        const hasHistory = messages.length > 0
        setIsPreviewVisible(hasHistory)
        if (typeof window !== 'undefined') {
          localStorage.setItem(storageKey, JSON.stringify(hasHistory))
        }
      }, MESSAGE_LOAD_DELAY_MS)

      return () => clearTimeout(timer)
    }
  }, [loadingPhase, appId, messages.length, setIsPreviewVisible])

  // Server polling - unified approach with adaptive backoff
  useEffect(() => {
    if (!appId) return

    console.log('🚀 Starting unified server polling for:', appId)
    startPollingForServer(appId)

    return () => {
      console.log('⏹️ Stopping server polling for:', appId)
      stopPollingForServer(appId)
    }
  }, [appId, startPollingForServer, stopPollingForServer])

  // Batching state for style updates
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingUpdateRef = useRef<{ selector: string; property: string; value: string; newClassName: string; newStyle?: string } | null>(null)
  const isFirstUpdateRef = useRef(true)

  const sendStyleUpdate = useCallback(async (styleData: { selector: string; property: string; value: string; newClassName: string; newStyle?: string }) => {
    if (!appId) return

    try {
      const result = await appService.updateStyles(appId, {
        ...styleData,
        elementInfo: selectedElement
      })
      console.log('Style update sent to API:', result)
    } catch (error) {
      console.error('Error sending style update to API:', error)
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

    console.log('📤 Sending text update to API:', {
      selector: textData.selector,
      oldText: textData.oldText?.substring(0, 50) + (textData.oldText?.length > 50 ? '...' : ''),
      newText: textData.newText?.substring(0, 50) + (textData.newText?.length > 50 ? '...' : ''),
      devContext: textData.devContext,
      hasDevContext: !!textData.devContext,
      hasFileName: !!(textData.devContext && textData.devContext.fileName),
      hasComponentName: !!(textData.devContext && textData.devContext.componentName)
    })

    try {
      const result = await appService.updateText(appId, textData)
      console.log('✅ Text update sent to API successfully:', result)
    } catch (error) {
      console.error('❌ Error sending text update to API:', error)
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
          setIsSelectMode(false) // Auto-disable select mode after selection
          console.log('Element selected in iframe:', event.data.data)
          break
        case 'STYLE_UPDATED':
          console.log('Style updated in iframe:', event.data.data)
          handleStyleUpdate(event.data.data)
          break
        case 'TEXT_UPDATED':
          console.log('Text updated in iframe:', event.data.data)
          sendTextUpdate(event.data.data)
          break
        case 'EDIT_WITH_AI':
          setAiEditContext(event.data.data)
          console.log('AI edit requested for element:', event.data.data)
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
        case 'MESSAGE_COMPLETE':
          // Handle message completion - refresh preview with state preservation
          setTimeout(() => {
            handlePreviewRefresh({ lastIframeState })
          }, 500) // Small delay to ensure any file changes are processed
          break
        case 'error-fix-request':
          // Handle error fix requests from the iframe error boundary
          if (event.data.errorMessage) {
            console.log('Error fix request received:', event.data.errorMessage)
            setInputValue(`Please fix this error: ${event.data.errorMessage}`)
            // Auto-send the error fix request
            setTimeout(() => {
              sendMessage(`Please fix this error: ${event.data.errorMessage}`, null)
            }, 500)
          }
          break
        case 'build-page-request':
          // Handle build page requests from the 404 page
          if (event.data.pathToBuild) {
            console.log('Build page request received:', event.data.pathToBuild)
            const messageContent = `The page at path ${event.data.pathToBuild} doesn't exist yet, please build it with appropriate content.`;
            setInputValue(messageContent);
            // Auto-send the build page request
            setTimeout(() => {
              sendMessage(messageContent, null)
            }, 500)
          }
          break
        case 'build-error-fix-request':
          // Handle build error fix requests from the publish alert
          if (event.data.errorMessage && event.data.errorDetails) {
            // Set build error context to be attached to the message
            setBuildErrorContext({
              error: event.data.errorMessage,
              details: event.data.errorDetails,
              exitCode: event.data.exitCode
            });
            // Set a helpful message in the input
            setInputValue('Please analyze and fix this build error.');
            // Auto-send the message and clear context (matches ChatPane pattern)
            setTimeout(() => {
              sendMessage('Please analyze and fix this build error.', null)
              // Clear immediately after sending, same as ChatPane does
              setBuildErrorContext(null)
            }, 500)
          }
          break
        case 'SCREENSHOT_RESPONSE':
          // Handle screenshot response from iframe
          if (event.data.screenshot) {
            handleScreenshotUpload(event.data.screenshot)
          }
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleStyleUpdate, sendTextUpdate, setAiEditContext, setBuildErrorContext, setIsSelectMode, sendMessage, setInputValue, handleScreenshotUpload])

  // Warn user before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        event.preventDefault()
        event.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
        return 'You have unsaved changes. Are you sure you want to leave?'
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // Handle URL parameters for deep linking - runs immediately on mount
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    const settingsParam = searchParams.get('settings')

    // Handle tab parameter - if no tab param, default to CHAT
    if (tabParam) {
      switch (tabParam) {
        case 'settings':
          setActiveChatTab(ChatTab.SETTINGS)
          // Also handle settings section if provided
          if (settingsParam) {
            const validSections = Object.values(SettingsSection)
            if (validSections.includes(settingsParam as SettingsSection)) {
              setActiveSettingsSection(settingsParam as SettingsSection)
            }
          }
          break
        case 'history':
          setActiveChatTab(ChatTab.HISTORY)
          break
        case 'preview':
          setActiveChatTab(ChatTab.PREVIEW)
          break
        case 'chat':
          setActiveChatTab(ChatTab.CHAT)
          break
        default:
          break
      }
    } else {
      // No tab param, default to CHAT
      setActiveChatTab(ChatTab.CHAT)
    }
  }, [searchParams, setActiveSettingsSection, setActiveChatTab])

  // Handle URL message parameter - simplified logic
  useEffect(() => {
    if (loadingPhase !== 'ready') return

    const message = searchParams.get('message')
    if (message && conversations.length === 0) {
      const decodedMessage = decodeURIComponent(message)
      setInputValue(decodedMessage)

      // Auto-send and clear URL
      setTimeout(() => {
        const url = new URL(window.location.href)
        url.searchParams.delete('message')
        router.replace(url.pathname + url.search, { scroll: false })
      }, 500)
    }
  }, [loadingPhase, searchParams, conversations.length, router, setInputValue])

  // Handle auto-send initial message for new apps (driven by init.ui.shouldAutoSendPrompt)
  useEffect(() => {
    if (!init.ui.shouldAutoSendPrompt || !init.ui.autoSendPromptText) return
    if (searchParams.get('message')) return // Don't auto-send if there's a URL message

    logger.info('develop-page.auto-send.triggered', {
      message: 'Auto-sending initial message for new app',
      appId,
      promptPreview: init.ui.autoSendPromptText.substring(0, 50) + '...'
    })

    // Use the streaming store's auto-send function
    const wasTriggered = autoSendInitialMessage(init.ui.autoSendPromptText, appId!)

    if (wasTriggered) {
      // Send immediately - WebSocket is confirmed to be connected
      sendMessage(init.ui.autoSendPromptText, null)
      // Mark as sent so we don't trigger again
      init.actions.markInitialPromptSent()
    }
  }, [init.ui.shouldAutoSendPrompt, init.ui.autoSendPromptText, searchParams, autoSendInitialMessage, sendMessage, appId, init.actions])

  // Handle async name suggestion and registration after redirect from setup
  useEffect(() => {
    if (loadingPhase !== 'ready' || !appId || !site) return

    // Check if name registration is pending after setup
    const nameRegistrationKey = `name-registration-pending-${init.initialJobId}`
    logger.info('app.develop.page.nameRegistrationKey:', { nameRegistrationKey, initialJobId: init.initialJobId, appId })
    const shouldRegisterName = sessionStorage.getItem(nameRegistrationKey) === 'true'

    if (!shouldRegisterName) return

    // Clear the flag immediately to prevent duplicate runs
    sessionStorage.removeItem(nameRegistrationKey)

    // Run async without blocking page load
    appService.updateNameAndRegister(appId)
  }, [loadingPhase, appId, site, init.initialJobId])

  const handlePanelResize = useCallback((newWidth: number) => {
    setChatPaneWidth(newWidth)
  }, [setChatPaneWidth])

  return (
    <div className="h-screen flex flex-col">
      <Header location="develop" />

      {isMobile ? (
        // Mobile layout with tabs
        <div className="flex-1 flex flex-col min-h-0 relative">
          <ChatPane
            sendMessage={sendMessage}
          />
        </div>
      ) : (
        // Desktop layout with resizable panels
        <div className="flex-1 min-h-0 overflow-hidden p-4 flex">
          {!isChatPaneCollapsed && (
            <div
              className="flex flex-col flex-shrink-0 relative"
              style={{
                width: `${chatPaneWidth}px`,
                minWidth: `${chatPaneWidth}px`,
                maxWidth: `${chatPaneWidth}px`
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
              ) : (
                <ChatPane
                  onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                  sendMessage={sendMessage}
                />
              )}
            </div>
          )}

          {!isChatPaneCollapsed && (
            <ResizableDivider
              onResize={handlePanelResize}
              minLeftWidth={380}
              minRightWidth={400}
            />
          )}

          <div className="flex-1 flex flex-col relative">
            {isPublishButtonEnabled && <PublishStatusAlert />}
            <div className="flex-1 overflow-hidden relative">
              <div className="absolute inset-0">
                {activeChatTab !== ChatTab.SETTINGS ? (
                  <PreviewPane
                    onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                    showBuildingOverlay={init.ui.showPreviewLoader}
                    buildingMessage={init.ui.previewLoaderMessage}
                  />
                ) : (
                  <SettingsView />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {openFeedbackId === "airo#app-builder" && (
        <Feedback
          feedbackId="airo#app-builder"
          onClose={closeFeedbackModal}
          onSubmitSuccess={closeFeedbackModal}
        />
      )}
    </div>
  )
}

export default function Develop() {
  return (
    <ProtectedRoute
      unauthorizedMessage="You need to be signed in to access the development environment."
    >
      <Suspense fallback={<div>Loading development environment...</div>}>
        <DevelopPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}

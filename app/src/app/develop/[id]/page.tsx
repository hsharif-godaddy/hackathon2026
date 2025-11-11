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
import { appService } from '@/services/AppService'
import {
  useConversations,
  useSetInputValue,
  useSetAiEditContext,
  useSetCurrentAppId,
  useIsLoading,
  useAutoSendInitialMessage,
  useLoadConversationHistory,
  useStreamingConversationStore
} from '@/stores/useStreamingConversationStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitHistoryStore, cleanupGitHistoryStore } from '@/stores/useGitHistoryStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'
import { handlePreviewRefresh } from '@/app/develop/components/utils'
import { logger } from '@/lib/request-context'
import { Feedback } from '@/components/feedback/Feedback'

function DevelopPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const appId = useAppIdFromParams()

  const { featureFlags } = useSwitchboard();
  const isPublishButtonEnabled = featureFlags['appbuilder-publish-button'] ?? false;

  // Server polling store - unified server status management
  const { startPollingForServer, stopPollingForServer, cleanup: cleanupServerPolling } = useServerPollingStore()

  // Streaming conversation store - for conversations and messages
  const conversations = useConversations()
  const setInputValue = useSetInputValue()
  const setAiEditContext = useSetAiEditContext()
  const setCurrentAppId = useSetCurrentAppId()
  const autoSendInitialMessage = useAutoSendInitialMessage()
  const loadConversationHistory = useLoadConversationHistory()
  const { sendMessage, isConnected: isWebSocketConnected } = useStreamingWebSocket()

  // Develop page store - for UI state and coordination
  const {
    chatPaneWidth,
    hasUnsavedChanges,
    isChatPaneCollapsed,
    isMobile,
    activeChatTab,
    setChatPaneWidth,
    setIsSelectMode,
    loadingPhase,
    site,
    initializePage,
    initializeMobileDetection,
    openFeedbackId,
    closeFeedbackModal,
    setActiveSettingsSection,
    setActiveChatTab
  } = useDevelopPageStore()

  // Git history store - handles loading with smart retry logic
  const {
    loadGitHistory,
  } = useGitHistoryStore()

  // Track page timing with RUM
  usePageTiming('develop-page', appId)

  // Local state (only what's not in stores)
  const [selectedElement, setSelectedElement] = useState<unknown>(null)

  // Store last known iframe state for restoration
  const lastIframeState = useRef<{
    url?: string
    scrollPosition?: { x: number; y: number }
  }>({})

  // Streaming store state
  const isLoading = useIsLoading()

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

  // Main initialization - orchestrated through store
  useEffect(() => {
    if (appId) {
      console.log('🚀 Initializing page for appId:', appId)
      initializePage(appId).catch(error => {
        console.error('❌ Page initialization failed:', error)
      })
    }
  }, [appId, initializePage])

  // Cleanup WebSocket connections and batched updates on unmount
  useEffect(() => {
    return () => {
      // Legacy cleanupMessageService removed - streaming architecture handles its own cleanup
      cleanupServerPolling()
      cleanupGitHistoryStore(appId)
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current)
      }
    }
  }, [appId, cleanupServerPolling])

  // Initialize streaming conversation store for this app
  useEffect(() => {
    if (!appId) return

    console.log('🔄 Initializing streaming conversation store for:', appId)
    setCurrentAppId(appId)
  }, [appId, setCurrentAppId])

  // Load conversation history when page is ready
  useEffect(() => {
    console.log('🔍 Conversation loading effect triggered:', {
      loadingPhase,
      appId,
      hasLoadFunction: !!loadConversationHistory
    })

    if (loadingPhase !== 'ready' || !appId) {
      console.log('⏭️ Skipping conversation load:', { loadingPhase, appId })
      return
    }

    console.log('📚 Loading conversation history for app:', appId)
    // Add error handling to ensure loading state is always properly reset
    loadConversationHistory(appId).catch((error) => {
      console.error('❌ Failed to load conversation history in page component:', error)
      // Additional safety: force reset loading state if not handled by store
      const { setIsLoading } = useStreamingConversationStore.getState()
      setIsLoading(false)
    })
  }, [loadingPhase, appId, loadConversationHistory])

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
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleStyleUpdate, sendTextUpdate, setAiEditContext, setIsSelectMode, sendMessage, setInputValue])

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

  // Handle auto-send initial message for new apps (after conversation history is loaded AND WebSocket is connected)
  useEffect(() => {
    // Only proceed when page is ready, we have an appId, not currently loading, and WebSocket is connected
    if (loadingPhase !== 'ready' || !appId || isLoading || !isWebSocketConnected) return

    // Wait a bit for conversation history to load, then check if we should auto-send
    const timer = setTimeout(() => {
      // Check if initial prompt should be sent (only after setup completion)
      const initialPromptKey = `initial-prompt-pending-${appId}`
      const shouldSendInitialPrompt = sessionStorage.getItem(initialPromptKey) === 'true'

      if (!shouldSendInitialPrompt) return

      // Check if conditions are met to actually send
      const canSendNow =
        site?.initial_prompt &&
        site.status === 'running' &&
        isWebSocketConnected &&
        !searchParams.get('message') // Don't auto-send if there's a URL message

      if (canSendNow) {
        // Clear the flag immediately to prevent duplicate sends
        sessionStorage.removeItem(initialPromptKey)

        logger.info('develop-page.auto-send.triggered', {
          message: 'Auto-sending initial message for new app',
          appId,
          promptPreview: site.initial_prompt?.substring(0, 50) + '...'
        })

        // Use the streaming store's auto-send function
        const wasTriggered = autoSendInitialMessage(site.initial_prompt!, appId)

        if (wasTriggered) {
          // Send immediately - WebSocket is confirmed to be connected
          sendMessage(site.initial_prompt!, null)
        }
      }
    }, 500) // Wait 500ms for conversation history to load

    return () => clearTimeout(timer)
  }, [loadingPhase, appId, site, searchParams, autoSendInitialMessage, isLoading, sendMessage, isWebSocketConnected])

  // Load git history when page is ready
  useEffect(() => {
    if (loadingPhase === 'ready' && appId) {
      console.log('🔄 Page ready, loading git history for app:', appId)
      loadGitHistory(appId)
    }
  }, [loadingPhase, appId, loadGitHistory])

  // Handle async name suggestion and registration after redirect from setup
  useEffect(() => {
    if (loadingPhase !== 'ready' || !appId || !site) return

    // Check if name registration is pending after setup
    const nameRegistrationKey = `name-registration-pending-${appId}`
    const shouldRegisterName = sessionStorage.getItem(nameRegistrationKey) === 'true'

    if (!shouldRegisterName) return

    // Clear the flag immediately to prevent duplicate runs
    sessionStorage.removeItem(nameRegistrationKey)

    // Run async without blocking page load
    appService.updateNameAndRegister(appId)
  }, [loadingPhase, appId, site])

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
              className="flex flex-col flex-shrink-0"
              style={{
                width: `${chatPaneWidth}px`,
                minWidth: `${chatPaneWidth}px`,
                maxWidth: `${chatPaneWidth}px`
              }}
            >
              <ChatPane
                onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
                sendMessage={sendMessage}
              />
            </div>
          )}

          {!isChatPaneCollapsed && (
            <ResizableDivider
              onResize={handlePanelResize}
              minLeftWidth={380}
              minRightWidth={400}
            />
          )}

          <div className="flex-1 flex flex-col">
            {isPublishButtonEnabled && <PublishStatusAlert />}
            <div className="flex-1 overflow-hidden relative">
              <div className="absolute inset-0">
                {activeChatTab !== ChatTab.SETTINGS ? (
                  <PreviewPane
                    onPreviewRefresh={() => handlePreviewRefresh({ lastIframeState })}
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

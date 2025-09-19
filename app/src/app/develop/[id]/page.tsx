'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import StreamingChatPane from '@/app/develop/components/StreamingChatPane'
import PreviewPane from '@/app/develop/components/PreviewPaneSimple'
import CodeEditor from '@/app/develop/components/CodeEditor'
import ResizableDivider from '@/app/develop/components/ResizableDivider'
import Header, { HeaderRef } from './header'
// Legacy messageService cleanup removed - now using streaming architecture
import { ProtectedRoute } from '@/components/auth'
import { appService } from '@/services/AppService'
import { 
  useConversations,
  useSetInputValue,
  useSetAiEditContext,
  useSetCurrentAppId,
  useIsLoading,
  useAutoSendInitialMessage,
  useLoadConversationHistory
} from '@/app/develop/components/streamingConversationStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitHistoryStore, cleanupGitHistoryStore } from '@/stores/useGitHistoryStore'
import { useAppStore } from '@/stores/useAppStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { postMessageToIframe } from '@/utils/postMessage'
import { logImpressionEvent } from '@/utils/instrumentation'

function DevelopPageContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const appId = params.id as string
  
  // App store - for app lifecycle operations
  const { restartApp: appStoreRestartApp } = useAppStore()
  
  // Server polling store - unified server status management
  const { startPollingForServer, stopPollingForServer, cleanup: cleanupServerPolling } = useServerPollingStore()
  
  // Streaming conversation store - for conversations and messages
  const conversations = useConversations()
  const setInputValue = useSetInputValue()
  const setAiEditContext = useSetAiEditContext()
  const setCurrentAppId = useSetCurrentAppId()
  const autoSendInitialMessage = useAutoSendInitialMessage()
  const loadConversationHistory = useLoadConversationHistory()
  
  // Develop page store - for UI state and coordination
  const {
    viewMode,
    previewViewMode,
    isSelectMode,
    expandedPlan,
    chatPaneWidth,
    hasUnsavedChanges,
    selectedCommit,
    setHasUnsavedChanges,
    toggleSelectMode,
    toggleExpandedPlan,
    restartApp: restartAppFromStore,
    setChatPaneWidth,
    setIsSelectMode,
    loadingPhase,
    app,
    site,
    initializePage
  } = useDevelopPageStore()
  
  // Git history store - handles loading with smart retry logic
  const {
    loadGitHistory,
  } = useGitHistoryStore()

  // Local state (only what's not in stores)
  const [showUsageCost, setShowUsageCost] = useState(false)
  const [selectedElement, setSelectedElement] = useState<unknown>(null)
  
  // Store last known iframe state for restoration
  const lastIframeState = useRef<{
    url?: string
    scrollPosition?: { x: number; y: number }
  }>({})

  const headerRef = useRef<HeaderRef>(null)
  
  // Streaming store state
  const isLoading = useIsLoading()

  useEffect(() => {
    logImpressionEvent({ eid: 'develop.page' })();
  }, [])

  // Main initialization - orchestrated through store
  useEffect(() => {
    if (appId) {
      console.log('🚀 Initializing page for appId:', appId)
      initializePage(appId).catch(error => {
        console.error('❌ Page initialization failed:', error)
      })
    }
  }, [appId, initializePage])


  // MESSAGE HANDLER - Uses store for message handling
  const handleSendMessage = useCallback(async (messageContent?: string) => {
    // Message sending is now handled directly by ChatPane via useWebSocketWithConversationStore
    // Just refresh token usage for now
    headerRef.current?.refreshTokenUsage()
  }, [])

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
    loadConversationHistory(appId)
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
  const pendingUpdateRef = useRef<{selector: string; property: string; value: string; newClassName: string; newStyle?: string} | null>(null)
  const isFirstUpdateRef = useRef(true)

  const sendStyleUpdate = useCallback(async (styleData: {selector: string; property: string; value: string; newClassName: string; newStyle?: string}) => {
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

  const sendTextUpdate = useCallback(async (textData: {selector: string; oldText: string; newText: string; devContext: Record<string, unknown>}) => {
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

  const handleStyleUpdate = useCallback(async (styleData: {selector: string; property: string; value: string; newClassName: string; newStyle?: string}) => {
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
      // Only handle messages from our iframe
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (!iframe || event.source !== iframe.contentWindow) return

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
            handlePreviewRefresh()
          }, 500) // Small delay to ensure any file changes are processed
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleStyleUpdate, sendTextUpdate, setAiEditContext, setIsSelectMode])

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

  // Handle URL message parameter - simplified logic
  useEffect(() => {
    if (loadingPhase !== 'ready') return
    
    const message = searchParams.get('message')
    if (message && conversations.length === 0) {
      const decodedMessage = decodeURIComponent(message)
      setInputValue(decodedMessage)
      
      // Auto-send and clear URL
      setTimeout(() => {
        handleSendMessage(decodedMessage)
        const url = new URL(window.location.href)
        url.searchParams.delete('message')
        router.replace(url.pathname + url.search, { scroll: false })
      }, 500)
    }
  }, [loadingPhase, searchParams, conversations.length, router, setInputValue, handleSendMessage])

  // Handle auto-send initial message for new apps (after conversation history is loaded)
  useEffect(() => {
    if (loadingPhase !== 'ready' || !appId || isLoading) return
    
    // Wait a bit for conversation history to load, then check if we should auto-send
    const timer = setTimeout(() => {
      // Check if we should auto-send initial message
      const shouldAutoSend = 
        site?.initial_prompt &&
        site.status === 'running' &&
        app &&
        !app.initialBuildComplete &&
        conversations.length === 0 &&
        !searchParams.get('message') // Don't auto-send if there's a URL message
      
      if (shouldAutoSend) {
        console.log('🚀 Auto-sending initial message for new app:', appId)
        
        // Use the streaming store's auto-send function
        const wasTriggered = autoSendInitialMessage(site.initial_prompt!, appId)
        
        if (wasTriggered) {
          // Trigger the actual send after a brief delay to ensure WebSocket is ready
          setTimeout(() => {
            handleSendMessage(site.initial_prompt!)
          }, 1000)
        }
      }
    }, 500) // Wait 500ms for conversation history to load
    
    return () => clearTimeout(timer)
  }, [loadingPhase, appId, site, app, conversations.length, searchParams, autoSendInitialMessage, handleSendMessage, isLoading])

  // Load git history when page is ready
  useEffect(() => {
    if (loadingPhase === 'ready' && appId) {
      console.log('🔄 Page ready, loading git history for app:', appId)
      loadGitHistory(appId)
    }
  }, [loadingPhase, appId, loadGitHistory])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleRestartServer = async () => {
    if (!appId) return
    
    console.log('🔄 Starting server restart process...')
    
    try {
      await restartAppFromStore(appId, appStoreRestartApp)
      console.log('✅ App restart completed successfully')
      
      // Refresh the preview after successful restart
      setTimeout(() => {
        handlePreviewRefresh()
      }, 1000)
      
    } catch (error) {
      console.error('❌ Error restarting server:', error)
      
      // More user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      if (errorMessage.includes('404')) {
        alert('App not found or not ready for restart. Please try again in a moment.')
      } else {
        alert(`Failed to restart server: ${errorMessage}`)
      }
    }
  }

  const handlePanelResize = useCallback((newWidth: number) => {
    setChatPaneWidth(newWidth)
  }, [setChatPaneWidth])

  const handlePreviewRefresh = () => {
    // First request current visual context to capture scroll position
    const iframe = document.querySelector('#preview-iframe') as HTMLIFrameElement
    if (iframe && iframe.contentWindow) {
      try {
        postMessageToIframe(iframe, { type: 'REQUEST_VISUAL_CONTEXT' })
      } catch (error) {
        console.error('Cannot request visual context:', error)
      }
      
      // Wait a bit for the response, then refresh with whatever state we have
      setTimeout(() => {
        window.postMessage({ 
          type: 'preview-refresh',
          preserveState: lastIframeState.current 
        }, window.location.origin)
      }, 100) // Short delay to allow visual context response
    } else {
      // No iframe available, just refresh
      window.postMessage({ type: 'preview-refresh' }, window.location.origin)
    }
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <Header
        ref={headerRef}
        app={{
          ...app,
          name: site?.name || app?.name || `App ${appId}` // Prioritize site name over app name
        }}
        showUsageCost={showUsageCost}
        onPreviewRefresh={handlePreviewRefresh}
        onRestartServer={handleRestartServer}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Chat Panel */}
        <div 
          className="flex flex-col border-r flex-shrink-0"
          style={{ 
            width: `${chatPaneWidth}px`,
            minWidth: `${chatPaneWidth}px`,
            maxWidth: `${chatPaneWidth}px`
          }}

        >
          <StreamingChatPane
            expandedPlan={expandedPlan}
            isSelectMode={isSelectMode}
            onKeyPress={handleKeyPress}
            onToggleSelectMode={toggleSelectMode}
            onToggleExpandedPlan={toggleExpandedPlan}
            appId={appId}
          />
        </div>

        {/* Resizable Divider */}
        <ResizableDivider 
          onResize={handlePanelResize}
          initialLeftWidth={chatPaneWidth}
          minLeftWidth={300}
          minRightWidth={400}
        />

        {/* Code/Preview Panel */}
        <div className="flex-1 bg-white flex flex-col">
          {/* Code/Preview Area - Keep both mounted to preserve state */}
          <div className="flex-1 overflow-hidden relative">
            {/* Preview Pane */}
            <div className={`absolute inset-0 ${viewMode === 'preview' ? 'block' : 'hidden'}`}>
              <PreviewPane 
                appId={appId}
                viewMode={previewViewMode}
                selectedCommit={selectedCommit || undefined}
                onRetry={() => {
                  // Refresh app data when retrying
                  // App data refreshing is now handled by the store
                }}
              />
              
            </div>

            {/* Code Editor */}
            <div className={`absolute inset-0 ${viewMode === 'code' ? 'block' : 'hidden'}`}>
              <CodeEditor 
                appId={appId} 
                onUnsavedChanges={setHasUnsavedChanges}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Develop() {
  return (
    <ProtectedRoute 
      requiredAccess="user"
      loadingMessage="Loading Development Environment"
      unauthorizedMessage="You need to be signed in to access the development environment."
    >
      <Suspense fallback={<div>Loading development environment...</div>}>
        <DevelopPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}
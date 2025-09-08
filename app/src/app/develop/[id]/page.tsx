'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import ChatPane from '@/app/develop/components/ChatPane'
import PreviewPane from '@/app/develop/components/PreviewPaneSimple'
import CodeEditor from '@/app/develop/components/CodeEditor'
import ResizableDivider from '@/app/develop/components/ResizableDivider'
import Header, { HeaderRef } from './header'
import { 
  cleanup as cleanupMessageService
} from '@/app/develop/components/messageService'
import { ProtectedRoute } from '@/components/auth'
import { appService, App } from '@/services/AppService'
import { useMessagesStore, cleanupMessagesStore } from '@/stores/useMessagesStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitHistory } from '@/hooks/useGitHistory'
import { useAppStore, AppStatus } from '@/stores/useAppStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { useSite } from '@/stores/useSiteStore'

function DevelopPageContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const appId = params.id as string
  
  // App store - for app lifecycle operations
  const { ensureAppIsRunning: appStoreEnsureAppIsRunning, restartApp: appStoreRestartApp, loadApps } = useAppStore()
  
  // Server polling store - unified server status management
  const { startPollingForServer, stopPollingForServer, getServerState, cleanup: cleanupServerPolling } = useServerPollingStore()
  
  // Site store - for site data and metadata
  const { site, isLoading: siteLoading, fetchSite } = useSite(appId)
  
  // Messages store - for conversations and messages
  const {
    conversations,
    inputValue,
    isLoading,
    setInputValue,
    setAiEditContext,
    initializeConversations,
    handleSendMessage: sendMessageFromStore
  } = useMessagesStore()
  
  // Develop page store - for UI state and coordination
  const {
    viewMode,
    previewViewMode,
    isSelectMode,
    expandedPlan,
    chatPaneWidth,
    hasUnsavedChanges,
    isVersionHistoryOpen,
    selectedCommit,
    setHasUnsavedChanges,
    ensureAppIsRunning: ensureAppIsRunningFromStore,
    selectCommit: selectCommitFromStore,
    toggleSelectMode,
    toggleExpandedPlan,
    toggleVersionHistory,
    restartApp: restartAppFromStore,
    setChatPaneWidth,
    setIsSelectMode
  } = useDevelopPageStore()
  
  // Git history hook - handles loading with smart retry logic
  const {
    commits: commitHistory,
    isLoading: isLoadingCommits,
    refresh: refreshGitHistory
  } = useGitHistory(appId, false) // Don't auto-load, we'll trigger it manually
  
  // Local state (only what's not in stores)
  const [app, setApp] = useState<App | null>(null)
  const [showUsageCost, setShowUsageCost] = useState(false)
  const [selectedElement, setSelectedElement] = useState<unknown>(null)
  const [isInitialAppCreation, setIsInitialAppCreation] = useState(false)
  
  // App loading state machine
  const [loadingState, setLoadingState] = useState<'idle' | 'loading-app' | 'loading-conversations' | 'ready'>('idle')

  const initialMessageProcessed = useRef(false)
  const appCheckProcessed = useRef(false)
  const autoSendTriggered = useRef(false) // Prevent multiple auto-sends
  const headerRef = useRef<HeaderRef>(null)
  const previousAppIdRef = useRef<string | null>(null)
  const initializationStarted = useRef<string | null>(null)

  // Fetch site data when appId changes
  useEffect(() => {
    if (appId && !site && !siteLoading) {
      console.log('🌐 Fetching site data for appId:', appId)
      fetchSite()
    }
  }, [appId, site, siteLoading, fetchSite])

  // Consolidated App Initialization - handles cleanup, app loading, and conversations
  useEffect(() => {
    const initializeApp = async () => {
      // Prevent double initialization in React Strict Mode
      if (initializationStarted.current === appId) {
        console.log('🛑 Initialization already in progress for appId:', appId, '- skipping duplicate')
        return
      }
      initializationStarted.current = appId
      
      // 1. Always ensure clean state before initializing new app
      const currentAppInStore = useMessagesStore.getState().currentAppId
      if (currentAppInStore && currentAppInStore !== appId) {
        console.log('🔄 Store has different app ID:', currentAppInStore, '-> cleaning up before loading', appId)
        
        // Get app data first to preserve initial prompt during cleanup
        const appData = await appService.getApp(appId)
        const hasInitialPrompt = appData.app?.initialPrompt
        
        if (hasInitialPrompt) {
          console.log('🔒 Preserving initial prompt during cleanup:', appData.app.initialPrompt)
          // Clean up but preserve the initial prompt
          const { cleanup } = useMessagesStore.getState()
          cleanup()
          cleanupServerPolling()
          
          // Set the initial prompt immediately after cleanup
          if (appData.app.initialPrompt) {
            useMessagesStore.getState().setInputValue(appData.app.initialPrompt)
          }
        } else {
          cleanupMessagesStore()
          cleanupServerPolling()
        }
        
        // Clear local state
        setApp(null)
        setIsInitialAppCreation(false)
        setLoadingState('idle')
        
        // Reset flags
        initialMessageProcessed.current = false
        autoSendTriggered.current = false
        appCheckProcessed.current = false
      } else if (previousAppIdRef.current && previousAppIdRef.current !== appId) {
        console.log('🔄 App ID changed from', previousAppIdRef.current, 'to', appId, '- cleaning up previous app state')
        cleanupMessagesStore()
        cleanupServerPolling()
        
        // Clear local state
        setApp(null)
        setIsInitialAppCreation(false)
        setLoadingState('idle')
        
        // Reset flags
        initialMessageProcessed.current = false
        autoSendTriggered.current = false
        appCheckProcessed.current = false
        initializationStarted.current = null // Reset for new app
      } else if (previousAppIdRef.current === null) {
        console.log('🏁 Initial app load for appId:', appId, '- checking for stale store data')
      }
      
      previousAppIdRef.current = appId
      
      if (!appId) return

      try {
        // 2. Ensure messages store has currentAppId set early for auto-send functionality
        console.log('🔗 Ensuring messages store currentAppId is set:', appId)
        const messagesState = useMessagesStore.getState()
        if (!messagesState.currentAppId || messagesState.currentAppId !== appId) {
          // Set currentAppId directly in the store
          useMessagesStore.setState(state => ({ 
            ...state, 
            currentAppId: appId 
          }))
          console.log('✅ Messages store currentAppId set:', appId)
        }

        // 3. Load app data and refresh apps store
        setLoadingState('loading-app')
        console.log('📱 Loading app data:', appId)
        
        const [appData, configData] = await Promise.all([
          appService.getApp(appId),
          appService.getConfig(appId),
          loadApps() // Load all apps into the store for PreviewPane
        ])
        
        setApp(appData.app)
        setShowUsageCost(configData.config.showUsageCost)
        
        // Server tracking is now handled by useServerPollingStore
        
        // Check if this is initial app creation
        const isNewApp = appData.app.status === AppStatus.CREATED && !!appData.app.initialPrompt
        setIsInitialAppCreation(isNewApp)
        
        // 4. Ensure app is running (one-time check)
        if (!appCheckProcessed.current) {
          appCheckProcessed.current = true
          await ensureAppIsRunningFromStore(appId, appStoreEnsureAppIsRunning)
        }
        
        // 5. Give server time to settle on final port (avoid race condition with Vite port selection)
        if (isNewApp) {
          console.log('⏳ New app detected - waiting for server to settle on final port...')
          await new Promise(resolve => setTimeout(resolve, 3000)) // Wait 3 seconds for Vite to settle
        }
        
        // 6. Load conversations (required) and commit history (optional)
        setLoadingState('loading-conversations')
        console.log('💬 Loading conversations and history')
        
        // CRITICAL: Load conversations AFTER we're sure no cleanup will happen
        // Add a small delay to ensure all cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 100))
        await initializeConversations(appId)
        
        // Load commit history after a delay to ensure app is ready
        setTimeout(() => {
          refreshGitHistory() // This handles retries and proper timing internally
        }, 6000) // Wait 6 seconds to ensure app is fully ready
        
        setLoadingState('ready')
        console.log('✅ App initialization complete')
        
      } catch (error) {
        console.error('❌ App initialization failed:', error)
        setLoadingState('idle')
      } finally {
        initializationStarted.current = null // Reset flag when done
      }
    }
    
    initializeApp()
  }, [appId])

  // Handle initial prompt setup - site-based only
  useEffect(() => {
    console.log('🔍 Initial prompt check:', {
      loadingState,
      hasSiteInitialPrompt: !!site?.initial_prompt,
      siteStatus: site?.status,
      initialMessageProcessed: initialMessageProcessed.current,
      conversationsLength: conversations.length,
      currentInputValue: inputValue?.substring(0, 30) + (inputValue?.length > 30 ? '...' : '')
    })
    
    // Set initial prompt from site data
    if (loadingState === 'ready' && 
        site?.initial_prompt && 
        site.status === 'running' && 
        !initialMessageProcessed.current && 
        conversations.length === 0) {
      console.log('📝 Setting initial prompt from site:', site.initial_prompt)
      setInputValue(site.initial_prompt)
      initialMessageProcessed.current = true
    }
  }, [loadingState, site?.initial_prompt, site?.status, conversations.length, inputValue])

  // MESSAGE HANDLER - Uses store for message handling
  const handleSendMessage = useCallback(async (messageContent?: string) => {
    await sendMessageFromStore(messageContent)
    
    // Additional side effects after message sent
    headerRef.current?.refreshTokenUsage()
    handlePreviewRefresh()
    
    // Mark initial app creation as complete
    if (isInitialAppCreation) {
      setIsInitialAppCreation(false)
    }
  }, [isInitialAppCreation])

  // Auto-send initial prompt - simple site-based logic
  useEffect(() => {
    const shouldAutoSend = 
      site?.initial_prompt && 
      site.status === 'running' &&
      conversations.length === 0 &&
      !autoSendTriggered.current &&
      !isLoading;
    
    if (shouldAutoSend) {
      console.log('🚀 Auto-sending initial prompt:', site.initial_prompt?.substring(0, 50) + '...')
      autoSendTriggered.current = true
      
      const timer = setTimeout(async () => {
        try {
          await sendMessageFromStore(site.initial_prompt)
          console.log('✅ Auto-send completed')
          headerRef.current?.refreshTokenUsage()
          handlePreviewRefresh()
        } catch (error) {
          console.error('❌ Auto-send failed:', error)
          autoSendTriggered.current = false
        }
      }, 500)
      
      return () => clearTimeout(timer)
    }
  }, [site?.initial_prompt, site?.status, conversations.length, isLoading])

  // Cleanup WebSocket connections and batched updates on unmount
  useEffect(() => {
    return () => {
      cleanupMessageService(appId) // Clean up specific app connection
      cleanupServerPolling() // Clean up server polling
      // Clear any pending style update timeout
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current)
      }
    }
  }, [appId, cleanupServerPolling])

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
          // Handle real-time scroll position updates from iframe
          console.log('Scroll position updated in iframe:', event.data)
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
    if (loadingState !== 'ready') return
    
    const message = searchParams.get('message')
    if (message && !initialMessageProcessed.current && conversations.length === 0) {
      const decodedMessage = decodeURIComponent(message)
      setInputValue(decodedMessage)
      initialMessageProcessed.current = true
      
      // Auto-send and clear URL
      setTimeout(() => {
        handleSendMessage(decodedMessage)
        const url = new URL(window.location.href)
        url.searchParams.delete('message')
        router.replace(url.pathname + url.search, { scroll: false })
      }, 500)
    }
  }, [loadingState, searchParams, conversations.length, router])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleRestartServer = async () => {
    if (!appId) return
    
    try {
      await restartAppFromStore(appId, appStoreRestartApp)
      
      // Refresh app data
      try {
        const data = await appService.getApp(appId)
        setApp(data.app)
        console.log('🔄 App data refreshed after restart')
      } catch (refreshError) {
        console.error('❌ Failed to refresh app data:', refreshError)
      }
    } catch (error) {
      console.error('❌ Error restarting server:', error)
      alert('Failed to restart server')
    }
  }

  const handlePanelResize = useCallback((newWidth: number) => {
    setChatPaneWidth(newWidth)
  }, [setChatPaneWidth])

  const handlePreviewRefresh = () => {
    const iframe = document.querySelector('#preview-iframe') as HTMLIFrameElement
    if (iframe) {
      iframe.src = iframe.src
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
          className="bg-white flex flex-col border-r border-gray-200 flex-shrink-0"
          style={{ 
            width: `${chatPaneWidth}px`,
            minWidth: `${chatPaneWidth}px`,
            maxWidth: `${chatPaneWidth}px`
          }}

        >
          <ChatPane
            expandedPlan={expandedPlan}
            isSelectMode={isSelectMode}
            onKeyPress={handleKeyPress}
            onToggleSelectMode={toggleSelectMode}
            onToggleExpandedPlan={toggleExpandedPlan}
            onToggleVersionHistory={() => toggleVersionHistory(appId)}
            isVersionHistoryOpen={isVersionHistoryOpen}
            hasSelectedCommit={selectedCommit !== null}
            appId={appId}
            selectedCommit={selectedCommit}
            commits={commitHistory}
            isLoadingCommits={isLoadingCommits}
            onRefreshCommits={refreshGitHistory}
            onSelectCommit={async (commit) => {
              await selectCommitFromStore(appId, commit)
              handlePreviewRefresh()
            }}
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
                  if (appId) {
                    appService.getApp(appId)
                      .then(data => setApp(data.app))
                      .catch(console.error)
                  }
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

            {/* Version History Panel removed - now integrated in ChatPane */}
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
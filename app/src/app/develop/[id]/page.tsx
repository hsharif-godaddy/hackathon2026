'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { appFetch } from '@/lib/gasket-config'
import ChatPane from '@/app/develop/components/ChatPane'
import PreviewPane from '@/app/develop/components/PreviewPane'
import CodeEditor from '@/app/develop/components/CodeEditor'
import ResizableDivider from '@/app/develop/components/ResizableDivider'
import TokenUsage, { TokenUsageRef } from '@/app/develop/components/TokenUsage'
import Header from './header'
import { Message, PlanItem, AiEditContext } from '@/app/develop/components/types'
import { 
  handleSendMessage as sendMessage, 
  cleanup as cleanupMessageService,
  loadConversations,
  loadConversation
} from '@/app/develop/components/messageService'
import { ProtectedRoute } from '@/components/auth'
import { appService, App } from '@/services/AppService'

function DevelopPageContent() {
  const params = useParams()
  const router = useRouter()
  const appId = params.id as string
  const [app, setApp] = useState<App | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Array<{id: string; updatedAt: string}>>([])
  const [developmentPlan] = useState<PlanItem[]>([])
  const [expandedPlan, setExpandedPlan] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [isRestarting, setIsRestarting] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showUsageCost, setShowUsageCost] = useState(false)
  const [isCheckingApp, setIsCheckingApp] = useState(false)
  const [isStartingApp, setIsStartingApp] = useState(false)
  const [selectedElement, setSelectedElement] = useState<unknown>(null)
  const [aiEditContext, setAiEditContext] = useState<AiEditContext | null>(null)
  const [isInitialAppCreation, setIsInitialAppCreation] = useState(false)
  const [chatPaneWidth, setChatPaneWidth] = useState(400)
  const [previewViewMode, setPreviewViewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false)
  
  // App loading state machine
  const [loadingState, setLoadingState] = useState<'idle' | 'loading-app' | 'loading-conversations' | 'ready'>('idle')
  const [selectedCommit, setSelectedCommit] = useState<{
    hash: string
    shortHash: string
    message: string
    author: string
    date: string
  } | null>(null)
  const [commitHistory, setCommitHistory] = useState<Array<{
    hash: string
    shortHash: string
    message: string
    author: string
    date: string
  }>>([])
  const [isLoadingCommits, setIsLoadingCommits] = useState(false)

  const searchParams = useSearchParams()
  const initialMessageProcessed = useRef(false)
  const appCheckProcessed = useRef(false)
  const autoSendTriggered = useRef(false) // Prevent multiple auto-sends
  const tokenUsageRef = useRef<TokenUsageRef>(null)
  const previousAppIdRef = useRef<string | null>(null)

  // Fetch commit history
  const fetchCommitHistory = useCallback(async () => {
    if (!appId) return
    
    setIsLoadingCommits(true)
    
    try {
      // Request a higher count to ensure we get all commits
      const response = await appFetch(`http://localhost:4000/apps/${appId}/git/history?count=100`)
      
      if (response.ok) {
        const data = await response.json()
        const commits = data.commits || []
        setCommitHistory(commits)
        console.log(`Loaded ${commits.length} commits from history`)
      } else {
        console.error('Failed to load commit history')
      }
    } catch (err) {
      console.error('Error loading commit history:', err)
    } finally {
      setIsLoadingCommits(false)
    }
  }, [appId])

  // Ensure app is running (generic backend logic)
  const ensureAppIsRunning = async (appId: string) => {
    try {
      setIsCheckingApp(true)
      console.log('🔍 Ensuring app is running:', appId)
      
      const data = await appService.ensureAppIsRunning(appId)
      console.log('📊 App ensure-running response:', data)
      
      if (data.action === 'rebuild' || data.action === 'start') {
        setIsStartingApp(true)
        console.log(`🔄 App is being ${data.action === 'rebuild' ? 'rebuilt' : 'started'}...`)
        
        // Wait for the action to complete (backend already waits, but show UI feedback)
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        setIsStartingApp(false)
      }
      
      if (data.success) {
        console.log(`✅ App is now running: ${data.message}`)
      }
    } catch (error) {
      console.error('Error ensuring app is running:', error)
    } finally {
      setIsCheckingApp(false)
      setIsStartingApp(false)
    }
  }

  // Consolidated App Initialization - handles cleanup, app loading, and conversations
  useEffect(() => {
    const initializeApp = async () => {
      // 1. Handle app ID change cleanup
      if (previousAppIdRef.current && previousAppIdRef.current !== appId) {
        console.log('🔄 App ID changed - cleaning up previous app state')
        cleanupMessageService(previousAppIdRef.current)
        
        // Clear all state immediately
        setApp(null)
        setMessages([])
        setConversations([])
        setConversationId(null)
        setIsInitialAppCreation(false)
        setCommitHistory([])
        setSelectedCommit(null)
        setInputValue('')
        setLoadingState('idle')
        
        // Reset flags
        initialMessageProcessed.current = false
        autoSendTriggered.current = false
        appCheckProcessed.current = false
      }
      
      previousAppIdRef.current = appId
      
      if (!appId) return

      try {
        // 2. Load app data
        setLoadingState('loading-app')
        console.log('📱 Loading app data:', appId)
        
        const [appData, configData] = await Promise.all([
          appService.getApp(appId),
          appService.getConfig()
        ])
        
        setApp(appData.app)
        setShowUsageCost(configData.config.showUsageCost)
        
        // Check if this is initial app creation
        const isNewApp = appData.app.status === 'created' && !!appData.app.initialPrompt
        setIsInitialAppCreation(isNewApp)
        
        // 3. Ensure app is running (one-time check)
        if (!appCheckProcessed.current) {
          appCheckProcessed.current = true
          await ensureAppIsRunning(appId)
        }
        
        // 4. Load conversations and commit history
        setLoadingState('loading-conversations')
        console.log('💬 Loading conversations and history')
        
        const [conversationList] = await Promise.all([
          loadConversations(appId),
          fetchCommitHistory()
        ])
        
        setConversations(conversationList || [])
        
        // 5. Load most recent conversation if available
        if (conversationList && conversationList.length > 0) {
          const mostRecent = conversationList[0]
          const conversationData = await loadConversation(appId, mostRecent.id)
          
          if (conversationData) {
            setMessages(conversationData.messages)
            setConversationId(mostRecent.id)
          }
        }
        
        setLoadingState('ready')
        console.log('✅ App initialization complete')
        
      } catch (error) {
        console.error('❌ App initialization failed:', error)
        setLoadingState('idle')
      }
    }
    
    initializeApp()
  }, [appId])

  // One-time config loading
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const data = await appService.getConfig()
        setShowUsageCost(data.config.showUsageCost)
      } catch (error) {
        console.error('Error loading config:', error)
        setShowUsageCost(false)
      }
    }
    
    loadConfig()
  }, [])

  // Handle initial prompt setup - only when app is fully loaded
  useEffect(() => {
    if (loadingState === 'ready' && 
        isInitialAppCreation && 
        app?.initialPrompt && 
        !initialMessageProcessed.current && 
        conversations.length === 0) {
      
      console.log('📝 Setting initial prompt:', app.initialPrompt)
      setInputValue(app.initialPrompt)
      initialMessageProcessed.current = true
    }
  }, [loadingState, isInitialAppCreation, app?.initialPrompt, conversations.length])

  // 5. STABLE MESSAGE HANDLER - No state dependencies that cause loops
  const handleSendMessage = useCallback(async (messageContent?: string) => {
    const content = messageContent || inputValue
    if (!content.trim() || isLoading) return

    await sendMessage({
      messageContent: content,
      inputValue,
      isLoading,
      appId,
      conversationId: conversationId || undefined,
      aiEditContext,
      setMessages,
      setInputValue,
      setIsLoading,
      setConversationId,
      onTokenUsageUpdate: () => {
        tokenUsageRef.current?.refreshUsage()
      },
      onMessageComplete: () => {
        // Auto-refresh preview when agent completes a message
        handlePreviewRefresh()
      }
    })

    // Clear the AI edit context after sending message
    if (aiEditContext) {
      setAiEditContext(null)
    }
    
    // Post-send cleanup - using refs to avoid circular dependencies
    setTimeout(async () => {
      // Refresh conversations if this was the first message
      if (!conversationId) {
        try {
          const updatedConversations = await loadConversations(appId)
          setConversations(updatedConversations)
        } catch (error) {
          console.error('Error refreshing conversations:', error)
        }
      }
      
      // Mark initial app creation as complete
      if (isInitialAppCreation) {
        setIsInitialAppCreation(false)
      }
    }, 100)
  }, [inputValue, isLoading, appId, conversationId, aiEditContext, isInitialAppCreation])

  // Auto-send initial prompt - only when fully ready and conditions met
  useEffect(() => {
    const shouldAutoSend = 
      loadingState === 'ready' &&
      isInitialAppCreation && 
      app?.initialPrompt && 
      inputValue === app.initialPrompt && 
      conversations.length === 0 &&
      !autoSendTriggered.current &&
      !isLoading;
    
    if (shouldAutoSend) {
      console.log('🚀 Auto-sending initial prompt')
      autoSendTriggered.current = true
      
      const timer = setTimeout(() => {
        sendMessage({
          messageContent: inputValue,
          inputValue,
          isLoading: false,
          appId,
          conversationId: undefined,
          aiEditContext: null,
          setMessages,
          setInputValue,
          setIsLoading,
          setConversationId,
          onTokenUsageUpdate: () => {
            tokenUsageRef.current?.refreshUsage()
          },
          onMessageComplete: () => {
            handlePreviewRefresh()
          }
        }).then(() => {
          console.log('✅ Auto-send completed')
          setIsInitialAppCreation(false)
        }).catch(error => {
          console.error('❌ Auto-send failed:', error)
          autoSendTriggered.current = false
        })
      }, 500)
      
      return () => clearTimeout(timer)
    }
  }, [loadingState, isInitialAppCreation, inputValue, app?.initialPrompt, conversations.length, isLoading, appId])

  // Cleanup WebSocket connections and batched updates on unmount
  useEffect(() => {
    return () => {
      cleanupMessageService(appId) // Clean up specific app connection
      // Clear any pending style update timeout
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current)
      }
    }
  }, [appId])

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
  }, [handleStyleUpdate, sendTextUpdate])

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
  }, [loadingState, searchParams, conversations.length, handleSendMessage, router])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleToggleSelectMode = () => {
    const newSelectMode = !isSelectMode
    setIsSelectMode(newSelectMode)
    
    // Send message to preview iframe to toggle select mode
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'TOGGLE_SELECT_MODE',
        data: { isSelectMode: newSelectMode }
      }, '*')
    }
  }
  
  // Toggle version history and refresh commits if opened
  const handleToggleVersionHistory = () => {
    const newIsVersionHistoryOpen = !isVersionHistoryOpen
    setIsVersionHistoryOpen(newIsVersionHistoryOpen)
    
    // If opening the history, refresh the commits
    if (newIsVersionHistoryOpen) {
      fetchCommitHistory()
    }
  }

  const handleToggleExpandedPlan = () => {
    setExpandedPlan(!expandedPlan)
  }



  const handleRestartServer = async () => {
    if (!appId) return
    
    setIsRestarting(true)
    try {
      await appService.restartApp(appId)
      console.log('✅ Manual restart successful')
      await new Promise(resolve => setTimeout(resolve, 5000))
      
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
    } finally {
      setIsRestarting(false)
    }
  }

  const handleViewModeChange = (newMode: 'preview' | 'code') => {
    if (hasUnsavedChanges && viewMode === 'code' && newMode === 'preview') {
      const confirmed = window.confirm(
        'You have unsaved changes in the code editor. Switching to preview will keep your changes, but they won\'t be reflected in the preview until saved. Continue?'
      )
      if (!confirmed) return
    }
    setViewMode(newMode)
  }

  const handlePanelResize = useCallback((newWidth: number) => {
    setChatPaneWidth(newWidth)
  }, [])

  const handlePreviewRefresh = () => {
    const iframe = document.querySelector('#preview-iframe') as HTMLIFrameElement
    if (iframe) {
      iframe.src = iframe.src
    }
  }

  const togglePreviewViewMode = (mode: 'desktop' | 'mobile') => {
    setPreviewViewMode(mode)
  }

  const handleSelectCommit = async (commit: {
    hash: string
    shortHash: string
    message: string
    author: string
    date: string
  } | null) => {
    try {
      if (!appId) return
      
      // If null, return to latest (main branch)
      if (commit === null) {
        if (selectedCommit) {
          console.log('🔄 Returning to latest version (main branch)')
          // Return to main branch
          const response = await appFetch(`http://localhost:4000/apps/${appId}/git/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branch: 'main' })
          })
          
          if (response.ok) {
            const result = await response.json()
            console.log('✅ Returned to latest version:', result.message)
            // Refresh preview after switching
            handlePreviewRefresh()
            setSelectedCommit(null)
          } else {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            console.error('❌ Failed to return to latest version:', error.error || response.status)
          }
        }
        return
      }
      
      console.log(`🔍 Viewing commit ${commit.shortHash}: "${commit.message}" (${commit.date})`)
      console.log('⚠️ Note: Changes requested after this will be made on latest commit, not the viewed commit')
      
      // Checkout specific commit
      const response = await appFetch(`http://localhost:4000/apps/${appId}/git/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitHash: commit.hash })
      })
      
      if (response.ok) {
        const result = await response.json()
        console.log(`✅ Checked out commit ${commit.shortHash}`, result)
        setSelectedCommit(commit)
        // Refresh preview after switching
        handlePreviewRefresh()
      } else {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('❌ Failed to checkout commit:', error.error || response.status)
      }
    } catch (error) {
      console.error('❌ Error selecting commit:', error)
    }
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <Header
        appId={appId}
        app={app}
        viewMode={viewMode}
        previewViewMode={previewViewMode}
        hasUnsavedChanges={hasUnsavedChanges}
        showUsageCost={showUsageCost}
        isCheckingApp={isCheckingApp}
        isStartingApp={isStartingApp}
        isRestarting={isRestarting}
        onViewModeChange={handleViewModeChange}
        onTogglePreviewViewMode={togglePreviewViewMode}
        onPreviewRefresh={handlePreviewRefresh}
        onRestartServer={handleRestartServer}
        tokenUsageRef={tokenUsageRef}
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
            messages={messages}
            developmentPlan={developmentPlan}
            inputValue={inputValue}
            expandedPlan={expandedPlan}
            isSelectMode={isSelectMode}
            aiEditContext={aiEditContext}
            isLoading={isLoading}
            onInputChange={setInputValue}
            onSendMessage={() => handleSendMessage()}
            onKeyPress={handleKeyPress}
            onToggleSelectMode={handleToggleSelectMode}
            onToggleExpandedPlan={handleToggleExpandedPlan}
            onClearAiEditContext={() => setAiEditContext(null)}
            onToggleVersionHistory={handleToggleVersionHistory}
            isVersionHistoryOpen={isVersionHistoryOpen}
            hasSelectedCommit={selectedCommit !== null}
            appId={appId}
            selectedCommit={selectedCommit}
            commits={commitHistory}
            isLoadingCommits={isLoadingCommits}
            onRefreshCommits={fetchCommitHistory}
            onSelectCommit={handleSelectCommit}
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
                port={app?.port}
                viewMode={previewViewMode}
                selectedCommit={selectedCommit}
                onRetry={() => {
                  // Optionally refresh app data when retrying
                  if (appId && app) {
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
      <DevelopPageContent />
    </ProtectedRoute>
  );
}

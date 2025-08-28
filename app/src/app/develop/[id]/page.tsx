'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  SparklesIcon,
  PlayIcon,
  ArrowPathIcon,
  Squares2X2Icon,
  EyeIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  ArrowTopRightOnSquareIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import ChatPane from '@/app/develop/components/ChatPane'
import PreviewPane from '@/app/develop/components/PreviewPane'
import CodeEditor from '@/app/develop/components/CodeEditor'
import ResizableDivider from '@/app/develop/components/ResizableDivider'
import TokenUsage, { TokenUsageRef } from '@/app/develop/components/TokenUsage'
import VersionHistory from '@/app/develop/components/VersionHistory'
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
  const [isLoadingConversations, setIsLoadingConversations] = useState(true)
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

  // Fetch commit history
  const fetchCommitHistory = useCallback(async () => {
    if (!appId) return
    
    setIsLoadingCommits(true)
    
    try {
      const data = await appService.getGitHistory(appId)
      const commits = data.commits || []
      setCommitHistory(commits)
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

  // 1. PURE DATA LOADING - Fetch app details (no side effects)
  useEffect(() => {
    // Reset app check flag when appId changes
    appCheckProcessed.current = false
    
    const fetchApp = async () => {
      try {
        const data = await appService.getApp(appId)
        setApp(data.app)
        
                  // Check if this is a newly created app with an initial prompt
          const isNewApp = data.app.status === 'created' && !!data.app.initialPrompt
          console.log('🔍 App creation check - status:', data.app.status, 'initialPrompt:', !!data.app.initialPrompt, 'isNewApp:', isNewApp)
          setIsInitialAppCreation(isNewApp)
        
        // After fetching app details, ensure app is running if needed (prevent duplicate calls in Strict Mode)
        if (!appCheckProcessed.current) {
          appCheckProcessed.current = true
          await ensureAppIsRunning(appId)
        }
      } catch (error) {
        console.error('Error fetching app:', error)
      }
    }

    if (appId) {
      fetchApp()
    }
  }, [appId])

  // 2. PURE DATA LOADING - Fetch config (no side effects)
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const data = await appService.getConfig()
        setShowUsageCost(data.config.showUsageCost)
      } catch (error) {
        console.error('Error fetching config:', error)
        setShowUsageCost(false)
      }
    }

    fetchConfig()
  }, [])

  // 3. PURE DATA LOADING - Load conversations (minimal side effects)
  useEffect(() => {
    const loadAppConversations = async () => {
      if (!appId || !app) return
      
      try {
        setIsLoadingConversations(true)
        console.log('🔄 Loading conversations for app:', appId, 'app:', app)
        const conversationList = await loadConversations(appId)
        console.log('📚 Loaded conversation list:', conversationList?.length || 0, conversationList)
        setConversations(conversationList)
        
        // Load the most recent conversation if available
        if (conversationList.length > 0) {
          const mostRecent = conversationList[0]
          console.log('🔍 Loading most recent conversation:', mostRecent)
          const conversationData = await loadConversation(appId, mostRecent.id)
          
          if (conversationData) {
            console.log('✅ Loaded conversation:', mostRecent.id, 'with', conversationData.messages.length, 'messages')
            setMessages(conversationData.messages)
            setConversationId(mostRecent.id)
          } else {
            console.warn('⚠️ No conversation data returned for:', mostRecent.id)
          }
        } else {
          console.log('📝 No existing conversations found, app might be new')
        }
      } catch (error) {
        console.error('❌ Error loading conversations:', error)
      } finally {
        setIsLoadingConversations(false)
      }
    }

    loadAppConversations()
  }, [appId, app])
  
  // 3b. Load commit history
  useEffect(() => {
    if (appId && app && commitHistory.length === 0) {
      fetchCommitHistory()
    }
  }, [appId, app, commitHistory.length, fetchCommitHistory])

  // 4. PURE UI STATE - Set initial prompt in input (no actions)
  useEffect(() => {
    console.log('🔍 Initial prompt check:', {
      isInitialAppCreation,
      hasInitialPrompt: !!app?.initialPrompt,
      initialMessageProcessed: initialMessageProcessed.current,
      conversationsLength: conversations.length,
      isLoadingConversations
    })
    
    if (isInitialAppCreation && 
        app?.initialPrompt && 
        !initialMessageProcessed.current &&
        conversations.length === 0 &&
        !isLoadingConversations) {
      
      console.log('📝 Setting initial prompt in input:', app.initialPrompt)
      setInputValue(app.initialPrompt)
      initialMessageProcessed.current = true
    }
  }, [isInitialAppCreation, app?.initialPrompt, conversations.length, isLoadingConversations])

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

  // 6. AUTO-SEND TRIGGER - Separate effect with stable conditions only
  useEffect(() => {
    if (isInitialAppCreation && 
        inputValue && 
        app?.initialPrompt && 
        inputValue === app.initialPrompt && 
        !isLoadingConversations && 
        conversations.length === 0 &&
        initialMessageProcessed.current &&
        !autoSendTriggered.current &&
        !isLoading) {
      
      console.log('Triggering auto-send for initial prompt:', inputValue)
      autoSendTriggered.current = true
      
      // Use setTimeout to break out of the effect cycle
      const timer = setTimeout(() => {
        // Create stable message send function
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
          }
        }).then(() => {
          // Post-send actions
          setIsInitialAppCreation(false)
          setTimeout(async () => {
            try {
              const updatedConversations = await loadConversations(appId)
              setConversations(updatedConversations)
            } catch (error) {
              console.error('Error refreshing conversations:', error)
            }
          }, 100)
        })
      }, 500)
      
      return () => clearTimeout(timer)
    }
  }, [isInitialAppCreation, inputValue, app?.initialPrompt, isLoadingConversations, conversations.length, isLoading, appId])

  // Cleanup SSE connections and batched updates on unmount
  useEffect(() => {
    return () => {
      cleanupMessageService()
      // Clear any pending style update timeout
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current)
      }
    }
  }, [])

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

  const sendTextUpdate = useCallback(async (textData: {selector: string; oldText: string; newText: string; devContext: any}) => {
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

  // Handle initial message from URL parameter
  useEffect(() => {
    const message = searchParams.get('message')
    if (message && !initialMessageProcessed.current && !isLoadingConversations) {
      const decodedMessage = decodeURIComponent(message)
      
      // Only auto-send if we don't have any existing conversations
      // (i.e., this is a brand new app or we're starting fresh)
      if (conversations.length === 0) {
        setInputValue(decodedMessage)
        initialMessageProcessed.current = true
        // Auto-send the message (this will create a new conversation)
        setTimeout(() => {
          handleSendMessage(decodedMessage)
          // Clear URL parameter after sending
          const url = new URL(window.location.href)
          url.searchParams.delete('message')
          router.replace(url.pathname + url.search, { scroll: false })
        }, 100)
      } else {
        // We have existing conversations, just mark as processed without sending
        initialMessageProcessed.current = true
      }
    } else if (!message && !initialMessageProcessed.current && !isLoadingConversations) {
      setInputValue('')
      initialMessageProcessed.current = true
    }
  }, [searchParams, isLoadingConversations, conversations.length, handleSendMessage, router])

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
          // Return to main branch
          await appService.returnToMainBranch(appId)
          console.log('Returned to latest version')
          // Refresh preview after switching
          handlePreviewRefresh()
          setSelectedCommit(null)
        }
        return
      }
      
      // Checkout specific commit
      await appService.checkoutCommit(appId, commit.hash)
      console.log(`Checked out commit ${commit.shortHash}`)
      setSelectedCommit(commit)
      // Refresh preview after switching
      handlePreviewRefresh()
    } catch (error) {
      console.error('Error selecting commit:', error)
    }
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-12">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center space-x-3">
                <div className="flex items-center justify-center">
                  <Image src="/logo.svg" alt="Airo Logo" width={128} height={48} />
                </div>
              </Link>
              <div className="h-6 w-px bg-gray-300" />
              <div className="flex items-center space-x-2">
                <span className="text-gray-900 font-medium">
                  {app ? app.name : `App ${appId}`}
                </span>
                {isCheckingApp && (
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Checking App Status...
                  </span>
                )}
                {isStartingApp && !isCheckingApp && (
                  <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                    Starting App...
                  </span>
                )}
                {isRestarting && !isCheckingApp && !isStartingApp && (
                  <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                    Restarting App...
                  </span>
                )}

              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* View Mode Toggle Buttons */}
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => handleViewModeChange('preview')}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    viewMode === 'preview' 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Preview
                </button>
                <button 
                  onClick={() => handleViewModeChange('code')}
                  className={`flex items-center px-2 py-1 text-xs rounded-md transition-colors ${
                    viewMode === 'code' 
                      ? 'bg-purple-100 text-purple-700' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Code
                  {hasUnsavedChanges && viewMode === 'code' && (
                    <div className="w-2 h-2 bg-orange-500 rounded-full ml-1" title="Unsaved changes" />
                  )}
                </button>
                <button 
                  onClick={() => setIsVersionHistoryOpen(!isVersionHistoryOpen)}
                  className={`flex items-center px-2 py-1 text-xs rounded-md transition-colors ${
                    isVersionHistoryOpen || selectedCommit
                      ? 'bg-amber-100 text-amber-700' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <ClockIcon className="w-3 h-3 mr-1" />
                  {selectedCommit ? 'History*' : 'History'}
                </button>
              </div>

              {/* Preview controls when in preview mode */}
              {viewMode === 'preview' && app?.port && (
                <div className="flex items-center space-x-3">
                  {/* View Mode Toggles */}
                  <div className="flex items-center space-x-1 border border-gray-200 rounded-md p-0.5">
                    <button
                      onClick={() => togglePreviewViewMode('desktop')}
                      className={`p-1 rounded transition-colors ${
                        previewViewMode === 'desktop'
                          ? 'bg-blue-100 text-blue-600'
                          : 'hover:bg-gray-100 text-gray-600'
                      }`}
                      title="Desktop view"
                    >
                      <ComputerDesktopIcon className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => togglePreviewViewMode('mobile')}
                      className={`p-1 rounded transition-colors ${
                        previewViewMode === 'mobile'
                          ? 'bg-blue-100 text-blue-600'
                          : 'hover:bg-gray-100 text-gray-600'
                      }`}
                      title="Mobile view"
                    >
                      <DevicePhoneMobileIcon className="w-3 h-3" />
                    </button>
                  </div>
                  
                  {/* App Control Buttons */}
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={handlePreviewRefresh}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title="Reload preview (refresh page content)"
                    >
                      <ArrowPathIcon className="w-3 h-3 text-gray-600" />
                    </button>
                    
                    <button 
                      onClick={handleRestartServer}
                      disabled={!app?.port || isRestarting}
                      className="p-1 hover:bg-orange-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Restart server (rebuild and restart development server)"
                    >
                      <ArrowPathIcon className={`w-3 h-3 ${isRestarting ? 'animate-spin text-orange-600' : 'text-orange-600'}`} />
                    </button>
                    
                    <button 
                      onClick={() => {
                        if (app?.port) {
                          window.open(`http://localhost:${app.port}`, '_blank')
                        }
                      }}
                      disabled={!app?.port || isCheckingApp || isRestarting || isStartingApp}
                      className="p-1 hover:bg-green-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Open app in new tab"
                    >
                      <ArrowTopRightOnSquareIcon className="w-3 h-3 text-green-600" />
                    </button>
                  </div>
                </div>
              )}
              
              {appId && (
                <TokenUsage ref={tokenUsageRef} appId={appId} enabled={showUsageCost} />
              )}
              <Link
                href="/apps"
                className="inline-flex items-center px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium"
              >
                <Squares2X2Icon className="w-4 h-4 mr-2" />
                My Apps
              </Link>
            </div>
          </div>
        </div>
      </header>

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
            onInputChange={setInputValue}
            onSendMessage={() => handleSendMessage()}
            onKeyPress={handleKeyPress}
            onToggleSelectMode={handleToggleSelectMode}
            onToggleExpandedPlan={handleToggleExpandedPlan}
            onClearAiEditContext={() => setAiEditContext(null)}
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

            {/* Version History Panel */}
            {isVersionHistoryOpen && (
              <VersionHistory
                appId={appId}
                isOpen={isVersionHistoryOpen}
                onClose={() => setIsVersionHistoryOpen(false)}
                onSelectCommit={handleSelectCommit}
                selectedCommit={selectedCommit}
                commits={commitHistory}
                isLoading={isLoadingCommits}
                onRefresh={fetchCommitHistory}
              />
            )}
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

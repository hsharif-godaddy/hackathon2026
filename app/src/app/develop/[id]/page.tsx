'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  SparklesIcon,
  PlayIcon,
  ArrowPathIcon,
  Squares2X2Icon
} from '@heroicons/react/24/outline'
import ChatPane from '@/app/develop/components/ChatPane'
import PreviewPane from '@/app/develop/components/PreviewPane'
import CodeEditor from '@/app/develop/components/CodeEditor'
import TokenUsage, { TokenUsageRef } from '@/app/develop/components/TokenUsage'
import { Message, PlanItem } from '@/app/develop/components/types'
import { 
  handleSendMessage as sendMessage, 
  cleanup as cleanupMessageService,
  loadConversations,
  loadConversation
} from '@/app/develop/components/messageService'
import { ProtectedRoute } from '@/components/auth'
import { appFetch } from '@/lib/gasket-config'

interface App {
  id: string
  name: string
  port: number
  initialPrompt?: string
  status: 'creating' | 'created' | 'error'
  createdAt: string
  updatedAt: string
}

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
  const [selectedElement, setSelectedElement] = useState<unknown>(null)
  const [isInitialAppCreation, setIsInitialAppCreation] = useState(false)

  const searchParams = useSearchParams()
  const initialMessageProcessed = useRef(false)
  const autoSendTriggered = useRef(false) // Prevent multiple auto-sends
  const tokenUsageRef = useRef<TokenUsageRef>(null)

  // 1. PURE DATA LOADING - Fetch app details (no side effects)
  useEffect(() => {
    const fetchApp = async () => {
      try {
        const response = await appFetch(`http://localhost:4000/apps/${appId}`)
        if (response.ok) {
          const data = await response.json()
          setApp(data.app)
          
          // Check if this is a newly created app with an initial prompt
          const isNewApp = data.app.status === 'created' && data.app.initialPrompt
          setIsInitialAppCreation(isNewApp)
        } else {
          console.error('Failed to fetch app:', response.status)
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
        const response = await appFetch('http://localhost:4000/apps/config')
        if (response.ok) {
          const data = await response.json()
          setShowUsageCost(data.config.showUsageCost)
        }
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
        const conversationList = await loadConversations(appId)
        setConversations(conversationList)
        
        // Load the most recent conversation if available
        if (conversationList.length > 0) {
          const mostRecent = conversationList[0]
          const conversationData = await loadConversation(appId, mostRecent.id)
          
          if (conversationData) {
            console.log('Loaded conversation:', mostRecent.id, 'with', conversationData.messages.length, 'messages')
            setMessages(conversationData.messages)
            setConversationId(mostRecent.id)
          }
        }
      } catch (error) {
        console.error('Error loading conversations:', error)
      } finally {
        setIsLoadingConversations(false)
      }
    }

    loadAppConversations()
  }, [appId, app])

  // 4. PURE UI STATE - Set initial prompt in input (no actions)
  useEffect(() => {
    if (isInitialAppCreation && 
        app?.initialPrompt && 
        !initialMessageProcessed.current &&
        conversations.length === 0 &&
        !isLoadingConversations) {
      
      console.log('Setting initial prompt in input:', app.initialPrompt)
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
      setMessages,
      setInputValue,
      setIsLoading,
      setConversationId,
      onTokenUsageUpdate: () => {
        tokenUsageRef.current?.refreshUsage()
      }
    })
    
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
  }, [inputValue, isLoading, appId, conversationId, isInitialAppCreation])

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
      const response = await appFetch(`http://localhost:4000/apps/${appId}/styles/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selector: styleData.selector,
          property: styleData.property,
          value: styleData.value,
          newClassName: styleData.newClassName,
          newStyle: styleData.newStyle,
          elementInfo: selectedElement
        })
      })

      if (response.ok) {
        const result = await response.json()
        console.log('Style update sent to API:', result)
      } else {
        console.error('Failed to send style update to API:', response.status)
      }
    } catch (error) {
      console.error('Error sending style update to API:', error)
    }
  }, [appId, selectedElement])

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
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleStyleUpdate])

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
      const response = await appFetch(`http://localhost:4000/apps/${appId}/restart`, {
        method: 'POST'
      })
      
      if (response.ok) {
        // Wait a moment for the server to restart
        setTimeout(() => {
          // Refresh app data
          appFetch(`http://localhost:4000/apps/${appId}`)
            .then(res => res.json())
            .then(data => setApp(data.app))
            .catch(console.error)
        }, 2000)
      } else {
        alert('Failed to restart server')
      }
    } catch (error) {
      console.error('Error restarting server:', error)
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

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                  <SparklesIcon className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  Airo
                </span>
              </Link>
              <div className="h-6 w-px bg-gray-300" />
              <span className="text-gray-600">
                {app ? app.name : `App ${appId}`} - Development Environment
                {isInitialAppCreation && (
                  <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    New App
                  </span>
                )}
                {conversationId && (
                  <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Chat: {conversationId.slice(0, 8)}...
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center space-x-4">
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
              <button 
                onClick={handleRestartServer}
                disabled={!app?.port || isRestarting}
                className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-orange-600 to-red-600 text-white text-sm font-medium rounded-lg hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowPathIcon className={`w-4 h-4 mr-2 ${isRestarting ? 'animate-spin' : ''}`} />
                {isRestarting ? 'Restarting...' : 'Restart'}
              </button>
              <button 
                onClick={() => {
                  if (app?.port) {
                    window.open(`http://localhost:${app.port}`, '_blank')
                  }
                }}
                disabled={!app?.port}
                className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white text-sm font-medium rounded-lg hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PlayIcon className="w-4 h-4 mr-2" />
                {app?.port ? 'Open App' : 'Loading...'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0">
        {/* Chat Panel */}
        <ChatPane
          messages={messages}
          developmentPlan={developmentPlan}
          inputValue={inputValue}
          expandedPlan={expandedPlan}
          isSelectMode={isSelectMode}
          onInputChange={setInputValue}
          onSendMessage={() => handleSendMessage()}
          onKeyPress={handleKeyPress}
          onToggleSelectMode={handleToggleSelectMode}
          onToggleExpandedPlan={handleToggleExpandedPlan}
        />

        {/* Code/Preview Panel */}
        <div className="flex-1 bg-white flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                {viewMode === 'preview' ? 'App Preview' : 'Code Editor'}
                {viewMode === 'code' && hasUnsavedChanges && (
                  <span className="ml-2 text-sm text-orange-600 font-normal">
                    • Unsaved changes
                  </span>
                )}
              </h2>
              <div className="flex space-x-2">
                <button 
                  onClick={() => handleViewModeChange('preview')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    viewMode === 'preview' 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Preview
                </button>
                <button 
                  onClick={() => handleViewModeChange('code')}
                  className={`flex items-center px-3 py-1 text-sm rounded-md transition-colors ${
                    viewMode === 'code' 
                      ? 'bg-purple-100 text-purple-700' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Code
                  {hasUnsavedChanges && (
                    <div className="w-2 h-2 bg-orange-500 rounded-full ml-2" title="Unsaved changes" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Code/Preview Area - Keep both mounted to preserve state */}
          <div className="flex-1 overflow-hidden relative">
            {/* Preview Pane */}
            <div className={`absolute inset-0 ${viewMode === 'preview' ? 'block' : 'hidden'}`}>
              <PreviewPane 
                appId={appId} 
                port={app?.port}
                onRetry={() => {
                  // Optionally refresh app data when retrying
                  if (appId && app) {
                    appFetch(`http://localhost:4000/apps/${appId}`)
                      .then(res => res.json())
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

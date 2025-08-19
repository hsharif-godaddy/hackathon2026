'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  SparklesIcon,
  CodeBracketIcon,
  PlayIcon,
  ArrowPathIcon,
  Squares2X2Icon
} from '@heroicons/react/24/outline'
import ChatPane from '@/app/develop/components/ChatPane'
import PreviewPane from '@/app/develop/components/PreviewPane'
import CodeEditor from '@/app/develop/components/CodeEditor'
import { Message, PlanItem } from '@/app/develop/components/types'
import { 
  handleSendMessage as sendMessage, 
  cleanup as cleanupMessageService,
  loadConversations,
  loadConversation
} from '@/app/develop/components/messageService'

interface App {
  id: string
  name: string
  port: number
  createdAt: string
  updatedAt: string
}

export default function Develop() {
  const params = useParams()
  const router = useRouter()
  const appId = params.id as string
  const [app, setApp] = useState<App | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<any[]>([])
  const [isLoadingConversations, setIsLoadingConversations] = useState(true)
  const [developmentPlan] = useState<PlanItem[]>([])
  const [expandedPlan, setExpandedPlan] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [isRestarting, setIsRestarting] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const searchParams = useSearchParams()
  const initialMessageProcessed = useRef(false)

  // Fetch app details
  useEffect(() => {
    const fetchApp = async () => {
      try {
        const response = await fetch(`http://localhost:4000/apps/${appId}`)
        if (response.ok) {
          const data = await response.json()
          setApp(data.app)
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

  // Load conversations when app is loaded
  useEffect(() => {
    const loadAppConversations = async () => {
      if (!appId) return
      
      try {
        setIsLoadingConversations(true)
        const conversationList = await loadConversations(appId)
        setConversations(conversationList)
        
        // Load the most recent conversation if available
        if (conversationList.length > 0) {
          const mostRecent = conversationList[0] // They're ordered by updated_at DESC
          const conversationData = await loadConversation(appId, mostRecent.id)
          
          if (conversationData) {
            console.log('Loaded conversation:', mostRecent.id, 'with', conversationData.messages.length, 'messages')
            setMessages(conversationData.messages)
            setConversationId(mostRecent.id)
            
            // Clear URL message parameter since we loaded existing conversation
            if (searchParams.get('message')) {
              const url = new URL(window.location.href)
              url.searchParams.delete('message')
              router.replace(url.pathname + url.search, { scroll: false })
            }
          }
        }
      } catch (error) {
        console.error('Error loading conversations:', error)
      } finally {
        setIsLoadingConversations(false)
      }
    }

    if (appId) {
      loadAppConversations()
    }
  }, [appId])

  const handleSendMessage = useCallback(async (messageContent?: string) => {
    await sendMessage({
      messageContent,
      inputValue,
      isLoading,
      appId,
      conversationId,
      setMessages,
      setInputValue,
      setIsLoading,
      setConversationId
    })
  }, [inputValue, isLoading, appId, conversationId])

  // Cleanup SSE connections on unmount
  useEffect(() => {
    return () => {
      cleanupMessageService()
    }
  }, [])

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
    setIsSelectMode(!isSelectMode)
  }

  const handleToggleExpandedPlan = () => {
    setExpandedPlan(!expandedPlan)
  }

  const handleRestartServer = async () => {
    if (!appId) return
    
    setIsRestarting(true)
    try {
      const response = await fetch(`http://localhost:4000/apps/${appId}/restart`, {
        method: 'POST'
      })
      
      if (response.ok) {
        // Wait a moment for the server to restart
        setTimeout(() => {
          // Refresh app data
          fetch(`http://localhost:4000/apps/${appId}`)
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
                {conversationId && (
                  <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Chat: {conversationId.slice(0, 8)}...
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center space-x-4">
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
                    fetch(`http://localhost:4000/apps/${appId}`)
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

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  SparklesIcon,
  CodeBracketIcon,
  PlayIcon
} from '@heroicons/react/24/outline'
import ChatPane from '@/app/develop/components/ChatPane'
import PreviewPane from '@/app/develop/components/PreviewPane'
import { Message, PlanItem } from '@/app/develop/components/types'

interface App {
  id: string
  name: string
  port: number
  createdAt: string
  updatedAt: string
}

export default function Develop() {
  const params = useParams()
  const appId = params.id as string
  const [app, setApp] = useState<App | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [developmentPlan] = useState<PlanItem[]>([])
  const [expandedPlan, setExpandedPlan] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')

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

  const handleSendMessage = useCallback(async (messageContent?: string) => {
    const content = messageContent || inputValue.trim()
    if (!content || isLoading) return

    const userMessage: Message = {
      id: Date.now(),
      sender: 'user',
      content,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    // Create agent message outside try block so it's accessible in catch
    let agentMessageContent = ''
    const agentMessage: Message = {
      id: Date.now() + 1,
      sender: 'agent',
      content: '',
      timestamp: new Date(),
      isThinking: true
    }

    // Add thinking message that we'll update
    setMessages(prev => [...prev, agentMessage])

    // Throttling for smooth updates without overwhelming React
    let lastUpdateTime = 0
    const updateThrottleMs = 16 // ~60fps

    try {
      const response = await fetch('http://localhost:4000/agent/develop/chat-streaming', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          message: content,
          appId: appId // Include app ID in the request
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('Failed to get response reader')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        buffer += chunk

        // Split on double newlines to separate SSE events
        const events = buffer.split('\n\n')
        
        // Keep the last incomplete event in the buffer
        buffer = events.pop() || ''

        // TODO streaming rendering is not working as expected, need to fix it
        for (const event of events) {
          const lines = event.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.content) {
                  agentMessageContent += data.content
                  // Throttle updates to ~60fps for smooth streaming without overwhelming React
                  const now = Date.now()
                  const timeSinceLastUpdate = now - lastUpdateTime

                  if (timeSinceLastUpdate >= updateThrottleMs) {
                    lastUpdateTime = now                    // Update the agent message content and turn off thinking state
                    setMessages(prev => 
                      prev.map(msg => 
                        msg.id === agentMessage.id 
                          ? { ...msg, content: agentMessageContent, isThinking: false }
                          : msg
                      )
                    )
                  }
                }
              } catch (error) {
                console.warn('Failed to parse SSE data:', line, error)
              }
            }
          }
        }
      }
      
      // Ensure final update with complete content
      setMessages(prev => 
        prev.map(msg => 
          msg.id === agentMessage.id 
            ? { ...msg, content: agentMessageContent, isThinking: false }
            : msg
        )
      )
    } catch (error) {
      console.error('Error sending message:', error)
      // Turn off thinking state for the current message and show error
      setMessages(prev => 
        prev.map(msg => 
          msg.id === agentMessage.id 
            ? { 
                ...msg, 
                content: 'Sorry, I encountered an error. Please make sure the agents server is running on localhost:4000.',
                isThinking: false 
              }
            : msg
        )
      )
    } finally {
      setIsLoading(false)
    }
  }, [inputValue, isLoading, appId])

  // Handle initial message from URL parameter
  useEffect(() => {
    const message = searchParams.get('message')
    if (message && !initialMessageProcessed.current) {
      const decodedMessage = decodeURIComponent(message)
      setInputValue(decodedMessage)
      initialMessageProcessed.current = true
      // Auto-send the message
      setTimeout(() => {
        handleSendMessage(decodedMessage)
      }, 100)
    } else if (!message && !initialMessageProcessed.current) {
      setInputValue('')
      initialMessageProcessed.current = true
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

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
              </span>
            </div>
            <div className="flex items-center space-x-4">
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
              <h2 className="text-lg font-semibold text-gray-900">
                {viewMode === 'preview' ? 'App Preview' : 'Code Editor'}
              </h2>
              <div className="flex space-x-2">
                <button 
                  onClick={() => setViewMode('preview')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    viewMode === 'preview' 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Preview
                </button>
                <button 
                  onClick={() => setViewMode('code')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    viewMode === 'code' 
                      ? 'bg-purple-100 text-purple-700' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Code
                </button>
              </div>
            </div>
          </div>

          {/* Code/Preview Area */}
          <div className="flex-1 overflow-hidden">
            {viewMode === 'preview' ? (
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
            ) : (
              <div className="h-full p-4">
                <div className="h-full bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <CodeBracketIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium mb-2">Ready to Code</h3>
                    <p className="text-sm">Your AI developer will generate code here</p>
                    <p className="text-xs text-gray-400 mt-1">Start by describing your project in the chat</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

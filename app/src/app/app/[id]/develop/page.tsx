'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  SparklesIcon,
  CodeBracketIcon,
  PlusIcon,
  PlayIcon
} from '@heroicons/react/24/outline'

interface Message {
  id: number
  sender: 'user' | 'agent'
  content: string
  timestamp: Date
}

interface App {
  id: string
  name: string
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
  const [hasInitialMessageSent, setHasInitialMessageSent] = useState(false)
  const searchParams = useSearchParams()
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  // Scroll to bottom when messages change
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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

      let agentMessageContent = ''
      const agentMessage: Message = {
        id: Date.now() + 1,
        sender: 'agent',
        content: '',
        timestamp: new Date()
      }

      // Add empty agent message that we'll update
      setMessages(prev => [...prev, agentMessage])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.content) {
                agentMessageContent += data.content
                // Update the agent message content
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === agentMessage.id 
                      ? { ...msg, content: agentMessageContent }
                      : msg
                  )
                )
              }
            } catch (error) {
              console.warn('Failed to parse SSE data:', line, error)
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        id: Date.now() + 2,
        sender: 'agent',
        content: 'Sorry, I encountered an error. Please make sure the agents server is running on localhost:4000.',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }, [inputValue, isLoading, appId])

  // Handle initial message from URL parameter
  useEffect(() => {
    const message = searchParams.get('message')
    if (message && !hasInitialMessageSent) {
      const decodedMessage = decodeURIComponent(message)
      setInputValue(decodedMessage)
      // Auto-send the message
      setTimeout(() => {
        handleSendMessage(decodedMessage)
        setHasInitialMessageSent(true)
      }, 100)
    } else if (!message) {
      setInputValue('')
    }
  }, [searchParams, hasInitialMessageSent, handleSendMessage])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault()
      handleSendMessage()
    }
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
              <button className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white text-sm font-medium rounded-lg hover:shadow-lg transition-all duration-200">
                <PlayIcon className="w-4 h-4 mr-2" />
                Run
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0">
        {/* Chat Panel */}
        <div className="w-1/3 border-r border-gray-200 bg-white flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <CodeBracketIcon className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold text-gray-900">AI Developer</h2>
            </div>
            <p className="text-sm text-gray-500 mt-1">Ready to help you build {app?.name || 'your app'}</p>
          </div>

          {/* Messages Area */}
          <div className="flex-1 p-4 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <CodeBracketIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p className="text-sm">Start a conversation with your AI developer</p>
                <p className="text-xs text-gray-400 mt-1">Describe what you&apos;d like to build</p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] p-3 rounded-lg ${
                        message.sender === 'user'
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                      <div
                        className={`text-xs mt-1 ${
                          message.sender === 'user' ? 'text-purple-200' : 'text-gray-500'
                        }`}
                      >
                        {message.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-900 p-3 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        <span className="text-sm text-gray-500 ml-2">AI Developer is thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex space-x-2">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Describe what you want to build..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                rows={2}
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim() || isLoading}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <PlusIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Code/Preview Panel */}
        <div className="flex-1 bg-white flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Code Editor</h2>
              <div className="flex space-x-2">
                <button className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors">
                  Preview
                </button>
                <button className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 transition-colors">
                  Code
                </button>
              </div>
            </div>
          </div>

          {/* Code/Preview Area */}
          <div className="flex-1 p-4 overflow-auto">
            <div className="h-full bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
              <div className="text-center text-gray-500">
                <CodeBracketIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium mb-2">Ready to Code</h3>
                <p className="text-sm">Your AI developer will generate code here</p>
                <p className="text-xs text-gray-400 mt-1">Start by describing your project in the chat</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

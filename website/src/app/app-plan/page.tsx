'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  SparklesIcon,
  PaperAirplaneIcon,
  ArrowLeftIcon,
  DocumentTextIcon,
  UserGroupIcon,
  CogIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline'

interface AppDetails {
  name: string
  type: string
  description: string
  targetAudience: string
  keyFeatures: string[]
  contentTypes: string[]
  userRoles: string[]
  integrations: string[]
}

interface Message {
  id: number
  sender: 'user' | 'agent'
  content: string
  timestamp: Date
}

export default function AppPlan() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      sender: 'agent',
      content: "Hello! I'm ProdBot-PM, your Product Manager agent. I'm here to help you plan your application in detail. Let's start by understanding what you want to build. Can you tell me about your app idea?",
      timestamp: new Date()
    }
  ])

  const [inputValue, setInputValue] = useState('')
  const [appDetails, setAppDetails] = useState<AppDetails>({
    name: '',
    type: '',
    description: '',
    targetAudience: '',
    keyFeatures: [],
    contentTypes: [],
    userRoles: [],
    integrations: []
  })

  const handleSendMessage = () => {
    if (!inputValue.trim()) return

    const userMessage: Message = {
      id: messages.length + 1,
      sender: 'user',
      content: inputValue,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])

    // Simulate AI response and update app details
    setTimeout(() => {
      const agentResponse = generateAgentResponse(inputValue, messages.length)
      setMessages(prev => [...prev, agentResponse])
      updateAppDetails(inputValue)
    }, 1000)

    setInputValue('')
  }

  const generateAgentResponse = (userInput: string, messageCount: number): Message => {
    const responses = [
      "Great! I can see you want to build a content management system. Let me ask a few more questions to understand your requirements better. Who is your target audience for this CMS?",
      "Perfect! Understanding your audience helps me tailor the features. What are the main content types you'll be managing? (e.g., blog posts, pages, products, media)",
      "Excellent! Now, what user roles do you envision? For example, do you need admins, editors, contributors, or other specific roles?",
      "That's very helpful! Are there any specific integrations you need? Think about payment systems, email marketing, analytics, or social media platforms.",
      "Wonderful! I have a good understanding of your requirements now. Let me summarize what we've discussed and we can proceed with building your CMS."
    ]

    return {
      id: messageCount + 2,
      sender: 'agent',
      content: responses[Math.min(Math.floor(messageCount / 2), responses.length - 1)],
      timestamp: new Date()
    }
  }

  const updateAppDetails = (userInput: string) => {
    // Simple keyword-based extraction (in real app, this would be more sophisticated)
    const input = userInput.toLowerCase()
    
    setAppDetails(prev => {
      const updated = { ...prev }
      
      if (!updated.type && (input.includes('cms') || input.includes('content management'))) {
        updated.type = 'Content Management System'
        updated.name = 'My CMS App'
      }
      
      if (!updated.description && input.length > 20) {
        updated.description = userInput
      }
      
      if (input.includes('blog') && !updated.contentTypes.includes('Blog Posts')) {
        updated.contentTypes.push('Blog Posts')
      }
      if (input.includes('page') && !updated.contentTypes.includes('Pages')) {
        updated.contentTypes.push('Pages')
      }
      if (input.includes('media') && !updated.contentTypes.includes('Media Files')) {
        updated.contentTypes.push('Media Files')
      }
      
      if (input.includes('admin') && !updated.userRoles.includes('Administrator')) {
        updated.userRoles.push('Administrator')
      }
      if (input.includes('editor') && !updated.userRoles.includes('Editor')) {
        updated.userRoles.push('Editor')
      }
      if (input.includes('author') && !updated.userRoles.includes('Author')) {
        updated.userRoles.push('Author')
      }
      
      if (input.includes('business') || input.includes('company')) {
        updated.targetAudience = 'Business Users'
      } else if (input.includes('developer')) {
        updated.targetAudience = 'Developers'
      } else if (input.includes('content creator')) {
        updated.targetAudience = 'Content Creators'
      }
      
      return updated
    })
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
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
              <span className="text-gray-600">App Planning</span>
            </div>
            <Link
              href="/"
              className="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back to Home
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-3 gap-8 h-[calc(100vh-200px)]">
          {/* Left Side - Conversation */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 flex flex-col">
            <div className="border-b border-gray-200 p-6">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Plan Your Application</h1>
              <p className="text-gray-600">
                Let's work together to define your app requirements and create a detailed plan.
              </p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-3xl ${message.sender === 'user' ? 'order-2' : 'order-1'}`}>
                    <div className={`flex items-start space-x-3 ${message.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        message.sender === 'user' 
                          ? 'bg-purple-600' 
                          : 'bg-gradient-to-r from-purple-100 to-blue-100'
                      }`}>
                        {message.sender === 'user' ? (
                          <span className="text-white text-sm font-medium">U</span>
                        ) : (
                          <SparklesIcon className="w-4 h-4 text-purple-600" />
                        )}
                      </div>
                      <div className={`flex-1 ${message.sender === 'user' ? 'text-right' : ''}`}>
                        <div className={`inline-block p-4 rounded-lg ${
                          message.sender === 'user'
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}>
                          <p className="text-sm leading-relaxed">{message.content}</p>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {message.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 p-6">
              <div className="flex space-x-4">
                <div className="flex-1">
                  <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Describe your app idea, features, or answer the agent's questions..."
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                  />
                </div>
                <button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim()}
                  className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed self-end"
                >
                  <PaperAirplaneIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Right Side - App Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-gray-200 h-full">
              <div className="border-b border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <DocumentTextIcon className="w-5 h-5 mr-2 text-purple-600" />
                  App Summary
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  We'll update this as we learn more about your app.
                </p>
              </div>

              <div className="p-6 space-y-6">
                {/* App Basics */}
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                    <GlobeAltIcon className="w-4 h-4 mr-2" />
                    App Basics
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Name:</span>
                      <span className="text-sm font-medium text-gray-900">
                        {appDetails.name || 'Not specified'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Type:</span>
                      <span className="text-sm font-medium text-gray-900">
                        {appDetails.type || 'Not specified'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Audience:</span>
                      <span className="text-sm font-medium text-gray-900">
                        {appDetails.targetAudience || 'Not specified'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Content Types */}
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                    <DocumentTextIcon className="w-4 h-4 mr-2" />
                    Content Types
                  </h3>
                  <div className="space-y-2">
                    {appDetails.contentTypes.length > 0 ? (
                      appDetails.contentTypes.map((type, index) => (
                        <div key={index} className="flex items-center">
                          <div className="w-2 h-2 bg-purple-400 rounded-full mr-2" />
                          <span className="text-sm text-gray-700">{type}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">None specified yet</p>
                    )}
                  </div>
                </div>

                {/* User Roles */}
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                    <UserGroupIcon className="w-4 h-4 mr-2" />
                    User Roles
                  </h3>
                  <div className="space-y-2">
                    {appDetails.userRoles.length > 0 ? (
                      appDetails.userRoles.map((role, index) => (
                        <div key={index} className="flex items-center">
                          <div className="w-2 h-2 bg-blue-400 rounded-full mr-2" />
                          <span className="text-sm text-gray-700">{role}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">None specified yet</p>
                    )}
                  </div>
                </div>

                {/* Features */}
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                    <CogIcon className="w-4 h-4 mr-2" />
                    Key Features
                  </h3>
                  <div className="space-y-2">
                    {appDetails.keyFeatures.length > 0 ? (
                      appDetails.keyFeatures.map((feature, index) => (
                        <div key={index} className="flex items-center">
                          <div className="w-2 h-2 bg-green-400 rounded-full mr-2" />
                          <span className="text-sm text-gray-700">{feature}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">None specified yet</p>
                    )}
                  </div>
                </div>

                {/* Description */}
                {appDetails.description && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 mb-3">Description</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {appDetails.description}
                    </p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="border-t border-gray-200 p-6">
                <div className="space-y-3">
                  <button className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium rounded-lg hover:shadow-lg transition-all duration-200">
                    Continue to Build
                  </button>
                  <button className="w-full px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                    Save Draft
                  </button>
                  <button className="w-full px-4 py-2 text-purple-600 text-sm font-medium hover:bg-purple-50 rounded-lg transition-colors">
                    Start Over
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, SparklesIcon, UserIcon, BotIcon } from '@heroicons/react/24/outline'

interface Message {
  id: number
  sender: 'user' | 'agent'
  content: string
  timestamp: Date
}

export default function Builder() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      sender: 'agent',
      content: "Hi! I'm ProdBot-PM, your Product Manager agent. I'm here to help you define the perfect application for your needs. What type of application are you looking to build?",
      timestamp: new Date()
    }
  ])
  const [inputValue, setInputValue] = useState('')
  const [projectDetails, setProjectDetails] = useState({
    type: '',
    industry: '',
    users: '',
    features: [] as string[]
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

    // Simulate agent response
    setTimeout(() => {
      const agentResponse = getAgentResponse(inputValue, messages.length + 2)
      setMessages(prev => [...prev, agentResponse])
    }, 1000)

    setInputValue('')
  }

  const getAgentResponse = (userInput: string, messageId: number): Message => {
    const responses = [
      "That sounds interesting! Can you tell me more about your target audience? Who will be using this application?",
      "Great! What's the main problem you're trying to solve for your users?",
      "Perfect! What are the key features you think your users will need most?",
      "Excellent! Based on what you've told me, I'm starting to see a clear picture. Let me bring in our Software Architect to design the technical foundation.",
      "Our team is analyzing your requirements. The Data Architect is designing the database schema, and our Lead Developer is preparing to start coding!"
    ]
    
    return {
      id: messageId,
      sender: 'agent',
      content: responses[Math.min(messages.length, responses.length - 1)],
      timestamp: new Date()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link 
                href="/" 
                className="flex items-center text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeftIcon className="w-5 h-5 mr-2" />
                Back to Home
              </Link>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                <SparklesIcon className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                Airo Builder
              </span>
            </div>
            <div className="w-24"></div> {/* Spacer for balance */}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-4 gap-8">
          {/* Agent Info Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-6 sticky top-8">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <BotIcon className="w-8 h-8 text-purple-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">ProdBot-PM</h3>
                <p className="text-sm text-purple-600 font-medium">Product Manager Agent</p>
              </div>
              
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Specializes In:</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Requirements gathering</li>
                    <li>• User story creation</li>
                    <li>• Feature prioritization</li>
                    <li>• Market research</li>
                  </ul>
                </div>
                
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Next Steps:</h4>
                  <div className="text-sm text-gray-600 space-y-2">
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                      Define requirements
                    </div>
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-gray-300 rounded-full mr-2"></div>
                      Design architecture
                    </div>
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-gray-300 rounded-full mr-2"></div>
                      Build application
                    </div>
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-gray-300 rounded-full mr-2"></div>
                      Deploy to production
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Chat Interface */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-xl border border-gray-200 h-[600px] flex flex-col">
              {/* Chat Header */}
              <div className="border-b border-gray-200 p-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Building Your Application
                </h2>
                <p className="text-sm text-gray-600">
                  Let's gather requirements for your project
                </p>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="flex items-start space-x-3 max-w-xs lg:max-w-md">
                      {message.sender === 'agent' && (
                        <div className="w-8 h-8 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <BotIcon className="w-5 h-5 text-purple-600" />
                        </div>
                      )}
                      <div
                        className={`rounded-lg p-3 ${
                          message.sender === 'user'
                            ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
                        <p className="text-sm">{message.content}</p>
                        <p className={`text-xs mt-1 ${
                          message.sender === 'user' ? 'text-purple-100' : 'text-gray-500'
                        }`}>
                          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {message.sender === 'user' && (
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                          <UserIcon className="w-5 h-5 text-gray-600" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Message Input */}
              <div className="border-t border-gray-200 p-4">
                <div className="flex space-x-3">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Describe your application idea..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                  />
                  <button
                    onClick={handleSendMessage}
                    className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-2 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
              <button 
                onClick={() => setInputValue("I want to build an e-commerce store")}
                className="p-3 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all text-sm text-gray-700"
              >
                E-commerce Store
              </button>
              <button 
                onClick={() => setInputValue("I need a customer support chatbot")}
                className="p-3 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all text-sm text-gray-700"
              >
                Support Chatbot
              </button>
              <button 
                onClick={() => setInputValue("I want to create a SaaS dashboard")}
                className="p-3 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all text-sm text-gray-700"
              >
                SaaS Dashboard
              </button>
              <button 
                onClick={() => setInputValue("I need a content management system")}
                className="p-3 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all text-sm text-gray-700"
              >
                CMS Platform
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

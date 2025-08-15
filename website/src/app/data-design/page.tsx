'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  SparklesIcon,
  PaperAirplaneIcon,
  ArrowLeftIcon,
  CircleStackIcon,
  UserGroupIcon,
  CalendarDaysIcon,
  CreditCardIcon,
  DocumentTextIcon,
  ChartBarIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline'

interface Message {
  id: number
  sender: 'user' | 'agent'
  content: string
  timestamp: Date
}

interface DataCategory {
  id: string
  title: string
  icon: any
  description: string
  items: string[]
  importance: 'critical' | 'important' | 'helpful'
}

export default function DataDesign() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      sender: 'agent',
      content: "Hello! I'm DataBot-DB, your Data Architect. CodeBot-DEV has asked me to help design what information we need to collect for FitStudio Pro. I'll explain this in simple business terms - no technical jargon!",
      timestamp: new Date(Date.now() - 300000)
    },
    {
      id: 2,
      sender: 'agent',
      content: "Think of data as the information that makes your fitness studio run smoothly. Just like you need to know who's coming to class and when, your website needs to organize and remember important details about your members and business.",
      timestamp: new Date(Date.now() - 240000)
    },
    {
      id: 3,
      sender: 'agent',
      content: "I've identified the key types of information we need to collect. Each category serves a specific purpose for your business operations, from member management to class scheduling to payment processing.",
      timestamp: new Date(Date.now() - 180000)
    },
    {
      id: 4,
      sender: 'agent',
      content: "The great news is that we'll make data collection feel natural for your members. They won't feel like they're filling out complicated forms - it will be part of their normal experience joining and using your studio.",
      timestamp: new Date(Date.now() - 120000)
    },
    {
      id: 5,
      sender: 'agent',
      content: "Let's review each category. I'll explain why we need this information and how it helps your business. You can ask me questions about any of these - I want you to feel completely comfortable with what we're collecting!",
      timestamp: new Date(Date.now() - 60000)
    }
  ])

  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const dataCategories: DataCategory[] = [
    {
      id: 'members',
      title: 'Member Information',
      icon: UserGroupIcon,
      description: 'Basic details about your members to personalize their experience',
      importance: 'critical',
      items: [
        'Name and contact information',
        'Emergency contact details',
        'Fitness goals and preferences',
        'Health considerations or limitations',
        'Membership plan and status',
        'Profile photo (optional)'
      ]
    },
    {
      id: 'classes',
      title: 'Class & Schedule Data',
      icon: CalendarDaysIcon,
      description: 'Information about your classes, schedules, and bookings',
      importance: 'critical',
      items: [
        'Class types and descriptions',
        'Class schedules and capacity',
        'Instructor assignments',
        'Member bookings and waitlists',
        'Attendance tracking',
        'Popular class analytics'
      ]
    },
    {
      id: 'payments',
      title: 'Billing & Payments',
      icon: CreditCardIcon,
      description: 'Secure payment processing and membership billing',
      importance: 'critical',
      items: [
        'Membership pricing and plans',
        'Payment method details (encrypted)',
        'Billing history and invoices',
        'Payment status and renewals',
        'Refund and credit tracking',
        'Financial reporting data'
      ]
    },
    {
      id: 'content',
      title: 'Website Content',
      icon: DocumentTextIcon,
      description: 'All the content that makes your website informative and engaging',
      importance: 'important',
      items: [
        'Blog posts and fitness tips',
        'Trainer profiles and bios',
        'Success stories and testimonials',
        'Class descriptions and photos',
        'Studio information and policies',
        'FAQ and help content'
      ]
    },
    {
      id: 'progress',
      title: 'Member Progress',
      icon: ChartBarIcon,
      description: 'Tracking member fitness journeys and achievements',
      importance: 'important',
      items: [
        'Workout completion tracking',
        'Personal fitness milestones',
        'Progress photos (optional)',
        'Body measurements (optional)',
        'Goal setting and achievements',
        'Workout preferences and history'
      ]
    },
    {
      id: 'security',
      title: 'Security & Privacy',
      icon: ShieldCheckIcon,
      description: 'Protecting member data and ensuring secure access',
      importance: 'critical',
      items: [
        'Login credentials (encrypted)',
        'Account security settings',
        'Privacy preferences',
        'Data access permissions',
        'Activity logs for security',
        'GDPR compliance records'
      ]
    }
  ]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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
      const agentResponse: Message = {
        id: messages.length + 2,
        sender: 'agent',
        content: "Great question! I'll explain that in detail. Data collection is all about making your business run more efficiently while giving your members a better experience. Let me break that down for you...",
        timestamp: new Date()
      }
      setMessages(prev => [...prev, agentResponse])
    }, 1000)

    setInputValue('')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const getImportanceColor = (importance: string) => {
    switch (importance) {
      case 'critical': return 'border-red-200 bg-red-50'
      case 'important': return 'border-yellow-200 bg-yellow-50'
      case 'helpful': return 'border-blue-200 bg-blue-50'
      default: return 'border-gray-200 bg-gray-50'
    }
  }

  const getImportanceBadge = (importance: string) => {
    switch (importance) {
      case 'critical': return 'bg-red-100 text-red-800'
      case 'important': return 'bg-yellow-100 text-yellow-800'
      case 'helpful': return 'bg-blue-100 text-blue-800'
      default: return 'bg-gray-100 text-gray-800'
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
              <span className="text-gray-600">Data Architecture Design</span>
            </div>
            <Link
              href="/develop"
              className="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back to Development
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0">
        {/* Left Side - Chat */}
        <div className="w-96 bg-white border-r border-gray-200 flex flex-col min-h-0">
          {/* Chat Header */}
          <div className="border-b border-gray-200 p-6 bg-white">
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-lg flex items-center justify-center mr-3">
                <CircleStackIcon className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">DataBot-DB</h2>
                <p className="text-sm text-indigo-600">Data Architect Agent</p>
              </div>
            </div>
          </div>

          {/* Scrollable Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-sm ${message.sender === 'user' ? 'order-2' : 'order-1'}`}>
                  <div className={`flex items-start space-x-3 ${message.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      message.sender === 'user' 
                        ? 'bg-purple-600' 
                        : 'bg-gradient-to-r from-indigo-100 to-purple-100'
                    }`}>
                      {message.sender === 'user' ? (
                        <span className="text-white text-sm font-medium">U</span>
                      ) : (
                        <SparklesIcon className="w-4 h-4 text-indigo-600" />
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
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <div className="border-t border-gray-200 p-4 bg-white">
            <div className="flex space-x-3">
              <div className="flex-1">
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask DataBot-DB about data collection, privacy, or business benefits..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none text-sm"
                />
              </div>
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim()}
                className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed self-end"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Side - Data Categories */}
        <div className="flex-1 bg-white flex flex-col min-h-0">
          {/* Header */}
          <div className="border-b border-gray-200 p-6 bg-white">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Data Architecture Overview</h2>
            <p className="text-gray-600">
              Here's what information we need to collect for FitStudio Pro, explained in simple business terms.
            </p>
          </div>

          {/* Scrollable Data Categories */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {dataCategories.map((category) => (
              <div
                key={category.id}
                className={`border rounded-lg p-6 ${getImportanceColor(category.importance)}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center mr-4 shadow-sm">
                      <category.icon className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{category.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{category.description}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getImportanceBadge(category.importance)}`}>
                    {category.importance}
                  </span>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">What we'll collect:</h4>
                  <div className="grid grid-cols-1 gap-2">
                    {category.items.map((item, index) => (
                      <div key={index} className="flex items-center text-sm text-gray-700">
                        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full mr-3" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-blue-900 mb-2">Privacy & Security Promise</h3>
              <p className="text-sm text-blue-800 leading-relaxed">
                All member data will be encrypted and stored securely. We only collect information that directly benefits 
                your business operations or improves the member experience. Members can control their privacy settings 
                and request data deletion at any time. We're fully compliant with privacy regulations like GDPR.
              </p>
            </div>
          </div>

          {/* Fixed Bottom Actions */}
          <div className="border-t border-gray-200 p-6 bg-white">
            <div className="flex gap-4">
              <Link
                href="/develop"
                className="flex-1 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-lg hover:shadow-lg transition-all duration-200 text-center"
              >
                Approve Data Design
              </Link>
              <button className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors">
                Request Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

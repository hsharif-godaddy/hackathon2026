'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  SparklesIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline'

import ChatPane from './components/ChatPane'
import ContentPane from './components/ContentPane'
import ElementEditor from './components/ElementEditor'

interface Message {
  id: number
  sender: 'user' | 'agent'
  content: string
  timestamp: Date
  handoff?: {
    to: string
    action: string
    url: string
  }
}

interface PlanItem {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'complete'
  tasks: string[]
  estimatedTime: string
}

interface ElementStyles {
  fontSize: string
  fontWeight: string
  color: string
  marginBottom: string
  padding: string
}

export default function Develop() {
  const [messages] = useState<Message[]>([
    {
      id: 1,
      sender: 'agent',
      content: "Hello! I'm CodeBot-DEV, your Lead Developer. I've received the architecture from ArchBot-SYS and I'm ready to start building FitStudio Pro. Let me begin by setting up the project structure and implementing the core features.",
      timestamp: new Date(Date.now() - 300000)
    },
    {
      id: 2,
      sender: 'agent',
      content: "I'm starting with the Payload CMS setup and Next.js configuration. This will give us the foundation for both the public website and member portal. The content management system will be the backbone for easy updates.",
      timestamp: new Date(Date.now() - 240000)
    },
    {
      id: 3,
      sender: 'agent',
      content: "Setting up the database schema with Prisma for member management, class scheduling, and booking system. I'm implementing proper relationships between users, classes, and bookings to ensure data integrity.",
      timestamp: new Date(Date.now() - 180000)
    },
    {
      id: 4,
      sender: 'agent',
      content: "Now implementing the authentication system with NextAuth.js. This will handle secure login for members, trainers, and administrators with proper role-based access control.",
      timestamp: new Date(Date.now() - 120000)
    },
    {
      id: 5,
      sender: 'agent',
      content: "Working on the member portal dashboard. This includes the booking interface, progress tracking, and workout plan access. The UI is being designed to be intuitive for non-technical fitness enthusiasts.",
      timestamp: new Date(Date.now() - 60000)
    },
    {
      id: 6,
      sender: 'agent',
      content: "I need to collaborate with DataBot-DB on the data architecture before proceeding with the database implementation. Let me hand this off to get the data collection strategy finalized.",
      timestamp: new Date(Date.now() - 30000),
      handoff: {
        to: 'DataBot-DB',
        action: 'Review Data Architecture',
        url: '/data-design'
      }
    }
  ])

  const [developmentPlan] = useState<PlanItem[]>([
    {
      id: 'setup',
      title: 'Project Setup & Configuration',
      description: 'Initialize Next.js project with Payload CMS and core dependencies',
      status: 'complete',
      tasks: ['Next.js 14 setup', 'Payload CMS integration', 'TypeScript configuration', 'Tailwind CSS setup'],
      estimatedTime: '2 hours'
    },
    {
      id: 'database',
      title: 'Database Schema & Models',
      description: 'Design and implement database structure for all entities',
      status: 'complete',
      tasks: ['User management schema', 'Class scheduling tables', 'Booking system design', 'Content management models'],
      estimatedTime: '3 hours'
    },
    {
      id: 'auth',
      title: 'Authentication System',
      description: 'Implement secure authentication with role-based access',
      status: 'in_progress',
      tasks: ['NextAuth.js setup', 'Role-based permissions', 'Session management', 'Password security'],
      estimatedTime: '2.5 hours'
    },
    {
      id: 'member_portal',
      title: 'Member Portal Development',
      description: 'Build the member dashboard and core functionality',
      status: 'pending',
      tasks: ['Dashboard interface', 'Class booking system', 'Progress tracking', 'Workout plan access'],
      estimatedTime: '4 hours'
    },
    {
      id: 'public_site',
      title: 'Public Website',
      description: 'Create marketing site with class schedules and information',
      status: 'pending',
      tasks: ['Homepage design', 'Services pages', 'Class schedule display', 'Contact forms'],
      estimatedTime: '3 hours'
    },
    {
      id: 'admin_cms',
      title: 'Admin Content Management',
      description: 'Setup CMS for content updates and member management',
      status: 'pending',
      tasks: ['Content editing interface', 'Member management', 'Class administration', 'Blog management'],
      estimatedTime: '2 hours'
    }
  ])

  const [inputValue, setInputValue] = useState('')
  const [expandedPlan, setExpandedPlan] = useState(false)
  const [activeContentTab, setActiveContentTab] = useState('preview')
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [elementStyles, setElementStyles] = useState<ElementStyles>({
    fontSize: 'text-xl',
    fontWeight: 'font-bold',
    color: 'text-gray-900',
    marginBottom: 'mb-1',
    padding: ''
  })

  const handleSendMessage = () => {
    if (!inputValue.trim()) return
    setInputValue('')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleToggleSelectMode = () => {
    setIsSelectMode(!isSelectMode)
    setSelectedElement(null)
    setShowEditDialog(false)
  }

  const handleElementSelect = (elementId: string) => {
    if (isSelectMode) {
      setSelectedElement(elementId)
      setShowEditDialog(true)
    }
  }

  const handleCloseEditor = () => {
    setShowEditDialog(false)
    setSelectedElement(null)
    setIsSelectMode(false)
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
              <span className="text-gray-600">Developing FitStudio Pro</span>
            </div>
            <Link
              href="/build"
              className="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back to Architecture
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0">
        <ChatPane
          messages={messages}
          developmentPlan={developmentPlan}
          inputValue={inputValue}
          expandedPlan={expandedPlan}
          isSelectMode={isSelectMode}
          onInputChange={setInputValue}
          onSendMessage={handleSendMessage}
          onKeyPress={handleKeyPress}
          onToggleSelectMode={handleToggleSelectMode}
          onToggleExpandedPlan={() => setExpandedPlan(!expandedPlan)}
        />

        <ContentPane
          activeContentTab={activeContentTab}
          elementStyles={elementStyles}
          isSelectMode={isSelectMode}
          selectedElement={selectedElement}
          onTabChange={setActiveContentTab}
          onElementSelect={handleElementSelect}
        />
      </div>

      <ElementEditor
        isOpen={showEditDialog}
        onClose={handleCloseEditor}
        elementStyles={elementStyles}
        onStyleChange={setElementStyles}
      />
    </div>
  )
}
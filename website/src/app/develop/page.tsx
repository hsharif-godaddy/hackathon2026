'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
    SparklesIcon,
    PaperAirplaneIcon,
    ArrowLeftIcon,
    DocumentTextIcon,
    CodeBracketIcon,
    EyeIcon,
    CogIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    CheckCircleIcon,
    ClockIcon,
    PlayIcon
} from '@heroicons/react/24/outline'

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

interface ContentTab {
    id: string
    title: string
    icon: any
    type: 'preview' | 'code' | 'artifact' | 'spec'
}

export default function Develop() {
    const [messages, setMessages] = useState<Message[]>([
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

    const [inputValue, setInputValue] = useState('')
    const [expandedPlan, setExpandedPlan] = useState(false)
    const [activeContentTab, setActiveContentTab] = useState('preview')
    const messagesEndRef = useRef<HTMLDivElement>(null)

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

    const contentTabs: ContentTab[] = [
        { id: 'preview', title: 'Live Preview', icon: EyeIcon, type: 'preview' },
        { id: 'code', title: 'Current Code', icon: CodeBracketIcon, type: 'code' },
        { id: 'artifacts', title: 'Artifacts', icon: DocumentTextIcon, type: 'artifact' },
        { id: 'specs', title: 'Specifications', icon: CogIcon, type: 'spec' }
    ]

    const getCurrentActiveItem = () => {
        return developmentPlan.find(item => item.status === 'in_progress') || developmentPlan[0]
    }

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
                content: "I understand your request. Let me implement that change and update the code accordingly. This will take a few moments to process and test.",
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

    const renderContentPane = () => {
        switch (activeContentTab) {
            case 'preview':
                return (
                    <div className="h-full bg-gradient-to-br from-purple-50 to-blue-50 overflow-auto">
                        <div className="min-h-full flex items-center justify-center p-6">
                            <div className="w-full max-w-md">
                                {/* Login Card */}
                                <div className="bg-white rounded-xl shadow-lg p-6">
                                    {/* Header */}
                                    <div className="text-center mb-6">
                                        <div className="w-12 h-12 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3">
                                            <span className="text-lg font-bold text-white">FS</span>
                                        </div>
                                        <h1 className="text-xl font-bold text-gray-900 mb-1">Welcome to FitStudio Pro</h1>
                                        <p className="text-sm text-gray-600">Sign in to access your member portal</p>
                                    </div>

                                    {/* Login Form */}
                                    <form className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Email Address
                                            </label>
                                            <input
                                                type="email"
                                                placeholder="john@example.com"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors text-sm"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Password
                                            </label>
                                            <input
                                                type="password"
                                                placeholder="Enter your password"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors text-sm"
                                            />
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <label className="flex items-center">
                                                <input type="checkbox" className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500" />
                                                <span className="ml-2 text-sm text-gray-600">Remember me</span>
                                            </label>
                                            <button type="button" className="text-sm text-purple-600 hover:text-purple-700 font-medium">
                                                Forgot password?
                                            </button>
                                        </div>

                                        <button
                                            type="submit"
                                            className="w-full py-2.5 px-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg transition-all duration-200 text-sm"
                                        >
                                            Sign In to Portal
                                        </button>
                                    </form>

                                    {/* Footer */}
                                    <div className="mt-6 text-center">
                                        <p className="text-sm text-gray-600">
                                            New member?{' '}
                                            <button className="text-purple-600 hover:text-purple-700 font-medium">
                                                Join FitStudio Pro
                                            </button>
                                        </p>
                                    </div>

                                    {/* Quick Links */}
                                    <div className="mt-4 pt-4 border-t border-gray-200">
                                        <div className="flex justify-center space-x-4">
                                            <button className="text-xs text-gray-500 hover:text-gray-700">Class Schedule</button>
                                            <button className="text-xs text-gray-500 hover:text-gray-700">Membership Info</button>
                                            <button className="text-xs text-gray-500 hover:text-gray-700">Contact Us</button>
                                        </div>
                                    </div>
                                </div>

                                {/* Preview Label */}
                                <div className="mt-4 text-center">
                                    <div className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                                        <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                                        Live Preview - Login Page
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            case 'code':
                return (
                    <div className="h-full bg-gray-900 text-gray-100 p-6 overflow-auto">
                        <div className="mb-4">
                            <h3 className="text-lg font-medium text-white mb-2">src/app/portal/dashboard/page.tsx</h3>
                            <div className="text-sm text-gray-400">Currently being developed...</div>
                        </div>
                        <pre className="text-sm">
                            <code>{`import { NextAuthProvider } from '@/components/auth/NextAuthProvider'
import { MemberDashboard } from '@/components/portal/MemberDashboard'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const session = await getServerSession()
  
  if (!session) {
    redirect('/login')
  }

  return (
    <NextAuthProvider session={session}>
      <div className="min-h-screen bg-gray-50">
        <MemberDashboard user={session.user} />
      </div>
    </NextAuthProvider>
  )
}`}</code>
                        </pre>
                    </div>
                )
            case 'artifacts':
                return (
                    <div className="p-6 overflow-auto">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Project Artifacts</h3>
                        <div className="space-y-4">
                            <div className="border border-gray-200 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 mb-2">Site Architecture</h4>
                                <p className="text-sm text-gray-600">Complete site map and navigation structure</p>
                            </div>
                            <div className="border border-gray-200 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 mb-2">Tech Stack Plan</h4>
                                <p className="text-sm text-gray-600">Technical architecture and technology decisions</p>
                            </div>
                            <div className="border border-gray-200 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 mb-2">Database Schema</h4>
                                <p className="text-sm text-gray-600">Complete database design and relationships</p>
                            </div>
                        </div>
                    </div>
                )
            case 'specs':
                return (
                    <div className="p-6 overflow-auto">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Technical Specifications</h3>
                        <div className="prose max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {`## Authentication Requirements

### User Roles
- **Members**: Access to portal, booking, progress tracking
- **Trainers**: Class management, member interaction
- **Admins**: Full system access, content management

### Security Features
- JWT-based session management
- Role-based route protection
- Secure password hashing with bcrypt
- CSRF protection on all forms

## Database Schema

### Users Table
- id (UUID, Primary Key)
- email (Unique)
- password_hash
- role (enum: member, trainer, admin)
- profile_data (JSON)
- created_at, updated_at

### Classes Table
- id (UUID, Primary Key)
- name, description
- instructor_id (Foreign Key to Users)
- schedule (JSON for recurring times)
- capacity (Integer)
- created_at, updated_at`}
                            </ReactMarkdown>
                        </div>
                    </div>
                )
            default:
                return null
        }
    }

    const activeItem = getCurrentActiveItem()

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
                {/* Left Side - Chat with Plan Tracker */}
                <div className="w-96 bg-white border-r border-gray-200 flex flex-col min-h-0">
                    {/* Chat Header */}
                    <div className="border-b border-gray-200 p-6 bg-white">
                        <div className="flex items-center mb-4">
                            <div className="w-10 h-10 bg-gradient-to-r from-green-100 to-emerald-100 rounded-lg flex items-center justify-center mr-3">
                                <CodeBracketIcon className="w-6 h-6 text-green-600" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">CodeBot-DEV</h2>
                                <p className="text-sm text-green-600">Lead Developer Agent</p>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable Messages */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {messages.map((message) => (
                            <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-sm ${message.sender === 'user' ? 'order-2' : 'order-1'}`}>
                                    <div className={`flex items-start space-x-3 ${message.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${message.sender === 'user'
                                                ? 'bg-purple-600'
                                                : 'bg-gradient-to-r from-green-100 to-emerald-100'
                                            }`}>
                                            {message.sender === 'user' ? (
                                                <span className="text-white text-sm font-medium">U</span>
                                            ) : (
                                                <SparklesIcon className="w-4 h-4 text-green-600" />
                                            )}
                                        </div>
                                        <div className={`flex-1 ${message.sender === 'user' ? 'text-right' : ''}`}>
                                            <div className={`inline-block p-4 rounded-lg ${message.sender === 'user'
                                                    ? 'bg-purple-600 text-white'
                                                    : message.handoff
                                                        ? 'bg-gradient-to-r from-green-50 to-indigo-50 border border-indigo-200'
                                                        : 'bg-gray-100 text-gray-900'
                                                }`}>
                                                <p className="text-sm leading-relaxed">{message.content}</p>
                                                {message.handoff && (
                                                    <div className="mt-3 pt-3 border-t border-indigo-200">
                                                        <Link
                                                            href={message.handoff.url}
                                                            className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-medium rounded-lg hover:shadow-lg transition-all duration-200"
                                                        >
                                                            <SparklesIcon className="w-3 h-3 mr-1" />
                                                            {message.handoff.action} with {message.handoff.to}
                                                        </Link>
                                                    </div>
                                                )}
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

                    {/* Plan Tracker */}
                    <div className="border-t border-gray-200 bg-white">
                        <div className="p-4">
                            <button
                                onClick={() => setExpandedPlan(!expandedPlan)}
                                className="w-full flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                            >
                                <div className="flex items-center">
                                    <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center mr-3">
                                        <PlayIcon className="w-3 h-3 text-white" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-sm font-medium text-green-900">{activeItem.title}</p>
                                        <p className="text-xs text-green-600">Currently in progress</p>
                                    </div>
                                </div>
                                {expandedPlan ? (
                                    <ChevronDownIcon className="w-4 h-4 text-green-600" />
                                ) : (
                                    <ChevronRightIcon className="w-4 h-4 text-green-600" />
                                )}
                            </button>

                            {expandedPlan && (
                                <div className="mt-4 space-y-3">
                                    <p className="text-sm text-gray-600">{activeItem.description}</p>
                                    <div className="space-y-2">
                                        <p className="text-xs font-medium text-gray-900">Current Tasks:</p>
                                        {activeItem.tasks.map((task, index) => (
                                            <div key={index} className="flex items-center text-xs text-gray-600">
                                                <CheckCircleIcon className="w-3 h-3 text-green-500 mr-2" />
                                                {task}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="pt-3 border-t border-gray-200">
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div className="text-center">
                                                <div className="text-green-600 font-medium">3</div>
                                                <div className="text-gray-500">Complete</div>
                                            </div>
                                            <div className="text-center">
                                                <div className="text-blue-600 font-medium">1</div>
                                                <div className="text-gray-500">In Progress</div>
                                            </div>
                                            <div className="text-center">
                                                <div className="text-gray-400 font-medium">3</div>
                                                <div className="text-gray-500">Pending</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Chat Input */}
                    <div className="border-t border-gray-200 p-4 bg-white">
                        <div className="flex space-x-3">
                            <div className="flex-1">
                                <textarea
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyPress={handleKeyPress}
                                    placeholder="Ask CodeBot-DEV to modify code, add features, or explain implementation..."
                                    rows={2}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none text-sm"
                                />
                            </div>
                            <button
                                onClick={handleSendMessage}
                                disabled={!inputValue.trim()}
                                className="px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed self-end"
                            >
                                <PaperAirplaneIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Side - Content Pane */}
                <div className="flex-1 bg-white flex flex-col min-h-0">
                    {/* Content Header with Tabs */}
                    <div className="border-b border-gray-200 bg-white">
                        <div className="flex items-center justify-between p-6">
                            <h2 className="text-2xl font-bold text-gray-900">Development Workspace</h2>
                            <div className="flex items-center text-sm text-green-600">
                                <PlayIcon className="w-4 h-4 mr-1" />
                                Development in progress
                            </div>
                        </div>

                        {/* Content Tabs */}
                        <div className="flex border-b border-gray-200">
                            {contentTabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveContentTab(tab.id)}
                                    className={`flex items-center px-6 py-3 border-b-2 font-medium text-sm transition-colors ${activeContentTab === tab.id
                                            ? 'border-green-500 text-green-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                        }`}
                                >
                                    <tab.icon className="w-4 h-4 mr-2" />
                                    {tab.title}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 min-h-0">
                        {renderContentPane()}
                    </div>
                </div>
            </div>
        </div>
    )
}

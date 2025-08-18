'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  EyeIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  CogIcon
} from '@heroicons/react/24/outline'

interface ContentTab {
  id: string
  title: string
  icon: any
  type: 'preview' | 'code' | 'artifact' | 'spec'
}

interface ElementStyles {
  fontSize: string
  fontWeight: string
  color: string
  marginBottom: string
  padding: string
}

interface ContentPaneProps {
  activeContentTab: string
  elementStyles: ElementStyles
  isSelectMode: boolean
  selectedElement: string | null
  onTabChange: (tabId: string) => void
  onElementSelect: (elementId: string) => void
}

export default function ContentPane({
  activeContentTab,
  elementStyles,
  isSelectMode,
  selectedElement,
  onTabChange,
  onElementSelect
}: ContentPaneProps) {
  const contentTabs: ContentTab[] = [
    { id: 'preview', title: 'Live Preview', icon: EyeIcon, type: 'preview' },
    { id: 'code', title: 'Current Code', icon: CodeBracketIcon, type: 'code' },
    { id: 'artifacts', title: 'Artifacts', icon: DocumentTextIcon, type: 'artifact' },
    { id: 'specs', title: 'Specifications', icon: CogIcon, type: 'spec' }
  ]

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
                    <h1 
                      className={`${elementStyles.fontSize} ${elementStyles.fontWeight} ${elementStyles.color} ${elementStyles.marginBottom} ${elementStyles.padding} ${
                        isSelectMode ? 'cursor-pointer hover:bg-blue-50 hover:ring-2 hover:ring-blue-200 rounded' : ''
                      } ${selectedElement === 'welcome-title' ? 'bg-blue-50 ring-2 ring-blue-300' : ''}`}
                      onClick={() => {
                        if (isSelectMode) {
                          onElementSelect('welcome-title')
                        }
                      }}
                    >
                      Welcome to FitStudio Pro
                    </h1>
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
            <div className="prose max-w-none text-gray-900 [&_h1]:text-gray-900 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-gray-900 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-3 [&_h3]:text-gray-900 [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mb-2 [&_p]:text-gray-800 [&_p]:mb-4 [&_li]:text-gray-800 [&_ul]:mb-4 [&_ol]:mb-4 [&_strong]:text-gray-900 [&_strong]:font-semibold">
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

  return (
    <div className="flex-1 bg-white flex flex-col min-h-0">
      {/* Content Tabs */}
      <div className="border-b border-gray-200 bg-white">
        <div className="flex border-b border-gray-200">
          {contentTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center px-6 py-3 border-b-2 font-medium text-sm transition-colors ${
                activeContentTab === tab.id
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
  )
}

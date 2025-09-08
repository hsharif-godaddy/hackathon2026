'use client'

import { useState } from 'react'
import { SparklesIcon, UserIcon } from '@heroicons/react/24/outline'
import { useMockAuth } from '@/hooks/useMockAuth'
import { MOCK_USER } from '@/lib/mock-auth'

interface MockLoginDialogProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  message?: string
}

export function MockLoginDialog({ 
  isOpen, 
  onClose, 
  title = "Mock Login - Development Only",
  message = "Sign in as a test user to simulate the login experience. This is only available in development mode."
}: MockLoginDialogProps) {
  const { login, isLoading } = useMockAuth()

  if (!isOpen) return null

  const handleLogin = async () => {
    await login()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mr-3">
              <SparklesIcon className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <p className="text-sm text-gray-600 mb-4">{message}</p>
          
          {/* Test User Info */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Test User:
            </label>
            <div className="flex items-center px-4 py-3 border border-gray-300 rounded-lg bg-gray-50">
              <span className="text-2xl mr-3">{MOCK_USER.avatar}</span>
              <div className="text-left">
                <div className="font-medium text-gray-900">{MOCK_USER.name}</div>
                <div className="text-sm text-gray-500">{MOCK_USER.email}</div>
                <div className="text-xs text-purple-600 font-medium">Plan: {MOCK_USER.plan}</div>
              </div>
            </div>
          </div>

          {/* Plan Info */}
          <div className="bg-purple-50 rounded-lg p-3 mb-4">
            <div className="flex items-center">
              <UserIcon className="w-4 h-4 text-purple-600 mr-2" />
              <span className="text-sm font-medium text-purple-900">
                Development User: {MOCK_USER.plan} Plan
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 flex items-center"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Logging In...
              </>
            ) : (
              'Sign In as ' + MOCK_USER.name
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// Quick login button component
interface MockQuickLoginProps {
  className?: string
  iconOnly?: boolean
}

export function MockQuickLogin({ className = "", iconOnly = false }: MockQuickLoginProps) {
  const { quickLogin, isLoading } = useMockAuth()

  const handleQuickLogin = async () => {
    await quickLogin()
  }

  if (iconOnly) {
    return (
      <button
        onClick={handleQuickLogin}
        disabled={isLoading}
        className={`flex items-center justify-center w-10 h-10 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-colors shadow-sm hover:shadow-md disabled:opacity-50 ${className}`}
        title="Quick Mock Login (Dev Mode)"
        aria-label="Quick Mock Login"
      >
        {isLoading ? (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="text-sm">🚀</span>
        )}
      </button>
    )
  }

  return (
    <button
      onClick={handleQuickLogin}
      disabled={isLoading}
      className={`bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg transition-colors font-medium flex items-center disabled:opacity-50 ${className}`}
    >
      {isLoading ? (
        <>
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
          Quick Login...
        </>
      ) : (
        <>
          <span className="mr-2">🚀</span>
          Quick Login (Dev)
        </>
      )}
    </button>
  )
}

// Simple user display for logged-in state
export function MockUserSwitcher() {
  const { user, logout, isLoading } = useMockAuth()

  if (!user) return null

  return (
    <div className="flex items-center space-x-3">
      <div className="flex items-center space-x-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg">
        <span className="text-lg">{user.avatar}</span>
        <div className="text-left">
          <div className="text-sm font-medium text-gray-900">{user.name}</div>
          <div className="text-xs text-yellow-600 font-medium">Mock: {user.plan}</div>
        </div>
      </div>
      
      <button
        onClick={logout}
        disabled={isLoading}
        className="text-sm text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded disabled:opacity-50"
        title="Sign Out"
      >
        {isLoading ? 'Signing Out...' : 'Sign Out'}
      </button>
    </div>
  )
}
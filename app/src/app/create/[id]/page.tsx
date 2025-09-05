'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { useAppStore, cleanupAppStore, AppStatus } from '@/stores/useAppStore'

export default function CreateAppStatus() {
  const router = useRouter()
  const params = useParams()
  const appId = params.id as string
  
  const {
    currentApp,
    creationError,
    startPolling,
    clearCreationState,
    shouldRedirect,
    syncActualPorts
  } = useAppStore()

  // Start polling and handle cleanup
  useEffect(() => {
    if (!appId) return

    startPolling(appId)

    return () => {
      cleanupAppStore()
    }
  }, [appId, startPolling])

  // Sync actual ports while on create page
  useEffect(() => {
    if (!appId) return
    
    // Initial sync
    syncActualPorts()
    
    // Keep syncing ports while app is being created
    const interval = setInterval(async () => {
      try {
        await syncActualPorts()
      } catch (error) {
        console.error('Error syncing ports on create page:', error)
      }
    }, 2000) // Sync every 2 seconds during creation
    
    return () => clearInterval(interval)
  }, [appId, syncActualPorts])

  // Handle redirect when app is ready
  useEffect(() => {
    if (shouldRedirect() && currentApp) {
      // Wait a moment before redirecting to allow user to see success
      setTimeout(() => {
        router.replace(`/develop/${appId}`)
      }, 2000)
    }
  }, [shouldRedirect, currentApp, appId, router])

  // Show error state
  if (creationError || currentApp?.status === AppStatus.ERROR) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-red-600 text-2xl">⚠️</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">App Creation Failed</h1>
          <p className="text-gray-600 mb-6">
            {creationError || 'An error occurred while creating your app. Please try again.'}
          </p>
          <div className="space-y-3">
            <button
              onClick={() => router.push('/')}
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
            >
              Go Back Home
            </button>
            <button
              onClick={() => {
                clearCreationState()
                startPolling(appId)
              }}
              className="w-full border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Show success state (briefly before redirect)
  if (currentApp?.status === AppStatus.CREATED) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-green-600 text-2xl">✅</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">App Created Successfully!</h1>
          <p className="text-gray-600 mb-4">
            <strong>{currentApp.name}</strong> is ready to build.
          </p>
          <p className="text-sm text-gray-500">Redirecting to development environment...</p>
        </div>
      </div>
    )
  }

  // Show loading state
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <SparklesIcon className="w-8 h-8 text-white animate-pulse" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Creating Your App</h1>
        {currentApp && (
          <p className="text-lg text-gray-700 mb-2">
            <strong>{currentApp.name}</strong>
          </p>
        )}
        <p className="text-gray-600 mb-6">
          Setting up your development environment, installing dependencies, and configuring your project...
        </p>
        
        {/* Progress indicator */}
        <div className="flex justify-center space-x-1 mb-6">
          <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce"></div>
          <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
          <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
        </div>

        {/* Estimated time */}
        <div className="text-sm text-gray-500 space-y-1">
          <p>This usually takes 30-60 seconds</p>
          <p>Please don&apos;t close this page</p>
        </div>

        {/* Cancel option */}
        <button
          onClick={() => router.push('/')}
          className="cursor-pointer mt-8 text-gray-500 hover:text-gray-700 transition-colors text-sm underline"
        >
          Cancel and go back
        </button>
      </div>
    </div>
  )
}

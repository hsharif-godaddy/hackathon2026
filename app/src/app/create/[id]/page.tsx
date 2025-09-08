'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { useSiteCreationStore, cleanupSiteCreationStore, type SiteCreationPhase } from '@/stores/useSiteCreationStore'

export default function CreateAppStatus() {
  const router = useRouter()
  const params = useParams()
  const siteId = params.id as string
  
  // Get all store state and actions
  const {
    site,
    phase,
    error,
    retryCount,
    maxRetries,
    initializeSite,
    retry,
    reset
  } = useSiteCreationStore()

  // Initialize the creation flow
  useEffect(() => {
    if (!siteId) return

    console.log('🚀 Starting site creation flow for:', siteId)
    initializeSite(siteId)

    // Cleanup on unmount
    return () => {
      cleanupSiteCreationStore()
    }
  }, [siteId, initializeSite])

  // Handle automatic redirect on completion
  useEffect(() => {
    if (phase === 'complete' && siteId) {
      console.log('✅ Site creation complete, redirecting to develop page')
      
      // Brief delay before redirect for better UX
      const timer = setTimeout(() => {
        router.replace(`/develop/${siteId}`)
      }, 2000)
      
      return () => clearTimeout(timer)
    }
  }, [phase, siteId, router])

  // Error state
  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-red-600 text-2xl">⚠️</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">App Creation Failed</h1>
          <p className="text-gray-600 mb-6">
            {error || 'An error occurred while creating your app. Please try again.'}
          </p>
          <div className="space-y-3">
            <button
              onClick={() => router.push('/')}
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
            >
              Go Back Home
            </button>
            {retryCount < maxRetries && (
              <button
                onClick={retry}
                className="w-full border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Retry ({retryCount}/{maxRetries})
              </button>
            )}
            <button
              onClick={() => {
                reset()
                router.push('/')
              }}
              className="w-full text-gray-500 hover:text-gray-700 transition-colors text-sm underline"
            >
              Start Over
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Success state (briefly before redirect)
  if (phase === 'complete') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-green-600 text-2xl">✅</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">App Created Successfully!</h1>
          <p className="text-gray-600 mb-4">
            Your app is ready to build!
          </p>
          <p className="text-sm text-gray-500">Redirecting to development environment...</p>
        </div>
      </div>
    )
  }

  // Name updating state
  if (phase === 'updating-name') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <SparklesIcon className="w-8 h-8 text-white animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Finalizing Your App</h1>
          <p className="text-gray-600 mb-6">
            Getting a perfect name for your project from the AI agent...
          </p>
          
          {/* Progress indicator */}
          <div className="flex justify-center space-x-1 mb-6">
            <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce"></div>
            <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>
        </div>
      </div>
    )
  }

  // Agent verification state
  if (phase === 'verifying-agent') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <SparklesIcon className="w-8 h-8 text-white animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Almost Ready!</h1>
          <p className="text-gray-600 mb-6">
            Verifying your development environment is fully ready...
          </p>
          
          {/* Progress indicator */}
          <div className="flex justify-center space-x-1 mb-6">
            <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce"></div>
            <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>
        </div>
      </div>
    )
  }

  // Deployment starting state
  if (phase === 'deploying') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <SparklesIcon className="w-8 h-8 text-white animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Starting Deployment</h1>
          <p className="text-gray-600 mb-6">
            Initializing your development environment...
          </p>
          
          {/* Progress indicator */}
          <div className="flex justify-center space-x-1 mb-6">
            <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce"></div>
            <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-3 h-3 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>

          <div className="text-sm text-gray-500">
            <p>Setting up your project infrastructure...</p>
          </div>
        </div>
      </div>
    )
  }

  // Default state: initializing or polling
  const getPhaseDisplay = (currentPhase: SiteCreationPhase) => {
    switch (currentPhase) {
      case 'initializing':
        return 'Initializing your project...'
      case 'polling':
        return 'Setting up your development environment, installing dependencies, configuring your project, and verifying everything is ready...'
      default:
        return 'Creating your app...'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <SparklesIcon className="w-8 h-8 text-white animate-pulse" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Creating Your App</h1>
        <p className="text-gray-600 mb-6">
          {getPhaseDisplay(phase)}
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
          onClick={() => {
            cleanupSiteCreationStore()
            router.push('/')
          }}
          className="cursor-pointer mt-8 text-gray-500 hover:text-gray-700 transition-colors text-sm underline"
        >
          Cancel and go back
        </button>
      </div>
    </div>
  )
}
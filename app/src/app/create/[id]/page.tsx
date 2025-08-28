'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { appFetch } from '@/lib/gasket-config'
import { appService } from '@/services/AppService'

interface AppStatus {
  id: string
  status: 'creating' | 'created' | 'error'
  name: string
  createdAt: string
  updatedAt: string
}

export default function CreateAppStatus() {
  const router = useRouter()
  const params = useParams()
  const appId = params.id as string
  
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(true)

  // Poll app status
  useEffect(() => {
    if (!appId || !isPolling) return

        const pollStatus = async () => {
      try {
        const data = await appService.getAppStatus(appId)
        setAppStatus(data)

        // Stop polling if app creation is complete or errored
        if (data.status === 'created' || data.status === 'error') {
          setIsPolling(false)
          
          if (data.status === 'created') {
            // Wait a moment before redirecting to allow user to see success
            setTimeout(() => {
              router.replace(`/develop/${appId}`)
            }, 2000)
          }
        }
      } catch (err) {
        console.error('Error polling app status:', err)
        setError(err instanceof Error ? err.message : 'Unknown error occurred')
        setIsPolling(false)
      }
    }

    // Initial poll
    pollStatus()

    // Set up polling interval
    const interval = setInterval(pollStatus, 2000) // Poll every 2 seconds

    return () => clearInterval(interval)
  }, [appId, isPolling, router])

  // Show error state
  if (error || appStatus?.status === 'error') {
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
            <button
              onClick={() => {
                setError(null)
                setIsPolling(true)
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
  if (appStatus?.status === 'created') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-green-600 text-2xl">✅</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">App Created Successfully!</h1>
          <p className="text-gray-600 mb-4">
            <strong>{appStatus.name}</strong> is ready to build.
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
        {appStatus && (
          <p className="text-lg text-gray-700 mb-2">
            <strong>{appStatus.name}</strong>
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
          className="mt-8 text-gray-500 hover:text-gray-700 transition-colors text-sm underline"
        >
          Cancel and go back
        </button>
      </div>
    </div>
  )
}

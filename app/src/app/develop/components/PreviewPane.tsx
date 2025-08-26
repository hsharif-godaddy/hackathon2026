'use client'

import { useState, useEffect } from 'react'
import { 
  ExclamationTriangleIcon, 
  ArrowPathIcon
} from '@heroicons/react/24/outline'

interface PreviewPaneProps {
  appId: string
  port?: number
  onRetry?: () => void
  viewMode?: 'desktop' | 'mobile'
}

interface ServerStatus {
  isLoading: boolean
  isRunning: boolean
  error?: string
  lastChecked?: Date
}



export default function PreviewPane({ appId, port, onRetry, viewMode = 'desktop' }: PreviewPaneProps) {
  const [serverStatus, setServerStatus] = useState<ServerStatus>({
    isLoading: true,
    isRunning: false
  })
  const [retryCount, setRetryCount] = useState(0)
  const maxRetries = 10
  
  const previewUrl = port ? `http://localhost:${port}` : null

  // Check if the development server is running
  const checkServerStatus = async () => {
    if (!previewUrl) {
      setServerStatus({
        isLoading: false,
        isRunning: false,
        error: 'No port assigned to this app'
      })
      return
    }

    try {
      setServerStatus(prev => ({ ...prev, isLoading: true }))
      
      // Try to fetch the app with a shorter timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      
      await fetch(previewUrl, {
        signal: controller.signal,
        mode: 'no-cors' // Avoid CORS issues for simple connectivity check
      })
      
      clearTimeout(timeoutId)
      
      setServerStatus({
        isLoading: false,
        isRunning: true,
        lastChecked: new Date()
      })
      setRetryCount(0)
    } catch (error) {
      console.log('Server check failed:', error)
      setServerStatus({
        isLoading: false,
        isRunning: false,
        error: retryCount >= maxRetries ? 'Server failed to start after multiple attempts' : 'Server not ready yet',
        lastChecked: new Date()
      })
    }
  }

  // Auto-retry logic for server startup
  useEffect(() => {
    if (!serverStatus.isRunning && retryCount < maxRetries && !serverStatus.error?.includes('multiple attempts')) {
      const timer = setTimeout(() => {
        setRetryCount(prev => prev + 1)
        checkServerStatus()
      }, retryCount === 0 ? 1000 : Math.min(2000 + retryCount * 1000, 10000))
      
      return () => clearTimeout(timer)
    }
  }, [serverStatus.isRunning, retryCount, maxRetries]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for file save events to auto-refresh preview
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'file-saved' && serverStatus.isRunning) {
        // Debounce refreshes to avoid too many reloads
        setTimeout(() => {
          const iframe = document.querySelector('#preview-iframe') as HTMLIFrameElement
          if (iframe) {
            iframe.src = iframe.src
          }
        }, 1000)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [serverStatus.isRunning])

  // Initial check
  useEffect(() => {
    checkServerStatus()
  }, [previewUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleManualRetry = () => {
    setRetryCount(0)
    checkServerStatus()
    onRetry?.()
  }

  const handleRefresh = () => {
    if (serverStatus.isRunning) {
      // Force iframe reload
      const iframe = document.querySelector('#preview-iframe') as HTMLIFrameElement
      if (iframe) {
        iframe.src = iframe.src
      }
    }
  }



  // Get iframe dimensions based on view mode
  const getIframeDimensions = () => {
    switch (viewMode) {
      case 'mobile':
        // Mobile aspect ratio is typically 375:667 (iPhone dimensions)
        // Calculate width based on available height maintaining aspect ratio
        const aspectRatio = 375 / 667
        return {
          width: 'auto',
          height: '100%',
          aspectRatio: aspectRatio.toString(),
          maxWidth: '100%'
        }
      case 'desktop':
      default:
        return {
          width: '100%',
          height: '100%'
        }
    }
  }

  // Loading state while server is starting
  if (serverStatus.isLoading || (!serverStatus.isRunning && retryCount < maxRetries && !serverStatus.error?.includes('multiple attempts'))) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 text-gray-600">
        <ArrowPathIcon className="w-12 h-12 animate-spin text-blue-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Starting Development Server</h3>
        <p className="text-sm text-gray-500 mb-2">
          {retryCount === 0 ? 'Initializing...' : `Checking server status (attempt ${retryCount}/${maxRetries})`}
        </p>
        {port && (
          <p className="text-xs text-gray-400">
            Server will be available at: <span className="font-mono">localhost:{port}</span>
          </p>
        )}
        <div className="mt-4 flex items-center space-x-2">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse delay-100"></div>
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse delay-200"></div>
        </div>
      </div>
    )
  }

  // Error state when server failed to start
  if (!serverStatus.isRunning && serverStatus.error) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 text-gray-600">
        <ExclamationTriangleIcon className="w-12 h-12 text-amber-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Development Server Issue</h3>
        <p className="text-sm text-gray-500 mb-4 text-center max-w-md">
          {serverStatus.error}
        </p>
        {port && (
          <p className="text-xs text-gray-400 mb-4">
            Expected URL: <span className="font-mono">localhost:{port}</span>
          </p>
        )}
        <button
          onClick={handleManualRetry}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Try Again
        </button>
        <p className="text-xs text-gray-400 mt-2">
          The server may take a few moments to start completely
        </p>
      </div>
    )
  }

  // Success state - show the preview
  return (
    <div className="h-full relative overflow-hidden">
      <div className={`flex h-full ${viewMode === 'mobile' ? 'justify-center items-center p-4' : 'w-full h-full'}`}>
        <iframe
          id="preview-iframe"
          src={previewUrl!}
          className={`border-0 ${viewMode === 'mobile' ? 'border border-gray-300 rounded-lg shadow-lg' : ''}`}
          style={getIframeDimensions()}
          title={`Preview of app ${appId}`}
          sandbox="allow-same-origin allow-scripts allow-forms allow-links allow-popups"
          onLoad={() => {
            console.log('Preview loaded successfully')
          }}
          onError={() => {
            console.log('Preview failed to load')
            setServerStatus(prev => ({
              ...prev,
              isRunning: false,
              error: 'Failed to load preview'
            }))
          }}
        />
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { 
  ExclamationTriangleIcon, 
  ArrowPathIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import { useServerPollingStore } from '@/stores/useServerPollingStore'

interface PreviewPaneProps {
  appId: string
  onRetry?: () => void
  viewMode?: 'desktop' | 'mobile'
  selectedCommit?: {
    hash: string
    shortHash: string
    message: string
    author: string
    date: string
  }
}

export default function PreviewPane({ appId, onRetry, viewMode = 'desktop', selectedCommit }: PreviewPaneProps) {
  const { 
    getServerState,
    startPollingForServer,
    stopPollingForServer,
    isPollingServer
  } = useServerPollingStore()
  
  const serverState = getServerState(appId)
  const previewUrl = serverState?.isReady ? serverState.url : null
  
  // Iframe state
  const [iframeError, setIframeError] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  
  // Start polling when component mounts
  useEffect(() => {
    if (!appId) return
    
    console.log(`🚀 Starting server polling for ${appId}`)
    startPollingForServer(appId)
    
    return () => {
      console.log(`⏹️ Stopping server polling for ${appId}`)
      stopPollingForServer(appId)
    }
  }, [appId, startPollingForServer, stopPollingForServer])
  
  // Listen for file save events to auto-refresh preview
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'file-saved' && serverState?.isReady) {
        // Debounce refreshes to avoid too many reloads
        setTimeout(() => {
          if (iframeRef.current) {
            iframeRef.current.src = iframeRef.current.src
          }
        }, 500)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [serverState?.isReady])
  
  const handleManualRetry = () => {
    console.log(`🔄 Manual retry for ${appId}`)
    // Restart polling for this server
    stopPollingForServer(appId)
    startPollingForServer(appId)
    setIframeError(false)
    setIframeKey(prev => prev + 1)
    onRetry?.()
  }
  
  const handleIframeError = () => {
    console.log(`❌ Iframe error for ${appId}`)
    setIframeError(true)
  }
  
  const handleIframeLoad = () => {
    console.log(`✅ Iframe loaded successfully for ${appId}`)
    setIframeError(false)
  }
  
  // Get iframe dimensions based on view mode
  const iframeDimensions = viewMode === 'mobile' 
    ? { width: '375px', height: '667px' }  // iPhone dimensions
    : { width: '100%', height: '100%' }
  
  // Loading state while polling
  if (!serverState || (isPollingServer(appId) && !serverState.isReady)) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 text-gray-600">
        <ClockIcon className="w-8 h-8 text-blue-500 animate-spin mb-4" />
        <h3 className="text-lg font-semibold mb-2">Starting Server</h3>
        <p className="text-sm text-gray-500 mb-2">
          {serverState?.status === 'pending' 
            ? 'Waiting for server to start...' 
            : serverState?.status === 'running'
            ? 'Server is running, verifying readiness...'
            : 'Checking server status...'}
        </p>
        <p className="text-xs text-gray-400 text-center max-w-md">
          This usually takes 30-60 seconds for the first load.
        </p>
      </div>
    )
  }
  
  // Error state when server failed
  if (serverState?.status === 'failed' || serverState?.status === 'error') {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 text-gray-600">
        <ExclamationTriangleIcon className="w-8 h-8 text-red-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Server Error</h3>
        <p className="text-sm text-gray-500 mb-4 text-center max-w-md">
          {serverState.error || 'The server encountered an error and could not start.'}
        </p>
        <button
          onClick={handleManualRetry}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Try Again
        </button>
      </div>
    )
  }
  
  // Error state when iframe fails to load
  if (iframeError && previewUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 text-gray-600">
        <ExclamationTriangleIcon className="w-8 h-8 text-orange-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Preview Error</h3>
        <p className="text-sm text-gray-500 mb-4 text-center max-w-md">
          The preview could not load. This might be a temporary issue.
        </p>
        <button
          onClick={handleManualRetry}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Reload Preview
        </button>
      </div>
    )
  }
  
  // Success state - show the preview
  if (previewUrl && serverState?.isReady) {
    return (
      <div className="h-full flex flex-col">
        {selectedCommit && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
            <div className="flex items-center text-sm text-amber-800">
              <span className="font-mono bg-amber-200 px-2 py-1 rounded text-xs mr-2">
                {selectedCommit.shortHash}
              </span>
              <span className="truncate">{selectedCommit.message}</span>
            </div>
          </div>
        )}
        
        <div className="flex-1 bg-white">
          <iframe
            key={iframeKey}
            ref={iframeRef}
            id="preview-iframe"
            src={previewUrl}
            style={iframeDimensions}
            className={`border-0 ${viewMode === 'mobile' ? 'mx-auto' : ''}`}
            onError={handleIframeError}
            onLoad={handleIframeLoad}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            title={`Preview for ${appId}`}
          />
        </div>
      </div>
    )
  }
  
  // Fallback loading state
  return (
    <div className="h-full flex flex-col items-center justify-center bg-gray-50 text-gray-600">
      <ClockIcon className="w-8 h-8 text-blue-500 animate-spin mb-4" />
      <h3 className="text-lg font-semibold mb-2">Loading Preview</h3>
      <p className="text-sm text-gray-500">
        Preparing your application preview...
      </p>
    </div>
  )
}
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { 
  ExclamationTriangleIcon, 
  ArrowPathIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { postMessageToIframe } from '@/utils/postMessage'

// Timing constants for iframe lifecycle management
const REFRESH_DEBOUNCE_MS = 500 // Debounce rapid refresh requests
const STATE_RESTORE_FALLBACK_MS = 3000 // Fallback timeout if iframe doesn't send ready signal

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
  
  // State preservation for iframe navigation and scroll position
  const [pendingStateRestore, setPendingStateRestore] = useState<{
    url?: string
    scrollPosition?: { x: number; y: number }
  } | null>(null)
  const [isWaitingForIframeReady, setIsWaitingForIframeReady] = useState(false)
  
  // Mobile device sizes with relative proportions for outline shapes
  const mobileDevices = [
    { 
      name: 'iPhone SE', 
      width: 375, 
      height: 667,
      aspectRatio: 375/667, // ~0.56
      hasNotch: false
    },
    { 
      name: 'iPhone 14', 
      width: 390, 
      height: 844,
      aspectRatio: 390/844, // ~0.46
      hasNotch: true
    },
    { 
      name: 'iPhone 14 Pro', 
      width: 393, 
      height: 852,
      aspectRatio: 393/852, // ~0.46
      hasNotch: true
    },
    { 
      name: 'iPhone 14 Pro Max', 
      width: 430, 
      height: 932,
      aspectRatio: 430/932, // ~0.46
      hasNotch: true
    },
    { 
      name: 'Samsung Galaxy S23', 
      width: 360, 
      height: 780,
      aspectRatio: 360/780, // ~0.46
      hasNotch: false
    },
  ]
  
  const [selectedDevice, setSelectedDevice] = useState(mobileDevices[2]) // Default to iPhone 14 Pro
  
  // Device outline component
  const DeviceOutline = ({ device, isSelected, onClick }: { 
    device: typeof mobileDevices[0], 
    isSelected: boolean, 
    onClick: () => void 
  }) => {
    const outlineHeight = 40 // Fixed height for all outlines
    const outlineWidth = outlineHeight * device.aspectRatio
    
    return (
      <button
        onClick={onClick}
        className={`relative flex flex-col items-center p-2 rounded-lg ${
          isSelected 
            ? 'bg-gray-200 shadow-sm' 
            : 'hover:bg-gray-100'
        }`}
        title={`${device.name} (${device.width}×${device.height})`}
      >
        {/* Device outline */}
        <div 
          className={`border-2 rounded-md relative ${
            isSelected 
              ? 'border-gray-600' 
              : 'border-gray-300'
          }`}
          style={{ 
            width: outlineWidth, 
            height: outlineHeight 
          }}
        >
          {/* Notch for modern iPhones */}
          {device.hasNotch && (
            <div 
              className={`absolute top-0 left-1/2 transform -translate-x-1/2 rounded-b-sm ${
                isSelected ? 'bg-gray-600' : 'bg-gray-300'
              }`}
              style={{ 
                width: outlineWidth * 0.3, 
                height: 2 
              }}
            />
          )}
          {/* Home button for older devices */}
          {!device.hasNotch && (
            <div 
              className={`absolute bottom-1 left-1/2 transform -translate-x-1/2 rounded-full ${
                isSelected ? 'bg-gray-600' : 'bg-gray-300'
              }`}
              style={{ 
                width: 3, 
                height: 3 
              }}
            />
          )}
        </div>
        {/* Device label */}
        <span className={`text-xs mt-1 ${
          isSelected ? 'text-gray-700 font-medium' : 'text-gray-500'
        }`}>
          {device.name.split(' ').pop()}
        </span>
      </button>
    )
  }
  
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
  
  // Handle iframe load and restore scroll position if pending
  const handleIframeLoad = useCallback(() => {
    setIframeError(false)
    
    // Check if we have scroll position to restore and URL matches
    if (pendingStateRestore?.scrollPosition && iframeRef.current) {
      // Check if the current iframe URL matches the saved URL
      try {
        const currentUrl = new URL(iframeRef.current.src)
        const savedUrl = pendingStateRestore.url ? new URL(pendingStateRestore.url) : null
        
        // Only restore if URLs match (same pathname and search params)
        if (savedUrl && currentUrl.pathname === savedUrl.pathname && currentUrl.search === savedUrl.search) {
          // Set waiting state and start fallback timer
          setIsWaitingForIframeReady(true)
          
          // Fallback timeout in case iframe doesn't send ready signal
          const fallbackTimer = setTimeout(() => {
            if (isWaitingForIframeReady) {
              console.warn('Iframe ready timeout, attempting state restoration anyway')
              attemptStateRestoration()
            }
          }, STATE_RESTORE_FALLBACK_MS)
          
          // Clear timer when component unmounts or state changes
          return () => clearTimeout(fallbackTimer)
        } else {
          console.log('URL mismatch, clearing pending state restoration')
          setPendingStateRestore(null)
        }
      } catch (error) {
        console.warn('Failed to parse URLs for state restoration:', error)
        setPendingStateRestore(null)
      }
    }
  }, [appId, pendingStateRestore, isWaitingForIframeReady])

  // Attempt to restore iframe state (scroll position, etc.)
  const attemptStateRestoration = useCallback(() => {
    if (!pendingStateRestore?.scrollPosition || !iframeRef.current) return
    
    // Double-check URL match before restoration
    try {
      const currentUrl = new URL(iframeRef.current.src)
      const savedUrl = pendingStateRestore.url ? new URL(pendingStateRestore.url) : null
      
      if (!savedUrl || currentUrl.pathname !== savedUrl.pathname || currentUrl.search !== savedUrl.search) {
        console.log('URL mismatch during restoration, aborting')
        setPendingStateRestore(null)
        setIsWaitingForIframeReady(false)
        return
      }
    } catch (error) {
      console.warn('Failed to validate URLs during restoration:', error)
      setPendingStateRestore(null)
      setIsWaitingForIframeReady(false)
      return
    }
    
    try {
      // Try to access iframe content and restore scroll position
      const contentWindow = iframeRef.current.contentWindow
      
      if (contentWindow && pendingStateRestore.scrollPosition) {
        contentWindow.scrollTo(
          pendingStateRestore.scrollPosition.x,
          pendingStateRestore.scrollPosition.y
        )
      }
    } catch (error) {
      // If direct access fails (cross-origin), try postMessage as fallback
      try {
        const restoreMessage = {
          type: 'RESTORE_STATE_AFTER_REFRESH',
          url: pendingStateRestore.url,
          scrollPosition: pendingStateRestore.scrollPosition
        }
        postMessageToIframe(iframeRef.current, restoreMessage)
      } catch (postMessageError) {
        console.error('Failed to restore state:', postMessageError)
      }
    }
    
    // Clear pending state and waiting flag
    setPendingStateRestore(null)
    setIsWaitingForIframeReady(false)
  }, [pendingStateRestore])

  // Listen for file save events and preview refresh requests to auto-refresh preview
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Handle iframe ready signal for immediate state restoration
      if (event.data.type === 'IFRAME_READY' && isWaitingForIframeReady) {
        console.log('Iframe ready signal received, restoring state immediately')
        attemptStateRestoration()
        return
      }
      
      if ((event.data.type === 'file-saved' || event.data.type === 'preview-refresh') && serverState?.isReady) {
        // Store state to restore if provided
        if (event.data.preserveState) {
          setPendingStateRestore(event.data.preserveState)
        }
        
        // Debounce refreshes to avoid too many reloads
        setTimeout(() => {
          if (iframeRef.current) {
            iframeRef.current.src = iframeRef.current.src
          }
        }, REFRESH_DEBOUNCE_MS)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [serverState?.isReady, isWaitingForIframeReady, attemptStateRestoration])
  
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
        
        <div className="flex-1 bg-gray-50 flex items-center justify-center py-2 relative">
          {/* Single iframe container that adapts to view mode */}
          <div className={`flex items-center justify-center ${viewMode === 'mobile' ? 'space-x-8' : 'w-full h-full'} mx-2`}>
            {/* Main iframe container */}
            <div className={`flex flex-col items-center ${viewMode === 'desktop' ? 'w-full h-full' : ''}`}>
              <div 
                className={`bg-white overflow-hidden ${
                  viewMode === 'mobile' 
                    ? 'shadow-2xl border-4 border-gray-800' 
                    : 'shadow-lg border border-gray-200 rounded-lg flex-1 w-full h-full'
                }`}
                style={viewMode === 'mobile' ? { 
                  width: selectedDevice.width, 
                  height: selectedDevice.height,
                  borderRadius: Math.min(selectedDevice.width * 0.08, 32)
                } : {}}
              >
                {/* Single iframe that persists between view changes */}
                <iframe
                  key={iframeKey}
                  ref={iframeRef}
                  id="preview-iframe"
                  src={previewUrl}
                  className="w-full h-full border-0"
                  onError={handleIframeError}
                  onLoad={handleIframeLoad}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-top-navigation-by-user-activation"
                  title={`Preview for ${appId}`}
                />
              </div>
              
              {/* Device info - only show in mobile mode */}
              {viewMode === 'mobile' && (
                <div className="mt-3 text-center">
                  <span className="text-xs text-gray-400">
                    {selectedDevice.name} ({selectedDevice.width}×{selectedDevice.height})
                  </span>
                </div>
              )}
            </div>
            
            {/* Device selector - only show in mobile mode */}
            {viewMode === 'mobile' && (
              <div className="flex flex-col space-y-2 bg-gray-100 rounded-lg p-2">
                {mobileDevices.map(device => (
                  <DeviceOutline
                    key={device.name}
                    device={device}
                    isSelected={selectedDevice.name === device.name}
                    onClick={() => setSelectedDevice(device)}
                  />
                ))}
              </div>
            )}
          </div>
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
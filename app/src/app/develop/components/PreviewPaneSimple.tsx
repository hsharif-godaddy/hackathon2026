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
        className={`relative flex flex-col items-center p-2 rounded-lg transition-all ${
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
  
  // Get iframe dimensions based on view mode and selected device
  const iframeDimensions = viewMode === 'mobile' 
    ? { width: `${selectedDevice.width}px`, height: `${selectedDevice.height}px` }
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
        
        <div className="flex-1 bg-gray-50 flex items-center justify-center py-2">
          {viewMode === 'mobile' ? (
            // Mobile view with device selector on the right
            <div className="flex items-center justify-center space-x-8 mx-2">
              {/* Mobile Preview */}
              <div className="flex flex-col items-center">
                <div 
                  className="shadow-2xl border-4 border-gray-800 bg-white overflow-hidden"
                  style={{ 
                    width: selectedDevice.width, 
                    height: selectedDevice.height,
                    borderRadius: Math.min(selectedDevice.width * 0.08, 32) // 8% of width, max 32px
                  }}
                >
                  <iframe
                    key={iframeKey}
                    ref={iframeRef}
                    id="preview-iframe"
                    src={previewUrl}
                    className="w-full h-full border-0"
                    onError={handleIframeError}
                    onLoad={handleIframeLoad}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                    title={`Preview for ${appId}`}
                  />
                </div>
                {/* Current device info */}
                <div className="mt-3 text-center">
                  <span className="text-xs text-gray-400">
                    {selectedDevice.name} ({selectedDevice.width}×{selectedDevice.height})
                  </span>
                </div>
              </div>
              
              {/* Vertical Device Selector */}
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
            </div>
          ) : (
            // Desktop view - use available space with margin
            <div className="w-full h-full mx-2 my-2 rounded-lg shadow-lg border border-gray-200 bg-white overflow-hidden">
              <iframe
                key={iframeKey}
                ref={iframeRef}
                id="preview-iframe"
                src={previewUrl}
                className="w-full h-full border-0"
                onError={handleIframeError}
                onLoad={handleIframeLoad}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                title={`Preview for ${appId}`}
              />
            </div>
          )}
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
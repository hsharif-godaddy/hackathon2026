'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { 
  ExclamationTriangleIcon, 
  ArrowPathIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import { useAppStore } from '@/stores/useAppStore'
import { useServerStore, ServerStatus } from '@/stores/useServerStore'

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
  } | null
}

export default function PreviewPane({ appId, onRetry, viewMode = 'desktop', selectedCommit }: PreviewPaneProps) {
  const { apps } = useAppStore()
  const currentApp = apps.find(app => app.id === appId)
  
  const { 
    getServerInfo, 
    getServerUrl, 
    registerServer,
    retryConnection,
    startHealthMonitoring,
    stopHealthMonitoring,
    waitForServerReady,
    startPeriodicBackendSync,
    maxRetries 
  } = useServerStore()
  
  const serverInfo = getServerInfo(appId)
  const previewUrl = getServerUrl(appId)
  
  // Track if we've initialized this appId to prevent duplicate setups
  const initializedRef = useRef<Set<string>>(new Set())
  
  // Iframe retry state management
  const [iframeError, setIframeError] = useState(false)
  const [iframeRetries, setIframeRetries] = useState(0)
  const [isReloading, setIsReloading] = useState(false)
  const [iframeKey, setIframeKey] = useState(0) // Force iframe re-render
  const [documentReady, setDocumentReady] = useState(false) // Additional verification
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout>()
  const verificationTimeoutRef = useRef<NodeJS.Timeout>()
  
  const MAX_IFRAME_RETRIES = 5
  const RETRY_DELAYS = [2000, 3000, 5000, 8000, 12000] // Progressive delays

  // Start periodic backend sync once on component mount
  useEffect(() => {
    startPeriodicBackendSync()
  }, [startPeriodicBackendSync])

  // Initialize server registration and wait for backend confirmation
  useEffect(() => {
    if (!currentApp || !appId) return

    // Skip if already initialized
    if (initializedRef.current.has(appId)) {
      return
    }

    // Register server and wait for backend confirmation
    const initializeServer = async () => {
      // Register if not already registered
      if (!getServerInfo(appId)) {
        registerServer(appId, currentApp.port)
      }
      
      console.log(`🔍 PreviewPane: Waiting for server confirmation for appId: ${appId}`)
      
      // Wait for backend to confirm the server is running
      const serverUrl = await waitForServerReady(appId)
      
      if (serverUrl) {
        console.log(`✅ PreviewPane: Server confirmed for appId: ${appId} at ${serverUrl}`)
        // Start health monitoring with delay to allow server to fully start accepting connections
        startHealthMonitoring(appId, true)
      } else {
        console.log(`❌ PreviewPane: Server confirmation failed for appId: ${appId}`)
      }
    }
    
    // Mark as initialized and start the process
    initializedRef.current.add(appId)
    initializeServer()

    return () => {
      stopHealthMonitoring(appId)
      initializedRef.current.delete(appId)
    }
  }, [appId, currentApp, getServerInfo, registerServer, startHealthMonitoring, stopHealthMonitoring, waitForServerReady])

  // Auto-retry logic for server startup
  useEffect(() => {
    if (serverInfo && !serverInfo.isHealthy && serverInfo.retryCount < maxRetries && serverInfo.status !== ServerStatus.RUNNING) {
      const timer = setTimeout(async () => {
        await retryConnection(appId)
      }, serverInfo.retryCount === 0 ? 1000 : Math.min(2000 + serverInfo.retryCount * 1000, 10000))
      
      return () => clearTimeout(timer)
    }
  }, [serverInfo, retryConnection, appId, maxRetries])

  // Listen for file save events to auto-refresh preview
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'file-saved' && serverInfo?.isHealthy) {
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
  }, [serverInfo?.isHealthy])

  const handleManualRetry = async () => {
    console.log(`🔄 Manual retry for appId: ${appId}`)
    const serverUrl = await waitForServerReady(appId)
    if (serverUrl) {
      // Use delayed health check for manual retries too, in case server is restarting
      startHealthMonitoring(appId, true)
    }
    onRetry?.()
  }

  // Automatic iframe retry with progressive delays
  const retryIframe = useCallback(() => {
    if (iframeRetries >= MAX_IFRAME_RETRIES) {
      console.log(`❌ Max iframe retries (${MAX_IFRAME_RETRIES}) reached for ${appId}`)
      return
    }

    const delay = RETRY_DELAYS[iframeRetries] || RETRY_DELAYS[RETRY_DELAYS.length - 1]
    console.log(`🔄 Scheduling iframe retry ${iframeRetries + 1}/${MAX_IFRAME_RETRIES} for ${appId} in ${delay}ms`)
    
    setIsReloading(true)
    
    retryTimeoutRef.current = setTimeout(() => {
      console.log(`🔄 Executing iframe retry ${iframeRetries + 1}/${MAX_IFRAME_RETRIES} for ${appId}`)
      setIframeRetries(prev => prev + 1)
      setIframeKey(prev => prev + 1) // Force iframe re-render
      setIframeError(false)
      setIsReloading(false)
    }, delay)
  }, [appId, iframeRetries, MAX_IFRAME_RETRIES, RETRY_DELAYS])

  // Verify document is actually ready when server becomes healthy - but wait for actual health check
  useEffect(() => {
    if (serverInfo?.isHealthy && previewUrl && !documentReady) {
      console.log(`🔍 Server marked healthy, waiting additional 4 seconds before document verification for ${appId}`)
      
      // Wait 4 seconds to ensure the delayed health check has actually completed
      const delayedVerification = setTimeout(() => {
        console.log(`🔍 Starting document verification for ${appId} at ${previewUrl}`)
        
        const verifyDocumentReady = async () => {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 3000)
            
            const response = await fetch(previewUrl, {
              signal: controller.signal,
              method: 'GET'
            })
            
            clearTimeout(timeoutId)
            
            if (response.ok) {
              console.log(`✅ Document verification passed for ${appId}`)
              setDocumentReady(true)
              setIframeError(false)
              setIframeRetries(0)
              setIsReloading(false)
            } else {
              console.log(`❌ Document verification failed for ${appId}: ${response.status}`)
              // Wait and try again
              verificationTimeoutRef.current = setTimeout(verifyDocumentReady, 2000)
            }
          } catch (error) {
            console.log(`❌ Document verification error for ${appId}:`, error)
            // Wait and try again
            verificationTimeoutRef.current = setTimeout(verifyDocumentReady, 2000)
          }
        }
        
        verifyDocumentReady()
      }, 4000) // Wait 4 seconds after server marked healthy
      
      verificationTimeoutRef.current = delayedVerification
    }
    
    // Reset document ready state when server becomes unhealthy
    if (!serverInfo?.isHealthy) {
      setDocumentReady(false)
    }
  }, [serverInfo?.isHealthy, previewUrl, appId, documentReady])

  // Reset iframe state when server becomes healthy and document is ready
  useEffect(() => {
    if (serverInfo?.isHealthy && previewUrl && documentReady && (iframeError || iframeRetries > 0)) {
      console.log(`✅ Server healthy and document ready, resetting iframe state for ${appId}`)
      setIframeError(false)
      setIframeRetries(0)
      setIsReloading(false)
      setIframeKey(prev => prev + 1) // Force fresh load
      
      // Clear any pending retries
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [serverInfo?.isHealthy, previewUrl, documentReady, appId, iframeError, iframeRetries])

  // Cleanup retry timeouts
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
      if (verificationTimeoutRef.current) {
        clearTimeout(verificationTimeoutRef.current)
      }
    }
  }, [])

  // Handle iframe load/error events
  const handleIframeLoad = useCallback(() => {
    console.log(`✅ Preview loaded successfully for appId: ${appId} at ${previewUrl}`)
    setIframeError(false)
    setIframeRetries(0)
    setIsReloading(false)
  }, [appId, previewUrl])

  const handleIframeError = useCallback(() => {
    console.log(`❌ Preview failed to load for appId: ${appId} at ${previewUrl}`)
    setIframeError(true)
    
    // Only auto-retry if we haven't exceeded max retries and server is supposed to be healthy
    if (iframeRetries < MAX_IFRAME_RETRIES && serverInfo?.isHealthy) {
      retryIframe()
    }
  }, [appId, previewUrl, iframeRetries, MAX_IFRAME_RETRIES, serverInfo?.isHealthy, retryIframe])

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

  // Loading state while server is starting or not yet confirmed healthy or document not ready
  if (!serverInfo || 
      (serverInfo.status === ServerStatus.STARTING) || 
      (!serverInfo.isHealthy && serverInfo.retryCount < maxRetries) ||
      (previewUrl && !serverInfo.isHealthy) ||
      (previewUrl && serverInfo.isHealthy && !documentReady)) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 text-gray-600">
        <ArrowPathIcon className="w-12 h-12 animate-spin text-blue-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Waiting for Server Confirmation</h3>
        <p className="text-sm text-gray-500 mb-2">
          {!serverInfo || serverInfo.retryCount === 0 ? 'Waiting for backend to confirm server is running...' : `Checking server status (attempt ${serverInfo.retryCount}/${maxRetries})`}
        </p>
        <p className="text-xs text-gray-400 mb-2 text-center max-w-md">
          We&apos;re polling the backend to find this specific app running instead of guessing ports.
        </p>
        {serverInfo?.actualPort && (
          <p className="text-xs text-gray-400">
            Server detected at: <span className="font-mono">localhost:{serverInfo.actualPort}</span>
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

  // Error state when server failed to start after all retries
  if (serverInfo && !serverInfo.isHealthy && serverInfo.retryCount >= maxRetries) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 text-gray-600">
        <ExclamationTriangleIcon className="w-12 h-12 text-amber-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Server Confirmation Failed</h3>
        <p className="text-sm text-gray-500 mb-4 text-center max-w-md">
          {serverInfo.error || `Could not confirm server is running for this app after waiting 1 minute. The development server may be taking longer than expected or there may be an issue with app startup.`}
        </p>
        {serverInfo.actualPort && (
          <p className="text-xs text-gray-400 mb-4">
            Expected URL: <span className="font-mono">localhost:{serverInfo.actualPort}</span>
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

  // Success state - only render if we have a confirmed URL AND server is healthy AND document is ready
  if (!previewUrl || !serverInfo?.isHealthy || !documentReady) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 text-gray-600">
        <ArrowPathIcon className="w-12 h-12 animate-spin text-blue-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">
          {!previewUrl 
            ? 'Waiting for Server URL' 
            : !serverInfo?.isHealthy 
              ? 'Waiting for Server Health Check'
              : 'Verifying Document Readiness'
          }
        </h3>
        <p className="text-sm text-gray-500 mb-2">
          {!previewUrl 
            ? 'Waiting for backend to confirm the exact server URL for this app...'
            : !serverInfo?.isHealthy 
              ? 'Server URL confirmed. Waiting for health check to pass before loading preview...'
              : 'Health check passed. Verifying the document is ready to load...'
          }
        </p>
        <p className="text-xs text-gray-400 text-center max-w-md">
          {previewUrl ? (
            <span>URL: <span className="font-mono">{previewUrl}</span></span>
          ) : (
            <span>AppId: <span className="font-mono">{appId}</span></span>
          )}
        </p>
      </div>
    )
  }

  // Success state - show the preview with confirmed URL
  return (
    <div className="h-full relative overflow-hidden">
      {selectedCommit && (
        <div className="absolute top-0 left-0 right-0 bg-amber-50 border-b border-amber-200 py-1 px-3 z-10 flex items-center justify-between">
          <div className="flex items-center">
            <ClockIcon className="w-4 h-4 text-amber-700 mr-2" />
            <span className="text-xs text-amber-800">
              Viewing historical version: <span className="font-mono">{selectedCommit.shortHash}</span>
            </span>
          </div>
          <span className="text-xs text-amber-700 font-medium truncate max-w-md">
            {selectedCommit.message}
          </span>
        </div>
      )}
      {/* Retry overlay */}
      {(isReloading || (iframeError && iframeRetries < MAX_IFRAME_RETRIES)) && (
        <div className="absolute inset-0 bg-gray-50/90 backdrop-blur-sm flex flex-col items-center justify-center z-20">
          <ArrowPathIcon className="w-12 h-12 animate-spin text-blue-500 mb-4" />
          <h3 className="text-lg font-semibold mb-2 text-gray-800">
            {isReloading ? 'Reloading Preview...' : 'Connection Error - Retrying...'}
          </h3>
          <p className="text-sm text-gray-600 mb-2 text-center max-w-md">
            {isReloading 
              ? `Attempting to reload the preview (${iframeRetries}/${MAX_IFRAME_RETRIES})...`
              : `The server connection was refused. Retrying in ${Math.ceil((RETRY_DELAYS[iframeRetries] || RETRY_DELAYS[RETRY_DELAYS.length - 1]) / 1000)} seconds...`
            }
          </p>
          <p className="text-xs text-gray-500">
            URL: <span className="font-mono">{previewUrl}</span>
          </p>
          <button
            onClick={() => {
              setIframeKey(prev => prev + 1)
              setIframeError(false)
              setIsReloading(false)
              if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current)
              }
            }}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry Now
          </button>
        </div>
      )}
      
      <div className={`flex h-full ${viewMode === 'mobile' ? 'justify-center items-center p-4' : 'w-full h-full'} ${selectedCommit ? 'pt-8' : ''}`}>
        <iframe
          key={iframeKey} // Force re-render when key changes
          ref={iframeRef}
          id="preview-iframe"
          src={previewUrl}
          className={`border-0 ${viewMode === 'mobile' ? 'border border-gray-300 rounded-lg shadow-lg' : ''}`}
          style={getIframeDimensions()}
          title={`Preview of app ${appId}`}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
        />
      </div>
    </div>
  )
}

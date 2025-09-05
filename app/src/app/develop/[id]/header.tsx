'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useRef, useImperativeHandle, forwardRef } from 'react'
import { useParams } from 'next/navigation'
import {
  ArrowPathIcon,
  Squares2X2Icon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline'
import TokenUsage, { TokenUsageRef } from '@/app/develop/components/TokenUsage'
import { SignOutButton } from '@/components/auth'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerStore } from '@/stores/useServerStore'

interface HeaderProps {
  app: { name?: string; port?: number } | null // App data from page state
  showUsageCost: boolean
  onPreviewRefresh: () => void
  onRestartServer: () => void
}

export interface HeaderRef {
  refreshTokenUsage: () => void
}

const Header = forwardRef<HeaderRef, HeaderProps>(function Header({
  app,
  showUsageCost,
  onPreviewRefresh,
  onRestartServer
}, ref) {
  const params = useParams()
  const appId = params.id as string
  const tokenUsageRef = useRef<TokenUsageRef>(null)
  
  // Expose refresh functionality to parent
  useImperativeHandle(ref, () => ({
    refreshTokenUsage: () => {
      tokenUsageRef.current?.refreshUsage()
    }
  }), [])
  
  // Get state from stores
  const {
    viewMode,
    previewViewMode,
    hasUnsavedChanges,
    isCheckingApp,
    isStartingApp,
    isRestarting,
    handleViewModeChange,
    setPreviewViewMode
  } = useDevelopPageStore()
  
  // Get real-time server status
  const {
    getServerInfo,
    getServerUrl,
    isServerReady
  } = useServerStore()
  
  const serverInfo = getServerInfo(appId)
  const serverUrl = getServerUrl(appId)
  const actualPort = serverInfo?.actualPort
  const isServerRunning = isServerReady(appId)
  
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-12">
          <div className="flex items-center space-x-4">
            <Link href="/" className="flex items-center space-x-3">
              <div className="flex items-center justify-center">
                <Image src="/logo.svg" alt="Airo Logo" width={128} height={48} />
              </div>
            </Link>
            <div className="h-6 w-px bg-gray-300" />
            <div className="flex items-center space-x-2">
              <span className="text-gray-900 font-medium">
                {app ? app.name : `App ${appId}`}
              </span>
              {isCheckingApp && (
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                  Checking App Status...
                </span>
              )}
              {isStartingApp && !isCheckingApp && (
                <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                  Starting App...
                </span>
              )}
              {isRestarting && !isCheckingApp && !isStartingApp && (
                <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                  Restarting App...
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {/* View Mode Toggle Buttons */}
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => handleViewModeChange('preview', hasUnsavedChanges)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  viewMode === 'preview' 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Preview
              </button>
              <button 
                onClick={() => handleViewModeChange('code', hasUnsavedChanges)}
                className={`flex items-center px-2 py-1 text-xs rounded-md transition-colors ${
                  viewMode === 'code' 
                    ? 'bg-purple-100 text-purple-700' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Code
                {hasUnsavedChanges && viewMode === 'code' && (
                  <div className="w-2 h-2 bg-orange-500 rounded-full ml-1" title="Unsaved changes" />
                )}
              </button>
            </div>

            {/* Preview controls when in preview mode and server is ready */}
            {viewMode === 'preview' && isServerRunning && actualPort && (
              <div className="flex items-center space-x-3">
                {/* View Mode Toggles */}
                <div className="flex items-center space-x-1 border border-gray-200 rounded-md p-0.5">
                  <button
                    onClick={() => setPreviewViewMode('desktop')}
                    className={`p-1 rounded transition-colors ${
                      previewViewMode === 'desktop'
                        ? 'bg-blue-100 text-blue-600'
                        : 'hover:bg-gray-100 text-gray-600'
                    }`}
                    title="Desktop view"
                  >
                    <ComputerDesktopIcon className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setPreviewViewMode('mobile')}
                    className={`p-1 rounded transition-colors ${
                      previewViewMode === 'mobile'
                        ? 'bg-blue-100 text-blue-600'
                        : 'hover:bg-gray-100 text-gray-600'
                    }`}
                    title="Mobile view"
                  >
                    <DevicePhoneMobileIcon className="w-3 h-3" />
                  </button>
                </div>
                
                {/* App Control Buttons */}
                <div className="flex items-center space-x-1">
                  <button
                    onClick={onPreviewRefresh}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                    title="Reload preview (refresh page content)"
                  >
                    <ArrowPathIcon className="w-3 h-3 text-gray-600" />
                  </button>
                  
                  <button 
                    onClick={onRestartServer}
                    disabled={!isServerRunning || isRestarting}
                    className="p-1 hover:bg-orange-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Restart server (rebuild and restart development server)"
                  >
                    <ArrowPathIcon className={`w-3 h-3 ${isRestarting ? 'animate-spin text-orange-600' : 'text-orange-600'}`} />
                  </button>
                  
                  <button 
                    onClick={() => {
                      if (serverUrl) {
                        window.open(serverUrl, '_blank')
                      }
                    }}
                    disabled={!isServerRunning || isCheckingApp || isRestarting || isStartingApp}
                    className="p-1 hover:bg-green-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Open app in new tab"
                  >
                    <ArrowTopRightOnSquareIcon className="w-3 h-3 text-green-600" />
                  </button>
                </div>
              </div>
            )}
            
            {appId && (
              <TokenUsage ref={tokenUsageRef} appId={appId} enabled={showUsageCost} />
            )}
            <Link
              href="/apps"
              className="inline-flex items-center px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium"
            >
              <Squares2X2Icon className="w-4 h-4 mr-2" />
              My Apps
            </Link>
            <SignOutButton iconOnly />
          </div>
        </div>
      </div>
    </header>
  )
})

export default Header

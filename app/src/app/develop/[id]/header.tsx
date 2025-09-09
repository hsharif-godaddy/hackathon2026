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
import { UserMenu } from '@/components/auth'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { isFeatureEnabled } from '@/lib/features'
import Box from '@ux/box'
import Button from '@ux/button'
import SiblingSet from '@ux/sibling-set'
import Tag from '@ux/tag'
import { text } from '@ux/text'

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
  const { getServerState } = useServerPollingStore()
  
  const serverState = getServerState(appId)
  const actualPort = serverState?.port
  const serverUrl = serverState?.url
  
  return (
    <header className="border-b">
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-12">
          <div className="flex items-center space-x-4">
            <Link href="/" className="flex items-center space-x-3">
              <Image src="/logo.svg" alt="Airo Logo" width={128} height={48} />
            </Link>
            <div className="h-6 w-px bg-intents-ux-boxLowContrast-borderColor" />
            <div className="flex items-center space-x-2">
              <text.strong 
                size={ -1 }
                text={ app ? app.name : `App ${appId}` }
              />
              {isCheckingApp && (
                <Tag emphasis="info" size="sm">
                  Checking App Status...
                </Tag>
              )}
              {isStartingApp && !isCheckingApp && (
                <Tag emphasis="warning" size="sm">
                  Starting App...
                </Tag>
              )}
              {isRestarting && !isCheckingApp && !isStartingApp && (
                <Tag emphasis="warning" size="sm">
                  Restarting App...
                </Tag>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {/* View Mode Toggle Buttons */}
            <SiblingSet gap="sm">
              <Button 
                onClick={() => handleViewModeChange('preview', hasUnsavedChanges)}
                size="sm"
                design="control"
                active={viewMode === 'preview'}
                text="Preview"
              />
              {/* Code Editor Button - Feature Flag Controlled */}
              {isFeatureEnabled.codeEditor() && (
                <Button 
                  onClick={() => handleViewModeChange('code', hasUnsavedChanges)}
                  size="sm"
                  design="control"
                  active={viewMode === 'code'}
                >
                  Code
                  {hasUnsavedChanges && viewMode === 'code' && (
                    <Tag emphasis="warning" size="sm">
                      Unsaved changes
                    </Tag>
                  )}
                </Button>
              )}
            </SiblingSet>

            {/* Preview controls when in preview mode */}
            {viewMode === 'preview' && (
              <div className="flex items-center space-x-3">
                {/* View Mode Toggles */}
                <Box orientation="horizontal" gap="sm" className="border border-gray-200 rounded-md p-1">
                    <Button
                      onClick={() => setPreviewViewMode('desktop')}
                      size="sm"
                      design="control"
                      active={previewViewMode === 'desktop'}
                      className="p-1!"
                    >
                      <ComputerDesktopIcon className="w-3 h-3" />
                    </Button>
                    <Button
                      onClick={() => setPreviewViewMode('mobile')}
                      size="sm"
                      design="control"
                      active={previewViewMode === 'mobile'}
                      className="p-1!"
                    >
                      <DevicePhoneMobileIcon className="w-3 h-3" />
                    </Button>
                </Box>
                
                {/* App Control Buttons */}
                <div className="flex items-center space-x-1">
                  <Button
                    onClick={onPreviewRefresh}
                    title="Reload preview (refresh page content)"
                    icon={<ArrowPathIcon className="w-4! h-4! text-gray-600" />}
                    size="sm"
                    design="stateless"
                  />
                  
                  <Button 
                    onClick={onRestartServer}
                    disabled={isRestarting}
                    className="p-1 hover:bg-orange-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Restart server (rebuild and restart development server)"
                    icon={<ArrowPathIcon className={`w-4! h-4! text-intents-ux-feedbackHighContrastCritical-feedbackColor ${isRestarting && 'animate-spin'}`} />}
                    size="sm"
                    design="stateless"
                  />
                  
                  <Button 
                    onClick={() => {
                      if (serverUrl) {
                        window.open(serverUrl, '_blank')
                      } else if (actualPort) {
                        window.open(`http://localhost:${actualPort}`, '_blank')
                      }
                    }}
                    disabled={!actualPort || isCheckingApp || isRestarting || isStartingApp}
                    title="Open app in new tab"
                    icon={<ArrowTopRightOnSquareIcon className="w-4! h-4! text-intents-ux-feedbackHighContrastSuccess-feedbackColor" />}
                    size="sm"
                    design="stateless"
                  />
                </div>
              </div>
            )}
            
            {appId && (
              <TokenUsage ref={tokenUsageRef} appId={appId} enabled={showUsageCost} />
            )}
            <SiblingSet gap="sm">
              <Button
                href="/sites"
                design="primary"
                icon={<Squares2X2Icon className="w-4 h-4 mr-2" />}
                data-partial="componentAiro"
                text="My Apps"
              />
              <UserMenu />
            </SiblingSet>
          </div>
        </div>
      </div>
    </header>
  )
})

export default Header
